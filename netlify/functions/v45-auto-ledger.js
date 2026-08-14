const { json } = require("./_riskdesk-common");
const { ensureV45LedgerRows } = require("./_v45-ledger");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const result = await ensureV45LedgerRows([]);
  return json(200, {
    source: "RiskDesk V4.5 automatic ledger repair",
    mode: "automatic per-row V4.5 research/news overlay",
    ...result
  });
};
