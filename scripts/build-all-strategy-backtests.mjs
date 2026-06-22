import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const snapshot = JSON.parse(await fs.readFile(new URL("outputs/data/public-market-snapshot.json", root), "utf8"));
const symbols = Object.keys(snapshot.assets);
const dates = snapshot.assets.SPY.daily.map(row => row[0]);
const prices = Object.fromEntries(symbols.map(symbol => {
  const map = new Map(snapshot.assets[symbol].daily.map(([date, close]) => [date, close]));
  return [symbol, dates.map(date => map.get(date) ?? null)];
}));
const returns = Object.fromEntries(symbols.map(symbol => [symbol, prices[symbol].map((value, index, list) => index && value && list[index - 1] ? value / list[index - 1] - 1 : 0)]));
const costRate = .0005;

const equity = ["SPY", "QQQ", "IWM", "EFA", "EEM", "EWJ", "EWZ", "VNQ", "IGF", "MTUM", "QUAL", "USMV", "VTV", "XLK", "XLF", "XLV", "XLE"];
const diversified = ["SPY", "IWM", "EFA", "EEM", "IEF", "TLT", "LQD", "HYG", "GLD", "DBC", "VNQ", "IGF"];
const sectors = ["XLK", "XLF", "XLV", "XLE"];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function variance(values) { const avg = mean(values); return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length - 1); }
function annualVol(symbol, index, window = 60) { return Math.sqrt(variance(returns[symbol].slice(index - window + 1, index + 1)) * 252); }
function momentum(symbol, index, days, skip = 0) {
  const current = prices[symbol][index - skip];
  const prior = prices[symbol][index - days];
  return current && prior ? current / prior - 1 : NaN;
}
function movingAverage(symbol, index, window) { const values = prices[symbol].slice(index - window + 1, index + 1).filter(Number.isFinite); return values.length ? mean(values) : NaN; }
function drawdown(symbol, index, window = 126) { const values = prices[symbol].slice(index - window + 1, index + 1).filter(Number.isFinite); return values.length ? values.at(-1) / Math.max(...values) - 1 : NaN; }
function zScore(symbol, index, window = 20) { const values = prices[symbol].slice(index - window + 1, index + 1).filter(Number.isFinite); const avg = mean(values); const sd = Math.sqrt(variance(values)); return sd ? (values.at(-1) - avg) / sd : 0; }
function normalize(raw, gross = 1) { const total = Object.values(raw).reduce((sum, value) => sum + Math.max(0, value), 0); return total ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.max(0, value) / total * gross])) : {}; }
function inverseVolWeights(names, index, gross = 1) { return normalize(Object.fromEntries(names.map(symbol => [symbol, 1 / Math.max(.01, annualVol(symbol, index))])), gross); }
function weightedVol(target, index, window = 60) {
  const values = [];
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) values.push(Object.entries(target).reduce((sum, [symbol, weight]) => sum + weight * returns[symbol][cursor], 0));
  return Math.sqrt(variance(values) * 252);
}
function targetVolWeights(target, index, targetAnnual = .10, maxGross = 2) { const vol = weightedVol(target, index); const scale = vol > 0 ? Math.min(maxGross, targetAnnual / vol) : 1; return Object.fromEntries(Object.entries(target).map(([symbol, weight]) => [symbol, weight * scale])); }
function topBy(names, score, count, positive = true) { return names.map(symbol => ({ symbol, score: score(symbol) })).filter(item => Number.isFinite(item.score) && (!positive || item.score > 0)).sort((a, b) => b.score - a.score).slice(0, count); }
function turnover(current, target) { return [...new Set([...Object.keys(current), ...Object.keys(target)])].reduce((sum, symbol) => sum + Math.abs((target[symbol] || 0) - (current[symbol] || 0)), 0); }
function drift(weights, index, portfolioReturn) { return Object.fromEntries(Object.entries(weights).map(([symbol, weight]) => [symbol, weight * (1 + returns[symbol][index]) / (1 + portfolioReturn)])); }

function metrics(rows) {
  const values = rows.map(row => row.nav);
  const dailyReturns = values.slice(1).map((value, index) => value / values[index] - 1);
  const years = (new Date(rows.at(-1).date) - new Date(rows[0].date)) / (365.25 * 86400000);
  const cagr = (values.at(-1) / values[0]) ** (1 / years) - 1;
  const vol = Math.sqrt(variance(dailyReturns) * 252);
  let peak = values[0], maxDrawdown = 0;
  values.forEach(value => { peak = Math.max(peak, value); maxDrawdown = Math.min(maxDrawdown, value / peak - 1); });
  const monthly = toMonthly(rows);
  const monthReturns = monthly.slice(1).map((row, index) => row.nav / monthly[index].nav - 1);
  return { cagr, volatility: vol, sharpe: vol ? mean(dailyReturns) * 252 / vol : 0, maxDrawdown, winRate: monthReturns.filter(value => value > 0).length / monthReturns.length, endingValue: values.at(-1) };
}
function toMonthly(rows) { const result = []; rows.forEach(row => { if (!result.length || row.date.slice(0, 7) !== result.at(-1).date.slice(0, 7)) result.push({ ...row }); else result[result.length - 1] = { ...row }; }); const base = result[0].nav; return result.map(row => ({ date: row.date, nav: row.nav / base * 100 })); }

function runStrategy(name, signal, { startIndex = 756, cost = costRate, note = "Price-based rule", group = "Rule" } = {}) {
  let nav = 100, weights = {}, totalTurnover = 0, totalCost = 0;
  const daily = [], rebalances = [];
  for (let index = startIndex; index < dates.length; index += 1) {
    if (index === startIndex || dates[index].slice(0, 7) !== dates[index - 1].slice(0, 7)) {
      const result = signal(index - 1) || {};
      const target = result.weights || result;
      const traded = turnover(weights, target);
      const fee = nav * traded * cost;
      nav -= fee; totalCost += fee; totalTurnover += traded; weights = target;
      rebalances.push({ date: dates[index], weights: { ...target }, turnover: traded, diagnostics: result.diagnostics || {} });
    }
    const dayReturn = Object.entries(weights).reduce((sum, [symbol, weight]) => sum + weight * returns[symbol][index], 0);
    nav *= 1 + dayReturn;
    weights = drift(weights, index, dayReturn);
    daily.push({ date: dates[index], nav });
  }
  const years = (new Date(daily.at(-1).date) - new Date(daily[0].date)) / (365.25 * 86400000);
  return { name, group, note, sample: { start: daily[0].date, end: daily.at(-1).date }, metrics: { ...metrics(daily), annualTurnover: totalTurnover / years, totalCost }, monthly: toMonthly(daily), latestRebalance: rebalances.at(-1), rebalances };
}

function rankedMomentum(names, index, days, count, useTargetVol = false) {
  const selected = topBy(names, symbol => momentum(symbol, index, days, 21), count).map(item => item.symbol);
  const base = inverseVolWeights(selected, index);
  return useTargetVol ? targetVolWeights(base, index) : base;
}

const ruleStrategies = [
  runStrategy("Momentum Core", index => rankedMomentum(symbols, index, 252, 3, true), { note: "12-1 momentum; top 3; inverse vol; 10% vol target", group: "V1" }),
  runStrategy("Low Vol Carry", index => inverseVolWeights(equity.map(symbol => ({ symbol, vol: annualVol(symbol, index) })).sort((a, b) => a.vol - b.vol).slice(0, 4).map(item => item.symbol), index), { note: "Four lowest-volatility equity ETFs; price-only carry proxy" }),
  runStrategy("Macro Hedge", index => ({ weights: prices.SPY[index] > movingAverage("SPY", index, 200) ? { SPY: .45, EFA: .2, EEM: .1, IEF: .15, GLD: .1 } : { IEF: .35, TLT: .25, GLD: .25, SHY: .15 } }), { note: "SPY 200-day regime switch across equity, Treasury and gold" }),
  runStrategy("Quality Tilt", index => ({ QUAL: .7, USMV: .3 }), { note: "QUAL and USMV ETF proxy; no company fundamentals", group: "Proxy" }),
  runStrategy("Mean Reversion", index => { const selected = equity.map(symbol => ({ symbol, z: zScore(symbol, index) })).filter(item => item.z < -.5 && prices[item.symbol][index] > movingAverage(item.symbol, index, 200)).sort((a, b) => a.z - b.z).slice(0, 3).map(item => item.symbol); return selected.length ? inverseVolWeights(selected, index) : { SHY: 1 }; }, { note: "20-day oversold z-score with 200-day trend filter" }),
  runStrategy("Credit Sensitive", index => momentum("HYG", index, 126) > momentum("IEF", index, 126) && prices.HYG[index] > movingAverage("HYG", index, 100) ? { HYG: .7, LQD: .3 } : { IEF: .6, SHY: .4 }, { note: "HYG versus Treasury relative trend" }),
  runStrategy("Trend Following", index => { const selected = topBy(diversified, symbol => momentum(symbol, index, 252), 5).filter(item => prices[item.symbol][index] > movingAverage(item.symbol, index, 200)).map(item => item.symbol); return selected.length ? inverseVolWeights(selected, index) : { SHY: 1 }; }, { note: "12-month trend with 200-day filter across assets" }),
  runStrategy("Value Rotation", index => rankedMomentum(["VTV", "IWM", "EFA", "EEM"], index, 126, 2), { note: "Value and cyclical ETF proxy rotation", group: "Proxy" }),
  runStrategy("Defensive Dividend", index => ({ USMV: .4, QUAL: .3, VTV: .3 }), { note: "Defensive factor ETF proxy; dividend histories unavailable", group: "Proxy" }),
  runStrategy("Volatility Target", index => { const vol = annualVol("SPY", index); const exposure = clamp(.10 / vol, 0, 1.5); return { SPY: exposure, SHY: Math.max(0, 1 - exposure) }; }, { note: "SPY exposure scaled to 10% annualized volatility" }),
  runStrategy("Sector Rotation", index => rankedMomentum(sectors, index, 126, 2), { note: "Top two US sectors by six-month momentum" }),
  runStrategy("Tail Risk Overlay", index => { const stressed = drawdown("SPY", index, 126) < -.08 || annualVol("SPY", index, 20) > .24; return stressed ? { SPY: .55, GLD: .25, TLT: .2 } : { SPY: .85, GLD: .1, IEF: .05 }; }, { note: "Treasury/gold hedge proxy; no options or VIX futures", group: "Proxy" })
];

function gaussian(value, mu, varValue) { const safe = Math.max(varValue, 1e-8); return Math.exp(-.5 * (value - mu) ** 2 / safe) / Math.sqrt(2 * Math.PI * safe) + 1e-300; }
function fitHMM(observations, iterations = 18) {
  const overallVar = variance(observations);
  let means = [mean(observations) * .5, mean(observations) * .5];
  let vars = [overallVar * .45, overallVar * 2.2];
  let transition = [[.97, .03], [.08, .92]], pi = [.8, .2], gamma = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const n = observations.length, alpha = Array.from({ length: n }, () => [0, 0]), scale = Array(n).fill(0);
    for (let state = 0; state < 2; state += 1) alpha[0][state] = pi[state] * gaussian(observations[0], means[state], vars[state]);
    scale[0] = alpha[0][0] + alpha[0][1]; alpha[0] = alpha[0].map(value => value / scale[0]);
    for (let t = 1; t < n; t += 1) { for (let state = 0; state < 2; state += 1) alpha[t][state] = (alpha[t - 1][0] * transition[0][state] + alpha[t - 1][1] * transition[1][state]) * gaussian(observations[t], means[state], vars[state]); scale[t] = alpha[t][0] + alpha[t][1]; alpha[t] = alpha[t].map(value => value / scale[t]); }
    const beta = Array.from({ length: n }, () => [1, 1]);
    for (let t = n - 2; t >= 0; t -= 1) for (let state = 0; state < 2; state += 1) beta[t][state] = (transition[state][0] * gaussian(observations[t + 1], means[0], vars[0]) * beta[t + 1][0] + transition[state][1] * gaussian(observations[t + 1], means[1], vars[1]) * beta[t + 1][1]) / scale[t + 1];
    gamma = alpha.map((row, t) => { const values = row.map((value, state) => value * beta[t][state]); const total = values[0] + values[1]; return values.map(value => value / total); });
    const xiSum = [[0, 0], [0, 0]];
    for (let t = 0; t < n - 1; t += 1) { let total = 0; const xi = [[0, 0], [0, 0]]; for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) { xi[i][j] = alpha[t][i] * transition[i][j] * gaussian(observations[t + 1], means[j], vars[j]) * beta[t + 1][j]; total += xi[i][j]; } for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) xiSum[i][j] += xi[i][j] / total; }
    pi = [...gamma[0]];
    for (let state = 0; state < 2; state += 1) { const weight = gamma.reduce((sum, row) => sum + row[state], 0); means[state] = gamma.reduce((sum, row, t) => sum + row[state] * observations[t], 0) / weight; vars[state] = Math.max(1e-8, gamma.reduce((sum, row, t) => sum + row[state] * (observations[t] - means[state]) ** 2, 0) / weight); const denominator = gamma.slice(0, -1).reduce((sum, row) => sum + row[state], 0); transition[state] = xiSum[state].map(value => value / denominator); }
  }
  const highState = vars[0] > vars[1] ? 0 : 1;
  return { highProbability: gamma.at(-1)[highState], means, vars, transition };
}

function garchForecast(series) {
  const sampleVar = variance(series);
  let best = { ll: -Infinity, forecast: sampleVar, alpha: .05, beta: .9 };
  for (const alpha of [.03, .05, .08, .12, .16]) for (const beta of [.72, .8, .86, .9, .94]) {
    if (alpha + beta >= .985) continue;
    const omega = sampleVar * (1 - alpha - beta);
    let h = sampleVar, ll = 0;
    for (let t = 1; t < series.length; t += 1) { h = omega + alpha * series[t - 1] ** 2 + beta * h; ll += -.5 * (Math.log(2 * Math.PI) + Math.log(Math.max(h, 1e-10)) + series[t] ** 2 / Math.max(h, 1e-10)); }
    const forecast = omega + alpha * series.at(-1) ** 2 + beta * h;
    if (ll > best.ll) best = { ll, forecast, alpha, beta };
  }
  return best;
}

function covarianceMatrix(names, index, window, forecastVols) {
  const samples = names.map(symbol => returns[symbol].slice(index - window + 1, index + 1));
  const std = samples.map(series => Math.sqrt(variance(series)));
  return names.map((_, i) => names.map((__, j) => { const mi = mean(samples[i]), mj = mean(samples[j]); const cov = samples[i].reduce((sum, value, k) => sum + (value - mi) * (samples[j][k] - mj), 0) / (window - 1); const corr = std[i] && std[j] ? cov / (std[i] * std[j]) : i === j ? 1 : 0; return corr * forecastVols[i] * forecastVols[j] * 252; }));
}
function projectCapped(values, cap = .35) { let low = Math.min(...values) - cap, high = Math.max(...values); for (let iteration = 0; iteration < 80; iteration += 1) { const mid = (low + high) / 2; const total = values.reduce((sum, value) => sum + clamp(value - mid, 0, cap), 0); if (total > 1) low = mid; else high = mid; } return values.map(value => clamp(value - high, 0, cap)); }
function optimizeMVO(mu, sigma, riskAversion) { let weights = Array(mu.length).fill(1 / mu.length); for (let iteration = 0; iteration < 500; iteration += 1) { const gradient = mu.map((value, i) => value - riskAversion * sigma[i].reduce((sum, covariance, j) => sum + covariance * weights[j], 0)); weights = projectCapped(weights.map((weight, i) => weight + .15 * gradient[i])); } return weights; }

const v2Universe = ["SPY", "IWM", "EFA", "EEM", "IEF", "TLT", "LQD", "HYG", "GLD", "DBC"];
const v2 = runStrategy("V2 HMM-GARCH-MVO", index => {
  const spyHistory = returns.SPY.slice(index - 755, index + 1);
  const hmm = fitHMM(spyHistory);
  const forecasts = v2Universe.map(symbol => garchForecast(returns[symbol].slice(index - 755, index + 1)));
  const forecastVols = forecasts.map(item => Math.sqrt(item.forecast));
  const sigma = covarianceMatrix(v2Universe, index, 252, forecastVols);
  const mu = v2Universe.map(symbol => clamp(momentum(symbol, index, 126) * 2, -.15, .25));
  if (hmm.highProbability > .5) v2Universe.forEach((symbol, i) => { if (["SPY", "IWM", "EFA", "EEM", "HYG", "DBC"].includes(symbol)) mu[i] -= .08 * hmm.highProbability; else mu[i] += .025 * hmm.highProbability; });
  const optimized = optimizeMVO(mu, sigma, hmm.highProbability > .5 ? 9 : 4);
  return { weights: Object.fromEntries(v2Universe.map((symbol, i) => [symbol, optimized[i]])), diagnostics: { highRegimeProbability: hmm.highProbability, garch: Object.fromEntries(v2Universe.map((symbol, i) => [symbol, forecasts[i]])) } };
}, { startIndex: 756, note: "Two-state Gaussian HMM, GARCH(1,1) likelihood grid and capped long-only MVO", group: "V2" });

const featureNames = ["Mom1M", "Mom3M", "Mom6M", "Mom12_1", "Vol20", "Vol60", "MA50Gap", "Drawdown6M"];
function features(symbol, index) { return [momentum(symbol, index, 21), momentum(symbol, index, 63), momentum(symbol, index, 126), momentum(symbol, index, 252, 21), annualVol(symbol, index, 20), annualVol(symbol, index, 60), prices[symbol][index] / movingAverage(symbol, index, 50) - 1, drawdown(symbol, index, 126)]; }
function trainBoostedStumps(rows, rounds = 45, rate = .06, lambda = 2) {
  const base = mean(rows.map(row => row.y));
  const predictions = Array(rows.length).fill(base), trees = [];
  for (let round = 0; round < rounds; round += 1) {
    const residuals = rows.map((row, i) => row.y - predictions[i]);
    let best = null;
    for (let feature = 0; feature < featureNames.length; feature += 1) {
      const sorted = rows.map(row => row.x[feature]).filter(Number.isFinite).sort((a, b) => a - b);
      const thresholds = [.1,.2,.3,.4,.5,.6,.7,.8,.9].map(q => sorted[Math.floor((sorted.length - 1) * q)]);
      for (const threshold of [...new Set(thresholds)]) {
        const left = [], right = [];
        rows.forEach((row, i) => (row.x[feature] <= threshold ? left : right).push(residuals[i]));
        if (left.length < 20 || right.length < 20) continue;
        const leftValue = left.reduce((sum, value) => sum + value, 0) / (left.length + lambda);
        const rightValue = right.reduce((sum, value) => sum + value, 0) / (right.length + lambda);
        const gain = left.length * leftValue ** 2 + right.length * rightValue ** 2;
        if (!best || gain > best.gain) best = { feature, threshold, leftValue, rightValue, leftCount: left.length, rightCount: right.length, gain };
      }
    }
    if (!best) break;
    rows.forEach((row, i) => { predictions[i] += rate * (row.x[best.feature] <= best.threshold ? best.leftValue : best.rightValue); });
    trees.push(best);
  }
  return { base, rate, trees };
}
function predictBoost(model, x, explain = false) {
  let value = model.base;
  const contributions = Object.fromEntries(featureNames.map(name => [name, 0]));
  model.trees.forEach(tree => { const leaf = x[tree.feature] <= tree.threshold ? tree.leftValue : tree.rightValue; const expected = (tree.leftValue * tree.leftCount + tree.rightValue * tree.rightCount) / (tree.leftCount + tree.rightCount); value += model.rate * leaf; contributions[featureNames[tree.feature]] += model.rate * (leaf - expected); });
  return explain ? { value, contributions } : value;
}

const monthStarts = [];
for (let index = 253; index < dates.length; index += 1) if (dates[index].slice(0, 7) !== dates[index - 1].slice(0, 7)) monthStarts.push(index);
const featureRows = [];
for (let m = 0; m < monthStarts.length - 1; m += 1) { const signalIndex = monthStarts[m] - 1, nextIndex = monthStarts[m + 1] - 1; symbols.forEach(symbol => { const x = features(symbol, signalIndex); const y = prices[symbol][nextIndex] / prices[symbol][signalIndex] - 1; if (x.every(Number.isFinite) && Number.isFinite(y)) featureRows.push({ month: m, symbol, x, y }); }); }
let latestFeatureImportance = {}, latestModelDiagnostics = {};
const v3 = runStrategy("V3 Boosted Trees + Attribution", index => {
  const month = monthStarts.findIndex(value => value === index + 1);
  const training = featureRows.filter(row => row.month < month - 1);
  if (training.length < 400) return { weights: { SHY: 1 }, diagnostics: { trainingRows: training.length } };
  const model = trainBoostedStumps(training);
  const scored = symbols.map(symbol => ({ symbol, x: features(symbol, index) })).filter(item => item.x.every(Number.isFinite)).map(item => ({ ...item, ...predictBoost(model, item.x, true) })).sort((a, b) => b.value - a.value).slice(0, 3);
  const base = inverseVolWeights(scored.map(item => item.symbol), index);
  const weights = targetVolWeights(base, index);
  latestFeatureImportance = Object.fromEntries(featureNames.map(name => [name, mean(scored.map(item => Math.abs(item.contributions[name])))]));
  latestModelDiagnostics = { trainingRows: training.length, trees: model.trees.length, predictions: scored.map(item => ({ symbol: item.symbol, prediction: item.value, contributions: item.contributions })) };
  return { weights, diagnostics: latestModelDiagnostics };
}, { startIndex: 756, note: "Walk-forward regularized gradient-boosted decision stumps with additive feature attribution", group: "V3" });
v3.featureImportance = latestFeatureImportance;
v3.modelDiagnostics = latestModelDiagnostics;

const benchmarks = [
  runStrategy("SPY Benchmark", () => ({ SPY: 1 }), { startIndex: 756, cost: 0, group: "Benchmark" }),
  runStrategy("Equal Weight", index => normalize(Object.fromEntries(symbols.map(symbol => [symbol, prices[symbol][index] ? 1 : 0]))), { startIndex: 756, cost: 0, group: "Benchmark" }),
  runStrategy("60/40 Benchmark", () => ({ SPY: .6, IEF: .4 }), { startIndex: 756, cost: 0, group: "Benchmark" })
];

function alignedCorrelation(strategies) {
  const maps = strategies.map(strategy => new Map(strategy.monthly.map(row => [row.date.slice(0, 7), row.nav])));
  const common = [...maps[0].keys()].filter(key => maps.every(map => map.has(key))).sort();
  const series = maps.map(map => common.slice(1).map((key, index) => map.get(key) / map.get(common[index]) - 1));
  return series.map((left, i) => series.map((right, j) => { const ml = mean(left), mr = mean(right); const cov = left.reduce((sum, value, k) => sum + (value - ml) * (right[k] - mr), 0); const denom = Math.sqrt(left.reduce((sum, value) => sum + (value - ml) ** 2, 0) * right.reduce((sum, value) => sum + (value - mr) ** 2, 0)); return i === j ? 1 : denom ? cov / denom : 0; }));
}

const coreModels = [ruleStrategies[0], v2, v3];
const output = {
  generatedAt: new Date().toISOString(),
  assumptions: { data: "Adjusted daily public ETF histories", rebalance: "Monthly, prior-close information only", transactionCost: costRate, sharpeRiskFreeRate: 0 },
  coreModels,
  strategies: ruleStrategies,
  benchmarks,
  strategyCorrelation: alignedCorrelation(ruleStrategies)
};
await fs.writeFile(new URL("outputs/data/all-strategy-backtests.json", root), JSON.stringify(output, null, 2));

let html = await fs.readFile(new URL("outputs/riskdesk.html", root), "utf8");
const start = "<!-- ALL_STRATEGY_BACKTESTS_START -->", end = "<!-- ALL_STRATEGY_BACKTESTS_END -->";
const embedded = `${start}\n<script type="application/json" id="allStrategyBacktests">${JSON.stringify(output).replaceAll("</", "<\\/")}</script>\n${end}`;
const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
html = marker.test(html) ? html.replace(marker, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(new URL("outputs/riskdesk.html", root), html);

console.log(JSON.stringify({ core: coreModels.map(item => ({ name: item.name, metrics: item.metrics, latest: item.latestRebalance })), strategies: ruleStrategies.map(item => ({ name: item.name, group: item.group, metrics: item.metrics })), benchmarks: benchmarks.map(item => ({ name: item.name, metrics: item.metrics })) }, null, 2));
