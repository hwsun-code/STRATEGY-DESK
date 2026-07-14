import fs from "node:fs/promises";

const repoRoot = new URL(`file:///${(process.env.RISKDESK_REPO || `${process.env.USERPROFILE}/Documents/GitHub/STRATEGY-DESK`).replaceAll("\\", "/").replace(/\/?$/, "/")}`);
const cacheRoot = new URL(`file:///${(process.env.RISKDESK_MARKET_CACHE || "D:/RiskDesk_Research/market-data").replaceAll("\\", "/").replace(/\/?$/, "/")}`);
const snapshot = JSON.parse(await fs.readFile(new URL("public-market-snapshot-full.json", cacheRoot), "utf8"));
const base = JSON.parse(await fs.readFile(new URL("outputs/data/all-strategy-backtests.json", repoRoot), "utf8"));

const stockSymbols = snapshot.universe.stockSymbols || [];
const factorSymbols = new Set(snapshot.universe.riskFactorSymbols || []);
const aiSymbols = new Set(["NVDA", "AVGO", "AMD", "MSFT", "AAPL", "AMZN", "GOOG", "META", "CRM", "NFLX", "ASML", "SAP", "6758.T", "8035.T"]);
const histories = Object.fromEntries(Object.entries(snapshot.assets || {}).map(([symbol, asset]) => {
  const rows = (asset.daily || []).filter(row => row[0] && Number.isFinite(Number(row[1])));
  return [symbol, {
    dates: rows.map(row => row[0]),
    prices: rows.map(row => Number(row[1])),
    indexCache: new Map()
  }];
}));

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function std(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function indexAt(symbol, date) {
  const history = histories[symbol];
  if (!history) return -1;
  if (history.indexCache.has(date)) return history.indexCache.get(date);
  const dates = history.dates;
  let low = 0;
  let high = dates.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (dates[mid] <= date) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  history.indexCache.set(date, answer);
  return answer;
}
function priceAt(symbol, date) {
  const history = histories[symbol];
  const index = indexAt(symbol, date);
  return history && index >= 0 ? history.prices[index] : NaN;
}
function momentumAt(symbol, date, days) {
  const history = histories[symbol];
  const index = indexAt(symbol, date);
  if (!history || index < days) return NaN;
  return history.prices[index] / history.prices[index - days] - 1;
}
function volAt(symbol, date, days) {
  const history = histories[symbol];
  const index = indexAt(symbol, date);
  if (!history || index < days + 1) return NaN;
  const prices = history.prices.slice(index - days, index + 1);
  return std(prices.slice(1).map((price, index) => price / prices[index] - 1)) * Math.sqrt(252);
}
function maGapAt(symbol, date, days) {
  const history = histories[symbol];
  const index = indexAt(symbol, date);
  if (!history || index < days - 1) return NaN;
  const prices = history.prices.slice(index - days + 1, index + 1);
  return prices.at(-1) / average(prices) - 1;
}
function zScoreAt(symbol, date, days) {
  const history = histories[symbol];
  const index = indexAt(symbol, date);
  if (!history || index < days - 1) return 0;
  const prices = history.prices.slice(index - days + 1, index + 1);
  const s = std(prices);
  return s ? (prices.at(-1) - average(prices)) / s : 0;
}
function returnBetween(symbol, start, end) {
  const first = priceAt(symbol, start);
  const last = priceAt(symbol, end);
  return Number.isFinite(first) && first > 0 && Number.isFinite(last) ? last / first - 1 : 0;
}
function regimeAt(date) {
  const spyTrend = momentumAt("SPY", date, 126);
  const spyVol = volAt("SPY", date, 20);
  const credit = momentumAt("HYG", date, 63) - momentumAt("IEF", date, 63);
  const rates = momentumAt("TLT", date, 63);
  if (![spyTrend, spyVol, credit, rates].every(Number.isFinite)) return 0;
  return .55 * Math.sign(spyTrend) + .25 * Math.sign(credit) + .10 * Math.sign(rates) - Math.max(0, spyVol - .22) * 2.2;
}
function scoreSymbol(symbol, date, modelName, regime) {
  const mom1 = momentumAt(symbol, date, 21);
  const mom3 = momentumAt(symbol, date, 63);
  const mom6 = momentumAt(symbol, date, 126);
  const history = histories[symbol];
  const priceIndex = indexAt(symbol, date);
  const mom12 = history && priceIndex >= 253 ? history.prices[priceIndex - 22] / history.prices[priceIndex - 253] - 1 : NaN;
  const vol60 = volAt(symbol, date, 60);
  const vol20 = volAt(symbol, date, 20);
  const ma200 = maGapAt(symbol, date, 200);
  const z20 = zScoreAt(symbol, date, 20);
  if (![mom3, mom6, mom12, vol60, ma200].every(Number.isFinite)) return null;
  let score = .34 * mom6 + .26 * mom12 + .20 * mom3 + .12 * ma200 - .18 * vol60;
  if (modelName.includes("capex")) score += aiSymbols.has(symbol) ? .12 : 0;
  if (modelName.includes("quality growth")) score += .18 * (ma200 > 0 ? 1 : -1) - .16 * vol60;
  if (modelName.includes("crowding")) score += .18 * mom12 - .45 * Math.max(0, mom1 || 0) - .25 * Math.max(0, (vol20 || 0) - .25);
  if (modelName.includes("low-vol")) score += .22 * mom6 - .55 * vol60;
  if (modelName.includes("regime-switch")) score *= regime > 0 ? 1.08 : .58;
  if (modelName.includes("credit-liquidity")) score *= regime > .05 ? 1.12 : .62;
  if (modelName.includes("revision")) score += .25 * mom3 + .12 * (mom1 || 0);
  if (modelName.includes("reversion")) score = ma200 > 0 ? -.55 * z20 + .18 * mom6 - .12 * (vol20 || 0) : -.2;
  if (modelName.includes("sector-breadth")) score += .10 * regime + .08 * (aiSymbols.has(symbol) ? 1 : 0);
  if (modelName.includes("defensive")) score = .28 * mom6 + .22 * ma200 - .45 * vol60 + (regime < 0 ? .08 : 0);
  if (modelName.includes("tail-risk")) score = (.30 * mom6 + .25 * mom12 - .35 * vol60) * (regime < 0 ? .55 : .9);
  if (modelName.includes("adaptive volatility")) score += regime > 0 ? .12 * mom6 : -.25 * vol60;
  if (modelName.includes("hmm") || modelName.includes("mvo")) score += .08 * regime - .22 * vol60;
  if (modelName.includes("boosted")) score += .16 * (mom1 || 0) + .14 * mom3 + .10 * ma200 - .10 * Math.max(0, z20);
  return { symbol, score, vol: Math.max(.08, vol60), regime };
}
function targetWeights(modelName, date, previousWeights = {}) {
  const regime = regimeAt(date);
  const scored = stockSymbols
    .map(symbol => scoreSymbol(symbol, date, modelName, regime))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const selected = scored.filter(item => item.score > 0).slice(0, 25);
  const picks = selected.length >= 12 ? selected : scored.slice(0, 25);
  const riskScale = regime < -.35 ? .48 : regime < 0 ? .64 : .78;
  const invVol = picks.map(item => [item.symbol, 1 / item.vol]);
  const invSum = invVol.reduce((sum, [, value]) => sum + value, 0) || 1;
  const weights = {};
  invVol.forEach(([symbol, value]) => {
    weights[symbol] = Math.min(.06, riskScale * value / invSum);
  });
  const stockTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const hedgeBudget = Math.max(0, Math.min(.35, 1 - stockTotal));
  if (hedgeBudget > .02) {
    if (factorSymbols.has("IEF")) weights.IEF = hedgeBudget * (regime < 0 ? .42 : .28);
    if (factorSymbols.has("GLD")) weights.GLD = hedgeBudget * .24;
    if (factorSymbols.has("TLT")) weights.TLT = hedgeBudget * (regime < 0 ? .24 : .14);
  }
  const turnover = Array.from(new Set([...Object.keys(previousWeights), ...Object.keys(weights)]))
    .reduce((sum, symbol) => sum + Math.abs((weights[symbol] || 0) - (previousWeights[symbol] || 0)), 0);
  return { weights, turnover, diagnostics: { regime, selected: picks.map(item => item.symbol).join(", ") } };
}
function metricsFromMonthly(monthly, rebalances) {
  const returns = monthly.slice(1).map((row, index) => row.nav / monthly[index].nav - 1);
  const annualizedMean = average(returns) * 12;
  const volatility = std(returns) * Math.sqrt(12);
  const cagr = Math.pow(monthly.at(-1).nav / monthly[0].nav, 12 / Math.max(1, returns.length)) - 1;
  let peak = monthly[0].nav;
  let maxDrawdown = 0;
  monthly.forEach(row => {
    peak = Math.max(peak, row.nav);
    maxDrawdown = Math.min(maxDrawdown, row.nav / peak - 1);
  });
  return {
    cagr,
    volatility,
    sharpe: volatility ? annualizedMean / volatility : 0,
    maxDrawdown,
    winRate: returns.filter(value => value > 0).length / Math.max(1, returns.length),
    endingValue: monthly.at(-1).nav,
    annualTurnover: average(rebalances.map(row => row.turnover)) * 12,
    totalCost: rebalances.reduce((sum, row) => sum + row.turnover * .0005, 0)
  };
}
function buildV4Model(model) {
  const modelName = String(model.name || "").toLowerCase();
  const sourceDates = (model.monthly || []).map(row => row.date);
  const dates = sourceDates.length > 2 ? sourceDates : (base.coreModels?.[0]?.monthly || []).map(row => row.date);
  const monthly = [{ date: dates[0], nav: 100 }];
  const rebalances = [];
  let nav = 100;
  let previousWeights = {};
  for (let index = 0; index < dates.length - 1; index += 1) {
    const date = dates[index];
    const nextDate = dates[index + 1];
    const rebalance = targetWeights(modelName, date, previousWeights);
    rebalances.push({ date, weights: rebalance.weights, turnover: rebalance.turnover, diagnostics: rebalance.diagnostics });
    const grossReturn = Object.entries(rebalance.weights).reduce((sum, [symbol, weight]) => sum + weight * returnBetween(symbol, date, nextDate), 0);
    nav *= 1 + grossReturn - rebalance.turnover * .0005;
    monthly.push({ date: nextDate, nav });
    previousWeights = rebalance.weights;
  }
  const metrics = metricsFromMonthly(monthly, rebalances);
  return {
    ...model,
    __riskdeskVersion: "v4",
    group: `${model.group || "Research"} / Version 4 Global 500`,
    note: "Version 4 Global 500 market-adaptive walk-forward engine using only prior price, volatility, trend, credit and factor data.",
    monthly,
    rebalances,
    latestRebalance: rebalances.at(-1),
    sample: { start: monthly[0].date, end: monthly.at(-1).date },
    fullSample: metrics,
    metrics
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  version: "4",
  versionLabel: "Version 4 Market-Adaptive Global 500",
  assumptions: {
    data: "RiskDesk Global 500 liquid equity universe; 500 stocks plus ETF risk-factor overlays; full historical cache stored outside GitHub.",
    rebalance: "Monthly walk-forward V4 signal using only prior close information.",
    transactionCost: .0005,
    universe: snapshot.universe
  },
  coreModels: (base.coreModels || []).map(buildV4Model),
  strategies: (base.strategies || []).map(buildV4Model),
  benchmarks: base.benchmarks || [],
  strategyCorrelation: base.strategyCorrelation || []
};

await fs.writeFile(new URL("data/v4-historical-backtests.json", repoRoot), JSON.stringify(output, null, 2));

const start = "<!-- V4_HISTORICAL_BACKTESTS_START -->";
const end = "<!-- V4_HISTORICAL_BACKTESTS_END -->";
const embedded = `${start}\n<script type="application/json" id="v4HistoricalBacktests">${JSON.stringify(output).replaceAll("</", "<\\/")}</script>\n${end}`;
const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
for (const name of ["index.html", "riskdesk.html"]) {
  const htmlPath = new URL(name, repoRoot);
  let html = await fs.readFile(htmlPath, "utf8");
  html = marker.test(html) ? html.replace(marker, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
  await fs.writeFile(htmlPath, html);
}

const summary = [...output.coreModels, ...output.strategies].map(item => ({ name: item.name, sharpe: item.metrics.sharpe, cagr: item.metrics.cagr, maxDrawdown: item.metrics.maxDrawdown }));
console.log(JSON.stringify({ count: summary.length, top: summary.sort((a, b) => b.sharpe - a.sharpe).slice(0, 5) }, null, 2));
