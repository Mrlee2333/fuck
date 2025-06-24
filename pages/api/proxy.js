import { gotScraping } from 'got-scraping';

const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isAuthorized(req) {
  const token =
    req.headers['x-proxy-token'] ||
    req.query.token ||
    req.body?.token;
  return token === process.env.PROXY_AUTH_TOKEN;
}

function getParam(req, key, fallback = undefined) {
  if (req.method === 'GET') return req.query[key] ?? fallback;
  if (req.method === 'POST') return req.body?.[key] ?? fallback;
  return fallback;
}

export default async function handler(req, res) {
  // 设置 CORS 头部
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-token');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  const method = req.method === 'POST'
    ? req.body?.method || 'GET'
    : getParam(req, 'method', 'GET');

  const targetUrl = getParam(req, 'url');
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'A valid "url" parameter is required.' });
  }

  // 解析自定义 headers
  let customHeaders = {};
  try {
    const h = getParam(req, 'headers');
    if (h && typeof h === 'object' && !Array.isArray(h)) customHeaders = h;
    else if (typeof h === 'string') {
      const parsed = JSON.parse(h);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) customHeaders = parsed;
    }
  } catch {
    customHeaders = {};
  }

  // 只允许传入部分头部
  const allowedHeaderKeys = ['referer', 'user-agent'];
  customHeaders = Object.fromEntries(
    Object.entries(customHeaders).filter(([k]) => allowedHeaderKeys.includes(k.toLowerCase()))
  );

  // 随机生成指纹参数
  const browser = pickRandom(SUPPORTED_BROWSERS);
  const device = pickRandom(SUPPORTED_DEVICES);
  const os = pickRandom(SUPPORTED_OS);

  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: customHeaders,
    headerGeneratorOptions: {
      browsers: [{ name: browser, minVersion: 110 }],
      devices: [device],
      operatingSystems: [os],
    },
    timeout: { request: 20000 },
    retry: 0,
  };

  try {
    const response = await gotScraping(targetUrl, options);

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    ['content-disposition', 'content-length', 'accept-ranges', 'cache-control'].forEach((key) => {
      if (response.headers[key]) {
        res.setHeader(key, response.headers[key]);
      }
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    res.status(502).json({ error: 'Proxy request failed.', details: error.message });
  }
}

