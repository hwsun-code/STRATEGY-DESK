const { json, symbolsFrom, fetchYahooChart, quoteFromChart, embeddedQuote } = require("./_riskdesk-common");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  const symbols = symbolsFrom(event);
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

  const values = Object.values(quotes);
  const fallbackCount = values.filter(item => item.mode === "fallback").length;
  return json(200, {
    source: {
      provider: values.length && fallbackCount === values.length ? "Embedded public snapshot" : "Yahoo Finance chart API",
      fetchedAt: new Date().toISOString(),
      mode: fallbackCount ? "mixed-or-fallback" : "realtime-api"
    },
    quotes,
    errors
  });
};
