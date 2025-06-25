import { proxyCore } from "../../proxyCore.js";
export const handler = async (req, res) => {
  await proxyCore({ req, res });
};
