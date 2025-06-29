// pages/api/proxy.js

import { proxyCore } from '../../proxyCore.js';

// 包含 CORS 所需头部的白名单
function filterHeaders(originalHeaders) {
    const filtered = {};
    const whitelist = [
        'content-type',
        'content-length',
        'content-disposition',
        'cache-control',
        'accept-ranges',
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers'
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

    // 3. 返回响应（支持 Buffer 或字符串）
    res.writeHead(coreResult.statusCode, responseHeaders);
    res.end(coreResult.body);
}
