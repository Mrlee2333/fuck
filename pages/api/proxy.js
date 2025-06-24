import { gotScraping } from 'got-scraping';

const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'HEAD'];

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
  // CORS 兼容
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,HEAD,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 认证
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  // method 合法性
  const methodRaw = req.method === 'POST'
    ? req.body?.method || 'GET'
    : getParam(req, 'method', 'GET');
  const method = String(methodRaw).toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    return res.status(405).json({ error: 'Invalid method.' });
  }

  // url 校验
  const targetUrl = getParam(req, 'url');
  try {
    if (!targetUrl || !/^https?:\/\/[\w\.-]+/i.test(targetUrl)) throw new Error();
    new URL(targetUrl); // 校验 URL 格式
  } catch {
    return res.status(400).json({ error: 'A valid "url" parameter is required.' });
  }

  // 指纹参数安全
  const browser = SUPPORTED_BROWSERS.includes(getParam(req, 'browser')) ? getParam(req, 'browser') : 'chrome';
  const device = SUPPORTED_DEVICES.includes(getParam(req, 'device')) ? getParam(req, 'device') : 'desktop';
  const os = SUPPORTED_OS.includes(getParam(req, 'os')) ? getParam(req, 'os') : 'windows';

  // headers 类型强校验
  let customHeaders = {};
  try {
    const h = getParam(req, 'headers');
    if (h && typeof h === 'object' && !Array.isArray(h)) customHeaders = h;
    else if (typeof h === 'string') {
      const parsed = JSON.parse(h);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) customHeaders = parsed;
    }
  } catch (e) {
    customHeaders = {};
  }

  // body 类型安全
  let requestBody = getParam(req, 'body');
  if (requestBody && typeof requestBody === 'object') {
    requestBody = JSON.stringify(requestBody);
  }
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    requestBody = undefined;
  }

  // gotScraping 配置
  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: typeof customHeaders === 'object' && customHeaders !== null && !Array.isArray(customHeaders) ? customHeaders : {},
    body: requestBody,
    headerGeneratorOptions: {
      browsers: [{ name: browser, minVersion: 110 }],
      devices: [device],
      operatingSystems: [os],
    },
    timeout: { request: 20000 },
    retry: 0,
  };

  // debug 日志
  // console.log('Proxy options:', { method, targetUrl, headers: options.headers, browser, device, os });

  try {
    const response = await gotScraping(targetUrl, options);

    // 响应头白名单
    const headersToPass = [
      'content-type',
      'content-disposition',
      'content-length',
      'accept-ranges',
      'cache-control',
      'content-range'
    ];
    headersToPass.forEach((key) => {
      if (response.headers[key]) res.setHeader(key, response.headers[key]);
    });

    res.status(response.statusCode);
    if (Buffer.isBuffer(response.body)) {
      res.send(response.body);
    } else if (typeof response.body === 'string') {
      res.send(Buffer.from(response.body));
    } else {
      res.send(''); // 不会报类型错
    }
  } catch (error) {
    res.status(502).json({ error: 'Proxy request failed.', details: error.message });
  }
}

