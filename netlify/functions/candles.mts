// KRAFT Terminal — OHLC candles for the chart tab and for 7D / moving averages.
//
//   GET /api/candles?s=COIN&k=stock&tf=1D
//   GET /api/candles?s=BTC-USD&k=crypto&tf=4H
//
// tf: 15m | 1H | 4H | 1D | 1W.  Times in the response are UTC seconds (bar open).
// Stocks: CNBC bars (5M/1H/1D; 15m and 4H/1W are built by merging), Nasdaq daily as fallback.
// Crypto: Revolut X public candles, Hyperliquid as fallback.
// Cached on Netlify's CDN: 1 minute for intraday, 15 minutes for daily/weekly.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const H = 3600, D = 86400;
type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type TF = "15m" | "1H" | "4H" | "1D" | "1W";
const TFS: TF[] = ["15m", "1H", "4H", "1D", "1W"];

async function getJSON(url: string, init: RequestInit = {}, ms = 9000) {
  const r = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", ...(init.headers || {}) },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(x) ? x : NaN;
};
const ok = (b: Bar) => [b.o, b.h, b.l, b.c].every(Number.isFinite) && b.t > 0;

// Merge bars into larger buckets. key(t) returns the bucket start (UTC seconds).
function merge(bars: Bar[], key: (t: number) => number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const k = key(b.t);
    const last = out.at(-1);
    if (last && last.t === k) {
      last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v;
    } else out.push({ ...b, t: k });
  }
  return out;
}
const weekKey = (t: number) => { const d = Math.floor(t / D); return (d - ((d + 3) % 7)) * D; }; // Monday 00:00 UTC
const every = (s: number) => (t: number) => Math.floor(t / s) * s;

// ── stocks ────────────────────────────────────────────────────────────────
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
async function cnbc(sym: string, iv: "5M" | "1H" | "1D", days: number): Promise<Bar[]> {
  const end = Date.now() + D * 1000, start = Date.now() - days * D * 1000;
  const url = `https://ts-api.cnbc.com/harmony/app/bars/${encodeURIComponent(sym)}/${iv}/${stamp(start)}/${stamp(end)}/adjusted/EST5EDT.json`;
  const d: any = await getJSON(url);
  const rows: any[] = d?.barData?.priceBars || [];
  if (!rows.length) throw new Error(d?.statusMessage || "no bars");
  return rows.map((r) => {
    let t = Math.floor(n(r.tradeTimeinMills) / 1000);
    if (iv === "1D") { const s = String(r.tradeTime); t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 1000; }
    return { t, o: n(r.open), h: n(r.high), l: n(r.low), c: n(r.close), v: n(r.volume) || 0 };
  }).filter(ok).sort((a, b) => a.t - b.t);
}
async function nasdaqDaily(sym: string, days: number): Promise<Bar[]> {
  const from = new Date(Date.now() - days * D * 1000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + D * 1000).toISOString().slice(0, 10);
  for (const cls of ["stocks", "etf"]) {
    const d: any = await getJSON(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${cls}&fromdate=${from}&limit=9999&todate=${to}`,
    ).catch(() => null);
    const rows: any[] = d?.data?.tradesTable?.rows || [];
    if (!rows.length) continue;
    return rows.map((r) => {
      const [m, dd, y] = String(r.date).split("/").map(Number);
      return { t: Date.UTC(y, m - 1, dd) / 1000, o: n(r.open), h: n(r.high), l: n(r.low), c: n(r.close), v: n(r.volume) || 0 };
    }).filter(ok).sort((a, b) => a.t - b.t);
  }
  throw new Error("nasdaq: no data");
}
async function stockBars(sym: string, tf: TF): Promise<{ bars: Bar[]; source: string }> {
  try {
    if (tf === "15m") return { bars: merge(await cnbc(sym, "5M", 14), every(15 * 60)), source: "cnbc" };
    if (tf === "1H") return { bars: await cnbc(sym, "1H", 90), source: "cnbc" };
    if (tf === "4H") return { bars: merge(await cnbc(sym, "1H", 240), every(4 * H)), source: "cnbc" };
    if (tf === "1D") return { bars: await cnbc(sym, "1D", 3 * 365), source: "cnbc" };
    return { bars: merge(await cnbc(sym, "1D", 6 * 365), weekKey), source: "cnbc" };
  } catch (e) {
    if (tf === "1D") return { bars: await nasdaqDaily(sym, 3 * 365), source: "nasdaq" };
    if (tf === "1W") return { bars: merge(await nasdaqDaily(sym, 6 * 365), weekKey), source: "nasdaq" };
    throw e;
  }
}

// ── crypto ────────────────────────────────────────────────────────────────
async function revx(pair: string, minutes: number, bars: number): Promise<Bar[]> {
  const since = Date.now() - minutes * 60_000 * bars;
  const d: any = await getJSON(
    `https://revx.revolut.com/api/1.0/public/candles/${encodeURIComponent(pair)}?interval=${minutes}&since=${since}`,
  );
  const rows: any[] = d?.data || [];
  if (!rows.length) throw new Error("revx: no candles");
  return rows.map((r) => ({ t: Math.floor(n(r.start) / 1000), o: n(r.open), h: n(r.high), l: n(r.low), c: n(r.close), v: n(r.volume) || 0 }))
    .filter(ok).sort((a, b) => a.t - b.t);
}
async function hyperliquid(coin: string, iv: string, secs: number, bars: number): Promise<Bar[]> {
  const d: any[] = await getJSON("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: iv, startTime: Date.now() - secs * 1000 * bars, endTime: Date.now() } }),
  });
  if (!Array.isArray(d) || !d.length) throw new Error("hyperliquid: no candles");
  return d.map((r) => ({ t: Math.floor(r.t / 1000), o: n(r.o), h: n(r.h), l: n(r.l), c: n(r.c), v: n(r.v) || 0 })).filter(ok);
}
async function cryptoBars(pair: string, tf: TF): Promise<{ bars: Bar[]; source: string }> {
  const spec: Record<TF, [number, number, string, number]> = {
    // revx minutes, bars, hyperliquid interval, seconds
    "15m": [15, 1000, "15m", 900], "1H": [60, 1500, "1h", H], "4H": [240, 1500, "4h", 4 * H],
    "1D": [1440, 1500, "1d", D], "1W": [1440, 2500, "1w", 7 * D],
  };
  const [min, count, hlIv, secs] = spec[tf];
  try {
    const b = await revx(pair, min, count);
    return { bars: tf === "1W" ? merge(b, weekKey) : b, source: "revolut-x" };
  } catch (e) {
    const coin = pair.split("-")[0];
    return { bars: await hyperliquid(coin, hlIv, secs, tf === "1W" ? 400 : 1000), source: "hyperliquid" };
  }
}

export default async (req: Request) => {
  const u = new URL(req.url);
  const s = (u.searchParams.get("s") || "").toUpperCase();
  const k = u.searchParams.get("k") === "crypto" ? "crypto" : "stock";
  const tf = (TFS.includes(u.searchParams.get("tf") as TF) ? u.searchParams.get("tf") : "1D") as TF;
  const valid = k === "crypto" ? /^[A-Z0-9]{1,12}-(USD|USDC|USDT|EUR|GBP)$/.test(s) : /^[A-Z0-9.\-]{1,12}$/.test(s);
  if (!valid) return Response.json({ error: "bad symbol" }, { status: 400 });
  const intraday = tf === "15m" || tf === "1H" || tf === "4H";
  try {
    const { bars, source } = k === "crypto" ? await cryptoBars(s, tf) : await stockBars(s, tf);
    return Response.json({ s, k, tf, source, bars: bars.map((b) => [b.t, b.o, b.h, b.l, b.c, Math.round(b.v)]) }, {
      headers: {
        "cache-control": "public, max-age=30",
        "netlify-cdn-cache-control": `public, durable, s-maxage=${intraday ? 60 : 900}, stale-while-revalidate=${intraday ? 300 : 3600}`,
      },
    });
  } catch (e: any) {
    return Response.json({ s, k, tf, error: String(e?.message || e) }, {
      status: 502, headers: { "cache-control": "no-store", "netlify-cdn-cache-control": "no-store" },
    });
  }
};

export const config = { path: "/api/candles", method: "GET" };
