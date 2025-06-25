// proxyCore.js

// 【修复】导入新的 @sparticuz/chromium 包
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

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
    browser = await puppeteer.launch({
      // 【修复】使用新的 chromium 包提供的参数和路径
      args: chromium.args,
      executablePath: await chromium.executablePath(), // 注意这里是函数调用
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
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
    res.end(JSON.stringify({ error: 'Proxy request failed with modern module.', details: error.message }));
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}
