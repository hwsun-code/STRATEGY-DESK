const { json } = require("./_riskdesk-common");
const { ensureV45LedgerRows } = require("./_v45-ledger");

const STRATEGY_THEMES = {
  "S8 Trend-Guarded Reversion+": {
    label: "Trend-guarded mean reversion",
    positive: ["reversal", "mean reversion", "oversold", "trend support", "stabilization", "rebound"],
    negative: ["breakdown", "selloff", "downtrend", "liquidity stress", "volatility spike"],
    papers: [
      { title: "Momentum crashes and regime-dependent reversal risk", source: "Academic finance literature", citation: "Daniel and Moskowitz style momentum-crash evidence", relevance: 0.82 },
      { title: "Short-term reversal under trend and liquidity filters", source: "Market microstructure literature", citation: "Short-horizon reversal and liquidity-risk studies", relevance: 0.78 }
    ]
  },
  "S12 Adaptive Volatility Compounder+": {
    label: "Volatility-band adaptive compounding",
    positive: ["low volatility", "volatility compression", "stable trend", "risk appetite", "calm market"],
    negative: ["volatility spike", "stress", "drawdown", "risk off", "credit spread"],
    papers: [
      { title: "Volatility-managed portfolios", source: "Academic finance literature", citation: "Volatility timing / Moreira-Muir style evidence", relevance: 0.86 },
      { title: "Risk scaling under changing volatility regimes", source: "Portfolio construction literature", citation: "Volatility targeting and drawdown-control studies", relevance: 0.8 }
    ]
  },
  "S1 AI Capex Momentum+": {
    label: "AI infrastructure capex momentum",
    positive: ["ai capex", "data center", "semiconductor", "accelerator", "cloud spending", "infrastructure"],
    negative: ["capex cut", "export restriction", "inventory correction", "margin pressure"],
    papers: [
      { title: "Capital expenditure cycles and equity momentum", source: "Corporate finance literature", citation: "Investment and expected-return factor research", relevance: 0.72 }
    ]
  },
  "S7 Revision-Proxy Growth Rank+": {
    label: "Revision-proxy growth ranking",
    positive: ["upgrade", "raised guidance", "estimate revision", "earnings beat", "positive surprise"],
    negative: ["downgrade", "cut guidance", "miss", "negative revision", "warning"],
    papers: [
      { title: "Analyst revisions and post-earnings drift", source: "Earnings-anomaly literature", citation: "PEAD and analyst-revision evidence", relevance: 0.84 }
    ]
  },
  "S11 Tail-Risk Shock Absorber+": {
    label: "Tail-risk and shock absorption",
    positive: ["hedge", "defensive", "risk control", "safe haven", "shock absorber"],
    negative: ["tail risk", "crisis", "contagion", "default", "liquidity shock", "geopolitical risk"],
    papers: [
      { title: "Tail-risk hedging and crisis beta", source: "Risk management literature", citation: "Crash beta and downside-risk studies", relevance: 0.81 }
    ]
  }
};

const DEFAULT_THEME = {
  label: "General quantitative strategy evidence",
  positive: ["momentum", "quality", "trend", "earnings", "liquidity", "risk appetite"],
  negative: ["stress", "volatility", "drawdown", "crowding", "reversal", "uncertainty"],
  papers: [
    { title: "Cross-sectional momentum, quality, volatility and regime evidence", source: "Academic finance literature", citation: "Factor investing and regime-aware allocation studies", relevance: 0.7 }
  ]
};

function cleanText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function keywordScore(text, positive, negative) {
  const lower = text.toLowerCase();
  const pos = positive.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
  const neg = negative.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
  return { pos, neg, score: Math.max(-1, Math.min(1, (pos - neg) / Math.max(2, positive.length / 2))) };
}

async function fetchYahooNews(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 RiskDesk Research Fusion" } });
  if (!response.ok) throw new Error(`Yahoo RSS HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(match => {
    const item = match[1];
    const title = cleanText(item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const link = cleanText(item.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    const pubDate = cleanText(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]);
    return { type: "news", symbol, title, link, publishedAt: pubDate, source: "Yahoo Finance RSS" };
  }).filter(item => item.title);
}

async function fetchArxivPapers(query) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query} AND all:finance`)}&start=0&max_results=3&sortBy=submittedDate&sortOrder=descending`;
  const response = await fetch(url, { headers: { "user-agent": "RiskDesk Research Fusion" } });
  if (!response.ok) throw new Error(`arXiv HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 3).map(match => {
    const entry = match[1];
    return {
      type: "paper",
      title: cleanText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]),
      link: cleanText(entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]),
      publishedAt: cleanText(entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]),
      source: "arXiv API"
    };
  }).filter(item => item.title);
}

const { connectLambda } = require("@netlify/blobs");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  connectLambda(event);
  if (event.queryStringParameters?.repair === "v45") {
    const result = await ensureV45LedgerRows([]);
    return json(200, { source: "RiskDesk V4.5 automatic ledger repair", mode: "automatic per-row V4.5 research/news overlay", ...result });
  }
  const params = event.queryStringParameters || {};
  const strategy = params.strategy || "S8 Trend-Guarded Reversion+";
  const symbols = [...new Set(String(params.symbols || "SPY,QQQ,NVDA,MSFT").split(",").map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  const theme = STRATEGY_THEMES[strategy] || DEFAULT_THEME;
  const errors = [];
  const news = [];
  await Promise.all(symbols.slice(0, 6).map(async symbol => {
    try {
      news.push(...await fetchYahooNews(symbol));
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }));
  let papers = [];
  try {
    papers = await fetchArxivPapers(theme.label);
  } catch (error) {
    errors.push(`papers: ${error.message}`);
  }
  if (!papers.length) {
    papers = theme.papers.map(item => ({ ...item, type: "paper", link: "", publishedAt: "", fallback: true }));
  }
  const items = [...news, ...papers].slice(0, 18);
  const scored = items.map(item => {
    const scoredItem = keywordScore(`${item.title} ${item.summary || ""}`, theme.positive, theme.negative);
    return { ...item, ...scoredItem };
  });
  const avgScore = scored.length ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length : 0;
  const evidenceCount = scored.length;
  const confidenceOverlay = Math.max(0, Math.min(1, 0.5 + avgScore * 0.35 + Math.min(0.15, evidenceCount / 100)));
  const recommendation = confidenceOverlay >= 0.58
    ? "raise-confidence"
    : confidenceOverlay <= 0.42
      ? "reduce-confidence"
      : "neutral";
  return json(200, {
    source: "RiskDesk GenAI Research Fusion",
    mode: news.length ? "live-news-and-research" : "research-fallback",
    fetchedAt: new Date().toISOString(),
    strategy,
    theme: theme.label,
    symbols,
    evidenceCount,
    researchScore: avgScore,
    confidenceOverlay,
    recommendation,
    items: scored,
    errors
  });
};
