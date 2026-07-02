import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const snapshot = JSON.parse(await fs.readFile(new URL("outputs/data/public-market-snapshot.json", root), "utf8"));
let researchParams = {};
try {
  researchParams = JSON.parse(await fs.readFile(new URL("research_params.json", root), "utf8"));
} catch {
  researchParams = {};
}
const params = {
  v1: {
    lookbackDays: researchParams.v1?.lookback_days ?? 252,
    skipDays: researchParams.v1?.skip_days ?? 21,
    topN: researchParams.v1?.top_n ?? 3,
    targetVol: researchParams.v1?.target_vol ?? .10,
    maxGross: researchParams.v1?.max_gross ?? 2,
  },
  v2: {
    historyDays: researchParams.v2?.history_days ?? 756,
    covarianceDays: researchParams.v2?.covariance_days ?? 252,
    highRiskAversion: researchParams.v2?.high_risk_aversion ?? 9,
    lowRiskAversion: researchParams.v2?.low_risk_aversion ?? 4,
    maxWeight: researchParams.v2?.max_weight ?? .35,
  },
  v3: {
    rounds: researchParams.v3?.rounds ?? 45,
    learningRate: researchParams.v3?.learning_rate ?? .06,
    lambda: researchParams.v3?.lambda ?? 2,
    topN: researchParams.v3?.top_n ?? 3,
    targetVol: researchParams.v3?.target_vol ?? .10,
    maxGross: researchParams.v3?.max_gross ?? 2,
  }
};
const allSymbols = Object.keys(snapshot.assets);
const stockSymbols = (snapshot.universe?.stockSymbols || allSymbols).filter(symbol => snapshot.assets[symbol]);
const riskFactorSymbols = (snapshot.universe?.riskFactorSymbols || []).filter(symbol => snapshot.assets[symbol]);
const symbols = stockSymbols;
const dates = snapshot.assets.SPY.daily.map(row => row[0]);
const prices = Object.fromEntries(allSymbols.map(symbol => {
  const map = new Map(snapshot.assets[symbol].daily.map(([date, close]) => [date, close]));
  return [symbol, dates.map(date => map.get(date) ?? null)];
}));
const returns = Object.fromEntries(allSymbols.map(symbol => [symbol, prices[symbol].map((value, index, list) => index && value && list[index - 1] ? value / list[index - 1] - 1 : 0)]));
const costRate = .0005;
const researchVersion = "Version 3.5 - JP Morgan AI factor enhancement";
function weekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

const growthStocks = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA", "AVGO", "NFLX", "CRM", "AMD"].filter(symbol => prices[symbol]);
const qualityStocks = ["MSFT", "AAPL", "COST", "LLY", "MA", "V", "UNH", "WMT"].filter(symbol => prices[symbol]);
const defensiveStocks = ["COST", "WMT", "UNH", "LLY", "HD", "ORCL"].filter(symbol => prices[symbol]);
const cyclicalStocks = ["JPM", "HD", "TSLA", "AMD", "AVGO", "CRM"].filter(symbol => prices[symbol]);
const cashProxy = prices.IEF ? "IEF" : "SPY";
const riskHedges = ["IEF", "TLT", "GLD"].filter(symbol => prices[symbol]);

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
function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function normalize(raw, gross = 1) {
  const cleaned = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.max(0, finite(value))]));
  const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0);
  return total ? Object.fromEntries(Object.entries(cleaned).map(([key, value]) => [key, value / total * gross])) : {};
}
function inverseVolWeights(names, index, gross = 1) { return normalize(Object.fromEntries(names.map(symbol => [symbol, 1 / Math.max(.01, annualVol(symbol, index))])), gross); }
function weightedVol(target, index, window = 60) {
  const values = [];
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) values.push(Object.entries(target).reduce((sum, [symbol, weight]) => sum + weight * returns[symbol][cursor], 0));
  return Math.sqrt(variance(values) * 252);
}
function targetVolWeights(target, index, targetAnnual = .10, maxGross = 2) { const vol = weightedVol(target, index); const scale = vol > 0 ? Math.min(maxGross, targetAnnual / vol) : 1; return Object.fromEntries(Object.entries(target).map(([symbol, weight]) => [symbol, weight * scale])); }
function topBy(names, score, count, positive = true) { return names.map(symbol => ({ symbol, score: score(symbol) })).filter(item => Number.isFinite(item.score) && (!positive || item.score > 0)).sort((a, b) => b.score - a.score).slice(0, count); }
function turnover(current, target) { return [...new Set([...Object.keys(current), ...Object.keys(target)])].reduce((sum, symbol) => sum + Math.abs((target[symbol] || 0) - (current[symbol] || 0)), 0); }
function drift(weights, index, portfolioReturn) { return Object.fromEntries(Object.entries(weights).filter(([symbol]) => returns[symbol]).map(([symbol, weight]) => [symbol, weight * (1 + (returns[symbol]?.[index] ?? 0)) / (1 + portfolioReturn)])); }
function factorMomentum(symbol, index, days = 126) { return prices[symbol] ? momentum(symbol, index, days) : 0; }
function trendConfirm(symbol, index) { return prices[symbol]?.[index] > movingAverage(symbol, index, 200) ? 1 : -1; }
function stabilityScore(symbol, index) { return -annualVol(symbol, index, 60) + .35 * Math.max(drawdown(symbol, index, 126), -.5); }
function qualityProxy(symbol, index) {
  return .45 * momentum(symbol, index, 252, 21) + .25 * momentum(symbol, index, 126) + .15 * trendConfirm(symbol, index) + .15 * stabilityScore(symbol, index);
}
function riskOnScore(index) {
  const spyTrend = prices.SPY[index] > movingAverage("SPY", index, 200) ? 1 : -1;
  const credit = factorMomentum("HYG", index, 63) - factorMomentum("IEF", index, 63);
  const rates = factorMomentum("TLT", index, 63);
  const volatility = annualVol("SPY", index, 20);
  return .45 * spyTrend + .35 * Math.sign(credit || 0) + .20 * Math.sign(rates || 0) - Math.max(0, volatility - .22) * 3;
}
function hedgeSleeve(gross = .2) {
  const hedges = {};
  if (prices.IEF) hedges.IEF = gross * .45;
  if (prices.GLD) hedges.GLD = gross * .35;
  if (prices.TLT) hedges.TLT = gross * .20;
  return hedges;
}
function jpmAIContext(index) {
  const aiInfra = .55 * finite(factorMomentum("QQQ", index, 126)) + .45 * finite(factorMomentum("XLK", index, 126));
  const qualityFactor = finite(factorMomentum("QUAL", index, 126));
  const momentumFactor = finite(factorMomentum("MTUM", index, 126));
  const lowVolFactor = finite(factorMomentum("USMV", index, 126));
  const credit = finite(factorMomentum("HYG", index, 63)) - finite(factorMomentum("IEF", index, 63));
  const breadthSymbols = ["XLK", "XLF", "XLV", "XLE", "QUAL", "MTUM"].filter(symbol => prices[symbol]);
  const breadth = breadthSymbols.filter(symbol => prices[symbol][index] > movingAverage(symbol, index, 100)).length / Math.max(1, breadthSymbols.length);
  return { aiInfra, qualityFactor, momentumFactor, lowVolFactor, credit, breadth, regime: riskOnScore(index) };
}
function jpmAIScore(symbol, index, weights = {}) {
  const ctx = jpmAIContext(index);
  const mom12 = finite(momentum(symbol, index, 252, 21));
  const mom6 = finite(momentum(symbol, index, 126));
  const mom3 = finite(momentum(symbol, index, 63));
  const shortRun = finite(momentum(symbol, index, 21));
  const vol20 = finite(annualVol(symbol, index, 20), .25);
  const vol60 = finite(annualVol(symbol, index, 60), .25);
  const ma50Gap = finite(prices[symbol][index] / movingAverage(symbol, index, 50) - 1);
  const dd = finite(drawdown(symbol, index, 126), -.1);
  const trend = finite(trendConfirm(symbol, index));
  const crowdingPenalty = Math.max(0, shortRun) + Math.max(0, ctx.momentumFactor);
  const quality = qualityProxy(symbol, index);
  const w = {
    momentum: .30,
    acceleration: .16,
    quality: .18,
    regime: .12,
    liquidity: .08,
    lowVol: .10,
    crowding: .08,
    aiInfra: .08,
    drawdown: .08,
    ...weights
  };
  return (
    w.momentum * mom12 +
    w.acceleration * (mom3 + .5 * mom6) +
    w.quality * quality +
    w.regime * ctx.regime * trend +
    w.liquidity * (ctx.credit + ctx.breadth - Math.max(0, vol20 - vol60)) +
    w.lowVol * (-vol60 + .5 * ctx.lowVolFactor) -
    w.crowding * crowdingPenalty +
    w.aiInfra * ctx.aiInfra +
    w.drawdown * Math.max(dd, -.35) +
    .05 * ma50Gap
  );
}
function jpmTargetWeights(selected, index, { targetVol = .10, maxGross = 1.5, gross = 1, hedge = 0 } = {}) {
  const raw = Object.fromEntries(selected.map(symbol => {
    const signal = Math.max(.02, jpmAIScore(symbol, index) + .08);
    const risk = Math.max(.08, annualVol(symbol, index, 60));
    return [symbol, signal / risk];
  }));
  const scaled = targetVolWeights(normalize(raw, gross), index, targetVol, maxGross);
  return hedge ? { ...scaled, ...hedgeSleeve(hedge) } : scaled;
}

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
    if (index === startIndex || weekKey(dates[index]) !== weekKey(dates[index - 1])) {
      const result = signal(index - 1) || {};
      const target = result.weights || result;
      const traded = turnover(weights, target);
      const fee = nav * traded * cost;
      nav -= fee; totalCost += fee; totalTurnover += traded; weights = target;
      rebalances.push({ date: dates[index], weights: { ...target }, turnover: traded, diagnostics: result.diagnostics || {} });
    }
    const dayReturn = Object.entries(weights).reduce((sum, [symbol, weight]) => sum + weight * (returns[symbol]?.[index] ?? 0), 0);
    nav *= 1 + dayReturn;
    weights = drift(weights, index, dayReturn);
    daily.push({ date: dates[index], nav });
  }
  const years = (new Date(daily.at(-1).date) - new Date(daily[0].date)) / (365.25 * 86400000);
  return { name, group, note, sample: { start: daily[0].date, end: daily.at(-1).date }, metrics: { ...metrics(daily), annualTurnover: totalTurnover / years, totalCost }, monthly: toMonthly(daily), latestRebalance: rebalances.at(-1), rebalances, rebalanceFrequency: "Weekly" };
}

function rankedMomentum(names, index, days, count, useTargetVol = false, options = {}) {
  const selected = topBy(names, symbol => momentum(symbol, index, days, options.skipDays ?? 21), count).map(item => item.symbol);
  const base = inverseVolWeights(selected, index);
  return useTargetVol ? targetVolWeights(base, index, options.targetVol ?? .10, options.maxGross ?? 2) : base;
}
function rankedJpmMomentum(names, index, days, count, useTargetVol = false, options = {}) {
  const selected = topBy(names, symbol => .58 * momentum(symbol, index, days, options.skipDays ?? 21) + .42 * jpmAIScore(symbol, index, options.weights || {}), count).map(item => item.symbol);
  const base = jpmTargetWeights(selected, index, { targetVol: options.targetVol ?? .10, maxGross: options.maxGross ?? 2, gross: options.gross ?? 1 });
  return useTargetVol ? base : normalize(base);
}

const v1 = runStrategy(
  "V1 Momentum-Vol Research Model",
  index => rankedJpmMomentum(symbols, index, params.v1.lookbackDays, params.v1.topN, true, { skipDays: params.v1.skipDays, targetVol: params.v1.targetVol, maxGross: params.v1.maxGross, weights: { quality: .22, lowVol: .14, crowding: .10 } }),
  { note: `${researchVersion}: ${params.v1.lookbackDays}-day stock momentum plus JP Morgan-style quality, low-vol and crowding controls; top ${params.v1.topN}; ${(params.v1.targetVol * 100).toFixed(1)}% vol target`, group: "Core" }
);

const customStrategies = [
  runStrategy("S1 AI Capex Momentum+", index => {
    const aiRisk = .6 * factorMomentum("QQQ", index, 126) + .4 * factorMomentum("XLK", index, 126);
    const selected = topBy(growthStocks, symbol => .45 * qualityProxy(symbol, index) + .35 * momentum(symbol, index, 63) + .30 * jpmAIScore(symbol, index, { aiInfra: .22, crowding: .12, liquidity: .10 }) + .15 * aiRisk, 5).map(item => item.symbol);
    const gross = aiRisk > 0 ? .92 : .68;
    return { ...jpmTargetWeights(selected, index, { gross, targetVol: .12, maxGross: 1.7 }), ...hedgeSleeve(aiRisk > 0 ? .08 : .22) };
  }, { note: "Version 3.5 JP Morgan AI infrastructure strategy: capex momentum plus AI factor confirmation, liquidity/risk penalty, volatility targeting and hedge sleeve.", group: "Custom AI" }),
  runStrategy("S2 Quality Growth Barbell+", index => {
    const qualityLeg = Object.fromEntries(topBy(qualityStocks, symbol => .65 * qualityProxy(symbol, index) + .35 * jpmAIScore(symbol, index, { quality: .30, lowVol: .18 }), 5, false).map(item => [item.symbol, 1]));
    const growthLeg = Object.fromEntries(topBy(growthStocks, symbol => .45 * momentum(symbol, index, 126) + .25 * momentum(symbol, index, 63) + .25 * jpmAIScore(symbol, index, { quality: .22, aiInfra: .12 }) - .15 * annualVol(symbol, index, 60), 4).map(item => [item.symbol, 1]));
    const lowVolHedge = prices.USMV && annualVol("SPY", index, 20) > .20 ? .18 : .08;
    return { ...normalize(qualityLeg, .52), ...normalize(growthLeg, .40), USMV: prices.USMV ? lowVolHedge : 0 };
  }, { note: "Version 3.5 quality-growth barbell: quality proxy, AI factor score, growth acceleration, low-vol hedge that expands during market stress.", group: "Custom AI" }),
  runStrategy("S3 Crowding-Aware Momentum+", index => {
    const ranked = topBy(symbols, symbol => {
      const trend = momentum(symbol, index, 252, 21);
      const shortRun = momentum(symbol, index, 21);
      const vol = annualVol(symbol, index, 20);
      const factorCrowding = Math.max(0, factorMomentum("MTUM", index, 21));
      return .62 * trend + .30 * jpmAIScore(symbol, index, { crowding: .22, liquidity: .12 }) + .20 * trendConfirm(symbol, index) - .75 * Math.max(0, shortRun) - .40 * Math.max(0, vol - .28) - .28 * factorCrowding;
    }, 5).map(item => item.symbol);
    return jpmTargetWeights(ranked, index, { targetVol: .10, maxGross: 1.45 });
  }, { note: "Version 3.5 anti-crowding momentum: JP Morgan-style crowding, liquidity and one-month chase penalties.", group: "Custom Risk" }),
  runStrategy("S4 Low-Vol Alpha Shield+", index => {
    const selected = symbols
      .map(symbol => ({ symbol, score: .42 * momentum(symbol, index, 126) + .32 * jpmAIScore(symbol, index, { lowVol: .28, quality: .20, crowding: .10 }) + .20 * trendConfirm(symbol, index) - .72 * annualVol(symbol, index, 60) + .22 * Math.max(drawdown(symbol, index, 126), -.25) }))
      .filter(item => Number.isFinite(item.score) && item.score > -.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(item => item.symbol);
    return jpmTargetWeights(selected, index, { targetVol: .085, maxGross: 1.28 });
  }, { note: "Version 3.5 low-vol alpha shield: medium trend plus quality, drawdown, low-vol and crowding-aware JP Morgan controls.", group: "Custom Risk" }),
  runStrategy("S5 Regime-Switch Equity Hedge+", index => {
    const score = riskOnScore(index);
    const riskOn = score > .15;
    const selected = topBy(symbols, symbol => .55 * momentum(symbol, index, 126) + .45 * jpmAIScore(symbol, index, { regime: .24, liquidity: .18 }), 5).map(item => item.symbol);
    return riskOn ? { ...jpmTargetWeights(selected, index, { gross: .82, targetVol: .11, maxGross: 1.45 }), ...hedgeSleeve(.18) } : { ...jpmTargetWeights(qualityStocks, index, { gross: .38, targetVol: .07, maxGross: 1 }), ...hedgeSleeve(.62) };
  }, { note: "Version 3.5 regime hedge: JP Morgan macro regime, liquidity, credit and volatility stress decide equity/hedge budget.", group: "Custom Macro" }),
  runStrategy("S6 Credit-Liquidity Accelerator+", index => {
    const creditSpreadProxy = factorMomentum("HYG", index, 126) - factorMomentum("IEF", index, 126);
    const creditRiskOn = creditSpreadProxy > 0 && annualVol("HYG", index, 60) < annualVol("SPY", index, 60) && riskOnScore(index) > 0;
    const selected = topBy(cyclicalStocks.concat(growthStocks), symbol => .55 * momentum(symbol, index, 126) + .45 * jpmAIScore(symbol, index, { liquidity: .24, regime: .18 }), 5).map(item => item.symbol);
    return creditRiskOn ? jpmTargetWeights(selected, index, { targetVol: .125, maxGross: 1.75 }) : { ...jpmTargetWeights(qualityStocks, index, { gross: .48, targetVol: .075, maxGross: 1 }), ...hedgeSleeve(.52) };
  }, { note: "Version 3.5 credit-liquidity accelerator: high-yield/Treasury proxy plus JP Morgan liquidity and regime score before increasing beta.", group: "Custom Macro" }),
  runStrategy("S7 Revision-Proxy Growth Rank+", index => {
    const selected = topBy(symbols, symbol => .35 * momentum(symbol, index, 63) + .25 * momentum(symbol, index, 126) + .22 * jpmAIScore(symbol, index, { acceleration: .25, quality: .18, aiInfra: .12 }) + .12 * momentum(symbol, index, 21) - .25 * Math.max(0, annualVol(symbol, index, 20) - annualVol(symbol, index, 120)) + .10 * trendConfirm(symbol, index), 6).map(item => item.symbol);
    return jpmTargetWeights(selected, index, { targetVol: .115, maxGross: 1.6 });
  }, { note: "Version 3.5 revision proxy: acceleration, AI factor score, quality and volatility stability proxy analyst-revision behavior.", group: "Custom AI" }),
  runStrategy("S8 Trend-Guarded Reversion+", index => {
    const selected = symbols
      .map(symbol => ({ symbol, score: -.85 * zScore(symbol, index, 20) + .25 * momentum(symbol, index, 126) + .25 * jpmAIScore(symbol, index, { lowVol: .20, crowding: .15 }) + .20 * trendConfirm(symbol, index) - .24 * annualVol(symbol, index, 20) }))
      .filter(item => item.score > 0 && prices[item.symbol][index] > movingAverage(item.symbol, index, 200) && drawdown(item.symbol, index, 63) > -.16)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.symbol);
    return selected.length ? jpmTargetWeights(selected, index, { targetVol: .09, maxGross: 1.25 }) : { [cashProxy]: 1 };
  }, { note: "Version 3.5 guarded reversion: pullback entries require trend, drawdown, volatility and JP Morgan crowding controls.", group: "Custom Tactical" }),
  runStrategy("S9 Sector-Breadth Rotation+", index => {
    const sectorSet = ["XLK", "XLF", "XLV", "XLE", "QUAL", "MTUM"].filter(symbol => prices[symbol]);
    const breadth = sectorSet.filter(symbol => prices[symbol][index] > movingAverage(symbol, index, 100)).length / Math.max(1, sectorSet.length);
    const factorLeader = sectorSet.sort((a, b) => factorMomentum(b, index, 126) - factorMomentum(a, index, 126))[0];
    const selected = breadth > .5 ? topBy(symbols, symbol => .52 * momentum(symbol, index, 126) + .30 * jpmAIScore(symbol, index, { regime: .18, liquidity: .18 }) + .12 * factorMomentum(factorLeader, index, 63), 6).map(item => item.symbol) : topBy(qualityStocks.concat(defensiveStocks), symbol => qualityProxy(symbol, index) + .35 * jpmAIScore(symbol, index, { lowVol: .24, quality: .22 }), 5).map(item => item.symbol);
    return jpmTargetWeights(selected, index, { gross: breadth > .5 ? .95 : .70, targetVol: breadth > .5 ? .12 : .08, maxGross: 1.5 });
  }, { note: "Version 3.5 sector-breadth rotation: ETF breadth/factor leadership plus JP Morgan regime, liquidity and quality scoring.", group: "Custom Macro" }),
  runStrategy("S10 Defensive Growth Stabilizer+", index => {
    const selected = topBy([...new Set(qualityStocks.concat(defensiveStocks))], symbol => .48 * qualityProxy(symbol, index) + .25 * jpmAIScore(symbol, index, { quality: .28, lowVol: .24, crowding: .10 }) + .20 * momentum(symbol, index, 126) - .22 * annualVol(symbol, index, 60), 6).map(item => item.symbol);
    const stressed = annualVol("SPY", index, 20) > .22 || drawdown("SPY", index, 63) < -.06;
    return stressed ? { ...jpmTargetWeights(selected, index, { gross: .66, targetVol: .075, maxGross: 1 }), ...hedgeSleeve(.34) } : jpmTargetWeights(selected, index, { targetVol: .095, maxGross: 1.28 });
  }, { note: "Version 3.5 defensive stabilizer: quality, low-volatility, crowding control and volatility stress hedge.", group: "Custom Risk" }),
  runStrategy("S11 Tail-Risk Shock Absorber+", index => {
    const shock = drawdown("SPY", index, 126) < -.1 || annualVol("SPY", index, 20) > .28 || factorMomentum("HYG", index, 21) < -.04 || riskOnScore(index) < -.25;
    const selected = topBy(qualityStocks, symbol => .40 * momentum(symbol, index, 126) + .60 * jpmAIScore(symbol, index, { lowVol: .28, quality: .24, regime: .18 }), 5).map(item => item.symbol);
    return shock ? { ...jpmTargetWeights(selected, index, { gross: .35, targetVol: .06, maxGross: 1 }), ...hedgeSleeve(.65) } : { ...jpmTargetWeights(selected, index, { gross: .82, targetVol: .10, maxGross: 1.38 }), SPY: prices.SPY ? .18 : 0 };
  }, { note: "Version 3.5 tail-risk absorber: JP Morgan regime, low-vol and quality score before shifting into hedges under shock.", group: "Custom Risk" }),
  runStrategy("S12 Adaptive Volatility Compounder+", index => {
    const selected = topBy(symbols, symbol => .38 * momentum(symbol, index, 126) + .25 * momentum(symbol, index, 252, 21) + .30 * jpmAIScore(symbol, index, { regime: .18, liquidity: .16, lowVol: .16 }) - .18 * annualVol(symbol, index, 60) + .10 * trendConfirm(symbol, index), 6).map(item => item.symbol);
    const base = jpmTargetWeights(selected, index, { targetVol: .10, maxGross: 1.2 });
    const stress = annualVol("SPY", index, 60);
    const target = stress > .24 ? .07 : stress > .18 ? .095 : .13;
    const scaled = targetVolWeights(base, index, target, 1.8);
    const gross = Object.values(scaled).reduce((sum, value) => sum + value, 0);
    return { ...scaled, [cashProxy]: Math.max(0, 1 - gross) };
  }, { note: "Version 3.5 adaptive volatility compounder: dynamic target volatility plus JP Morgan liquidity, regime and low-vol scoring.", group: "Custom Tactical" })
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
function optimizeMVO(mu, sigma, riskAversion, cap = .35) { let weights = Array(mu.length).fill(1 / mu.length); for (let iteration = 0; iteration < 500; iteration += 1) { const gradient = mu.map((value, i) => value - riskAversion * sigma[i].reduce((sum, covariance, j) => sum + covariance * weights[j], 0)); weights = projectCapped(weights.map((weight, i) => weight + .15 * gradient[i]), cap); } return weights; }

const v2Universe = symbols.slice(0, 12);
const v2 = runStrategy("V2 HMM-GARCH-MVO", index => {
  const spyHistory = returns.SPY.slice(index - params.v2.historyDays + 1, index + 1);
  const hmm = fitHMM(spyHistory);
  const forecasts = v2Universe.map(symbol => garchForecast(returns[symbol].slice(index - params.v2.historyDays + 1, index + 1)));
  const forecastVols = forecasts.map(item => Math.sqrt(item.forecast));
  const sigma = covarianceMatrix(v2Universe, index, params.v2.covarianceDays, forecastVols);
  const mu = v2Universe.map(symbol => clamp(finite(momentum(symbol, index, 126)) * 1.35 + jpmAIScore(symbol, index, { regime: .22, liquidity: .20, quality: .16, crowding: .12 }) * .95, -.18, .30));
  if (hmm.highProbability > .5) v2Universe.forEach((symbol, i) => { mu[i] -= .06 * hmm.highProbability * Math.max(.75, annualVol(symbol, index) / .25); });
  let optimized = optimizeMVO(mu, sigma, hmm.highProbability > .5 ? params.v2.highRiskAversion : params.v2.lowRiskAversion, params.v2.maxWeight);
  if (!optimized.every(Number.isFinite) || optimized.reduce((sum, value) => sum + Math.max(0, value), 0) <= 0) {
    const fallback = normalize(Object.fromEntries(v2Universe.map((symbol, i) => [symbol, Math.max(.01, finite(mu[i]) + .20) / Math.max(.08, annualVol(symbol, index, 60))])), 1);
    optimized = v2Universe.map(symbol => fallback[symbol] || 0);
  }
  return { weights: Object.fromEntries(v2Universe.map((symbol, i) => [symbol, optimized[i]])), diagnostics: { highRegimeProbability: hmm.highProbability, garch: Object.fromEntries(v2Universe.map((symbol, i) => [symbol, forecasts[i]])) } };
}, { startIndex: 756, note: "Version 3.5 HMM-GARCH-MVO: two-state regime model, GARCH risk forecast, capped MVO, and JP Morgan AI factor expected-return adjustment.", group: "V2" });

const featureNames = ["Mom1M", "Mom3M", "Mom6M", "Mom12_1", "Vol20", "Vol60", "MA50Gap", "Drawdown6M", "JPM_AI_Score", "RegimeScore", "CreditLiquidity", "CrowdingPenalty"];
function features(symbol, index) {
  const ctx = jpmAIContext(index);
  return [
    momentum(symbol, index, 21),
    momentum(symbol, index, 63),
    momentum(symbol, index, 126),
    momentum(symbol, index, 252, 21),
    annualVol(symbol, index, 20),
    annualVol(symbol, index, 60),
    prices[symbol][index] / movingAverage(symbol, index, 50) - 1,
    drawdown(symbol, index, 126),
    jpmAIScore(symbol, index),
    ctx.regime,
    ctx.credit,
    Math.max(0, momentum(symbol, index, 21)) + Math.max(0, ctx.momentumFactor)
  ];
}
function trainBoostedStumps(rows, rounds = 45, rate = .06, lambda = 2) {
  const base = mean(rows.map(row => row.y));
  const predictions = Array(rows.length).fill(base), trees = [];
  for (let round = 0; round < rounds; round += 1) {
    const residuals = rows.map((row, i) => row.y - predictions[i]);
    let best = null;
    for (let feature = 0; feature < featureNames.length; feature += 1) {
      const sorted = rows.map(row => row.x[feature]).filter(Number.isFinite).sort((a, b) => a - b);
      const thresholds = [.15,.30,.45,.60,.75,.90].map(q => sorted[Math.floor((sorted.length - 1) * q)]);
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
for (let index = 253; index < dates.length; index += 1) if (weekKey(dates[index]) !== weekKey(dates[index - 1])) monthStarts.push(index);
const featureRows = [];
for (let m = 0; m < monthStarts.length - 1; m += 1) { const signalIndex = monthStarts[m] - 1, nextIndex = monthStarts[m + 1] - 1; symbols.forEach(symbol => { const x = features(symbol, signalIndex); const y = prices[symbol][nextIndex] / prices[symbol][signalIndex] - 1; if (x.every(Number.isFinite) && Number.isFinite(y)) featureRows.push({ month: m, symbol, x, y }); }); }
let latestFeatureImportance = {}, latestModelDiagnostics = {};
const v3 = runStrategy("V3 Boosted Trees + Attribution", index => {
  const month = monthStarts.findIndex(value => value === index + 1);
  const trainingAll = featureRows.filter(row => row.month < month - 1);
  const training = trainingAll.length > 520 ? trainingAll.slice(-520) : trainingAll;
  if (training.length < 240) return { weights: { SHY: 1 }, diagnostics: { trainingRows: training.length, mode: "weekly_lightweight_waiting_for_training_depth" } };
  const model = trainBoostedStumps(training, Math.min(params.v3.rounds, 12), params.v3.learningRate, params.v3.lambda);
  const scored = symbols.map(symbol => ({ symbol, x: features(symbol, index) })).filter(item => item.x.every(Number.isFinite)).map(item => ({ ...item, ...predictBoost(model, item.x, true) })).sort((a, b) => b.value - a.value).slice(0, params.v3.topN);
  const base = inverseVolWeights(scored.map(item => item.symbol), index);
  const weights = targetVolWeights(base, index, params.v3.targetVol, params.v3.maxGross);
  latestFeatureImportance = Object.fromEntries(featureNames.map(name => [name, mean(scored.map(item => Math.abs(item.contributions[name])))]));
  latestModelDiagnostics = { trainingRows: training.length, trees: model.trees.length, predictions: scored.map(item => ({ symbol: item.symbol, prediction: item.value, contributions: item.contributions })) };
  return { weights, diagnostics: latestModelDiagnostics };
}, { startIndex: 756, note: "Version 3.5 walk-forward boosted stumps with JP Morgan AI factor features, regime/liquidity/crowding inputs and additive feature attribution.", group: "V3" });
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

const coreModels = [v1, v2, v3];
const allResearchModels = [...coreModels, ...customStrategies];
const output = {
  generatedAt: new Date().toISOString(),
  version: "3.5",
  versionLabel: researchVersion,
  assumptions: { data: "Adjusted daily public US stock histories with ETF risk-factor overlays", rebalance: "Weekly, prior-close information only", transactionCost: costRate, sharpeRiskFreeRate: 0, researchParams: params, jpMorganEnhancement: "Version 3.5 adds a shared JP Morgan-inspired AI factor score across momentum, quality, low-vol, liquidity, regime and crowding controls." },
  coreModels,
  strategies: customStrategies,
  benchmarks,
  strategyCorrelation: alignedCorrelation(allResearchModels)
};
await fs.writeFile(new URL("outputs/data/all-strategy-backtests.json", root), JSON.stringify(output, null, 2));

let html = await fs.readFile(new URL("outputs/riskdesk.html", root), "utf8");
const start = "<!-- ALL_STRATEGY_BACKTESTS_START -->", end = "<!-- ALL_STRATEGY_BACKTESTS_END -->";
const embedded = `${start}\n<script type="application/json" id="allStrategyBacktests">${JSON.stringify(output).replaceAll("</", "<\\/")}</script>\n${end}`;
const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
html = marker.test(html) ? html.replace(marker, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(new URL("outputs/riskdesk.html", root), html);

console.log(JSON.stringify({ core: coreModels.map(item => ({ name: item.name, metrics: item.metrics, latest: item.latestRebalance })), strategies: customStrategies.map(item => ({ name: item.name, group: item.group, metrics: item.metrics })), benchmarks: benchmarks.map(item => ({ name: item.name, metrics: item.metrics })) }, null, 2));
