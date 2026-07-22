const { json } = require("./_riskdesk-common");

function cleanSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function eodhdSymbol(symbol) {
  const raw = cleanSymbol(symbol);
  if (!raw) return "";
  if (raw.includes(".")) return raw;
  return `${raw}.US`;
}

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const token = process.env.EODHD_API_TOKEN;
  if (!token) {
    return json(200, {
      ok: false,
      configured: false,
      source: "EODHD Global Stock package",
      message: "Set EODHD_API_TOKEN in Netlify environment variables to enable 30+ year daily history."
    });
  }

  const rawSymbols = String(event.queryStringParameters?.symbols || "AAPL.US")
    .split(",")
    .map(eodhdSymbol)
    .filter(Boolean)
    .slice(0, 25);
  const from = event.queryStringParameters?.from || "1995-01-01";
  const period = event.queryStringParameters?.period || "d";
  const data = {};
  const errors = {};

  await Promise.all(rawSymbols.map(async symbol => {
    try {
      const endpoint = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(token)}&fmt=json&from=${encodeURIComponent(from)}&period=${encodeURIComponent(period)}`;
      const response = await fetch(endpoint, {
        headers: {
          "user-agent": "RiskDesk/1.0",
          "accept": "application/json"
        }
      });
      if (!response.ok) throw new Error(`EODHD HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("EODHD returned non-array payload");
      const points = rows
        .map(row => ({
          date: row.date,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          adjustedClose: Number(row.adjusted_close ?? row.adjustedClose ?? row.close),
          volume: Number(row.volume)
        }))
        .filter(row => row.date && Number.isFinite(row.adjustedClose));
      data[symbol] = {
        symbol,
        provider: "EODHD Global Stock package",
        from,
        period,
        observations: points.length,
        firstDate: points[0]?.date || null,
        lastDate: points[points.length - 1]?.date || null,
        points
      };
    } catch (error) {
      errors[symbol] = error.message;
    }
  }));

  return json(200, {
    ok: true,
    configured: true,
    source: "EODHD Global Stock package",
    fetchedAt: new Date().toISOString(),
    symbols: rawSymbols,
    data,
    errors
  });
};
