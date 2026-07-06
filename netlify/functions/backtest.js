const { json, embeddedJson } = require("./_riskdesk-common");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const all = embeddedJson("allStrategyBacktests") || {};
  const models = [...(all.coreModels || []), ...(all.strategies || []), ...(all.benchmarks || [])];
  return json(200, {
    source: "Embedded weekly backtest snapshot",
    generatedAt: all.generatedAt,
    assumptions: all.assumptions || {},
    count: models.length,
    models: models.map(item => ({
      name: item.name,
      cagr: item.cagr,
      sharpe: item.sharpe,
      maxDrawdown: item.maxDrawdown,
      latestDate: item.daily?.[item.daily.length - 1]?.date || item.monthly?.[item.monthly.length - 1]?.date || null
    }))
  });
};
