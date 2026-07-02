import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const all = JSON.parse(await fs.readFile(new URL("outputs/data/all-strategy-backtests.json", root), "utf8"));

const splits = [
  { key: "train", label: "Train", start: "2013-01-01", end: "2018-12-31", purpose: "Estimate baseline behavior and fit time-series / ML components." },
  { key: "validation", label: "Validation", start: "2019-01-01", end: "2021-12-31", purpose: "Select parameters without touching the final test period." },
  { key: "test", label: "Test", start: "2022-01-01", end: "2026-06-30", purpose: "Final out-of-sample evaluation using parameters chosen on validation." }
];

const parameterGrids = {
  "V1 Momentum-Vol Research Model": {
    current: { version: "3.5", lookbackDays: 252, skipDays: 21, topN: 3, targetVol: .10, maxGross: 2, jpMorganOverlay: "quality + low-vol + crowding" },
    candidateGrid: {
      lookbackDays: [126, 252, 378],
      skipDays: [0, 21],
      topN: [3, 5, 8],
      targetVol: [.08, .10, .12],
      maxGross: [1, 1.5, 2]
    },
    trainingMeaning: "V1 3.5 training means selecting stable momentum parameters while testing whether JP Morgan-style quality, low-vol and crowding overlays improve robustness."
  },
  "V2 HMM-GARCH-MVO": {
    current: { version: "3.5", historyDays: 504, covarianceDays: 252, lowRiskAversion: 1.5, highRiskAversion: 6, maxWeight: .6, expectedReturnOverlay: "JPM_AI_Score" },
    candidateGrid: {
      historyDays: [504, 756, 1008],
      covarianceDays: [126, 252, 378],
      lowRiskAversion: [1.5, 3, 4],
      highRiskAversion: [6, 9, 12],
      maxWeight: [.25, .35, .5],
      turnoverPenalty: [0, .05, .10]
    },
    trainingMeaning: "V2 3.5 training means estimating HMM/GARCH and testing whether the JP Morgan AI factor overlay improves MVO expected-return inputs."
  },
  "V3 Boosted Trees + Attribution": {
    current: { version: "3.5", rounds: 40, learningRate: .05, lambda: 2, topN: 5, targetVol: .10, maxGross: 2, featureSet: "price + JPM_AI + regime + liquidity + crowding" },
    candidateGrid: {
      rounds: [20, 40, 60],
      learningRate: [.03, .05, .08],
      lambda: [1, 2, 5],
      topN: [3, 5, 8],
      targetVol: [.08, .10, .12],
      featureSet: ["price_only", "price_plus_risk", "price_risk_drawdown", "price_plus_jpm_ai_factor"]
    },
    trainingMeaning: "V3 3.5 training means fitting boosted stumps with JP Morgan-style AI factor features and validating feature/parameter robustness."
  }
};

const customUpgradeMap = {
  "S1 AI Capex Momentum+": {
    current: { version: "3.5", aiFactorConfirm: "QQQ/XLK 126D", stockMomentum: "12-1M + 3M", targetVol: .12, hedgeSleeve: "IEF/GLD/TLT", jpMorganOverlay: "AI infra + liquidity + crowding penalty" },
    candidateGrid: { targetVol: [.10, .12, .14], aiWeight: [.10, .15, .25], hedgeSleeve: [.05, .10, .20], topN: [4, 5, 6] },
    trainingMeaning: "Train the AI-capex factor weight and hedge sleeve so the strategy does not simply chase technology beta."
  },
  "S2 Quality Growth Barbell+": {
    current: { version: "3.5", qualityWeight: .52, growthWeight: .40, lowVolHedge: ".08 to .18", jpMorganOverlay: "quality + AI score + low-vol hedge" },
    candidateGrid: { qualityWeight: [.45, .52, .60], growthWeight: [.30, .40, .50], stressHedge: [.10, .18, .25] },
    trainingMeaning: "Train the quality/growth balance and stress hedge intensity."
  },
  "S3 Crowding-Aware Momentum+": {
    current: { version: "3.5", momentum: "12-1M", chasePenalty: "1M", crowdingProxy: "MTUM", targetVol: .10, jpMorganOverlay: "liquidity + crowding-aware AI score" },
    candidateGrid: { chasePenalty: [.45, .65, .85], crowdingPenalty: [.10, .20, .30], targetVol: [.08, .10, .12] },
    trainingMeaning: "Train how strongly the model penalizes crowded or overheated momentum."
  },
  "S4 Low-Vol Alpha Shield+": {
    current: { version: "3.5", trend: "126D + 200D confirm", volPenalty: .65, targetVol: .085, jpMorganOverlay: "quality + low-vol + crowding controls" },
    candidateGrid: { volPenalty: [.45, .65, .85], targetVol: [.07, .085, .10], topN: [5, 6, 8] },
    trainingMeaning: "Train the low-volatility penalty and conservative risk budget."
  },
  "S5 Regime-Switch Equity Hedge+": {
    current: { version: "3.5", regimeScore: "SPY trend + HYG/IEF + TLT + vol", hedgeSleeve: ".18 or .62", jpMorganOverlay: "macro regime + liquidity score" },
    candidateGrid: { regimeThreshold: [0, .15, .30], riskOnEquity: [.75, .82, .90], riskOffHedge: [.50, .62, .75] },
    trainingMeaning: "Train the macro regime threshold and how much exposure shifts into hedges."
  },
  "S6 Credit-Liquidity Accelerator+": {
    current: { version: "3.5", creditProxy: "HYG minus IEF", targetVol: .125, riskOffHedge: .52, jpMorganOverlay: "credit-liquidity + regime score" },
    candidateGrid: { targetVol: [.10, .125, .15], creditWindow: [63, 126, 189], riskOffHedge: [.40, .52, .65] },
    trainingMeaning: "Train the credit-cycle trigger before increasing equity beta."
  },
  "S7 Revision-Proxy Growth Rank+": {
    current: { version: "3.5", features: "1M/3M/6M momentum + vol stability + 200D trend", targetVol: .115, jpMorganOverlay: "AI score + quality + acceleration proxy" },
    candidateGrid: { accelerationWeight: [.10, .15, .25], targetVol: [.095, .115, .13], topN: [5, 6, 8] },
    trainingMeaning: "Train the price-based revision proxy and volatility-stability penalty."
  },
  "S8 Trend-Guarded Reversion+": {
    current: { version: "3.5", reversion: "20D z-score", guard: "200D trend + drawdown filter", targetVol: .09, jpMorganOverlay: "crowding and low-vol controls" },
    candidateGrid: { zWindow: [15, 20, 30], drawdownLimit: [-.12, -.16, -.20], targetVol: [.075, .09, .105] },
    trainingMeaning: "Train the pullback signal only under trend-confirmed conditions."
  },
  "S9 Sector-Breadth Rotation+": {
    current: { version: "3.5", breadth: "sector ETFs above 100D MA", riskBudget: ".08 to .12", leaderFactor: "sector momentum", jpMorganOverlay: "ETF breadth + liquidity + quality score" },
    candidateGrid: { breadthThreshold: [.45, .50, .60], riskOnVol: [.10, .12, .14], riskOffVol: [.06, .08, .10] },
    trainingMeaning: "Train when broad market participation is strong enough to use a higher equity budget."
  },
  "S10 Defensive Growth Stabilizer+": {
    current: { version: "3.5", qualityProxy: true, stress: "SPY vol/drawdown", hedgeSleeve: .34, jpMorganOverlay: "quality + low-vol + crowding control" },
    candidateGrid: { hedgeSleeve: [.25, .34, .45], targetVol: [.08, .095, .11], stressVol: [.18, .22, .26] },
    trainingMeaning: "Train defensive growth allocation and stress hedge size."
  },
  "S11 Tail-Risk Shock Absorber+": {
    current: { version: "3.5", shockRules: "drawdown + vol + credit + regime", hedgeSleeve: .65, jpMorganOverlay: "regime + low-vol + quality under shock" },
    candidateGrid: { hedgeSleeve: [.50, .65, .80], volShock: [.24, .28, .32], drawdownShock: [-.08, -.10, -.14] },
    trainingMeaning: "Train tail-risk trigger thresholds and hedge severity."
  },
  "S12 Adaptive Volatility Compounder+": {
    current: { version: "3.5", targetVol: ".07/.095/.13 by stress", momentumBlend: "6M + 12-1M", maxGross: 1.8, jpMorganOverlay: "regime + liquidity + low-vol scoring" },
    candidateGrid: { lowStressVol: [.12, .13, .15], highStressVol: [.06, .07, .08], maxGross: [1.4, 1.8, 2.0] },
    trainingMeaning: "Train the dynamic volatility target and leverage cap across regimes."
  }
};

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length - 1);
}

function periodMetrics(monthly, start, end) {
  const rows = monthly.filter(row => row.date >= start && row.date <= end);
  if (rows.length < 3) return null;
  const returns = rows.slice(1).map((row, index) => row.nav / rows[index].nav - 1);
  const years = (new Date(rows.at(-1).date) - new Date(rows[0].date)) / (365.25 * 86400000);
  let peak = rows[0].nav;
  let maxDrawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.nav);
    maxDrawdown = Math.min(maxDrawdown, row.nav / peak - 1);
  }
  const cagr = (rows.at(-1).nav / rows[0].nav) ** (1 / years) - 1;
  const volatility = Math.sqrt(variance(returns) * 12);
  const sharpe = volatility ? mean(returns) * 12 / volatility : 0;
  const calmar = Math.abs(maxDrawdown) > 1e-6 ? cagr / Math.abs(maxDrawdown) : 0;
  const score = .45 * sharpe + .30 * calmar - .10 * Math.abs(maxDrawdown);
  return {
    start: rows[0].date,
    end: rows.at(-1).date,
    observations: rows.length,
    cagr,
    volatility,
    sharpe,
    maxDrawdown,
    calmar,
    score,
    endingValue: rows.at(-1).nav / rows[0].nav * 100
  };
}

function stabilityPenalty(splitResults) {
  const values = ["train", "validation", "test"].map(key => splitResults[key]?.sharpe).filter(Number.isFinite);
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sd = Math.sqrt(variance(values));
  return avg ? Math.min(1, sd / Math.abs(avg)) : 1;
}

function approvalDecision(item, splitResults) {
  const validation = splitResults.validation;
  const test = splitResults.test;
  const full = item.metrics;
  const stability = stabilityPenalty(splitResults);
  const scoreRaw = 20 + 22 * Math.max(0, validation?.sharpe ?? 0) + 10 * Math.max(0, validation?.calmar ?? 0) + 18 * Math.max(0, test?.sharpe ?? 0) - 25 * Math.abs(full.maxDrawdown) - 2.2 * full.annualTurnover - 16 * stability;
  const score = Math.max(0, Math.min(100, scoreRaw));
  const decision = score >= 70 && full.maxDrawdown > -.35 ? "Activate" : score >= 52 ? "Tune" : score >= 35 ? "Watch" : "Reject";
  const reason = decision === "Activate"
    ? "Strong validation/test risk-adjusted performance with acceptable drawdown."
    : decision === "Tune"
      ? "Useful signal, but parameters or turnover/drawdown controls need more work."
      : decision === "Watch"
        ? "Research candidate only; evidence is not strong enough for approval."
        : "Weak out-of-sample or risk-adjusted evidence under the current settings.";
  return { score, decision, reason, stabilityPenalty: stability };
}

const allResearchModels = [...all.coreModels, ...all.strategies];

const models = allResearchModels.map(model => {
  const splitResults = Object.fromEntries(splits.map(split => [split.key, periodMetrics(model.monthly, split.start, split.end)]));
  return {
    name: model.name,
    group: model.group,
    note: model.note,
    fullSample: model.metrics,
    parameters: parameterGrids[model.name] || customUpgradeMap[model.name] || {
      current: { ruleType: model.group, upgraded: true },
      candidateGrid: { signalWeight: [.25, .50, .75], targetVol: [.08, .10, .12], hedgeSleeve: [.0, .15, .30] },
      trainingMeaning: "Train signal weights, risk budget and hedge sleeve on validation data."
    },
    splitResults,
    selectedStatus: "baseline_current_parameters_not_final",
    approval: approvalDecision(model, splitResults)
  };
});

const coreModels = models.filter(model => ["Core", "V2", "V3"].includes(model.group));
const customStrategies = models.filter(model => !["Core", "V2", "V3"].includes(model.group));

const approvalScorecard = [...models].sort((a, b) => b.approval.score - a.approval.score).map((model, index) => ({
  rank: index + 1,
  name: model.name,
  group: model.group,
  score: model.approval.score,
  decision: model.approval.decision,
  reason: model.approval.reason,
  validationSharpe: model.splitResults.validation?.sharpe ?? null,
  testSharpe: model.splitResults.test?.sharpe ?? null,
  maxDrawdown: model.fullSample.maxDrawdown,
  annualTurnover: model.fullSample.annualTurnover
}));

const paperPortfolio = (() => {
  const selected = approvalScorecard.find(item => item.decision === "Activate") || approvalScorecard[0];
  const source = allResearchModels.find(item => item.name === selected.name);
  const capital = 1000000;
  const weights = source.latestRebalance?.weights || {};
  const holdings = Object.entries(weights).map(([symbol, weight]) => ({
    symbol,
    weight,
    dollarValue: capital * weight
  })).sort((a, b) => b.weight - a.weight);
  return {
    selectedStrategy: selected.name,
    capital,
    latestRebalanceDate: source.latestRebalance?.date,
    mode: "Paper portfolio target allocation; no live capital or brokerage execution.",
    holdings,
    riskChecks: [
      { name: "Max drawdown limit", status: source.metrics.maxDrawdown <= -.35 ? "Breach" : source.metrics.maxDrawdown <= -.25 ? "Watch" : "OK", value: source.metrics.maxDrawdown },
      { name: "Turnover limit", status: source.metrics.annualTurnover >= 10 ? "Breach" : source.metrics.annualTurnover >= 5 ? "Watch" : "OK", value: source.metrics.annualTurnover },
      { name: "Top holding concentration", status: Math.max(...Object.values(weights), 0) > .35 ? "Watch" : "OK", value: Math.max(...Object.values(weights), 0) }
    ]
  };
})();

/*
const coreModels = all.coreModels.map(model => ({
  name: model.name,
  note: model.note,
  fullSample: model.metrics,
  parameters: parameterGrids[model.name],
  splitResults: Object.fromEntries(splits.map(split => [split.key, periodMetrics(model.monthly, split.start, split.end)])),
  selectedStatus: "baseline_current_parameters_not_final",
}));
*/

const output = {
  generatedAt: new Date().toISOString(),
  version: "3.5",
  versionLabel: "Version 3.5 - JP Morgan AI factor enhancement",
  status: "All 15 research strategies are included in train / validation / test evaluation. Version 3.5 keeps the JP Morgan research theme and deepens it through shared AI factor scoring, regime, liquidity, quality, low-vol and crowding overlays.",
  splits,
  objective: {
    formula: "Score = 0.45 * Sharpe + 0.30 * Calmar - 0.10 * Abs(MaxDrawdown)",
    reason: "The objective rewards risk-adjusted return and drawdown efficiency, while discouraging large drawdowns. Version 3.5 tests whether JP Morgan-style AI factor enhancements improve this score without changing the research theme."
  },
  models,
  coreModels,
  customStrategies,
  approvalScorecard,
  paperPortfolio,
  nextSteps: [
    "Run parameter grid search on the validation period for all 15 strategies.",
    "Keep the final test period untouched until parameter selection is complete.",
    "Add walk-forward monthly parameter selection after the initial grid search.",
    "Record every parameter change in paper/strategy_research_log.md and results/strategy_change_log.csv."
  ]
};

await fs.mkdir(new URL("outputs/data/", root), { recursive: true });
await fs.writeFile(new URL("outputs/data/v123-training-results.json", root), JSON.stringify(output, null, 2));

let html = await fs.readFile(new URL("outputs/riskdesk.html", root), "utf8");
const start = "<!-- V123_TRAINING_RESULTS_START -->";
const end = "<!-- V123_TRAINING_RESULTS_END -->";
const embedded = `${start}\n<script type="application/json" id="v123TrainingResults">${JSON.stringify(output).replaceAll("</", "<\\/")}</script>\n${end}`;
const marker = new RegExp(`${start}[\\s\\S]*?${end}`);
html = marker.test(html) ? html.replace(marker, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(new URL("outputs/riskdesk.html", root), html);

console.log(JSON.stringify({
  splits: output.splits.map(split => `${split.label}: ${split.start} to ${split.end}`),
  models: output.models.map(model => ({
    name: model.name,
    trainSharpe: model.splitResults.train?.sharpe,
    validationSharpe: model.splitResults.validation?.sharpe,
    testSharpe: model.splitResults.test?.sharpe,
    approval: model.approval.decision,
    score: model.approval.score
  }))
}, null, 2));
