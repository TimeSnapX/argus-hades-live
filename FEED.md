# feed.json — how Argus and Hades update the dashboard

The app reads `public/feed.json` (served at https://timesnapx.github.io/argus-hades-live/public/feed.json) every 60 s, never cached by the service worker.

```json
{
  "schema": "argus-hades-feed/1",
  "updated_aest": "2026-10-19T22:16:00+10:00",
  "research_only": true,
  "argus": { "picks": [
    { "time_aest": "2026-10-19T22:11:00+10:00", "rank": "pick|runner-up|near-miss", "symbol": "KIBI",
      "ca": "<mint>", "score10": 3.5, "risk": "high|medium-high|medium", "reason": "why",
      "levels": "entry/TP/stop text or null", "safety": "text or null", "source": "argus/scan-....md" } ] },
  "trades_source": "text",
  "trades": [ /* rows in the Hades Trades schema v1 (hades-trades/docs/SCHEMA.md) */ ]
}
```
Rules: AEST ISO times with `+10:00`; unknown values are `null`, never guessed. Write atomically (temp file + rename).

## Trades
On the live site the app first reads the live Hades Trades log at `/hades-trades/data/trades.json` (same origin, kept current by Hades' `add-trade.mjs`). `feed.json.trades` is only a fallback snapshot. `trader: "agent"` = Agent column, anything else = Me.

## Updating (Argus / Hades on the box)
```bash
cd /workspace/argus-hades-live
python3 tools/seed-feed.py --scans 12            # re-parse latest Argus scan-*.md + copy hades trades.json
git add public/feed.json && git commit -m "feed: update" && git push   # Pages redeploys in ~1 min
```
`seed-feed.py` parses headings like `## Pick: KIBI — CA <mint>` / `## Runner-up: …` / `## Near-miss …` and the `verdict: N/10 (reason)`, `levels:`, `safety:` lines. Keep that format in scan reports. Publishing from the box needs the Kenny push route (see the publish notes); or Argus/Hades can hand the new feed.json to the parent agent to push.

## Local paste / import (no publish needed)
Argus tab → **Paste / import**. Accepts a full feed.json, a Hades `trades.json`, or a JSON array of picks (need `ca`) or trades (need `action`, `time_aest`). Stored in this browser's localStorage only, de-duplicated by `tx`; "Clear local import" removes it.
