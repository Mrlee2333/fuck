import { proxyCore } from '../../proxyCore.js';

// 辅助函数：自动 JSON 解包
function autoParseBody(event) {
  if (!event.body) return undefined;
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return event.body;
  }
}

// 主 Netlify handler
export const handler = async (event, context) => {
  // 1. 适配 req 格式，自动 body 解析
  const req = {
    headers: event.headers,
    query: event.queryStringParameters,
    method: event.httpMethod,
    body: autoParseBody(event)
  };

  // 2. 调用核心逻辑，返回 { statusCode, headers, body }
  // 3. 判断内容类型（支持图片、视频、二进制，自动转 base64）
  const coreResult = await proxyCore({ req: req, platform: 'netlify' });

  // 4. 补充 CORS
  const headers = {
    ...coreResult.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-proxy-token',
  };

  // 5. 判断内容类型是否需要 base64（图片/视频/非文本全 base64 传输）
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  let isBase64Encoded = false;
  let body = coreResult.body;

  // 支持常见的二进制类型
  const binaryTypes = [
    'image/', 'video/', 'audio/', 'application/octet-stream', 'application/pdf', 'application/zip',
    'application/vnd', 'font/', 'application/x-font', 'application/x-shockwave-flash'
  ];
  if (
    (Buffer.isBuffer(body)) ||
    binaryTypes.some(type => contentType.startsWith(type))
  ) {
    // 转成 base64，适配 Netlify 的 isBase64Encoded
    body = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body, 'binary').toString('base64');
    isBase64Encoded = true;
  } else if (typeof body !== 'string') {
    // 万一 body 是 Buffer 但 content-type 没标出来，依然转 base64
    body = Buffer.from(body).toString('base64');
    isBase64Encoded = true;
  }

  // 6. content-encoding 头务必移除（防止 ERR_CONTENT_DECODING_FAILED）
  Object.keys(headers).forEach((key) => {
    if (key.toLowerCase() === 'content-encoding') {
      delete headers[key];
    }
  });

  return {
    statusCode: coreResult.statusCode,
    headers,
    body,
    isBase64Encoded
  };
};

