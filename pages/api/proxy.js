// /pages/api/proxy.js

import { proxyCore } from '../../proxyCore.js';
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  await proxyCore({ req, res, platform: 'vercel' });
}
