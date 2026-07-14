import fs from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const defaultRepo = `${process.env.USERPROFILE || "C:/Users/Public"}/Documents/GitHub/STRATEGY-DESK`;
const repoRoot = new URL(`file:///${(process.env.RISKDESK_REPO || defaultRepo).replaceAll("\\", "/").replace(/\/?$/, "/")}`);
const outputPath = new URL("data/global-500-universe.json", repoRoot);
const localBackupPath = new URL("outputs/global-500-universe.json", root);

const TARGETS = {
  us: 350,
  europe: 65,
  japan: 35,
  chinaHongKong: 25,
  canadaAustralia: 25
};

const RISK_FACTORS = [
  "SPY", "QQQ", "IWM", "EFA", "EEM", "EWJ", "EWZ", "FXI",
  "SHY", "IEF", "TLT", "LQD", "HYG",
  "GLD", "DBC", "USO", "VNQ", "IGF",
  "MTUM", "QUAL", "USMV", "VTV",
  "XLK", "XLF", "XLV", "XLE"
];

const sources = {
  sp500: "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
  nasdaq100: "https://en.wikipedia.org/wiki/Nasdaq-100",
  euroStoxx50: "https://en.wikipedia.org/wiki/EURO_STOXX_50",
  nikkei225: "https://en.wikipedia.org/wiki/Nikkei_225",
  tsx60: "https://en.wikipedia.org/wiki/S%26P/TSX_60",
  asx50: "https://en.wikipedia.org/wiki/S%26P/ASX_50"
};

const manualChinaHongKong = [
  ["BABA", "Alibaba Group", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["JD", "JD.com", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["PDD", "PDD Holdings", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["BIDU", "Baidu", "China/Hong Kong ADR", "Communication Services"],
  ["NTES", "NetEase", "China/Hong Kong ADR", "Communication Services"],
  ["TCEHY", "Tencent Holdings ADR", "China/Hong Kong ADR", "Communication Services"],
  ["NIO", "NIO", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["LI", "Li Auto", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["XPEV", "XPeng", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["BYDDY", "BYD ADR", "China/Hong Kong ADR", "Consumer Discretionary"],
  ["9988.HK", "Alibaba Group HK", "China/Hong Kong", "Consumer Discretionary"],
  ["0700.HK", "Tencent Holdings", "China/Hong Kong", "Communication Services"],
  ["3690.HK", "Meituan", "China/Hong Kong", "Consumer Discretionary"],
  ["9618.HK", "JD.com HK", "China/Hong Kong", "Consumer Discretionary"],
  ["9888.HK", "Baidu HK", "China/Hong Kong", "Communication Services"],
  ["1211.HK", "BYD", "China/Hong Kong", "Consumer Discretionary"],
  ["2318.HK", "Ping An Insurance", "China/Hong Kong", "Financials"],
  ["1398.HK", "ICBC", "China/Hong Kong", "Financials"],
  ["0939.HK", "China Construction Bank", "China/Hong Kong", "Financials"],
  ["0941.HK", "China Mobile", "China/Hong Kong", "Communication Services"],
  ["0883.HK", "CNOOC", "China/Hong Kong", "Energy"],
  ["0388.HK", "Hong Kong Exchanges", "China/Hong Kong", "Financials"],
  ["1299.HK", "AIA Group", "China/Hong Kong", "Financials"],
  ["2020.HK", "ANTA Sports", "China/Hong Kong", "Consumer Discretionary"],
  ["1810.HK", "Xiaomi", "China/Hong Kong", "Information Technology"]
];

const manualJapan = [
  ["7203.T", "Toyota Motor", "Japan", "Consumer Discretionary"],
  ["6758.T", "Sony Group", "Japan", "Consumer Discretionary"],
  ["8035.T", "Tokyo Electron", "Japan", "Information Technology"],
  ["6861.T", "Keyence", "Japan", "Information Technology"],
  ["9984.T", "SoftBank Group", "Japan", "Communication Services"],
  ["8306.T", "Mitsubishi UFJ Financial", "Japan", "Financials"],
  ["8316.T", "Sumitomo Mitsui Financial", "Japan", "Financials"],
  ["8411.T", "Mizuho Financial", "Japan", "Financials"],
  ["6501.T", "Hitachi", "Japan", "Industrials"],
  ["8058.T", "Mitsubishi Corp.", "Japan", "Industrials"],
  ["8001.T", "Itochu", "Japan", "Industrials"],
  ["8031.T", "Mitsui & Co.", "Japan", "Industrials"],
  ["4063.T", "Shin-Etsu Chemical", "Japan", "Materials"],
  ["6098.T", "Recruit Holdings", "Japan", "Industrials"],
  ["4568.T", "Daiichi Sankyo", "Japan", "Health Care"],
  ["4519.T", "Chugai Pharmaceutical", "Japan", "Health Care"],
  ["4502.T", "Takeda Pharmaceutical", "Japan", "Health Care"],
  ["9432.T", "NTT", "Japan", "Communication Services"],
  ["9433.T", "KDDI", "Japan", "Communication Services"],
  ["9983.T", "Fast Retailing", "Japan", "Consumer Discretionary"],
  ["7741.T", "HOYA", "Japan", "Health Care"],
  ["6902.T", "Denso", "Japan", "Consumer Discretionary"],
  ["7267.T", "Honda Motor", "Japan", "Consumer Discretionary"],
  ["6954.T", "Fanuc", "Japan", "Industrials"],
  ["6367.T", "Daikin Industries", "Japan", "Industrials"],
  ["8766.T", "Tokio Marine", "Japan", "Financials"],
  ["7974.T", "Nintendo", "Japan", "Communication Services"],
  ["2914.T", "Japan Tobacco", "Japan", "Consumer Staples"],
  ["4661.T", "Oriental Land", "Japan", "Consumer Discretionary"],
  ["6702.T", "Fujitsu", "Japan", "Information Technology"],
  ["6503.T", "Mitsubishi Electric", "Japan", "Industrials"],
  ["7751.T", "Canon", "Japan", "Information Technology"],
  ["5108.T", "Bridgestone", "Japan", "Consumer Discretionary"],
  ["6178.T", "Japan Post Holdings", "Japan", "Financials"],
  ["9022.T", "Central Japan Railway", "Japan", "Industrials"]
];

const manualEuropeSupplement = [
  ["ASML", "ASML ADR", "Europe", "Information Technology"],
  ["NVO", "Novo Nordisk ADR", "Europe", "Health Care"],
  ["SAP", "SAP ADR", "Europe", "Information Technology"],
  ["SHEL", "Shell ADR", "Europe", "Energy"],
  ["AZN", "AstraZeneca ADR", "Europe", "Health Care"],
  ["HSBC", "HSBC ADR", "Europe", "Financials"],
  ["UL", "Unilever ADR", "Europe", "Consumer Staples"],
  ["BP", "BP ADR", "Europe", "Energy"],
  ["GSK", "GSK ADR", "Europe", "Health Care"],
  ["RIO", "Rio Tinto ADR", "Europe", "Materials"],
  ["DEO", "Diageo ADR", "Europe", "Consumer Staples"],
  ["BTI", "British American Tobacco ADR", "Europe", "Consumer Staples"],
  ["SNY", "Sanofi ADR", "Europe", "Health Care"],
  ["NVS", "Novartis ADR", "Europe", "Health Care"],
  ["UBS", "UBS Group", "Europe", "Financials"],
  ["ING", "ING Group ADR", "Europe", "Financials"],
  ["BCS", "Barclays ADR", "Europe", "Financials"],
  ["LYG", "Lloyds Banking Group ADR", "Europe", "Financials"],
  ["DB", "Deutsche Bank", "Europe", "Financials"],
  ["ARGX", "argenx ADR", "Europe", "Health Care"]
];

const manualCanadaAustraliaSupplement = [
  ["RY", "Royal Bank of Canada", "Canada/Australia", "Financials"],
  ["TD", "Toronto-Dominion Bank", "Canada/Australia", "Financials"],
  ["BNS", "Bank of Nova Scotia", "Canada/Australia", "Financials"],
  ["BMO", "Bank of Montreal", "Canada/Australia", "Financials"],
  ["CM", "Canadian Imperial Bank of Commerce", "Canada/Australia", "Financials"],
  ["SHOP", "Shopify", "Canada/Australia", "Information Technology"],
  ["CNQ", "Canadian Natural Resources", "Canada/Australia", "Energy"],
  ["SU", "Suncor Energy", "Canada/Australia", "Energy"],
  ["TRI", "Thomson Reuters", "Canada/Australia", "Industrials"],
  ["BHP", "BHP Group ADR", "Canada/Australia", "Materials"],
  ["WDS", "Woodside Energy ADR", "Canada/Australia", "Energy"],
  ["CSL.AX", "CSL", "Canada/Australia", "Health Care"],
  ["CBA.AX", "Commonwealth Bank of Australia", "Canada/Australia", "Financials"],
  ["NAB.AX", "National Australia Bank", "Canada/Australia", "Financials"],
  ["WBC.AX", "Westpac Banking", "Canada/Australia", "Financials"],
  ["ANZ.AX", "ANZ Group", "Canada/Australia", "Financials"],
  ["WES.AX", "Wesfarmers", "Canada/Australia", "Consumer Staples"],
  ["WOW.AX", "Woolworths Group", "Canada/Australia", "Consumer Staples"],
  ["FMG.AX", "Fortescue", "Canada/Australia", "Materials"],
  ["MQG.AX", "Macquarie Group", "Canada/Australia", "Financials"]
];

function cleanText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#91;.*?&#93;/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function yahooSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (/\.(T|HK|TO|AX|L|PA|DE|AS|BR|MC|MI|SW|CO|ST|HE|OL)$/i.test(raw)) return raw.toUpperCase();
  return raw.replace(".", "-").toUpperCase();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RiskDesk research universe builder" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function htmlRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => match[0]);
}

function cells(row) {
  return [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => cleanText(match[1]));
}

function tableById(html, id) {
  const pattern = new RegExp(`<table[^>]*id=["']${id}["'][\\s\\S]*?<\\/table>`, "i");
  return html.match(pattern)?.[0] || html;
}

async function parseWikipediaTable(url, mapper, options = {}) {
  const html = await fetchText(url);
  const scopedHtml = options.tableId ? tableById(html, options.tableId) : html;
  const result = [];
  for (const row of htmlRows(scopedHtml)) {
    const values = cells(row);
    const mapped = mapper(values);
    if (mapped?.symbol) result.push(mapped);
  }
  return result;
}

function uniqueBySymbol(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const symbol = yahooSymbol(item.symbol);
    if (!symbol || seen.has(symbol) || RISK_FACTORS.includes(symbol)) continue;
    seen.add(symbol);
    result.push({ ...item, symbol });
  }
  return result;
}

function take(items, count) {
  return uniqueBySymbol(items).slice(0, count);
}

const sp500 = await parseWikipediaTable(sources.sp500, values => {
  if (!/^[A-Z.]{1,8}$/.test(values[0] || "")) return null;
  return { symbol: values[0], name: values[1], region: "United States", sector: values[2], sourceIndex: "S&P 500" };
}, { tableId: "constituents" });

const nasdaq100 = await parseWikipediaTable(sources.nasdaq100, values => {
  const symbol = values.find(value => /^[A-Z.]{1,8}$/.test(value));
  if (!symbol) return null;
  return { symbol, name: values[0], region: "United States", sector: values[2] || "Growth", sourceIndex: "Nasdaq-100 supplement" };
});

const euroStoxx50 = await parseWikipediaTable(sources.euroStoxx50, values => {
  const symbol = values.find(value => /^[A-Z0-9.]{1,12}\.[A-Z]{1,3}$/.test(value));
  if (!symbol) return null;
  return { symbol, name: values[0], region: "Europe", sector: values[2] || "Large-cap", sourceIndex: "EURO STOXX 50" };
});

const nikkei225 = await parseWikipediaTable(sources.nikkei225, values => {
  const code = values.find(value => /^\d{4}$/.test(value));
  if (!code) return null;
  return { symbol: `${code}.T`, name: values[0], region: "Japan", sector: values[1] || "Large-cap", sourceIndex: "Nikkei 225" };
});

const tsx60 = await parseWikipediaTable(sources.tsx60, values => {
  const symbol = values.find(value => /^[A-Z]{1,5}\.?[A-Z]?$/.test(value));
  if (!symbol || values[0] === "Symbol") return null;
  return { symbol: `${symbol.replace(".", "-")}.TO`, name: values[1] || values[0], region: "Canada/Australia", sector: values[2] || "Large-cap", sourceIndex: "S&P/TSX 60" };
});

const asx50 = await parseWikipediaTable(sources.asx50, values => {
  const symbol = values.find(value => /^[A-Z]{2,4}$/.test(value));
  if (!symbol || values[0] === "Code") return null;
  return { symbol: `${symbol}.AX`, name: values[1] || values[0], region: "Canada/Australia", sector: values[2] || "Large-cap", sourceIndex: "S&P/ASX 50" };
});

const us = take([...sp500, ...nasdaq100], TARGETS.us);
const europe = take([...euroStoxx50, ...manualEuropeSupplement.map(([symbol, name, region, sector]) => ({ symbol, name, region, sector, sourceIndex: "European liquid ADR/local supplement" }))], TARGETS.europe);
const japan = take(manualJapan.map(([symbol, name, region, sector]) => ({ symbol, name, region, sector, sourceIndex: "Nikkei 225 liquid blue-chip supplement" })), TARGETS.japan);
const chinaHongKong = take(manualChinaHongKong.map(([symbol, name, region, sector]) => ({ symbol, name, region, sector, sourceIndex: "Hong Kong / China ADR liquid supplement" })), TARGETS.chinaHongKong);
const canadaAustralia = take([...tsx60, ...asx50, ...manualCanadaAustraliaSupplement.map(([symbol, name, region, sector]) => ({ symbol, name, region, sector, sourceIndex: "Canada/Australia liquid ADR/local supplement" }))], TARGETS.canadaAustralia);

const constituents = [...us, ...europe, ...japan, ...chinaHongKong, ...canadaAustralia];
const output = {
  universeId: "riskdesk_global_500_liquid",
  label: "RiskDesk Global 500 Liquid Universe",
  generatedAt: new Date().toISOString(),
  methodology: "350 U.S. large-cap equities plus 150 non-U.S. liquid equities. The design keeps U.S. comparability while reducing single-market and single-sector concentration bias.",
  targetAllocation: {
    us: { count: TARGETS.us, share: 0.70 },
    europe: { count: TARGETS.europe, share: 0.12 },
    japan: { count: TARGETS.japan, share: 0.07 },
    chinaHongKong: { count: TARGETS.chinaHongKong, share: 0.05 },
    canadaAustralia: { count: TARGETS.canadaAustralia, share: 0.04 },
    riskFactors: { count: RISK_FACTORS.length, share: 0.02 }
  },
  actualAllocation: constituents.reduce((acc, item) => {
    acc[item.region] = (acc[item.region] || 0) + 1;
    return acc;
  }, {}),
  stockSymbols: constituents.map(item => item.symbol),
  riskFactorSymbols: RISK_FACTORS,
  constituents,
  sources
};

await fs.mkdir(new URL("data/", repoRoot), { recursive: true });
await fs.mkdir(new URL("outputs/", root), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
await fs.writeFile(localBackupPath, JSON.stringify(output, null, 2));
console.log(`Global 500 universe written: ${output.stockSymbols.length} stocks + ${output.riskFactorSymbols.length} risk factors.`);
console.log(JSON.stringify(output.actualAllocation, null, 2));
