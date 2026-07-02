import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../outputs/riskdesk.html", import.meta.url), "utf8");
const main = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!main) throw new Error("Main script not found");
new Function(main);

function embedded(id) {
  const match = html.match(new RegExp(`id="${id}">([\\s\\S]*?)<\\/script>`));
  if (!match) throw new Error(`${id} not found`);
  return JSON.parse(match[1]);
}

const all = embedded("allStrategyBacktests");
const snapshot = embedded("publicMarketSnapshot");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
const requiredIds = ["coreBacktestRows", "v1BacktestChart", "correlationHeatmap", "strategyRows", "approvalRows", "trainingParameterRows", "strategyCompareSvgHost", "allocationStrategySelect", "allocationRows", "liveMonitorRows", "experimentRows", "factorAttributionBars", "riskContribution"];
const missingIds = requiredIds.filter(id => !ids.includes(id));
const commonLengths = all.coreModels.map(model => model.monthly.length);
const finiteMetrics = [...all.coreModels, ...all.strategies, ...all.benchmarks].every(item => Object.values(item.metrics).every(Number.isFinite));

const checks = {
  javascript: "valid",
  assetHistories: Object.keys(snapshot.assets).length,
  stockHistories: (snapshot.universe?.stockSymbols || []).filter(symbol => snapshot.assets[symbol]).length,
  coreModels: all.coreModels.length,
  strategies: all.strategies.length,
  benchmarks: all.benchmarks.length,
  correlationShape: `${all.strategyCorrelation.length}x${all.strategyCorrelation[0]?.length || 0}`,
  coreMonthlyLengths: commonLengths,
  finiteMetrics,
  duplicateIds,
  missingIds,
};
console.log(JSON.stringify(checks, null, 2));
if (((snapshot.universe?.stockSymbols || []).filter(symbol => snapshot.assets[symbol]).length < 20) || all.coreModels.length !== 3 || all.strategies.length !== 12 || all.benchmarks.length !== 3 || all.strategyCorrelation.length !== 15 || all.strategyCorrelation.some(row => row.length !== 15) || !finiteMetrics || duplicateIds.length || missingIds.length || new Set(commonLengths).size !== 1) process.exit(1);
