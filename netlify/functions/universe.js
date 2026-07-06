const { json, embeddedJson } = require("./_riskdesk-common");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const snapshot = embeddedJson("publicMarketSnapshot");
  const universe = snapshot?.universe || {};
  return json(200, {
    universe: "riskdesk_us_equity_universe",
    label: universe.primary || "US individual stocks",
    source: snapshot?.source || "Embedded public market snapshot",
    generatedAt: snapshot?.generatedAt,
    count: (universe.stockSymbols || []).length,
    symbols: universe.stockSymbols || [],
    riskFactors: universe.riskFactorSymbols || [],
    note: universe.note || ""
  });
};
