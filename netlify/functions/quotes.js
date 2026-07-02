const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store"
};

function yahooSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(".", "-");
}

function normalizeYahoo(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const close = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  const latest = [...close].reverse().find(value => Number.isFinite(value)) ?? meta.regularMarketPrice;
  const previous = Number(meta.previousClose || meta.chartPreviousClose);
  const lastTimestamp = timestamps.at(-1);
  return {
    symbol,
    latest: Number(latest),
    change: Number.isFinite(latest) && Number.isFinite(previous) && previous ? latest / previous - 1 : 0,
    asOf: lastTimestamp ? new Date(lastTimestamp * 1000).toISOString() : new Date().toISOString(),
    source: "Yahoo chart endpoint via Netlify function"
  };
}

async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=1d&interval=1m`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 RiskDesk live quote function"
    }
  });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  return normalizeYahoo(await response.json(), symbol);
}

function stooqSymbol(symbol) {
  return `${String(symbol || "").trim().toLowerCase().replace("-", ".")}.us`;
}

function parseStooqCsv(text, requestedSymbols) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    const symbol = requestedSymbols[index];
    const close = Number(cells[6]);
    const open = Number(cells[3]);
    return {
      symbol,
      latest: close,
      change: Number.isFinite(close) && Number.isFinite(open) && open ? close / open - 1 : 0,
      asOf: `${cells[1] || ""} ${cells[2] || ""}`.trim() || new Date().toISOString(),
      source: "Stooq quote endpoint via Netlify function"
    };
  }).filter(item => Number.isFinite(item.latest));
}

async function stooqQuotes(symbols) {
  const url = `https://stooq.com/q/l/?s=${symbols.map(stooqSymbol).join(",")}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 RiskDesk live quote function"
    }
  });
  if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
  return parseStooqCsv(await response.text(), symbols);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  try {
    const symbols = String(event.queryStringParameters?.symbols || "AAPL,MSFT,NVDA,GOOG")
      .split(",")
      .map(symbol => symbol.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 25);
    if (!symbols.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No symbols requested" }) };
    }

    let quotes = [];
    let source = "Yahoo chart endpoint via Netlify function";
    try {
      const results = await Promise.allSettled(symbols.map(yahooQuote));
      quotes = results.filter(item => item.status === "fulfilled").map(item => item.value);
      if (quotes.length < Math.max(1, Math.floor(symbols.length / 2))) throw new Error("Too few Yahoo quotes");
    } catch {
      quotes = await stooqQuotes(symbols);
      source = "Stooq quote endpoint via Netlify function";
    }

    const quoteMap = Object.fromEntries(quotes.map(quote => [quote.symbol, quote]));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        source,
        updatedAt: new Date().toISOString(),
        symbols,
        quotes: quoteMap
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: error.message || "Quote refresh failed" })
    };
  }
}
