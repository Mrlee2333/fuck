// proxyCore.js

// --- 指纹伪装配置 ---
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edge'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_LOCALES = ['en-US', 'en', 'zh-CN', 'ja-JP'];

/**
 * 从数组中随机选取一个元素
 * @param {Array<T>} arr
 * @returns {T}
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- 参数净化与验证 ---

/**
 * 从请求中提取并验证代理所需参数
 * @param {object} req - Node.js风格的请求对象
 * @returns {{payload?: object, error?: string}}
 */
function getAndValidatePayload(req) {
  const isPost = req.method === 'POST';
  // Vercel/Next.js 自动解析 body，我们直接使用。
  // Netlify 适配器中已将 event.body 转换为 req.body
  const rawPayload = isPost ? (req.body || {}) : (req.query || {});

  const url = typeof rawPayload.url === 'string' ? rawPayload.url : '';
  if (!url.startsWith('http')) {
    return { error: 'A valid "url" parameter starting with http(s) is required.' };
  }

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
  // 如果 body 是 JSON 对象（且非 Buffer），则序列化
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    // 如果是 POST 请求且未指定 Content-Type，则默认为 JSON
    if (isPost && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
  }

  return { payload: { url, method, headers, body } };
}


// --- Netlify 代理引擎 (基于 Fetch API) ---
async function runNetlifySimpleProxy({ req, url, method, headers, body }) {
  try {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const requestHeaders = new Headers(headers);

    if (!requestHeaders.has('user-agent')) requestHeaders.set('User-Agent', userAgent);
    if (req.headers.cookie && !requestHeaders.has('cookie')) requestHeaders.set('Cookie', req.headers.cookie);
    if (req.headers.referer && !requestHeaders.has('referer')) requestHeaders.set('Referer', req.headers.referer);

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      redirect: 'follow',
    });

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      // 移除 content-encoding，因为 Netlify 会自动处理压缩
      if (key.toLowerCase() !== 'content-encoding') {
        responseHeaders[key] = value;
      }
    });

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

// --- Vercel/本地 代理引擎 (基于 got-scraping 【缓冲模式】) ---
async function runVercelAdvancedProxy_Buffer({ req, url, method, headers, body }) {
  try {
    const { gotScraping } = await import('got-scraping');

    const requestOptions = {
      method,
      url,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      headers: {
        ...headers,
        ...(req.headers.cookie && { 'cookie': req.headers.cookie }),
        ...(req.headers.referer && { 'referer': req.headers.referer }),
      },
      responseType: 'buffer', // 关键: 采用缓冲模式以确保在 Vercel 上的稳定性
      throwHttpErrors: false,
      headerGeneratorOptions: {
        browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 110 }],
        devices: [pickRandom(SUPPORTED_DEVICES)],
        operatingSystems: [pickRandom(SUPPORTED_OS)],
      },
      timeout: { request: 60000 },
    };

    const response = await gotScraping(requestOptions);

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body, // response.body 是一个 Buffer
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'Vercel', error: 'Proxy request failed.', details: error.message }),
    };
  }
}

/**
 * 主入口函数，负责路由、鉴权、CORS和分发任务
 * @param {{ req: object, platform: 'netlify' | 'vercel' }} options
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer|string}>}
 */
export async function proxyCore({ req, platform }) {
  // 1. 统一的 CORS 配置
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-proxy-token',
  };

  // 2. 统一处理 OPTIONS 预检请求 (由平台适配层处理，此处作为逻辑备份)
  if (req.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 3. 统一处理鉴权
  const clientToken = req.headers['x-proxy-token'] || (req.query && req.query.token) || (req.body && req.body.token);
  const envToken = process.env.PROXY_AUTH_TOKEN;

  if (envToken && clientToken !== envToken) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }),
    };
  }

  // 4. 统一净化和验证负载
  const { payload, error } = getAndValidatePayload(req);
  if (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error }),
    };
  }

  // 5. 分发到特定平台的代理引擎
  const { url, method, headers, body } = payload;
  let result;

  if (platform === 'netlify') {
    result = await runNetlifySimpleProxy({ req, url, method, headers, body });
  } else { // 'vercel' or local
    result = await runVercelAdvancedProxy_Buffer({ req, url, method, headers, body });
  }

  // 6. 为所有最终响应（无论成功或失败）附加 CORS 头
  result.headers = { ...result.headers, ...CORS_HEADERS };

  return result;
}
