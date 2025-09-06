// pages/api/proxy.js

import { proxyCore } from '../../proxyCore.js';

// 包含 CORS 所需头部的白名单
function filterHeaders(originalHeaders) {
    const filtered = {};
    const whitelist = [
        'content-type',
        'content-length',
        'content-disposition',
        'content-range', // 断点续传必需
        'accept-ranges', // 断点续传必需
        'cache-control',
        'cdn-cache-control',
        'vercel-cache-tags',
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'vary',
        'etag',
        'last-modified',
        'expires'
    ];
    for (const key in originalHeaders) {
        if (whitelist.includes(key.toLowerCase())) {
            filtered[key] = originalHeaders[key];
        }
    }
    return filtered;
}

export default async function handler(req, res) {
    // 1. 调用核心代理逻辑
    const coreResult = await proxyCore({ req, platform: 'vercel' });

    // 2. 过滤并写入响应头（包含 CORS 头部）
    const responseHeaders = filterHeaders(coreResult.headers);

    // 3. 设置响应头
    res.writeHead(coreResult.statusCode, responseHeaders);

    // 4. 处理流式响应 vs 缓冲响应
    if (coreResult.isStream && coreResult.body && typeof coreResult.body.pipe === 'function') {
        // 流式传输：直接将上游响应流管道到客户端
        coreResult.body.pipe(res);
        
        // 处理流错误
        coreResult.body.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Stream transmission failed' }));
            } else {
                res.destroy();
            }
        });
        
        // 流结束处理
        coreResult.body.on('end', () => {
            res.end();
        });
    } else if (coreResult.isStream && coreResult.body instanceof ReadableStream) {
        // 处理 Web Streams API (Fetch API 返回的流)
        const reader = coreResult.body.getReader();
        
        const pump = async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    if (!res.write(value)) {
                        // 如果写入缓冲区满了，等待 drain 事件
                        await new Promise(resolve => res.once('drain', resolve));
                    }
                }
                res.end();
            } catch (error) {
                console.error('ReadableStream error:', error);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: 'Stream transmission failed' }));
            }
        };
        
        pump();
    } else {
        // 传统缓冲模式
        res.end(coreResult.body);
    }
}
