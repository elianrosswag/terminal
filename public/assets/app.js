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
    alertIntegrations: { ntfy: '', discord: '' },
  }),
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { d = null; }
    this.data = { ...this.defaults(), ...(d && typeof d === 'object' ? d : {}) };
    for (const k of ['portfolio', 'watchlist', 'alerts', 'journal', 'chartSymbols']) if (!Array.isArray(this.data[k])) this.data[k] = this.defaults()[k];
    for (const k of ['watchlistNotes', 'custom', 'alertIntegrations']) if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = this.defaults()[k];
    if (!this.data.chartSymbols.length) this.data.chartSymbols = [...DEFAULT_CHARTS];
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
  const crypto = syms.map(s => asset(s)).filter(a => a.type === 'crypto').map(a => a.cg).sort();

  const chunks = [];
  for (let i = 0; i < Math.max(stocks.length, 1); i += 60) chunks.push(stocks.slice(i, i + 60));
  try {
    const bodies = await Promise.all(chunks.map((st, i) => {
      const qs = new URLSearchParams();
      if (st.length) qs.set('stocks', st.join(','));
      if (i === 0 && crypto.length) qs.set('crypto', crypto.join(','));
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
      Q[sym] = { ...q, symbol: sym, fetchedAt: Date.now() };
      // Remember names / exchanges for tickers the user added.
      if (!ASSETS.find(a => a.sym === sym)) {
        const c = State.data.custom[sym] ||= {};
        if (q.name) c.name = q.name;
        if (q.tv) c.tv = q.tv;
        if (q.exchange) c.exchange = q.exchange;
      }
    }
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
function portfolioTotals() {
  let value = 0, cost = 0, day = 0, priced = 0;
  for (const p of State.data.portfolio) {
    const d = Q[p.symbol];
    cost += p.shares * p.avgCost;
    if (isNum(d?.price)) { value += p.shares * d.price; priced++; if (isNum(d.change)) day += p.shares * d.change; }
  }
  return { value, cost, day, priced };
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
    tileHTML('Market cap', mcap ? fmt.big(mcap) : '—', `<span>${pd.length} of ${wl.length} priced</span>`),
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
  if (p > 0) { const a = 0.1 + i * 0.75; return { bg: `rgba(57,255,20,${a.toFixed(3)})`, ink: a > 0.5 }; }
  return { bg: `rgba(223,226,229,${(0.04 + i * 0.32).toFixed(3)})`, ink: false };
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
  const port = State.data.portfolio;
  const pt = portfolioTotals();
  const pnl = pt.priced ? pt.value - port.filter(p => isNum(Q[p.symbol]?.price)).reduce((a, p) => a + p.shares * p.avgCost, 0) : null;
  const pricedCost = port.filter(p => isNum(Q[p.symbol]?.price)).reduce((a, p) => a + p.shares * p.avgCost, 0);
  const ret = pnl != null && pricedCost ? pnl / pricedCost * 100 : null;
  const dayPct = pt.value - pt.day ? pt.day / (pt.value - pt.day) * 100 : null;
  const t = (l, v, c = '') => `<div class="tile"><span class="mono">${l}</span><div class="mid ${c}">${v}</div></div>`;
  $('#pf-stats').innerHTML = [
    t('Value', pt.value ? fmt.usd(pt.value) : '—'), t('Cost basis', fmt.usd(pt.cost)),
    t('Total P&amp;L', pnl == null ? '—' : fmt.usd(pnl), fmt.cls(pnl)), t('Return', fmt.pct(ret), fmt.cls(ret)),
    t('Day P&amp;L', port.length ? fmt.usd(pt.day) : '—', fmt.cls(pt.day)), t('Day', fmt.pct(dayPct), fmt.cls(dayPct)),
  ].join('');

  if (!port.length) {
    $('#pf-table').innerHTML = '<div class="empty">No positions yet. Add one here, or from any watchlist card.</div>';
    $('#pf-alloc').innerHTML = '';
    return;
  }
  const rows = port.map(p => {
    const d = Q[p.symbol], price = d?.price;
    const val = isNum(price) ? p.shares * price : null, cost = p.shares * p.avgCost;
    const pl = val != null ? val - cost : null;
    return { p, d, price, val, cost, pl, plPct: pl != null && cost ? pl / cost * 100 : null, day: isNum(d?.change) ? p.shares * d.change : null };
  }).sort((a, b) => (b.val ?? -1) - (a.val ?? -1));
  $('#pf-table').innerHTML = `<table class="data"><thead><tr>
      <th>Asset</th><th>Units</th><th>Avg cost</th><th>Price</th><th>24h</th><th>Value</th><th>P&amp;L</th><th>Return</th><th>Day P&amp;L</th><th>Weight</th><th></th>
    </tr></thead><tbody>${rows.map(r => {
      const w = pt.value && r.val ? r.val / pt.value * 100 : null;
      return `<tr>
        <td><div class="sym">${esc(r.p.symbol)}</div><div class="nm">${esc(r.p.notes || asset(r.p.symbol).name)}</div></td>
        <td>${r.p.shares.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
        <td>${fmt.price(r.p.avgCost)}</td>
        <td class="${flash(r.p.symbol)}">${fmt.price(r.price)}</td>
        <td>${pctSpan(r.d?.changePct)}</td>
        <td>${fmt.usd(r.val)}</td>
        <td class="${fmt.cls(r.pl)}">${fmt.usd(r.pl)}</td>
        <td>${pctSpan(r.plPct)}</td>
        <td class="${fmt.cls(r.day)}">${fmt.usd(r.day)}</td>
        <td>${w == null ? '—' : w.toFixed(1) + '%'}<span class="share"><i style="width:${w || 0}%"></i></span></td>
        <td><button class="btn ghost small" type="button" data-action="edit-position" data-id="${esc(r.p.id)}">Edit</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;

  const parts = rows.filter(r => r.val > 0);
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
let chartIv = 'D';
let chartsKey = '';
function tvSrc(sym, iv) {
  const p = new URLSearchParams({
    frameElementId: 'tv_' + sym, symbol: asset(sym).tv, interval: iv, hidesidetoolbar: '1', hidetoptoolbar: '0',
    theme: 'dark', style: '1', locale: 'en', toolbar_bg: '#000000', enable_publishing: 'false', allow_symbol_change: 'false',
    timezone: 'Europe/London', studies: 'RSI@tv-basicstudies\u001fMACD@tv-basicstudies',
  });
  return 'https://s.tradingview.com/widgetembed/?' + p;
}
function renderCharts() {
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
  const cs = State.data.chartSymbols;
  if (!cs.includes(sym)) { cs.unshift(sym); if (cs.length > 8) cs.pop(); State.save(); }
  setTab('charts');
  requestAnimationFrame(() => $(`.chart-cell[data-i="${cs.indexOf(sym)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
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
}
function snapshotModal() {
  const syms = [...new Set([...State.data.watchlist, ...State.data.portfolio.map(p => p.symbol)])];
  openModal('New snapshot', `
    <form id="snap-form" class="m-body" style="padding:0">
      <div class="f"><span class="mono" style="font-size:10.5px">Assets</span>
        <div class="picklist">${syms.map(s => `<label><input type="checkbox" name="snap" value="${esc(s)}"> ${esc(s)} <span class="px">${fmt.price(Q[s]?.price)}</span></label>`).join('')}</div></div>
      <label class="f"><span>Thesis</span><textarea id="snap-thesis" required maxlength="4000" placeholder="What you expect, why, and what would prove you wrong"></textarea></label>
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
    const missing = picked.filter(s => !isNum(Q[s]?.price));
    if (missing.length && !confirm(`No current price for ${missing.join(', ')}. Save anyway? Those won't be scored.`)) return;
    State.data.journal.push({ id: uid(), date: new Date().toISOString(), assets: picked.map(s => ({ symbol: s, price: Q[s]?.price ?? null })), thesis, tags });
    State.save(); closeModal(); render();
  });
}

// ── data tab ──────────────────────────────────────────────────────────────
const SOURCE_INFO = {
  'yahoo-chart': ['Yahoo Finance chart', 'Stock prices, previous close, 7D, MA50/200, 52W range, sparkline'],
  'yahoo-quote': ['Yahoo Finance quote', 'Market cap, analyst rating, price target (best effort)'],
  stooq: ['Stooq', 'Fallback stock price when Yahoo fails'],
  coingecko: ['CoinGecko', 'Crypto prices, 24h/7D change, market cap, sparkline'],
};
function renderData() {
  const d = State.data;
  $('#dt-counts').textContent = `${d.portfolio.length} positions, ${d.watchlist.length} watchlist tickers, ${d.alerts.length} alerts, ${d.journal.length} journal entries, ${Object.values(d.watchlistNotes).filter(Boolean).length} notes.`;
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
    const d = j?.data && typeof j.data === 'object' ? j.data : j;
    if (!Array.isArray(d.watchlist) && !Array.isArray(d.journal) && !Array.isArray(d.portfolio)) throw new Error('not a KRAFT Terminal or CRYPTERM backup');
    const n = `${(d.portfolio || []).length} positions, ${(d.journal || []).length} journal entries, ${(d.alerts || []).length} alerts`;
    if (!confirm(`Replace the data in this browser with the backup (${n})?`)) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(d));
    State.load(); chartsKey = '';
    toast('Imported ' + n);
    render(); fetchQuotes();
  } catch (e) { toast('Import failed: ' + e.message, true); }
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
    <dt>Signal</dt><dd>A mechanical score. Points for: price above MA50 (+1), above MA200 (+1), in the lower 35% of its 52-week range (+1), analyst rating ≤ 2.8 (+1) or ≤ 2.0 (+2), price target ≥ 5% (+1) or ≥ 20% (+2) above the price. At least 60% of available points is Buy, 30% or less is Sell, anything between is Hold. Crypto has no MA or analyst inputs here, so it shows N/A. A starting point for research, not advice.</dd>
    <dt>Sources</dt><dd>Yahoo Finance for stocks (Stooq if Yahoo fails), CoinGecko for crypto, all fetched by this site's own server function and cached for 60 seconds. The Data tab shows which sources are healthy.</dd>
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
  const t = e.target.closest('[data-action], [data-tab], [data-period], [data-iv], [data-group], [data-tag]');
  if (!t) return;
  if (t.dataset.tab && t.getAttribute('role') === 'tab') return setTab(t.dataset.tab);
  if (t.dataset.period) { hmPeriod = t.dataset.period; $$('#hm-period button').forEach(b => b.setAttribute('aria-pressed', String(b === t))); return renderHeatmap(); }
  if (t.dataset.iv) { chartIv = t.dataset.iv; $$('#ch-interval button').forEach(b => b.setAttribute('aria-pressed', String(b === t))); return renderCharts(); }
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
    case 'reset':
      if (!confirm('Erase all positions, alerts, journal entries and notes in this browser? Export a backup first if unsure.')) return;
      localStorage.removeItem(STORE_KEY); State.load(); chartsKey = ''; render(); return fetchQuotes();
    case 'close-modal': return closeModal();
  }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.mover[data-action]')) { e.preventDefault(); e.target.click(); }
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
  if (e.target.id === 'al-sym') updateAlertHint();
  if (e.target.id === 'import-file' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
});
$('#wl-add-form').addEventListener('submit', e => {
  e.preventDefault();
  const s = $('#wl-add').value.trim().toUpperCase();
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
const cachedAt = loadCache();
const clock = () => { $('#st-clock').textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC'; };
clock(); setInterval(clock, 1000);
setTab(location.hash.slice(1) || 'overview', false);
if (cachedAt) { $('#st-updated').textContent = 'Cached ' + fmt.ago(cachedAt); updateStatus(); setStatus('busy', 'Updating'); }
fetchQuotes();
setInterval(() => { if (!document.hidden) fetchQuotes(); }, REFRESH_MS);
})();
