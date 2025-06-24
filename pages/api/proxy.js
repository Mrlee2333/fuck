import { gotScraping } from 'got-scraping';

// 支持的浏览器/设备/系统列表
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];

// 可配置：你允许哪些验证参数名
const VALID_AUTH_KEYS = ['x-proxy-token', 'x-api-key'];

// 验证 支持 header 和 query 方式
function isAuthorized(req) {
  const token =
    req.headers['x-proxy-token'] ||
    req.query.token ||
    req.body?.token;
  return token === process.env.PROXY_AUTH_TOKEN;
}

// 统一获取参数（GET/POST 兼容）
function getParam(req, key, fallback = undefined) {
  if (req.method === 'GET') return req.query[key] ?? fallback;
  if (req.method === 'POST') return req.body?.[key] ?? fallback;
  return fallback;
}

export default async function handler(req, res) {
  // 1. 验证身份
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  // 2. 支持 GET / POST
  const method = req.method === 'POST'
    ? req.body?.method || 'GET'
    : getParam(req, 'method', 'GET');

  const targetUrl = getParam(req, 'url');
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'A valid "url" parameter is required.' });
  }

  // 指纹参数
  const browser = SUPPORTED_BROWSERS.includes(getParam(req, 'browser')) ? getParam(req, 'browser') : 'chrome';
  const device = SUPPORTED_DEVICES.includes(getParam(req, 'device')) ? getParam(req, 'device') : 'desktop';
  const os = SUPPORTED_OS.includes(getParam(req, 'os')) ? getParam(req, 'os') : 'windows';

  // 自定义 header 支持
  let customHeaders = {};
  try {
    const h = getParam(req, 'headers');
    if (h && typeof h === 'object') customHeaders = h;
    else if (typeof h === 'string') customHeaders = JSON.parse(h);
  } catch (e) {
    // 忽略解析错误
  }

  // 请求体
  let requestBody = getParam(req, 'body');
  if (requestBody && typeof requestBody === 'object') {
    requestBody = JSON.stringify(requestBody);
  }

  // gotScraping 选项
  const options = {
    method,
    responseType: 'buffer', // 支持二进制/文本/流媒体
    throwHttpErrors: false,
    headers: customHeaders,
    body: ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) ? requestBody : undefined,
    headerGeneratorOptions: {
      browsers: [{ name: browser, minVersion: 110 }],
      devices: [device],
      operatingSystems: [os],
    },
    timeout: { request: 20000 }, // 20秒超时
    retry: 0, // 不自动重试
  };

  try {
    const response = await gotScraping(targetUrl, options);

    // 透传目标服务器的关键响应头
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    // 仅白名单透传少量头部
    ['content-disposition', 'content-length', 'accept-ranges', 'cache-control'].forEach((key) => {
      if (response.headers[key]) {
        res.setHeader(key, response.headers[key]);
      }
    });

    // 状态码
    res.status(response.statusCode);

    // 响应体
    res.send(response.body);

  } catch (error) {
    res.status(502).json({ error: 'Proxy request failed.', details: error.message });
  }
}

