// Generates weapon/equipment icons (48), categories.json, preview.html and item entries in assets/manifest.json.
// Run: node assets/items/_src/build.mjs   (no dependencies, hand-written SVG, no image API)
// Item list/ids/names/categories come from data/items_ko.json (single source of truth).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = join(HERE, '..');
const ASSETS = join(ITEMS_DIR, '..');
const ROOT = join(ASSETS, '..');
mkdirSync(ITEMS_DIR, { recursive: true });

const items = JSON.parse(readFileSync(join(ROOT, 'data', 'items_ko.json'), 'utf8'));
const palette = JSON.parse(readFileSync(join(ASSETS, 'palette.json'), 'utf8'));
const O = palette.outline; // #0B0E16
const N = palette.neutral;
const SH = palette.shields;
const S = 2.5; // outline width in 64-unit space (32px -> 1.25px, 64px -> 2.5px)

// ---------------------------------------------------------------- categories
const CARD_DARK = '#161B27', CARD_LIGHT = '#F4F6FA';
const CATEGORIES = [
  { key: 'general', label: '일반', accent: '#FF6B57', onLight: '#C7341F', glyph: 'circle' },
  { key: 'dig', label: '지형 파괴', accent: '#FFA62B', onLight: '#A35F00', glyph: 'triangle-down' },
  { key: 'dirt', label: '지형 생성', accent: '#8BD450', onLight: '#3F7A12', glyph: 'triangle-up' },
  { key: 'energy', label: '에너지', accent: '#2EE6F0', onLight: '#00737C', glyph: 'bolt' },
  { key: 'guidance', label: '유도', accent: '#B48CFF', onLight: '#6A3FD1', glyph: 'diamond' },
  { key: 'defense', label: '방어', accent: '#4F9DFF', onLight: '#1E5FC4', glyph: 'shield' },
  { key: 'misc', label: '기타', accent: '#A3ADBF', onLight: '#515B6E', glyph: 'square' },
];
const CAT_BY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.label, c]));

function lum(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };

// ---------------------------------------------------------------- svg helpers
const f = n => +(+n).toFixed(2);
const rad = a => (a * Math.PI) / 180;
const pt = (cx, cy, r, a) => [f(cx + r * Math.cos(rad(a))), f(cy + r * Math.sin(rad(a)))];
const st = (sw = S) => (sw ? `stroke="${O}" stroke-width="${f(sw)}" stroke-linejoin="round" stroke-linecap="round"` : '');
const P = (d, fill, sw = S, extra = '') => `<path d="${d}" fill="${fill}" ${st(sw)} ${extra}/>`;
const C = (cx, cy, r, fill, sw = S, extra = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}" ${st(sw)} ${extra}/>`;
const E = (cx, cy, rx, ry, fill, sw = S, extra = '') => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" ${st(sw)} ${extra}/>`;
const R = (x, y, w, h, rx, fill, sw = S, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${fill}" ${st(sw)} ${extra}/>`;
const L = (d, color, w, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
// outlined stroke: dark underlay + coloured line on top
const OL = (d, color, w, extra = '') => L(d, O, w + 2 * S * 0.8) + L(d, color, w, extra);
const G = (inner, t = '') => `<g${t ? ` transform="${t}"` : ''}>${inner}</g>`;
// draw motif fn(sw) in local coords, then place at (x,y) with scale k and rotation a; stroke stays S.
const place = (x, y, k, a, fn) => G(fn(S / k, k), `translate(${f(x)} ${f(y)}) rotate(${f(a)}) scale(${f(k)})`);
const sector = (cx, cy, r1, r2, a1, a2) => {
  const [x1, y1] = pt(cx, cy, r2, a1), [x2, y2] = pt(cx, cy, r2, a2);
  const large = a2 - a1 > 180 ? 1 : 0;
  if (r1 <= 0) return `M${f(cx)},${f(cy)} L${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} Z`;
  const [x3, y3] = pt(cx, cy, r1, a2), [x4, y4] = pt(cx, cy, r1, a1);
  return `M${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${large} 0 ${x4},${y4} Z`;
};
const star = (cx, cy, r1, r2, n, rot = -90) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const [x, y] = pt(cx, cy, i % 2 ? r2 : r1, rot + (i * 180) / n); d += (i ? 'L' : 'M') + x + ',' + y + ' '; }
  return d + 'Z';
};
const head = (x, y, a, size, color, sw = S * 0.8) => { // arrow head with base centre at (x,y), pointing angle a
  const tip = pt(x, y, size, a), l = pt(x, y, size * 0.62, a - 90), r = pt(x, y, size * 0.62, a + 90);
  return P(`M${tip} L${l} L${r} Z`, color, sw);
};
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function blob(cx, cy, r, seed, vari, n, squashY = 1) { // smooth closed catmull-rom blob
  const rnd = mulberry(seed);
  const p = [];
  for (let i = 0; i < n; i++) { const a = -90 + (360 * i) / n; const rr = r * (1 - vari + rnd() * vari * 2); const [x, y] = pt(0, 0, rr, a); p.push([cx + x, cy + y * squashY]); }
  let d = `M${f(p[0][0])},${f(p[0][1])} `;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])} `;
  }
  return d + 'Z';
}

// ---------------------------------------------------------------- gradients
// linear: light from top-left. [id]: stops [offset, colour, opacity?]
const LIN = {
  steel: [[0, N.steelLight], [0.45, N.steel], [1, N.steelDark]],
  dark: [[0, '#4E5A72'], [0.5, '#2A3142'], [1, '#161B27']],
  red: [[0, '#FFA08F'], [0.45, '#FF4B3E'], [1, '#A11D1D']],
  yellow: [[0, '#FFF2A6'], [0.45, '#FFD21F'], [1, '#B88A00']],
  green: [[0, '#C9FFD9'], [0.45, '#3BD16F'], [1, '#157A3A']],
  dirt: [[0, '#D4A672'], [0.45, '#94633A'], [1, '#4E3019']],
  mud: [[0, '#E0A470'], [0.45, '#9A5A2A'], [1, '#4A2810']],
  mole: [[0, '#C7B6A5'], [0.45, '#857161'], [1, '#43372D']],
  amber: [[0, '#FFE6A8'], [0.45, '#FFB21E'], [1, '#B86A00']],
  bone: [[0, '#FFFFFF'], [0.5, '#E9E3D4'], [1, '#9C9585']],
  flame: [[0, '#FFE27A'], [0.45, '#FF8A1F'], [1, '#D2361A']],
  flameCore: [[0, '#FFFBE0'], [1, '#FFD23F']],
  hotOuter: [[0, '#FF8FD8'], [0.45, '#FF2D6F'], [1, '#8A0F3A']],
  hotMid: [[0, '#FFE6A0'], [1, '#FF9A1F']],
  hotCore: [[0, '#FFFFFF'], [1, '#9FEFFF']],
  blue: [[0, '#BFE0FF'], [0.45, '#4F9DFF'], [1, '#1E4FA0']],
  violet: [[0, '#F3D9FF'], [0.45, '#C46BFF'], [1, '#6A2AA8']],
  pink: [[0, '#FFC2E8'], [0.45, '#FF4FC3'], [1, '#9A1C73']],
  canopy: [[0, '#FFD9A0'], [0.45, '#FF8A1F'], [1, '#B54A00']],
};
const RAD = {
  glowOrange: [[0, '#FFB347', 0.85], [0.55, '#FF6A1F', 0.35], [1, '#FF3B1F', 0]],
  glowRed: [[0, '#FF3B3B', 0.7], [0.6, '#FF3B3B', 0.25], [1, '#FF3B3B', 0]],
  glowCyan: [[0, '#5BE7FF', 0.75], [0.6, '#2EE6F0', 0.25], [1, '#2EE6F0', 0]],
  glowYellow: [[0, '#FFF7C2', 1], [0.45, '#FFD21F', 0.55], [1, '#FFD21F', 0]],
  plasma: [[0, '#FFFFFF'], [0.3, '#BFF6FF'], [0.65, '#2EC8F0'], [1, '#5A2AB0']],
  heat: [[0, '#FFF7C2'], [0.4, '#FFB21E'], [0.75, '#FF3B3B'], [1, '#B0123A']],
  hole: [[0, '#0B0E16'], [1, '#2A3142']],
  sheen: [[0, '#FFFFFF', 0.55], [0.5, '#FFFFFF', 0], [1, '#0B0E16', 0.3]],
};
function defsFor(body) {
  const ids = [...new Set([...body.matchAll(/url\(#([a-zA-Z0-9]+)\)/g)].map(m => m[1]))];
  let d = '';
  for (const id of ids) {
    const stops = s => s.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('');
    if (LIN[id]) d += `<linearGradient id="${id}" x1="0.2" y1="0" x2="0.8" y2="1">${stops(LIN[id])}</linearGradient>`;
    else if (id === 'sheen') d += `<radialGradient id="${id}" cx="0.32" cy="0.28" r="0.8">${stops(RAD[id])}</radialGradient>`;
    else if (RAD[id]) d += `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops(RAD[id])}</radialGradient>`;
    else if (CLIPS[id]) d += CLIPS[id];
    else throw new Error('missing def ' + id);
  }
  return d;
}
const CLIPS = {};

// ---------------------------------------------------------------- shared motifs (local coords)
const HL = (d, w, op = 0.75) => L(d, '#FFFFFF', w, `opacity="${op}"`);

// missile pointing +x, centred at origin
const missile = (nose = 'url(#red)', flame = true) => sw => [
  flame ? P('M-17,-4.5 Q-30,0 -17,4.5 Z', 'url(#flame)', sw) + P('M-17,-2.4 Q-24,0 -17,2.4 Z', '#FFF3B0', 0) : '',
  P('M-14,-5 L-21,-13 L-8,-5 Z', nose, sw),
  P('M-14,5 L-21,13 L-8,5 Z', nose, sw),
  R(-17, -6, 28, 12, 3, 'url(#steel)', sw),
  R(2.5, -6, 3.6, 12, 0, '#46526A', sw * 0.6),
  P('M10,-6 Q22,-6 26.5,0 Q22,6 10,6 Z', nose, sw),
  HL('M-13,-3 H0', sw * 0.65),
].join('');

// falling bomb (nose down) with trefoil
const nukeBomb = sw => {
  let s = P('M-7,-15 L-12,-28 H12 L7,-15 Z', 'url(#dark)', sw);
  s += L('M0,-27 V-16', '#6B7588', sw * 0.6);
  s += R(-9, -18, 18, 5, 1.5, 'url(#steel)', sw);
  s += E(0, 2, 14.5, 18, 'url(#yellow)', sw);
  for (const a of [-90, 30, 150]) s += P(sector(0, 3, 3.6, 11, a - 30, a + 30), O, 0);
  s += C(0, 3, 2.3, O, 0);
  s += HL('M-10,-6 Q-8,-11 -3,-13', sw * 0.7, 0.85);
  return s;
};

// roller: bullet on wheels, pointing +x
const roller = (heavy = false) => sw => {
  let s = L('M-27,-11 H-22 M-30,-6 H-23 M-27,-1 H-22', '#C9D1DE', sw * 0.7, 'opacity="0.9"');
  s += L('M-28,11 H28', O, sw * 2.2) + L('M-28,11 H28', '#B07D4A', sw * 1.1);
  s += P('M-17,-15 H5 Q18,-15 18,-7.5 Q18,0 5,0 H-17 Q-19,0 -19,-2 V-13 Q-19,-15 -17,-15 Z', heavy ? 'url(#dark)' : 'url(#red)', sw);
  s += R(-9, -15, 3.6, 15, 0, heavy ? 'url(#red)' : '#46526A', sw * 0.6);
  if (heavy) s += R(-1, -15, 3.6, 15, 0, 'url(#red)', sw * 0.6) + P('M10,-14 Q18,-13 18,-7.5 Q18,-2 10,-1 Z', 'url(#red)', sw * 0.6);
  s += HL('M-15,-11 H-11', sw * 0.65);
  for (const x of [-10, 8]) s += C(x, 4, 6, '#2A3142', sw) + C(x, 4, 2.3, N.hub, sw * 0.5);
  return s;
};

// riot wedge from small turret at local origin, opening up-right
const riotWedge = R0 => sw => {
  let s = P(sector(0, 0, 0, R0, -78, -12), 'url(#amber)', sw, 'opacity="0.95"');
  for (const k of [0.5, 0.78]) { const [a, b] = [pt(0, 0, R0 * k, -72), pt(0, 0, R0 * k, -18)]; s += L(`M${a} A${f(R0 * k)},${f(R0 * k)} 0 0 1 ${b}`, '#FFF6D8', sw * 0.75, 'opacity="0.95"'); }
  const rnd = mulberry(R0 | 0);
  for (const a of [-70, -45, -20]) { const [x, y] = pt(0, 0, R0 + 5, a); s += P(blob(x, y, 3.2, (a * 7) | 0, 0.3, 5), 'url(#dirt)', sw * 0.6); rnd(); }
  s += P('M-9,0 A9,9 0 0 1 9,0 Z', 'url(#steel)', sw);
  s += R(-12, 0, 24, 6, 3, '#2A3142', sw);
  return s;
};

// riot bomb: amber starburst ring with hollow centre, debris flying out
const riotBomb = (double = false) => sw => {
  let s = '';
  if (double) s += P(star(0, 0, 29, 24, 14, -90 + 180 / 14), '#C77A0A', sw);
  s += P(star(0, 0, 24, 18.5, 12), 'url(#amber)', sw);
  s += C(0, 0, 12.5, 'url(#hole)', sw);
  s += L(`M-8,-6 A10,10 0 0 1 2,-10`, '#FFFFFF', sw * 0.6, 'opacity="0.35"');
  for (const [i, a] of [-60, 0, 60, 120, 180, 240].entries()) { const [x, y] = pt(0, 0, double ? 34 : 29, a + 30); s += P(blob(x, y, 3.4, i + 11, 0.3, 5), 'url(#dirt)', sw * 0.6); }
  return s;
};

// drill bit pointing down (+y)
const drill = sw => {
  let s = R(-4, -27, 8, 11, 1.5, 'url(#dark)', sw);
  s += R(-11.5, -18, 23, 8, 2, 'url(#steel)', sw);
  s += P('M-11,-10 L11,-10 L0,22 Z', 'url(#steel)', sw);
  const xl = y => -11 + ((y + 10) * 11) / 32;
  for (const y of [-6, 2, 10]) s += L(`M${f(xl(y + 3))},${y + 3} L${f(-xl(y - 3))},${y - 3}`, O, sw * 0.6);
  s += HL('M-7.5,-7 L-2,9', sw * 0.6, 0.6);
  for (const [i, [x, y, r]] of [[-10, 18, 3], [10, 15, 2.6], [-6, 26, 2.4], [7, 25, 3]].entries()) s += P(blob(x, y, r, 30 + i, 0.3, 5), 'url(#dirt)', sw * 0.55);
  return s;
};

// mole-like burrower with drill nose, emerging up from a mound
const sandhog = sw => {
  let s = '';
  for (const sx of [-1, 1]) {
    s += E(sx * 12.5, 5, 4.6, 3.4, '#F0A9A0', sw * 0.8);
    s += L(`M${sx * 15},3 l${sx * 3},-2 M${sx * 16},5.5 l${sx * 3.2},0 M${sx * 15},8 l${sx * 3},2`, O, sw * 0.45);
  }
  s += E(0, 4, 11, 14.5, 'url(#mole)', sw);
  s += P('M-8,-7 L8,-7 L0,-27 Z', 'url(#steel)', sw);
  s += L('M-5,-12 L4,-14 M-3,-18 L2.6,-19.5', O, sw * 0.5);
  for (const sx of [-1, 1]) s += C(sx * 4.6, -2.5, 1.9, O, 0) + C(sx * 4.6 - 0.6, -3.1, 0.6, '#FFFFFF', 0);
  s += P('M-28,22 Q-24,11 -14,13 Q-6,8 0,11 Q8,7 14,12 Q24,11 28,22 Z', 'url(#dirt)', sw);
  s += C(-15, 17, 1.2, '#D4A672', 0) + C(6, 15.5, 1.1, '#D4A672', 0) + C(17, 18, 1.3, '#4E3019', 0);
  return s;
};

const dirtSpecks = (cx, cy, r, seed) => {
  const rnd = mulberry(seed); let s = '';
  for (let i = 0; i < 6; i++) { const a = rnd() * 360, d = rnd() * r * 0.7; const [x, y] = pt(cx, cy, d, a); s += C(x, y, 0.9 + rnd() * 0.9, i % 2 ? '#D9AF7C' : '#4E3019', 0, 'opacity="0.9"'); }
  return s;
};
const dirtLump = (r, seed, vari, n, squash = 1) => sw => P(blob(0, 0, r, seed, vari, n, squash), 'url(#dirt)', sw) + dirtSpecks(0, 0, r, seed + 5) + E(-r * 0.35, -r * 0.42 * squash, r * 0.32, r * 0.16, '#FFFFFF', 0, `opacity="0.3" transform="rotate(-25 ${f(-r * 0.35)} ${f(-r * 0.42 * squash)})"`);

const flame = (hot = false) => sw => {
  const outer = 'M0,-27 C4,-18 15,-12 15,4 C15,17 8,25 0,25 C-9,25 -16,18 -16,8 C-16,0 -12,-5 -8,-10 C-8,-3 -6,1 -3,2 C-5,-7 -4,-18 0,-27 Z';
  const mid = 'M1,-10 C5,-3 10,2 10,10 C10,17 5,21 0,21 C-6,21 -10,17 -10,12 C-10,7 -7,4 -4,2 C-4,7 -2,9 -1,9 C-2,3 -1,-3 1,-10 Z';
  const core = 'M1,3 C3,7 6,10 6,14 C6,18 3,19 0,19 C-3,19 -5,17 -5,14 C-5,11 -2,9 1,3 Z';
  let s = '';
  s += P('M-22,14 Q-24,9 -21,5 Q-18,9 -20,14 Z', hot ? 'url(#hotOuter)' : 'url(#flame)', sw * 0.7);
  s += P('M21,12 Q24,7 22,3 Q18,7 19.5,12 Z', hot ? 'url(#hotOuter)' : 'url(#flame)', sw * 0.7);
  s += E(0, 26, 20, 3.6, hot ? '#FF2D6F' : '#FF8A1F', sw * 0.8);
  s += P(outer, hot ? 'url(#hotOuter)' : 'url(#flame)', sw);
  s += P(mid, hot ? 'url(#hotMid)' : 'url(#flameCore)', 0);
  if (hot) s += P(core, 'url(#hotCore)', 0);
  return s;
};

const miniTank = sw => R(-14, 4, 28, 7, 3.5, '#2A3142', sw) + L('M0,-1 L10,-7', O, sw * 1.9) + L('M0,-1 L10,-7', N.steel, sw * 0.9) + P('M-10,4 Q-10,-4 0,-4 Q10,-4 10,4 Z', 'url(#steel)', sw);

const target = (cx, cy, r, sw = S) => C(cx, cy, r, '#FF4B3E', sw) + C(cx, cy, r * 0.64, '#FFFFFF', sw * 0.6) + C(cx, cy, r * 0.3, '#FF4B3E', sw * 0.6);
const arrowLine = (d, color, w = 4.2) => L(d, O, w + 3.4) + L(d, color, w);

// tier bars bottom-right: n filled of max
const tier = (n, max) => {
  let s = ''; const w = 4, gap = 1.8, hs = max === 3 ? [5, 8, 11] : [7, 11];
  const x0 = 62 - max * w - (max - 1) * gap;
  for (let i = 0; i < max; i++) {
    const x = x0 + i * (w + gap), h = hs[i];
    s += R(x, 62 - h, w, h, 1, i < n ? '#FFFFFF' : '#46526A', 1.4);
  }
  return s;
};

// ---------------------------------------------------------------- icon definitions
const ICON = {
  baby_missile: () => place(29, 33, 0.7, -35, missile()),
  missile: () => place(30, 32, 0.98, -35, missile()),
  baby_nuke: () => place(30, 33, 0.74, -22, nukeBomb),
  nuke: () => C(31, 33, 30, 'url(#glowOrange)', 0) + place(31, 34, 1.02, -22, nukeBomb),
  leap_frog: () => {
    let s = L('M12,50 Q20,28 31,37 M31,37 Q38,16 50,23', '#C9FFD9', 2.6, 'stroke-dasharray="3.5 3.5" opacity="0.95"');
    s += L('M4,58 Q8,48 12,50', '#C9FFD9', 2.6, 'stroke-dasharray="3.5 3.5" opacity="0.6"');
    for (const [x, y] of [[13, 49], [31, 37], [50, 22]]) s += place(x, y, 0.5, -28, missile('url(#green)', false));
    return s;
  },
  funky_bomb: () => {
    let s = C(31, 36, 17, '#FFFFFF', 0);
    const cols = ['#FF4FC3', '#FFD21F', '#1FD6F0', '#C8F23A'];
    cols.forEach((c, i) => { s += P(sector(31, 36, 0, 17, -70 + i * 90, 20 + i * 90), c, 0); });
    s += C(31, 36, 17, 'url(#sheen)', S);
    s += R(26, 15, 10, 6, 1.5, 'url(#dark)', S);
    s += OL('M31,15 Q32,7 39,7', '#C9D1DE', 1.6);
    s += P(star(42, 6, 5, 2.2, 5), '#FFD21F', 1.2);
    s += C(53, 22, 4.2, '#FF4FC3', 1.8) + C(52, 49, 3.6, '#C8F23A', 1.8) + C(9, 24, 3.2, '#1FD6F0', 1.8) + C(11, 51, 2.6, '#FFD21F', 1.6);
    return s;
  },
  mirv: () => {
    let s = '';
    const angs = [42, 66, 90, 114, 138];
    for (const a of angs) { const [x, y] = pt(32, 16, 31, a); s += L(`M32,18 L${x},${y}`, '#C9D1DE', 1.4, 'stroke-dasharray="2 3" opacity="0.8"'); }
    for (const a of angs) { const [x, y] = pt(32, 16, 33, a); s += place(x, y, 0.34, a, missile('url(#red)', false)); }
    s += place(32, 13, 0.6, 90, missile('url(#red)', false));
    return s;
  },
  deaths_head: () => {
    let s = C(32, 32, 31, 'url(#glowRed)', 0);
    for (const [a, b] of [[[9, 44], [55, 60]], [[9, 60], [55, 44]]]) {
      s += L(`M${a} L${b}`, O, 10) + L(`M${a} L${b}`, 'url(#bone)', 5.2);
      for (const [x, y] of [a, b]) s += C(x - 2, y - 1.5, 3.1, '#E9E3D4', 1.8) + C(x + 1.5, y + 2, 3.1, '#E9E3D4', 1.8);
    }
    s += P('M15,27 A17,17 0 1 1 49,27 Q49,35 43,39 L43,48 Q43,52 39,52 H25 Q21,52 21,48 L21,39 Q15,35 15,27 Z', 'url(#bone)', S);
    s += E(24.5, 28, 5.2, 5.8, O, 0) + E(39.5, 28, 5.2, 5.8, O, 0);
    s += C(25, 28.5, 2.1, '#FF3B3B', 0) + C(39, 28.5, 2.1, '#FF3B3B', 0);
    s += P('M32,35 L29.3,40.5 H34.7 Z', O, 0);
    s += L('M27,45 V52 M32,45 V52 M37,45 V52', O, 1.6);
    s += HL('M20,20 Q24,13 31,12', 1.8, 0.8);
    return s;
  },
  napalm: () => place(31, 33, 0.84, 0, flame(false)),
  hot_napalm: () => C(32, 32, 30, 'url(#glowRed)', 0) + place(32, 33, 1.04, 0, flame(true)),
  tracer: () => {
    const d = 'M7,55 Q24,0 50,36';
    let s = L(d, O, 5.6) + L(d, '#FFFFFF', 2.6, 'stroke-dasharray="5 4.5"');
    s += C(51, 37, 11, 'url(#glowYellow)', 0) + C(51, 37, 4, '#FFFBE0', 1.6);
    s += P('M3,58 Q3,51 9,51 Q15,51 15,58 Z', 'url(#steel)', 1.8);
    return s;
  },
  smoke_tracer: () => {
    const q = t => [(1 - t) ** 2 * 7 + 2 * (1 - t) * t * 24 + t * t * 50, (1 - t) ** 2 * 55 + 2 * (1 - t) * t * 0 + t * t * 36];
    const cols = ['#FF4FC3', '#A66BFF', '#3D7BFF', '#1FD6F0', '#22C55E', '#FFD21F'];
    let s = '';
    [0.14, 0.28, 0.42, 0.56, 0.7, 0.84].forEach((t, i) => { const [x, y] = q(t); s += C(x, y, 3.8 + i * 0.55, cols[i], 1.8) + C(x - 1.2, y - 1.3, 1.1 + i * 0.15, '#FFFFFF', 0, 'opacity="0.6"'); });
    s += C(51, 37, 9, 'url(#glowYellow)', 0) + C(51, 37, 3.6, '#FFFBE0', 1.6);
    s += P('M3,58 Q3,51 9,51 Q15,51 15,58 Z', 'url(#steel)', 1.8);
    return s;
  },
  baby_roller: () => place(28, 33, 0.68, 14, roller()),
  roller: () => place(29, 32, 0.84, 14, roller()),
  heavy_roller: () => place(30, 31, 1.06, 14, roller(true)),
  riot_charge: () => place(13, 53, 1.0, 0, riotWedge(30)),
  riot_blast: () => place(11, 55, 1.0, 0, riotWedge(45)),
  riot_bomb: () => place(29, 30, 0.82, 0, riotBomb(false)),
  heavy_riot_bomb: () => place(29, 30, 0.9, 0, riotBomb(true)),
  baby_digger: () => place(30, 33, 0.66, -20, drill),
  digger: () => place(30, 32, 0.82, -20, drill),
  heavy_digger: () => place(29, 31, 1.04, -20, drill),
  baby_sandhog: () => place(30, 36, 0.68, 0, sandhog),
  sandhog: () => place(30, 34, 0.82, 0, sandhog),
  heavy_sandhog: () => place(30, 33, 1.06, 0, sandhog),
  dirt_clod: () => place(29, 32, 1, 0, dirtLump(11, 7, 0.3, 8)) + C(48, 18, 2.2, '#94633A', 1.4) + C(12, 50, 1.8, '#94633A', 1.2),
  dirt_ball: () => place(29, 31, 1, 0, dirtLump(18, 3, 0.07, 10)),
  ton_of_dirt: () => L('M8,4 V12 M16,2 V9 M44,2 V9 M52,4 V12', '#C9D1DE', 1.8, 'opacity="0.85"') + place(30, 35, 1, 0, dirtLump(26, 21, 0.09, 12, 0.88)),
  liquid_dirt: () => {
    let s = E(34, 56, 23, 5, 'url(#mud)', S);
    s += HL('M20,54.5 Q28,52.5 36,53', 1.6, 0.55);
    s += P('M29,5 C29,5 46,25 46,37 C46,46 38.5,52 29,52 C19.5,52 12,46 12,37 C12,25 29,5 29,5 Z', 'url(#mud)', S);
    s += HL('M19,35 Q19,26 25,19', 2.4, 0.8) + C(21, 41, 1.6, '#FFFFFF', 0, 'opacity="0.7"');
    s += P('M52,18 C52,18 57,24 57,27.5 A5,5 0 0 1 47,27.5 C47,24 52,18 52,18 Z', 'url(#mud)', 1.8);
    return s;
  },
  dirt_charge: () => {
    const cx = 32, cy = 55, Rr = 36, a1 = -146, a2 = -34, n = 5;
    let d = `M${cx},${cy} L${pt(cx, cy, Rr, a1)} `;
    for (let i = 0; i < n; i++) { const b = pt(cx, cy, Rr, a1 + ((a2 - a1) * (i + 1)) / n); d += `A6,6 0 0 1 ${b} `; }
    d += 'Z';
    let s = P(d, 'url(#dirt)', S);
    s += dirtSpecks(32, 34, 14, 4) + dirtSpecks(32, 26, 12, 9);
    s += P(blob(14, 12, 3.2, 41, 0.3, 5), 'url(#dirt)', 1.5) + P(blob(50, 12, 3.6, 42, 0.3, 5), 'url(#dirt)', 1.5) + P(blob(32, 6, 2.8, 43, 0.3, 5), 'url(#dirt)', 1.5);
    s += P('M23,56 A9,9 0 0 1 41,56 Z', 'url(#steel)', S) + R(19, 55, 26, 6, 3, '#2A3142', S);
    return s;
  },
  earth_disrupter: () => {
    let s = P('M2,62 V55 Q12,50 22,54 Q32,49 42,54 Q52,50 62,55 V62 Z', 'url(#dirt)', S);
    for (const [x, y, r, sd] of [[12, 12, 7, 51], [32, 9, 6, 52], [51, 14, 7.5, 53]]) {
      s += P(blob(x, y, r, sd, 0.22, 7), 'url(#dirt)', S * 0.9);
      s += L(`M${x},${y + r + 4} V${y + r + 17}`, O, 6.6) + L(`M${x},${y + r + 4} V${y + r + 17}`, '#FFFFFF', 3);
      s += head(x, y + r + 17, 90, 7.5, '#FFFFFF', 1.6);
    }
    return s;
  },
  plasma_blast: () => {
    let s = C(31, 31, 30, 'url(#glowCyan)', 0);
    const zig = ['M31,4 L28,9 L33,11 L30,15', 'M58,31 L53,28 L51,33 L47,30', 'M31,58 L34,53 L29,51 L32,47', 'M4,31 L9,34 L11,29 L15,32'];
    for (const z of zig) s += OL(z, '#E0FDFF', 1.8);
    s += C(31, 31, 15.5, 'url(#plasma)', S);
    s += E(26, 25, 4.5, 2.6, '#FFFFFF', 0, 'opacity="0.75" transform="rotate(-35 26 25)"');
    for (const a of [-30, 150]) { const [x, y] = pt(31, 31, 21, a); s += C(x, y, 2.4, '#E0FDFF', 1.4); }
    return s;
  },
  laser: () => {
    let s = '';
    s += L('M24,40 L58,18', '#FF3B5C', 12, 'opacity="0.3"');
    s += L('M24,40 L58,18', O, 8) + L('M24,40 L58,18', '#FF3B5C', 5.4) + L('M24,40 L58,18', '#FFF0F3', 2);
    s += P(star(58, 18, 7.5, 2.6, 6, -60), '#FFF0F3', 1.6);
    s += R(4, 36, 18, 18, 4, 'url(#steel)', S) + R(2, 52, 22, 7, 3, '#2A3142', S);
    s += C(19, 42, 5.5, '#2A3142', S) + C(19, 42, 3, '#FF3B5C', 1.2) + C(18, 41, 1, '#FFFFFF', 0);
    s += HL('M8,40 V47', 1.6, 0.7);
    return s;
  },
  heat_guidance: () => {
    let s = C(32, 33, 14, 'url(#heat)', S);
    s += OL('M32,6 A27,27 0 0 1 59,33', '#FFFFFF', 2.4) + OL('M59,33 A27,27 0 0 1 32,60', '#FFFFFF', 2.4) + OL('M32,60 A27,27 0 0 1 5,33', '#FFFFFF', 2.4) + OL('M5,33 A27,27 0 0 1 32,6', '#FFFFFF', 2.4);
    s += OL('M32,2 V14 M32,52 V63 M1,33 H13 M51,33 H63', '#FF6A3D', 3);
    s += L('M27,30 q-2.5,-4 0,-8 M32,28 q-2.5,-4 0,-8 M37,30 q-2.5,-4 0,-8', '#FFFBE0', 1.8, 'opacity="0.95"');
    return s;
  },
  ballistic_guidance: () => {
    let s = target(48, 49, 11);
    const d = 'M7,56 Q20,2 41,38';
    s += arrowLine(d, '#FFD21F');
    s += head(41, 38, Math.atan2(38 - 2, 41 - 20) * 180 / Math.PI, 10, '#FFD21F', 1.8);
    s += P('M2,60 Q2,53 8,53 Q14,53 14,60 Z', 'url(#steel)', 1.8);
    return s;
  },
  horz_guidance: () => {
    let s = target(52, 32, 10);
    s += L('M2,32 H62', '#36F5C0', 1.4, 'stroke-dasharray="2 3" opacity="0.7"');
    s += arrowLine('M6,58 Q6,32 20,32 H36', '#36F5C0');
    s += head(36, 32, 0, 10, '#36F5C0', 1.8);
    return s;
  },
  vert_guidance: () => {
    let s = target(43, 51, 10);
    s += L('M43,4 V62', '#5AC8FA', 1.4, 'stroke-dasharray="2 3" opacity="0.7"');
    s += arrowLine('M5,52 Q5,12 26,12 Q43,12 43,24 V31', '#5AC8FA');
    s += head(43, 31, 90, 10, '#5AC8FA', 1.8);
    return s;
  },
  lazy_boy: () => {
    let s = E(32, 54, 21, 7.5, '#FF4B3E', S) + E(32, 54, 13.5, 4.8, '#FFFFFF', 1.5) + E(32, 54, 6.5, 2.4, '#FF4B3E', 1.5);
    s += P('M32,53 C25,41 17,33 17,22 A15,15 0 0 1 47,22 C47,33 39,41 32,53 Z', 'url(#pink)', S);
    s += C(32, 22, 6, '#FFFFFF', 1.8) + C(32, 22, 2.4, '#9A1C73', 0);
    s += HL('M21,17 Q23,11 28,9', 1.8, 0.8);
    return s;
  },
  parachute: () => {
    let s = '';
    s += L('M8,27 L28,46 M20,29 L30,45 M32,29 V44 M44,29 L34,45 M56,27 L36,46', '#C9D1DE', 1.4);
    s += P('M8,28 A24,21 0 0 1 56,28 Q50,24 44,29 Q38,24 32,29 Q26,24 20,29 Q14,24 8,28 Z', 'url(#canopy)', S);
    s += P('M32,7 Q25,14 26,26.5 Q29,25.5 32,29 Q35,25.5 38,26.5 Q39,14 32,7 Z', '#FFF3E0', 1.4);
    s += HL('M14,20 Q19,12 27,9', 1.6, 0.7);
    s += place(32, 51, 0.62, 0, miniTank);
    return s;
  },
  battery: () => {
    let s = R(26, 6, 12, 7, 2, 'url(#steel)', S);
    s += R(16, 11, 32, 48, 6, 'url(#dark)', S);
    s += R(20, 28, 24, 27, 3, 'url(#green)', 1.4);
    s += P('M36,14 L23,36 H31 L27,53 L42,29 H34 L38,14 Z', '#FFD21F', 1.8);
    s += HL('M20,16 V24', 1.8, 0.5);
    return s;
  },
  mag_deflector: () => {
    let s = '';
    s += L('M10,16 Q32,-8 54,16', '#7FD4FF', 1.8, 'stroke-dasharray="3 3"') + L('M20,16 Q32,4 44,16', '#7FD4FF', 1.8, 'stroke-dasharray="3 3"');
    s += arrowLine('M32,34 V16', '#FFFFFF', 3.6) + head(32, 16, -90, 8.5, '#FFFFFF', 1.6);
    const u = 'M18,27 V42 A14,14 0 0 0 46,42 V27';
    s += L(u, O, 16) + L(u, 'url(#red)', 11);
    s += R(10.5, 19, 15, 10, 1.5, 'url(#steel)', S) + R(38.5, 19, 15, 10, 1.5, 'url(#steel)', S);
    s += HL('M14.5,40 Q15,49 20,53', 1.6, 0.6);
    return s;
  },
  shield: () => {
    let s = C(32, 34, 25, SH.shield.core, 0, 'opacity="0.38"');
    s += place(32, 44, 0.8, 0, miniTank);
    s += C(32, 34, 25, 'none', S * 2.4) + C(32, 34, 25, 'none', 0, `stroke="${SH.shield.rim}" stroke-width="2.6"`);
    s += L('M13,27 A20,20 0 0 1 25,14', '#FFFFFF', 3.4, 'opacity="0.95"') + C(31, 12.5, 1.8, '#FFFFFF', 0);
    return s;
  },
  force_shield: () => {
    CLIPS.fcl = '<clipPath id="fcl"><circle cx="32" cy="34" r="24"/></clipPath>';
    let hex = '';
    const hr = 6.2, w = hr * Math.sqrt(3);
    for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
      const cx = 32 + col * w + (row % 2 ? w / 2 : 0), cy = 34 + row * hr * 1.5;
      let d = ''; for (let i = 0; i < 6; i++) { const [x, y] = pt(cx, cy, hr, 30 + i * 60); d += (i ? 'L' : 'M') + x + ',' + y; }
      hex += `<path d="${d}Z" fill="none" stroke="${SH.force.core}" stroke-width="1.5"/>`;
    }
    let s = C(32, 34, 24, SH.force.core, 0, 'opacity="0.2"') + `<g clip-path="url(#fcl)">${hex}</g>`;
    s += place(32, 44, 0.8, 0, miniTank);
    s += C(32, 34, 24, 'none', S * 2.2) + C(32, 34, 24, 'none', 0, `stroke="${SH.force.rim}" stroke-width="2.4"`);
    for (const [x, y, sx, sy] of [[4, 6, 1, 1], [60, 6, -1, 1], [4, 62, 1, -1], [60, 62, -1, -1]]) s += OL(`M${x},${y + sy * 9} V${y} H${x + sx * 9}`, SH.force.core, 2.6);
    return s;
  },
  heavy_shield: () => {
    let s = C(32, 34, 23, SH.heavy.core, 0, 'opacity="0.14"');
    s += place(32, 44, 0.8, 0, miniTank);
    s += C(32, 34, 23, 'none', 0, `stroke="${O}" stroke-width="12"`) + C(32, 34, 23, 'none', 0, `stroke="${SH.heavy.core}" stroke-width="7.4"`);
    s += C(32, 34, 21, 'none', 0, `stroke="${SH.heavy.rim}" stroke-width="1.6" opacity="0.9"`);
    for (let i = 0; i < 8; i++) { const a = 22.5 + i * 45; const [x1, y1] = pt(32, 34, 19.2, a), [x2, y2] = pt(32, 34, 26.8, a); s += L(`M${x1},${y1} L${x2},${y2}`, SH.heavy.seam, 2.2); }
    for (let i = 0; i < 8; i++) { const [x, y] = pt(32, 34, 23, i * 45); s += C(x, y, 1.3, SH.heavy.rim, 0.9); }
    s += C(32, 34, 15.5, 'none', 0, `stroke="${O}" stroke-width="5"`) + C(32, 34, 15.5, 'none', 0, `stroke="${SH.heavy.core}" stroke-width="2"`);
    return s;
  },
  super_mag: () => {
    let s = C(32, 34, 27, 'none', 0, `stroke="${O}" stroke-width="4.6"`) + C(32, 34, 27, 'none', 0, `stroke="${SH.supermag.rim}" stroke-width="2" stroke-dasharray="3.2 3"`);
    s += place(32, 44, 0.7, 0, miniTank);
    for (const a of [0, 60, 120]) s += G(E(0, 0, 23, 8.5, 'none', 0, `stroke="${O}" stroke-width="5.6"`) + E(0, 0, 23, 8.5, 'none', 0, `stroke="${SH.supermag.core}" stroke-width="2.6"`), `translate(32 34) rotate(${a})`);
    for (const a of [0, 60, 120]) { const [x, y] = pt(32, 34, 23, a); s += C(x, y, 3, SH.supermag.accent, 1.5); }
    s += C(32, 34, 3.4, '#FFFFFF', 1.5);
    return s;
  },
  auto_defense: () => {
    let s = '';
    const ring = (a1, a2) => { const [x1, y1] = pt(32, 33, 27, a1), [x2, y2] = pt(32, 33, 27, a2); return `M${x1},${y1} A27,27 0 0 1 ${x2},${y2}`; };
    s += OL(ring(200, 320), '#3BD16F', 3) + OL(ring(20, 140), '#3BD16F', 3);
    { const [x, y] = pt(32, 33, 27, 320); s += head(x, y, 320 + 90, 8, '#3BD16F', 1.6); }
    { const [x, y] = pt(32, 33, 27, 140); s += head(x, y, 140 + 90, 8, '#3BD16F', 1.6); }
    s += P('M32,12 L48,18 V32 C48,43 41,50 32,55 C23,50 16,43 16,32 V18 Z', 'url(#blue)', S);
    s += OL('M27.5,27 A8,8 0 1 0 36.5,27', '#FFFFFF', 2.6) + OL('M32,21 V31', '#FFFFFF', 2.6);
    s += HL('M20,21 V31', 1.6, 0.5);
    return s;
  },
  fuel_tank: () => {
    let s = P('M15,19 H39 L48,28 V54 Q48,59 43,59 H20 Q15,59 15,54 Z', 'url(#red)', S);
    s += P('M41,14 L47,8 L53,14 L47,20 Z', 'url(#steel)', 1.8);
    s += R(17, 9, 19, 9, 3.5, 'url(#dark)', S) + R(21, 12, 4, 3.4, 1.2, O, 0) + R(28, 12, 4, 3.4, 1.2, O, 0);
    s += L('M22,28 L41,52 M41,28 L22,52', '#7A1414', 3.4) + L('M22,28 L41,52 M41,28 L22,52', '#FF8A7A', 1.2, 'opacity="0.7"');
    s += HL('M19,24 V44', 1.8, 0.6);
    return s;
  },
  contact_trigger: () => {
    let s = '';
    s += OL('M52,50 Q61,50 61,40 Q61,32 55,30', '#FFD21F', 1.8);
    s += P(star(50, 14, 10, 4, 8, -90), '#FFD21F', 1.6) + P(star(50, 14, 5, 2.2, 8, -67.5), '#FFFBE0', 0);
    s += L('M14,18 L19,22 M10,28 H16 M38,10 L36,16', '#FFD21F', 2, 'opacity="0.95"');
    s += R(8, 42, 44, 16, 4, 'url(#dark)', S);
    s += R(20, 33, 20, 10, 2, 'url(#steel)', S);
    s += P('M18,35 Q18,20 30,20 Q42,20 42,35 Z', 'url(#red)', S);
    s += HL('M23,29 Q24,24 29,23', 1.8, 0.8);
    s += C(14, 50, 1.6, N.hub, 0.9) + C(46, 50, 1.6, N.hub, 0.9);
    return s;
  },
};

// series / tier info (rank inside series, shown as tier bars)
const SERIES = {
  missile: ['baby_missile', 'missile'],
  nuke: ['baby_nuke', 'nuke'],
  napalm: ['napalm', 'hot_napalm'],
  roller: ['baby_roller', 'roller', 'heavy_roller'],
  riot_charge: ['riot_charge', 'riot_blast'],
  riot_bomb: ['riot_bomb', 'heavy_riot_bomb'],
  digger: ['baby_digger', 'digger', 'heavy_digger'],
  sandhog: ['baby_sandhog', 'sandhog', 'heavy_sandhog'],
  dirt: ['dirt_clod', 'dirt_ball', 'ton_of_dirt'],
};
const SERIES_OF = {};
for (const [k, arr] of Object.entries(SERIES)) arr.forEach((id, i) => (SERIES_OF[id] = { series: k, tier: i + 1, of: arr.length }));

const MOTIF = {
  baby_missile: '작은 미사일(미사일 계열 1/2)', missile: '미사일(1/2보다 큼)', baby_nuke: '방사능 마크 폭탄(소)', nuke: '방사능 마크 폭탄(대)+주황 섬광',
  leap_frog: '초록 탄두 3개가 점선으로 도약', funky_bomb: '4색 구형 폭탄+색 방울', mirv: '모선 1+분리 탄두 5', deaths_head: '해골+교차 뼈+붉은 섬광',
  napalm: '주황 불꽃', hot_napalm: '분홍·흰 고온 불꽃(대)+붉은 섬광', tracer: '흰 점선 궤적+빛나는 탄', smoke_tracer: '무지개 연기 궤적',
  baby_roller: '바퀴 달린 탄(소)', roller: '바퀴 달린 탄(중)', heavy_roller: '바퀴 달린 탄(대, 짙은 장갑)',
  riot_charge: '포탑에서 쐐기형 충격파(소)', riot_blast: '쐐기형 충격파(대)', riot_bomb: '구멍 뚫린 별형 충격파', heavy_riot_bomb: '별형 충격파 2겹(대)',
  baby_digger: '아래로 향한 드릴(소)', digger: '드릴(중)', heavy_digger: '드릴(대)',
  baby_sandhog: '흙더미에서 위로 나오는 드릴 코 두더지(소)', sandhog: '두더지(중)', heavy_sandhog: '두더지(대)',
  dirt_clod: '울퉁불퉁 작은 흙덩이', dirt_ball: '둥근 흙공', ton_of_dirt: '거대 흙덩이+낙하선', liquid_dirt: '윤기 나는 흙 방울+웅덩이',
  dirt_charge: '위로 뿜는 쐐기형 흙구름', earth_disrupter: '공중 흙덩이 3개+아래 화살표',
  plasma_blast: '하늘색 에너지 구+전기 아크', laser: '발사기+붉은 직선 빔',
  heat_guidance: '조준경+열원(주황)', ballistic_guidance: '노란 포물선 화살표→과녁', horz_guidance: '민트 수평 화살표→과녁', vert_guidance: '하늘색 수직 낙하 화살표→과녁', lazy_boy: '분홍 위치 핀이 과녁에 꽂힘',
  parachute: '주황 낙하산+미니 탱크', battery: '전지+번개', mag_deflector: '말굽 자석+위로 밀어내는 화살표',
  shield: '하늘색 거품 돔', force_shield: '민트 육각 격자 돔+모서리 꺾쇠', heavy_shield: '호박색 두꺼운 장갑 링+이음매', super_mag: '보라 자기장 궤도 3개+점선 외곽',
  auto_defense: '방패 문장+전원 기호+순환 화살표', fuel_tank: '붉은 연료통', contact_trigger: '붉은 누름 버튼+불꽃',
};

// ---------------------------------------------------------------- write svgs
const out = [];
for (const it of items) {
  const fn = ICON[it.id];
  if (!fn) throw new Error('no icon for ' + it.id);
  for (const k of Object.keys(CLIPS)) delete CLIPS[k];
  let body = fn();
  const si = SERIES_OF[it.id];
  if (si) body += tier(si.tier, si.of);
  const defs = defsFor(body);
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
  writeFileSync(join(ITEMS_DIR, `${it.id}.svg`), svgStr);
  const cat = CAT_BY_LABEL[it.category];
  if (!cat) throw new Error('unknown category ' + it.category);
  out.push({ it, cat, si, bytes: Buffer.byteLength(svgStr) });
}
const missing = Object.keys(ICON).filter(id => !items.find(i => i.id === id));
if (missing.length) throw new Error('icons without item: ' + missing);

// ---------------------------------------------------------------- categories.json
const categories = {
  version: 1,
  note: '아이템 분류 강조색. accent=어두운 카드(#161B27) 위, onLight=밝은 배경(#F4F6FA) 위 글자·테두리용. 색만으로 구분하지 않도록 glyph(분류 기호)와 이름을 함께 표시.',
  cardDark: CARD_DARK, cardLight: CARD_LIGHT,
  categories: CATEGORIES.map(c => ({
    ...c,
    contrastOnDark: contrast(c.accent, CARD_DARK),
    contrastOnLight: contrast(c.onLight, CARD_LIGHT),
    items: items.filter(i => i.category === c.label).map(i => i.id),
  })),
};
writeFileSync(join(ITEMS_DIR, 'categories.json'), JSON.stringify(categories, null, 2));

// ---------------------------------------------------------------- preview.html
const previewData = {
  categories: categories.categories,
  items: out.map(({ it, cat, si }) => ({ id: it.id, name_ko: it.name_ko, name_en: it.name_en, short: it.short, cat: cat.key, tier: si ? `${si.tier}/${si.of}` : '' })),
  groups: [
    ['미사일·핵', ['baby_missile', 'missile', 'baby_nuke', 'nuke']],
    ['롤러', SERIES.roller], ['디거', SERIES.digger], ['샌드호그', SERIES.sandhog], ['흙덩이', SERIES.dirt],
    ['라이엇', ['riot_charge', 'riot_blast', 'riot_bomb', 'heavy_riot_bomb', 'dirt_charge']],
    ['실드 4종+자석', ['shield', 'force_shield', 'heavy_shield', 'super_mag', 'mag_deflector', 'auto_defense']],
    ['가이던스 5종', ['heat_guidance', 'ballistic_guidance', 'horz_guidance', 'vert_guidance', 'lazy_boy']],
    ['궤적·분열', ['tracer', 'smoke_tracer', 'leap_frog', 'mirv', 'deaths_head', 'funky_bomb']],
    ['불·에너지', ['napalm', 'hot_napalm', 'plasma_blast', 'laser']],
  ],
};
const tpl = readFileSync(join(HERE, 'preview_template.html'), 'utf8');
writeFileSync(join(ITEMS_DIR, 'preview.html'), tpl.replace('/*__DATA__*/null', JSON.stringify(previewData)));

// ---------------------------------------------------------------- manifest.json (idempotent: replace item_* entries)
const manPath = join(ASSETS, 'manifest.json');
const man = JSON.parse(readFileSync(manPath, 'utf8'));
man.assets = man.assets.filter(a => !(a.key.startsWith('item_') || a.key === 'data.itemCategories' || a.key === 'preview.items'));
const GEN = 'assets/items/_src/build.mjs (hand-written SVG, no image API)';
for (const { it, cat, si, bytes } of out) {
  man.assets.push({
    key: `item_${it.id}`, path: `items/${it.id}.svg`, type: 'svg', size: [64, 64], viewBox: '0 0 64 64',
    displaySizes: [32, 48, 64], alpha: true, recolor: false,
    itemId: it.id, name_ko: it.name_ko, category: it.category, categoryKey: cat.key, accent: cat.accent,
    ...(si ? { series: si.series, tier: si.tier, tierOf: si.of } : {}),
    motif: MOTIF[it.id], usage: '상점·인벤토리·무기 선택 시트·HUD 퀵바 아이콘', bytes,
    generator: GEN, qa: 'pass', verify: false, license: '프로젝트 자체 제작(원본 게임 에셋 미사용)',
  });
}
man.assets.push({ key: 'data.itemCategories', path: 'items/categories.json', type: 'json', usage: '아이템 분류 7종 강조색·대비·분류 기호', generator: GEN });
man.assets.push({ key: 'preview.items', path: 'items/preview.html', type: 'html', usage: '아이템 아이콘 자체 QA 미리보기(빌드 산출물)', generator: GEN });
man.rebuildItems = 'node assets/items/_src/build.mjs';
const crlf = readFileSync(manPath, 'utf8').includes('\r\n');
const manStr = JSON.stringify(man, null, 2);
writeFileSync(manPath, crlf ? manStr.replace(/\n/g, '\r\n') : manStr);

console.log(`icons ${out.length}, total ${out.reduce((a, b) => a + b.bytes, 0)} bytes`);
for (const c of categories.categories) console.log(c.key, c.accent, 'dark', c.contrastOnDark, 'light', c.contrastOnLight, c.items.length);
