import { pipeline } from 'node:stream/promises';
import { gotScraping } from 'got-scraping';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = req.query.url;
  if (!url || !url.startsWith('http')) return res.status(400).end('Invalid url');

  try {
    const proxyRequestStream = gotScraping.stream({ url });

    proxyRequestStream.on('response', (response) => {
      res.statusCode = response.statusCode;
      for (const [key, value] of Object.entries(response.headers)) {
        if (['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) continue;
        if (Array.isArray(value)) res.setHeader(key, value.join(', '));
        else if (typeof value === 'string') res.setHeader(key, value);
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-proxy-token');
    });

    await pipeline(proxyRequestStream, res);

  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed.', details: error.message });
    }
  }
}

