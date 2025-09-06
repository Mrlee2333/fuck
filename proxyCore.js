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

// --- v1 代理方案配置（专门优化媒体资源） ---
const MEDIA_EXTENSIONS = [
  // 图片
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  // 音频
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma',
  // 视频
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm3u8', 'ts',
  // 文档
  'pdf', 'doc', 'docx', 'txt', 'lrc', 'srt'
];

const MEDIA_MIME_TYPES = {
  // 图片
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
  'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
  'bmp': 'image/bmp', 'ico': 'image/x-icon',
  // 音频
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac',
  'aac': 'audio/aac', 'm4a': 'audio/mp4', 'ogg': 'audio/ogg',
  // 视频
  'mp4': 'video/mp4', 'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska',
  'mov': 'video/quicktime', 'webm': 'video/webm', 'm3u8': 'application/vnd.apple.mpegurl',
  // 文本
  'lrc': 'text/plain', 'srt': 'text/plain', 'txt': 'text/plain'
};

/**
 * 检测是否为媒体资源
 * @param {string} url 
 * @returns {boolean}
 */
function isMediaResource(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split('.').pop();
    return MEDIA_EXTENSIONS.includes(extension);
  } catch {
    return false;
  }
}

/**
 * 获取文件扩展名对应的 MIME 类型
 * @param {string} url 
 * @returns {string|null}
 */
function getMimeTypeFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const extension = urlObj.pathname.toLowerCase().split('.').pop();
    return MEDIA_MIME_TYPES[extension] || null;
  } catch {
    return null;
  }
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

// --- v1 Vercel 轻量化代理引擎 (基于原生 fetch，优化 HTTP 资源支持) ---
async function runVercelV1LightProxy({ req, url, method, headers, body }) {
  try {
    const isMedia = isMediaResource(url);
    const mimeType = getMimeTypeFromUrl(url);
    const isHttp = url.startsWith('http://');
    
    // 轻量化请求头配置
    const requestHeaders = new Headers(headers);
    
    // 基础必需头部
    if (!requestHeaders.has('user-agent')) {
      requestHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    }
    
    // HTTP 资源专用配置
    if (isHttp) {
      // 移除可能导致问题的安全头部
      requestHeaders.delete('upgrade-insecure-requests');
      requestHeaders.delete('sec-fetch-site');
      requestHeaders.delete('sec-fetch-mode');
      requestHeaders.delete('sec-fetch-user');
      requestHeaders.delete('sec-fetch-dest');
      
      // 添加兼容性头部
      requestHeaders.set('Accept-Encoding', 'gzip, deflate'); // 不包含 br
      requestHeaders.set('Connection', 'keep-alive');
    } else {
      requestHeaders.set('Accept-Encoding', 'gzip, deflate, br');
    }
    
    // 媒体资源专用头部
    if (isMedia) {
      requestHeaders.set('Accept', mimeType || '*/*');
      if (req.headers.range) {
        requestHeaders.set('Range', req.headers.range);
      }
    } else {
      requestHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    }
    
    // 继承原有 cookie 和 referer（但要注意 HTTP/HTTPS 混合）
    if (req.headers.cookie && !requestHeaders.has('cookie')) {
      requestHeaders.set('Cookie', req.headers.cookie);
    }
    if (req.headers.referer && !requestHeaders.has('referer')) {
      // 如果目标是 HTTP，且 referer 是 HTTPS，可能需要处理
      const referer = req.headers.referer;
      if (!(isHttp && referer.startsWith('https://'))) {
        requestHeaders.set('Referer', referer);
      }
    }

    // fetch 配置 - 针对 HTTP 资源优化
    const fetchOptions = {
      method,
      headers: requestHeaders,
      body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(isMedia ? 60000 : 15000),
    };

    const response = await fetch(url, fetchOptions);

    // 处理响应头
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // 移除可能导致问题的头部
      if (!['content-encoding', 'transfer-encoding', 'strict-transport-security'].includes(lowerKey)) {
        responseHeaders[key] = value;
      }
    });

    // v1 专用响应头设置
    if (isMedia) {
      responseHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';
      responseHeaders['CDN-Cache-Control'] = 'public, max-age=86400';
    }
    
    // HTTP 资源的特殊处理
    if (isHttp) {
      // 确保不会有 HTTPS 相关的安全头部
      delete responseHeaders['strict-transport-security'];
      delete responseHeaders['content-security-policy'];
      
      // 添加允许混合内容的头部
      responseHeaders['X-Content-Type-Options'] = 'nosniff';
    }
    
    // 确保正确的 MIME 类型
    if (mimeType && !response.headers.get('content-type')) {
      responseHeaders['Content-Type'] = mimeType;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: buffer,
    };
  } catch (error) {
    const isTimeout = error.name === 'TimeoutError' || error.message.includes('timeout');
    const isHttpError = error.message.includes('http://') || url.startsWith('http://');
    
    return {
      statusCode: isTimeout ? 408 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        engine: 'VercelV1Light', 
        error: isTimeout ? 'Request timeout' : 'Proxy request failed.',
        details: error.message,
        isMedia: isMediaResource(url),
        isHttp: url.startsWith('http://'),
        httpSupport: true,
        suggestion: isHttpError ? 'HTTP resources may have connectivity issues' : null
      }),
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
 * 基于请求来源动态生成安全的 CORS 头.
 * @param {string | undefined} origin - 来自请求头的 'Origin' 字段.
 * @returns {object} 返回 CORS 相关的 HTTP 头部.
 */
function getSafeCorsHeaders(origin) {
  const commonHeaders = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-proxy-token, x-proxy-version',
    // 关键: 告知 CDN 或浏览器缓存，响应随 Origin 头变化
    'Vary': 'Origin',
  };

  // 校验 Origin 是否为 arksec.net 或其子域名
  // 注意：出于安全考虑，这里对协议进行了限定，实际可按需调整
  if (origin && (origin.startsWith('https://niceo.de') || origin.endsWith('.arksec.net'))) {
    return {
      'Access-Control-Allow-Origin': origin, // 精确匹配，提升安全性
      ...commonHeaders,
    };
  }

  // 对于不匹配的来源，不返回 Access-Control-Allow-Origin，浏览器将自动拒绝
  return commonHeaders;
}

/**
 * 主入口函数，负责路由、鉴权、CORS和分发任务
 * @param {{ req: object, platform: 'netlify' | 'vercel' }} options
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer|string}>}
 */
export async function proxyCore({ req, platform }) {
  // 1. 统一的 CORS 配置 (动态生成)
  const origin = req.headers.origin;
  const CORS_HEADERS = getSafeCorsHeaders(origin);

  // 2. 统一处理 OPTIONS 预检请求
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

  // 5. 检测代理方案版本
  const proxyVersion = req.headers['x-proxy-version'] || (req.query && req.query.version) || 'default';
  const useV1 = proxyVersion === 'v1';

  // 6. 分发到特定平台的代理引擎
  const { url, method, headers, body } = payload;
  let result;

  if (platform === 'netlify') {
    result = await runNetlifySimpleProxy({ req, url, method, headers, body });
  } else { // 'vercel' or local
    if (useV1) {
      // v1 方案：轻量化，快速代理
      result = await runVercelV1LightProxy({ req, url, method, headers, body });
    } else {
      // 默认方案：完整指纹伪装（较慢但更隐蔽）
      result = await runVercelAdvancedProxy_Buffer({ req, url, method, headers, body });
    }
  }

  // 7. 为所有最终响应（无论成功或失败）附加 CORS 头
  result.headers = { ...result.headers, ...CORS_HEADERS };

  return result;
}
