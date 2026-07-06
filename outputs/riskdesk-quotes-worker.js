const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function yahooSymbol(symbol) {
  return String(symbol || "").trim().replace(".", "-").toUpperCase();
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=1d&interval=1m`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RiskDesk realtime quote worker"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`${symbol} returned HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error(`${symbol} missing Yahoo metadata`);
  const latest = Number(meta.regularMarketPrice ?? meta.previousClose);
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose);
  if (!Number.isFinite(latest)) throw new Error(`${symbol} missing latest price`);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const latestTime = timestamps.length ? new Date(timestamps.at(-1) * 1000) : new Date();
  return {
    symbol,
    latest,
    change: Number.isFinite(previous) && previous !== 0 ? latest / previous - 1 : null,
    asOf: latestTime.toISOString(),
    volume: Number(meta.regularMarketVolume)
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/api/quotes") {
      return json({ error: "Use /api/quotes?symbols=AAPL,MSFT" }, 404);
    }
    const symbols = [...new Set(String(url.searchParams.get("symbols") || "")
      .split(",")
      .map(symbol => symbol.trim().toUpperCase())
      .filter(Boolean))]
      .slice(0, 25);
    if (!symbols.length) return json({ quotes: {}, source: "RiskDesk realtime quote worker" });

    const settled = await Promise.allSettled(symbols.map(fetchYahooQuote));
    const quotes = {};
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") quotes[symbols[index]] = result.value;
      else errors.push(result.reason?.message || `${symbols[index]} failed`);
    });
    return json({
      quotes,
      source: "RiskDesk realtime quote worker / Yahoo 1m chart",
      updatedAt: new Date().toISOString(),
      errors
    }, Object.keys(quotes).length ? 200 : 502);
  }
};
