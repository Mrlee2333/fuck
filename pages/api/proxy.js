// pages/api/proxy.js

import { gotScraping } from 'got-scraping';

// 定义支持伪造的浏览器选项
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];

export default async function handler(req, res) {
    // 1. 认证：检查代理访问令牌 (保持不变)
    const requiredToken = process.env.PROXY_AUTH_TOKEN;
    if (req.headers['x-proxy-token'] !== requiredToken) {
        return res.status(401).json({ error: 'Unauthorized: Missing or incorrect X-Proxy-Token.' });
    }

    // 只接受 POST 方法，因为所有参数都通过请求体传递
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed. Please use POST.' });
    }

    // 2. 解析客户端传入的、更详细的请求参数
    const {
        url: targetUrl,
        method = 'GET',
        headers: customHeaders = {},
        body: requestBody = null,
        proxyOptions = {}
    } = req.body;

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).json({ error: 'A valid "url" field is required in the request body.' });
    }

    // 3. 构建 got-scraping 的请求选项
    const options = {
        method: method,
        responseType: 'buffer', // 关键：始终以二进制Buffer形式接收响应，以支持所有文件类型
        throwHttpErrors: false, // 我们自己处理HTTP错误，而不是让库抛出
        headers: customHeaders, // 应用客户端传入的自定义header
        body: requestBody ? JSON.stringify(requestBody) : undefined, // 如果有body，则stringfy
        
        // 【核心】根据客户端传入的参数，动态配置浏览器指纹
        headerGeneratorOptions: {
            browsers: [{
                name: SUPPORTED_BROWSERS.includes(proxyOptions.browser) ? proxyOptions.browser : 'chrome',
                minVersion: 110,
            }],
            devices: [proxyOptions.device || 'desktop'],
            operatingSystems: [proxyOptions.os || 'windows'],
        }
    };

    console.log(`[Proxy] Forwarding ${method} request to ${targetUrl} with spoofed fingerprint...`);

    try {
        // 4. 使用 gotScraping 发起请求
        const response = await gotScraping(targetUrl, options);

        // 5. 智能地将目标响应转发回客户端
        
        // 复制目标服务器的 Content-Type
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        // 复制其他必要的响应头
        // (可以根据需要添加更多要透传的头)
        if (response.headers['content-disposition']) {
            res.setHeader('Content-Disposition', response.headers['content-disposition']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        // 设置响应状态码并发送响应体 (Buffer)
        res.status(response.statusCode).send(response.body);

    } catch (error) {
        console.error('[PROXY_ERROR]', error);
        res.status(502).json({ error: 'Proxy request execution failed.', details: error.message });
    }
}
