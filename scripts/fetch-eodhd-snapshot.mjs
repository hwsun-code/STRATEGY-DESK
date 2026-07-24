import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.env.RISKDESK_REPO || "C:/Users/洪爱华/Documents/GitHub/STRATEGY-DESK";
const cacheRoot = process.env.RISKDESK_MARKET_CACHE || "D:/RiskDesk_Research/market-data";
const token = process.env.EODHD_API_TOKEN;
if (!token) throw new Error("Missing EODHD_API_TOKEN");

const from = process.env.EODHD_FROM || "1995-01-01";
const snapshotFrom = process.env.EODHD_SNAPSHOT_FROM || "";
const concurrency = Number(process.env.EODHD_FETCH_CONCURRENCY || 6);
const fetchTimeoutMs = Number(process.env.EODHD_FETCH_TIMEOUT_MS || 18000);
const universe = JSON.parse(await fs.readFile(path.join(repoRoot, "data/global-500-universe.json"), "utf8"));
const oldSnapshotPath = path.join(cacheRoot, "public-market-snapshot-full.json");
let oldSnapshot = { assets: {}, macro: {}, universe: {} };
try {
  oldSnapshot = JSON.parse(await fs.readFile(oldSnapshotPath, "utf8"));
} catch {}

const symbols = [...new Set([...(universe.stockSymbols || []), ...(universe.riskFactorSymbols || [])])];
const outDir = path.join(cacheRoot, "eodhd-histories");
await fs.mkdir(outDir, { recursive: true });

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function volatility(values) {
  const returns = values.slice(1).map((value, index) => value / values[index] - 1).filter(Number.isFinite);
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

function maxDrawdown(values) {
  let peak = values[0] || 1;
  let result = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    result = Math.min(result, value / peak - 1);
  }
  return result;
}

function eodhdCandidates(symbol) {
  const s = String(symbol).trim().toUpperCase();
  if (!s) return [];
  if (!s.includes(".")) return [`${s}.US`, s];
  const [base, suffix] = s.split(".");
  const map = {
    T: ["TSE"],
    TO: ["TO"],
    V: ["V"],
    AX: ["AU"],
    HK: ["HK"],
    L: ["LSE"],
    PA: ["PA"],
    AS: ["AS"],
    BR: ["BR"],
    MC: ["MC"],
    MI: ["MI"],
    SW: ["SW"],
    DE: ["XETRA", "F"],
    F: ["F"],
    ST: ["ST"],
    CO: ["CO"],
    OL: ["OL"],
    HE: ["HE"]
  };
  return (map[suffix] || [suffix]).map(exchange => `${base}.${exchange}`);
}

async function fetchSymbol(symbol) {
  const cachePath = path.join(outDir, `${symbol.replaceAll(/[\\/:*?"<>|.]/g, "_")}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (cached?.daily?.length >= 2500 && cached?.source?.includes("EODHD")) return cached;
  } catch {}

  const errors = [];
  for (const candidate of eodhdCandidates(symbol)) {
    const url = `https://eodhd.com/api/eod/${encodeURIComponent(candidate)}?api_token=${encodeURIComponent(token)}&fmt=json&from=${encodeURIComponent(from)}&period=d`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
      let response;
      try {
        response = await fetch(url, { headers: { "user-agent": "RiskDesk EODHD historical loader" }, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("non-array payload");
      const daily = payload
        .map(row => [row.date, Number(row.adjusted_close ?? row.adjustedClose ?? row.close)])
        .filter(row => row[0] && Number.isFinite(row[1]))
        .map(([date, close]) => [date, round(close, 4)]);
      if (daily.length < 240) throw new Error(`too few rows ${daily.length}`);
      const closes = daily.map(row => row[1]);
      const asset = {
        symbol,
        eodhdSymbol: candidate,
        source: "EODHD Global Stock package",
        currency: oldSnapshot.assets?.[symbol]?.currency || "",
        exchange: oldSnapshot.assets?.[symbol]?.exchange || candidate.split(".").at(-1),
        latestDate: daily.at(-1)?.[0] || null,
        latest: round(closes.at(-1), 2),
        change1m: round(closes.at(-1) / (closes.at(-22) ?? closes[0]) - 1),
        momentum12_1: round((closes.at(-22) ?? closes.at(-1)) / (closes.at(-253) ?? closes[0]) - 1),
        volatility60d: round(volatility(closes.slice(-61))),
        maxDrawdown3y: round(maxDrawdown(closes.slice(-756))),
        firstDate: daily[0]?.[0] || null,
        observations: daily.length,
        daily,
        cachedAt: new Date().toISOString()
      };
      await fs.writeFile(cachePath, JSON.stringify(asset));
      return asset;
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  const fallback = oldSnapshot.assets?.[symbol];
  if (fallback?.daily?.length) {
    return { ...fallback, source: `${fallback.source || "legacy cache"}; EODHD fallback`, eodhdErrors: errors.slice(0, 3) };
  }
  throw new Error(errors.join("; "));
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, symbol: items[index], value: await worker(items[index]) };
      } catch (error) {
        results[index] = { ok: false, symbol: items[index], error: error.message };
      }
      if ((index + 1) % 25 === 0) console.log(`Fetched ${index + 1}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return results;
}

const settled = await mapLimit(symbols, concurrency, fetchSymbol);
const assets = {};
const errors = [];
function assetForSnapshot(asset) {
  if (!snapshotFrom || !asset?.daily?.length) return asset;
  const daily = asset.daily.filter(row => row[0] >= snapshotFrom);
  if (!daily.length) return asset;
  const closes = daily.map(row => row[1]);
  return {
    ...asset,
    latestDate: daily.at(-1)?.[0] || asset.latestDate,
    latest: round(closes.at(-1), 2),
    change1m: round(closes.at(-1) / (closes.at(-22) ?? closes[0]) - 1),
    momentum12_1: round((closes.at(-22) ?? closes.at(-1)) / (closes.at(-253) ?? closes[0]) - 1),
    volatility60d: round(volatility(closes.slice(-61))),
    maxDrawdown3y: round(maxDrawdown(closes.slice(-756))),
    firstDate: daily[0]?.[0] || asset.firstDate,
    observations: daily.length,
    daily
  };
}
for (const item of settled) {
  if (item.ok) assets[item.symbol] = assetForSnapshot(item.value);
  else errors.push({ symbol: item.symbol, error: item.error });
}

const snapshot = {
  source: "EODHD Global Stock package; FRED macro from existing cache where available",
  generatedAt: new Date().toISOString(),
  cacheRoot,
  historyWindow: snapshotFrom ? `${snapshotFrom} onward for backtest tractability; raw per-symbol EODHD caches retain the full requested history.` : `${from} onward`,
  universe: {
    primary: universe.label,
    universeId: universe.universeId,
    methodology: universe.methodology,
    targetAllocation: universe.targetAllocation,
    actualAllocation: universe.actualAllocation,
    stockSymbols: universe.stockSymbols,
    riskFactorSymbols: universe.riskFactorSymbols
  },
  assets,
  macro: oldSnapshot.macro || {},
  errors
};

const slimSnapshot = {
  ...snapshot,
  assets: Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => [symbol, {
    currency: asset.currency,
    exchange: asset.exchange,
    source: asset.source,
    latestDate: asset.latestDate,
    latest: asset.latest,
    change1m: asset.change1m,
    momentum12_1: asset.momentum12_1,
    volatility60d: asset.volatility60d,
    maxDrawdown3y: asset.maxDrawdown3y,
    firstDate: asset.firstDate,
    observations: asset.observations,
    eodhdSymbol: asset.eodhdSymbol
  }]))
};

await fs.writeFile(path.join(cacheRoot, "public-market-snapshot-full.json"), JSON.stringify(snapshot, null, 2));
await fs.mkdir(path.join(repoRoot, "data"), { recursive: true });
await fs.mkdir(path.join(repoRoot, "outputs/data"), { recursive: true });
await fs.writeFile(path.join(repoRoot, "data/public-market-snapshot.json"), JSON.stringify(slimSnapshot, null, 2));
await fs.writeFile(path.join(repoRoot, "outputs/data/public-market-snapshot.json"), JSON.stringify(slimSnapshot, null, 2));

console.log(JSON.stringify({
  ok: true,
  source: snapshot.source,
  requested: symbols.length,
  loaded: Object.keys(assets).length,
  errors: errors.length,
  minFirstDate: Object.values(assets).map(asset => asset.firstDate).filter(Boolean).sort()[0],
  maxLatestDate: Object.values(assets).map(asset => asset.latestDate).filter(Boolean).sort().at(-1),
  cacheRoot
}, null, 2));
