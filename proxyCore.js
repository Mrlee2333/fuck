// proxyCore.js

// --- 辅助函数：净化和验证客户端传入的参数 ---
function getAndValidatePayload(req) {
  let rawPayload = {};

  // 1. 根据请求类型获取原始负载
  if (req.method === 'POST') {
    // POST请求，数据在 body 中
    rawPayload = typeof req.body === 'object' && req.body !== null ? req.body : {};
  } else {
    // GET 请求，数据在 query 中
    rawPayload = req.query || {};
  }

  // 2. 验证和净化 URL
  if (!rawPayload.url || typeof rawPayload.url !== 'string' || !rawPayload.url.startsWith('http')) {
    return { error: 'A valid "url" parameter starting with http(s) is required.' };
  }
  const url = rawPayload.url;

  // 3. 验证和净化 Method
  const method = (typeof rawPayload.method === 'string' ? rawPayload.method : 'GET').toUpperCase();

  // 4. 验证和净化 Headers
  const headers = {};
  if (typeof rawPayload.headers === 'object' && rawPayload.headers !== null) {
    for (const [key, value] of Object.entries(rawPayload.headers)) {
      // 确保 key 和 value 都是字符串，防止数字等错误类型
      if (typeof key === 'string' && typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  // 5. 处理 Body
  let body = rawPayload.body;
  if (typeof body === 'object' && body !== null) {
    body = JSON.stringify(body);
    // 如果是 POST 且没有 Content-Type，默认设置为 JSON
    if (method === 'POST' && !headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
  }

  return { payload: { url, method, headers, body } };
}


// --- Netlify 使用的轻量级 Fetch 代理引擎 ---
async function runNetlifySimpleProxy({ req, res, url, method, headers, body }) {
  console.log(`[Netlify Engine] Running simple proxy: ${method} ${url}`);
  try {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    
    // 合并传入的头部和默认的 User-Agent
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('User-Agent')) {
      requestHeaders.set('User-Agent', userAgent);
    }
    // 确保从客户端请求中透传 cookie 和 referer
    if (req.headers.cookie && !requestHeaders.has('Cookie')) requestHeaders.set('Cookie', req.headers.cookie);
    if (req.headers.referer && !requestHeaders.has('Referer')) requestHeaders.set('Referer', req.headers.referer);

    const response = await fetch(url, {
      method: method,
      headers: requestHeaders,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      redirect: 'manual',
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'transfer-encoding') res.setHeader(key, value);
    });

    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();

  } catch (error) {
    console.error('[Netlify Engine] Fetch proxy error:', error);
    if (!res.headersSent) {
      res.status(502).json({ engine: 'Netlify', error: 'Proxy request failed.', details: error.message });
    }
  }
}

// --- Vercel 使用的 got-scraping 高级代理引擎 ---
async function runVercelAdvancedProxy({ req, res, url, method, headers, body }) {
  console.log(`[Vercel Engine] Running advanced proxy: ${method} ${url}`);
  try {
    const { pipeline } = await import('node:stream/promises');
    const { gotScraping } = await import('got-scraping');
    
    // got-scraping 会自动生成强大的指纹，我们只需将自定义头部传入即可
    // 它会智能地合并头部
    const headersToForward = { ...headers };
    // 确保从客户端请求中透传 cookie 和 referer
    if (req.headers.cookie && !headersToForward.Cookie && !headersToForward.cookie) headersToForward.Cookie = req.headers.cookie;
    if (req.headers.referer && !headersToForward.Referer && !headersToForward.referer) headersToForward.Referer = req.headers.referer;

    const proxyRequestStream = gotScraping.stream({
        url: url,
        method: method,
        headers: headersToForward,
        body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
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

// --- 主入口函数 ---
export async function proxyCore({ req, res }) {
  // 1. 统一的 Token 认证
  const query = req.query || {};
  const clientToken = req.headers['x-proxy-token'] || query.token;
  const envToken = process.env.PROXY_AUTH_TOKEN;

  if (envToken && clientToken !== envToken) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
  }
  
  // 2. 获取并验证来自客户端的参数
  const { payload, error } = getAndValidatePayload(req);
  if (error) {
    return res.status(400).json({ error });
  }
  const { url, method, headers, body } = payload;
  
  // 3. 根据环境变量选择执行引擎
  if (process.env.NETLIFY) {
    await runNetlifySimpleProxy({ req, res, url, method, headers, body });
  } else {
    await runVercelAdvancedProxy({ req, res, url, method, headers, body });
  }
}
