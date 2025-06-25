// proxyCore.js

import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { getExecutablePath } from '@puppeteer/browsers';

// 这些常量必须与你的下载脚本 (scripts/download-chrome.js) 中的信息保持一致
const CHROME_BUILD_ID = '1135525';
const CACHE_DIR = path.join(process.cwd(), '.local-chromium');

export async function proxyCore({ req, res }) {
  // 预检请求处理
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  // --- 1. 获取参数和认证 ---
  // Vercel 环境下，req.query 已经包含了所有查询参数
  const query = req.query || {};
  const { url, token: queryToken } = query;

  const clientToken = req.headers['x-proxy-token'] || queryToken;
  const envToken = process.env.PROXY_AUTH_TOKEN;

  if (envToken && clientToken !== envToken) {
    res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
    return;
  }

  if (!url) {
    res.status(400).json({ error: 'A valid "url" parameter is required.' });
    return;
  }

  let browser = null;
  try {
    // --- 2. 获取我们自己下载的浏览器的路径 ---
    const executablePath = getExecutablePath({
      browser: 'chrome',
      buildId: CHROME_BUILD_ID,
      cacheDir: CACHE_DIR,
      // 注意：这里我们省略 platform，让它在服务器环境 (Linux) 和本地环境 (Mac/Windows) 都能自动适配
    });
    
    console.log(`[proxyCore] Launching browser from: ${executablePath}`);

    // --- 3. 启动浏览器 ---
    browser = await puppeteer.launch({
      executablePath,
      // 在 Serverless 环境中推荐使用的安全参数
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });
    console.log('[proxyCore] Browser launched successfully.');

    const page = await browser.newPage();
    
    // 转发客户端的 Referer 和 Cookie
    const headersToForward = {};
    if (req.headers.referer) {
      headersToForward.Referer = req.headers.referer;
    }
    if (req.headers.cookie) {
      // puppeteer 通过 setExtraHTTPHeaders 设置发送的 cookie
      await page.setExtraHTTPHeaders({ Cookie: req.headers.cookie });
    }
    
    console.log(`[proxyCore] Navigating to: ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
      headers: headersToForward,
    });
    console.log(`[proxyCore] Navigation successful. Status: ${response.status()}`);

    // --- 4. 处理和转发响应 ---
    const status = response.status();
    const headers = response.headers();
    const body = await response.buffer(); // 获取响应体 Buffer

    // 清理并设置要传回头部的响应头
    const passHeaders = {
      'Content-Type': headers['content-type'] || 'application/octet-stream',
      'Content-Length': body.length.toString(),
      'Cache-Control': headers['cache-control'] || 'public, max-age=604800',
    };
    // 转发对视频播放、文件下载等有用的头部
    ['content-disposition', 'accept-ranges', 'content-range'].forEach(h => {
        if (headers[h]) passHeaders[h] = headers[h];
    });

    res.writeHead(status, passHeaders);
    res.end(body);

  } catch (error) {
    console.error('[proxyCore] Puppeteer error:', error);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed at core level.', details: error.message });
    } else {
      res.end();
    }
  } finally {
    if (browser !== null) {
      await browser.close();
      console.log('[proxyCore] Browser closed.');
    }
  }
}
