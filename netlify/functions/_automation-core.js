const {
  embeddedJson,
  fetchYahooChart,
  pointsFromChart,
  embeddedStock
} = require("./_riskdesk-common");

const LEDGER_KEY = "forward-ledger.json";
const STATUS_KEY = "automation-status.json";

async function blobStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    return getStore("riskdesk-forward-ledger");
  } catch {
    return null;
  }
}

async function readJson(store, key, fallback) {
  if (!store) return fallback;
  try {
    const value = await store.get(key, { type: "json" });
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(store, key, value) {
  if (!store) return false;
  try {
    await store.setJSON(key, value);
    return true;
  } catch {
    return false;
  }
}

function addTradingDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)));
}

function pctChange(prices, lookback) {
  if (prices.length <= lookback) return 0;
  const last = prices[prices.length - 1];
  const prior = prices[prices.length - 1 - lookback];
  return prior ? last / prior - 1 : 0;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-clamp(value, -8, 8)));
}

function modelList() {
  const all = embeddedJson("allStrategyBacktests") || {};
  return [...(all.coreModels || []), ...(all.strategies || [])].filter(item => item?.name);
}

function weightsFromModel(model, stockSymbols) {
  const stockSet = new Set(stockSymbols);
  const source = model?.latestRebalance?.weights || model?.latestRebalance?.holdings || model?.latestRebalance || [];
  let pairs = [];
  if (Array.isArray(source)) {
    pairs = source.map(item => Array.isArray(item)
      ? [String(item[0] || "").toUpperCase(), Number(item[1])]
      : [String(item.symbol || item.ticker || "").toUpperCase(), Number(item.weight ?? item.value ?? item.allocation)]);
  } else if (source && typeof source === "object") {
    pairs = Object.entries(source).map(([symbol, weight]) => [String(symbol).toUpperCase(), Number(weight)]);
  }
  pairs = pairs.filter(([symbol, weight]) => stockSet.has(symbol) && Number.isFinite(weight) && weight > 0);
  if (pairs.length) return pairs.sort((a, b) => b[1] - a[1]).slice(0, 5);
  return stockSymbols.slice(0, 5).map(symbol => [symbol, 1 / 5]);
}

async function historyFor(symbol) {
  try {
    const result = await fetchYahooChart(symbol, "1y", "1d");
    const points = pointsFromChart(result);
    if (points.length >= 80) return { symbol, points, provider: "Yahoo Finance chart API" };
  } catch {
    // Fall through to embedded snapshot.
  }
  const fallback = embeddedStock(symbol);
  return {
    symbol,
    points: fallback?.points?.slice(-260) || [],
    provider: fallback?.provider || "Embedded public snapshot"
  };
}

function forecastRow({ model, symbol, weight, history, horizonDays }) {
  const points = history.points;
  if (!points || points.length < 60) return null;
  const prices = points.map(point => Number(point.price)).filter(Number.isFinite);
  const latest = points[points.length - 1];
  const currentPrice = prices[prices.length - 1];
  const returns = prices.slice(1).map((price, index) => price / prices[index] - 1);
  const mom5 = pctChange(prices, 5);
  const mom20 = pctChange(prices, 20);
  const mom60 = pctChange(prices, 60);
  const vol20 = stdev(returns.slice(-20)) * Math.sqrt(252);
  const trendScore = 0.5 * mom20 + 0.35 * mom60 + 0.15 * mom5;
  const raw = trendScore * Math.sqrt(horizonDays / 20) - Math.max(0, vol20 - 0.28) * 0.035;
  const cap = horizonDays <= 1 ? 0.02 : horizonDays <= 5 ? 0.055 : 0.12;
  const predictedReturn = clamp(raw, -cap, cap);
  const horizonVol = Math.max(0.003, vol20 / Math.sqrt(252) * Math.sqrt(horizonDays));
  const probabilityUp = sigmoid(predictedReturn / horizonVol);
  const threshold = horizonDays <= 1 ? 0.004 : horizonDays <= 5 ? 0.011 : 0.025;
  const signal = predictedReturn > threshold && probabilityUp > 0.54
    ? "Buy"
    : predictedReturn < -threshold && probabilityUp < 0.46
      ? "Reduce"
      : "Hold";
  return {
    strategy: model.name,
    horizonDays,
    symbol,
    forecastDate: latest.date,
    dueDate: addTradingDays(latest.date, horizonDays),
    currentPrice,
    predictedReturn,
    predictedPrice: currentPrice * (1 + predictedReturn),
    probabilityUp,
    signal,
    targetWeight: weight,
    confidence: clamp(Math.abs(probabilityUp - 0.5) * 2 + Math.min(0.2, Math.abs(mom20) * 2), 0, 1),
    provider: history.provider,
    automationVersion: "weekly-v1"
  };
}

function validateRows(rows, historiesBySymbol) {
  let checked = 0;
  let hit = 0;
  const today = new Date().toISOString().slice(0, 10);
  const nextRows = rows.map(row => {
    if (row.actualStatus === "Hit" || row.actualStatus === "Miss") return row;
    if (!row.dueDate || row.dueDate > today) return { ...row, actualStatus: "Pending" };
    const points = historiesBySymbol.get(row.symbol)?.points || [];
    const actual = points.find(point => point.date >= row.dueDate);
    if (!actual) return { ...row, actualStatus: "Pending" };
    const actualReturn = Number(actual.price) / Number(row.currentPrice) - 1;
    const isHit = Math.sign(actualReturn) === Math.sign(row.predictedReturn) || Math.abs(row.predictedReturn) < 0.002;
    checked += 1;
    if (isHit) hit += 1;
    return {
      ...row,
      actualStatus: isHit ? "Hit" : "Miss",
      actualDate: actual.date,
      actualPrice: Number(actual.price),
      actualReturn,
      absoluteError: Math.abs(actualReturn - Number(row.predictedReturn))
    };
  });
  return { rows: nextRows, checked, hit };
}

function rowId(row) {
  return [row.strategy, row.horizonDays, row.symbol, row.forecastDate, row.automationVersion || ""].join("|");
}

async function runWeeklyAutomation({ source = "scheduled" } = {}) {
  const store = await blobStore();
  const existingRows = await readJson(store, LEDGER_KEY, []);
  const snapshot = embeddedJson("publicMarketSnapshot") || {};
  const stockSymbols = snapshot.universe?.stockSymbols || [];
  const models = modelList();
  const selectedModels = models.slice(0, 15);
  const wantedSymbols = new Set();
  for (const model of selectedModels) {
    for (const [symbol] of weightsFromModel(model, stockSymbols)) wantedSymbols.add(symbol);
  }
  const histories = await Promise.all([...wantedSymbols].map(historyFor));
  const historiesBySymbol = new Map(histories.map(history => [history.symbol, history]));
  const validation = validateRows(existingRows, historiesBySymbol);
  const newRows = [];
  for (const model of selectedModels) {
    for (const horizonDays of [5]) {
      const weights = weightsFromModel(model, stockSymbols);
      const weightSum = weights.reduce((sum, [, weight]) => sum + weight, 0) || 1;
      for (const [symbol, rawWeight] of weights) {
        const history = historiesBySymbol.get(symbol) || await historyFor(symbol);
        const row = forecastRow({ model, symbol, weight: rawWeight / weightSum, history, horizonDays });
        if (row) newRows.push({ ...row, recordedAt: new Date().toISOString(), source });
      }
    }
  }
  const seen = new Set();
  const mergedRows = [...validation.rows, ...newRows]
    .filter(row => {
      const id = rowId(row);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(-1500);
  const saved = await writeJson(store, LEDGER_KEY, mergedRows);
  const status = {
    source,
    ranAt: new Date().toISOString(),
    saved,
    storage: store ? "Netlify Blobs" : "No persistent store available",
    generated: newRows.length,
    totalRows: mergedRows.length,
    checked: validation.checked,
    hits: validation.hit,
    hitRate: validation.checked ? validation.hit / validation.checked : null,
    models: selectedModels.length,
    symbols: [...wantedSymbols],
    note: saved ? "Weekly automation generated forecasts and validated due rows." : "Automation ran, but persistent cloud storage is not available."
  };
  await writeJson(store, STATUS_KEY, status);
  return { status, rows: mergedRows.slice(-100) };
}

async function automationStatus() {
  const store = await blobStore();
  const status = await readJson(store, STATUS_KEY, null);
  const rows = await readJson(store, LEDGER_KEY, []);
  const pending = rows.filter(row => row.actualStatus !== "Hit" && row.actualStatus !== "Miss").length;
  const checked = rows.filter(row => row.actualStatus === "Hit" || row.actualStatus === "Miss");
  const hits = checked.filter(row => row.actualStatus === "Hit").length;
  return {
    source: "RiskDesk weekly automation",
    storage: store ? "Netlify Blobs" : "No persistent store available",
    latestRun: status,
    ledgerRows: rows.length,
    pending,
    checked: checked.length,
    hitRate: checked.length ? hits / checked.length : null
  };
}

module.exports = {
  runWeeklyAutomation,
  automationStatus
};
