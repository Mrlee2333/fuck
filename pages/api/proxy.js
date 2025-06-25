// pages/api/proxy.js
import { proxyCore } from '../../proxyCore.js';

export default async function handler(req, res) {
  // 1. CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 2. 走核心逻辑
  await proxyCore({ req, res });
}

