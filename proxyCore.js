// proxyCore.js
import { pipeline } from 'node:stream/promises';
import { gotScraping } from 'got-scraping';

// --- 指纹参数与辅助函数 ---
const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'];
const SUPPORTED_OS = ['windows', 'macos', 'linux'];
const SUPPORTED_DEVICES = ['desktop', 'mobile'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function proxyCore({ req, res, platform }) {
  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  // --- 1. 从查询参数获取输入 ---
  const query = platform === 'netlify' ? req.queryStringParameters || {} : req.query || {};
  const { url, token: queryToken } = query;

  // --- 2. 认证检查 ---
  const headerToken = req.headers['x-proxy-token'];
  const clientToken = headerToken || queryToken;
  const envToken = process.env.PROXY_AUTH_TOKEN;

  if (envToken && clientToken !== envToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Invalid or missing token.' }));
    return;
  }

  // --- 3. URL 参数校验 ---
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'A valid "url" parameter is required.' }));
    return;
  }

  // --- 4. 仅转发指定的头部信息 ---
  const headersToForward = {};
  if (req.headers.referer) {
    headersToForward.Referer = req.headers.referer;
  }
  if (req.headers.cookie) {
    headersToForward.Cookie = req.headers.cookie;
  }

  // --- 5. 配置并执行请求 ---
  const options = {
    method: 'GET', // 方法硬编码为 GET
    headers: headersToForward,
    throwHttpErrors: false,
    timeout: { request: 60000 }, // 延长超时以支持慢速或大文件
    headerGeneratorOptions: {
      browsers: [{ name: pickRandom(SUPPORTED_BROWSERS), minVersion: 120 }],
      operatingSystems: [pickRandom(SUPPORTED_OS)],
      devices: [pickRandom(SUPPORTED_DEVICES)],
      locales: ['en-US', 'en', 'zh-CN'],
    },
  };

  try {
    const proxyRequestStream = gotScraping.stream(url, options);

    // 监听 'response' 事件以转发响应头
    proxyRequestStream.on('response', (response) => {
      // 转发对媒体播放至关重要的头部信息
      const passHeaders = {
        'Content-Type': response.headers['content-type'] || 'application/octet-stream',
        'Content-Length': response.headers['content-length'],
        'Accept-Ranges': response.headers['accept-ranges'],
        'Content-Range': response.headers['content-range'],
        'Cache-Control': 'public, max-age=604800', // 可选：增加缓存策略
      };
      
      // 清理掉 undefined 的 key
      Object.keys(passHeaders).forEach(key => passHeaders[key] === undefined && delete passHeaders[key]);

      res.writeHead(response.statusCode, passHeaders);
    });

    // 使用 pipeline 将目标服务器的响应流安全地传输到客户端
    await pipeline(proxyRequestStream, res);

  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Proxy request failed', details: error.message }));
  }
}
