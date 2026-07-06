# RiskDesk realtime setup

This version makes the GitHub Pages site run as a near-realtime quote monitor.

## What changed

- The live quote monitor refreshes every 60 seconds.
- The page first calls a configurable quote endpoint.
- If the endpoint is unavailable, it falls back to Yahoo/Stooq public sources.
- If public sources are blocked, it keeps showing embedded research data.

## Files

- `strategy-desk-live.html`: updated GitHub Pages HTML.
- `riskdesk-quotes-worker.js`: Cloudflare Worker quote proxy.

## Deploy steps

1. Create a Cloudflare Worker.
2. Paste `riskdesk-quotes-worker.js` into the Worker.
3. Deploy it and copy the Worker URL.
4. In `strategy-desk-live.html`, replace:

```html
window.RISKDESK_QUOTE_ENDPOINT = "";
```

with:

```html
window.RISKDESK_QUOTE_ENDPOINT = "https://YOUR-WORKER.workers.dev/api/quotes";
```

5. Commit the updated HTML to the `STRATEGY-DESK` GitHub Pages repository.

## Test URL

Open:

```text
https://YOUR-WORKER.workers.dev/api/quotes?symbols=AAPL,MSFT,SPY
```

Expected shape:

```json
{
  "quotes": {
    "AAPL": {
      "symbol": "AAPL",
      "latest": 123.45,
      "change": 0.0012,
      "asOf": "2026-07-04T00:00:00.000Z",
      "volume": 12345678
    }
  },
  "source": "RiskDesk realtime quote worker / Yahoo 1m chart"
}
```

## Important limitation

This makes quotes near-realtime. It does not recompute the full JP Morgan-style backtests every minute. Backtests, validation scores, and strategy rankings still update only when the research pipeline is rerun.
