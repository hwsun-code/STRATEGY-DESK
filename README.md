# RiskDesk Strategy Desk

RiskDesk is an applied-mathematics research dashboard for US equity strategy backtesting, forward prediction, and paper-trading monitoring.

## Current Research Structure

- Investable universe: curated US individual stocks.
- Risk-factor layer: ETFs are used for benchmark, hedge, macro/risk attribution, and SPY-relative checks.
- Strategy set: 15 research strategies, including V1, V2, V3, and S1-S12.
- Main ranking metric: Sharpe Ratio.
- Sanity check: SPY Active Information Ratio, used to check whether raw Sharpe is more than broad-market beta.

## Dynamic Deployment Mode

This release is Netlify-ready.

- Publish directory: project root.
- Functions directory: `netlify/functions`.
- Live quote endpoint: `/api/quotes?symbols=AAPL,MSFT,NVDA`.
- Forecast ledger endpoint: `/api/ledger`.
- The dashboard calls `/api/quotes` first, then falls back to public browser quote sources, then embedded snapshot data.
- The browser refreshes live quotes every 5 minutes.
- Forecast rows are saved locally and, after Netlify deployment, also saved server-side through Netlify Blobs.

This means the deployed website can refresh selected holdings from server-side market quote calls instead of being only a local `file://` HTML snapshot.

## Backtest vs Forecast

- Backtest uses realized historical prices and weekly walk-forward strategy rules.
- Forward prediction records expected return, predicted price, and Buy/Hold/Reduce signal.
- After the forecast horizon passes, realized prices are compared against predicted returns in the paper-trading evaluation ledger.

## Important Limitation

The current embedded research dataset is still a generated snapshot. A fully live production version requires scheduled data refresh, persistent storage, and an authenticated market-data provider such as Alpaca, Finnhub, Polygon, or another approved source.

This dashboard is for research and education only. It is not investment advice.
