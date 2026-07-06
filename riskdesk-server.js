const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const outputsDir = path.join(rootDir, "outputs");
const indexPath = path.join(outputsDir, "index.html");
const dataDir = path.join(rootDir, "work", "runtime-data");
const ledgerPath = path.join(dataDir, "forward-ledger.json");

const port = Number(process.env.PORT || 8787);

let embeddedCache = null;

function readIndexHtml() {
  return fs.readFileSync(indexPath, "utf8");
}

function embeddedJson(id) {
  if (!embeddedCache) embeddedCache = {};
  if (embeddedCache[id]) return embeddedCache[id];
  const html = readIndexHtml();
  const pattern = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`);
  const match = html.match(pattern);
  if (!match) return null;
  embeddedCache[id] = JSON.parse(match[1]);
  return embeddedCache[id];
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": contentType.includes("html") ? "no-store" : "public, max-age=60"
  });
  res.end(body);
}

function symbolsFrom(url) {
  const raw = url.searchParams.get("symbols") || "";
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
    source: "Yahoo Finance chart API"
  };
}

function stockPointsFromChart(result) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || quote.close || [];
  return timestamps.map((time, index) => {
    const price = Number(adjusted[index]);
    if (!Number.isFinite(price)) return null;
    return {
      date: new Date(time * 1000).toISOString().slice(0, 10),
      price
    };
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

async function handleQuotes(reqUrl, res) {
  const symbols = symbolsFrom(reqUrl);
  const quotes = {};
  const errors = {};
  await Promise.all(symbols.map(async symbol => {
    try {
      const result = await fetchYahooChart(symbol, "1d", "1m");
      quotes[symbol] = quoteFromChart(symbol, result);
    } catch (error) {
      const fallback = embeddedQuote(symbol);
      if (fallback) quotes[symbol] = fallback;
      errors[symbol] = error.message;
    }
  }));
  const fallbackCount = Object.values(quotes).filter(item => item.mode === "fallback").length;
  sendJson(res, 200, {
    source: {
      provider: fallbackCount === Object.keys(quotes).length ? "Embedded public snapshot" : "Yahoo Finance chart API",
      fetchedAt: new Date().toISOString(),
      mode: fallbackCount ? "mixed-or-fallback" : "realtime-api"
    },
    quotes,
    errors
  });
}

async function handleStocks(reqUrl, res) {
  const symbols = symbolsFrom(reqUrl);
  const range = reqUrl.searchParams.get("range") || "2y";
  const interval = reqUrl.searchParams.get("interval") || "1d";
  const data = {};
  const errors = {};
  await Promise.all(symbols.map(async symbol => {
    try {
      const result = await fetchYahooChart(symbol, range, interval);
      data[symbol] = {
        symbol,
        provider: "Yahoo Finance chart API",
        currency: result.meta?.currency || "USD",
        latestDate: Number.isFinite(result.meta?.regularMarketTime) ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null,
        points: stockPointsFromChart(result),
        mode: "live-api"
      };
    } catch (error) {
      const fallback = embeddedStock(symbol);
      if (fallback) data[symbol] = fallback;
      errors[symbol] = error.message;
    }
  }));
  sendJson(res, 200, {
    source: {
      providers: ["Yahoo Finance chart API", "Embedded public snapshot fallback"],
      fetchedAt: new Date().toISOString()
    },
    data,
    errors
  });
}

function handleUniverse(res) {
  const snapshot = embeddedJson("publicMarketSnapshot");
  const universe = snapshot?.universe || {};
  sendJson(res, 200, {
    universe: "riskdesk_us_equity_universe",
    label: universe.primary || "US individual stocks",
    source: snapshot?.source || "Embedded public market snapshot",
    generatedAt: snapshot?.generatedAt,
    count: (universe.stockSymbols || []).length,
    symbols: universe.stockSymbols || [],
    riskFactors: universe.riskFactorSymbols || [],
    note: universe.note || ""
  });
}

function handleBacktest(res) {
  const all = embeddedJson("allStrategyBacktests") || {};
  const models = [...(all.coreModels || []), ...(all.strategies || []), ...(all.benchmarks || [])];
  sendJson(res, 200, {
    source: "Embedded weekly backtest snapshot",
    generatedAt: all.generatedAt,
    assumptions: all.assumptions || {},
    count: models.length,
    models: models.map(item => ({
      name: item.name,
      cagr: item.cagr,
      sharpe: item.sharpe,
      maxDrawdown: item.maxDrawdown,
      latestDate: item.daily?.[item.daily.length - 1]?.date || item.monthly?.[item.monthly.length - 1]?.date || null
    }))
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch {
    return [];
  }
}

function writeLedger(rows) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(rows.slice(-1000), null, 2), "utf8");
}

async function handleLedger(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { source: "RiskDesk local prediction ledger", rows: readLedger() });
    return;
  }
  if (req.method === "DELETE") {
    writeLedger([]);
    sendJson(res, 200, { ok: true, rows: [] });
    return;
  }
  if (req.method === "POST") {
    const body = await readRequestBody(req);
    const payload = body ? JSON.parse(body) : {};
    const incoming = Array.isArray(payload.rows) ? payload.rows : [];
    const savedAt = new Date().toISOString();
    const existing = readLedger();
    const rows = incoming.map(row => ({ ...row, serverRecordedAt: savedAt }));
    writeLedger([...existing, ...rows]);
    sendJson(res, 200, { ok: true, saved: rows.length, rows: readLedger() });
    return;
  }
  sendJson(res, 405, { error: "Method not allowed" });
}

function serveStatic(reqUrl, res) {
  const rawPath = decodeURIComponent(reqUrl.pathname === "/" ? "/outputs/index.html" : reqUrl.pathname);
  const filePath = path.normalize(path.join(rootDir, rawPath));
  if (!filePath.startsWith(rootDir)) {
    sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".html" ? "text/html; charset=utf-8"
    : ext === ".js" ? "application/javascript; charset=utf-8"
    : ext === ".css" ? "text/css; charset=utf-8"
    : ext === ".json" ? "application/json; charset=utf-8"
    : "application/octet-stream";
  sendText(res, 200, fs.readFileSync(filePath), contentType);
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (reqUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "RiskDesk realtime API", now: new Date().toISOString() });
    } else if (reqUrl.pathname === "/api/universe") {
      handleUniverse(res);
    } else if (reqUrl.pathname === "/api/quotes") {
      await handleQuotes(reqUrl, res);
    } else if (reqUrl.pathname === "/api/stocks") {
      await handleStocks(reqUrl, res);
    } else if (reqUrl.pathname === "/api/backtest") {
      handleBacktest(res);
    } else if (reqUrl.pathname === "/api/ledger") {
      await handleLedger(req, res);
    } else {
      serveStatic(reqUrl, res);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, () => {
  console.log(`RiskDesk realtime API running at http://localhost:${port}`);
  console.log(`Open http://localhost:${port}/`);
});
