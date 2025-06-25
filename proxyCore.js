// proxyCore.js
import { pipeline } from 'node:stream/promises';
import { gotScraping } from 'got-scraping';
import { ProxyAgent } from 'proxy-agent';

// --- 指纹参数与辅助函数 ---
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_OS = ['windows', 'macos', 'linux'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 统一获取请求负载 (query for GET, body for POST)
function getPayload(req, platform) {
  if (req.method !== 'POST') {
    return platform === 'netlify' ? req.queryStringParameters || {} : req.query || {};
  }
  try {
    const bodyStr = platform === 'netlify' ? req.body || '{}' : JSON.stringify(req.body);
    return JSON.parse(bodyStr);
  } catch {
    return {};
  }
}

// --- 核心逻辑 ---
export async function proxyCore({ req, res, platform }) {
  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const payload = getPayload(req, platform);

  // --- 1. 认证检查 ---
  // 优先从 Header 获取，其次从请求负载(query/body)获取
  const clientToken = req.headers['x-proxy-token'] || payload.token;
  const envToken = process.env.PROXY_AUTH_TOKEN;

  // 如果服务器配置了 TOKEN，则必须进行验证
  if (envToken && clientToken !== envToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }));
    return;
  }

  // --- 2. 参数校验 ---
  const { url, proxyUrl, token, ...restOfPayload } = payload; // 从负载中移除token，避免意外传递

  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'A valid "url" parameter is required.' }));
    return;
  }

  // --- 3. 配置出站代理 (Agent) ---
  let agent;
  if (proxyUrl) {
    try {
      agent = {
        http: new ProxyAgent(proxyUrl),
        https: new ProxyAgent(proxyUrl),
      };
    } catch (e) {
      console.warn(`Invalid proxyUrl, ignoring: ${proxyUrl}`);
    }
  }

  // --- 4. 生成随机浏览器指纹 ---
  const headerGeneratorOptions = {
    browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 120 }],
    operatingSystems: [pickRandom(SUPPORTED_OS)],
    devices: [pickRandom(SUPPORTED_DEVICES)],
    locales: ['en-US', 'en', 'zh-CN'],
    httpVersion: '2',
  };

  const bodyToForward = restOfPayload.body
    ? typeof restOfPayload.body === 'object'
      ? JSON.stringify(restOfPayload.body)
      : restOfPayload.body
    : undefined;
    
  // --- 5. 配置并执行请求 ---
  const options = {
    method: restOfPayload.method || req.method,
    headers: restOfPayload.headers || {},
    body: bodyToForward,
    throwHttpErrors: false,
    timeout: { request: 30000 },
    headerGeneratorOptions,
    ...(agent && { agent }),
  };

  try {
    const proxyRequestStream = gotScraping.stream(url, options);

    proxyRequestStream.on('response', (response) => {
      const passHeaders = { 'Content-Type': response.headers['content-type'] || 'application/octet-stream' };
      ['content-disposition', 'cache-control', 'content-length', 'set-cookie', 'content-range', 'accept-ranges'].forEach(h => {
        if (response.headers[h]) passHeaders[h] = response.headers[h];
      });
      res.writeHead(response.statusCode, passHeaders);
    });
    
    await pipeline(proxyRequestStream, res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy request failed', details: error.message }));
  }
}
