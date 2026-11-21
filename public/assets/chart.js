// KRAFT Terminal — candle chart with saved drawings (Fibonacci retracements, horizontal lines)
// and Revolut X overlays (fills as markers, open orders and average cost as price lines).
// Built on TradingView Lightweight Charts (Apache-2.0, vendored in assets/vendor).
(() => {
'use strict';
const LW = window.LightweightCharts;
const C = {
  bg: '#000000', green: '#39FF14', s100: '#dfe2e5', s300: '#a7acb2', s500: '#80858b', s700: '#3b3e42', s800: '#222427', s900: '#121314',
};
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
const KEY_LEVELS = new Set([0.5, 0.618]);

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

class DrawingsPrimitive {
  constructor(ctx) { this.ctx = ctx; this.items = []; this.preview = null; this.selected = null; }
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
            const all = self.preview ? [...self.items, self.preview] : self.items;
            for (const d of all) if (d.type === 'fib') self.drawFib(g, mediaSize, d, d === self.preview, d.id === self.selected);
          });
        },
      }),
    }];
  }
  drawFib(g, size, d, isPreview, isSel) {
    const { series, xOf, fmtPrice } = this.ctx;
    const x1 = xOf(d.t1), x2 = xOf(d.t2);
    if (x1 == null || x2 == null) return;
    const left = Math.min(x1, x2), right = size.width;
    const lv = FIB_LEVELS.map(l => ({ l, p: d.p2 + (d.p1 - d.p2) * l })).map(o => ({ ...o, y: series.priceToCoordinate(o.p) }));
    if (lv.some(o => o.y == null)) return;
    g.save();
    // golden pocket band
    const a = lv.find(o => o.l === 0.5), b = lv.find(o => o.l === 0.618);
    g.fillStyle = 'rgba(57,255,20,0.07)';
    g.fillRect(left, Math.min(a.y, b.y), right - left, Math.abs(a.y - b.y));
    g.font = '10px "IBM Plex Mono", monospace';
    g.textBaseline = 'bottom';
    for (const o of lv) {
      const key = KEY_LEVELS.has(o.l), ext = o.l > 1;
      g.strokeStyle = key ? C.green : ext ? C.s700 : C.s500;
      g.globalAlpha = isPreview ? 0.6 : 1;
      g.lineWidth = isSel ? 2 : 1;
      g.setLineDash(ext ? [4, 4] : []);
      g.beginPath(); g.moveTo(left, Math.round(o.y) + 0.5); g.lineTo(right, Math.round(o.y) + 0.5); g.stroke();
      g.fillStyle = key ? C.green : C.s300;
      g.fillText(`${o.l} · ${fmtPrice(o.p)}`, Math.max(left, 0) + 4, o.y - 2);
    }
    // trend line between the two anchors
    g.setLineDash([2, 3]); g.strokeStyle = C.s500; g.lineWidth = 1; g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(x1, series.priceToCoordinate(d.p1)); g.lineTo(x2, series.priceToCoordinate(d.p2)); g.stroke();
    g.restore();
  }
}

function mount(el, { onDraw, onSelect } = {}) {
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.s500, fontFamily: '"IBM Plex Mono", monospace', fontSize: 11 },
    grid: { vertLines: { color: C.s900 }, horzLines: { color: C.s900 } },
    rightPriceScale: { borderColor: C.s800 },
    timeScale: { borderColor: C.s800, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { color: C.s500, labelBackgroundColor: C.s800 }, horzLine: { color: C.s500, labelBackgroundColor: C.s800 } },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.green, borderUpColor: C.green, wickUpColor: C.green,
    downColor: C.bg, borderDownColor: C.s100, wickDownColor: C.s100,
    priceLineColor: C.s500,
  });
  const volume = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: C.s800, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const markers = LW.createSeriesMarkers(series, []);

  let bars = [], times = [], barSecVal = 86400, tool = 'cursor', anchor = null, drawings = [];
  const hlines = new Map(), overlayLines = [];
  const fmtPrice = p => { const a = Math.abs(p); return a >= 1000 ? p.toFixed(2) : a >= 1 ? p.toFixed(a >= 100 ? 2 : 3) : p.toPrecision(4); };
  const xOf = makeXOf(chart, () => times, () => barSecVal);
  const prim = new DrawingsPrimitive({ series, xOf, fmtPrice });
  series.attachPrimitive(prim);

  function setPrecision() {
    const last = bars.at(-1)?.close || 1;
    const dec = last >= 1000 ? 2 : last >= 10 ? 2 : last >= 1 ? 3 : last >= 0.01 ? 5 : 8;
    series.applyOptions({ priceFormat: { type: 'price', precision: dec, minMove: 1 / 10 ** dec } });
  }

  // Snap a click to the nearest open/high/low/close of its bar when within 10px ("magnet").
  function pointAt(param) {
    if (!param.point || param.logical == null) return null;
    const idx = Math.max(0, Math.min(bars.length - 1, Math.round(param.logical)));
    const bar = bars[idx];
    let price = series.coordinateToPrice(param.point.y);
    if (price == null) return null;
    if (bar) {
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

  const onClick = param => {
    if (tool === 'cursor') {
      // select the nearest fib by its anchor line if clicked near a level
      if (!param.point) return;
      let hit = null;
      for (const d of drawings) {
        if (d.type === 'hline') { const y = series.priceToCoordinate(d.price); if (y != null && Math.abs(y - param.point.y) < 6) hit = d; continue; }
        const x1 = xOf(d.t1), x2 = xOf(d.t2);
        if (x1 == null || param.point.x < Math.min(x1, x2) - 6) continue;
        for (const l of FIB_LEVELS) { const y = series.priceToCoordinate(d.p2 + (d.p1 - d.p2) * l); if (y != null && Math.abs(y - param.point.y) < 5) { hit = d; break; } }
      }
      prim.selected = hit?.id || null; prim.update(); onSelect?.(hit);
      return;
    }
    const pt = pointAt(param);
    if (!pt) return;
    if (tool === 'hline') { onDraw?.({ type: 'hline', price: pt.p }); return; }
    if (tool === 'fib') {
      if (!anchor) { anchor = pt; return; }
      const d = { type: 'fib', t1: anchor.t, p1: anchor.p, t2: pt.t, p2: pt.p };
      anchor = null; prim.preview = null; prim.update();
      if (d.p1 !== d.p2) onDraw?.(d);
    }
  };
  // Our own click detection: the library drops a second click that comes soon after the first
  // (it waits to see if it's a double-click). A press and release that barely moves is a click;
  // anything longer is a pan/zoom and is left to the chart.
  let down = null;
  el.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', e => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const paneW = chart.timeScale().width(), paneH = chart.paneSize?.().height ?? r.height;
    if (x < 0 || x > paneW || y < 0 || y > paneH) return; // on an axis
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical == null) return;
    onClick({ point: { x, y }, logical });
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
    prim.items = drawings.filter(d => d.type === 'fib');
    for (const [id, line] of hlines) if (!drawings.some(d => d.id === id)) { series.removePriceLine(line); hlines.delete(id); }
    for (const d of drawings.filter(d => d.type === 'hline')) {
      const opts = { price: d.price, color: d.id === prim.selected ? C.green : C.s300, lineWidth: 1, lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: d.label || '' };
      if (hlines.has(d.id)) hlines.get(d.id).applyOptions(opts); else hlines.set(d.id, series.createPriceLine(opts));
    }
    prim.update();
  }

  return {
    setBars(rows, sec) {
      barSecVal = sec;
      bars = rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], v: r[5] }));
      times = bars.map(b => b.time);
      series.setData(bars.map(({ v, ...b }) => b));
      volume.setData(bars.map(b => ({ time: b.time, value: b.v, color: b.close >= b.open ? 'rgba(57,255,20,0.25)' : 'rgba(223,226,229,0.18)' })));
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
      volume.setData(bars.map(b => ({ time: b.time, value: b.v, color: b.close >= b.open ? 'rgba(57,255,20,0.25)' : 'rgba(223,226,229,0.18)' })));
      if (range) chart.timeScale().setVisibleLogicalRange(range);
      legend(null); prim.update();
    },
    setDrawings(list) { drawings = list; renderDrawings(); },
    select(id) { prim.selected = id; renderDrawings(); },
    setTool(t) { if (t === tool) return; tool = t; anchor = null; prim.preview = null; prim.update(); el.classList.toggle('drawing', t !== 'cursor'); },
    cancel() { anchor = null; prim.preview = null; prim.update(); },
    setOverlays({ marks = [], lines = [] }) {
      // markers must sit on a bar's time: snap each fill to the bar it happened in
      const snapped = marks.map(m => {
        let lo = 0, hi = times.length - 1, t = null;
        if (!times.length || m.time < times[0]) return null;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= m.time) { t = times[mid]; lo = mid + 1; } else hi = mid - 1; }
        return t == null ? null : { ...m, time: t };
      }).filter(Boolean).sort((a, b) => a.time - b.time);
      markers.setMarkers(snapped.map(m => ({
        time: m.time, position: m.side === 'buy' ? 'belowBar' : 'aboveBar', shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: m.side === 'buy' ? C.green : C.s100, text: m.text || '', size: 1,
      })));
      overlayLines.splice(0).forEach(l => series.removePriceLine(l));
      for (const l of lines) overlayLines.push(series.createPriceLine({
        price: l.price, color: l.color || C.s500, lineWidth: 1, lineStyle: l.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid,
        axisLabelVisible: true, title: l.title || '',
      }));
    },
    lastPrice: () => bars.at(-1)?.close,
    destroy() { chart.remove(); leg.remove(); },
  };
}

window.KraftChart = { mount, FIB_LEVELS };
})();
