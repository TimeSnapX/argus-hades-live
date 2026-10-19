# Argus × Hades Live
Installable, mobile-first, real-time dashboard for Argus (Solana scouting) and Hades (trade log). **Research only — no bot here places trades.**
Live: https://timesnapx.github.io/argus-hades-live/

- Scout: DexScreener token-profiles/latest, token-boosts/latest, search (pumpswap / pump) → /tokens/v1 pairs, polled every 20 s; RugCheck summary verdict; links to Coin Risk vs Reward (`#/coin/<CA>`).
- Argus picks: `public/feed.json` (see FEED.md) + local import.
- Hades: live `/hades-trades/data/trades.json` (fallback feed.json), Me vs Agent, live P&L in SOL from DexScreener prices, win rate, equity mini-chart.
- Watchlist in localStorage, 15 s ticks. Header SOL price (Jupiter → DexScreener fallback), AEST updated time, live/pause.
- No keys. Failed sources are shown as unavailable; nothing is estimated. SW is network-first for the same-origin shell only; never caches JSON or cross-origin calls.
Tests: `node tests/e2e.mjs [url]` (live, mocked, all-APIs-down on a 390×844 viewport).
