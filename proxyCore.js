// proxyCore.js
import { gotScraping } from 'got-scraping';

// 支持的指纹参数
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edge'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const SUPPORTED_LOCALES = ['en-US', 'zh-CN', 'zh-TW', 'en-GB', 'ja-JP', 'ko-KR'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function isPlainObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

export async function proxyCore({
  method = 'GET',
  headers = {},
  url,
  token,
  body = undefined,
  envToken // process.env.PROXY_AUTH_TOKEN
}) {
  // 1. 鉴权
  if (!token || token !== envToken) {
    return { statusCode: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid or missing token.' }) };
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'A valid "url" parameter is required.' }) };
  }

  // 2. 只允许 referer/cookie，类型兜底
  let filteredHeaders = {};
  try {
    if (isPlainObject(headers)) {
      filteredHeaders = headers;
    } else if (typeof headers === 'string') {
      const parsed = JSON.parse(headers);
      if (isPlainObject(parsed)) filteredHeaders = parsed;
    }
  } catch {
    filteredHeaders = {};
  }
  filteredHeaders = Object.fromEntries(
    Object.entries(filteredHeaders).filter(([k]) => ['referer', 'cookie'].includes(k.toLowerCase()))
  );
  if (!isPlainObject(filteredHeaders)) filteredHeaders = {};

  // 3. 指纹自动生成
  const browser = pickRandom(SUPPORTED_BROWSERS);
  const device = pickRandom(SUPPORTED_DEVICES);
  const os = pickRandom(SUPPORTED_OS);
  const locale = pickRandom(SUPPORTED_LOCALES);

  const headerGeneratorOptions = {
    browsers: [{ name: browser, minVersion: 110 }],
    devices: [device],
    operatingSystems: [os],
    locales: [locale]
  };

  // 4. got-scraping参数
  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: filteredHeaders,
    headerGeneratorOptions,
    timeout: { request: 20000 },
    retry: 0,
    ...(body ? { body } : {})
  };

  try {
    const response = await gotScraping(url, options);

    // 5. 透传安全头
    const passHeaders = {};
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    passHeaders['content-type'] = contentType;
    ['content-disposition', 'content-length', 'accept-ranges', 'cache-control', 'content-range'].forEach((k) => {
      if (response.headers[k]) passHeaders[k] = response.headers[k];
    });

    return {
      statusCode: response.statusCode,
      headers: passHeaders,
      body: response.body
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed.', details: error.message })
    };
  }
}

