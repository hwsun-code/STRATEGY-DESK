const { runWeeklyAutomation } = require("./_automation-core");
const { ensureV45LedgerRows } = require("./_v45-ledger");

exports.handler = async () => {
  const result = await runWeeklyAutomation({ source: "scheduled-weekly" });
  const v45 = await ensureV45LedgerRows(result.rows || []);
  result.status = { ...result.status, v45AutoLedger: v45, versions: [...new Set([...(result.status?.versions || []), "v45"])] };
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(result.status)
  };
};
