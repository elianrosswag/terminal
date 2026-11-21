// Temporary: tests which stock data sources answer from Netlify's servers. Remove after use.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const T: Record<string,string> = {
  cnbc1D: "https://ts-api.cnbc.com/harmony/app/bars/COIN/1D/20251120000000/20261121000000/adjusted/EST5EDT.json",
  cnbc1H: "https://ts-api.cnbc.com/harmony/app/bars/COIN/1H/20261101000000/20261121000000/adjusted/EST5EDT.json",
  cnbc15: "https://ts-api.cnbc.com/harmony/app/bars/COIN/15M/20261110000000/20261121000000/adjusted/EST5EDT.json",
  cnbc5: "https://ts-api.cnbc.com/harmony/app/bars/COIN/5M/20261118000000/20261121000000/adjusted/EST5EDT.json",
  nasdaqYear: "https://api.nasdaq.com/api/quote/IBIT/historical?assetclass=etf&fromdate=2025-11-20&limit=400&todate=2026-11-21",
  revxEth: "https://revx.revolut.com/api/1.0/public/candles/ETH-USD?interval=15",
};
const FULL = new Set(["cnbc1D","cnbc1H","cnbc15","cnbc5"]);
export default async () => {
  const out: Record<string, unknown> = {};
  await Promise.all(Object.entries(T).map(async ([k, url]) => {
    try {
      const init: RequestInit = { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } };
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      out[k] = { status: r.status, len: t.length, head: FULL.has(k) ? t.slice(0, 1200) : t.slice(0, 300), tail: t.slice(-300) };
    } catch (e: any) { out[k] = { error: String(e?.message || e) }; }
  }));
  return Response.json(out, { headers: { "cache-control": "no-store" } });
};
export const config = { path: "/api/probe" };
