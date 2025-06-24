import { gotScraping } from 'got-scraping';
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];

function safeBrowser(val) {
  return SUPPORTED_BROWSERS.includes(val) ? val : 'chrome';
}
function safeStr(val, fallback) {
  return typeof val === 'string' && val ? val : fallback;
}
function safeObj(val) {
  return (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
}

export default async function handler(req, res) {
  // CORS支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 校验token，支持header/query/body
  const requiredToken = process.env.PROXY_AUTH_TOKEN;
  const clientToken = req.headers['x-proxy-token'] || req.query.token || req.body?.token;
  if (clientToken !== requiredToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  // 支持GET/POST参数解析
  const isPost = req.method === 'POST';
  const src = isPost ? req.body : req.query;
  const method = safeStr(isPost ? req.body?.method : req.query.method, 'GET');
  const targetUrl = safeStr(src.url);
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).json({ error: 'A valid "url" is required.' });
  }

  const customHeaders = safeObj(src.headers);
  // proxyOptions 为对象时安全解构，否则默认对象
  const po = safeObj(src.proxyOptions);
  const browser = safeBrowser(po.browser || src.browser);
  const device = safeStr(po.device || src.device, 'desktop');
  const os = safeStr(po.os || src.os, 'windows');
  let requestBody = isPost ? (src.body ?? null) : null;
  if (requestBody && typeof requestBody === 'object') requestBody = JSON.stringify(requestBody);

  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: customHeaders,
    body: isPost && requestBody ? requestBody : undefined,
    headerGeneratorOptions: {
      browsers: [{ name: browser, minVersion: 110 }],
      devices: [device],
      operatingSystems: [os],
    },
  };

  try {
    const response = await gotScraping(targetUrl, options);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    ['content-disposition', 'content-length', 'accept-ranges', 'cache-control'].forEach((key) => {
      if (response.headers[key]) res.setHeader(key, response.headers[key]);
    });
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('[PROXY_ERROR]', error);
    res.status(502).json({ error: 'Proxy request execution failed.', details: error.message });
  }
}

