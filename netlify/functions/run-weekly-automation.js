const { json } = require("./_riskdesk-common");
const { runWeeklyAutomation } = require("./_automation-core");
const { ensureV45LedgerRows } = require("./_v45-ledger");

const { connectLambda } = require("@netlify/blobs");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  connectLambda(event);
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }
  const result = await runWeeklyAutomation({ source: "manual-api" });
  const v45 = await ensureV45LedgerRows(result.rows || []);
  result.status = { ...result.status, v45AutoLedger: v45, versions: [...new Set([...(result.status?.versions || []), "v45"])] };
  return json(200, result);
};
