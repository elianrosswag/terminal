// KRAFT Terminal — your Revolut X account (read-only).
//
//   GET /api/revx?view=status            → { configured }  (no token needed, reveals nothing else)
//   GET /api/revx?view=live              → balances, open orders, prices for what you hold
//   GET /api/revx?view=history&months=12 → filled orders (your trade log and cost basis)
//
// Every view except status needs the header  x-terminal-token: <TERMINAL_TOKEN>.
// Requests to Revolut X are signed here with your Ed25519 key, so the key never reaches a browser.
//
// Netlify environment variables (scope: Functions):
//   REVX_API_KEY      64-character key from exchange.revolut.com → Profile → API keys
//   REVX_PRIVATE_KEY  contents of private.pem (the key pair's private half)
//   TERMINAL_TOKEN    any long random string; you type it once into the site's Data tab
//
// Nothing here is cached by the CDN: responses are private to whoever holds the token.

import { createHash, createPrivateKey, sign, timingSafeEqual, type KeyObject } from "node:crypto";

const BASE = "https://revx.revolut.com";
const FIAT = new Set(["USD", "EUR", "GBP", "USDC", "USDT"]);
const NO_STORE = { "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

let keyCache: { pem: string; key: KeyObject } | null = null;
function privateKey(): KeyObject {
  // Accept the PEM pasted as-is, with literal "\n", or base64 of the whole PEM.
  let pem = (Netlify.env.get("REVX_PRIVATE_KEY") || "").trim().replace(/\\n/g, "\n");
  if (pem && !pem.includes("BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8");
  if (keyCache?.pem === pem) return keyCache.key;
  if (!pem.includes("BEGIN")) throw new Error("REVX_PRIVATE_KEY is not a PEM private key");
  // Netlify's UI can collapse newlines into spaces; rebuild the PEM body if so.
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const key = createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`);
  keyCache = { pem, key };
  return key;
}

async function revx(path: string, params: Record<string, string | number | undefined> = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const full = `/api/1.0${path}`;
  const ts = String(Date.now());
  // Signature over: timestamp + METHOD + path + query (no "?") + body — as in Revolut's own client.
  const sig = sign(null, Buffer.from(`${ts}GET${full}${query}`, "utf8"), privateKey()).toString("base64");
  const r = await fetch(`${BASE}${full}${query ? `?${query}` : ""}`, {
    headers: {
      Accept: "application/json",
      "X-Revx-API-Key": Netlify.env.get("REVX_API_KEY") || "",
      "X-Revx-Timestamp": ts,
      "X-Revx-Signature": sig,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text).message || msg; } catch { /* keep text */ }
    throw new Error(`Revolut X ${r.status} on ${path}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

const sha = (s: string) => createHash("sha256").update(s).digest();
function authorised(req: Request) {
  const want = Netlify.env.get("TERMINAL_TOKEN") || "";
  const got = req.headers.get("x-terminal-token") || "";
  return want.length >= 16 && timingSafeEqual(sha(want), sha(got));
}

async function live() {
  const [balances, active] = await Promise.all([
    revx("/balances"),
    revx("/orders/active", { limit: 100 }).catch((e) => ({ data: [], error: String(e.message) })),
  ]);
  const bal: any[] = Array.isArray(balances) ? balances : balances?.data || [];
  const held = bal.filter((b) => !FIAT.has(String(b.currency)) && Number(b.total) > 0).map((b) => `${b.currency}/USD`);
  const orderPairs = (active.data || []).map((o: any) => String(o.symbol).replace("-", "/"));
  const pairs = [...new Set([...held, ...orderPairs])];
  const tickers = pairs.length
    ? await revx("/tickers", { symbols: pairs.join(",") }).catch((e) => ({ data: [], error: String(e.message) }))
    : { data: [] };
  return {
    at: Date.now(),
    balances: bal.map((b) => ({ currency: b.currency, available: b.available, reserved: b.reserved, staked: b.staked, total: b.total })),
    orders: (active.data || []).map(slimOrder),
    tickers: (tickers.data || []).map((t: any) => ({
      symbol: t.symbol, last: t.last_price || t.mid, mid: t.mid, change24h: t.price_change_24h, high24h: t.high_24h, low24h: t.low_24h,
    })),
    warnings: [active.error, tickers.error].filter(Boolean),
  };
}

function slimOrder(o: any) {
  return {
    id: o.id, symbol: o.symbol, side: o.side, type: o.type, status: o.status,
    quantity: o.quantity, amount: o.amount, filled_quantity: o.filled_quantity, filled_amount: o.filled_amount,
    price: o.price, average_fill_price: o.average_fill_price,
    trigger: o.conditional?.trigger_price || null, take_profit: o.take_profit?.trigger_price || null, stop_loss: o.stop_loss?.trigger_price || null,
    created: o.created_date, updated: o.updated_date,
  };
}

async function history(months: number) {
  const end = Date.now(), WINDOW = 30 * 86_400_000;
  const windows: [number, number][] = [];
  for (let e = end; e > end - months * 30.5 * 86_400_000; e -= WINDOW) windows.push([Math.max(e - WINDOW + 1, 0), e]);
  const orders: any[] = [];
  const warnings: string[] = [];
  // A few windows at a time keeps well inside Revolut X's rate limits.
  for (let i = 0; i < windows.length; i += 4) {
    await Promise.all(windows.slice(i, i + 4).map(async ([s, e]) => {
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        try {
          const d = await revx("/orders/historical", {
            start_date: s, end_date: e, order_states: "filled,cancelled,partially_filled", limit: 1000, cursor,
          });
          for (const o of d.data || []) if (Number(o.filled_quantity) > 0) orders.push(slimOrder(o));
          cursor = d.metadata?.next_cursor;
          if (!cursor) break;
        } catch (err: any) { warnings.push(String(err.message)); break; }
      }
    }));
  }
  const seen = new Set<string>();
  const uniq = orders.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => Number(a.updated || a.created) - Number(b.updated || b.created));
  return { at: Date.now(), from: end - months * 30.5 * 86_400_000, orders: uniq, warnings: [...new Set(warnings)] };
}

export default async (req: Request) => {
  const view = new URL(req.url).searchParams.get("view") || "status";
  const configured = !!(Netlify.env.get("REVX_API_KEY") && Netlify.env.get("REVX_PRIVATE_KEY") && Netlify.env.get("TERMINAL_TOKEN"));
  if (view === "status") return json({ configured });
  if (!configured) return json({ error: "Revolut X isn't set up on the server yet (missing environment variables)." }, 503);
  if (!authorised(req)) return json({ error: "Wrong or missing access token." }, 401);
  try {
    if (view === "live") return json(await live());
    if (view === "history") {
      const months = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("months") || "12", 10) || 12, 1), 36);
      return json(await history(months));
    }
    return json({ error: "unknown view" }, 400);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const hint = /whitelist/i.test(msg) ? " Remove the IP whitelist from the API key: Netlify's servers don't have fixed IPs."
      : /401|unauthor/i.test(msg) ? " Check REVX_API_KEY and that the public key on Revolut X matches REVX_PRIVATE_KEY." : "";
    return json({ error: msg + hint }, 502);
  }
};

export const config = { path: "/api/revx", method: "GET" };
