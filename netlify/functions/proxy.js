// /netlify/functions/proxy.js

import { proxyCore } from '../../proxyCore.js';

// 轻量辅助函数，用于解析 event.body
function autoParseBody(event) {
  if (!event.body) return undefined;
  // Netlify 可能会对POST请求体进行base64编码
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64');
  }
  // 尝试解析为JSON，失败则返回原始字符串
  try {
    return JSON.parse(event.body);
  } catch {
    return event.body;
  }
}

export const handler = async (event) => {
  // 1. 适配：将 Netlify event 转换为标准 req 结构
  const req = {
    headers: event.headers,
    query: event.queryStringParameters,
    method: event.httpMethod,
    body: autoParseBody(event),
  };

  // 2. 委托：调用核心模块，所有 CORS、鉴权、代理逻辑均在其中
  const coreResult = await proxyCore({ req, platform: 'netlify' });

  // 3. 格式化：将核心模块的返回结果适配为 Netlify 的响应格式
  //    特别是处理二进制内容的 Base64 编码

  // 如果是 OPTIONS 预检或无 body 的响应，直接返回
  if (!coreResult.body) {
    return coreResult;
  }

  // 如果 body 不是 Buffer（例如是 JSON 错误信息），也直接返回
  if (!Buffer.isBuffer(coreResult.body)) {
    return {
      ...coreResult,
      body: typeof coreResult.body === 'object' ? JSON.stringify(coreResult.body) : String(coreResult.body),
    };
  }

  // 核心职责：将二进制 Buffer 转换为 Base64 字符串给 Netlify
  return {
    statusCode: coreResult.statusCode,
    headers: coreResult.headers, // headers 已由 proxyCore 处理好
    body: coreResult.body.toString('base64'),
    isBase64Encoded: true,
  };
};
