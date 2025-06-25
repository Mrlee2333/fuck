// pages/api/proxy.js

import { gotScraping } from 'got-scraping';

// 支持的浏览器/设备/系统白名单
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];
const SUPPORTED_OS = ['windows', 'macos', 'linux', 'android', 'ios'];

// 随机取一个工具函数
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isPlainObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

// token 校验
function isAuthorized(req) {
  const token =
    req.headers['x-proxy-token'] ||
    req.query.token ||
    req.body?.token;
  return token === process.env.PROXY_AUTH_TOKEN;
}

// 兼容 GET/POST 获取参数
function getParam(req, key, fallback = undefined) {
  if (req.method === 'GET') return req.query[key] ?? fallback;
  if (req.method === 'POST') return req.body?.[key] ?? fallback;
  return fallback;
}

export default async function handler(req, res) {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // 1. 身份认证
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  // 2. 获取参数
  const isPost = req.method === 'POST';
  const src = isPost ? req.body : req.query;
  const method = (isPost ? req.body?.method : req.query.method || 'GET').toUpperCase();
  const targetUrl = getParam(req, 'url');
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'A valid "url" parameter is required.' });
  }

  // 3. 解析前端自定义 headers（只允许 cookie、referer）
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
  // 只保留 cookie 和 referer（其他一律不透传）
  const allowedHeaderKeys = ['cookie', 'referer'];
  customHeaders = Object.fromEntries(
    Object.entries(customHeaders).filter(([k]) => allowedHeaderKeys.includes(k.toLowerCase()))
  );

  // 4. 指纹伪装：自动随机 browser/device/os
  const browser = pickRandom(SUPPORTED_BROWSERS);
  const device = pickRandom(SUPPORTED_DEVICES);
  const os = pickRandom(SUPPORTED_OS);

  // 保证 headerGeneratorOptions 全是正确类型
  const headerGeneratorOptions = {
    browsers: [{ name: browser, minVersion: 110 }],
    devices: [device],
    operatingSystems: [os],
  };

  // 5. 构建 gotScraping 配置，类型全安全
  const options = {
    method,
    responseType: 'buffer',
    throwHttpErrors: false,
    headers: isPlainObject(customHeaders) ? customHeaders : {},
    headerGeneratorOptions,
    timeout: { request: 20000 },
    retry: 0,
  };

  // 防呆日志，调试可打开
  // console.log('Proxy options', options);

  // 6. 发起请求
  try {
    const response = await gotScraping(targetUrl, options);

    // 7. 响应头安全透传
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
    // 8. 错误捕获
    console.error('[PROXY_ERROR]', error);
    res.status(502).json({ error: 'Proxy request failed.', details: error.message });
  }
}

