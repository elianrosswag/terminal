// KRAFT Terminal — market data endpoint.
//
//   GET /api/quotes?stocks=COIN,MSTR,NVDA&crypto=bitcoin,hyperliquid&rx=SOL-USD,AAVE-USD
//
// Runs on Netlify's servers so the browser only ever talks to its own domain.
// (Tested from Netlify: Yahoo Finance answers 429 and Stooq/Cboe 403 there, so they're not used.)
//
//   stocks → CNBC quote service (one request for up to 40 symbols): price, previous close,
//            volume, market cap, 52-week range, pre/post-market price
//            + daily candles from our own /api/candles (CDN-cached): 7D, MA50/200, sparkline.
//            If CNBC misses a symbol, the latest daily candle stands in for the price.
//   crypto → CoinGecko /coins/markets (cg ids), CoinGecko /simple/price as fallback
//   rx     → Revolut X public tickers, for coins without a CoinGecko id (e.g. your Revolut X holdings)
//
// Each response is cached on Netlify's CDN for 60s, so many open tabs cost the sources almost nothing.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SYM_RE = /^[A-Z0-9.\-]{1,12}$/;
const CG_RE = /^[a-z0-9-]{1,60}$/;
const RX_RE = /^[A-Z0-9]{1,12}-(USD|USDC|USDT|EUR|GBP)$/;
const MAX = 80;
const DAY = 86_400_000;

type Quote = {
  symbol: string; name: string | null; type: "stock" | "crypto";
  price: number; prevClose: number | null; change: number | null; changePct: number | null; changePct7d: number | null;
  volume: number | null; marketCap: number | null; w52High: number | null; w52Low: number | null;
  ma50: number | null; ma200: number | null; analystRating: null; target: number | null;
  exchange: string | null; tv: string | null; spark: number[];
  marketState: string | null; ext: { price: number; change: number | null; changePct: number | null; session: string } | null;
  source: string; asOf: number;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const x = parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const round = (v: number | null, d = 6) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const bigNum = (v: unknown) => {
  const m = String(v ?? "").trim().match(/^([\d.,]+)\s*([KMBT])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || "").toUpperCase() as "K"] || 1;
  return parseFloat(m[1].replace(/,/g, "")) * mult;
};

async function getJSON(url: string, headers: Record<string, string> = {}, ms = 8000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const TV: Record<string, string> = { NASDAQ: "NASDAQ", NYSE: "NYSE", "NYSE ARCA": "AMEX", "NYSE AMERICAN": "AMEX", AMEX: "AMEX", CBOE: "CBOE", BATS: "CBOE" };

// ── CNBC batch quotes ─────────────────────────────────────────────────────
async function cnbc(syms: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  for (let i = 0; i < syms.length; i += 40) {
    const chunk = syms.slice(i, i + 40);
    const url = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" +
      encodeURIComponent(chunk.join("|")) + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json";
    const d: any = await getJSON(url);
    const list: any[] = [].concat(d?.FormattedQuoteResult?.FormattedQuote || []);
    for (const q of list) {
      const sym = String(q.symbol || "").toUpperCase();
      const price = num(q.last);
      if (!chunk.includes(sym) || price == null || String(q.code) !== "0") continue;
      const prev = num(q.previous_day_closing);
      const x = q.ExtendedMktQuote;
      const xp = num(x?.last);
      const exch = String(q.exchange || "").toUpperCase();
      out[sym] = {
        symbol: sym, name: q.altName || q.name || null, type: "stock", price,
        prevClose: prev, change: num(q.change) ?? (prev != null ? round(price - prev) : null),
        changePct: num(q.change_pct) ?? (prev ? round(((price - prev) / prev) * 100, 4) : null),
        changePct7d: null, volume: num(q.volume), marketCap: bigNum(q.mktcapView),
        w52High: num(q.yrhiprice), w52Low: num(q.yrloprice), ma50: null, ma200: null, analystRating: null, target: null,
        exchange: q.exchange || null, tv: TV[exch] ? `${TV[exch]}:${sym}` : null, spark: [],
        marketState: q.curmktstatus || null,
        ext: xp != null && x?.type ? { price: xp, change: num(x.change), changePct: num(x.change_pct), session: String(x.type) } : null,
        source: "cnbc", asOf: Date.parse(q.last_timedate) || Date.now(),
      };
    }
  }
  return out;
}

// ── history from our own candles endpoint (CDN-cached) ──────────────────────
async function history(origin: string, s: string, k: "stock" | "crypto"): Promise<number[][]> {
  const r = await fetch(`${origin}/api/candles?s=${encodeURIComponent(s)}&k=${k}&tf=1D`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`candles HTTP ${r.status}`);
  const d: any = await r.json();
  return d.bars || [];
}
function applyHistory(q: Partial<Quote>, bars: number[][], price: number) {
  const closes = bars.map((b) => b[4]);
  const ma = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const weekAgo = (Date.now() - 7 * DAY) / 1000;
  let ref: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i][0] <= weekAgo) { ref = bars[i][4]; break; }
  q.changePct7d = ref ? round(((price - ref) / ref) * 100, 4) : null;
  q.ma50 = round(ma(50), 4);
  q.ma200 = round(ma(200), 4);
  q.spark = [...closes.slice(-29), price].map((c) => round(c, 6) as number);
  if (q.w52High == null && bars.length) {
    const yr = bars.filter((b) => b[0] >= Date.now() / 1000 - 365 * 86400);
    q.w52High = Math.max(...yr.map((b) => b[2])); q.w52Low = Math.min(...yr.map((b) => b[3]));
  }
}

// ── CoinGecko ──────────────────────────────────────────────────────────────
async function coingecko(ids: string[]): Promise<Record<string, Quote>> {
  if (!ids.length) return {};
  const key = Netlify.env.get("COINGECKO_DEMO_KEY");
  const hdr: Record<string, string> = key ? { "x-cg-demo-api-key": key } : {};
  const out: Record<string, Quote> = {};
  const base = (id: string, price: number): Quote => ({
    symbol: id, name: null, type: "crypto", price, prevClose: null, change: null, changePct: null, changePct7d: null,
    volume: null, marketCap: null, w52High: null, w52Low: null, ma50: null, ma200: null, analystRating: null, target: null,
    exchange: null, tv: null, spark: [], marketState: "24/7", ext: null, source: "coingecko", asOf: Date.now(),
  });
  try {
    const d: any[] = await getJSON(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}` +
        `&price_change_percentage=24h,7d&sparkline=true&per_page=${ids.length}&page=1`, hdr);
    for (const c of d) {
      const price = num(c.current_price);
      if (price == null) continue;
      const ch = num(c.price_change_24h);
      out[c.id] = {
        ...base(c.id, price), name: c.name, prevClose: ch != null ? price - ch : null, change: ch,
        changePct: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
        changePct7d: num(c.price_change_percentage_7d_in_currency), volume: num(c.total_volume), marketCap: num(c.market_cap),
        spark: (c.sparkline_in_7d?.price || []).filter((_: number, i: number) => i % 4 === 0).map((v: number) => round(v, 6) as number),
        asOf: Date.parse(c.last_updated) || Date.now(),
      };
    }
  } catch {
    const d: any = await getJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`, hdr);
    for (const [id, v] of Object.entries<any>(d)) {
      const price = num(v.usd);
      if (price == null) continue;
      const pct = num(v.usd_24h_change), prev = pct != null ? price / (1 + pct / 100) : null;
      out[id] = { ...base(id, price), prevClose: prev, change: prev != null ? price - prev : null, changePct: pct,
        volume: num(v.usd_24h_vol), marketCap: num(v.usd_market_cap), source: "coingecko-simple" };
    }
  }
  return out;
}

// ── Revolut X public tickers ────────────────────────────────────────────────
async function revxTickers(pairs: string[]): Promise<Record<string, Quote>> {
  if (!pairs.length) return {};
  const d: any = await getJSON(`https://revx.revolut.com/api/1.0/public/tickers?symbols=${encodeURIComponent(pairs.map((p) => p.replace("-", "/")).join(","))}`);
  const out: Record<string, Quote> = {};
  for (const t of d?.data || []) {
    const pair = String(t.symbol).replace("/", "-");
    const price = num(t.last_price) ?? num(t.mid);
    if (price == null) continue;
    const ch = num(t.price_change_24h), prev = ch != null ? price - ch : null;
    out[pair] = {
      symbol: pair, name: null, type: "crypto", price, prevClose: prev, change: ch,
      changePct: prev ? round(((price - prev) / prev) * 100, 4) : null, changePct7d: null,
      volume: num(t.quote_volume_24h), marketCap: null, w52High: null, w52Low: null, ma50: null, ma200: null,
      analystRating: null, target: null, exchange: "Revolut X", tv: null, spark: [], marketState: "24/7", ext: null,
      source: "revolut-x", asOf: Date.now(),
    };
  }
  return out;
}

// ── handler ────────────────────────────────────────────────────────────────
const list = (v: string | null, re: RegExp, up: boolean) =>
  [...new Set((v || "").split(",").map((s) => (up ? s.trim().toUpperCase() : s.trim().toLowerCase())))].filter((s) => re.test(s)).slice(0, MAX);

export default async (req: Request) => {
  const url = new URL(req.url);
  const stocks = list(url.searchParams.get("stocks"), SYM_RE, true);
  const crypto = list(url.searchParams.get("crypto"), CG_RE, false);
  const rx = list(url.searchParams.get("rx"), RX_RE, true);

  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  const src = (k: string) => (sources[k] ||= { ok: 0, fail: 0 });
  const sources: Record<string, { ok: number; fail: number; note?: string }> = {};

  const [cq, hist, cg, rq] = await Promise.all([
    cnbc(stocks).catch((e) => { src("cnbc").note = String(e?.message || e); return {} as Record<string, Quote>; }),
    (async () => {
      const h: Record<string, number[][]> = {};
      await pool([...stocks.map((s) => [s, "stock"]), ...rx.map((s) => [s, "crypto"])] as [string, "stock" | "crypto"][], 8, async ([s, k]) => {
        try { h[s] = await history(url.origin, s, k); src("history").ok++; }
        catch (e: any) { src("history").fail++; h[s] = []; if (!errors[s]) errors[s] = `history: ${e?.message}`; }
      });
      return h;
    })(),
    coingecko(crypto).catch((e) => { src("coingecko").note = String(e?.message || e); return {} as Record<string, Quote>; }),
    revxTickers(rx).catch((e) => { src("revolut-x").note = String(e?.message || e); return {} as Record<string, Quote>; }),
  ]);

  for (const s of stocks) {
    let q = cq[s];
    const bars = hist[s] || [];
    if (q) src("cnbc").ok++; else src("cnbc").fail++;
    if (!q && bars.length) {
      // CNBC missed it: use the latest daily candle as the price.
      const last = bars.at(-1)!, prev = bars.at(-2)?.[4] ?? null;
      q = {
        symbol: s, name: null, type: "stock", price: last[4], prevClose: prev,
        change: prev != null ? round(last[4] - prev) : null, changePct: prev ? round(((last[4] - prev) / prev) * 100, 4) : null,
        changePct7d: null, volume: last[5], marketCap: null, w52High: null, w52Low: null, ma50: null, ma200: null,
        analystRating: null, target: null, exchange: null, tv: null, spark: [], marketState: null, ext: null,
        source: "daily-candle", asOf: last[0] * 1000,
      };
    }
    if (!q) { errors[s] = errors[s] ? `quote: not found; ${errors[s]}` : "quote: not found (check the ticker is US-listed)"; continue; }
    if (bars.length) { applyHistory(q, bars, q.price); delete errors[s]; }
    quotes[s] = q;
  }
  for (const id of crypto) {
    if (cg[id]) { quotes[`cg:${id}`] = cg[id]; src("coingecko").ok++; }
    else { src("coingecko").fail++; errors[`cg:${id}`] = sources.coingecko?.note || "not returned"; }
  }
  for (const p of rx) {
    const q = rq[p];
    if (!q) { src("revolut-x").fail++; errors[`rx:${p}`] = sources["revolut-x"]?.note || "pair not found on Revolut X"; continue; }
    src("revolut-x").ok++;
    if (hist[p]?.length) { applyHistory(q, hist[p], q.price); delete errors[p]; }
    quotes[`rx:${p}`] = q;
  }

  const allFailed = stocks.length + crypto.length + rx.length > 0 && !Object.keys(quotes).length;
  return new Response(JSON.stringify({ updatedAt: Date.now(), quotes, errors, sources }), {
    status: allFailed ? 502 : 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
      "netlify-cdn-cache-control": allFailed ? "no-store" : "public, durable, s-maxage=60, stale-while-revalidate=300",
    },
  });
};

export const config = { path: "/api/quotes", method: "GET" };
