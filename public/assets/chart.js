// KRAFT Terminal — candle chart with saved drawings (Fibonacci retracements, levels, notes)
// and account overlays (fills as markers, open orders and average cost as price lines).
// Built on TradingView Lightweight Charts (Apache-2.0, vendored in assets/vendor).
// Colours come from the active theme (theme.js) and update live when it changes.
(() => {
'use strict';
const LW = window.LightweightCharts;
const T = () => window.KraftTheme.get();
const A = (k, a) => window.KraftTheme.rgba(k, a);
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
const KEY_LEVELS = new Set([0.5, 0.618]);
const FONT = '"IBM Plex Mono", monospace';

// Map a time to an x coordinate even when it falls between, before or after loaded bars,
// so drawings made on one timeframe stay put on another.
function makeXOf(chart, getTimes, barSec) {
  return t => {
    const times = getTimes();
    if (!times.length) return null;
    let lo = 0, hi = times.length - 1;
    if (t <= times[0]) return chart.timeScale().logicalToCoordinate((t - times[0]) / barSec());
    if (t >= times[hi]) return chart.timeScale().logicalToCoordinate(hi + (t - times[hi]) / barSec());
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
    const frac = (t - times[lo]) / ((times[hi] - times[lo]) || 1);
    return chart.timeScale().logicalToCoordinate(lo + frac);
  };
}

// Word-wrap text to a pixel width, at most maxLines lines (last one ellipsised).
function wrap(g, text, width, maxLines) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (g.measureText(next).width <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let l = lines[maxLines - 1];
    while (l && g.measureText(l + '…').width > width) l = l.slice(0, -1);
    lines[maxLines - 1] = l + '…';
  }
  return lines;
}

class DrawingsPrimitive {
  constructor(ctx) { this.ctx = ctx; this.items = []; this.preview = null; this.selected = null; this.boxes = new Map(); }
  attached({ requestUpdate }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  update() { this.requestUpdate?.(); }
  updateAllViews() {}
  paneViews() {
    const self = this;
    return [{
      zOrder: () => 'top',
      renderer: () => ({
        draw(target) {
          target.useMediaCoordinateSpace(({ context: g, mediaSize }) => {
            self.boxes.clear();
            const all = self.preview ? [...self.items, self.preview] : self.items;
            for (const d of all) {
              const sel = d.id === self.selected, pre = d === self.preview;
              if (d.type === 'fib') self.drawFib(g, mediaSize, d, pre, sel);
              else if (d.type === 'hline') self.drawHlineNote(g, mediaSize, d, sel);
              else if (d.type === 'note') self.drawNote(g, mediaSize, d, sel);
            }
          });
        },
      }),
    }];
  }
  // A small boxed caption. Returns its rectangle for hit testing.
  caption(g, x, y, text, { sel = false, maxW = 240, lines = 4, above = true } = {}) {
    const th = T();
    g.font = `11px ${FONT}`;
    const ls = wrap(g, text, maxW - 12, lines);
    const w = Math.min(maxW, Math.max(...ls.map(l => g.measureText(l).width)) + 12), h = ls.length * 14 + 8;
    const bx = x, by = above ? y - h - 4 : y + 4;
    g.fillStyle = A('bg', 0.92);
    g.fillRect(bx, by, w, h);
    g.strokeStyle = sel ? th.accent : th.line; g.lineWidth = 1; g.setLineDash([]);
    g.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(w), Math.round(h));
    g.fillStyle = th.text; g.textBaseline = 'top';
    ls.forEach((l, i) => g.fillText(l, bx + 6, by + 5 + i * 14));
    return { x: bx, y: by, w, h };
  }
  drawFib(g, size, d, isPreview, isSel) {
    const { series, xOf, fmtPrice } = this.ctx;
    const th = T();
    const x1 = xOf(d.t1), x2 = xOf(d.t2);
    if (x1 == null || x2 == null) return;
    const left = Math.min(x1, x2), right = size.width;
    const lv = FIB_LEVELS.map(l => ({ l, p: d.p2 + (d.p1 - d.p2) * l })).map(o => ({ ...o, y: series.priceToCoordinate(o.p) }));
    if (lv.some(o => o.y == null)) return;
    g.save();
    const a = lv.find(o => o.l === 0.5), b = lv.find(o => o.l === 0.618);
    g.fillStyle = A('accent', 0.08); // golden pocket
    g.fillRect(left, Math.min(a.y, b.y), right - left, Math.abs(a.y - b.y));
    g.font = `10px ${FONT}`;
    g.textBaseline = 'bottom';
    const lx = Math.max(left, 0) + 4;
    for (const o of lv) {
      const key = KEY_LEVELS.has(o.l), ext = o.l > 1;
      g.strokeStyle = key ? th.accent : ext ? th.line : th.label;
      g.globalAlpha = isPreview ? 0.6 : 1;
      g.lineWidth = isSel ? 2 : 1;
      g.setLineDash(ext ? [4, 4] : []);
      g.beginPath(); g.moveTo(left, Math.round(o.y) + 0.5); g.lineTo(right, Math.round(o.y) + 0.5); g.stroke();
      g.fillStyle = key ? th.accent : th.body;
      g.fillText(`${o.l} · ${fmtPrice(o.p)}`, lx, o.y - 2);
    }
    g.setLineDash([2, 3]); g.strokeStyle = th.label; g.lineWidth = 1; g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(x1, series.priceToCoordinate(d.p1)); g.lineTo(x2, series.priceToCoordinate(d.p2)); g.stroke();
    g.globalAlpha = 1;
    if (d.note && !isPreview) {
      const top = Math.min(...lv.filter(o => o.l <= 1).map(o => o.y));
      this.boxes.set(d.id, this.caption(g, lx, top - 12, d.note, { sel: isSel, lines: 3 }));
    }
    g.restore();
  }
  drawHlineNote(g, size, d, isSel) {
    if (!d.note) return;
    const y = this.ctx.series.priceToCoordinate(d.price);
    if (y == null) return;
    g.save();
    this.boxes.set(d.id, this.caption(g, 8, y - 2, d.note, { sel: isSel, lines: 2, maxW: 300 }));
    g.restore();
  }
  drawNote(g, size, d, isSel) {
    const x = this.ctx.xOf(d.t), y = this.ctx.series.priceToCoordinate(d.p);
    if (x == null || y == null) return;
    const th = T();
    g.save();
    g.fillStyle = isSel ? th.accent : th.text;
    g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = th.label; g.setLineDash([2, 2]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 8, y - 16); g.stroke();
    const flip = x + 250 > size.width;
    const r = this.caption(g, flip ? x - 248 : x + 8, y - 12, d.text || '…', { sel: isSel });
    this.boxes.set(d.id, { x: Math.min(r.x, x - 6), y: Math.min(r.y, y - 6), w: r.w + Math.abs(r.x - x) + 6, h: r.h + Math.abs(y - r.y) + 6 });
    g.restore();
  }
}

function mount(el, { onDraw, onSelect, onEdit } = {}) {
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { fontFamily: FONT, fontSize: 11 },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LW.CrosshairMode.Normal },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {});
  const volume = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const markers = LW.createSeriesMarkers(series, []);

  let bars = [], times = [], barSecVal = 86400, tool = 'cursor', anchor = null, drawings = [], lastMarks = [], lastLines = [];
  const hlines = new Map(), overlayLines = [];
  const fmtPrice = p => { const a = Math.abs(p); return a >= 1000 ? p.toFixed(2) : a >= 1 ? p.toFixed(a >= 100 ? 2 : 3) : p.toPrecision(4); };
  const xOf = makeXOf(chart, () => times, () => barSecVal);
  const prim = new DrawingsPrimitive({ series, xOf, fmtPrice });
  series.attachPrimitive(prim);

  function theme() {
    const th = T();
    chart.applyOptions({
      layout: { background: { type: 'solid', color: th.bg }, textColor: th.label },
      grid: { vertLines: { color: th.fill }, horzLines: { color: th.fill } },
      rightPriceScale: { borderColor: th.hairline },
      timeScale: { borderColor: th.hairline },
      crosshair: { vertLine: { color: th.label, labelBackgroundColor: th.line }, horzLine: { color: th.label, labelBackgroundColor: th.line } },
    });
    series.applyOptions({
      upColor: th.up, borderUpColor: th.up, wickUpColor: th.up,
      downColor: th.bg, borderDownColor: th.down, wickDownColor: th.down, priceLineColor: th.label,
    });
    volume.applyOptions({ color: th.hairline });
    paintVolume();
    renderDrawings();
    applyOverlays();
  }
  function paintVolume() {
    volume.setData(bars.map(b => ({ time: b.time, value: b.v, color: b.close >= b.open ? A('up', 0.25) : A('down', 0.18) })));
  }
  function setPrecision() {
    const last = bars.at(-1)?.close || 1;
    const dec = last >= 1000 ? 2 : last >= 10 ? 2 : last >= 1 ? 3 : last >= 0.01 ? 5 : 8;
    series.applyOptions({ priceFormat: { type: 'price', precision: dec, minMove: 1 / 10 ** dec } });
  }

  // Snap a click to the nearest open/high/low/close of its bar when within 10px ("magnet").
  function pointAt(param, magnet = true) {
    if (!param.point || param.logical == null) return null;
    const idx = Math.max(0, Math.min(bars.length - 1, Math.round(param.logical)));
    const bar = bars[idx];
    let price = series.coordinateToPrice(param.point.y);
    if (price == null) return null;
    if (bar && magnet) {
      let best = null;
      for (const p of [bar.high, bar.low, bar.open, bar.close]) {
        const dy = Math.abs(series.priceToCoordinate(p) - param.point.y);
        if (dy < 10 && (!best || dy < best.dy)) best = { p, dy };
      }
      if (best) price = best.p;
    }
    const t = bar ? bar.time + (param.logical - idx > 0.5 && idx === bars.length - 1 ? (param.logical - idx) * barSecVal : 0) : null;
    return t == null ? null : { t, p: price };
  }
  function hitTest(pt) {
    for (const [id, r] of prim.boxes) if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return drawings.find(d => d.id === id);
    for (const d of drawings) {
      if (d.type === 'hline') { const y = series.priceToCoordinate(d.price); if (y != null && Math.abs(y - pt.y) < 6) return d; }
      if (d.type === 'fib') {
        const x1 = xOf(d.t1), x2 = xOf(d.t2);
        if (x1 == null || pt.x < Math.min(x1, x2) - 6) continue;
        for (const l of FIB_LEVELS) { const y = series.priceToCoordinate(d.p2 + (d.p1 - d.p2) * l); if (y != null && Math.abs(y - pt.y) < 5) return d; }
      }
    }
    return null;
  }

  let lastClick = null;
  const onClick = (param, dbl) => {
    if (tool === 'cursor') {
      const hit = hitTest(param.point);
      prim.selected = hit?.id || null; renderDrawings(); onSelect?.(hit);
      if (hit && dbl) onEdit?.(hit, param.point);
      return;
    }
    if (tool === 'note') {
      const pt = pointAt(param, false);
      if (pt) onDraw?.({ type: 'note', t: pt.t, p: pt.p, text: '' }, param.point);
      return;
    }
    const pt = pointAt(param);
    if (!pt) return;
    if (tool === 'hline') { onDraw?.({ type: 'hline', price: pt.p }, param.point); return; }
    if (tool === 'fib') {
      if (!anchor) { anchor = pt; return; }
      const d = { type: 'fib', t1: anchor.t, p1: anchor.p, t2: pt.t, p2: pt.p };
      anchor = null; prim.preview = null; prim.update();
      if (d.p1 !== d.p2) onDraw?.(d, param.point);
    }
  };
  // Our own click detection: the library drops a second click that comes soon after the first
  // (it waits to see if it's a double-click). A press and release that barely moves is a click;
  // anything longer is a pan/zoom and is left to the chart.
  let down = null;
  el.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', e => {
    if (!down || e.button !== 0 || e.target.closest('.chart-pop')) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const paneW = chart.timeScale().width(), paneH = chart.paneSize?.().height ?? r.height;
    if (x < 0 || x > paneW || y < 0 || y > paneH) return; // on an axis
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical == null) return;
    const now = Date.now();
    const dbl = lastClick && now - lastClick.t < 400 && Math.hypot(x - lastClick.x, y - lastClick.y) < 6;
    lastClick = dbl ? null : { t: now, x, y };
    onClick({ point: { x, y }, logical }, dbl);
  });
  chart.subscribeCrosshairMove(param => {
    legend(param);
    if (tool !== 'fib' || !anchor) return;
    const pt = pointAt(param);
    if (!pt) return;
    prim.preview = { type: 'fib', id: 'preview', t1: anchor.t, p1: anchor.p, t2: pt.t, p2: pt.p };
    prim.update();
  });

  // OHLC legend in the top-left corner
  const leg = document.createElement('div');
  leg.className = 'chart-legend mono';
  el.appendChild(leg);
  function legend(param) {
    const bar = param?.time != null ? param.seriesData.get(series) : bars.at(-1);
    if (!bar) { leg.textContent = ''; return; }
    const chg = bar.open ? (bar.close - bar.open) / bar.open * 100 : 0;
    leg.innerHTML = `O <b>${fmtPrice(bar.open)}</b> H <b>${fmtPrice(bar.high)}</b> L <b>${fmtPrice(bar.low)}</b> C <b>${fmtPrice(bar.close)}</b> <span class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : '−'}${Math.abs(chg).toFixed(2)}%</span>`;
  }

  function renderDrawings() {
    const th = T();
    prim.items = drawings.filter(d => d.type === 'fib' || d.type === 'note' || (d.type === 'hline' && d.note));
    for (const [id, line] of hlines) if (!drawings.some(d => d.id === id)) { series.removePriceLine(line); hlines.delete(id); }
    for (const d of drawings.filter(d => d.type === 'hline')) {
      const opts = { price: d.price, color: d.id === prim.selected ? th.accent : th.body, lineWidth: d.id === prim.selected ? 2 : 1, lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: '' };
      if (hlines.has(d.id)) hlines.get(d.id).applyOptions(opts); else hlines.set(d.id, series.createPriceLine(opts));
    }
    prim.update();
  }
  function applyOverlays() {
    const th = T();
    const snapped = lastMarks.map(m => {
      let lo = 0, hi = times.length - 1, t = null;
      if (!times.length || m.time < times[0]) return null;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= m.time) { t = times[mid]; lo = mid + 1; } else hi = mid - 1; }
      return t == null ? null : { ...m, time: t };
    }).filter(Boolean).sort((a, b) => a.time - b.time);
    markers.setMarkers(snapped.map(m => ({
      time: m.time, position: m.side === 'buy' ? 'belowBar' : 'aboveBar', shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
      color: m.side === 'buy' ? th.up : th.down, text: m.text || '', size: 1,
    })));
    overlayLines.splice(0).forEach(l => series.removePriceLine(l));
    for (const l of lastLines) overlayLines.push(series.createPriceLine({
      price: l.price, color: th[l.color] || l.color || th.label, lineWidth: 1, lineStyle: l.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid,
      axisLabelVisible: true, title: l.title || '',
    }));
  }
  document.addEventListener('kraft-theme', theme);
  theme();

  return {
    setBars(rows, sec) {
      barSecVal = sec;
      bars = rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], v: r[5] }));
      times = bars.map(b => b.time);
      series.setData(bars.map(({ v, ...b }) => b));
      paintVolume();
      setPrecision();
      chart.timeScale().fitContent();
      const n = bars.length;
      if (n > 220) chart.timeScale().setVisibleLogicalRange({ from: n - 200, to: n + 8 });
      legend(null);
      prim.update();
    },
    updateBars(rows) {
      // refresh in place without moving the user's zoom/scroll
      bars = rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], v: r[5] }));
      times = bars.map(b => b.time);
      const range = chart.timeScale().getVisibleLogicalRange();
      series.setData(bars.map(({ v, ...b }) => b));
      paintVolume();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
      legend(null); prim.update();
    },
    setDrawings(list) { drawings = list; renderDrawings(); },
    select(id) { prim.selected = id; renderDrawings(); },
    setTool(t) { if (t === tool) return; tool = t; anchor = null; prim.preview = null; prim.update(); el.classList.toggle('drawing', t !== 'cursor'); },
    cancel() { anchor = null; prim.preview = null; prim.update(); },
    // where a drawing sits on screen, for placing the note editor
    pointOf(d) {
      const x = d.type === 'note' ? xOf(d.t) : d.type === 'fib' ? Math.max(Math.min(xOf(d.t1) ?? 0, xOf(d.t2) ?? 0), 0) + 4 : 8;
      const y = series.priceToCoordinate(d.type === 'note' ? d.p : d.type === 'fib' ? Math.max(d.p1, d.p2) : d.price);
      return { x: x ?? 20, y: y ?? 40 };
    },
    setOverlays({ marks = [], lines = [] }) { lastMarks = marks; lastLines = lines; applyOverlays(); },
    lastPrice: () => bars.at(-1)?.close,
    destroy() { document.removeEventListener('kraft-theme', theme); chart.remove(); leg.remove(); },
  };
}

window.KraftChart = { mount, FIB_LEVELS };
})();
