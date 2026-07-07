const fs = require("fs");
const path = require("path");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify(payload)
  };
}

function indexHtml() {
  const candidates = [
    path.join(process.cwd(), "index.html"),
    path.join(__dirname, "..", "..", "index.html"),
    path.join(process.cwd(), "outputs", "index.html"),
    path.join(__dirname, "..", "..", "outputs", "index.html")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  throw new Error("outputs/index.html not found in deployed bundle");
}

const embeddedCache = new Map();

function embeddedJson(id) {
  if (embeddedCache.has(id)) return embeddedCache.get(id);
  const html = indexHtml();
  const pattern = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`);
  const match = html.match(pattern);
  if (!match) return null;
  const parsed = JSON.parse(match[1]);
  embeddedCache.set(id, parsed);
  return parsed;
}

function symbolsFrom(event) {
  const raw = event.queryStringParameters?.symbols || "";
  return [...new Set(raw.split(",").map(item => item.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
}

function yahooSymbol(symbol) {
  return String(symbol || "").replace(".", "-").toUpperCase();
}

async function fetchYahooChart(symbol, range = "1y", interval = "1d") {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`;
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "Mozilla/5.0 RiskDesk/1.0",
      "accept": "application/json,text/plain,*/*"
    }
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result?.meta) throw new Error("Yahoo chart missing result");
  return result;
}

function quoteFromChart(symbol, result) {
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close.filter(value => Number.isFinite(Number(value))) : [];
  const latest = Number(meta.regularMarketPrice ?? closes[closes.length - 1]);
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2]);
  if (!Number.isFinite(latest)) throw new Error("Yahoo chart missing latest price");
  return {
    symbol,
    latest,
    change: Number.isFinite(previous) && previous !== 0 ? latest / previous - 1 : null,
    asOf: Number.isFinite(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    currency: meta.currency || "USD",
    source: "Yahoo Finance chart API",
    mode: "realtime-api"
  };
}

function pointsFromChart(result) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || quote.close || [];
  return timestamps.map((time, index) => {
    const price = Number(adjusted[index]);
    if (!Number.isFinite(price)) return null;
    return { date: new Date(time * 1000).toISOString().slice(0, 10), price };
  }).filter(Boolean);
}

function embeddedQuote(symbol) {
  const snapshot = embeddedJson("publicMarketSnapshot");
  const asset = snapshot?.assets?.[symbol];
  if (!asset) return null;
  return {
    symbol,
    latest: Number(asset.latest),
    change: Number(asset.change1m),
    asOf: asset.latestDate || snapshot.generatedAt,
    currency: asset.currency || "USD",
    source: "Embedded public snapshot",
    mode: "fallback"
  };
}

function embeddedStock(symbol) {
  const snapshot = embeddedJson("publicMarketSnapshot");
  const asset = snapshot?.assets?.[symbol];
  if (!asset) return null;
  return {
    symbol,
    provider: "Embedded public snapshot",
    currency: asset.currency || "USD",
    latestDate: asset.latestDate,
    points: (asset.daily || []).map(row => ({ date: row[0], price: Number(row[1]) })).filter(row => Number.isFinite(row.price)),
    mode: "fallback"
  };
}

module.exports = {
  json,
  embeddedJson,
  symbolsFrom,
  fetchYahooChart,
  quoteFromChart,
  pointsFromChart,
  embeddedQuote,
  embeddedStock
};
