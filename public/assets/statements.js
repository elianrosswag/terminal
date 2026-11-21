// KRAFT Terminal — Revolut app statement import (stocks and crypto CSVs).
// Revolut has no API for app investments, so this reads the CSV statements the app exports.
// Columns are matched by name, so small layout changes between app versions don't break it.
(() => {
'use strict';

// ── CSV ───────────────────────────────────────────────────────────────────
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

// ── values ────────────────────────────────────────────────────────────────
const SYMBOL_CCY = { '$': 'USD', '£': 'GBP', '€': 'EUR', 'US$': 'USD' };
// "USD 1,234.56", "$1,234.56", "-£12.30", "1.234,56 €", "1234.56" → { v, ccy }
function money(s, fallbackCcy = null) {
  s = String(s ?? '').trim();
  if (!s) return { v: null, ccy: fallbackCcy };
  let ccy = fallbackCcy;
  const code = s.match(/\b(USD|GBP|EUR|CHF|PLN|CZK|SEK|NOK|DKK|AUD|CAD|USDC|USDT)\b/i);
  if (code) ccy = code[1].toUpperCase();
  for (const [sym, c] of Object.entries(SYMBOL_CCY)) if (s.includes(sym)) ccy = c;
  let n = s.replace(/[^0-9,.\-]/g, '');
  // decide the decimal separator: the last of , or . with 1–2 or many digits after it
  const lc = n.lastIndexOf(','), ld = n.lastIndexOf('.');
  if (lc > ld) n = (n.length - lc - 1 <= 2 || ld !== -1) ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  else n = n.replace(/,/g, '');
  const v = parseFloat(n);
  return { v: Number.isFinite(v) ? v : null, ccy };
}
const num = s => money(s).v;
function date(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  // 21/11/2026 14:33(:12) or 21.11.2026 → day first (UK/EU app locales)
  let m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const t = Date.parse(s.replace(/,(\s*\d{1,2}:\d{2})/, '$1'));
  return Number.isFinite(t) ? t : null;
}

// ── column matching ───────────────────────────────────────────────────────
const COLS = {
  date: ['date', 'trade date', 'completed date', 'date (utc)', 'time', 'started date', 'transaction date'],
  symbol: ['ticker', 'symbol', 'asset', 'symbol / description', 'instrument', 'currency pair'],
  type: ['type', 'activity type', 'transaction type', 'side', 'action'],
  qty: ['quantity', 'qty', 'shares', 'amount (units)', 'units', 'number of shares'],
  price: ['price per share', 'price', 'unit price', 'price per unit', 'price (per unit)', 'execution price'],
  total: ['total amount', 'value', 'total', 'amount', 'total value'],
  ccy: ['currency', 'price currency', 'value currency'],
  fee: ['fees', 'fee', 'commission'],
  fx: ['fx rate'],
};
function findCols(header) {
  const h = header.map(x => x.trim().toLowerCase());
  const out = {};
  for (const [k, names] of Object.entries(COLS)) {
    for (const n of names) { const i = h.indexOf(n); if (i !== -1) { out[k] = i; break; } }
  }
  return out;
}

// What a row's type means for the position.
function classify(type, kind) {
  const t = String(type || '').trim().toUpperCase();
  if (!t) return null;
  if (/STOCK SPLIT|SPLIT/.test(t)) return 'split';
  if (/DIVIDEND/.test(t) && !/TAX/.test(t)) return 'dividend';
  if (/^BUY|\bBUY\b|PURCHASE|BOUGHT/.test(t)) return 'buy';
  if (/^SELL|\bSELL\b|SOLD/.test(t)) return 'sell';
  if (kind === 'crypto' || /CRYPTO/.test(t)) {
    if (/REWARD|LEARN|AIRDROP|CASHBACK|BONUS|STAKING REWARD|RECEIVE|DEPOSIT|TRANSFER IN/.test(t)) return 'in';
    if (/SEND|WITHDRAW|TRANSFER OUT/.test(t)) return 'out';
  }
  if (/TRANSFER IN|SHARES IN|STOCK TRANSFER IN/.test(t)) return 'in';
  if (/TRANSFER OUT|SHARES OUT|STOCK TRANSFER OUT/.test(t)) return 'out';
  return null; // cash top-ups, withdrawals, fees, staking/unstaking moves etc.
}

// ── parse a statement ─────────────────────────────────────────────────────
function parse(text, filename = '') {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no rows');
  // the header is the first row that has a type column and a symbol/ticker column
  let hi = rows.findIndex(r => { const c = findCols(r); return c.type != null && c.symbol != null && (c.qty != null || c.total != null); });
  if (hi === -1) throw new Error("Couldn't find the column headings (expected e.g. Date, Ticker/Symbol, Type, Quantity, Price)");
  const header = rows[hi].map(x => x.trim());
  const c = findCols(header);
  const lower = header.map(x => x.toLowerCase());
  const body = rows.slice(hi + 1);
  const types = new Set(body.map(r => String(r[c.type] || '').toUpperCase()));
  let kind = lower.includes('ticker') || lower.includes('price per share') || [...types].some(t => /MARKET|LIMIT|DIVIDEND|CUSTODY|STOCK SPLIT/.test(t))
    ? 'stock' : /crypto/i.test(filename) || [...types].some(t => /REWARD|LEARN|STAK|SEND|RECEIVE/.test(t)) ? 'crypto' : 'crypto';
  if (/stock|trading|invest/i.test(filename) && !/crypto/i.test(filename)) kind = 'stock';

  const trades = [], ignored = {}, warnings = [];
  body.forEach((r, i) => {
    const typeRaw = String(r[c.type] || '').trim();
    const side = classify(typeRaw, kind);
    if (!side) { const k = typeRaw || '(blank)'; ignored[k] = (ignored[k] || 0) + 1; return; }
    let symbol = String(r[c.symbol] || '').trim().toUpperCase().replace(/\s+.*$/, '');
    if (symbol.includes('/') || symbol.includes('-')) symbol = symbol.split(/[\/-]/)[0];
    const t = date(r[c.date]);
    const qty = Math.abs(num(r[c.qty]) ?? NaN);
    const fallbackCcy = c.ccy != null ? String(r[c.ccy] || '').trim().toUpperCase() || null : null;
    const pr = c.price != null ? money(r[c.price], fallbackCcy) : { v: null, ccy: fallbackCcy };
    const tot = c.total != null ? money(r[c.total], fallbackCcy) : { v: null, ccy: fallbackCcy };
    const fee = c.fee != null ? money(r[c.fee], pr.ccy || tot.ccy) : { v: 0 };
    let price = pr.v != null ? Math.abs(pr.v) : null;
    const qtySigned = num(r[c.qty]);
    if (side === 'dividend') {
      trades.push({ id: `${kind}-${i}`, t, symbol, side, qty: 0, price: 0, amount: Math.abs(tot.v ?? 0), ccy: tot.ccy || pr.ccy || 'USD', fee: 0, raw: typeRaw });
      return;
    }
    if (!symbol || !t || !Number.isFinite(qty) || (qty === 0 && side !== 'split')) {
      warnings.push(`Row ${hi + i + 2}: skipped (${typeRaw}${symbol ? ' ' + symbol : ''}) — missing date, symbol or quantity`);
      return;
    }
    if ((side === 'buy' || side === 'sell') && price == null && tot.v != null && qty) price = Math.abs(tot.v) / qty;
    if ((side === 'buy' || side === 'sell') && price == null) {
      warnings.push(`Row ${hi + i + 2}: ${typeRaw} ${symbol} has no price; counted with unknown cost`);
    }
    trades.push({
      id: `${kind}-${t}-${symbol}-${i}`, t, symbol, side, raw: typeRaw,
      qty: side === 'split' ? (qtySigned ?? 0) : qty, price, ccy: pr.ccy || tot.ccy || 'USD', fee: Math.abs(fee.v || 0),
    });
  });
  trades.sort((a, b) => a.t - b.t);
  if (!trades.length) throw new Error('No buys or sells found. Is this the investment statement (not the account/cash statement)?');
  const ccys = [...new Set(trades.map(t => t.ccy))];
  return { kind, header, trades, ignored, warnings, ccys, rows: body.length };
}

// ── positions from trades ─────────────────────────────────────────────────
// fx: { GBP: 1.27, EUR: 1.08 } = USD per unit. Costs are converted to USD at those (today's) rates.
function positions(trades, fx = {}) {
  const book = new Map();
  const usd = (v, ccy) => (v == null ? null : ccy === 'USD' || ccy === 'USDC' || ccy === 'USDT' ? v : fx[ccy] ? v * fx[ccy] : null);
  for (const tr of trades) {
    const p = book.get(tr.symbol) || { symbol: tr.symbol, qty: 0, cost: 0, unknown: 0, unconverted: 0, free: 0, realised: 0, dividends: 0, ccys: new Set(), noFx: false, trades: 0, first: tr.t };
    book.set(tr.symbol, p);
    p.trades++; p.ccys.add(tr.ccy);
    const px = usd(tr.price, tr.ccy), fee = usd(tr.fee, tr.ccy) || 0;
    if (tr.price != null && px == null) p.noFx = true;
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    switch (tr.side) {
      case 'buy':
        p.qty += tr.qty;
        if (px != null) p.cost += tr.qty * px + fee;
        else if (tr.price != null) p.unconverted += tr.qty;
        else p.unknown += tr.qty;
        break;
      case 'sell': {
        const q = Math.min(tr.qty, p.qty);
        if (px != null) p.realised += q * px - fee - q * avg;
        p.cost -= q * avg; p.qty -= q;
        if (p.qty <= 1e-12) { p.qty = 0; p.cost = 0; p.unknown = 0; p.unconverted = 0; p.free = 0; }
        break;
      }
      case 'split': p.qty += tr.qty; break;
      case 'in': p.qty += tr.qty; p.free += tr.qty; break;
      case 'out': { const q = Math.min(tr.qty, p.qty); p.cost -= q * avg; p.qty -= q; break; }
      case 'dividend': p.dividends += usd(tr.amount, tr.ccy) || 0; break;
    }
  }
  return [...book.values()].filter(p => p.qty > 1e-9).map(p => {
    const known = p.qty - p.unknown - p.unconverted;
    const avgCost = known > 0 && p.cost > 0 && !p.unconverted ? p.cost / p.qty : null;
    const notes = [];
    if (p.free) notes.push(`${+p.free.toPrecision(6)} received free (rewards/transfers) at zero cost`);
    if (p.unknown) notes.push(`${+p.unknown.toPrecision(6)} bought with no price in the file`);
    const nonUsd = [...p.ccys].filter(c => !['USD', 'USDC', 'USDT'].includes(c));
    if (nonUsd.length) notes.push(p.noFx ? `${nonUsd.join('/')} prices couldn't be converted yet` : `${nonUsd.join('/')} prices converted to USD at today's rate`);
    return { symbol: p.symbol, qty: p.qty, avgCost, realised: p.realised, dividends: p.dividends, notes, partial: !!(p.unknown || p.noFx), trades: p.trades };
  });
}

window.KraftStatements = { parseCSV, parse, positions, money, date };
})();
