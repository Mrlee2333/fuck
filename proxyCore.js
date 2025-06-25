// proxyCore.js

// --- 辅助函数 ---

// 用于随机选择指纹参数
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_OS = ['windows', 'macos', 'linux'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_LOCALES = ['en-US', 'en', 'zh-CN', 'ja-JP'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 净化和验证客户端传入的参数
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
  const headers = {};
  if (typeof rawPayload.headers === 'object' && rawPayload.headers !== null) {
    for (const [key, value] of Object.entries(rawPayload.headers)) {
      if (typeof key === 'string' && typeof value === 'string') {
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


// --- Netlify 使用的轻量级 Fetch 代理引擎 (保持不变) ---
async function runNetlifySimpleProxy({ req, url, method, headers, body }) {
  console.log('[Netlify Engine] Running simple proxy with native fetch...');
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

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: await response.text(),
      isBase64Encoded: false,
    };

  } catch (error) {
    console.error('[Netlify Engine] Fetch proxy error:', error);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'Netlify', error: 'Proxy request failed.', details: error.message }),
    };
  }
}

// --- Vercel 使用的 got-scraping 高级代理引擎 (增强版) ---
async function runVercelAdvancedProxy({ req, res, url, method, headers, body }) {
  console.log(`[Vercel Engine] Running advanced proxy: ${method} ${url}`);
  try {
    const { pipeline } = await import('node:stream/promises');
    const { gotScraping } = await import('got-scraping');
    
    const headersToForward = { ...headers };
    if (req.headers.cookie && !headersToForward.Cookie && !headersToForward.cookie) headersToForward.Cookie = req.headers.cookie;
    if (req.headers.referer && !headersToForward.Referer && !headersToForward.referer) headersToForward.Referer = req.headers.referer;

    // 【新增】增强的随机指纹配置
    const headerGeneratorOptions = {
        browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 120 }],
        devices: [pickRandom(SUPPORTED_DEVICES)],
        operatingSystems: [pickRandom(SUPPORTED_OS)],
        locales: [pickRandom(SUPPORTED_LOCALES)],
    };

    const proxyRequestStream = gotScraping.stream({
        url: url,
        method: method,
        headers: headersToForward,
        body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
        headerGeneratorOptions: headerGeneratorOptions, // 应用增强指纹
        timeout: { request: 60000 },
        throwHttpErrors: false,
    });
    
    proxyRequestStream.on('response', (response) => {
        res.statusCode = response.statusCode;
        for (const [key, value] of Object.entries(response.headers)) {
            if (key.toLowerCase() !== 'transfer-encoding') res.setHeader(key, value);
        }
    });

    await pipeline(proxyRequestStream, res);

  } catch (error) {
    console.error('[Vercel Engine] got-scraping error:', error);
    if (!res.headersSent) {
      res.status(502).json({ engine: 'Vercel', error: 'Proxy request failed.', details: error.message });
    }
  }
}

// --- 主入口函数 (保持不变) ---
export async function proxyCore({ req, res, platform }) {
  const query = req.query || {};
  const clientToken = req.headers['x-proxy-token'] || query.token;
  const envToken = process.env.PROXY_AUTH_TOKEN;

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
    // Vercel 和本地开发环境会走这里
    await runVercelAdvancedProxy({ req, res, url, method, headers, body });
  }
}
