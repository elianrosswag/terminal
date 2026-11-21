// Temporary: tests which stock data sources answer from Netlify's servers. Remove after use.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const T: Record<string,string> = {
  cnbcFull: "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=COIN%7CIBIT%7CTSM&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json",
  nasdaqHist: "https://api.nasdaq.com/api/quote/COIN/historical?assetclass=stocks&fromdate=2026-11-01&limit=5&todate=2026-11-21",
  nasdaqEtf: "https://api.nasdaq.com/api/quote/IBIT/info?assetclass=etf",
  nasdaqSummary: "https://api.nasdaq.com/api/quote/COIN/summary?assetclass=stocks",
  revxAll: "https://revx.revolut.com/api/1.0/public/tickers",
  revxHype: "https://revx.revolut.com/api/1.0/public/candles/HYPE-USD?interval=1440",

  hyperliquid: "https://api.hyperliquid.xyz/info",
};
const FULL = new Set(["cnbcFull","nasdaqHist","nasdaqEtf","nasdaqSummary","revxAll","revxHype"]);
export default async () => {
  const out: Record<string, unknown> = {};
  await Promise.all(Object.entries(T).map(async ([k, url]) => {
    try {
      const init: RequestInit = k === "hyperliquid"
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: "HYPE", interval: "1h", startTime: Date.now() - 864e5, endTime: Date.now() } }) }
        : { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } };
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      out[k] = { status: r.status, len: t.length, head: FULL.has(k) ? t.slice(0, 9000) : t.slice(0, 200) };
    } catch (e: any) { out[k] = { error: String(e?.message || e) }; }
  }));
  return Response.json(out, { headers: { "cache-control": "no-store" } });
};
export const config = { path: "/api/probe" };
