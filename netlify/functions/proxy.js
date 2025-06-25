// netlify/functions/proxy.js

import { proxyCore } from '../../proxyCore.js';

// 这是 Netlify/AWS Lambda 的标准 handler 格式
export const handler = async (event, context) => {
  // 我们需要将 Netlify 的 event 对象，适配成 proxyCore 所需的 req 对象
  const req = {
    headers: event.headers,
    query: event.queryStringParameters,
    method: event.httpMethod,
    body: event.body,
  };

  // 调用核心函数，并明确告知平台是 'netlify'
  // 它将返回一个符合 Netlify 要求的对象
  const result = await proxyCore({ req: req, platform: 'netlify' });

  // 直接返回这个结果对象
  return result;
};
