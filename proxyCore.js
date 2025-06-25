// proxyCore.js

import chromium from '@sparticuz/chromium';
// 【修复】直接导入 puppeteer-core
import puppeteer from 'puppeteer-core';

// 不再需要 'puppeteer-extra' 和 'StealthPlugin'

export async function proxyCore({ req, res, platform }) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const query = platform === 'netlify' ? req.queryStringParameters || {} : req.query || {};
  const { url, token: queryToken } = query;

  const clientToken = req.headers['x-proxy-token'] || queryToken;
  const envToken = process.env.PROXY_AUTH_TOKEN;
  if (envToken && clientToken !== envToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized.' }));
    return;
  }

  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'A valid "url" parameter is required.' }));
    return;
  }

  let browser = null;
  try {
    // 【修复】直接使用 puppeteer.launch，不再有 .use(StealthPlugin())
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // 转发 Referer 和 Cookie
    const headersToForward = {};
    if (req.headers.referer) {
      headersToForward.Referer = req.headers.referer;
    }
    if (req.headers.cookie) {
      await page.setExtraHTTPHeaders({ Cookie: req.headers.cookie });
    }
    
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
      headers: headersToForward,
    });

    const status = response.status();
    const headers = response.headers();
    const body = await response.buffer();

    const passHeaders = {
      'Content-Type': headers['content-type'] || 'application/octet-stream',
      'Content-Length': body.length.toString(),
      'Cache-Control': headers['cache-control'] || 'public, max-age=604800',
    };
    ['content-disposition', 'accept-ranges', 'content-range'].forEach(h => {
        if (headers[h]) passHeaders[h] = headers[h];
    });

    res.writeHead(status, passHeaders);
    res.end(body);

  } catch (error) {
    console.error('Puppeteer error:', error);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Proxy request failed.', details: error.message }));
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}
