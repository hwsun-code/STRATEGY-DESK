import { getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Cache-Control": "no-store"
};

const store = getStore("riskdesk-forward-ledger");
const key = "forecast-ledger-v35.json";

async function readLedger() {
  const value = await store.get(key, { type: "json" });
  return Array.isArray(value) ? value : [];
}

async function writeLedger(rows) {
  const limited = rows.slice(-1000);
  await store.setJSON(key, limited);
  return limited;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  try {
    if (event.httpMethod === "GET") {
      const rows = await readLedger();
      return { statusCode: 200, headers, body: JSON.stringify({ rows, count: rows.length }) };
    }
    if (event.httpMethod === "DELETE") {
      await writeLedger([]);
      return { statusCode: 200, headers, body: JSON.stringify({ rows: [], count: 0 }) };
    }
    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const incoming = Array.isArray(payload.rows) ? payload.rows : [];
      const stamped = incoming.map(row => ({
        ...row,
        serverRecordedAt: new Date().toISOString()
      }));
      const rows = await writeLedger([...(await readLedger()), ...stamped]);
      return { statusCode: 200, headers, body: JSON.stringify({ rows, count: rows.length }) };
    }
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Ledger operation failed" })
    };
  }
}
