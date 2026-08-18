# RiskDesk Two-Person Handover Checklist

Prepared: 2026-08-18

## Receiving interns

- Intern 1: ______________________________
- Intern 2: ______________________________
- Handover date: _________________________
- Supervisor confirmation: _______________

## Required transfer checks

- [ ] Both receiving interns can open the GitHub repository.
- [ ] Both receiving interns can open the live dashboard and the automation-status endpoint.
- [ ] Both receiving interns can identify `index.html`, `netlify/functions`, `data`, `scripts`, and `outputs`.
- [ ] Both receiving interns understand that secrets are stored in Netlify environment variables and are not committed to GitHub.
- [ ] Both receiving interns can explain the difference between backtest, forward prediction, and prediction feedback.
- [ ] Both receiving interns can identify V3.5, V4, V4.5, and the experimental V5 artifacts.
- [ ] Both receiving interns can run the repository validation command or inspect the Netlify deploy logs.
- [ ] Both receiving interns know where the historical research notebooks, paper drafts, and experiment logs are stored.
- [ ] The canonical Google Drive folder is added here: ______________________________
- [ ] The progress Google Sheet row is updated here: ________________________________

## Operational acceptance

- [ ] A new receiver has successfully queried `/api/quotes`.
- [ ] A new receiver has successfully queried `/api/automation-status`.
- [ ] A new receiver has inspected `/api/ledger` without deleting records.
- [ ] A new receiver has verified the current deployment commit in Netlify.
- [ ] A new receiver has written one dated continuation note.

## Known limitations to communicate

- The dashboard contains both embedded historical snapshots and server-side quote calls; their dates must be checked before comparing results.
- The EODHD history endpoint exists, but the current automation path prioritizes Yahoo Finance chart history and uses the embedded snapshot as fallback.
- Live RSS research evidence is not the same as a historical news database and must not be treated as a fully backtestable news model.
- The 500-stock universe is a candidate universe; the number of daily forecast rows is lower and depends on the 15 strategy holdings.
- Direction hit rate, return error, portfolio return, and Sharpe ratio are separate evaluation outputs.
