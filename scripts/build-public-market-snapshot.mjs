import fs from "node:fs/promises";

const symbols = [
  "SPY", "QQQ", "IWM", "EFA", "EEM", "EWJ", "EWZ", "SHY", "IEF", "TLT", "LQD", "HYG",
  "GLD", "DBC", "VNQ", "IGF", "MTUM", "QUAL", "USMV", "VTV", "XLK", "XLF", "XLV", "XLE"
];

const root = new URL("../", import.meta.url);
const htmlPath = new URL("outputs/riskdesk.html", root);
const jsonPath = new URL("outputs/data/public-market-snapshot.json", root);
const markerStart = "<!-- PUBLIC_MARKET_SNAPSHOT_START -->";
const markerEnd = "<!-- PUBLIC_MARKET_SNAPSHOT_END -->";

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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=10y&interval=1d&events=div%2Csplits`;
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
  return {
    currency: result.meta?.currency || "USD",
    exchange: result.meta?.exchangeName || "",
    latestDate: daily.at(-1)?.[0] || null,
    latest: round(latest, 2),
    change1m: round(latest / oneMonthBase - 1),
    momentum12_1: round(skipMonthClose / twelveMonthBase - 1),
    volatility60d: round(volatility(closes.slice(-61))),
    maxDrawdown3y: round(maxDrawdown(recent)),
    daily
  };
}

async function loadFred(series) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
  const rows = csv.trim().split(/\r?\n/).slice(1).map(line => line.split(","));
  const latest = rows.reverse().find(([, value]) => value && value !== ".");
  return latest ? { date: latest[0], value: Number(latest[1]) } : null;
}

const settled = await Promise.allSettled(symbols.map(loadAsset));
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
  assets,
  macro: {
    treasury10y: macroPairs[0],
    fedFunds: macroPairs[1],
    vix: macroPairs[2],
    highYieldSpread: macroPairs[3]
  },
  errors
};

await fs.mkdir(new URL("outputs/data/", root), { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2));

let html = await fs.readFile(htmlPath, "utf8");
const embedded = `${markerStart}\n<script type="application/json" id="publicMarketSnapshot">${JSON.stringify(snapshot).replaceAll("</", "<\\/")}</script>\n${markerEnd}`;
const existing = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);
html = existing.test(html) ? html.replace(existing, embedded) : html.replace("  <script>", `  ${embedded}\n\n  <script>`);
await fs.writeFile(htmlPath, html);

console.log(`Embedded ${Object.keys(assets).length}/${symbols.length} ETF histories; ${errors.length} errors.`);
console.log(`Snapshot: ${jsonPath.pathname}`);
