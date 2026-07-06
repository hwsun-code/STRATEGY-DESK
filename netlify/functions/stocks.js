const { json, symbolsFrom, fetchYahooChart, pointsFromChart, embeddedStock } = require("./_riskdesk-common");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const symbols = symbolsFrom(event);
  const range = event.queryStringParameters?.range || "2y";
  const interval = event.queryStringParameters?.interval || "1d";
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
        points: pointsFromChart(result),
        mode: "live-api"
      };
    } catch (error) {
      const fallback = embeddedStock(symbol);
      if (fallback) data[symbol] = fallback;
      errors[symbol] = error.message;
    }
  }));

  return json(200, {
    source: {
      providers: ["Yahoo Finance chart API", "Embedded public snapshot fallback"],
      fetchedAt: new Date().toISOString()
    },
    data,
    errors
  });
};
