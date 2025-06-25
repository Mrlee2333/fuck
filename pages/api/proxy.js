import { gotScraping } from 'got-scraping';

// 指纹和设备等白名单
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edge'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const SUPPORTED_LOCALES = ['en-US', 'zh-CN', 'zh-TW', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'ru-RU', 'es-ES'];
const SUPPORTED_HTTP_VERSIONS = ['1', '2'];
const SUPPORTED_SEC_CH_UA_MODELS = [
  'SM-G991B', 'iPhone', 'Pixel 6', 'Redmi Note 10', 'Mi 11', 'OnePlus9', 'VOG-L29', 'M2012K11AC'
];
const SUPPORTED_PLATFORMS = ['Win32', 'Linux x86_64', 'MacIntel', 'Android', 'iPhone'];
const SUPPORTED_SCREEN_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 360, height: 800 },
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function isPlainObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  const isPost = req.method === 'POST';
  const src = isPost ? req.body : req.query;
  const method = (isPost ? req.body?.method : req.query.method || 'GET').toUpperCase();
  const targetUrl = getParam(req, 'url');
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'A valid "url" parameter is required.' });
  }

  // 只允许前端自定义 cookie 和 referer
  let customHeaders = {};
  try {
    const h = getParam(req, 'headers');
    if (isPlainObject(h)) {
      customHeaders = h;
    } else if (typeof h === 'string') {
      const parsed = JSON.parse(h);
      if (isPlainObject(parsed)) {
        customHeaders = parsed;
      }
    }
  } catch {
    customHeaders = {};
  }
  const allowedHeaderKeys = ['cookie', 'referer'];
  customHeaders = Object.fromEntries(
    Object.entries(customHeaders).filter(([k]) => allowedHeaderKeys.includes(k.toLowerCase()))
  );

  // 动态指纹
  const browser = pickRandom(SUPPORTED_BROWSERS);
  const device = pickRandom(SUPPORTED_DEVICES);
  const os = pickRandom(SUPPORTED_OS);
  const locale = pickRandom(SUPPORTED_LOCALES);
  const httpVersion = pickRandom(SUPPORTED_HTTP_VERSIONS);
  const secChUaModel = pickRandom(SUPPORTED_SEC_CH_UA_MODELS);
  const platform = pickRandom(SUPPORTED_PLATFORMS);
  const screen = pickRandom(SUPPORTED_SCREEN_SIZES);

  const headerGeneratorOptions = {
    browsers: [{ name: browser, minVersion: 110 }],
    devices: [device],
    operatingSystems: [os],
    locales: [locale],
    httpVersion,
    ...(device === 'mobile' ? { secChUaModel: [secChUaModel] } : {}),
    platform,
    acceptLanguage: locale,
    screen: [screen],
  };

  // 支持 socks5/http(s) 代理参数
  let agent = undefined;
  try {
    const proxyType = getParam(req, 'proxyType'); // 'socks' | 'http' | 'https'
    const proxyHost = getParam(req, 'proxyHost');
    const proxyPort = getParam(req, 'proxyPort');
    const proxyUsername = getParam(req, 'proxyUsername');
    const proxyPassword = getParam(req, 'proxyPassword');
    if (proxyType && proxyHost && proxyPort) {
      // got-scraping 支持 http(s)/socks 代理（需安装 'socks-proxy-agent'）
      let proxyUrl = '';
      if (proxyType === 'socks') {
        proxyUrl = `socks5://${proxyUsername ? `${proxyUsername}:${proxyPassword}@` : ''}${proxyHost}:${proxyPort}`;
      } else {
        proxyUrl = `${proxyType}://${proxyUsername ? `${proxyUsername}:${proxyPassword}@` : ''}${proxyHost}:${proxyPort}`;
      }
      // 动态加载 agent（只要用到才 require，兼容服务端/无 agent 时不报错）
      const { default: ProxyAgent } = await import('proxy-agent');
      agent = new ProxyAgent(proxyUrl);
    }
  } catch (e) {
    agent = undefined;
  }

  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: isPlainObject(customHeaders) ? customHeaders : {},
    headerGeneratorOptions,
    timeout: { request: 20000 },
    retry: 0,
    ...(agent ? { agent } : {})
  };

  try {
    const response = await gotScraping(targetUrl, options);
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    [
      'content-disposition',
      'content-length',
      'accept-ranges',
      'cache-control',
      'content-range'
    ].forEach((key) => {
      if (response.headers[key]) res.setHeader(key, response.headers[key]);
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('[PROXY_ERROR]', error);
    res.status(502).json({ error: 'Proxy request failed.', details: error.message });
  }
}

