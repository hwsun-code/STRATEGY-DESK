# RiskDesk

RiskDesk is an applied-mathematics research dashboard for global liquid ETF allocation.

## Research Structure

- 24 liquid ETFs form the investable universe.
- 12 fixed strategies serve as reference strategies.
- V1, V2, and V3 are the three tunable core research models.
- SPY, equal weight, and 60/40 portfolios are benchmarks.

## Core Models

### V1: Cross-Sectional Momentum + Volatility Scaling

Ranks ETFs using 12-minus-1-month momentum, selects the top three positive signals, applies inverse-volatility weights, and scales exposure toward a 10% annual volatility target.

### V2: HMM + GARCH + Constrained MVO

Uses a two-state Gaussian hidden Markov model for regime probabilities, GARCH(1,1) likelihood search for conditional volatility, and capped long-only mean-variance optimization for portfolio weights.

### V3: Boosted Trees + Additive Attribution

Uses expanding walk-forward gradient-boosted decision stumps to predict next-month ETF returns from momentum, volatility, trend, and drawdown features. Additive tree contributions provide model interpretation.

V3 is a local boosted-tree implementation. It is not the external XGBoost or TreeSHAP package.

## Backtest Convention

- Monthly decisions use prior-close information only.
- Transaction cost assumption: 5 basis points per unit of one-way turnover.
- Core models use a common 85-month comparison sample.
- Results are historical simulations, not investment advice or guaranteed forecasts.

## Run the Dashboard

Open `index.html` in a browser. All required market snapshots and backtest results are embedded in the file.

## Rebuild Research Data

The `scripts` directory contains the data snapshot and backtest builders. They require a modern Node.js runtime.

## Known Limitations

- Current-universe survivorship bias is not eliminated.
- Quality, value, dividend, and tail-risk reference strategies use ETF proxies.
- The current Sharpe calculations use a zero risk-free-rate assumption.
- Parameter robustness, final untouched testing, and forward paper tracking remain future work.

## Data Sources

- Public Yahoo Finance chart endpoint for adjusted ETF price histories.
- Federal Reserve Bank of St. Louis FRED for macroeconomic observations.
- ETF issuer websites for fund identity and classification metadata.

