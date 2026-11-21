// KRAFT Terminal — market data endpoint.
//
//   GET /api/quotes?stocks=COIN,MSTR,NVDA&crypto=bitcoin,hyperliquid
//
// Runs on Netlify's servers, so the browser never has to reach Yahoo or
// CoinGecko itself (Yahoo blocks browsers via CORS, and the free public CORS
// proxies the old CRYPTERM build relied on are rate-limited or dead).
//
// Sources, in order of preference:
//   stocks  → Yahoo Finance v8 chart (1y daily: price, prev close, 7D, MA50/200, 52W, spark)
//             + Yahoo v7 quote with cookie/crumb (market cap, analyst rating, target) — best effort
//             → Stooq CSV fallback (price + prev close only) when Yahoo's chart fails
//   crypto  → CoinGecko /coins/markets (price, 24h, 7D, mcap, volume, 7D sparkline)
//             → CoinGecko /simple/price fallback
//
// Responses are cached on Netlify's CDN for 60s (and served stale for up to
// 5 min while refreshing), so many open tabs cost the upstream APIs almost nothing.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SYM_RE = /^[A-Z0-9.\-^=]{1,15}$/;
const CG_RE = /^[a-z0-9-]{1,60}$/;
const MAX_SYMBOLS = 80;
const DAY = 86_400_000;

type Quote = {
  symbol: string;
  name: string | null;
  type: "stock" | "crypto";
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  changePct7d: number | null;
  volume: number | null;
  marketCap: number | null;
  w52High: number | null;
  w52Low: number | null;
  ma50: number | null;
  ma200: number | null;
  analystRating: number | null;
  target: number | null;
  exchange: string | null;
  tv: string | null;
  spark: number[];
  marketState: string | null;
  source: string;
  asOf: number;
};

// ── helpers ────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const round = (v: number | null, d = 6) =>
  v == null ? null : Math.round(v * 10 ** d) / 10 ** d;

async function getJSON(url: string, headers: Record<string, string> = {}, ms = 8000) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Yahoo exchange codes → TradingView prefixes, so user-added tickers get the right chart.
const TV_PREFIX: Record<string, string> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NIM: "NASDAQ",
  NYQ: "NYSE", NYS: "NYSE", PCX: "AMEX", ASE: "AMEX", BTS: "CBOE", CBO: "CBOE",
  TOR: "TSX", VAN: "TSXV", LSE: "LSE", PNK: "OTC", OQB: "OTC", OQX: "OTC",
};

// ── Yahoo v8 chart ─────────────────────────────────────────────────────────
async function yahooChart(sym: string): Promise<Quote> {
  const path = `v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
  let data: any;
  try {
    data = await getJSON(`https://query1.finance.yahoo.com/${path}`);
  } catch {
    data = await getJSON(`https://query2.finance.yahoo.com/${path}`);
  }
  const res = data?.chart?.result?.[0];
  const meta = res?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!res || price == null) {
    const msg = data?.chart?.error?.description || "no price in response";
    throw new Error(msg);
  }

  // Pair timestamps with closes and drop nulls (Yahoo pads holidays with null).
  const ts: number[] = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const bars: { t: number; c: number; h: number | null; l: number | null }[] = [];
  ts.forEach((t, i) => {
    const c = num(q.close?.[i]);
    if (c != null) bars.push({ t: t * 1000, c, h: num(q.high?.[i]), l: num(q.low?.[i]) });
  });

  // Previous close: if the last bar is the current session, use the bar before it.
  // (Never use meta.chartPreviousClose — that's the close at the START of the 1y range.)
  const mktTime = (num(meta.regularMarketTime) ?? Date.now() / 1000) * 1000;
  const last = bars.at(-1);
  let prevClose: number | null =
    num(meta.regularMarketPreviousClose) ?? num(meta.previousClose) ?? null;
  if (prevClose == null && last) {
    const lastIsCurrent = last.t >= mktTime - 20 * 3_600_000;
    prevClose = lastIsCurrent ? bars.at(-2)?.c ?? null : last.c;
  }

  // 7D = vs the last close at or before one calendar week ago (matches CoinGecko's 7D).
  const weekAgo = mktTime - 7 * DAY;
  let ref7: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t <= weekAgo) { ref7 = bars[i].c; break; }

  const closes = bars.map((b) => b.c);
  const ma = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const highs = bars.map((b) => b.h).filter((v): v is number => v != null);
  const lows = bars.map((b) => b.l).filter((v): v is number => v != null);

  const exch = meta.exchangeName || null;
  const prefix = exch ? TV_PREFIX[exch] : null;
  return {
    symbol: sym,
    name: meta.longName || meta.shortName || null,
    type: "stock",
    price,
    prevClose,
    change: prevClose != null ? round(price - prevClose) : null,
    changePct: prevClose ? round(((price - prevClose) / prevClose) * 100, 4) : null,
    changePct7d: ref7 ? round(((price - ref7) / ref7) * 100, 4) : null,
    volume: num(meta.regularMarketVolume),
    marketCap: null,
    w52High: num(meta.fiftyTwoWeekHigh) ?? (highs.length ? Math.max(...highs) : null),
    w52Low: num(meta.fiftyTwoWeekLow) ?? (lows.length ? Math.min(...lows) : null),
    ma50: round(ma(50), 4),
    ma200: round(ma(200), 4),
    analystRating: null,
    target: null,
    exchange: meta.fullExchangeName || exch,
    tv: prefix && !sym.includes("-") && !sym.includes("=") ? `${prefix}:${sym.replace(/\..*$/, "")}` : null,
    spark: closes.slice(-30).map((c) => round(c, 4) as number),
    marketState: null,
    source: "yahoo",
    asOf: mktTime,
  };
}

// ── Yahoo v7 quote (needs a cookie + crumb; best effort) ────────────────────
let crumbCache: { cookie: string; crumb: string; at: number } | null = null;

async function yahooCrumb() {
  if (crumbCache && Date.now() - crumbCache.at < 30 * 60_000) return crumbCache;
  const r = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const setCookie = (r.headers as any).getSetCookie?.() ?? [r.headers.get("set-cookie") || ""];
  const cookie = setCookie.map((c: string) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("no cookie");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
    signal: AbortSignal.timeout(5000),
  });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.length > 40 || crumb.includes("<")) throw new Error("no crumb");
  crumbCache = { cookie, crumb, at: Date.now() };
  return crumbCache;
}

async function yahooQuoteBatch(syms: string[]): Promise<Record<string, any>> {
  if (!syms.length) return {};
  const { cookie, crumb } = await yahooCrumb();
  const fields = [
    "marketCap", "averageAnalystRating", "targetMeanPrice", "marketState",
    "regularMarketPreviousClose", "longName", "shortName", "regularMarketVolume",
  ].join(",");
  const out: Record<string, any> = {};
  for (let i = 0; i < syms.length; i += 40) {
    const chunk = syms.slice(i, i + 40);
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      chunk.join(","),
    )}&fields=${fields}&crumb=${encodeURIComponent(crumb)}`;
    const d = await getJSON(url, { Cookie: cookie });
    for (const q of d?.quoteResponse?.result || []) out[q.symbol] = q;
  }
  return out;
}

// ── Stooq fallback (US listings only) ──────────────────────────────────────
async function stooq(sym: string): Promise<Quote> {
  const s = sym.includes(".") || sym.includes("-") ? sym.toLowerCase() : `${sym.toLowerCase()}.us`;
  const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcvpn&h&e=csv`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`stooq HTTP ${r.status}`);
  const [head, row] = (await r.text()).trim().split(/\r?\n/);
  if (!row) throw new Error("stooq: empty");
  const cols = head.toLowerCase().split(",");
  const vals = row.split(",");
  const get = (k: string) => vals[cols.indexOf(k)];
  const price = parseFloat(get("close"));
  if (!Number.isFinite(price)) throw new Error("stooq: no data");
  const prev = parseFloat(get("prev"));
  const prevClose = Number.isFinite(prev) ? prev : null;
  const vol = parseFloat(get("volume"));
  return {
    symbol: sym, name: get("name") || null, type: "stock", price, prevClose,
    change: prevClose != null ? round(price - prevClose) : null,
    changePct: prevClose ? round(((price - prevClose) / prevClose) * 100, 4) : null,
    changePct7d: null, volume: Number.isFinite(vol) ? vol : null, marketCap: null,
    w52High: null, w52Low: null, ma50: null, ma200: null, analystRating: null, target: null,
    exchange: null, tv: null, spark: [], marketState: null, source: "stooq",
    asOf: Date.parse(`${get("date")}T${get("time") || "00:00:00"}Z`) || Date.now(),
  };
}

// ── CoinGecko ──────────────────────────────────────────────────────────────
async function coingecko(ids: string[]): Promise<Record<string, Quote>> {
  if (!ids.length) return {};
  const key = Netlify.env.get("COINGECKO_DEMO_KEY");
  const hdr: Record<string, string> = key ? { "x-cg-demo-api-key": key } : {};
  const out: Record<string, Quote> = {};
  try {
    const d: any[] = await getJSON(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}` +
        `&price_change_percentage=24h,7d&sparkline=true&per_page=${ids.length}&page=1`,
      hdr,
    );
    for (const c of d) {
      const price = num(c.current_price);
      if (price == null) continue;
      const ch = num(c.price_change_24h);
      const sp: number[] = c.sparkline_in_7d?.price || [];
      out[c.id] = {
        symbol: c.id, name: c.name, type: "crypto", price,
        prevClose: ch != null ? price - ch : null, change: ch,
        changePct: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
        changePct7d: num(c.price_change_percentage_7d_in_currency),
        volume: num(c.total_volume), marketCap: num(c.market_cap),
        w52High: null, w52Low: null, ma50: null, ma200: null, analystRating: null, target: null,
        exchange: null, tv: null,
        // 7 days of hourly points → thin to ~42 so the payload stays small
        spark: sp.filter((_, i) => i % 4 === 0).map((v) => round(v, 6) as number),
        marketState: "24/7", source: "coingecko",
        asOf: Date.parse(c.last_updated) || Date.now(),
      };
    }
  } catch {
    const d: any = await getJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd` +
        `&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true&include_last_updated_at=true`,
      hdr,
    );
    for (const [id, v] of Object.entries<any>(d)) {
      const price = num(v.usd);
      if (price == null) continue;
      const pct = num(v.usd_24h_change);
      const prev = pct != null ? price / (1 + pct / 100) : null;
      out[id] = {
        symbol: id, name: null, type: "crypto", price, prevClose: prev,
        change: prev != null ? price - prev : null, changePct: pct, changePct7d: null,
        volume: num(v.usd_24h_vol), marketCap: num(v.usd_market_cap),
        w52High: null, w52Low: null, ma50: null, ma200: null, analystRating: null, target: null,
        exchange: null, tv: null, spark: [], marketState: "24/7", source: "coingecko-simple",
        asOf: (num(v.last_updated_at) ?? Date.now() / 1000) * 1000,
      };
    }
  }
  return out;
}

// ── handler ────────────────────────────────────────────────────────────────
const parseList = (v: string | null, re: RegExp, upper: boolean) =>
  [...new Set((v || "").split(",").map((s) => (upper ? s.trim().toUpperCase() : s.trim().toLowerCase())))]
    .filter((s) => re.test(s))
    .slice(0, MAX_SYMBOLS);

export default async (req: Request) => {
  const url = new URL(req.url);
  const stocks = parseList(url.searchParams.get("stocks"), SYM_RE, true);
  const crypto = parseList(url.searchParams.get("crypto"), CG_RE, false);

  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  const sources: Record<string, { ok: number; fail: number; note?: string }> = {
    "yahoo-chart": { ok: 0, fail: 0 },
    "yahoo-quote": { ok: 0, fail: 0 },
    stooq: { ok: 0, fail: 0 },
    coingecko: { ok: 0, fail: 0 },
  };

  const [, extra, cg] = await Promise.all([
    pool(stocks, 8, async (sym) => {
      try {
        quotes[sym] = await yahooChart(sym);
        sources["yahoo-chart"].ok++;
      } catch (e: any) {
        sources["yahoo-chart"].fail++;
        try {
          quotes[sym] = await stooq(sym);
          sources.stooq.ok++;
        } catch (e2: any) {
          sources.stooq.fail++;
          errors[sym] = `yahoo: ${e?.message}; stooq: ${e2?.message}`;
        }
      }
    }),
    yahooQuoteBatch(stocks).catch((e) => {
      sources["yahoo-quote"].note = String(e?.message || e);
      return {} as Record<string, any>;
    }),
    coingecko(crypto).catch((e) => {
      sources.coingecko.note = String(e?.message || e);
      return {} as Record<string, Quote>;
    }),
  ]);

  // Merge v7 extras (market cap, analyst data) into the chart quotes.
  for (const sym of stocks) {
    const x = extra[sym];
    const q = quotes[sym];
    if (!x || !q) continue;
    sources["yahoo-quote"].ok++;
    q.marketCap = num(x.marketCap);
    q.target = num(x.targetMeanPrice);
    q.marketState = x.marketState || null;
    if (typeof x.averageAnalystRating === "string") q.analystRating = parseFloat(x.averageAnalystRating) || null;
    if (!q.name) q.name = x.longName || x.shortName || null;
    // Stooq fallback has no real-time previous close context; v7 does.
    if (q.source === "stooq" && num(x.regularMarketPreviousClose) != null) {
      q.prevClose = x.regularMarketPreviousClose;
      q.change = round(q.price - x.regularMarketPreviousClose);
      q.changePct = round(((q.price - x.regularMarketPreviousClose) / x.regularMarketPreviousClose) * 100, 4);
    }
  }
  if (stocks.length && !Object.keys(extra).length) sources["yahoo-quote"].fail = 1;

  for (const id of crypto) {
    if (cg[id]) { quotes[`cg:${id}`] = cg[id]; sources.coingecko.ok++; }
    else { sources.coingecko.fail++; errors[`cg:${id}`] = sources.coingecko.note || "not returned"; }
  }

  const body = {
    updatedAt: Date.now(),
    requested: { stocks: stocks.length, crypto: crypto.length },
    quotes,
    errors,
    sources,
  };
  const allFailed = stocks.length + crypto.length > 0 && Object.keys(quotes).length === 0;
  return new Response(JSON.stringify(body), {
    status: allFailed ? 502 : 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Browser keeps it 30s; Netlify's CDN 60s, then serves stale up to 5 min while refetching.
      "cache-control": "public, max-age=30",
      "netlify-cdn-cache-control": allFailed
        ? "no-store"
        : "public, durable, s-maxage=60, stale-while-revalidate=300",
    },
  });
};

export const config = { path: "/api/quotes", method: "GET" };
