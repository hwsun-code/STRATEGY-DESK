const { json, embeddedJson } = require("./_riskdesk-common");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const v35 = embeddedJson("allStrategyBacktests") || {};
  const v4 = embeddedJson("v4HistoricalBacktests") || {};
  const metric = (item, key) => item?.metrics?.[key] ?? item?.fullSample?.[key] ?? null;
  const latestDate = item => item?.daily?.at?.(-1)?.date || item?.monthly?.at?.(-1)?.date || item?.sample?.end || null;
  const formatModels = block => [...(block.coreModels || []), ...(block.strategies || []), ...(block.benchmarks || [])]
    .map(item => ({
      name: item.name,
      group: item.group || null,
      cagr: metric(item, "cagr"),
      volatility: metric(item, "volatility"),
      sharpe: metric(item, "sharpe"),
      maxDrawdown: metric(item, "maxDrawdown"),
      annualTurnover: metric(item, "annualTurnover"),
      latestDate: latestDate(item)
    }));
  const v35Models = formatModels(v35);
  const v4Models = formatModels(v4);
  return json(200, {
    source: "Embedded historical walk-forward backtest snapshots",
    automation: {
      historicalBacktest: "embedded snapshot; refreshed when the site/data build is redeployed",
      dailyPredictionFeedback: "automated via Netlify scheduled function and validated against actual prices",
      note: "Version 4 daily prediction feedback is automated. Version 4 historical backtest is present for all 15 strategies, but full historical recomputation is not yet an independent scheduled retraining job."
    },
    versions: {
      v35: {
        label: "Version 3.5 Baseline",
        generatedAt: v35.generatedAt,
        assumptions: v35.assumptions || {},
        count: v35Models.length,
        models: v35Models
      },
      v4: {
        label: "Version 4 Market-Adaptive",
        generatedAt: v4.generatedAt,
        assumptions: v4.assumptions || {},
        count: v4Models.length,
        models: v4Models
      }
    }
  });
};
