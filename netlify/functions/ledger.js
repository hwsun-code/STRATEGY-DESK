const { json } = require("./_riskdesk-common");

async function blobStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID_OVERRIDE;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (!siteID || !token) return null;
    return siteID && token
      ? getStore({ name: "riskdesk-forward-ledger", siteID, token })
      : getStore("riskdesk-forward-ledger");
  } catch {
    return null;
  }
}

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  const store = await blobStore();
  if (!store) {
    return json(200, {
      source: "Browser localStorage fallback",
      rows: [],
      note: "Install @netlify/blobs during deploy to persist this ledger on Netlify."
    });
  }

  const key = "forward-ledger.json";
  let existing = null;
  try {
    existing = await store.get(key, { type: "json" });
  } catch (error) {
    return json(200, {
      source: "Browser localStorage fallback",
      rows: [],
      note: `Netlify Blobs is not available yet: ${error.message}`
    });
  }
  const rows = Array.isArray(existing) ? existing : [];

  if (event.httpMethod === "GET") {
    return json(200, { source: "Netlify Blobs prediction ledger", rows });
  }

  if (event.httpMethod === "DELETE") {
    await store.setJSON(key, []);
    return json(200, { ok: true, rows: [] });
  }

  if (event.httpMethod === "POST") {
    const payload = event.body ? JSON.parse(event.body) : {};
    const incoming = Array.isArray(payload.rows) ? payload.rows : [];
    const savedAt = new Date().toISOString();
    const nextRows = [...rows, ...incoming.map(row => ({ ...row, serverRecordedAt: savedAt }))].slice(-1000);
    await store.setJSON(key, nextRows);
    return json(200, { ok: true, saved: incoming.length, rows: nextRows });
  }

  return json(405, { error: "Method not allowed" });
};
