// Generates tank SVG layers, shield/turn fx, player markers, palette.json, preview.html.
// Run: node assets/tanks/_src/build.mjs   (no dependencies)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS, OUTLINE, NEUTRAL, WRECK, PLAYERS, SKIES, WALLS, SHIELDS, UI, shades } from './palette.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TANKS = join(HERE, '..');
const ASSETS = join(TANKS, '..');
const FX = join(ASSETS, 'fx');
mkdirSync(FX, { recursive: true });

const O = OUTLINE, SW = 2;
const N = NEUTRAL;
const VB_W = 48, VB_H = 40; // 4 units = 1 game px. ground contact y=40, center x=24.

const svg = (body, defs = '', w = VB_W, h = VB_H, vb = `0 0 ${w} ${h}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">` +
  (defs ? `<defs>${defs}</defs>` : '') + body + `</svg>`;

const gradDefs = () =>
  `<linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TOKENS.PL}"/><stop offset="0.38" stop-color="${TOKENS.P}"/><stop offset="1" stop-color="${TOKENS.PD}"/></linearGradient>` +
  `<linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TOKENS.P}"/><stop offset="1" stop-color="${TOKENS.PD}"/></linearGradient>` +
  `<linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${N.steelLight}"/><stop offset="0.45" stop-color="${N.steel}"/><stop offset="1" stop-color="${N.steelDark}"/></linearGradient>` +
  `<linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${N.concrete}"/><stop offset="1" stop-color="${N.concreteDark}"/></linearGradient>`;

const st = `stroke="${O}" stroke-width="${SW}" stroke-linejoin="round"`;

function treads(x0, x1, y0, y1, wheels) {
  const h = y1 - y0, r = h / 2;
  let s = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${h}" rx="${r}" fill="${N.tread}" ${st}/>`;
  s += `<path d="M${x0 + r} ${y0 + 1.4} H${x1 - r}" stroke="${N.treadLight}" stroke-width="1.2" stroke-linecap="round"/>`;
  const wr = r - 1.7, step = (x1 - x0 - 2 * r) / (wheels - 1);
  for (let i = 0; i < wheels; i++) {
    const cx = +(x0 + r + i * step).toFixed(2), cy = y0 + r;
    s += `<circle cx="${cx}" cy="${cy}" r="${wr}" fill="${N.wheel}" stroke="${N.hub}" stroke-width="0.9"/><circle cx="${cx}" cy="${cy}" r="0.9" fill="${N.hub}"/>`;
  }
  return s;
}

function barrel(px, py, len, w, { band = true, brake = false } = {}) {
  let s = `<rect x="${px}" y="${py - w / 2}" width="${len}" height="${w}" rx="${Math.min(1, w / 2)}" fill="url(#gs)" ${st}/>`;
  const mw = brake ? w + 2.4 : w + 1.2, ml = brake ? 4 : 2.6;
  s += `<rect x="${px + len - ml}" y="${py - mw / 2}" width="${ml}" height="${mw}" rx="0.6" fill="${N.steelDark}" ${st}/>`;
  if (band) s += `<rect x="${px + len * 0.42}" y="${py - w / 2}" width="2.4" height="${w}" fill="${TOKENS.P}"/>`;
  return s;
}

const spec = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#FFFFFF" opacity="0.45"/>`;

// type definitions: hull (incl. treads), turret (static), barrel (rotates about pivot; drawn at angle 0 = +x).
const T = {
  classic: {
    label: '표준형', mobile: true, cpuOnly: false, pivot: [24, 21], barrelLen: 17,
    hull: () => treads(6, 42, 32, 40, 5) +
      `<path d="M7 32 L41 32 L37 25.5 L11 25.5 Z" fill="url(#gp)" ${st}/>` +
      `<path d="M12.2 27 H35.8" stroke="${TOKENS.PL}" stroke-width="1.1" stroke-linecap="round"/>`,
    turret: () => `<path d="M14 25.5 A10 10 0 0 1 34 25.5 Z" fill="url(#gp)" ${st}/>` + spec(19.8, 19.6, 3, 1.5),
    barrel: () => barrel(24, 21, 17, 3.2),
  },
  wedge: {
    label: '쐐기형', mobile: true, cpuOnly: false, pivot: [24, 24], barrelLen: 18,
    hull: () => treads(4, 44, 33.5, 40, 6) +
      `<path d="M4 33.5 L44 33.5 L41 29 L33 26.5 L15 26.5 L7 29 Z" fill="url(#gp)" ${st}/>` +
      `<path d="M8.5 29.6 L15.4 27.6 H32.6 L39.5 29.6" fill="none" stroke="${TOKENS.PL}" stroke-width="1" stroke-linecap="round"/>`,
    turret: () => `<path d="M30 21.5 L33.5 14" stroke="${O}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<path d="M15 26.5 L33 26.5 L30 21.5 L18 21.5 Z" fill="url(#gp)" ${st}/>` + spec(21, 22.8, 2.6, 0.8),
    barrel: () => barrel(24, 24, 18, 2.6),
  },
  heavy: {
    label: '중전차', mobile: true, cpuOnly: false, pivot: [24, 18], barrelLen: 18,
    hull: () => treads(3, 45, 31, 40, 6) +
      `<rect x="8" y="21.5" width="32" height="7" rx="1" fill="url(#gp)" ${st}/>` +
      `<rect x="2.5" y="27.5" width="43" height="6" rx="1.5" fill="url(#gd)" ${st}/>` +
      [7, 13.5, 20, 28, 34.5, 41].map(x => `<circle cx="${x}" cy="30.5" r="0.85" fill="${TOKENS.PL}"/>`).join(''),
    turret: () => `<rect x="16" y="11" width="6" height="3.5" rx="1" fill="url(#gd)" ${st}/>` +
      `<rect x="13.5" y="13.5" width="21" height="9" rx="2.5" fill="url(#gp)" ${st}/>` + spec(19, 15.6, 3, 0.9),
    barrel: () => barrel(24, 18, 18, 4.2, { brake: true }),
  },
  wheeled: {
    label: '장륜형', mobile: true, cpuOnly: false, pivot: [24, 22.5], barrelLen: 16,
    hull: () => `<path d="M4.5 32.5 L43.5 32.5 L41 25.5 L7 25.5 Z" fill="url(#gp)" ${st}/>` +
      `<path d="M8 27 H40" stroke="${TOKENS.PL}" stroke-width="1" stroke-linecap="round"/>` +
      [11, 24, 37].map(cx => `<circle cx="${cx}" cy="35.4" r="4.6" fill="${N.wheel}" ${st}/><circle cx="${cx}" cy="35.4" r="3.1" fill="none" stroke="${N.treadLight}" stroke-width="1"/><circle cx="${cx}" cy="35.4" r="1.5" fill="${N.hub}"/>`).join(''),
    turret: () => `<rect x="17.5" y="20" width="13" height="6" rx="2" fill="url(#gp)" ${st}/>` + spec(21.5, 21.6, 2.2, 0.7),
    barrel: () => barrel(24, 22.5, 16, 2.4),
  },
  scout: {
    label: '정찰형', mobile: true, cpuOnly: false, pivot: [24, 16], barrelLen: 15,
    hull: () => treads(9, 39, 32.5, 40, 4) +
      `<path d="M10 32.5 L38 32.5 L35 27.5 L13 27.5 Z" fill="url(#gp)" ${st}/>` +
      `<rect x="21.5" y="19" width="5" height="9" fill="url(#gd)" ${st}/>`,
    turret: () => `<circle cx="24" cy="16" r="5.6" fill="url(#gp)" ${st}/>` + spec(22.2, 13.9, 1.8, 1),
    barrel: () => barrel(24, 16, 15, 2.4),
  },
  fixed: {
    label: '고정 포대', mobile: false, cpuOnly: false, pivot: [24, 25], barrelLen: 17,
    hull: () => `<path d="M1 40 L47 40 L42 31.5 L6 31.5 Z" fill="url(#gc)" ${st}/>` +
      `<rect x="9" y="34" width="30" height="3" fill="${TOKENS.P}" stroke="${O}" stroke-width="1"/>` +
      [12, 17, 22, 27, 32, 37].map(x => `<path d="M${x} 37 L${x + 2} 34" stroke="${O}" stroke-width="1.1"/>`).join('') +
      `<circle cx="5" cy="38" r="1" fill="${O}"/><circle cx="43" cy="38" r="1" fill="${O}"/>`,
    turret: () => `<path d="M12 31.5 A12 12 0 0 1 36 31.5 Z" fill="url(#gp)" ${st}/>` +
      `<path d="M15.5 31.5 A8.5 8.5 0 0 1 32.5 31.5" fill="none" stroke="${TOKENS.PD}" stroke-width="1"/>` + spec(18.6, 24.4, 3, 1.4),
    barrel: () => barrel(24, 25, 17, 3.4),
  },
  triple: {
    label: '삼연장', mobile: true, cpuOnly: true, pivot: [24, 18.5], barrelLen: 19,
    hull: () => treads(2, 46, 31, 40, 6) +
      `<rect x="6" y="20.5" width="3" height="4" fill="${N.steelDark}" ${st}/><rect x="39" y="20.5" width="3" height="4" fill="${N.steelDark}" ${st}/>` +
      `<path d="M2.5 31 L45.5 31 L41.5 23.5 L6.5 23.5 Z" fill="url(#gp)" ${st}/>` +
      `<path d="M7.5 25 H40.5" stroke="${TOKENS.PL}" stroke-width="1.1" stroke-linecap="round"/>`,
    turret: () => `<rect x="12" y="13" width="24" height="10.5" rx="5" fill="url(#gp)" ${st}/>` +
      `<circle cx="17" cy="18.2" r="1.7" fill="${N.lens}" stroke="${O}" stroke-width="1"/>` + spec(21, 15, 4, 1),
    barrel: () => barrel(24, 15.3, 17, 2.2, { band: false }) + barrel(24, 21.7, 17, 2.2, { band: false }) + barrel(24, 18.5, 19, 2.4),
  },
};

const KO = {
  classic: ['표준형', '반구 돔 포탑 · 외형만 다름, 성능 동일'],
  wedge:   ['쐐기형', '낮은 차체·납작 포탑·안테나 · 외형만 다름, 성능 동일'],
  heavy:   ['중전차', '사각 포탑·측면 장갑판·굵은 포신 · 외형만 다름, 성능 동일'],
  wheeled: ['장륜형', '큰 바퀴 3개 · 외형만 다름, 성능 동일'],
  scout:   ['정찰형', '기둥 위 구형 포탑 · 외형만 다름, 성능 동일'],
  fixed:   ['고정 포대', '바퀴·트레드 없음 · 연료 구매·이동 불가, 낙하만 함'],
  triple:  ['트리플 터렛', '포신 3개 · 미사일/베이비 미사일 3연발 (원본 등록판)'],
};
function recolor(s, map) {
  for (const [from, to] of Object.entries(map)) s = s.split(from).join(to);
  return s;
}
const wreckMap = {
  [TOKENS.PL]: WRECK.PL, [TOKENS.PD]: WRECK.PD, [TOKENS.P]: WRECK.P,
  [N.steelLight]: WRECK.steelLight, [N.steelDark]: WRECK.steelDark, [N.steel]: WRECK.steel,
  [N.treadLight]: WRECK.treadLight, [N.tread]: WRECK.tread, [N.wheel]: WRECK.wheel, [N.hub]: WRECK.hub,
  [N.lens]: WRECK.steelDark, [N.concreteDark]: '#2E3136', [N.concrete]: '#4A4E55', '#FFFFFF': '#8A817A',
};

function wreck(id, t) {
  const [px, py] = t.pivot;
  const stub = barrel(px, py, Math.round(t.barrelLen * 0.4), 2.8, { band: false });
  const cracks = `<path d="M${px - 9} ${py + 7} l2.5 -2 l1.5 2.2 l2.6 -2.6" fill="none" stroke="${WRECK.ember}" stroke-width="1" stroke-linecap="round"/>` +
    `<path d="M${px + 4} ${py + 8} l2 -1.6 l2 1.8" fill="none" stroke="${WRECK.ember}" stroke-width="0.9" stroke-linecap="round"/>`;
  const embers = [[px - 4, py - 1, 0.9], [px + 7, py + 3, 0.7], [px - 11, py + 4, 0.6]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${WRECK.emberHot}"/>`).join('');
  const body = recolor(t.hull(), wreckMap) +
    `<g transform="rotate(32 ${px} ${py})">${recolor(stub, wreckMap)}</g>` +
    `<g transform="rotate(-9 ${px} ${py + 6})">${recolor(t.turret(), wreckMap)}</g>` + cracks + embers;
  return svg(body, recolor(gradDefs(), wreckMap));
}

const files = {};
const put = (rel, content) => { files[rel] = content; writeFileSync(join(ASSETS, rel), content); };

const tankMeta = {};
for (const [id, t] of Object.entries(T)) {
  const defs = gradDefs();
  put(`tanks/tank_${id}_hull.svg`, svg(t.hull(), defs));
  put(`tanks/tank_${id}_turret.svg`, svg(t.turret(), defs));
  put(`tanks/tank_${id}_barrel.svg`, svg(t.barrel(), defs));
  put(`tanks/tank_${id}_wreck.svg`, wreck(id, t));
  // combined reference (layer groups, barrel at 45deg)
  put(`tanks/tank_${id}.svg`, svg(
    `<g id="hull">${t.hull()}</g><g id="barrel" transform="rotate(-45 ${t.pivot[0]} ${t.pivot[1]})">${t.barrel()}</g><g id="turret">${t.turret()}</g>`, defs));
  tankMeta[id] = { name_ko: KO[id][0], desc_ko: KO[id][1], can_move: t.mobile, cpu_only: t.cpuOnly,
    label: t.label, mobile: t.mobile, cpuOnly: t.cpuOnly, pivot: t.pivot, barrelLen: t.barrelLen,
    muzzle: id === 'triple' ? [[t.pivot[0] + 17, -3.2], [t.pivot[0] + 19, 0], [t.pivot[0] + 17, 3.2]] : [[t.pivot[0] + t.barrelLen, 0]] };
}

// ---- shields (viewBox centered, 1 unit = 1/4 game px, radius 26 => 6.5 px) ----
const R = 26;
function shieldSvg(id) {
  const c = SHIELDS[id];
  const g = `<radialGradient id="sg" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${c.core}" stop-opacity="0"/><stop offset="0.62" stop-color="${c.core}" stop-opacity="0.06"/>` +
    `<stop offset="0.93" stop-color="${c.core}" stop-opacity="0.42"/><stop offset="1" stop-color="${c.core}" stop-opacity="0.85"/></radialGradient>`;
  let b = `<circle r="${R}" fill="url(#sg)"/>`;
  let defs = g;
  if (id === 'shield') {
    b += `<circle r="${R - 0.7}" fill="none" stroke="${c.rim}" stroke-width="1.4" opacity="0.9"/>` +
      `<path d="M${-R * 0.62} ${-R * 0.55} A${R * 0.84} ${R * 0.84} 0 0 1 ${-R * 0.05} ${-R * 0.83}" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`;
  } else if (id === 'force') {
    defs += `<clipPath id="cl"><circle r="${R - 1}"/></clipPath>` +
      `<pattern id="hx" width="7" height="12.124" patternUnits="userSpaceOnUse"><path d="M0 0 L3.5 2.02 L3.5 6.06 L0 8.08 M3.5 2.02 L7 0 M3.5 6.06 L7 8.08 L7 12.124 M0 8.08 L0 12.124" fill="none" stroke="${c.rim}" stroke-width="0.6"/></pattern>`;
    b += `<circle r="${R}" fill="url(#hx)" clip-path="url(#cl)" opacity="0.35"/>` +
      `<circle r="${R - 0.8}" fill="none" stroke="${c.rim}" stroke-width="1.8"/>` +
      [45, 135, 225, 315].map(a => `<path transform="rotate(${a}) translate(${R + 3} 0)" d="M-1.6 -2.4 L1.2 0 L-1.6 2.4" fill="none" stroke="${c.core}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  } else if (id === 'heavy') {
    b += `<circle r="${R - 1.5}" fill="none" stroke="${c.core}" stroke-width="3"/>` +
      `<circle r="${R - 4.6}" fill="none" stroke="${c.rim}" stroke-width="1" opacity="0.85"/>` +
      Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45 + 22.5})" d="M${R - 3.2} 0 H${R + 0.2}" stroke="${c.seam}" stroke-width="1.2"/>`).join('') +
      `<path d="M${-R * 0.55} ${-R * 0.62} A${R * 0.82} ${R * 0.82} 0 0 1 0 ${-R * 0.82}" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>`;
  } else if (id === 'supermag') {
    b += [0, 60, 120].map(a => `<ellipse transform="rotate(${a})" rx="${R - 3}" ry="${(R - 3) * 0.36}" fill="none" stroke="${c.accent}" stroke-width="0.8" opacity="0.6"/>`).join('') +
      `<circle r="${R - 0.8}" fill="none" stroke="${c.rim}" stroke-width="1.4"/>` +
      `<circle r="${R + 2.4}" fill="none" stroke="${c.core}" stroke-width="1.2" stroke-dasharray="3.2 2.6"/>`;
  }
  const P = R + 6;
  return svg(b, defs, 2 * P, 2 * P, `${-P} ${-P} ${2 * P} ${2 * P}`);
}
for (const id of Object.keys(SHIELDS)) put(`fx/fx_shield_${id}.svg`, shieldSvg(id));

// ---- turn indicator: ground ring + chevron (token color) ----
put('fx/fx_turn_ring.svg', svg(
  `<ellipse rx="27" ry="5.5" fill="none" stroke="${O}" stroke-width="3.4"/><ellipse rx="27" ry="5.5" fill="none" stroke="${TOKENS.P}" stroke-width="2"/>` +
  `<ellipse rx="27" ry="5.5" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-dasharray="5 4"/>`, '', 60, 16, '-30 -8 60 16'));
put('fx/fx_turn_chevron.svg', svg(
  `<path d="M3 3 L12 12 L21 3" fill="none" stroke="${O}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M3 3 L12 12 L21 3" fill="none" stroke="${TOKENS.P}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`, '', 24, 16));
put('fx/fx_ready_check.svg', svg(
  `<circle cx="8" cy="8" r="7" fill="${UI.readyMark}" stroke="${O}" stroke-width="1.5"/><path d="M4.5 8.2 L7 10.6 L11.5 5.6" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`, '', 16, 16));

// ---- player markers (pre-colored, number + shape) ----
const poly = (n, r, rot = -90, cx = 12, cy = 12) => Array.from({ length: n }, (_, i) => {
  const a = (rot + i * 360 / n) * Math.PI / 180; return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`; }).join(' ');
const starPts = (n, r1, r2) => Array.from({ length: n * 2 }, (_, i) => {
  const r = i % 2 ? r2 : r1, a = (-90 + i * 180 / n) * Math.PI / 180; return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`; }).join(' ');
const SHAPES = {
  circle: f => `<circle cx="12" cy="12" r="9.5" ${f}/>`,
  square: f => `<rect x="3" y="3" width="18" height="18" rx="2" ${f}/>`,
  triangle: f => `<polygon points="12,1.5 23,21.5 1,21.5" ${f}/>`,
  diamond: f => `<polygon points="12,0.8 23.2,12 12,23.2 0.8,12" ${f}/>`,
  pentagon: f => `<polygon points="${poly(5, 11.2, -90, 12, 12.8)}" ${f}/>`,
  hexagon: f => `<polygon points="${poly(6, 11, 0)}" ${f}/>`,
  star: f => `<polygon points="${starPts(5, 11.8, 6)}" ${f}/>`,
  plus: f => `<path d="M8 1.5 H16 V8 H22.5 V16 H16 V22.5 H8 V16 H1.5 V8 H8 Z" ${f}/>`,
  invtri: f => `<polygon points="1,2.5 23,2.5 12,22.5" ${f}/>`,
  badge: f => `<path d="M2 2.5 H22 V11 C22 17 17.5 21 12 23 C6.5 21 2 17 2 11 Z" ${f}/>`,
};
const TEXT_Y = { triangle: 18.6, invtri: 12.4, pentagon: 16.6, badge: 15.4 };
for (const p of PLAYERS) {
  const f = `fill="${p.base}" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"`;
  const fs = p.n === 10 ? 10 : (p.marker === 'triangle' || p.marker === 'invtri' ? 10 : 12.5);
  put(`tanks/marker_${String(p.n).padStart(2, '0')}.svg`, svg(SHAPES[p.marker](f) +
    `<text x="12" y="${TEXT_Y[p.marker] ?? 15.8}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${fs}" fill="${p.ink}">${p.n}</text>`, '', 24, 24));
}

// ---- palette.json ----
const palette = {
  tokens: TOKENS, outline: OUTLINE, neutral: NEUTRAL, wreck: WRECK, walls: WALLS, shields: SHIELDS, ui: UI, skies: SKIES,
  players: PLAYERS.map(p => ({ ...p, ...shades(p.base) })),
};
writeFileSync(join(ASSETS, 'palette.json'), JSON.stringify(palette, null, 2));
writeFileSync(join(TANKS, 'tanks_meta.json'), JSON.stringify({
  unitsPerGamePx: 4, viewBox: [VB_W, VB_H], anchor: 'bottom-center (24,40) = engine tank position on ground',
  angle: 'degrees, 0=+x(right), 90=up, 180=left; canvas: rotate(-angle) about pivot', drawOrder: ['shadow', 'hull', 'barrel', 'turret', 'shield', 'marker'],
  tokens: TOKENS, types: tankMeta,
}, null, 2));

// ---- preview.html ----
const effects = JSON.parse(readFileSync(join(FX, 'effects.json'), 'utf8'));
const data = { files, tankMeta, palette, effects };
const tpl = readFileSync(join(HERE, 'preview_template.html'), 'utf8');
writeFileSync(join(TANKS, 'preview.html'), tpl.replace('/*__DATA__*/null', JSON.stringify(data)));
console.log('files:', Object.keys(files).length);
