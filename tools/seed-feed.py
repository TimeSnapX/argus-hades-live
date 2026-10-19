#!/usr/bin/env python3
"""Seed/refresh public/feed.json from Argus scan .md files + Hades trades.json.
Usage: python3 tools/seed-feed.py [--scans N] [--trades /path/trades.json]"""
import re, json, glob, os, sys, datetime, argparse
ap = argparse.ArgumentParser(); ap.add_argument("--scans", type=int, default=12)
ap.add_argument("--argus", default="/workspace/argus"); ap.add_argument("--trades", default="/workspace/hades-trades/data/trades.json")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "feed.json")); a = ap.parse_args()
files = sorted(glob.glob(os.path.join(a.argus, "scan-2026-*-[0-9][0-9][0-9][0-9].md")))[-a.scans:]
H = re.compile(r"^## (.+?):\s*(.+?)\s+[—-]\s+(?:CA\s+)?([1-9A-HJ-NP-Za-km-z]{32,44})", re.M)
picks = []
for f in files:
    m = re.search(r"scan-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)", f); ts = f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:00+10:00"
    txt = open(f).read(); hs = list(H.finditer(txt))
    for i, h in enumerate(hs):
        kind = h[1].lower()
        if "reject" in kind: continue
        body = txt[h.end(): hs[i+1].start() if i+1 < len(hs) else len(txt)]
        body = body.split("\n## ")[0]
        v = re.search(r"verdict:\s*([\d.]+)/10\s*(\(([^)]*)\))?", body)
        lv = re.search(r"levels:\s*(.+)", body); bs = re.search(r"basics:\s*(.+)", body); sf = re.search(r"safety:\s*(.+)", body)
        score = float(v[1]) if v else None
        picks.append({"time_aest": ts, "rank": "pick" if kind.startswith(("pick", "top pick")) else ("runner-up" if "runner" in kind else "near-miss"),
            "symbol": h[2].strip().strip('"'), "ca": h[3], "score10": score,
            "risk": None if score is None else ("high" if score < 3.5 else "medium-high" if score < 5 else "medium"),
            "reason": (v[3] if v and v[3] else (bs[1] if bs else ""))[:300], "levels": lv[1][:200] if lv else None,
            "safety": sf[1][:240] if sf else None, "source": "argus/" + os.path.basename(f)})
picks.sort(key=lambda p: (p["time_aest"], p["score10"] or 0), reverse=True)
trades = []
try: td = json.load(open(a.trades)); trades = td["trades"]
except Exception as e: print("trades unavailable:", e, file=sys.stderr)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=10))).replace(microsecond=0).isoformat()
out = {"schema": "argus-hades-feed/1", "updated_aest": now, "research_only": True,
  "notes": "Seeded from Argus scan .md files and the Hades Trades log. Trades use the hades-trades schema v1 rows.",
  "argus": {"picks": picks}, "trades_source": "hades-trades/data/trades.json snapshot", "trades": trades}
json.dump(out, open(a.out, "w"), indent=1); print(f"wrote {len(picks)} picks, {len(trades)} trades -> {a.out}")
