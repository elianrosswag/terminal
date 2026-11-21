# KRAFT Terminal · terminal.elian.ink

A tracker for crypto, crypto equities and AI stocks, with a portfolio, watchlist, charts with saved Fibonacci drawings, price alerts, a thesis journal, and your Revolut X account (holdings, cost basis, fills and open orders). It replaces the old CRYPTERM build.

```
 browser (public/)                     Netlify functions (netlify/functions/)
 ┌────────────────────────────┐        ┌─────────────────────────────────────────────────────────┐
 │ index.html + assets/       │─quotes─► quotes.mts   CNBC quotes · CoinGecko · Revolut X tickers│
 │ chart.js (Lightweight      │─candles► candles.mts  CNBC/Nasdaq bars · Revolut X/Hyperliquid  │
 │   Charts + fib tool)       │─revx──►  revx.mts     your Revolut X account, signed, token-gated│
 │ data in localStorage       │        │ public data cached 60s on Netlify's CDN; revx never     │
 └────────────────────────────┘        └─────────────────────────────────────────────────────────┘
```

Running cost: £0 on Netlify's free plan. API keys: none.

## Why it broke before, and what changed

CRYPTERM fetched Yahoo Finance from the browser. Yahoo refuses browser requests from other sites (CORS), so the page tried a `/api/yf/` proxy that was never deployed, then three free public CORS proxies. Those are rate-limited or blocked, so stock prices rarely loaded; only the two CoinGecko coins did.

Now the browser only calls its own domain. Sources were chosen by testing from Netlify's servers (Nov 2026): Yahoo Finance answers 429 and Stooq/Cboe 403 there, while CNBC, Nasdaq, CoinGecko, Revolut X and Hyperliquid answer. The **Data** tab shows which sources are healthy and which tickers returned nothing, and why.

Other fixes:
- Prices are fetched for every symbol you use (portfolio, journal, alerts, charts), not just the watchlist.
- Market cap, 52-week range and pre/post-market prices now load.
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
| `public/assets/chart.js` | Candle chart, Fibonacci/level drawings, Revolut X overlays |
| `public/assets/vendor/` | TradingView Lightweight Charts 5.3 (Apache-2.0) |
| `netlify/functions/quotes.mts` | Prices, served at `/api/quotes` |
| `netlify/functions/candles.mts` | OHLC candles, served at `/api/candles` |
| `netlify/functions/revx.mts` | Your Revolut X account, served at `/api/revx` (token-protected) |
| `netlify.toml` | Publish folder and security headers |

## Changing things

- **Default assets:** edit `public/assets/assets.js`. Crypto needs its CoinGecko id (`cg`), which is the last part of the coin's URL on coingecko.com.
- **Any other ticker:** add it on the Watchlist tab: any US-listed stock or ETF (`NVDA`), or a Revolut X coin as a pair (`SOL-USD`).
- **Refresh rate:** `REFRESH_MS` in `app.js` (60s), and the `s-maxage` cache header at the bottom of `quotes.mts`.
- **CoinGecko rate limits:** if crypto ever shows as failing on the Data tab, create a free CoinGecko demo key and add it in Netlify as the environment variable `COINGECKO_DEMO_KEY` (scope: Functions), then redeploy.

## Revolut X

Read-only. Your balances, open orders and the last 12 months of filled orders are fetched by `revx.mts`, which signs each request with your Ed25519 key (timestamp + method + path + query, as in Revolut's own client). Set these in Netlify → Project configuration → Environment variables, scope **Functions**, then redeploy:

| Variable | Value |
|---|---|
| `REVX_API_KEY` | the 64-character key from exchange.revolut.com → Profile → API keys (Spot view only) |
| `REVX_PRIVATE_KEY` | the whole contents of `private.pem` |
| `TERMINAL_TOKEN` | a long random string; paste the same value into the site's Data tab once |

The key pair lives in `kraft-site/_private-revolut-x/` on your Mac, outside every repo. Nothing from `/api/revx` is cached; without the token it answers 401. Average cost is computed from filled USD orders in the loaded history; if you held coins from before that, the cost shows with an asterisk.

## Your data

Positions, alerts, journal, notes, chart drawings and settings live in your browser's `localStorage` under the key `crypterm_v3` (kept from CRYPTERM so old data still loads on the old address). Nothing is sent to a server. Browser storage is per address and per browser, so use **Data → Export JSON** for backups and to move between devices.

## Run it locally

```
npm install -g netlify-cli
netlify dev
```

Then open http://localhost:8888. Opening `index.html` as a file won't load prices, because they come from the function.

## Known limits

- CNBC's and Nasdaq's endpoints are unofficial and can change; if CNBC misses a ticker the latest daily candle stands in.
- Stock intraday candles include pre/post-market bars. CNBC has no 15-minute bars, so 15m is built from 5-minute bars.
- Alerts, ntfy and Discord pushes only fire while the page is open. TradingView's own alerts run 24/7.

For information only, not investment advice.
