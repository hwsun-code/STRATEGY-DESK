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

function addCalendarDays(dateText, offset) {
  const date = new Date(`${dateText || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function syntheticDailyPoints(asset, length = 260) {
  const latest = Number(asset?.latest);
  if (!Number.isFinite(latest) || latest <= 0) return [];
  const change1m = Number(asset.change1m || 0);
  const momentum12 = Number(asset.momentum12_1 || 0);
  const annualVol = Math.max(0.05, Math.min(1.2, Number(asset.volatility60d || 0.25)));
  const endDate = asset.latestDate || new Date().toISOString().slice(0, 10);
  const drift = Math.max(-0.0015, Math.min(0.0015, momentum12 / 252));
  const monthTilt = Math.max(-0.002, Math.min(0.002, change1m / 21));
  const dailyVol = annualVol / Math.sqrt(252);
  let price = latest / Math.max(0.2, 1 + change1m);
  const points = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    const phase = Math.sin(i * 0.37) * dailyVol * 0.45 + Math.cos(i * 0.11) * dailyVol * 0.25;
    const step = drift + monthTilt * (i < 22 ? 1 : 0.25) + phase;
    price = Math.max(0.01, price * (1 + step));
    points.push({ date: addCalendarDays(endDate, -i), price });
  }
  const scale = latest / points[points.length - 1].price;
  return points.map(point => ({ date: point.date, price: point.price * scale }));
}

function embeddedStock(symbol) {
  const snapshot = embeddedJson("publicMarketSnapshot");
  const asset = snapshot?.assets?.[symbol];
  if (!asset) return null;
  const rawDaily = Array.isArray(asset.daily) ? asset.daily : [];
  const dailyPoints = rawDaily.map(row => ({ date: row[0], price: Number(row[1]) })).filter(row => Number.isFinite(row.price));
  const points = dailyPoints.length >= 60 ? dailyPoints : syntheticDailyPoints(asset);
  return {
    symbol,
    provider: dailyPoints.length >= 60 ? "Embedded public snapshot" : "Embedded EODHD factor snapshot synthetic path",
    currency: asset.currency || "USD",
    latestDate: asset.latestDate,
    points,
    mode: dailyPoints.length >= 60 ? "fallback" : "synthetic-factor-fallback"
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
