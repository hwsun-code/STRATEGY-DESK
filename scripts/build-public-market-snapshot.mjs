import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`None of these files exist: ${candidates.map(item => item.pathname).join(", ")}`);
}
const htmlPath = await firstExisting([
  new URL("outputs/riskdesk.html", root),
  new URL("riskdesk.html", root),
  new URL("index.html", root)
]);
const cacheRoot = new URL(`file:///${(process.env.RISKDESK_MARKET_CACHE || "D:/RiskDesk_Research/market-data").replaceAll("\\", "/").replace(/\/?$/, "/")}`);
const jsonPath = new URL("public-market-snapshot-full.json", cacheRoot);
const repoOutputJsonPath = new URL("outputs/data/public-market-snapshot.json", root);
const slimJsonPath = new URL("data/public-market-snapshot.json", root);
const universePath = new URL("data/global-500-universe.json", root);
const markerStart = "<!-- PUBLIC_MARKET_SNAPSHOT_START -->";
const markerEnd = "<!-- PUBLIC_MARKET_SNAPSHOT_END -->";
const universe = JSON.parse(await fs.readFile(universePath, "utf8"));
const symbols = [...new Set([...(universe.stockSymbols || []), ...(universe.riskFactorSymbols || [])])];

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RiskDesk research dashboard" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RiskDesk research dashboard" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function cacheFile(symbol) {
  const safe = symbol.replace(/[^A-Z0-9.-]/gi, "_");
  return new URL(`histories/${safe}.json`, cacheRoot);
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function returns(values) {
  return values.slice(1).map((value, index) => value / values[index] - 1);
}

function volatility(values) {
  if (values.length < 3) return null;
  const r = returns(values);
  const mean = r.reduce((sum, value) => sum + value, 0) / r.length;
  const variance = r.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function maxDrawdown(values) {
  let peak = values[0];
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

async function loadAsset(symbol) {
  const file = cacheFile(symbol);
  if (process.env.RISKDESK_REFRESH_CACHE !== "1") {
    try {
      const cached = JSON.parse(await fs.readFile(file, "utf8"));
      if (cached?.daily?.length >= 240) return cached;
    } catch {}
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=div%2Csplits`;
  const payload = await fetchJSON(url);
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${symbol}`);
  const timestamps = result.timestamp || [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  const daily = timestamps.map((timestamp, index) => [new Date(timestamp * 1000).toISOString().slice(0, 10), adjusted[index]])
    .filter(([, close]) => Number.isFinite(close))
    .map(([date, close]) => [date, round(close, 4)]);
  const closes = daily.map(item => item[1]);
  const latest = closes.at(-1);
  const oneMonthBase = closes.at(-22) ?? closes[0];
  const twelveMonthBase = closes.at(-253) ?? closes[0];
  const skipMonthClose = closes.at(-22) ?? latest;
  const recent = closes.slice(-756);
  const asset = {
    currency: result.meta?.currency || "USD",
    exchange: result.meta?.exchangeName || "",
    latestDate: daily.at(-1)?.[0] || null,
    latest: round(latest, 2),
    change1m: round(latest / oneMonthBase - 1),
    momentum12_1: round(skipMonthClose / twelveMonthBase - 1),
    volatility60d: round(volatility(closes.slice(-61))),
    maxDrawdown3y: round(maxDrawdown(recent)),
    daily,
    cachedAt: new Date().toISOString()
  };
  await fs.mkdir(new URL("histories/", cacheRoot), { recursive: true });
  await fs.writeFile(file, JSON.stringify(asset));
  return asset;
}

async function loadFred(series) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
  const rows = csv.trim().split(/\r?\n/).slice(1).map(line => line.split(","));
  const latest = rows.reverse().find(([, value]) => value && value !== ".");
  return latest ? { date: latest[0], value: Number(latest[1]) } : null;
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    const settled = await Promise.allSettled(chunk.map(mapper));
    results.push(...settled);
    console.log(`Loaded batch ${Math.min(index + limit, items.length)}/${items.length}`);
  }
  return results;
}

const settled = await mapLimit(symbols, Number(process.env.RISKDESK_FETCH_CONCURRENCY || 12), loadAsset);
const assets = {};
const errors = [];
settled.forEach((result, index) => {
  if (result.status === "fulfilled") assets[symbols[index]] = result.value;
  else errors.push({ symbol: symbols[index], error: result.reason.message });
});

const macroPairs = await Promise.all([
  loadFred("DGS10"),
  loadFred("DFF"),
  loadFred("VIXCLS"),
  loadFred("BAMLH0A0HYM2")
]);

const snapshot = {
  source: "Yahoo Finance chart endpoint; Federal Reserve Bank of St. Louis FRED",
  generatedAt: new Date().toISOString(),
  cacheRoot: cacheRoot.pathname,
  universe: {
    primary: universe.label,
    universeId: universe.universeId,
    methodology: universe.methodology,
    targetAllocation: universe.targetAllocation,
    actualAllocation: universe.actualAllocation,
    stockSymbols: universe.stockSymbols,
    riskFactorSymbols: universe.riskFactorSymbols,
    note: "Stocks are the investable strategy universe. ETFs are retained separately as risk factors, hedges, and benchmarks."
  },
  assets,
  macro: {
    treasury10y: macroPairs[0],
    fedFunds: macroPairs[1],
    vix: macroPairs[2],
    highYieldSpread: macroPairs[3]
  },
  errors
};
const slimSnapshot = {
  ...snapshot,
  assets: Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => [symbol, {
    currency: asset.currency,
    exchange: asset.exchange,
    latestDate: asset.latestDate,
    latest: asset.latest,
    change1m: asset.change1m,
    momentum12_1: asset.momentum12_1,
    volatility60d: asset.volatility60d,
    maxDrawdown3y: asset.maxDrawdown3y
  }]))
};

await fs.mkdir(cacheRoot, { recursive: true });
await fs.mkdir(new URL("outputs/data/", root), { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2));
await fs.writeFile(repoOutputJsonPath, JSON.stringify(slimSnapshot, null, 2));
await fs.writeFile(slimJsonPath, JSON.stringify(slimSnapshot, null, 2));

let html = await fs.readFile(htmlPath, "utf8");
const embedded = `${markerStart}\n<script type="application/json" id="publicMarketSnapshot">${JSON.stringify(slimSnapshot).replaceAll("</", "<\\/")}</script>\n${markerEnd}`;
const existing = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);
html = existing.test(html) ? html.replace(existing, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(htmlPath, html);

console.log(`Loaded ${Object.keys(assets).length}/${symbols.length} Global 500 assets; ${errors.length} errors.`);
console.log(`Cache: ${cacheRoot.pathname}`);
console.log(`Snapshot: ${jsonPath.pathname}`);
