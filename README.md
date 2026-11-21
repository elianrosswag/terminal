# KRAFT Terminal · terminal.elian.ink

A tracker for crypto, crypto equities and AI stocks, with a portfolio, watchlist, TradingView charts, price alerts and a thesis journal. It replaces the old CRYPTERM build.

```
 browser (public/)                         Netlify function (netlify/functions/quotes.mts)
 ┌──────────────────────────┐   GET        ┌──────────────────────────────────────────────┐
 │ index.html + assets/     │──/api/quotes─►  Yahoo Finance chart  (stocks: price, 7D, MAs)│
 │ portfolio, journal, etc. │◄─── JSON ────│  Yahoo Finance quote  (mcap, analyst; best effort)
 │ saved in localStorage    │              │  Stooq                (fallback stock price)  │
 └──────────────────────────┘              │  CoinGecko            (crypto)                │
                                           │  cached on Netlify's CDN for 60s              │
                                           └──────────────────────────────────────────────┘
```

Running cost: £0 on Netlify's free plan. API keys: none.

## Why it broke before, and what changed

CRYPTERM fetched Yahoo Finance from the browser. Yahoo refuses browser requests from other sites (CORS), so the page tried a `/api/yf/` proxy that was never deployed, then three free public CORS proxies. Those are rate-limited or blocked, so stock prices rarely loaded; only the two CoinGecko coins did.

Now the browser only ever calls `/api/quotes` on its own domain. The function fetches every source server-side in parallel, falls back to Stooq when Yahoo fails, and the CDN caches each answer for 60 seconds. The **Data** tab shows which sources are healthy and which tickers returned nothing, and why.

Other fixes:
- Prices are fetched for every symbol you use (portfolio, journal, alerts, charts), not just the watchlist.
- Market cap and analyst ratings/targets now load (Yahoo's quote endpoint needs a cookie and "crumb", which only works server-side).
- 7D is measured against the close one calendar week ago, for stocks and crypto alike.
- Text you type (theses, notes, alert notes) is escaped, so it can't inject HTML into the page.
- Alerts only fire on fresh prices, can be re-armed, and record when and at what price they fired.
- Adding to an existing position blends the cost basis instead of overwriting it.
- Export / import of all your data as a JSON file.
- Plotly (≈3 MB) is gone; the allocation chart and sparklines are plain HTML/SVG.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | Page layout, seven tabs |
| `public/assets/terminal.css` | KRAFT styles (same palette and type as elian.ink) |
| `public/assets/assets.js` | The asset list: symbols, groups, descriptions, TradingView symbols |
| `public/assets/app.js` | All app logic |
| `netlify/functions/quotes.mts` | The market-data function, served at `/api/quotes` |
| `netlify.toml` | Publish folder and security headers |

## Changing things

- **Default assets:** edit `public/assets/assets.js`. Crypto needs its CoinGecko id (`cg`), which is the last part of the coin's URL on coingecko.com.
- **Any other ticker:** add it on the Watchlist tab. Anything Yahoo Finance knows works: `NVDA`, `SHOP.TO`, `ETH-USD`.
- **Refresh rate:** `REFRESH_MS` in `app.js` (60s), and the `s-maxage` cache header at the bottom of `quotes.mts`.
- **CoinGecko rate limits:** if crypto ever shows as failing on the Data tab, create a free CoinGecko demo key and add it in Netlify as the environment variable `COINGECKO_DEMO_KEY` (scope: Functions), then redeploy.

## Your data

Positions, alerts, journal, notes and settings live in your browser's `localStorage` under the key `crypterm_v3` (kept from CRYPTERM so old data still loads on the old address). Nothing is sent to a server. Browser storage is per address and per browser, so use **Data → Export JSON** for backups and to move between devices.

## Run it locally

```
npm install -g netlify-cli
netlify dev
```

Then open http://localhost:8888. Opening `index.html` as a file won't load prices, because they come from the function.

## Known limits

- Yahoo Finance's endpoints are unofficial and can change. Stooq covers prices if Yahoo's chart fails, but without 7D, MAs or the 52-week range.
- Analyst ratings and targets depend on Yahoo's cookie/crumb flow; if Yahoo changes it, the signal falls back to the technical inputs only.
- Alerts, ntfy and Discord pushes only fire while the page is open. TradingView's own alerts run 24/7.

For information only, not investment advice.
