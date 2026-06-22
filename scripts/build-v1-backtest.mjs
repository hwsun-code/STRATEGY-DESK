import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const snapshotPath = new URL("outputs/data/public-market-snapshot.json", root);
const htmlPath = new URL("outputs/riskdesk.html", root);
const outputPath = new URL("outputs/data/v1-backtest.json", root);
const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const symbols = Object.keys(snapshot.assets);
const dates = snapshot.assets.SPY.daily.map(row => row[0]);
const priceArrays = Object.fromEntries(symbols.map(symbol => {
  const prices = new Map(snapshot.assets[symbol].daily.map(([date, close]) => [date, close]));
  return [symbol, dates.map(date => prices.get(date) ?? null)];
}));

function validReturn(prices, index) {
  const previous = prices[index - 1];
  const current = prices[index];
  return Number.isFinite(previous) && Number.isFinite(current) && previous > 0 ? current / previous - 1 : 0;
}

function annualVol(values) {
  if (values.length < 2) return NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance * 252);
}

function buildSignal(index) {
  const candidates = symbols.map(symbol => {
    const prices = priceArrays[symbol];
    const now = prices[index];
    const skipMonth = prices[index - 21];
    const yearAgo = prices[index - 252];
    if (![now, skipMonth, yearAgo].every(value => Number.isFinite(value) && value > 0)) return null;
    const recentReturns = [];
    for (let cursor = index - 59; cursor <= index; cursor += 1) recentReturns.push(validReturn(prices, cursor));
    const vol = annualVol(recentReturns);
    return { symbol, momentum: skipMonth / yearAgo - 1, vol };
  }).filter(item => item && item.momentum > 0 && Number.isFinite(item.vol) && item.vol > 0)
    .sort((left, right) => right.momentum - left.momentum)
    .slice(0, 3);

  if (!candidates.length) return { weights: {}, selected: [], forecastVol: 0, scale: 0 };
  const inverseVolTotal = candidates.reduce((sum, item) => sum + 1 / item.vol, 0);
  const baseWeights = Object.fromEntries(candidates.map(item => [item.symbol, (1 / item.vol) / inverseVolTotal]));
  const portfolioReturns = [];
  for (let cursor = index - 59; cursor <= index; cursor += 1) {
    portfolioReturns.push(candidates.reduce((sum, item) => sum + baseWeights[item.symbol] * validReturn(priceArrays[item.symbol], cursor), 0));
  }
  const forecastVol = annualVol(portfolioReturns);
  const scale = Number.isFinite(forecastVol) && forecastVol > 0 ? Math.min(2, .10 / forecastVol) : 1;
  return {
    weights: Object.fromEntries(candidates.map(item => [item.symbol, baseWeights[item.symbol] * scale])),
    selected: candidates,
    forecastVol,
    scale
  };
}

function turnover(current, target) {
  const names = new Set([...Object.keys(current), ...Object.keys(target)]);
  return [...names].reduce((sum, symbol) => sum + Math.abs((target[symbol] || 0) - (current[symbol] || 0)), 0);
}

function driftWeights(weights, dailyReturns, portfolioReturn) {
  const denominator = 1 + portfolioReturn;
  return Object.fromEntries(Object.entries(weights).map(([symbol, weight]) => [symbol, weight * (1 + dailyReturns[symbol]) / denominator]));
}

const startIndex = 253;
let nav = 100;
let benchmarkNav = 100;
let equalNav = 100;
let weights = {};
let equalWeights = {};
let totalTurnover = 0;
let totalCost = 0;
const daily = [];
const rebalances = [];
const costRate = .0005;

for (let index = startIndex; index < dates.length; index += 1) {
  const monthChanged = dates[index].slice(0, 7) !== dates[index - 1].slice(0, 7);
  if (monthChanged || index === startIndex) {
    const signal = buildSignal(index - 1);
    const traded = turnover(weights, signal.weights);
    const cost = nav * traded * costRate;
    nav -= cost;
    totalCost += cost;
    totalTurnover += traded;
    weights = signal.weights;

    const available = symbols.filter(symbol => Number.isFinite(priceArrays[symbol][index - 1]) && Number.isFinite(priceArrays[symbol][index]));
    const nextEqual = Object.fromEntries(available.map(symbol => [symbol, 1 / available.length]));
    equalWeights = nextEqual;
    rebalances.push({
      date: dates[index],
      holdings: signal.selected.map(item => ({ symbol: item.symbol, momentum: item.momentum, weight: signal.weights[item.symbol] })),
      forecastVol: signal.forecastVol,
      scale: signal.scale,
      turnover: traded,
      cost
    });
  }

  const assetReturns = Object.fromEntries(symbols.map(symbol => [symbol, validReturn(priceArrays[symbol], index)]));
  const portfolioReturn = Object.entries(weights).reduce((sum, [symbol, weight]) => sum + weight * assetReturns[symbol], 0);
  const equalReturn = Object.entries(equalWeights).reduce((sum, [symbol, weight]) => sum + weight * assetReturns[symbol], 0);
  const spyReturn = assetReturns.SPY;
  nav *= 1 + portfolioReturn;
  equalNav *= 1 + equalReturn;
  benchmarkNav *= 1 + spyReturn;
  weights = driftWeights(weights, assetReturns, portfolioReturn);
  equalWeights = driftWeights(equalWeights, assetReturns, equalReturn);
  daily.push({ date: dates[index], v1: nav, spy: benchmarkNav, equal: equalNav });
}

function monthlySeries(rows) {
  const result = [];
  for (const row of rows) {
    if (!result.length || row.date.slice(0, 7) !== result.at(-1).date.slice(0, 7)) result.push({ ...row });
    else result[result.length - 1] = { ...row };
  }
  const base = result[0];
  return result.map(row => ({
    date: row.date,
    v1: row.v1 / base.v1 * 100,
    spy: row.spy / base.spy * 100,
    equal: row.equal / base.equal * 100
  }));
}

function metrics(rows, key) {
  const values = rows.map(row => row[key]);
  const dailyReturns = values.slice(1).map((value, index) => value / values[index] - 1);
  const years = (new Date(rows.at(-1).date) - new Date(rows[0].date)) / (365.25 * 86400000);
  const cagr = (values.at(-1) / values[0]) ** (1 / years) - 1;
  const vol = annualVol(dailyReturns);
  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  let peak = values[0];
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  const monthly = monthlySeries(rows).map(row => row[key]);
  const monthlyReturns = monthly.slice(1).map((value, index) => value / monthly[index] - 1);
  return {
    cagr,
    volatility: vol,
    sharpe: vol > 0 ? mean * 252 / vol : 0,
    maxDrawdown,
    winRate: monthlyReturns.filter(value => value > 0).length / monthlyReturns.length,
    endingValue: values.at(-1)
  };
}

const years = (new Date(daily.at(-1).date) - new Date(daily[0].date)) / (365.25 * 86400000);
const output = {
  methodology: {
    signal: "12-1 month cross-sectional momentum",
    selection: "Top 3 ETFs with positive momentum",
    weighting: "Inverse 60-day volatility, scaled to 10% annualized target, 2x cap",
    rebalance: "First US trading day of each month using prior-close information",
    transactionCost: costRate,
    survivorshipNote: "Uses the current curated ETF universe; historical delistings are not represented."
  },
  sample: { start: daily[0].date, end: daily.at(-1).date, observations: daily.length },
  metrics: {
    v1: metrics(daily, "v1"),
    spy: metrics(daily, "spy"),
    equal: metrics(daily, "equal"),
    annualTurnover: totalTurnover / years,
    totalCost,
    rebalances: rebalances.length
  },
  monthly: monthlySeries(daily),
  latestRebalance: rebalances.at(-1),
  rebalances
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
let html = await fs.readFile(htmlPath, "utf8");
const start = "<!-- V1_BACKTEST_START -->";
const end = "<!-- V1_BACKTEST_END -->";
const embedded = `${start}\n<script type="application/json" id="v1BacktestData">${JSON.stringify(output).replaceAll("</", "<\\/")}</script>\n${end}`;
const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
html = marker.test(html) ? html.replace(marker, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(htmlPath, html);

console.log(JSON.stringify({ sample: output.sample, metrics: output.metrics, latestRebalance: output.latestRebalance }, null, 2));
