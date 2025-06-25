import { proxyCore } from '../../proxyCore.js';

// 自动 parse body
function autoParseBody(event) {
  if (!event.body) return undefined;
  if (typeof event.body === 'object') return event.body;
  try { return JSON.parse(event.body); } catch { return event.body; }
}

export const handler = async (event) => {
  const req = {
    headers: event.headers,
    query: event.queryStringParameters,
    method: event.httpMethod,
    body: autoParseBody(event)
  };
  // platform 明确指定为 netlify，CORS 由 proxyCore 结果 headers 自动带出
  return await proxyCore({ req, platform: 'netlify' });
};

