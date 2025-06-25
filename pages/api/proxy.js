import { proxyCore } from '../../proxyCore.js';

export default async function handler(req, res) {
  // CORS 直接在 proxyCore 内已自动处理
  await proxyCore({ req, res });
}

