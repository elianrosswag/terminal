// KRAFT Terminal — app.
// All market data comes from our own /api/quotes function (netlify/functions/quotes.mts).
// Everything the user enters is kept in localStorage under STORE_KEY.
(() => {
'use strict';

// Kept identical to the old CRYPTERM key so data entered on the old address loads here too.
const STORE_KEY = 'crypterm_v3';
const CACHE_KEY = 'kraft_terminal_quotes';
const REFRESH_MS = 60_000;
const ASSETS = window.KRAFT_ASSETS;
const GROUPS = window.KRAFT_GROUPS;
const DEFAULT_WATCHLIST = ASSETS.map(a => a.sym);
const DEFAULT_CHARTS = ['BTC', 'COIN', 'MSTR', 'NVDA'];

// ── utilities ─────────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MINUS = '−';

const fmt = {
  price(v) {
    if (!isNum(v)) return '—';
    const d = v >= 1000 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  usd(v, d = 2) {
    if (!isNum(v)) return '—';
    const s = v < 0 ? MINUS : '';
    return s + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  big(v) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? MINUS : '';
    if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    return fmt.usd(v, 0);
  },
  vol(v) {
    if (!isNum(v) || !v) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  },
  pct(v, d = 2) {
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) + '%';
  },
  cls: v => (!isNum(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down'),
  date: iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  time: t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },
};
const pctSpan = (v, d) => `<span class="${fmt.cls(v)}">${fmt.pct(v, d)}</span>`;

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── state ─────────────────────────────────────────────────────────────────
const State = {
  data: null,
  defaults: () => ({
    portfolio: [], watchlist: [...DEFAULT_WATCHLIST], alerts: [], journal: [],
    chartSymbols: [...DEFAULT_CHARTS], watchlistNotes: {}, custom: {},
    alertIntegrations: { ntfy: '', discord: '' }, drawings: {},
    theme: { active: 'KRAFT', colors: null, presets: {} }, revolut: {},
  }),
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { d = null; }
    this.data = { ...this.defaults(), ...(d && typeof d === 'object' ? d : {}) };
    for (const k of ['portfolio', 'watchlist', 'alerts', 'journal', 'chartSymbols']) if (!Array.isArray(this.data[k])) this.data[k] = this.defaults()[k];
    for (const k of ['watchlistNotes', 'custom', 'alertIntegrations', 'drawings', 'theme', 'revolut']) if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = this.defaults()[k];
    if (!this.data.chartSymbols.length) this.data.chartSymbols = [...DEFAULT_CHARTS];
    if (!this.data.theme.presets || typeof this.data.theme.presets !== 'object') this.data.theme.presets = {};
    // SMLR was delisted after Strive (ASST) acquired Semler Scientific in January 2026.
    // BITF became KEEL when Bitfarms renamed itself Keel Infrastructure in April 2026.
    const RENAMED = { SMLR: 'ASST', BITF: 'KEEL' };
    for (const k of ['watchlist', 'chartSymbols']) this.data[k] = [...new Set(this.data[k].map(x => RENAMED[x] || x))];
    // Old builds stored ids as numbers / alerts without ids.
    this.data.alerts.forEach(a => { if (!a.id) a.id = uid(); });
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); }
    catch { toast('Could not save: browser storage is full or blocked', true); }
  },
};

// ── assets ────────────────────────────────────────────────────────────────
function asset(sym) {
  const known = ASSETS.find(a => a.sym === sym);
  if (known) return known;
  const c = State.data.custom[sym] || {};
  if (c.kind === 'crypto') return {
    sym, type: 'crypto', pair: c.pair || `${sym}-USD`, grp: 'Crypto', cat: 'Crypto · Revolut X', name: c.name || sym,
    tv: `COINBASE:${sym}USD`, desc: `${c.name || sym}, priced from Revolut X.`,
  };
  return {
    sym, type: 'stock', grp: 'Custom', cat: c.exchange || 'Custom', name: c.name || sym,
    tv: c.tv || (sym.includes('-USD') ? `COINBASE:${sym.replace('-', '')}` : `NASDAQ:${sym}`),
    desc: c.name ? `${c.name}. Added by you.` : 'Added by you.',
  };
}
function trackedSymbols() {
  const d = State.data;
  return [...new Set([
    ...d.watchlist, ...d.portfolio.map(p => p.symbol), ...d.alerts.map(a => a.symbol),
    ...d.chartSymbols, ...d.journal.flatMap(e => (e.assets || []).map(a => a.symbol)),
    ...rxHeldCodes(), ...rvPositions().map(p => p.symbol),
  ].filter(Boolean))];
}

// ── market data ───────────────────────────────────────────────────────────
let Q = {};          // symbol → quote
let PrevQ = {};      // previous refresh, for flash
let LastResp = null; // last /api/quotes body (for the Data tab)
let FetchErr = null;
let loading = false;

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.quotes) { Q = c.quotes; LastResp = c.resp || null; return c.at; }
  } catch { /* ignore */ }
  return null;
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), quotes: Q, resp: LastResp && { ...LastResp, quotes: undefined } })); } catch { /* ignore */ }
}

async function fetchQuotes() {
  if (loading) return;
  loading = true;
  setStatus('busy', 'Updating');
  const syms = trackedSymbols();
  const stocks = syms.filter(s => asset(s).type === 'stock').sort();
  const crypto = syms.map(s => asset(s)).filter(a => a.type === 'crypto' && a.cg).map(a => a.cg).sort();
  const rx = syms.map(s => asset(s)).filter(a => a.type === 'crypto' && !a.cg && a.pair).map(a => a.pair).sort();

  const chunks = [];
  for (let i = 0; i < Math.max(stocks.length, 1); i += 60) chunks.push(stocks.slice(i, i + 60));
  try {
    const bodies = await Promise.all(chunks.map((st, i) => {
      const qs = new URLSearchParams();
      if (st.length) qs.set('stocks', st.join(','));
      if (i === 0 && crypto.length) qs.set('crypto', crypto.join(','));
      if (i === 0 && rx.length) qs.set('rx', rx.join(','));
      if (i === 0 && rvNeedsFx()) qs.set('fx', '1');
      return fetch('/api/quotes?' + qs, { signal: AbortSignal.timeout(25_000) }).then(async r => {
        const b = await r.json().catch(() => null);
        if (!b) throw new Error(`HTTP ${r.status}`);
        return b;
      });
    }));
    PrevQ = { ...Q };
    const merged = { updatedAt: Date.now(), quotes: {}, errors: {}, sources: {} };
    for (const b of bodies) {
      Object.assign(merged.quotes, b.quotes); Object.assign(merged.errors, b.errors);
      for (const [k, v] of Object.entries(b.sources || {})) {
        const m = merged.sources[k] ||= { ok: 0, fail: 0 };
        m.ok += v.ok; m.fail += v.fail; if (v.note) m.note = v.note;
      }
    }
    for (const [key, q] of Object.entries(merged.quotes)) {
      let sym = key;
      if (key.startsWith('cg:')) { const a = ASSETS.find(x => x.cg === key.slice(3)); if (!a) continue; sym = a.sym; }
      else if (key.startsWith('rx:')) { const pair = key.slice(3); sym = syms.find(x => asset(x).pair === pair); if (!sym) continue; }
      Q[sym] = { ...q, symbol: sym, fetchedAt: Date.now() };
      // Remember names / exchanges for tickers the user added.
      if (!ASSETS.find(a => a.sym === sym) && q.type === 'stock') {
        const c = State.data.custom[sym] ||= {};
        if (q.name) c.name = q.name;
        if (q.tv) c.tv = q.tv;
        if (q.exchange) c.exchange = q.exchange;
      }
    }
    for (const b of bodies) if (b.fx && Object.keys(b.fx).length) { FX = b.fx; try { localStorage.setItem('kraft_terminal_fx', JSON.stringify(FX)); } catch { /* ignore */ } }
    LastResp = merged;
    FetchErr = null;
    State.save();
    saveCache();
  } catch (e) {
    FetchErr = e.message || String(e);
  } finally {
    loading = false;
  }
  updateStatus();
  render();
  checkAlerts();
  if (tab === 'charts') chartTick();
}

function updateStatus() {
  const syms = trackedSymbols();
  const have = syms.filter(s => isNum(Q[s]?.price)).length;
  $('#st-cover').textContent = `${have}/${syms.length} priced`;
  if (FetchErr) {
    setStatus('warn', 'Offline · showing last data');
    showBanner(location.protocol === 'file:'
      ? 'Open this through the website (or `netlify dev`), not as a file: prices come from the site’s /api/quotes function.'
      : `Couldn’t reach the data service (${FetchErr}). Showing the last prices saved in this browser.`);
  } else {
    const missing = syms.length - have;
    setStatus(missing ? 'warn' : 'on', missing ? `Live · ${missing} without data` : 'Live');
    showBanner(null);
  }
  if (LastResp) $('#st-updated').textContent = 'Updated ' + fmt.time(LastResp.updatedAt);
}
function setStatus(kind, label) {
  $('#st-dot').className = 'dot ' + kind;
  $('#st-label').textContent = label;
  $('#refresh-btn').disabled = kind === 'busy';
}
function showBanner(text) {
  $('#banner').hidden = !text;
  if (text) $('#banner-text').textContent = text;
}

// ── signal (mechanical, documented in the metrics guide) ────────────────────
function signal(d) {
  if (!d || !isNum(d.price)) return { label: 'N/A', cls: '' };
  let sc = 0, mx = 0;
  if (isNum(d.analystRating)) { mx += 2; if (d.analystRating <= 2.0) sc += 2; else if (d.analystRating <= 2.8) sc += 1; }
  if (isNum(d.ma50)) { mx++; if (d.price > d.ma50) sc++; }
  if (isNum(d.ma200)) { mx++; if (d.price > d.ma200) sc++; }
  if (isNum(d.target) && d.price > 0) { mx += 2; const up = (d.target - d.price) / d.price; if (up > 0.2) sc += 2; else if (up > 0.05) sc += 1; }
  if (isNum(d.w52Low) && isNum(d.w52High)) { mx++; const r = d.w52High - d.w52Low; if (r > 0 && (d.price - d.w52Low) / r < 0.35) sc++; }
  if (mx < 2) return { label: 'N/A', cls: '' };
  const r = sc / mx;
  if (r >= 0.6) return { label: 'Buy', cls: 'buy' };
  if (r <= 0.3) return { label: 'Sell', cls: 'sell' };
  return { label: 'Hold', cls: 'hold' };
}
const flash = sym => {
  const p = PrevQ[sym]?.price, c = Q[sym]?.price;
  return !isNum(p) || !isNum(c) || p === c ? '' : c > p ? 'flash-up' : 'flash-down';
};

function sparkSVG(pts, w = 240, h = 48) {
  const v = (pts || []).filter(isNum);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const d = v.map((p, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (p - lo) / span * (h - 4)).toFixed(1)}`).join(' ');
  const col = v.at(-1) >= v[0] ? 'var(--green)' : 'var(--steel-300)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${d}" fill="none" stroke="${col}" stroke-width="1.25" vector-effect="non-scaling-stroke"/></svg>`;
}

// ── tabs ──────────────────────────────────────────────────────────────────
let tab = 'overview';
function setTab(t, push = true) {
  if (!$('#view-' + t)) t = 'overview';
  tab = t;
  $$('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + t; });
  if (push && location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
  render();
  window.scrollTo({ top: 0 });
}
function render() {
  ({ overview: renderOverview, portfolio: renderPortfolio, watchlist: renderWatchlist, charts: renderCharts,
     alerts: renderAlerts, journal: renderJournal, data: renderData })[tab]?.();
  renderAlertCount();
}

// ── overview ──────────────────────────────────────────────────────────────
let hmPeriod = '24h';
function allPositions() { return [...State.data.portfolio, ...rxPositions(), ...rvPositions()]; }
function portfolioTotals() {
  let value = 0, cost = 0, day = 0, priced = 0;
  for (const p of allPositions()) {
    if (!isNum(p.avgCost)) { const d = Q[p.symbol]; if (isNum(d?.price)) { value += p.shares * d.price; priced++; if (isNum(d.change)) day += p.shares * d.change; } continue; }
    const d = Q[p.symbol];
    cost += p.shares * p.avgCost;
    if (isNum(d?.price)) { value += p.shares * d.price; priced++; if (isNum(d.change)) day += p.shares * d.change; }
  }
  const cash = rxCash();
  return { value: value + cash, invested: value, cash, cost, day, priced };
}
function tileHTML(label, value, sub = '', valCls = '') {
  return `<div class="tile"><div class="tile-top"><span class="mono">${label}</span></div><div class="big ${valCls}">${value}</div><div class="chips">${sub}</div></div>`;
}
function renderOverview() {
  const wl = State.data.watchlist;
  const pd = wl.map(s => Q[s]).filter(d => isNum(d?.price));
  const ch = pd.filter(d => isNum(d.changePct));
  const avg = ch.length ? ch.reduce((a, b) => a + b.changePct, 0) / ch.length : null;
  const ups = ch.filter(d => d.changePct > 0).length, downs = ch.filter(d => d.changePct < 0).length;
  const mcap = pd.reduce((a, b) => a + (b.marketCap || 0), 0);
  const pt = portfolioTotals();
  const btc = Q.BTC;
  $('#ov-stats').innerHTML = [
    tileHTML('Portfolio', pt.value ? fmt.usd(pt.value, 0) : '—',
      State.data.portfolio.length ? `<span>Day ${pctSpan(pt.value - pt.day ? pt.day / (pt.value - pt.day) * 100 : null)}</span><span class="${fmt.cls(pt.day)}">${fmt.usd(pt.day, 0)}</span>` : '<span>No positions yet</span>'),
    tileHTML('Watchlist 24h', avg == null ? '—' : fmt.pct(avg), `<span class="up">${ups} up</span><span>${downs} down</span>`, fmt.cls(avg)),
    tileHTML('Bitcoin', btc ? fmt.price(btc.price) : '—', btc ? `<span>24h ${pctSpan(btc.changePct)}</span><span>7D ${pctSpan(btc.changePct7d)}</span>` : ''),
    rxConnected() ? rxTile() : tileHTML('Market cap', mcap ? fmt.big(mcap) : '—', `<span>${pd.length} of ${wl.length} priced</span>`),
  ].join('');

  const movers = (field, title) => {
    const w = pd.filter(d => isNum(d[field]));
    const g = w.filter(d => d[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, 5);
    const l = w.filter(d => d[field] < 0).sort((a, b) => a[field] - b[field]).slice(0, 5);
    const rows = list => list.map(d => `<div class="mover" data-action="chart" data-sym="${esc(d.symbol)}" role="button" tabindex="0">
        <div><div class="sym">${esc(d.symbol)}</div><div class="nm">${esc(asset(d.symbol).name)}</div></div>
        <div class="r"><b>${fmt.price(d.price)}</b><span class="${fmt.cls(d[field])}">${fmt.pct(d[field])}</span></div></div>`).join('');
    const none = msg => `<div class="empty">${msg}</div>`;
    return `<div class="panel"><div class="panel-h">Gainers <span class="mono">${title}</span></div>${g.length ? rows(g) : none(w.length ? 'Nothing up' : 'Waiting for data')}</div>
            <div class="panel"><div class="panel-h">Losers <span class="mono">${title}</span></div>${l.length ? rows(l) : none(w.length ? 'Nothing down' : 'Waiting for data')}</div>`;
  };
  $('#ov-movers-24h').innerHTML = movers('changePct', '24h');
  $('#ov-movers-7d').innerHTML = movers('changePct7d', '7D');
  renderHeatmap();
}
function heatStyle(p) {
  if (!isNum(p)) return { bg: 'var(--black)', ink: false };
  const i = Math.min(Math.abs(p), 10) / 10;
  if (p > 0) { const a = 0.1 + i * 0.75; return { bg: KraftTheme.rgba('up', a.toFixed(3)), ink: a > 0.5 }; }
  return { bg: KraftTheme.rgba('down', (0.06 + i * 0.4).toFixed(3)), ink: false };
}
function renderHeatmap() {
  const wl = State.data.watchlist;
  const byGrp = {};
  wl.forEach(s => (byGrp[asset(s).grp] ||= []).push(s));
  const order = [...GROUPS, ...Object.keys(byGrp).filter(g => !GROUPS.includes(g))];
  $('#heatmap').innerHTML = order.filter(g => byGrp[g]).map(g => `<div class="heat-group"><span class="mono">${esc(g)}</span><div class="heat">${
    byGrp[g].map(sym => {
      const d = Q[sym], p = hmPeriod === '7d' ? d?.changePct7d : d?.changePct, st = heatStyle(p);
      return `<button type="button" class="cell${st.ink ? ' ink' : ''}" style="background:${st.bg}" data-action="chart" data-sym="${esc(sym)}" data-tip="${esc(sym)}">
        <span class="s">${esc(sym)}</span><span class="p">${fmt.pct(p)}</span></button>`;
    }).join('')}</div></div>`).join('') || '<div class="empty">Your watchlist is empty. Add tickers on the Watchlist tab.</div>';
}

// ── portfolio ─────────────────────────────────────────────────────────────
function renderPortfolio() {
  const port = allPositions();
  const pt = portfolioTotals();
  const costed = port.filter(p => isNum(Q[p.symbol]?.price) && isNum(p.avgCost));
  const pricedCost = costed.reduce((a, p) => a + p.shares * p.avgCost, 0);
  const pnl = costed.length ? costed.reduce((a, p) => a + p.shares * Q[p.symbol].price, 0) - pricedCost : null;
  const ret = pnl != null && pricedCost ? pnl / pricedCost * 100 : null;
  const dayPct = pt.value - pt.day ? pt.day / (pt.value - pt.day) * 100 : null;
  const t = (l, v, c = '') => `<div class="tile"><span class="mono">${l}</span><div class="mid ${c}">${v}</div></div>`;
  $('#pf-stats').innerHTML = [
    t('Value', pt.value ? fmt.usd(pt.value) : '—'), t('Cost basis', fmt.usd(pt.cost)),
    t('Total P&amp;L', pnl == null ? '—' : fmt.usd(pnl), fmt.cls(pnl)), t('Return', fmt.pct(ret), fmt.cls(ret)),
    t('Day P&amp;L', port.length ? fmt.usd(pt.day) : '—', fmt.cls(pt.day)), t('Day', fmt.pct(dayPct), fmt.cls(dayPct)),
  ].join('');

  if (!port.length && !pt.cash) {
    $('#pf-table').innerHTML = '<div class="empty">No positions yet. Add one here, from any watchlist card, or connect Revolut X on the Data tab.</div>';
    $('#pf-alloc').innerHTML = '';
    return;
  }
  const rows = port.map(p => {
    const d = Q[p.symbol], price = d?.price;
    const val = isNum(price) ? p.shares * price : null, cost = isNum(p.avgCost) ? p.shares * p.avgCost : null;
    const pl = val != null && cost != null ? val - cost : null;
    return { p, d, price, val, cost, pl, plPct: pl != null && cost ? pl / cost * 100 : null, day: isNum(d?.change) ? p.shares * d.change : null };
  }).sort((a, b) => (b.val ?? -1) - (a.val ?? -1));
  $('#pf-table').innerHTML = `<table class="data"><thead><tr>
      <th>Asset</th><th>Units</th><th>Avg cost</th><th>Price</th><th>24h</th><th>Value</th><th>P&amp;L</th><th>Return</th><th>Day P&amp;L</th><th>Weight</th><th></th>
    </tr></thead><tbody>${rows.map(r => {
      const w = pt.value && r.val ? r.val / pt.value * 100 : null;
      return `<tr>
        <td><div class="sym">${esc(r.p.symbol)}${r.p.rx ? ' <span class="pill tiny">Revolut X</span>' : r.p.rv ? ' <span class="pill tiny">Revolut</span>' : ''}</div><div class="nm">${esc(r.p.notes || asset(r.p.symbol).name)}</div></td>
        <td>${r.p.shares.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
        <td title="${r.p.rx || r.p.rv ? esc(r.p.costNote || '') : ''}">${fmt.price(r.p.avgCost)}${r.p.partial ? '<span class="na">*</span>' : ''}</td>
        <td class="${flash(r.p.symbol)}">${fmt.price(r.price)}</td>
        <td>${pctSpan(r.d?.changePct)}</td>
        <td>${fmt.usd(r.val)}</td>
        <td class="${fmt.cls(r.pl)}">${fmt.usd(r.pl)}</td>
        <td>${pctSpan(r.plPct)}</td>
        <td class="${fmt.cls(r.day)}">${fmt.usd(r.day)}</td>
        <td>${w == null ? '—' : w.toFixed(1) + '%'}<span class="share"><i style="width:${w || 0}%"></i></span></td>
        <td>${r.p.rx || r.p.rv ? `<span class="na mono" style="font-size:10px">${r.p.rx ? 'Synced' : 'Imported'}</span>` : `<button class="btn ghost small" type="button" data-action="edit-position" data-id="${esc(r.p.id)}">Edit</button>`}</td>
      </tr>`;
    }).join('')}${pt.cash ? `<tr class="total"><td><div class="sym">Cash</div><div class="nm">Revolut X ${esc(rxCashLabel())}</div></td><td></td><td></td><td></td><td></td><td>${fmt.usd(pt.cash)}</td><td></td><td></td><td></td><td>${(pt.cash / pt.value * 100).toFixed(1)}%<span class="share"><i style="width:${pt.cash / pt.value * 100}%"></i></span></td><td></td></tr>` : ''}</tbody></table>
    ${port.some(p => p.partial) ? '<p class="mono" style="font-size:10.5px;margin-top:10px">* Average cost is incomplete: some units came from before the loaded history, without a price, or in a currency not yet converted. Hover the cost for details.</p>' : ''}`;

  const parts = rows.filter(r => r.val > 0);
  if (pt.cash) parts.push({ p: { symbol: 'CASH' }, val: pt.cash });
  const shades = ['var(--green)', 'var(--steel-100)', 'var(--steel-300)', 'var(--steel-500)', 'var(--steel-700)'];
  $('#pf-alloc').innerHTML = parts.length ? `
    <div class="alloc" role="img" aria-label="Allocation bar">${parts.map((r, i) => `<i style="width:${r.val / pt.value * 100}%;background:${shades[Math.min(i, shades.length - 1)]}" title="${esc(r.p.symbol)}"></i>`).join('')}</div>
    <ul class="alloc-list">${parts.map(r => { const w = r.val / pt.value * 100; return `<li><span class="sym">${esc(r.p.symbol)}</span><span class="bar"><i style="width:${w}%"></i></span><span class="v">${fmt.usd(r.val, 0)} · ${w.toFixed(1)}%</span></li>`; }).join('')}</ul>`
    : '<div class="empty">Waiting for prices</div>';
}

function positionModal(sym = '', id = null) {
  const p = id ? State.data.portfolio.find(x => x.id === id) : null;
  const syms = [...new Set([...State.data.watchlist, ...trackedSymbols()])];
  openModal(p ? 'Edit ' + p.symbol : 'Add position', `
    <form id="pos-form" class="m-body" style="padding:0" autocomplete="off">
      <label class="f"><span>Symbol</span>
        ${p ? `<input value="${esc(p.symbol)}" readonly class="mono-in">` : `<input id="pos-sym" class="mono-in" list="pos-syms" value="${esc(sym)}" required maxlength="15" placeholder="e.g. COIN or BTC"><datalist id="pos-syms">${syms.map(s => `<option value="${esc(s)}">`).join('')}</datalist>`}
      </label>
      <div class="form-row">
        <label class="f"><span>Units</span><input id="pos-shares" type="number" step="any" min="0" required value="${p ? p.shares : ''}"></label>
        <label class="f"><span>Average cost (USD)</span><input id="pos-cost" type="number" step="any" min="0" required value="${p ? p.avgCost : ''}"></label>
      </div>
      <label class="f"><span>Note</span><input id="pos-note" maxlength="80" value="${esc(p?.notes || '')}" placeholder="Optional"></label>
      <p class="mono" id="pos-hint" style="font-size:11px"></p>
      <div class="m-foot">
        ${p ? `<button class="btn ghost danger left" type="button" data-action="delete-position" data-id="${esc(p.id)}">Delete</button>` : ''}
        <button class="btn ghost" type="button" data-action="close-modal">Cancel</button>
        <button class="btn" type="submit">${p ? 'Update' : 'Save'}</button>
      </div>
    </form>`);
  const hint = () => {
    const s = ($('#pos-sym')?.value || p?.symbol || '').trim().toUpperCase();
    const q = Q[s];
    $('#pos-hint').textContent = q ? `${s} last ${fmt.price(q.price)}` : s ? 'Not tracked yet: it will be added to your watchlist' : '';
  };
  $('#pos-sym')?.addEventListener('input', hint); hint();
  $('#pos-form').addEventListener('submit', e => {
    e.preventDefault();
    const s = p ? p.symbol : $('#pos-sym').value.trim().toUpperCase();
    const shares = parseFloat($('#pos-shares').value), avgCost = parseFloat($('#pos-cost').value);
    const notes = $('#pos-note').value.trim();
    if (!/^[A-Z0-9.\-^=]{1,15}$/.test(s)) return toast('Enter a valid ticker', true);
    if (!(shares > 0) || !(avgCost >= 0)) return toast('Units and cost must be positive numbers', true);
    if (p) Object.assign(p, { shares, avgCost, notes });
    else {
      const ex = State.data.portfolio.find(x => x.symbol === s);
      if (ex) {
        // Adding to an existing position: blend the cost basis.
        const tot = ex.shares + shares;
        ex.avgCost = (ex.shares * ex.avgCost + shares * avgCost) / tot; ex.shares = tot;
        if (notes) ex.notes = notes;
        toast(`Added to existing ${s} position (cost basis blended)`);
      } else State.data.portfolio.push({ id: uid(), symbol: s, shares, avgCost, notes, addedAt: new Date().toISOString() });
      if (!State.data.watchlist.includes(s)) State.data.watchlist.push(s);
    }
    State.save(); closeModal(); render();
    if (!isNum(Q[s]?.price)) fetchQuotes();
  });
}

// ── watchlist ─────────────────────────────────────────────────────────────
let wlGroup = 'All';
function renderWatchlist() {
  // Don't rebuild the cards under someone who is typing a note; the next refresh will catch up.
  if (document.activeElement?.matches?.('#wl-grid textarea')) return;
  const openNotes = new Set($$('#wl-grid details[open] textarea').map(t => t.dataset.note));
  const wl = State.data.watchlist;
  const groups = ['All', ...GROUPS.filter(g => wl.some(s => asset(s).grp === g))];
  if (!groups.includes(wlGroup)) wlGroup = 'All';
  $('#wl-groups').innerHTML = groups.map(g => `<button type="button" data-group="${esc(g)}" aria-pressed="${g === wlGroup}">${esc(g)}</button>`).join('');
  const notes = State.data.watchlistNotes;
  const list = wl.filter(s => wlGroup === 'All' || asset(s).grp === wlGroup);
  $('#wl-grid').innerHTML = list.map(sym => {
    const a = asset(sym), d = Q[sym], sig = signal(d);
    const rng = isNum(d?.w52Low) && isNum(d?.w52High) && d.w52High > d.w52Low
      ? Math.max(0, Math.min(100, (d.price - d.w52Low) / (d.w52High - d.w52Low) * 100)) : null;
    const vsMA = ma => isNum(ma) && isNum(d?.price) ? `<span class="${d.price > ma ? 'up' : 'down'}">${d.price > ma ? 'Above' : 'Below'}</span> ${fmt.pct((d.price - ma) / ma * 100, 1)}` : '—';
    const upside = isNum(d?.target) && d.price ? (d.target - d.price) / d.price * 100 : null;
    const note = notes[sym] || '';
    return `<article class="tile" data-tip="${esc(sym)}">
      <div class="card-top">
        <div><div class="sym">${esc(sym)}</div><div class="nm">${esc(a.name)}</div><div class="mono cat">${esc(a.cat)}</div></div>
        <span class="pill ${sig.cls}" title="Mechanical signal, see Metrics guide">${sig.label}</span>
      </div>
      <div class="price-line"><span class="mid ${flash(sym)}">${fmt.price(d?.price)}</span>
        <span class="chg">${pctSpan(d?.changePct)} <span class="na">24h</span></span>
        <span class="chg">${pctSpan(d?.changePct7d)} <span class="na">7D</span></span></div>
      ${d?.ext && d.ext.session !== 'REG_MKT' ? `<div class="chg mono" style="font-size:11px">${d.ext.session === 'PRE_MKT' ? 'Pre-market' : 'After hours'} ${fmt.price(d.ext.price)} ${pctSpan(d.ext.changePct)}</div>` : ''}
      ${sparkSVG(d?.spark)}
      <dl class="kv">
        <dt>Volume</dt><dd>${fmt.vol(d?.volume)}</dd>
        <dt>Mkt cap</dt><dd>${fmt.big(d?.marketCap)}</dd>
        ${a.type === 'stock' ? `
        <dt>52W</dt><dd>${fmt.price(d?.w52Low)} – ${fmt.price(d?.w52High)}${rng == null ? '' : `<div class="range"><i style="left:${rng}%"></i></div>`}</dd>
        <dt>vs MA50</dt><dd>${vsMA(d?.ma50)}</dd>
        <dt>vs MA200</dt><dd>${vsMA(d?.ma200)}</dd>
        ${upside == null ? '' : `<dt>To target</dt><dd>${pctSpan(upside, 1)}</dd>`}` : ''}
      </dl>
      <div class="card-actions">
        <button class="btn ghost small" type="button" data-action="add-position" data-sym="${esc(sym)}">+ Portfolio</button>
        <button class="btn ghost small" type="button" data-action="chart" data-sym="${esc(sym)}">Chart</button>
        <button class="btn ghost small" type="button" data-action="quick-alert" data-sym="${esc(sym)}">Alert</button>
      </div>
      <div class="card-foot"><details class="notes"${openNotes.has(sym) ? ' open' : ''}><summary class="${note ? 'has' : ''}">Notes</summary>
        <textarea data-note="${esc(sym)}" placeholder="Thesis, levels, reminders for ${esc(sym)}">${esc(note)}</textarea></details>
        <button class="linkbtn rm" type="button" data-action="remove-wl" data-sym="${esc(sym)}" aria-label="Remove ${esc(sym)}">Remove</button></div>
    </article>`;
  }).join('') || '<div class="empty">Nothing here. Add a ticker above.</div>';
}

// ── charts ────────────────────────────────────────────────────────────────
let chartIv = 'D';           // TradingView grid interval
let chartsKey = '';
let chMode = 'kraft', chTf = '1D', chTool = 'cursor', chSym = null, chCtl = null, chLoadedKey = '', chSelected = null;
const chOv = { fills: true, orders: true, cost: true };
const TF_SEC = { '15m': 900, '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800 };
const candleCache = new Map();

function tvSrc(sym, iv) {
  const p = new URLSearchParams({
    frameElementId: 'tv_' + sym, symbol: asset(sym).tv, interval: iv, hidesidetoolbar: '1', hidetoptoolbar: '0',
    theme: KraftTheme.isLight() ? 'light' : 'dark', style: '1', locale: 'en', toolbar_bg: KraftTheme.color('bg'), enable_publishing: 'false', allow_symbol_change: 'false',
    timezone: 'Europe/London', studies: 'RSI@tv-basicstudies\u001fMACD@tv-basicstudies',
  });
  return 'https://s.tradingview.com/widgetembed/?' + p;
}
function renderCharts() {
  $('#ch-kraft').hidden = chMode !== 'kraft';
  $('#ch-tv').hidden = chMode !== 'tv';
  $$('#ch-mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === chMode)));
  $$('.ch-bar #ch-tf, .ch-bar #ch-tool').forEach(el => { el.style.display = chMode === 'kraft' ? '' : 'none'; });
  $('#ch-sym').style.display = chMode === 'kraft' ? '' : 'none';
  if (chMode === 'tv') return renderTvGrid();
  const syms = [...new Set([...trackedSymbols()])];
  if (!chSym || !syms.includes(chSym)) chSym = State.data.chartSymbols[0] && syms.includes(State.data.chartSymbols[0]) ? State.data.chartSymbols[0] : syms[0];
  const sel = $('#ch-sym');
  if (document.activeElement !== sel) sel.innerHTML = syms.map(s => `<option value="${esc(s)}"${s === chSym ? ' selected' : ''}>${esc(s)}</option>`).join('');
  $$('#ch-tf button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tf === chTf)));
  $$('#ch-tool button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === chTool)));
  $('#ch-overlays').hidden = !rxConnected() && !rvAllTrades().length;
  $$('.ch-sym-label').forEach(el => { el.textContent = chSym; });
  const nt = $('#ch-notes');
  if (document.activeElement !== nt) { nt.value = State.data.watchlistNotes[chSym] || ''; nt.dataset.sym = chSym; }
  $$('#ch-overlays button').forEach(b => b.setAttribute('aria-pressed', String(chOv[b.dataset.ov])));
  $('#ch-title').textContent = chSym;
  $('#ch-name').textContent = asset(chSym).name;
  $('#ch-dsym').textContent = chSym;
  $('#ch-hint').textContent = chTool === 'fib' ? 'Click the swing start, then the swing end · Esc cancels'
    : chTool === 'hline' ? 'Click a price to place a level' : chTool === 'note' ? 'Click where the note should be pinned'
    : 'Double-click a drawing to comment on it · F fib · H level · N note';
  if (!chCtl) {
    if (!window.KraftChart) { $('#ch-msg').textContent = 'Chart library failed to load'; return; }
    chCtl = KraftChart.mount($('#ch-box'), {
      onDraw: (d, pt) => {
        const add = extra => {
          const list = State.data.drawings[chSym] ||= [];
          const item = { id: uid(), created: new Date().toISOString(), ...d, ...extra };
          list.push(item);
          State.save(); chSelected = item.id; chTool = 'cursor';
          chCtl.setTool(chTool); chCtl.setDrawings(list); renderCharts();
        };
        if (d.type === 'note') notePop(pt, '', { title: 'New note', onSave: text => text && add({ text }) });
        else add({});
      },
      onSelect: d => { chSelected = d?.id || null; renderDrawingList(); },
      onEdit: (d, pt) => editDrawingNote(d, pt),
    });
  }
  chCtl.setTool(chTool);
  loadChart();
  renderDrawingList();
}
async function loadChart(force = false) {
  const a = asset(chSym);
  const k = a.type === 'crypto' ? 'crypto' : 'stock';
  const s = k === 'crypto' ? (a.pair || `${chSym}-USD`) : chSym;
  const key = `${s}|${k}|${chTf}`;
  const cached = candleCache.get(key);
  const fresh = cached && Date.now() - cached.at < (TF_SEC[chTf] < 86400 ? 60_000 : 600_000);
  if (key === chLoadedKey && fresh && !force) { chartOverlays(); return; }
  if (cached && key !== chLoadedKey) showBars(key, cached);
  if (fresh && !force) return;
  if (key !== chLoadedKey && !cached) { $('#ch-msg').hidden = false; $('#ch-msg').textContent = 'Loading ' + chSym + '…'; }
  try {
    const r = await fetch(`/api/candles?s=${encodeURIComponent(s)}&k=${k}&tf=${chTf}`, { signal: AbortSignal.timeout(20_000) });
    const d = await r.json();
    if (!r.ok || !d.bars?.length) throw new Error(d.error || 'no data');
    const entry = { at: Date.now(), bars: d.bars, source: d.source };
    candleCache.set(key, entry);
    // Only draw if the user hasn't switched away meanwhile.
    const a2 = asset(chSym), s2 = a2.type === 'crypto' ? (a2.pair || `${chSym}-USD`) : chSym;
    if (`${s2}|${a2.type === 'crypto' ? 'crypto' : 'stock'}|${chTf}` === key) showBars(key, entry);
  } catch (e) {
    if (key !== chLoadedKey) { $('#ch-msg').hidden = false; $('#ch-msg').textContent = `No ${chTf} candles for ${chSym}: ${e.message}`; }
  }
}
function showBars(key, entry) {
  $('#ch-msg').hidden = true;
  const sameSeries = key === chLoadedKey;
  chLoadedKey = key;
  if (sameSeries) chCtl.updateBars(entry.bars); else chCtl.setBars(entry.bars, TF_SEC[chTf]);
  $('#ch-src').textContent = `${chTf} · ${{ cnbc: 'CNBC', nasdaq: 'Nasdaq', 'revolut-x': 'Revolut X', hyperliquid: 'Hyperliquid' }[entry.source] || entry.source} · times UTC`;
  chCtl.setDrawings(State.data.drawings[chSym] || []);
  chartOverlays();
}
function chartOverlays() {
  if (!chCtl) return;
  const marks = [], lines = [];
  if (rxConnected()) {
    const base = chSym;
    if (chOv.fills) for (const o of rxOrdersFor(base)) {
      marks.push({ time: Math.floor((o.updated || o.created) / 1000), side: o.side, text: `${o.side === 'buy' ? 'B' : 'S'} ${fmt.price(+o.average_fill_price)}` });
    }
    if (chOv.orders) for (const o of (RX.live?.orders || []).filter(o => pairBase(o.symbol) === base)) {
      const px = +(o.price || o.trigger || 0);
      if (px > 0) lines.push({ price: px, dashed: true, color: o.side === 'buy' ? 'up' : 'down', title: `${o.side.toUpperCase()} ${(+o.quantity || 0).toString()}` });
    }
    const pos = rxPositions().find(p => p.symbol === base);
    if (chOv.cost && pos && isNum(pos.avgCost)) lines.push({ price: pos.avgCost, color: 'body', title: 'RX avg cost' + (pos.partial ? '*' : '') });
  }
  if (chOv.fills) for (const t of rvAllTrades().filter(t => t.symbol === chSym && (t.side === 'buy' || t.side === 'sell') && t.price != null)) {
    const px = rvUsd(t.price, t.ccy);
    marks.push({ time: Math.floor(t.t / 1000), side: t.side, text: `${t.side === 'buy' ? 'B' : 'S'} ${px == null ? t.ccy + ' ' + t.price : fmt.price(px)}` });
  }
  const rvp = rvPositions().find(p => p.symbol === chSym);
  if (chOv.cost && rvp && isNum(rvp.avgCost)) lines.push({ price: rvp.avgCost, color: 'body', title: 'Revolut avg cost' + (rvp.partial ? '*' : '') });
  for (const p of State.data.portfolio.filter(p => p.symbol === chSym)) lines.push({ price: p.avgCost, color: 'label', dashed: true, title: 'Manual cost' });
  chCtl.setOverlays({ marks, lines });
}
function chartTick() { if (chMode === 'kraft' && chCtl && chSym) loadChart(); }
function renderDrawingList() {
  const list = State.data.drawings[chSym] || [];
  chCtl?.select(chSelected);
  if (document.activeElement?.matches?.('#ch-drawings input')) return; // don't rebuild under someone typing
  const day = t => new Date(t * 1000).toISOString().slice(0, 10);
  $('#ch-drawings').innerHTML = list.length ? `<table class="data"><thead><tr><th>Drawing</th><th>Details</th><th>Comment</th><th>Added</th><th></th></tr></thead><tbody>${
    list.map(d => {
      const sel = d.id === chSelected ? ' style="outline:1px solid var(--green)"' : '';
      const lv = l => d.p2 + (d.p1 - d.p2) * l;
      const kind = d.type === 'fib' ? 'Fib' : d.type === 'hline' ? 'Level' : 'Note';
      const details = d.type === 'fib' ? `${day(d.t1)} ${fmt.price(d.p1)} → ${day(d.t2)} ${fmt.price(d.p2)} · 0.618 <span class="up">${fmt.price(lv(0.618))}</span>`
        : d.type === 'hline' ? fmt.price(d.price) : `${day(d.t)} · ${fmt.price(d.p)}`;
      const val = d.type === 'note' ? d.text || '' : d.note || '';
      return `<tr${sel}><td><button class="linkbtn" type="button" data-action="sel-drawing" data-id="${esc(d.id)}">${kind}</button></td>
        <td style="white-space:normal;text-align:left">${details}</td>
        <td><label class="visually-hidden" for="dn-${esc(d.id)}">Comment</label><input class="inline-note" id="dn-${esc(d.id)}" data-dnote="${esc(d.id)}" maxlength="500" value="${esc(val)}" placeholder="${d.type === 'note' ? 'Note text' : 'Add a comment'}"></td>
        <td>${fmt.date(d.created)}</td>
        <td><button class="linkbtn rm" type="button" data-action="del-drawing" data-id="${esc(d.id)}">Delete</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No drawings yet. Choose Fib, Level or Note above, then click on the chart.</div>';
}
// Small editor pinned on the chart, for notes and comments on drawings.
function closePop() { $('#ch-box .chart-pop')?.remove(); }
function notePop(pt, initial, { title, onSave, onDelete }) {
  closePop();
  const box = $('#ch-box');
  const el = document.createElement('div');
  el.className = 'chart-pop';
  el.innerHTML = `<div class="row"><span class="mono">${esc(title)}</span><span class="mono">Enter saves · Esc cancels</span></div>
    <textarea maxlength="500" aria-label="${esc(title)}">${esc(initial)}</textarea>
    <div class="row">${onDelete ? '<button class="linkbtn rm" type="button" data-pop="del">Delete</button>' : '<span></span>'}
      <span><button class="btn ghost small" type="button" data-pop="cancel">Cancel</button> <button class="btn small" type="button" data-pop="save">Save</button></span></div>`;
  el.style.left = Math.max(4, Math.min((pt?.x ?? 40) + 12, box.clientWidth - 292)) + 'px';
  el.style.top = Math.max(4, Math.min((pt?.y ?? 40) + 12, box.clientHeight - 170)) + 'px';
  box.appendChild(el);
  const ta = $('textarea', el);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const save = () => { const v = ta.value.trim(); closePop(); onSave(v); };
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-pop]')?.dataset.pop;
    if (a === 'save') save(); else if (a === 'cancel') closePop(); else if (a === 'del') { closePop(); onDelete(); }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
  });
}
function setDrawingText(id, text) {
  const d = (State.data.drawings[chSym] || []).find(x => x.id === id);
  if (!d) return;
  if (d.type === 'note') { if (text) d.text = text; } else if (text) d.note = text; else delete d.note;
  State.save(); chCtl?.setDrawings(State.data.drawings[chSym]);
}
function deleteDrawing(id) {
  State.data.drawings[chSym] = (State.data.drawings[chSym] || []).filter(x => x.id !== id);
  if (!State.data.drawings[chSym].length) delete State.data.drawings[chSym];
  State.save(); chSelected = null; chCtl?.setDrawings(State.data.drawings[chSym] || []); renderDrawingList();
}
function editDrawingNote(d, pt) {
  const isNote = d.type === 'note';
  notePop(pt || chCtl.pointOf(d), isNote ? d.text || '' : d.note || '', {
    title: isNote ? 'Edit note' : `Comment on ${d.type === 'fib' ? 'fib' : 'level ' + fmt.price(d.price)}`,
    onSave: text => { setDrawingText(d.id, text); renderDrawingList(); },
    onDelete: isNote ? () => deleteDrawing(d.id) : null,
  });
}
function renderTvGrid() {
  const syms = State.data.chartSymbols;
  const key = syms.join(',') + '|' + chartIv;
  const opts = sel => [...new Set([...State.data.watchlist, sel])].map(s => `<option value="${esc(s)}"${s === sel ? ' selected' : ''}>${esc(s)}</option>`).join('');
  if (key !== chartsKey) {
    chartsKey = key;
    $('#ch-grid').innerHTML = syms.map((sym, i) => `<div class="panel chart-cell" data-i="${i}">
        <div class="hdr">
          <label class="visually-hidden" for="ch-sel-${i}">Chart ${i + 1} symbol</label>
          <select id="ch-sel-${i}" class="mono-in" data-chart-i="${i}">${opts(sym)}</select>
          <span class="nm">${esc(asset(sym).name)}</span><span class="px" data-px="${esc(sym)}"></span>
          ${syms.length > 1 ? `<button class="linkbtn" type="button" data-action="remove-chart" data-i="${i}">Remove</button>` : ''}
        </div>
        <iframe src="${esc(tvSrc(sym, chartIv))}" loading="lazy" title="${esc(sym)} chart" allowfullscreen></iframe>
      </div>`).join('') + (syms.length < 8 ? '<button class="add-cell" type="button" data-action="add-chart">+ Add chart</button>' : '');
  }
  $$('[data-px]').forEach(el => { const d = Q[el.dataset.px]; el.innerHTML = d ? `${fmt.price(d.price)} ${pctSpan(d.changePct)}` : ''; });
}
function showChart(sym) {
  chSym = sym; chMode = 'kraft'; chSelected = null;
  const cs = State.data.chartSymbols;
  if (!cs.includes(sym)) { cs.unshift(sym); if (cs.length > 8) cs.pop(); State.save(); }
  setTab('charts');
}

// ── alerts ────────────────────────────────────────────────────────────────
function renderAlertCount() {
  const n = State.data.alerts.filter(a => a.triggered && !a.seen).length;
  $('#alert-count').hidden = !n;
  $('#alert-count').textContent = n;
}
function renderAlerts() {
  const sel = $('#al-sym'), cur = sel.value;
  const syms = [...new Set([...State.data.watchlist, ...trackedSymbols()])];
  sel.innerHTML = '<option value="">Select</option>' + syms.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if (syms.includes(cur)) sel.value = cur;
  updateAlertHint();
  const cfg = State.data.alertIntegrations;
  if (document.activeElement?.id !== 'int-ntfy') $('#int-ntfy').value = cfg.ntfy || '';
  if (document.activeElement?.id !== 'int-discord') $('#int-discord').value = cfg.discord || '';

  const al = State.data.alerts;
  const trig = al.filter(a => a.triggered).length;
  $('#al-summary').textContent = `${al.length - trig} active · ${trig} triggered`;
  $('#al-list').innerHTML = al.length ? al.map(a => {
    const d = Q[a.symbol];
    const dist = isNum(d?.price) ? (a.price - d.price) / d.price * 100 : null;
    return `<div class="alert-row">
      <span class="sym">${esc(a.symbol)}</span>
      <div class="d">${a.condition === 'above' ? 'Rises above' : 'Falls below'} ${fmt.price(a.price)}
        <small>${a.triggered ? `Triggered ${a.triggeredAt ? fmt.date(a.triggeredAt) : ''}${isNum(a.triggerPrice) ? ' at ' + fmt.price(a.triggerPrice) : ''}` : `Now ${fmt.price(d?.price)}${dist == null ? '' : ' · ' + fmt.pct(dist, 1) + ' away'}`}${a.note ? ' · ' + esc(a.note) : ''}</small></div>
      <span class="pill ${a.triggered ? 'ink' : ''}">${a.triggered ? 'Triggered' : 'Active'}</span>
      <span class="acts">${a.triggered ? `<button class="btn ghost small" type="button" data-action="rearm-alert" data-id="${esc(a.id)}">Re-arm</button>` : ''}
        <button class="btn ghost small danger" type="button" data-action="delete-alert" data-id="${esc(a.id)}">Delete</button></span>
    </div>`;
  }).join('') : '<div class="empty">No alerts yet.</div>';
  renderRxOrders();
  // Seeing the list counts as acknowledging triggered alerts.
  let changed = false;
  al.forEach(a => { if (a.triggered && !a.seen) { a.seen = true; changed = true; } });
  if (changed) { State.save(); renderAlertCount(); }
}
function updateAlertHint() {
  const s = $('#al-sym').value, d = Q[s];
  $('#al-current').textContent = s ? `${s} now ${fmt.price(d?.price)}` : 'Pick a symbol to see its price';
}
function checkAlerts() {
  let changed = false;
  for (const a of State.data.alerts) {
    if (a.triggered) continue;
    const d = Q[a.symbol];
    // Only fire on fresh data, never on a stale cached price.
    if (!isNum(d?.price) || !d.fetchedAt || Date.now() - d.fetchedAt > 10 * 60_000) continue;
    const hit = a.condition === 'above' ? d.price >= a.price : d.price <= a.price;
    if (hit) {
      Object.assign(a, { triggered: true, seen: tab === 'alerts', triggeredAt: new Date().toISOString(), triggerPrice: d.price });
      changed = true; notify(a, d.price);
    }
  }
  if (changed) { State.save(); render(); }
}
function notify(a, price) {
  const msg = `${a.symbol} ${a.condition === 'above' ? 'rose above' : 'fell below'} ${fmt.price(a.price)}, now ${fmt.price(price)}${a.note ? ' · ' + a.note : ''}`;
  toast('Alert: ' + msg);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('KRAFT Terminal · ' + a.symbol, { body: msg, tag: a.id }); } catch { /* some mobile browsers */ }
  }
  sendChannels('KRAFT · ' + a.symbol + ' alert', msg, a.condition === 'above');
}
async function sendChannels(title, msg, up = true, only = null) {
  const cfg = State.data.alertIntegrations, out = [];
  if (cfg.ntfy && (!only || only === 'ntfy')) {
    out.push(fetch('https://ntfy.sh/' + encodeURIComponent(cfg.ntfy), {
      method: 'POST', body: msg,
      headers: { Title: title, Priority: '4', Tags: up ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend' },
    }).then(r => { if (!r.ok) throw new Error('ntfy HTTP ' + r.status); }));
  }
  if (cfg.discord && (!only || only === 'discord')) {
    out.push(fetch(cfg.discord, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title, description: msg, color: up ? 0x39ff14 : 0xdfe2e5, footer: { text: 'KRAFT Terminal' }, timestamp: new Date().toISOString() }] }),
    }).then(r => { if (!r.ok) throw new Error('Discord HTTP ' + r.status); }));
  }
  return Promise.all(out);
}

// ── journal ───────────────────────────────────────────────────────────────
let jnTag = 'All';
function renderJournal() {
  const entries = [...State.data.journal].sort((a, b) => new Date(b.date) - new Date(a.date));
  const tags = [...new Set(entries.flatMap(e => e.tags || []).filter(Boolean))].sort();
  if (!tags.includes(jnTag)) jnTag = 'All';
  $('#jn-tags').innerHTML = tags.length ? ['All', ...tags].map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="${t === jnTag}">${esc(t)}</button>`).join('') : '';
  const list = entries.filter(e => jnTag === 'All' || (e.tags || []).includes(jnTag));
  $('#jn-list').innerHTML = list.length ? list.map(e => {
    const days = Math.floor((Date.now() - new Date(e.date)) / 86_400_000);
    const moves = [];
    const chips = (e.assets || []).map(x => {
      const cur = Q[x.symbol]?.price;
      const mv = isNum(cur) && isNum(x.price) && x.price > 0 ? (cur - x.price) / x.price * 100 : null;
      if (mv != null) moves.push(mv);
      return `<span class="asset"><b>${esc(x.symbol)}</b> ${fmt.price(x.price)} → ${fmt.price(cur)} ${pctSpan(mv)}</span>`;
    }).join('');
    const avg = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null;
    return `<article class="panel entry">
      <div class="when"><span class="mono">${esc(fmt.date(e.date))} · ${days === 0 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago'}</span>
        <span class="score">Avg ${pctSpan(avg)}</span></div>
      <p class="thesis">${esc(e.thesis)}</p>
      <div class="assets">${chips}</div>
      <div class="when">${(e.tags || []).length ? `<div class="tags">${e.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '<span></span>'}
        <button class="linkbtn" type="button" data-action="delete-snapshot" data-id="${esc(e.id)}">Delete</button></div>
    </article>`;
  }).join('') : `<div class="empty">No snapshots yet. Capture a thesis and today's prices, then check back to see whether you were right.</div>`;
  renderRxTrades();
}
function snapshotModal(preset = null) {
  const syms = [...new Set([...(preset ? [preset.symbol] : []), ...State.data.watchlist, ...allPositions().map(p => p.symbol)])];
  openModal('New snapshot', `
    <form id="snap-form" class="m-body" style="padding:0">
      <div class="f"><span class="mono" style="font-size:10.5px">Assets</span>
        <div class="picklist">${syms.map(s => `<label><input type="checkbox" name="snap" value="${esc(s)}"${preset?.symbol === s ? ' checked' : ''}> ${esc(s)} <span class="px">${preset?.symbol === s ? `${preset.side} fill ${fmt.price(preset.price)}` : fmt.price(Q[s]?.price)}</span></label>`).join('')}</div></div>
      <label class="f"><span>Thesis</span><textarea id="snap-thesis" required maxlength="4000" placeholder="What you expect, why, and what would prove you wrong">${preset ? esc(`${preset.side === 'buy' ? 'Bought' : 'Sold'} ${preset.qty} ${preset.symbol} at ${fmt.price(preset.price)} on ${preset.src || 'Revolut X'} (${fmt.date(preset.time)}). Why: `) : ''}</textarea></label>
      <label class="f"><span>Tags, comma separated</span><input id="snap-tags" maxlength="200" placeholder="bullish, earnings, macro"></label>
      <div class="m-foot"><button class="btn ghost" type="button" data-action="close-modal">Cancel</button><button class="btn" type="submit">Save snapshot</button></div>
    </form>`);
  $('#snap-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const picked = $$('input[name=snap]:checked').map(c => c.value);
    const thesis = $('#snap-thesis').value.trim();
    const tags = [...new Set($('#snap-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))];
    if (!picked.length) return toast('Pick at least one asset', true);
    if (!thesis) return toast('Write your thesis, even one sentence', true);
    const missing = picked.filter(s => !isNum(Q[s]?.price) && preset?.symbol !== s);
    if (missing.length && !confirm(`No current price for ${missing.join(', ')}. Save anyway? Those won't be scored.`)) return;
    State.data.journal.push({
      id: uid(), date: preset ? new Date(preset.time).toISOString() : new Date().toISOString(),
      assets: picked.map(s => ({ symbol: s, price: preset?.symbol === s ? preset.price : Q[s]?.price ?? null })), thesis,
      tags: preset ? [...new Set([...tags, preset.src === 'Revolut' ? 'revolut' : 'revolut-x'])] : tags, ...(preset ? { tradeId: preset.id } : {}),
    });
    State.save(); closeModal(); render();
  });
}

// ── data tab ──────────────────────────────────────────────────────────────
const SOURCE_INFO = {
  cnbc: ['CNBC quotes', 'Stock prices, previous close, volume, market cap, 52W range, pre/post-market'],
  history: ['Daily candles', 'CNBC (Nasdaq fallback) daily history: 7D, MA50/200, sparkline'],
  coingecko: ['CoinGecko', 'BTC, ETH, HYPE: price, 24h/7D, market cap, sparkline'],
  'revolut-x': ['Revolut X tickers', 'Prices for other coins, e.g. your Revolut X holdings'],
};
function renderData() {
  renderRxData();
  renderRvImported();
  renderTheme();
  const d = State.data;
  const nDraw = Object.values(d.drawings).reduce((a, l) => a + l.length, 0);
  $('#dt-counts').textContent = `${d.portfolio.length} manual positions, ${d.watchlist.length} watchlist tickers, ${d.alerts.length} alerts, ${d.journal.length} journal entries, ${Object.values(d.watchlistNotes).filter(Boolean).length} notes, ${nDraw} chart drawings, ${Object.keys(d.revolut).length} Revolut imports, ${Object.keys(d.theme.presets).length} colour presets. Revolut X keys and tokens are never included.`;
  const r = LastResp;
  $('#dt-when').textContent = r ? 'Last response ' + fmt.ago(r.updatedAt) : 'No response yet';
  $('#dt-sources').innerHTML = `<thead><tr><th>Source</th><th>Used for</th><th>OK</th><th>Failed</th><th>State</th></tr></thead><tbody>${
    Object.entries(SOURCE_INFO).map(([k, [name, use]]) => {
      const s = r?.sources?.[k], used = s && (s.ok + s.fail > 0 || s.note);
      const state = !s ? '—' : !used ? '<span class="na">Not needed</span>' : s.fail && !s.ok ? '<span class="down">Down</span>' : s.fail || s.note ? '<span class="flat">Partial</span>' : '<span class="up">Healthy</span>';
      return `<tr><td><span class="sym">${name}</span></td><td class="wrap-cell">${use}${s?.note ? '<br>' + esc(s.note) : ''}</td><td>${s?.ok ?? '—'}</td><td>${s?.fail ?? '—'}</td><td>${state}</td></tr>`;
    }).join('')}</tbody>`;
  const missing = trackedSymbols().filter(s => !isNum(Q[s]?.price) || (r && Q[s]?.fetchedAt && Q[s].fetchedAt < r.updatedAt - 1000));
  $('#dt-err-count').textContent = missing.length ? missing.length + ' symbols' : 'None';
  $('#dt-errors').innerHTML = missing.length ? `<thead><tr><th>Symbol</th><th>Reason</th><th>Last price</th></tr></thead><tbody>${missing.map(s => {
    const a = asset(s), key = a.type === 'crypto' ? 'cg:' + a.cg : s;
    return `<tr><td><span class="sym">${esc(s)}</span></td><td class="wrap-cell">${esc(r?.errors?.[key] || (FetchErr ? 'Data service unreachable' : 'Not returned'))}</td><td>${Q[s] ? fmt.price(Q[s].price) + ' · ' + fmt.ago(Q[s].fetchedAt) : '—'}</td></tr>`;
  }).join('')}</tbody>` : '';
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'kraft-terminal', version: 1, exportedAt: new Date().toISOString(), data: State.data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kraft-terminal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importData(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j?.app === 'kraft-terminal-revx') return rxImport(j);
    const d = j?.data && typeof j.data === 'object' ? j.data : j;
    if (!Array.isArray(d.watchlist) && !Array.isArray(d.journal) && !Array.isArray(d.portfolio)) throw new Error('not a KRAFT Terminal or CRYPTERM backup');
    const n = `${(d.portfolio || []).length} positions, ${(d.journal || []).length} journal entries, ${(d.alerts || []).length} alerts`;
    if (!confirm(`Replace the data in this browser with the backup (${n})?`)) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(d));
    State.load(); chartsKey = ''; rvCache.key = '';
    KraftTheme.apply(State.data.theme.colors || KraftTheme.PRESETS[State.data.theme.active] || KraftTheme.PRESETS.KRAFT);
    toast('Imported ' + n);
    render(); fetchQuotes();
  } catch (e) { toast('Import failed: ' + e.message, true); }
}

// ── Revolut X ────────────────────────────────────────────────────────────
// Two ways in: live (this site's /api/revx function with your read-only API key, token-protected)
// or a snapshot file imported on the Data tab. Both feed the same views.
const RX_TOKEN_KEY = 'kraft_terminal_revx_token';
const RX_CACHE_KEY = 'kraft_terminal_revx';
const FIATS = new Set(['USD', 'EUR', 'GBP', 'USDC', 'USDT']);
const RX = { server: null, live: null, history: null, mode: null, err: null, busy: false };
const rxToken = () => { try { return localStorage.getItem(RX_TOKEN_KEY) || ''; } catch { return ''; } };
const pairBase = sym => String(sym || '').split(/[\/-]/)[0].toUpperCase();
const pairQuote = sym => String(sym || '').split(/[\/-]/)[1]?.toUpperCase() || 'USD';
function rxConnected() { return !!RX.live; }
function rxSave() { try { localStorage.setItem(RX_CACHE_KEY, JSON.stringify({ live: RX.live, history: RX.history, mode: RX.mode })); } catch { /* ignore */ } }
function rxLoad() {
  try { const c = JSON.parse(localStorage.getItem(RX_CACHE_KEY) || 'null'); if (c) Object.assign(RX, { live: c.live, history: c.history, mode: c.mode }); } catch { /* ignore */ }
  rxRegister();
}
function rxHeldCodes() {
  return (RX.live?.balances || []).filter(b => !FIATS.has(b.currency) && +b.total > 0).map(b => b.currency);
}
// Make sure every coin you hold on Revolut X is a known asset (priced from Revolut X if CoinGecko isn't wired for it).
function rxRegister() {
  let changed = false;
  for (const code of rxHeldCodes()) {
    if (ASSETS.find(a => a.sym === code) || State.data.custom[code]?.kind === 'crypto') continue;
    State.data.custom[code] = { kind: 'crypto', pair: `${code}-USD`, name: code };
    changed = true;
  }
  if (changed) State.save();
}
function rxTickerPrice(code) {
  const t = (RX.live?.tickers || []).find(t => pairBase(t.symbol) === code && pairQuote(t.symbol) === 'USD');
  return t ? +t.last : null;
}
function rxOrdersFor(code) {
  return (RX.history?.orders || []).filter(o => pairBase(o.symbol) === code && +o.filled_quantity > 0 && +o.average_fill_price > 0);
}
// Average cost from filled orders (oldest first). Sells reduce the quantity at the running average.
function rxCostBasis(code, held) {
  let qty = 0, cost = 0, other = 0;
  for (const o of rxOrdersFor(code)) {
    const q = +o.filled_quantity, px = +o.average_fill_price;
    if (!['USD', 'USDC', 'USDT'].includes(pairQuote(o.symbol))) { other++; continue; }
    if (o.side === 'buy') { qty += q; cost += q * px; }
    else if (qty > 0) { const sold = Math.min(q, qty); cost -= sold * (cost / qty); qty -= sold; }
  }
  if (qty <= 1e-12) return { avgCost: null, partial: true, note: 'No USD buys in the loaded trade history' };
  const partial = qty < held * 0.98 || other > 0;
  const since = RX.history?.from ? new Date(RX.history.from).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  return {
    avgCost: cost / qty, partial,
    note: partial ? `Average of ${+qty.toPrecision(6)} of ${+held.toPrecision(6)} held, from buys since ${since}${other ? `; ${other} non-USD orders skipped` : ''}` : `From your buys since ${since}`,
  };
}
function rxPositions() {
  if (!RX.live) return [];
  return (RX.live.balances || []).filter(b => !FIATS.has(b.currency) && +b.total > 0).map(b => {
    const held = +b.total, cb = rxCostBasis(b.currency, held);
    return { id: 'rx:' + b.currency, rx: true, symbol: b.currency, shares: held, avgCost: cb.avgCost, partial: cb.partial, costNote: cb.note, notes: 'Revolut X' };
  });
}
function rxCash() { return (RX.live?.balances || []).filter(b => ['USD', 'USDC', 'USDT'].includes(b.currency)).reduce((a, b) => a + (+b.total || 0), 0); }
function rxCashLabel() {
  const other = (RX.live?.balances || []).filter(b => ['EUR', 'GBP'].includes(b.currency) && +b.total > 0);
  return other.length ? `(USD; ${other.map(b => `${b.currency} ${(+b.total).toFixed(2)}`).join(', ')} not counted)` : '(USD)';
}
function rxTile() {
  const pos = rxPositions();
  let inv = 0;
  for (const p of pos) { const px = Q[p.symbol]?.price ?? rxTickerPrice(p.symbol); if (isNum(px)) inv += p.shares * px; }
  const cash = rxCash(), tot = inv + cash;
  return `<div class="tile"><div class="tile-top"><span class="mono">Revolut X</span><span class="mono">${RX.mode === 'import' ? 'snapshot' : 'live'}</span></div>
    <div class="big">${tot ? fmt.usd(tot, 0) : '—'}</div>
    <div class="chips"><span>Crypto ${tot ? (inv / tot * 100).toFixed(0) : 0}%</span><span>Cash ${fmt.usd(cash, 0)}</span><span>${(RX.live.orders || []).length} open orders</span></div></div>`;
}
async function rxFetch(view, extra = '') {
  const r = await fetch(`/api/revx?view=${view}${extra}`, { headers: { 'x-terminal-token': rxToken() }, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function rxSync({ history = false, quiet = false } = {}) {
  if (!rxToken() || RX.busy) return;
  RX.busy = true;
  const msg = $('#rx-msg');
  if (!quiet && msg) msg.textContent = history ? 'Loading 12 months of filled orders…' : 'Syncing…';
  try {
    const wasImport = RX.mode !== 'server';
    RX.live = await rxFetch('live');
    RX.mode = 'server';
    const stale = !RX.history || wasImport || Date.now() - (RX.history.at || 0) > 6 * 3600_000;
    if (history || stale) RX.history = await rxFetch('history', '&months=12');
    RX.err = null;
    rxRegister(); rxSave();
    if (!quiet && msg) msg.innerHTML = `<span class="up">Synced ${fmt.time(Date.now())}: ${rxHeldCodes().length} coins, ${(RX.live.orders || []).length} open orders, ${(RX.history?.orders || []).length} filled orders.</span>`;
    if (rxHeldCodes().some(c => !isNum(Q[c]?.price))) fetchQuotes(); else render();
  } catch (e) {
    RX.err = e.message;
    if (msg) msg.textContent = 'Revolut X: ' + e.message;
    render();
  } finally { RX.busy = false; }
}
async function rxCheckServer() {
  try { RX.server = (await fetch('/api/revx?view=status', { cache: 'no-store' }).then(r => r.json())).configured; }
  catch { RX.server = null; }
  if (tab === 'data') renderRxData();
}
function rxImport(j) {
  const live = j.live || j, history = j.history || null;
  if (!Array.isArray(live.balances)) throw new Error('not a Revolut X snapshot');
  RX.live = { at: Date.parse(j.exportedAt) || Date.now(), balances: live.balances, orders: live.orders || [], tickers: live.tickers || [] };
  RX.history = history ? { at: RX.live.at, from: history.from || null, orders: history.orders || [] } : RX.history;
  RX.mode = 'import'; RX.err = null;
  rxRegister(); rxSave();
  toast(`Imported Revolut X snapshot: ${rxHeldCodes().length} coins, ${(RX.history?.orders || []).length} filled orders`);
  fetchQuotes();
}
function renderRxData() {
  const st = $('#rx-status-text');
  if (!st) return;
  const lines = [];
  lines.push(RX.server === true ? 'Server key: <span class="up">configured</span>.' : RX.server === false ? 'Server key: not set up yet (see Setup). You can still import a snapshot file.' : 'Server key: checking…');
  if (rxToken()) lines.push('Access token: saved in this browser.');
  if (RX.live) lines.push(`Data: ${RX.mode === 'import' ? 'imported snapshot' : 'live'} from ${fmt.ago(RX.live.at)}. ${rxHeldCodes().join(', ') || 'No coins'} · ${fmt.usd(rxCash())} cash.`);
  if (RX.err) lines.push(`<span class="down">Last error: ${esc(RX.err)}</span>`);
  st.innerHTML = lines.join('<br>');
  $('#rx-state').textContent = RX.live ? (RX.mode === 'import' ? 'Snapshot' : 'Live') : 'Not connected';
}
function renderRxOrders() {
  const wrap = $('#al-rx');
  const orders = RX.live?.orders || [];
  wrap.hidden = !RX.live;
  if (!RX.live) return;
  $('#al-rx-sum').textContent = `${orders.length} open`;
  $('#al-rx-orders').innerHTML = orders.length ? `<table class="data"><thead><tr><th>Pair</th><th>Side</th><th>Type</th><th>Quantity</th><th>Price</th><th>Now</th><th>To fill</th><th>Placed</th></tr></thead><tbody>${
    orders.map(o => {
      const base = pairBase(o.symbol), now = Q[base]?.price ?? rxTickerPrice(base), px = +(o.price || o.trigger || 0);
      const dist = isNum(now) && px ? (px - now) / now * 100 : null;
      return `<tr><td><span class="sym">${esc(o.symbol)}</span></td><td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.type)}</td>
        <td>${esc(o.quantity || o.amount || '')}</td><td>${fmt.price(px)}</td><td>${fmt.price(now)}</td><td>${fmt.pct(dist, 1)}</td><td>${o.created ? fmt.date(o.created) : '—'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No open orders.</div>';
}
function tradeLog() {
  const rows = (RX.history?.orders || []).map(o => ({
    id: o.id, t: o.updated || o.created, symbol: pairBase(o.symbol), label: o.symbol, side: o.side,
    qty: +o.filled_quantity, price: +o.average_fill_price, src: 'Revolut X',
  }));
  for (const t of rvAllTrades()) if ((t.side === 'buy' || t.side === 'sell') && t.price != null) rows.push({
    id: t.id, t: t.t, symbol: t.symbol, label: t.symbol, side: t.side, qty: t.qty, price: rvUsd(t.price, t.ccy), rawPrice: t.price, ccy: t.ccy, src: 'Revolut',
  });
  return rows.sort((a, b) => b.t - a.t);
}
function renderRxTrades() {
  const wrap = $('#jn-rx');
  const rows = tradeLog();
  wrap.hidden = !rows.length;
  if (!rows.length) return;
  const srcs = [...new Set(rows.map(r => r.src))].join(' + ');
  $('#jn-rx-sum').textContent = `${rows.length} trades · ${srcs}`;
  const linked = new Set(State.data.journal.map(e => e.tradeId).filter(Boolean));
  $('#jn-rx-trades').innerHTML = `<table class="data"><thead><tr><th>Date</th><th>Asset</th><th>Side</th><th>Quantity</th><th>Price</th><th>Now</th><th>Move since</th><th>Source</th><th></th></tr></thead><tbody>${
    rows.slice(0, 200).map(o => {
      const now = Q[o.symbol]?.price ?? rxTickerPrice(o.symbol), px = o.price;
      const mv = isNum(now) && px ? (now - px) / px * 100 : null;
      // for a buy, up is good; for a sell, down is good: colour by outcome of the decision
      const good = mv == null ? null : o.side === 'buy' ? mv : -mv;
      return `<tr><td><span class="nm">${fmt.date(o.t)}</span></td><td><span class="sym">${esc(o.label)}</span></td>
        <td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${+(+o.qty).toPrecision(8)}</td>
        <td>${px == null ? esc(`${o.ccy} ${o.rawPrice}`) : fmt.price(px)}</td><td>${fmt.price(now)}</td>
        <td class="${fmt.cls(good)}" title="Coloured by whether the ${o.side} has paid off">${fmt.pct(mv)}</td>
        <td><span class="na mono" style="font-size:10px">${o.src}</span></td>
        <td>${linked.has(o.id) ? '<span class="na mono" style="font-size:10px">In journal</span>' : `<button class="linkbtn" type="button" data-action="trade-thesis" data-id="${esc(o.id)}">Add thesis</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ── Revolut app statements (stocks & crypto CSV) ──────────────────────────
let FX = (() => { try { return JSON.parse(localStorage.getItem('kraft_terminal_fx') || '{}'); } catch { return {}; } })();
const rvTrades = kind => State.data.revolut?.[kind]?.trades || [];
const rvAllTrades = () => [...rvTrades('stock'), ...rvTrades('crypto')];
const rvUsd = (v, ccy) => v == null ? null : ['USD', 'USDC', 'USDT'].includes(ccy) ? v : FX[ccy] ? v * FX[ccy] : null;
const rvNeedsFx = () => rvAllTrades().some(t => t.ccy && !['USD', 'USDC', 'USDT'].includes(t.ccy));
let rvCache = { key: '', list: [] };
function rvPositions() {
  const key = `${(State.data.revolut.stock?.importedAt || '')}|${(State.data.revolut.crypto?.importedAt || '')}|${JSON.stringify(FX)}`;
  if (rvCache.key === key) return rvCache.list;
  const list = [];
  for (const kind of ['stock', 'crypto']) for (const p of KraftStatements.positions(rvTrades(kind), FX)) list.push({
    id: `rv:${kind}:${p.symbol}`, rv: true, kind, symbol: p.symbol, shares: p.qty, avgCost: p.avgCost, partial: p.partial,
    costNote: p.notes.join('; ') || 'From your Revolut statement', notes: kind === 'stock' ? 'Revolut stocks' : 'Revolut crypto',
  });
  rvCache = { key, list };
  return list;
}
function rvRegister(kind, trades) {
  if (kind !== 'crypto') return;
  for (const sym of new Set(trades.map(t => t.symbol))) {
    if (ASSETS.find(a => a.sym === sym) || State.data.custom[sym]?.kind === 'crypto') continue;
    State.data.custom[sym] = { kind: 'crypto', pair: `${sym}-USD`, name: sym };
  }
}
let rvPending = null;
async function rvChoose(file) {
  const msg = $('#rv-msg');
  try {
    const text = await file.text();
    const r = KraftStatements.parse(text, file.name);
    // Non-USD prices need today's rate before the preview can show costs.
    if (r.ccys.some(c => !['USD', 'USDC', 'USDT'].includes(c)) && !Object.keys(FX).length) {
      msg.textContent = 'Fetching today\u2019s exchange rate…';
      const d = await fetch('/api/quotes?fx=1', { signal: AbortSignal.timeout(15_000) }).then(x => x.json()).catch(() => ({}));
      if (d.fx && Object.keys(d.fx).length) { FX = d.fx; try { localStorage.setItem('kraft_terminal_fx', JSON.stringify(FX)); } catch { /* ignore */ } }
      msg.textContent = '';
    }
    rvPending = { file: file.name, ...r };
    rvPreview();
  } catch (e) { msg.textContent = 'Import failed: ' + e.message; toast('Import failed: ' + e.message, true); }
}
function rvPreview() {
  const r = rvPending;
  const pos = KraftStatements.positions(r.trades, FX);
  const ign = Object.entries(r.ignored);
  const nonUsd = r.ccys.filter(c => !['USD', 'USDC', 'USDT'].includes(c));
  openModal('Import Revolut statement', `
    <p style="font-size:13.5px"><b>${esc(r.file)}</b>: ${r.rows} rows, ${r.trades.length} trades used. Columns: <span class="mono" style="font-size:10.5px;text-transform:none">${esc(r.header.join(', '))}</span></p>
    <label class="f"><span>This statement is for</span><select id="rv-kind"><option value="stock"${r.kind === 'stock' ? ' selected' : ''}>Stocks &amp; ETFs</option><option value="crypto"${r.kind === 'crypto' ? ' selected' : ''}>Crypto</option></select></label>
    ${nonUsd.length ? `<p style="font-size:13px">Prices are in ${esc(nonUsd.join(', '))}. They're converted to USD at today's rate${Object.keys(FX).length ? ` (${Object.entries(FX).map(([k, v]) => `1 ${k} = $${v.toFixed(4)}`).join(', ')})` : ' once it loads'}, so average costs are approximate.</p>` : ''}
    <div class="table-wrap"><table class="data"><thead><tr><th>Holding</th><th>Units</th><th>Avg cost</th><th>Notes</th></tr></thead><tbody>${
      pos.map(p => `<tr><td><span class="sym">${esc(p.symbol)}</span></td><td>${+p.qty.toPrecision(8)}</td><td>${fmt.price(p.avgCost)}</td><td class="wrap-cell">${esc(p.notes.join('; '))}</td></tr>`).join('') || '<tr><td colspan="4">No open holdings (everything was sold)</td></tr>'
    }</tbody></table></div>
    ${ign.length ? `<p class="mono" style="font-size:10.5px">Not position changes, skipped: ${esc(ign.map(([k, v]) => `${k} ×${v}`).join(', '))}</p>` : ''}
    ${r.warnings.length ? `<p class="mono" style="font-size:10.5px">${esc(r.warnings.slice(0, 5).join(' · '))}${r.warnings.length > 5 ? ` · and ${r.warnings.length - 5} more` : ''}</p>` : ''}
    <div class="m-foot"><button class="btn ghost" type="button" data-action="close-modal">Cancel</button><button class="btn" type="button" data-action="rv-confirm">Import</button></div>`);
}
function rvConfirm() {
  const r = rvPending;
  if (!r) return;
  const kind = $('#rv-kind')?.value === 'stock' ? 'stock' : 'crypto';
  const replacing = !!State.data.revolut[kind];
  State.data.revolut[kind] = { file: r.file, importedAt: new Date().toISOString(), rows: r.rows, trades: r.trades.map(t => ({ ...t, id: `rv-${kind}-${t.id}` })), ignored: r.ignored };
  rvRegister(kind, r.trades);
  rvPending = null; rvCache.key = '';
  State.save(); closeModal();
  $('#rv-msg').innerHTML = `<span class="up">${replacing ? 'Replaced' : 'Imported'} ${kind === 'stock' ? 'stocks' : 'crypto'}: ${r.trades.length} trades.</span>`;
  toast(`Revolut ${kind === 'stock' ? 'stocks' : 'crypto'} imported`);
  fetchQuotes(); render();
}
function renderRvImported() {
  const rv = State.data.revolut;
  const items = ['stock', 'crypto'].filter(k => rv[k]);
  $('#rv-imported').innerHTML = items.length ? `<ul class="rv-list">${items.map(k => {
    const n = rvPositions().filter(p => p.kind === k).length;
    return `<li><span><b>${k === 'stock' ? 'Stocks' : 'Crypto'}</b> · ${esc(rv[k].file)}<br><span class="mono" style="font-size:10.5px">${rv[k].trades.length} trades · ${n} holdings · imported ${fmt.date(rv[k].importedAt)}</span></span>
      <button class="linkbtn rm" type="button" data-action="rv-remove" data-kind="${k}">Remove</button></li>`;
  }).join('')}</ul>` : '<p class="empty" style="padding:0">Nothing imported yet.</p>';
}

// ── appearance ────────────────────────────────────────────────────────────
function themeColors() { return KraftTheme.get(); }
function renderTheme() {
  const th = State.data.theme, cur = themeColors();
  $('#th-active').textContent = 'Active: ' + (th.active || 'KRAFT');
  if (!document.activeElement?.matches?.('#th-swatches input')) {
    $('#th-swatches').innerHTML = KraftTheme.KEYS.map(([k, , label]) => `<label class="swatch"><input type="color" data-th="${k}" value="${cur[k]}"><span>${label}<small>${cur[k]}</small></span></label>`).join('');
  }
  const all = [...Object.entries(KraftTheme.PRESETS).map(([n, c]) => ({ n, c, builtIn: true })), ...Object.entries(th.presets).map(([n, c]) => ({ n, c }))];
  $('#th-presets').innerHTML = all.map(({ n, c, builtIn }) => `<li>
    <span class="chips-row">${['bg', 'accent', 'up', 'down', 'text'].map(k => `<i style="background:${c[k]}"></i>`).join('')}</span>
    <span class="nm">${esc(n)}${builtIn ? '<span class="mono">built-in</span>' : ''}${th.active === n ? '<span class="mono up">active</span>' : ''}</span>
    <span class="acts"><button class="linkbtn" type="button" data-action="th-apply" data-name="${esc(n)}">Apply</button>${builtIn ? '' : `<button class="linkbtn rm" type="button" data-action="th-delete" data-name="${esc(n)}">Delete</button>`}</span></li>`).join('');
}
function setTheme(colors, active) {
  KraftTheme.apply(colors);
  State.data.theme.colors = KraftTheme.get();
  State.data.theme.active = active;
  State.save();
}

// ── modal & tooltip ───────────────────────────────────────────────────────
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  const m = $('#modal');
  if (!m.open) m.showModal();
  $('input:not([readonly]), textarea, select', m)?.focus();
}
function closeModal() { const m = $('#modal'); if (m.open) m.close(); }

function metricsHelp() {
  openModal('Metrics guide', `<dl class="help">
    <dt>24h change</dt><dd>Stocks: against the previous session's close. Crypto: against the price 24 hours ago.</dd>
    <dt>7D change</dt><dd>Against the last close at or before one calendar week ago, for both stocks and crypto.</dd>
    <dt>MA50 / MA200</dt><dd>Average daily close over 50 and 200 sessions, computed from a year of daily data. Above the 200-day is the usual definition of a long-term uptrend.</dd>
    <dt>52W range</dt><dd>The bar marks where today's price sits between the 52-week low (left) and high (right).</dd>
    <dt>Signal</dt><dd>A mechanical trend score from three inputs: price above MA50 (+1), above MA200 (+1), and price in the lower 35% of its 52-week range (+1, a "value zone" point). Two or more of three is Buy, none is Sell, one is Hold. Coins priced from CoinGecko have no moving averages here, so they show N/A. A starting point for research, not advice.</dd>
    <dt>Pre/post-market</dt><dd>Outside US hours, stock cards show the extended-hours price under the regular close.</dd>
    <dt>Sources</dt><dd>CNBC for stock quotes, CNBC and Nasdaq for daily history, CoinGecko and Revolut X for crypto, all fetched by this site's own server function and cached for 60 seconds. (Yahoo Finance blocks requests from Netlify's servers, so it isn't used.) The Data tab shows which sources are healthy.</dd>
  </dl><div class="m-foot"><button class="btn" type="button" data-action="close-modal">Got it</button></div>`);
}

const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-tip]');
  if (!el || e.target.closest('textarea, button:not(.cell), select, input')) { tip.style.display = 'none'; return; }
  const sym = el.dataset.tip, a = asset(sym), d = Q[sym];
  tip.innerHTML = `<b>${esc(sym)}</b> <span class="mono">${esc(a.cat)}</span><br>${esc(a.name)}<br><span style="color:var(--steel-500)">${esc(a.desc)}</span>${d ? `<br>${fmt.price(d.price)} · 24h ${pctSpan(d.changePct)} · 7D ${pctSpan(d.changePct7d)}` : ''}`;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + 'px';
  tip.style.top = (e.clientY + 14 + r.height > innerHeight ? e.clientY - r.height - 10 : e.clientY + 14) + 'px';
});

// ── events ────────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action], [data-tab], [data-period], [data-iv], [data-group], [data-tag], [data-tf], [data-tool], [data-mode], [data-ov], [data-goto]');
  if (!t) return;
  if (t.dataset.tab && t.getAttribute('role') === 'tab') return setTab(t.dataset.tab);
  if (t.dataset.period) { hmPeriod = t.dataset.period; $$('#hm-period button').forEach(b => b.setAttribute('aria-pressed', String(b === t))); return renderHeatmap(); }
  if (t.dataset.iv) { chartIv = t.dataset.iv; $$('#ch-interval button').forEach(b => b.setAttribute('aria-pressed', String(b === t))); return renderCharts(); }
  if (t.dataset.goto) { $('#' + t.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.dataset.tf) { chTf = t.dataset.tf; closePop(); return renderCharts(); }
  if (t.dataset.tool) { chTool = t.dataset.tool; chCtl?.setTool(chTool); return renderCharts(); }
  if (t.dataset.mode) { chMode = t.dataset.mode; chartsKey = ''; return renderCharts(); }
  if (t.dataset.ov) { chOv[t.dataset.ov] = !chOv[t.dataset.ov]; renderCharts(); return chartOverlays(); }
  if (t.dataset.group) { wlGroup = t.dataset.group; return renderWatchlist(); }
  if (t.dataset.tag) { jnTag = t.dataset.tag; return renderJournal(); }
  const { action, sym, id } = t.dataset;
  const d = State.data;
  switch (action) {
    case 'chart': return showChart(sym);
    case 'add-position': return positionModal(sym || '');
    case 'edit-position': return positionModal('', id);
    case 'delete-position':
      if (!confirm('Delete this position?')) return;
      d.portfolio = d.portfolio.filter(p => p.id !== id); State.save(); closeModal(); return render();
    case 'remove-wl':
      d.watchlist = d.watchlist.filter(s => s !== sym); State.save(); return render();
    case 'quick-alert': setTab('alerts'); $('#al-sym').value = sym; updateAlertHint(); return $('#al-price').focus();
    case 'metrics-help': return metricsHelp();
    case 'add-chart': {
      const pick = d.watchlist.find(s => !d.chartSymbols.includes(s)) || d.watchlist[0];
      if (pick && d.chartSymbols.length < 8) { d.chartSymbols.push(pick); State.save(); renderCharts(); }
      return;
    }
    case 'remove-chart': d.chartSymbols.splice(+t.dataset.i, 1); State.save(); return renderCharts();
    case 'delete-alert': d.alerts = d.alerts.filter(a => a.id !== id); State.save(); return render();
    case 'rearm-alert': { const a = d.alerts.find(x => x.id === id); if (a) { a.triggered = false; a.seen = false; delete a.triggeredAt; delete a.triggerPrice; } State.save(); render(); return checkAlerts(); }
    case 'notif-perm':
      if (!('Notification' in window)) return toast('This browser does not support notifications', true);
      return Notification.requestPermission().then(p => toast(p === 'granted' ? 'Browser notifications on' : 'Notifications blocked; alerts will still show here', p !== 'granted'));
    case 'save-int': {
      const kind = t.dataset.kind, input = $('#int-' + kind), msg = $('#int-' + kind + '-msg');
      const v = input.value.trim();
      if (kind === 'discord' && v && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(v)) { msg.textContent = 'That is not a Discord webhook URL'; return; }
      if (kind === 'ntfy' && v && !/^[A-Za-z0-9_-]{1,64}$/.test(v)) { msg.textContent = 'Topic: letters, numbers, - and _ only'; return; }
      d.alertIntegrations[kind] = v; State.save();
      if (!v) { msg.textContent = 'Removed'; return; }
      msg.textContent = 'Sending test…';
      return sendChannels('KRAFT Terminal connected', 'Price alerts will arrive here while the terminal is open.', true, kind)
        .then(() => { msg.innerHTML = '<span class="up">Test sent. Check your ' + (kind === 'ntfy' ? 'ntfy app' : 'Discord channel') + '.</span>'; })
        .catch(err => { msg.textContent = 'Failed: ' + err.message; });
    }
    case 'new-snapshot': return snapshotModal();
    case 'delete-snapshot':
      if (!confirm('Delete this snapshot?')) return;
      d.journal = d.journal.filter(x => x.id !== id); State.save(); return render();
    case 'export': return exportData();
    case 'del-drawing': return deleteDrawing(id);
    case 'sel-drawing': chSelected = id; return renderDrawingList();
    case 'rv-confirm': return rvConfirm();
    case 'rv-remove':
      if (!confirm(`Remove the imported Revolut ${t.dataset.kind === 'stock' ? 'stocks' : 'crypto'} statement?`)) return;
      delete d.revolut[t.dataset.kind]; rvCache.key = ''; State.save(); return render();
    case 'th-apply': {
      const n = t.dataset.name, c = KraftTheme.PRESETS[n] || d.theme.presets[n];
      if (c) { setTheme(c, n); toast(`Theme: ${n}`); }
      return;
    }
    case 'th-delete':
      if (!confirm(`Delete the "${t.dataset.name}" preset?`)) return;
      delete d.theme.presets[t.dataset.name]; State.save(); return renderTheme();
    case 'clear-drawings':
      if (!(d.drawings[chSym] || []).length || !confirm(`Delete all drawings on ${chSym}?`)) return;
      delete d.drawings[chSym]; State.save(); chCtl?.setDrawings([]); return renderDrawingList();
    case 'rx-sync': return rxToken() ? rxSync() : toast('Paste your access token first', true);
    case 'rx-history': return rxToken() ? rxSync({ history: true }) : toast('Paste your access token first', true);
    case 'rx-disconnect':
      try { localStorage.removeItem(RX_TOKEN_KEY); localStorage.removeItem(RX_CACHE_KEY); } catch { /* ignore */ }
      Object.assign(RX, { live: null, history: null, mode: null, err: null }); toast('Revolut X data and token removed from this browser'); return render();
    case 'trade-thesis': {
      const o = tradeLog().find(x => x.id === id);
      if (o) snapshotModal({ id: o.id, symbol: o.symbol, side: o.side, qty: +(+o.qty).toPrecision(8), price: o.price ?? o.rawPrice, time: o.t, src: o.src });
      return;
    }
    case 'reset':
      if (!confirm('Erase all positions, alerts, journal entries, notes, drawings, imports and colour presets in this browser? Export a backup first if unsure.')) return;
      localStorage.removeItem(STORE_KEY); State.load(); KraftTheme.apply(KraftTheme.PRESETS.KRAFT); rvCache.key = ''; chartsKey = ''; render(); return fetchQuotes();
    case 'close-modal': return closeModal();
  }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.mover[data-action]')) { e.preventDefault(); e.target.click(); }
  if (tab !== 'charts' || chMode !== 'kraft' || e.target.matches('input, textarea, select') || $('#modal').open) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { closePop(); chTool = 'cursor'; chSelected = null; chCtl?.setTool('cursor'); renderCharts(); }
  else if (k === 'f' || k === 'h' || k === 'n') { chTool = { f: 'fib', h: 'hline', n: 'note' }[k]; chCtl?.setTool(chTool); renderCharts(); }
  else if (k === 'enter' && chSelected) { const dd = (State.data.drawings[chSym] || []).find(x => x.id === chSelected); if (dd) { e.preventDefault(); editDrawingNote(dd); } }
  else if ((k === 'delete' || k === 'backspace') && chSelected) { e.preventDefault(); deleteDrawing(chSelected); }
});
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('focusout', e => {
  const ta = e.target.closest?.('textarea[data-note]');
  if (!ta) return;
  State.data.watchlistNotes[ta.dataset.note] = ta.value.trim();
  if (!ta.value.trim()) delete State.data.watchlistNotes[ta.dataset.note];
  State.save();
  ta.closest('details')?.querySelector('summary')?.classList.toggle('has', !!ta.value.trim());
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-chart-i]')) { State.data.chartSymbols[+e.target.dataset.chartI] = e.target.value; State.save(); renderCharts(); }
  if (e.target.id === 'ch-sym') { chSym = e.target.value; chSelected = null; e.target.blur(); renderCharts(); }
  if (e.target.id === 'al-sym') updateAlertHint();
  if (e.target.id === 'import-file' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  if (e.target.id === 'rv-file' && e.target.files[0]) { rvChoose(e.target.files[0]); e.target.value = ''; }
  if (e.target.matches('[data-dnote]')) { setDrawingText(e.target.dataset.dnote, e.target.value.trim()); }
});
let notesTimer = null;
document.addEventListener('input', e => {
  if (e.target.matches('[data-th]')) {
    const c = { ...KraftTheme.get(), [e.target.dataset.th]: e.target.value };
    e.target.nextElementSibling.querySelector('small').textContent = e.target.value;
    setTheme(c, 'Custom (unsaved)');
    $('#th-active').textContent = 'Active: Custom (unsaved)';
  }
  if (e.target.id === 'ch-notes') {
    const sym = e.target.dataset.sym, v = e.target.value;
    $('#ch-note-state').textContent = 'Saving…';
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      if (v.trim()) State.data.watchlistNotes[sym] = v; else delete State.data.watchlistNotes[sym];
      State.save(); $('#ch-note-state').textContent = 'Saved · also shown on the watchlist card';
    }, 400);
  }
});
document.addEventListener('kraft-theme', () => { chartsKey = ''; if (tab !== 'data') render(); else { renderHeatmap?.(); renderTheme(); } });
$('#th-save-form').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('#th-name').value.trim();
  if (!n) return toast('Give the preset a name', true);
  if (KraftTheme.PRESETS[n]) return toast('That name is taken by a built-in preset', true);
  State.data.theme.presets[n] = KraftTheme.get();
  State.data.theme.active = n; State.save();
  $('#th-name').value = ''; toast(`Saved preset "${n}"`); renderTheme();
});
$('#rx-token-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#rx-token').value.trim();
  if (v.length < 16) return toast('That token looks too short', true);
  try { localStorage.setItem(RX_TOKEN_KEY, v); } catch { return toast('Browser storage is blocked', true); }
  $('#rx-token').value = '';
  rxSync({ history: true });
});
$('#wl-add-form').addEventListener('submit', e => {
  e.preventDefault();
  let s = $('#wl-add').value.trim().toUpperCase();
  const pm = s.match(/^([A-Z0-9]{2,10})[-\/](USD|USDC|USDT)$/);
  if (pm) {
    // A crypto pair: track it by its coin code, priced from Revolut X.
    s = pm[1];
    if (!ASSETS.find(a => a.sym === s)) State.data.custom[s] = { kind: 'crypto', pair: `${s}-USD`, name: s };
  }
  if (!/^[A-Z0-9.\-^=]{1,15}$/.test(s)) return toast('Enter a ticker like NVDA, SHOP.TO or ETH-USD', true);
  if (State.data.watchlist.includes(s)) return toast(s + ' is already on your watchlist');
  State.data.watchlist.push(s); State.save();
  $('#wl-add').value = '';
  render(); fetchQuotes().then(() => { if (!isNum(Q[s]?.price)) toast(`No data found for ${s}. Check the ticker on finance.yahoo.com`, true); });
});
$('#alert-form').addEventListener('submit', e => {
  e.preventDefault();
  const symbol = $('#al-sym').value, price = parseFloat($('#al-price').value);
  if (!symbol || !(price > 0)) return toast('Pick a symbol and a price', true);
  const condition = $('#al-cond').value, cur = Q[symbol]?.price;
  if (isNum(cur) && ((condition === 'above' && cur >= price) || (condition === 'below' && cur <= price))
      && !confirm(`${symbol} is already ${condition} ${fmt.price(price)} (now ${fmt.price(cur)}), so this will fire straight away. Set it anyway?`)) return;
  State.data.alerts.push({ id: uid(), symbol, condition, price, note: $('#al-note').value.trim(), triggered: false, createdAt: new Date().toISOString() });
  State.save();
  $('#al-price').value = ''; $('#al-note').value = '';
  render(); checkAlerts();
});
$('#refresh-btn').addEventListener('click', () => fetchQuotes());
addEventListener('hashchange', () => setTab(location.hash.slice(1), false));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && LastResp && Date.now() - LastResp.updatedAt > REFRESH_MS) fetchQuotes();
});

// ── boot ──────────────────────────────────────────────────────────────────
State.load();
for (const k of ['stock', 'crypto']) if (State.data.revolut[k]) rvRegister(k, State.data.revolut[k].trades);
rxLoad();
const cachedAt = loadCache();
const clock = () => { $('#st-clock').textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC'; };
clock(); setInterval(clock, 1000);
setTab(location.hash.slice(1) || 'overview', false);
if (cachedAt) { $('#st-updated').textContent = 'Cached ' + fmt.ago(cachedAt); updateStatus(); setStatus('busy', 'Updating'); }
fetchQuotes();
rxCheckServer();
if (rxToken()) rxSync({ quiet: true });
setInterval(() => { if (!document.hidden) fetchQuotes(); }, REFRESH_MS);
setInterval(() => { if (!document.hidden && rxToken()) rxSync({ quiet: true }); }, 2 * REFRESH_MS);
})();
