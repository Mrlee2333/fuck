import { proxyCore } from '../../proxyCore.js';

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
  const coreResult = await proxyCore({ req, platform: 'netlify' });

  const headers = {
    ...coreResult.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-proxy-token',
  };

  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  let isBase64Encoded = false;
  let body = coreResult.body;

  // 通用图片/视频/二进制类型判断
  const binaryTypes = [
    'image/', 'video/', 'audio/', 'application/octet-stream', 'application/pdf', 'font/', 'application/zip'
  ];
  if (
    (Buffer.isBuffer(body)) ||
    binaryTypes.some(type => contentType.startsWith(type))
  ) {
    body = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body, 'binary').toString('base64');
    isBase64Encoded = true;
  } else if (typeof body !== 'string') {
    body = Buffer.from(body).toString('base64');
    isBase64Encoded = true;
  }

  // content-encoding 移除
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

