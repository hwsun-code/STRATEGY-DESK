const { json } = require("./_riskdesk-common");
const { ensureV45LedgerRows } = require("./_v45-ledger");

const LEDGER_KEYS = {
  legacy: "forward-ledger.json",
  v35: "forward-ledger-v35.json",
  v4: "forward-ledger-v4.json",
  v45: "forward-ledger-v45.json"
};

function versionOf(row) {
  const version = String(row?.modelVersion || "v35").toLowerCase();
  return version === "v4" || version === "v45" ? version : "v35";
}

function rowId(row) {
  return [
    versionOf(row),
    row?.strategy || "",
    row?.horizonDays || 1,
    row?.symbol || "",
    row?.forecastDate || row?.date || "",
    row?.automationVersion || ""
  ].join("|");
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const id = rowId(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function readRows(store, key) {
  try {
    const value = await store.get(key, { type: "json" });
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function readVersionLedgers(store) {
  const [legacy, v35, v4, v45] = await Promise.all([
    readRows(store, LEDGER_KEYS.legacy),
    readRows(store, LEDGER_KEYS.v35),
    readRows(store, LEDGER_KEYS.v4),
    readRows(store, LEDGER_KEYS.v45)
  ]);
  const grouped = { v35: [...v35], v4: [...v4], v45: [...v45] };
  for (const row of legacy) grouped[versionOf(row)].push(row);
  grouped.v35 = dedupeRows(grouped.v35).slice(-50000);
  grouped.v4 = dedupeRows(grouped.v4).slice(-50000);
  grouped.v45 = dedupeRows(grouped.v45).slice(-50000);
  return grouped;
}

function mergeLedgers(grouped) {
  return dedupeRows([...(grouped.v35 || []), ...(grouped.v4 || []), ...(grouped.v45 || [])]);
}

function countsByVersion(grouped) {
  return {
    v35: (grouped.v35 || []).length,
    v4: (grouped.v4 || []).length,
    v45: (grouped.v45 || []).length
  };
}

async function writeVersionLedgers(store, grouped) {
  await Promise.all([
    store.setJSON(LEDGER_KEYS.v35, dedupeRows(grouped.v35 || []).slice(-50000)),
    store.setJSON(LEDGER_KEYS.v4, dedupeRows(grouped.v4 || []).slice(-50000)),
    store.setJSON(LEDGER_KEYS.v45, dedupeRows(grouped.v45 || []).slice(-50000))
  ]);
}

async function blobStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    // In deployed Netlify Functions, use the platform's built-in Blobs identity.
    // An old explicit token can be expired while the site itself is still authorized.
    return getStore("riskdesk-forward-ledger");
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

  let grouped = null;
  try {
    grouped = await readVersionLedgers(store);
  } catch (error) {
    return json(200, {
      source: "Browser localStorage fallback",
      rows: [],
      note: `Netlify Blobs is not available yet: ${error.message}`
    });
  }

  if (event.httpMethod === "GET") {
    const params = new URLSearchParams(event.rawQuery || "");
    const requestedVersion = params.get("version");
    const rows = requestedVersion && grouped[requestedVersion] ? grouped[requestedVersion] : mergeLedgers(grouped);
    const v45Count = grouped.v45.length;
    const v4Count = grouped.v4.length;
    if (v4Count && v45Count < v4Count) {
      await ensureV45LedgerRows(mergeLedgers(grouped));
      grouped = await readVersionLedgers(store);
      const repairedRows = requestedVersion && grouped[requestedVersion] ? grouped[requestedVersion] : mergeLedgers(grouped);
      return json(200, { source: "Netlify Blobs prediction ledger", storage: "version-separated", rows: repairedRows, byVersion: countsByVersion(grouped), v45AutoRepair: true });
    }
    return json(200, { source: "Netlify Blobs prediction ledger", storage: "version-separated", rows, byVersion: countsByVersion(grouped) });
  }

  if (event.httpMethod === "DELETE") {
    const params = new URLSearchParams(event.rawQuery || "");
    const requestedVersion = params.get("version");
    if (requestedVersion && grouped[requestedVersion]) {
      grouped[requestedVersion] = [];
      await writeVersionLedgers(store, grouped);
      return json(200, { ok: true, rows: mergeLedgers(grouped), byVersion: countsByVersion(grouped) });
    }
    await Promise.all(Object.values(LEDGER_KEYS).map(key => store.setJSON(key, [])));
    return json(200, { ok: true, rows: [], byVersion: { v35: 0, v4: 0, v45: 0 } });
  }

  if (event.httpMethod === "POST") {
    const payload = event.body ? JSON.parse(event.body) : {};
    const incoming = Array.isArray(payload.rows) ? payload.rows : [];
    const savedAt = new Date().toISOString();
    for (const row of incoming) {
      const next = { ...row, serverRecordedAt: savedAt };
      grouped[versionOf(next)].push(next);
    }
    await writeVersionLedgers(store, grouped);
    const rows = mergeLedgers(grouped);
    return json(200, { ok: true, saved: incoming.length, storage: "version-separated", rows, byVersion: countsByVersion(grouped) });
  }

  return json(405, { error: "Method not allowed" });
};
