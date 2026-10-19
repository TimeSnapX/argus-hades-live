// Argus × Hades Live — research-only dashboard. No API keys; every figure shows its source and age.
const DS = "https://api.dexscreener.com";
const WSOL = "So11111111111111111111111111111111111111112";
const CRR = (ca) => `https://timesnapx.github.io/coin-risk-reward/#/coin/${ca}`;
const POLL_SCOUT = 20000, POLL_PRICE = 15000, POLL_FEED = 60000;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? undefined : n; };
const S = { live: true, solUsd: undefined, src: {}, pairs: new Map(), rc: new Map(), scout: [], feed: null, trades: null, tradesSrc: "", who: "all", timers: [] };
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

// ---------- formatting
const bne = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const bneD = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const usd = (v) => v === undefined ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`;
const px = (v) => v === undefined ? "—" : v >= 1 ? `$${v.toFixed(4)}` : `$${v.toPrecision(4)}`;
const pct = (v) => v === undefined ? '<i class="sub">—</i>' : `<b class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</b>`;
const sol = (v, sign) => v === undefined ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(4)} SOL`;
const ago = (t) => { if (!t) return "never"; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago` : `${Math.floor(s / 86400)}d ago`; };
const age = (t) => { if (!t) return "—"; const m = (Date.now() - t) / 60000; return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`; };
const srcTag = (k) => { const s = S.src[k]; if (!s) return `<span class="sub">${esc(k)}: waiting…</span>`; return s.ok ? `<span class="sub">${esc(k)} · ${ago(s.at)}</span>` : `<span class="err">${esc(k)} unavailable (${esc(s.err)})${s.lastOk ? ` · last ok ${ago(s.lastOk)}` : ""}</span>`; };
const mark = (k, ok, err) => { const p = S.src[k] || {}; S.src[k] = ok ? { ok: true, at: Date.now(), lastOk: Date.now() } : { ok: false, at: Date.now(), err: String(err?.message || err).slice(0, 80), lastOk: p.lastOk }; };
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 1600); }

async function getJSON(url, timeout = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { throw new Error(e.name === "AbortError" ? "timeout" : e.message.includes("fetch") ? "network/CORS error" : e.message); }
  finally { clearTimeout(tm); }
}

// ---------- SOL price (Jupiter → DexScreener fallback)
async function loadSol() {
  try { const j = await getJSON(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`); const v = num(j?.[WSOL]?.usdPrice); if (!v) throw new Error("no price"); S.solUsd = v; S.solSrc = "Jupiter"; mark("SOL price", true); }
  catch (e) {
    try { const a = await getJSON(`${DS}/tokens/v1/solana/${WSOL}`); const p = a.filter((x) => x.quoteToken?.symbol?.match(/USDC|USDT/)).sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0]; const v = num(p?.priceUsd); if (!v) throw new Error("no price"); S.solUsd = v; S.solSrc = "DexScreener"; mark("SOL price", true); }
    catch (e2) { mark("SOL price", false, `Jupiter: ${e.message}; DexScreener: ${e2.message}`); }
  }
}

// ---------- DexScreener pairs for many mints (30 per call); keeps best-liquidity Solana pair per mint
async function loadPairs(mints, tag = "DexScreener pairs") {
  const uniq = [...new Set(mints.filter(Boolean))]; const out = new Map(); let fails = 0, err;
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    try {
      const arr = await getJSON(`${DS}/tokens/v1/solana/${chunk.join(",")}`);
      for (const p of Array.isArray(arr) ? arr : []) {
        const m = p.baseToken?.address; if (!m || !chunk.includes(m)) continue;
        const cur = out.get(m); if (!cur || (num(p.liquidity?.usd) || 0) > (num(cur.liquidity?.usd) || 0)) out.set(m, p);
      }
    } catch (e) { fails++; err = e; }
  }
  for (const [m, p] of out) S.pairs.set(m, { p, at: Date.now() });
  if (uniq.length) mark(tag, fails === 0, err);
  return out;
}
function priceSol(p) { if (!p) return undefined; if (p.quoteToken?.address === WSOL) return num(p.priceNative); const u = num(p.priceUsd); return u && S.solUsd ? u / S.solUsd : undefined; }

// ---------- RugCheck quick verdict (summary endpoint), cached 10 min, 3 at a time
const rcQueue = new Set(); let rcBusy = 0;
function rugcheck(ca) { const c = S.rc.get(ca); if (c && (Date.now() - c.at < 600000 || c.pending)) return c; if (!rcQueue.has(ca)) { rcQueue.add(ca); pumpRc(); } return c; }
function pumpRc() {
  while (rcBusy < 3 && rcQueue.size) {
    const ca = rcQueue.values().next().value; rcQueue.delete(ca); rcBusy++;
    S.rc.set(ca, { ...(S.rc.get(ca) || {}), pending: true });
    getJSON(`https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`, 10000)
      .then((j) => { const risks = (j.risks || []).map((r) => ({ name: r.name, level: r.level })); S.rc.set(ca, { ok: true, at: Date.now(), score: num(j.score_normalised ?? j.score), risks, lp: num(j.lpLockedPct) }); mark("RugCheck", true); })
      .catch((e) => { S.rc.set(ca, { ok: false, at: Date.now(), err: e.message }); mark("RugCheck", false, e); })
      .finally(() => { rcBusy--; renderSoon(); pumpRc(); });
  }
}
function rcPill(ca) {
  const r = S.rc.get(ca);
  if (!r || r.pending && r.ok === undefined) return `<span class="pill">RugCheck…</span>`;
  if (!r.ok) return `<span class="pill" title="${esc(r.err)}">RugCheck unavailable</span>`;
  const danger = r.risks.filter((x) => x.level === "danger"), warn = r.risks.filter((x) => x.level === "warn");
  const cls = danger.length ? "bad" : warn.length ? "mid" : "ok";
  const label = danger.length ? `⚠ ${danger.length} danger` : warn.length ? `${warn.length} warn` : "No risks";
  const tip = r.risks.map((x) => `${x.level}: ${x.name}`).join("\n") || "no risks reported";
  return `<span class="pill ${cls}" title="${esc(tip)}">RC ${label}${r.lp !== undefined ? ` · LP ${r.lp.toFixed(0)}%` : ""}</span>`;
}

// ---------- shared token card
function coinCard(ca, p, extra = "", opts = {}) {
  const sym = p?.baseToken?.symbol || opts.symbol || ca.slice(0, 6);
  const name = p?.baseToken?.name || "";
  const created = num(p?.pairCreatedAt);
  const watched = LS.get("watch", []).some((w) => w.ca === ca);
  const pd = p ? `<div class="grid">
    <div><span>Mcap</span>${usd(num(p.marketCap ?? p.fdv))}</div><div><span>Liquidity</span>${usd(num(p.liquidity?.usd))}</div><div><span>Price</span>${px(num(p.priceUsd))}</div>
    <div><span>Vol 5m</span>${usd(num(p.volume?.m5))}</div><div><span>Vol 1h</span>${usd(num(p.volume?.h1))}</div><div><span>Age</span>${age(created)}</div>
    <div><span>Δ 5m</span>${pct(num(p.priceChange?.m5))}</div><div><span>Δ 1h</span>${pct(num(p.priceChange?.h1))}</div><div><span>DEX</span>${esc(p.dexId || "—")}</div></div>`
    : `<div class="sub">Market data unavailable from DexScreener${S.src["DexScreener pairs"]?.ok === false ? " (source error)" : " (no Solana pair found yet)"}.</div>`;
  return `<div class="card" data-ca="${esc(ca)}"><div class="top"><div>${p?.info?.imageUrl ? `<img src="${esc(p.info.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span class="nm">${esc(sym)}</span> <span class="sub">${esc(name)}</span></div>${opts.noRc ? "" : rcPill(ca)}</div>
  <div class="ca">${esc(ca)}</div>${extra}${pd}
  <div class="acts"><button class="btn sm" data-copy="${esc(ca)}">Copy CA</button><a class="btn sm" href="${CRR(ca)}" target="_blank" rel="noopener">Risk vs Reward ↗</a>${p?.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">Chart ↗</a>` : ""}<button class="btn sm" data-watch="${esc(ca)}" data-sym="${esc(sym)}">${watched ? "★ Watching" : "☆ Watch"}</button></div></div>`;
}

// ---------- Scout
async function loadScout() {
  const mints = new Map(); const tag = (m, t) => mints.set(m, [...new Set([...(mints.get(m) || []), t])]);
  const jobs = [
    ["Profiles", `${DS}/token-profiles/latest/v1`, (a) => a.filter((x) => x.chainId === "solana").forEach((x) => tag(x.tokenAddress, "profile"))],
    ["Boosts", `${DS}/token-boosts/latest/v1`, (a) => a.filter((x) => x.chainId === "solana").forEach((x) => tag(x.tokenAddress, "boost"))],
    ["Search pumpswap", `${DS}/latest/dex/search?q=pumpswap`, (j) => (j.pairs || []).filter((p) => p.chainId === "solana").forEach((p) => tag(p.baseToken.address, "grad"))],
    ["Search pump", `${DS}/latest/dex/search?q=pump%20sol`, (j) => (j.pairs || []).filter((p) => p.chainId === "solana").forEach((p) => tag(p.baseToken.address, "search"))],
  ];
  const res = await Promise.allSettled(jobs.map(([, u, f]) => getJSON(u).then(f)));
  const fails = res.map((r, i) => r.status === "rejected" ? `${jobs[i][0]}: ${r.reason.message}` : null).filter(Boolean);
  mark("DexScreener scout", fails.length < jobs.length, fails.join("; "));
  if (fails.length === jobs.length) return renderSoon();
  S.scoutPartial = fails;
  const pairs = await loadPairs([...mints.keys()].slice(0, 120));
  const now = Date.now();
  S.scout = [...pairs.values()].map((p) => ({ ca: p.baseToken.address, p, tags: mints.get(p.baseToken.address) || [] }))
    .filter((x) => num(x.p.pairCreatedAt) && now - x.p.pairCreatedAt < 72 * 3600e3)
    .map((x) => ({ ...x, grad: x.ca.endsWith("pump") && x.p.dexId !== "pumpfun" }))
    .sort((a, b) => b.p.pairCreatedAt - a.p.pairCreatedAt).slice(0, 40);
  S.scoutAt = Date.now();
  S.scout.slice(0, 20).forEach((x) => rugcheck(x.ca));
  renderSoon();
}
function renderScout() {
  const f = $("#sfilter").value;
  let list = S.scout; if (f === "grad") list = list.filter((x) => x.grad); if (f === "safe") list = list.filter((x) => { const r = S.rc.get(x.ca); return r?.ok && !r.risks.some((k) => k.level === "danger"); });
  $("#scoutMeta").innerHTML = `${srcTag("DexScreener scout")} · ${srcTag("RugCheck")} · polled every ${POLL_SCOUT / 1000}s · Solana pairs < 72h old, newest first${S.scoutPartial?.length ? ` · <span class="warn">partial: ${esc(S.scoutPartial.join("; "))}</span>` : ""}`;
  $("#scoutList").innerHTML = list.length ? list.map((x) => coinCard(x.ca, x.p, `<div class="sub">${x.grad ? '<span class="pill ok">pump.fun graduated</span> ' : ""}${x.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(" ")}</div>`)).join("")
    : `<div class="card sub">${S.src["DexScreener scout"]?.ok === false ? "Scout feed unavailable: DexScreener could not be reached." : S.scoutAt ? "No matching new pairs right now." : "Loading live pairs…"}</div>`;
}

// ---------- Feed (Argus picks + trades)
async function loadFeed() {
  try { S.feed = await getJSON(`public/feed.json?t=${Date.now()}`); mark("feed.json", true); } catch (e) { mark("feed.json", false, e); }
  // Trades: live Hades Trades log (same origin) first, then feed.json snapshot
  try { const j = await getJSON(`/hades-trades/data/trades.json?t=${Date.now()}`); if (!Array.isArray(j.trades)) throw new Error("bad format"); S.trades = j.trades; S.tradesSrc = `Hades Trades log (updated ${j.updated_aest ? bneD.format(new Date(j.updated_aest)) : "?"} AEST)`; mark("Hades trades", true); }
  catch (e) { mark("Hades trades", false, e); if (S.feed?.trades) { S.trades = S.feed.trades; S.tradesSrc = "feed.json trades (snapshot; live Hades log unavailable)"; } }
  const mints = [...picks().map((p) => p.ca), ...openMints()];
  await loadPairs(mints, "DexScreener prices");
  renderSoon();
}
const local = () => LS.get("import", { picks: [], trades: [] });
function picks() { const l = local().picks.map((p) => ({ ...p, local: true })); return [...l, ...(S.feed?.argus?.picks || [])].sort((a, b) => String(b.time_aest).localeCompare(String(a.time_aest))); }
function allTrades() { const seen = new Set(); return [...(S.trades || []), ...local().trades.map((t) => ({ ...t, local: true }))].filter((t) => { const k = t.tx || t.id; if (k && seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => String(a.time_aest).localeCompare(String(b.time_aest))); }
function renderArgus() {
  const ps = picks();
  $("#argusMeta").innerHTML = `${srcTag("feed.json")}${S.feed?.updated_aest ? ` · feed updated ${bneD.format(new Date(S.feed.updated_aest))} AEST` : ""} · prices ${srcTag("DexScreener prices")}${local().picks.length ? ` · ${local().picks.length} imported locally` : ""}`;
  $("#argusList").innerHTML = ps.length ? ps.map((k) => {
    const pp = S.pairs.get(k.ca)?.p; const cls = /high/.test(k.risk || "") ? "bad" : "mid";
    return coinCard(k.ca, pp, `<div class="sub" style="margin:4px 0"><span class="pill ${k.rank === "pick" ? "ok" : ""}">${esc(k.rank || "pick")}</span> <span class="pill ${cls}">risk ${esc(k.risk || "n/a")}</span> ${k.score10 != null ? `<b>${k.score10}/10</b>` : ""} · ${k.time_aest ? bneD.format(new Date(k.time_aest)) + " AEST" : "time n/a"}${k.local ? " · local import" : ""}</div><div>${esc(k.reason || "")}</div>${k.levels ? `<div class="sub">Levels: ${esc(k.levels)}</div>` : ""}<div class="sub">Source: ${esc(k.source || "feed.json")}</div>`, { symbol: k.symbol, noRc: true });
  }).join("") : `<div class="card sub">${S.src["feed.json"]?.ok === false ? "feed.json unavailable." : "No Argus picks in the feed yet."}</div>`;
}

// ---------- Hades positions & P&L (SOL)
function positions(who) {
  const pos = new Map(); const curve = []; let realized = 0;
  for (const t of allTrades()) {
    if (!["BUY", "SELL"].includes(t.action) || !t.mint) continue;
    const tr = t.trader === "agent" ? "agent" : "human"; if (who !== "all" && tr !== who) continue;
    const k = `${tr}|${t.mint}`; const p = pos.get(k) || { trader: tr, mint: t.mint, token: t.token, tokens: 0, cost: 0, spent: 0, got: 0, realized: 0, buys: 0, sells: 0, first: t.time_aest, last: t.time_aest };
    const solAmt = num(t.sol) || 0, tok = num(t.tokens);
    if (t.action === "BUY") { p.tokens += tok || 0; p.cost += solAmt; p.spent += solAmt; p.buys++; }
    else {
      const frac = tok && p.tokens > 0 ? Math.min(1, tok / p.tokens) : 1; const basis = p.cost * frac;
      const r = solAmt - basis; p.realized += r; realized += r; p.cost -= basis; p.tokens = Math.max(0, p.tokens - (tok ?? p.tokens)); p.got += solAmt; p.sells++;
      if (p.tokens < 1e-9 || frac >= 0.999) { p.tokens = 0; p.cost = 0; }
      curve.push({ t: Date.parse(t.time_aest), v: realized });
    }
    p.last = t.time_aest; pos.set(k, p);
  }
  return { list: [...pos.values()], curve, realized };
}
function openMints() { return positions("all").list.filter((p) => p.tokens > 0).map((p) => p.mint); }
function renderHades() {
  const { list, curve, realized } = positions(S.who);
  let unreal = 0, openVal = 0, missing = 0; const open = list.filter((p) => p.tokens > 0), closed = list.filter((p) => p.tokens === 0 && p.sells);
  for (const p of open) { const ps = priceSol(S.pairs.get(p.mint)?.p); if (ps === undefined) { missing++; p.value = undefined; continue; } p.value = p.tokens * ps; openVal += p.value; p.unreal = p.value - p.cost; unreal += p.unreal; }
  const wins = closed.filter((p) => p.realized > 0).length;
  const spent = list.reduce((s, p) => s + p.spent, 0);
  $("#hadesMeta").innerHTML = `Trades: ${S.trades ? esc(S.tradesSrc) : '<span class="err">no trade data (import below)</span>'} · ${srcTag("Hades trades")} · prices ${srcTag("DexScreener prices")}${local().trades.length ? ` · ${local().trades.length} imported locally` : ""}. P&amp;L in SOL; Me = human, Agent = Hades-logged picks.`;
  const tot = realized + unreal;
  $("#hadesSum").innerHTML = `<div>Realized<b class="${realized >= 0 ? "pos" : "neg"}">${sol(realized, 1)}</b></div><div>Unrealized (live)<b class="${unreal >= 0 ? "pos" : "neg"}">${!open.length ? "—" : missing === open.length ? "unavailable" : sol(unreal, 1)}</b>${missing ? `<span class="warn">${missing} price${missing > 1 ? "s" : ""} unavailable</span>` : ""}</div>
   <div>Win rate (closed)<b>${closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : "—"}</b>${wins}/${closed.length} positions</div><div>Total P&amp;L<b class="${tot >= 0 ? "pos" : "neg"}">${sol(tot, 1)}</b>${S.solUsd ? `≈ ${usd(Math.abs(tot * S.solUsd)).replace("$", tot < 0 ? "−$" : "$")}` : ""} · bought ${spent.toFixed(3)} SOL</div>`;
  drawEq(curve, unreal, open.length > 0);
  const rows = [...open, ...closed.sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 25)];
  $("#posList").innerHTML = rows.length ? rows.map((p) => {
    const pr = S.pairs.get(p.mint)?.p; const o = p.tokens > 0;
    return `<div class="card"><div class="top"><div><span class="nm">${esc(p.token || p.mint.slice(0, 6))}</span> <span class="pill ${p.trader === "agent" ? "mid" : ""}">${p.trader === "agent" ? "Agent" : "Me"}</span> <span class="pill ${o ? "ok" : ""}">${o ? "OPEN" : "closed"}</span></div><div>${o ? (p.unreal !== undefined ? `<b class="${p.unreal >= 0 ? "pos" : "neg"}">${sol(p.unreal, 1)}</b>` : '<span class="warn">price unavailable</span>') : `<b class="${p.realized >= 0 ? "pos" : "neg"}">${sol(p.realized, 1)}</b>`}</div></div>
    <div class="ca">${esc(p.mint)}</div><div class="grid"><div><span>Cost in</span>${p.spent.toFixed(4)}</div><div><span>Back</span>${p.got.toFixed(4)}</div><div><span>${o ? "Value now" : "Trades"}</span>${o ? (p.value !== undefined ? p.value.toFixed(4) : "—") : `${p.buys}B/${p.sells}S`}</div>
    ${o ? `<div><span>Price</span>${px(num(pr?.priceUsd))}</div><div><span>Δ 1h</span>${pct(num(pr?.priceChange?.h1))}</div><div><span>Last</span>${bneD.format(new Date(p.last))}</div>` : `<div><span>Last</span>${bneD.format(new Date(p.last))}</div>`}</div>
    <div class="acts"><button class="btn sm" data-copy="${esc(p.mint)}">Copy CA</button><a class="btn sm" href="${CRR(p.mint)}" target="_blank" rel="noopener">Risk vs Reward ↗</a></div></div>`;
  }).join("") : `<div class="card sub">No trades for this view.</div>`;
}
function drawEq(curve, unreal, hasOpen) {
  const c = $("#eq"), dpr = devicePixelRatio || 1, w = c.clientWidth || 340, h = 120; c.width = w * dpr; c.height = h * dpr; const g = c.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const pts = [{ t: curve[0]?.t ?? Date.now(), v: 0 }, ...curve]; if (hasOpen) pts.push({ t: Date.now(), v: (curve.at(-1)?.v || 0) + unreal, live: true });
  g.fillStyle = "#8a98b0"; g.font = "10px system-ui"; g.fillText("Cumulative P&L (SOL): realized per sell, last point incl. live unrealized", 6, 12);
  if (pts.length < 2) { g.fillText("Not enough closed trades yet", 6, 60); return; }
  const vs = pts.map((p) => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sp = hi - lo || 1; const X = (i) => 6 + (i / (pts.length - 1)) * (w - 12), Y = (v) => h - 8 - ((v - lo) / sp) * (h - 28);
  g.strokeStyle = "#22304a"; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
  g.strokeStyle = vs.at(-1) >= 0 ? "#2ecc71" : "#ff5b6e"; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v)))); g.stroke();
  g.fillStyle = g.strokeStyle; g.fillText(`${vs.at(-1) >= 0 ? "+" : ""}${vs.at(-1).toFixed(4)}`, w - 70, Y(vs.at(-1)) - 4 < 20 ? 24 : Y(vs.at(-1)) - 4);
}

// ---------- Watchlist
async function loadWatch() { const w = LS.get("watch", []); if (!w.length) return; const prev = new Map(w.map((x) => [x.ca, num(S.pairs.get(x.ca)?.p?.priceUsd)])); await loadPairs(w.map((x) => x.ca), "DexScreener watch"); S.tick = prev; w.forEach((x) => rugcheck(x.ca)); renderSoon(); }
function renderWatch() {
  const w = LS.get("watch", []);
  $("#watchMeta").innerHTML = w.length ? `${srcTag("DexScreener watch")} · ticks every ${POLL_PRICE / 1000}s · stored on this device` : "Add a CA, or tap ☆ Watch on any card. Stored on this device.";
  $("#watchList").innerHTML = w.map((x) => { const p = S.pairs.get(x.ca)?.p; const now = num(p?.priceUsd), was = S.tick?.get(x.ca); const arrow = now && was ? (now > was ? '<b class="pos">▲</b>' : now < was ? '<b class="neg">▼</b>' : "•") : "";
    const since = now && x.addedPrice ? ((now / x.addedPrice - 1) * 100) : undefined;
    return coinCard(x.ca, p, `<div class="sub">${arrow} since added (${bneD.format(new Date(x.added))} AEST${x.addedPrice ? ` @ ${px(x.addedPrice)}` : ""}): ${pct(since)} · <button class="btn sm" data-unwatch="${esc(x.ca)}">Remove</button></div>`, { symbol: x.sym }); }).join("");
}
function toggleWatch(ca, sym) { let w = LS.get("watch", []); if (w.some((x) => x.ca === ca)) w = w.filter((x) => x.ca !== ca); else w.unshift({ ca, sym, added: Date.now(), addedPrice: num(S.pairs.get(ca)?.p?.priceUsd) }); LS.set("watch", w); loadWatch(); renderSoon(); }

// ---------- header / render loop
function renderHeader() {
  const s = S.src["SOL price"];
  $("#sol").innerHTML = S.solUsd ? `SOL $${S.solUsd.toFixed(2)} <span class="sub">${esc(S.solSrc)} · ${ago(s?.lastOk)}</span>` : `SOL <span class="err">${s ? "unavailable" : "…"}</span>`;
  const last = Math.max(0, ...Object.values(S.src).map((x) => x.lastOk || 0));
  $("#upd").textContent = last ? `Updated ${bne.format(new Date(last))} AEST` : "Not updated yet";
  const live = $("#live"); live.className = `btn ${S.live ? "on" : "off"}`; live.textContent = S.live ? "● Live" : "❚❚ Paused";
  const errs = Object.entries(S.src).filter(([k, v]) => !v.ok && !(k === "Hades trades" && S.trades)).map(([k]) => k);
  const n = $("#net"); if (!navigator.onLine) { n.hidden = false; n.textContent = "Offline: showing last loaded data. Live polling resumes when you reconnect."; } else if (errs.length) { n.hidden = false; n.textContent = `Unavailable right now: ${errs.join(", ")}. Affected figures are marked; nothing is estimated.`; } else n.hidden = true;
}
let rq = 0; function renderSoon() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; renderHeader(); renderScout(); renderArgus(); renderHades(); renderWatch(); }); }

function start() {
  stop(); if (!S.live || !navigator.onLine) return renderSoon();
  const every = (fn, ms) => { fn(); S.timers.push(setInterval(() => document.visibilityState === "visible" && fn(), ms)); };
  every(() => loadSol().then(renderSoon), 30000); every(loadScout, POLL_SCOUT); every(loadFeed, POLL_FEED);
  every(async () => { await loadPairs([...picks().map((p) => p.ca), ...openMints()], "DexScreener prices"); await loadWatch(); renderSoon(); }, POLL_PRICE);
}
function stop() { S.timers.forEach(clearInterval); S.timers = []; }

// ---------- import
function doImport(txt) {
  const j = JSON.parse(txt); const cur = local();
  const arr = Array.isArray(j) ? j : null;
  const ps = j?.argus?.picks || j?.picks || (arr && arr.filter((x) => x.ca && !x.action)) || [];
  const ts = j?.trades || (arr && arr.filter((x) => x.action)) || [];
  const okP = ps.filter((p) => typeof p.ca === "string" && p.ca.length >= 32), okT = ts.filter((t) => t.action && t.time_aest);
  if (!okP.length && !okT.length) throw new Error("No picks (need ca) or trades (need action, time_aest) found.");
  LS.set("import", { picks: [...okP, ...cur.picks], trades: [...okT, ...cur.trades] }); return `Imported ${okP.length} picks, ${okT.length} trades.`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-t]"); if (!b) return;
  if (b.dataset.copy) { navigator.clipboard?.writeText(b.dataset.copy).then(() => toast("CA copied"), () => toast("Copy failed")); }
  else if (b.dataset.watch) toggleWatch(b.dataset.watch, b.dataset.sym);
  else if (b.dataset.unwatch) toggleWatch(b.dataset.unwatch);
  else if (b.dataset.t) { document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("act", x === b)); document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("act", p.id === b.dataset.t)); renderSoon(); }
  else if (b.dataset.w) { S.who = b.dataset.w; b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("act", x === b)); renderSoon(); }
});
$("#live").onclick = () => { S.live = !S.live; S.live ? start() : (stop(), renderSoon()); };
$("#sfilter").onchange = renderSoon;
$("#wform").onsubmit = (e) => { e.preventDefault(); const ca = $("#wca").value.trim(); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return toast("Not a Solana address"); $("#wca").value = ""; if (!LS.get("watch", []).some((x) => x.ca === ca)) toggleWatch(ca); };
$("#impBtn").onclick = () => { $("#impMsg").textContent = ""; $("#imp").showModal(); };
$("#impOk").onclick = (e) => { e.preventDefault(); try { $("#impMsg").textContent = doImport($("#impTxt").value); loadFeed(); } catch (er) { $("#impMsg").textContent = `Import failed: ${er.message}`; } };
$("#impClr").onclick = (e) => { e.preventDefault(); LS.set("import", { picks: [], trades: [] }); $("#impMsg").textContent = "Local import cleared."; renderSoon(); };
addEventListener("online", start); addEventListener("offline", () => { stop(); renderSoon(); });
setInterval(renderHeader, 1000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
window.__S = S;
start();
