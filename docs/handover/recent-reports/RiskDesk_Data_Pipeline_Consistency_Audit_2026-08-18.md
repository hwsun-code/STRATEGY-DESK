# RiskDesk Data Pipeline and Consistency Audit

Key findings:

- Embedded EODHD-labelled snapshot is dated 2026-07-23, while server quotes use Yahoo chart data.
- Automation prioritizes Yahoo one-year chart history and falls back to the embedded snapshot; it is not yet a unified EODHD long-history/live path.
- Macro fields are displayed, but the market-context formula mainly uses SPY20, QQQ20, TLT20, and VIX5.
- Live RSS research has no timestamped historical archive for a strict news backtest.
- Candidate-universe size, ETF risk-factor count, actual holdings, and daily forecast rows must be reported separately.

See the DOCX for severity, repair design, acceptance tests, and evidence files.
