// proxyCore.js

// --- 指纹伪装配置 ---
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edge'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_LOCALES = ['en-US', 'en', 'zh-CN', 'ja-JP'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- 参数净化与验证 ---
function getAndValidatePayload(req) {
  let rawPayload = {};
  if (req.method === 'POST') {
    // 兼容Buffer、JSON对象和普通字符串
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
      if (typeof key === 'string' && typeof value === 'string' && ['referer', 'cookie'].includes(key.toLowerCase())) {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  let body = rawPayload.body;
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    if (method === 'POST' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
  }

  return { payload: { url, method, headers, body } };
}


// --- Netlify 代理引擎 (基于 Fetch API) ---
async function runNetlifySimpleProxy({ req, url, method, headers, body }) {
  try {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('user-agent')) requestHeaders.set('User-Agent', userAgent);
    if (req.headers.cookie && !requestHeaders.has('cookie')) requestHeaders.set('Cookie', req.headers.cookie);
    if (req.headers.referer && !requestHeaders.has('referer')) requestHeaders.set('Referer', req.headers.referer);

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      redirect: 'follow', // 自动处理重定向
    });

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      // Netlify会自动处理压缩，因此移除此头，避免客户端二次解压失败
      if (key.toLowerCase() !== 'content-encoding') {
        responseHeaders[key] = value;
      }
    });

    // 返回 Buffer，由上层适配器决定如何编码 (如 base64)
    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: buffer,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'Netlify', error: 'Proxy request failed.', details: error.message }),
    };
  }
}

// --- Vercel/本地 代理引擎 (基于 got-scraping 流式处理) ---
async function runVercelAdvancedProxy({ req, res, url, method, headers, body, corsHeaders }) {
  try {
    const { pipeline } = await import('node:stream/promises');
    const { gotScraping } = await import('got-scraping');

    const headersToForward = { ...headers };
    if (req.headers.cookie && !headersToForward.cookie) headersToForward.cookie = req.headers.cookie;
    if (req.headers.referer && !headersToForward.referer) headersToForward.referer = req.headers.referer;

    const proxyRequestStream = gotScraping.stream({
      url,
      method,
      headers: headersToForward,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      throwHttpErrors: false,
      timeout: { request: 60000 },
      headerGeneratorOptions: {
        browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 120 }],
        devices: [pickRandom(SUPPORTED_DEVICES)],
        operatingSystems: [pickRandom(SUPPORTED_OS)],
        locales: [pickRandom(SUPPORTED_LOCALES)],
      },
    });

    // 关键：在收到目标响应头时，立刻将它们和CORS头写入自己的响应中
    proxyRequestStream.on('response', (response) => {
      res.statusCode = response.statusCode;
      // 写入目标响应头，过滤掉无需转发的头
      for (const [key, value] of Object.entries(response.headers)) {
        if (['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) continue;
        res.setHeader(key, value);
      }
      // 写入CORS头
      for (const [key, value] of Object.entries(corsHeaders)) {
        res.setHeader(key, value);
      }
    });

    // 将代理请求流完整地管道到服务器响应流
    await pipeline(proxyRequestStream, res);

  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({
        engine: 'Vercel',
        error: 'Proxy request failed.',
        details: error.message,
      }));
    } else {
      // 如果头已发送，只能尝试销毁流来结束请求
      res.destroy();
    }
  }
}

/**
 * 主入口函数，负责路由、鉴权、CORS和分发任务
 * @param {{ req: object, res?: object, platform: 'netlify' | 'vercel' }} options
 */
export async function proxyCore({ req, res, platform }) {
  // 1. 统一的 CORS 配置
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-proxy-token',
  };

  // 2. 统一处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    if (res) { // Vercel/Node 环境
      res.writeHead(204, CORS_HEADERS).end();
    } else { // Netlify 环境
      return { statusCode: 204, headers: CORS_HEADERS };
    }
    return;
  }

  // 3. 统一处理鉴权
  const clientToken = req.headers['x-proxy-token'] || (req.query && req.query.token);
  const envToken = process.env.PROXY_AUTH_TOKEN;
  if (envToken && clientToken !== envToken) {
    const errorBody = JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' });
    const errorHeaders = { 'Content-Type': 'application/json', ...CORS_HEADERS };
    if (res) {
      res.writeHead(401, errorHeaders).end(errorBody);
    } else {
      return { statusCode: 401, body: errorBody, headers: errorHeaders };
    }
    return;
  }

  // 4. 统一净化和验证负载
  const { payload, error } = getAndValidatePayload(req);
  if (error) {
    const errorBody = JSON.stringify({ error });
    const errorHeaders = { 'Content-Type': 'application/json', ...CORS_HEADERS };
    if (res) {
      res.writeHead(400, errorHeaders).end(errorBody);
    } else {
      return { statusCode: 400, body: errorBody, headers: errorHeaders };
    }
    return;
  }

  // 5. 分发到特定平台的代理引擎
  const { url, method, headers, body } = payload;
  if (platform === 'netlify') {
    const result = await runNetlifySimpleProxy({ req, url, method, headers, body });
    // 为成功或失败的响应都附加 CORS 头
    result.headers = { ...result.headers, ...CORS_HEADERS };
    return result;
  } else {
    // Vercel 引擎内部已处理 CORS 头
    await runVercelAdvancedProxy({ req, res, url, method, headers, body, corsHeaders: CORS_HEADERS });
  }
}
