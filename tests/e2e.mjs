import { createRequire } from "node:module";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");
const BASE = process.argv[2] || "http://127.0.0.1:8765/argus-hades-live/";
const OUT = process.argv[3] || "/workspace/out/argus-hades-live.png";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const res = {};
async function run(name, mock) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  if (mock) await mock(ctx);
  await page.goto(BASE); await page.waitForTimeout(mock ? 3000 : 12000);
  const r = await page.evaluate(() => ({ scout: document.querySelectorAll("#scoutList .card[data-ca]").length, sol: document.querySelector("#sol").innerText, banner: document.querySelector("#net").hidden ? "" : document.querySelector("#net").innerText,
    argus: document.querySelectorAll("#argusList .card").length, pos: document.querySelectorAll("#posList .card").length, sum: document.querySelector("#hadesSum").innerText.replace(/\n/g, " "), rc: [...document.querySelectorAll("#scoutList .pill")].filter((x) => x.textContent.startsWith("RC")).length, src: Object.fromEntries(Object.entries(window.__S.src).map(([k, v]) => [k, v.ok ? "ok" : v.err])) }));
  if (name === "live") { await page.screenshot({ path: OUT }); await page.click('[data-t="hades"]'); await page.waitForTimeout(500); await page.screenshot({ path: OUT.replace(".png", "-hades.png") }); await page.click('[data-t="argus"]'); await page.screenshot({ path: OUT.replace(".png", "-argus.png") }); }
  if (name === "mock") { await page.click('[data-t="watch"]'); await page.fill("#wca", "MockMint1111111111111111111111111111pump"); await page.click("#wform button"); await page.waitForTimeout(1500); r.watch = await page.locator("#watchList .card").count(); await page.click("#live"); await page.waitForTimeout(300); r.liveToggle = await page.locator("#live").innerText(); }
  res[name] = { ...r, errs }; await ctx.close();
}
const now = Date.now(), M = "MockMint1111111111111111111111111111pump";
const pair = (m, i) => ({ chainId: "solana", dexId: "pumpswap", url: "https://dexscreener.com/solana/x", pairAddress: "P" + i, baseToken: { address: m, name: "Mock " + i, symbol: "MOCK" + i }, quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" }, priceNative: "0.000001", priceUsd: "0.0001", volume: { m5: 1000, h1: 9000 }, priceChange: { m5: 5, h1: -10 }, liquidity: { usd: 30000 }, marketCap: 90000, pairCreatedAt: now - 3600e3 * (i + 1) });
await run("live");
await run("mock", async (ctx) => {
  await ctx.route(/dexscreener\.com\/token-(profiles|boosts)/, (r) => r.fulfill({ json: [{ chainId: "solana", tokenAddress: M }] }));
  await ctx.route(/dexscreener\.com\/latest\/dex\/search/, (r) => r.fulfill({ json: { pairs: [pair(M, 0)] } }));
  await ctx.route(/dexscreener\.com\/tokens\/v1/, (r) => { const ms = decodeURIComponent(r.request().url().split("/solana/")[1]).split(","); r.fulfill({ json: ms.map(pair) }); });
  await ctx.route(/rugcheck/, (r) => r.fulfill({ json: { risks: [{ name: "Low liquidity", level: "warn" }], score_normalised: 5, lpLockedPct: 100 } }));
  await ctx.route(/jup\.ag/, (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 100 } } }));
});
await run("down", async (ctx) => { await ctx.route(/dexscreener|rugcheck|jup\.ag/, (r) => r.abort()); });
console.log(JSON.stringify(res, null, 1)); await b.close();
