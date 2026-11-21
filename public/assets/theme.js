// KRAFT Terminal — colour themes. Loaded in <head> so a saved theme applies before first paint.
// A theme is ten colours mapped onto the CSS custom properties the whole site (and the chart) uses.
(() => {
'use strict';
const KEYS = [
  ['bg', '--black', 'Background'],
  ['accent', '--green', 'Accent'],
  ['up', '--up', 'Up / gains'],
  ['down', '--down', 'Down / losses'],
  ['text', '--steel-100', 'Primary text'],
  ['body', '--steel-300', 'Body text'],
  ['label', '--steel-500', 'Labels'],
  ['line', '--steel-700', 'Strong lines'],
  ['hairline', '--steel-800', 'Hairlines'],
  ['fill', '--steel-900', 'Fills & grid'],
];
const PRESETS = {
  KRAFT: { bg: '#000000', accent: '#39ff14', up: '#39ff14', down: '#dfe2e5', text: '#dfe2e5', body: '#a7acb2', label: '#80858b', line: '#3b3e42', hairline: '#222427', fill: '#121314' },
  'Green / red': { bg: '#000000', accent: '#39ff14', up: '#39ff14', down: '#ff4d5a', text: '#dfe2e5', body: '#a7acb2', label: '#80858b', line: '#3b3e42', hairline: '#222427', fill: '#121314' },
  Amber: { bg: '#0a0700', accent: '#ffb000', up: '#ffb000', down: '#e8e2d6', text: '#f2ede4', body: '#b8ad99', label: '#8a7f6c', line: '#3d3528', hairline: '#241f17', fill: '#15110b' },
  Ice: { bg: '#05080c', accent: '#5ad1ff', up: '#5ad1ff', down: '#ff7a8a', text: '#e2e8ef', body: '#a3afbd', label: '#7a8696', line: '#2e3946', hairline: '#1c242e', fill: '#0f141a' },
  Paper: { bg: '#f5f3ee', accent: '#0a7d2c', up: '#0a7d2c', down: '#c0392b', text: '#121212', body: '#3d3d3d', label: '#6e6e6e', line: '#b9b5ab', hairline: '#dcd8cf', fill: '#ebe8e1' },
};
const HEX = /^#[0-9a-f]{6}$/i;
let current = { ...PRESETS.KRAFT };

function valid(t) { return t && KEYS.every(([k]) => HEX.test(t[k] || '')); }
function apply(t) {
  if (!valid(t)) t = PRESETS.KRAFT;
  current = { ...t };
  const s = document.documentElement.style;
  for (const [k, v] of KEYS) s.setProperty(v, t[k]);
  s.setProperty('color-scheme', isLight() ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  document.dispatchEvent(new CustomEvent('kraft-theme'));
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(key, a) { const [r, g, b] = rgb(current[key] || '#000000'); return `rgba(${r},${g},${b},${a})`; }
function isLight() { const [r, g, b] = rgb(current.bg); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5; }

// Apply the saved theme straight away (state is saved under the same key as everything else).
try {
  const d = JSON.parse(localStorage.getItem('crypterm_v3') || 'null');
  const th = d?.theme;
  if (th) apply(th.colors || PRESETS[th.active] || PRESETS.KRAFT);
} catch { /* first visit or storage blocked */ }

window.KraftTheme = { KEYS, PRESETS, apply, valid, rgba, isLight, get: () => ({ ...current }), color: k => current[k] };
})();
