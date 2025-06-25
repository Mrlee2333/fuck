// netlify/functions/proxy.js
import { proxyCore } from '../../proxyCore.js';

export const handler = async (event) => {
  // CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-proxy-token'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  let src = {};
  try {
    src = event.httpMethod === 'POST'
      ? JSON.parse(event.body || '{}')
      : event.queryStringParameters || {};
  } catch {
    src = {};
  }
  const token = event.headers['x-proxy-token'] || src.token;
  const result = await proxyCore({
    method: event.httpMethod === 'POST' ? (src.method || 'GET') : (src.method || 'GET'),
    headers: src.headers,
    url: src.url,
    token,
    envToken: process.env.PROXY_AUTH_TOKEN,
    body: event.httpMethod === 'POST' ? src.body : undefined
  });

  return {
    statusCode: result.statusCode,
    headers: { ...corsHeaders, ...result.headers },
    body: result.body,
    isBase64Encoded: Buffer.isBuffer(result.body)
  };
};

