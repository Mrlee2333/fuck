// pages/api/proxy.js
import { proxyCore } from '../../proxyCore.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 参数收集
  const src = req.method === 'POST' ? req.body : req.query;
  // token兼容header/query/body
  const token = req.headers['x-proxy-token'] || src.token;
  const result = await proxyCore({
    method: req.method === 'POST' ? (src.method || 'GET') : (req.query.method || 'GET'),
    headers: src.headers,
    url: src.url,
    token,
    envToken: process.env.PROXY_AUTH_TOKEN,
    body: req.method === 'POST' ? src.body : undefined
  });

  Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(result.statusCode).send(result.body);
}

