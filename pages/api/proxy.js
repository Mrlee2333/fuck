// pages/api/proxy.js
import { proxyCore } from "../../proxyCore.js";
export default async function handler(req, res) {
  await proxyCore({ req, res });
}
