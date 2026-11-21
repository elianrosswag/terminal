// Temporary: tests which stock data sources answer from Netlify's servers. Remove after use.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const T = {
  cboeQuote: "https://cdn.cboe.com/api/global/delayed_quotes/quotes/COIN.json",
  cboeHist: "https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/COIN.json",
  cboeIntraday: "https://cdn.cboe.com/api/global/delayed_quotes/charts/intraday/COIN.json",
  cnbc: "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=COIN%7CMSTR&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json",
  nasdaq: "https://api.nasdaq.com/api/quote/COIN/info?assetclass=stocks",
  nasdaqChart: "https://api.nasdaq.com/api/quote/COIN/chart?assetclass=stocks&fromdate=2026-10-01&todate=2026-11-21",
  yahooQ1: "https://query1.finance.yahoo.com/v8/finance/chart/COIN?range=5d&interval=1d",
  yahooSpark: "https://query2.finance.yahoo.com/v7/finance/spark?symbols=COIN&range=5d&interval=1d",
  stooq: "https://stooq.com/q/l/?s=coin.us&f=sd2t2ohlcv&h&e=csv",
  stooqD: "https://stooq.com/q/d/l/?s=coin.us&i=d",
  revxPublic: "https://revx.revolut.com/api/1.0/public/tickers?symbols=BTC/USD",
  revxCandles: "https://revx.revolut.com/api/1.0/public/candles/BTC-USD?interval=60",
  hyperliquid: "https://api.hyperliquid.xyz/info",
};
export default async () => {
  const out: Record<string, unknown> = {};
  await Promise.all(Object.entries(T).map(async ([k, url]) => {
    try {
      const init: RequestInit = k === "hyperliquid"
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: "HYPE", interval: "1h", startTime: Date.now() - 864e5, endTime: Date.now() } }) }
        : { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } };
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      out[k] = { status: r.status, len: t.length, head: t.slice(0, 260) };
    } catch (e: any) { out[k] = { error: String(e?.message || e) }; }
  }));
  return Response.json(out, { headers: { "cache-control": "no-store" } });
};
export const config = { path: "/api/probe" };
