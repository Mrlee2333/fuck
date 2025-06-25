// pages/api/proxy.js

import { proxyCore } from '../../proxyCore.js';

function filterHeaders(originalHeaders) {
    const filtered = {};
    const whitelist = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'accept-ranges'];
    for (const key in originalHeaders) {
        if (whitelist.includes(key.toLowerCase())) {
            filtered[key] = originalHeaders[key];
        }
    }
    return filtered;
}

export default async function handler(req, res) {
  // 1. 委托给核心模块处理
  // 注意：我们不再传递 res 对象
  const coreResult = await proxyCore({ req, platform: 'vercel' });
  
  // 2. 将返回的结果写入响应
  const responseHeaders = filterHeaders(coreResult.headers);
  
  // Vercel/Node的res.writeHead可以一次性设置状态码和头
  res.writeHead(coreResult.statusCode, responseHeaders);
  
  // res.end 可以安全地处理 Buffer 或字符串
  res.end(coreResult.body);
}
