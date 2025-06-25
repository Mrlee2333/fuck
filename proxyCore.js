// proxyCore.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core'; // 直接使用 puppeteer-core

export async function proxyCore({ req, res, platform }) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const query = req.query || {};
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
    console.log('Launching browser with @sparticuz/chromium...');
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    console.log('Browser launched successfully.');

    const page = await browser.newPage();
    
    // 转发 Referer 和 Cookie
    const headersToForward = {};
    if (req.headers.referer) {
      headersToForward.Referer = req.headers.referer;
    }
    if (req.headers.cookie) {
      await page.setExtraHTTPHeaders({ Cookie: req.headers.cookie });
    }
    
    console.log(`Navigating to: ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
      headers: headersToForward,
    });
    console.log(`Navigation successful. Status: ${response.status()}`);

    const status = response.status();
    const headers = response.headers();
    const body = await response.buffer();

    const passHeaders = {
      'Content-Type': headers['content-type'] || 'application/octet-stream',
      'Content-Length': body.length.toString(),
    };
    
    res.writeHead(status, passHeaders);
    res.end(body);

  } catch (error) {
    console.error('Puppeteer core error:', error);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Proxy request failed at core level.', details: error.message }));
  } finally {
    if (browser !== null) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
}
