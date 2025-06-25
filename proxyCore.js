// proxyCore.js

// --- 指纹配置 ---

const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edge'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_LOCALES = ['en-US', 'en', 'zh-CN', 'ja-JP'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isPlainObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

// --- 参数净化 ---
function getAndValidatePayload(req) {
  let rawPayload = {};
  if (req.method === 'POST') {
    rawPayload = typeof req.body === 'object' && req.body !== null ? req.body : {};
  } else {
    rawPayload = req.query || {};
  }
  if (!rawPayload.url || typeof rawPayload.url !== 'string' || !rawPayload.url.startsWith('http')) {
    return { error: 'A valid "url" parameter starting with http(s) is required.' };
  }
  const url = rawPayload.url;
  const method = (typeof rawPayload.method === 'string' ? rawPayload.method : 'GET').toUpperCase();
  // 只允许 referer/cookie，且必须为字符串
  const headers = {};
  if (typeof rawPayload.headers === 'object' && rawPayload.headers !== null) {
    for (const [key, value] of Object.entries(rawPayload.headers)) {
      if (typeof key === 'string' && typeof value === 'string' && ['referer', 'cookie'].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    }
  }
  let body = rawPayload.body;
  if (typeof body === 'object' && body !== null) {
    body = JSON.stringify(body);
    if (method === 'POST' && !headers['content-type'] && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }
  return { payload: { url, method, headers, body } };
}

// --- Netlify 端流式、二进制资源安全代理 ---
async function runNetlifySimpleProxy({ req, url, method, headers, body }) {
  try {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('User-Agent')) requestHeaders.set('User-Agent', userAgent);
    if (req.headers.cookie && !requestHeaders.has('Cookie')) requestHeaders.set('Cookie', req.headers.cookie);
    if (req.headers.referer && !requestHeaders.has('Referer')) requestHeaders.set('Referer', req.headers.referer);

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
    });

    // 过滤 content-encoding
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding') {
        responseHeaders[key] = value;
      }
    });

    // 用 arrayBuffer，完美支持图片/音视频/大文件
    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: buffer, // 由外层决定是否转 base64
    };

  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'Netlify', error: 'Proxy request failed.', details: error.message }),
    };
  }
}

// --- Vercel/本地：got-scraping流式极致兼容（支持所有文件、m3u8、视频、图片） ---
async function runVercelAdvancedProxy({ req, res, url, method, headers, body }) {
  try {
    const { pipeline } = await import('node:stream/promises');
    const { gotScraping } = await import('got-scraping');
    const headersToForward = { ...headers };
    if (req.headers.cookie && !headersToForward.Cookie && !headersToForward.cookie) headersToForward.Cookie = req.headers.cookie;
    if (req.headers.referer && !headersToForward.Referer && !headersToForward.referer) headersToForward.Referer = req.headers.referer;

    // 随机指纹
    const headerGeneratorOptions = {
      browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 120 }],
      devices: [pickRandom(SUPPORTED_DEVICES)],
      operatingSystems: [pickRandom(SUPPORTED_OS)],
      locales: [pickRandom(SUPPORTED_LOCALES)],
    };

    // gotScraping 流式输出，不缓存任何内容
    const proxyRequestStream = gotScraping.stream({
      url,
      method,
      headers: headersToForward,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      headerGeneratorOptions,
      timeout: { request: 60000 },
      throwHttpErrors: false,
    });

    proxyRequestStream.on('response', (response) => {
      res.statusCode = response.statusCode;
      for (const [key, value] of Object.entries(response.headers)) {
        // 过滤 transfer-encoding 和 content-encoding
        if (key.toLowerCase() === 'transfer-encoding' || key.toLowerCase() === 'content-encoding') continue;
        res.setHeader(key, value);
      }
      // 补充 CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
    });

    await pipeline(proxyRequestStream, res);

  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({ engine: 'Vercel', error: 'Proxy request failed.', details: error.message });
    }
  }
}

// --- 主入口 ---
export async function proxyCore({ req, res, platform }) {
  const query = req.query || {};
  const clientToken = req.headers['x-proxy-token'] || query.token;
  const envToken = process.env.PROXY_AUTH_TOKEN;

  // CORS（Netlify 由外层加，Vercel直接加即可）
  if (res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }

  if (envToken && clientToken !== envToken) {
    const errorBody = JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' });
    if (platform === 'netlify') {
      return { statusCode: 401, body: errorBody, headers: { 'Content-Type': 'application/json' } };
    }
    return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
  }

  const { payload, error } = getAndValidatePayload(req);
  if (error) {
    const errorBody = JSON.stringify({ error });
    if (platform === 'netlify') {
      return { statusCode: 400, body: errorBody, headers: { 'Content-Type': 'application/json' } };
    }
    return res.status(400).json({ error });
  }

  const { url, method, headers, body } = payload;

  if (platform === 'netlify') {
    return await runNetlifySimpleProxy({ req, url, method, headers, body });
  } else {
    // Vercel / 本地
    await runVercelAdvancedProxy({ req, res, url, method, headers, body });
  }
}

