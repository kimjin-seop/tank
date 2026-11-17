// 에셋 로더: palette / tanks_meta / effects / items + SVG 원문, 재색칠 후 배율별 오프스크린 캐시
export const A = { pal: null, meta: null, fx: null, items: null, itemById: new Map(), svg: new Map(), ready: null, cats: null, catOf: new Map() };

const SVG_FILES = [];
function svgList(types) {
  const out = [];
  for (const t of types) for (const l of ['hull', 'turret', 'barrel', 'wreck']) out.push(`tanks/tank_${t}_${l}.svg`);
  for (let n = 1; n <= 10; n++) out.push(`tanks/marker_${String(n).padStart(2, '0')}.svg`);
  for (const s of ['shield', 'force', 'heavy', 'supermag']) out.push(`fx/fx_shield_${s}.svg`);
  out.push('fx/fx_turn_ring.svg', 'fx/fx_turn_chevron.svg', 'fx/fx_ready_check.svg');
  return out;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

export function loadAssets() {
  if (A.ready) return A.ready;
  A.ready = (async () => {
    const [pal, meta, fx, items] = await Promise.all([
      getJSON('/assets/palette.json'), getJSON('/assets/tanks/tanks_meta.json'),
      getJSON('/assets/fx/effects.json'), getJSON('/data/items_ko.json'),
    ]);
    Object.assign(A, { pal, meta, fx, items });
    for (const it of items) A.itemById.set(it.id, it);
    try { // 아이템 분류(강조색·기호). 없어도 동작
      A.cats = await getJSON('/assets/items/categories.json');
      for (const c of A.cats.categories) for (const id of c.items) A.catOf.set(id, c);
    } catch { A.cats = null; }
    SVG_FILES.push(...svgList(Object.keys(meta.types)));
    await Promise.all(SVG_FILES.map(async rel => {
      const r = await fetch('/assets/' + rel);
      if (r.ok) A.svg.set(rel, await r.text());
    }));
    return A;
  })();
  return A.ready;
}

export const tankTypes = () => Object.keys(A.meta.types);
export const playerColor = n => A.pal.players[((n - 1) % 10 + 10) % 10];
export function colorMap(n) {
  const p = playerColor(n), T = A.pal.tokens;
  return { [T.PL]: p.PL, [T.PD]: p.PD, [T.P]: p.P };
}

// ---- SVG → Image (재색칠) → 배율별 캔버스 캐시 ----
const imgCache = new Map();   // key -> {img, ok}
const bmpCache = new Map();   // key@px -> canvas

function svgImage(rel, cmap) {
  const key = rel + '|' + (cmap ? Object.values(cmap).join(',') : '');
  let e = imgCache.get(key);
  if (e) return e;
  let s = A.svg.get(rel);
  e = { img: new Image(), ok: false };
  imgCache.set(key, e);
  if (!s) return e;
  if (cmap) for (const [k, v] of Object.entries(cmap)) s = s.split(k).join(v).split(k.toLowerCase()).join(v);
  e.img.onload = () => { e.ok = true; };
  e.img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  return e;
}

/** 지정 픽셀 크기로 래스터화된 캔버스(없으면 null; 다음 프레임에 준비) */
export function bitmap(rel, cmap, wPx, hPx) {
  wPx = Math.max(1, Math.round(wPx)); hPx = Math.max(1, Math.round(hPx));
  const im = svgImage(rel, cmap);
  if (!im.ok) return null;
  const key = rel + '|' + (cmap ? Object.values(cmap).join(',') : '') + '@' + wPx + 'x' + hPx;
  let c = bmpCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
    c.getContext('2d').drawImage(im.img, 0, 0, wPx, hPx);
    bmpCache.set(key, c);
    if (bmpCache.size > 1500) bmpCache.delete(bmpCache.keys().next().value);
  }
  return c;
}

/** 미리 디코드(탱크 선택 카드 등에서 첫 프레임 공백 방지) */
export function warmup(nList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const ps = [];
  for (const t of tankTypes()) for (const n of nList) for (const l of ['hull', 'turret', 'barrel']) {
    const e = svgImage(`tanks/tank_${t}_${l}.svg`, colorMap(n));
    ps.push(e.img.decode ? e.img.decode().then(() => { e.ok = true; }).catch(() => {}) : Promise.resolve());
  }
  for (const rel of SVG_FILES.filter(r => !r.includes('tank_') || r.includes('wreck'))) {
    const e = svgImage(rel, null);
    ps.push(e.img.decode ? e.img.decode().then(() => { e.ok = true; }).catch(() => {}) : Promise.resolve());
  }
  for (let n = 1; n <= 10; n++) for (const rel of ['fx/fx_turn_ring.svg', 'fx/fx_turn_chevron.svg']) {
    const e = svgImage(rel, { [A.pal.tokens.P]: playerColor(n).P });
    ps.push(e.img.decode ? e.img.decode().then(() => { e.ok = true; }).catch(() => {}) : Promise.resolve());
  }
  return Promise.all(ps);
}

/** DOM용: 탱크 미리보기 캔버스 그리기 (대기실 카드) */
export function drawTankPreview(canvas, type, n, angle = 45) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 96, H = canvas.clientHeight || 64;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d');
  const draw = () => {
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
    const S = Math.min(W / 14, H / 11) * dpr;  // game px → device px
    drawTankLayers(c, type, n, canvas.width / 2, canvas.height - 4 * dpr, S, angle, {});
  };
  draw();
  setTimeout(draw, 120); setTimeout(draw, 500);
}

/**
 * 탱크 레이어 합성: 그림자 → hull → barrel → turret → 방어막. (gx,gy)=지면 접점(디바이스 px), S=game px당 디바이스 px
 * o: { wreck, glow, shield:'shield'|'force'|'heavy'|'supermag', shieldAlpha, alpha }
 */
export function drawTankLayers(c, type, n, gx, gy, S, angle, o) {
  const m = A.meta.types[type] || A.meta.types.classic;
  type = A.meta.types[type] ? type : 'classic';
  const u = S / 4, w = 48 * u, hgt = 40 * u, [px, py] = m.pivot;
  const cm = colorMap(n);
  c.save();
  if (o.alpha != null) c.globalAlpha = o.alpha;
  const ga = c.globalAlpha;
  c.globalAlpha = ga * 0.35; c.fillStyle = '#000';
  c.beginPath(); c.ellipse(gx, gy - 0.3 * S, 5.5 * S, 0.7 * S, 0, 0, Math.PI * 2); c.fill();
  c.globalAlpha = ga;
  if (o.wreck) {
    const b = bitmap(`tanks/tank_${type}_wreck.svg`, null, w, hgt);
    if (b) c.drawImage(b, gx - w / 2, gy - hgt, w, hgt);
    c.restore(); return;
  }
  if (o.glow) { c.shadowColor = playerColor(n).P; c.shadowBlur = Math.max(3, 1.2 * S); }
  else if (o.outline) { c.shadowColor = 'rgba(5,7,12,.95)'; c.shadowBlur = Math.max(1.5, 0.45 * S); } // 작은(판정 크기) 탱크 윤곽 보강
  const hull = bitmap(`tanks/tank_${type}_hull.svg`, cm, w, hgt);
  const barrel = bitmap(`tanks/tank_${type}_barrel.svg`, cm, w, hgt);
  const turret = bitmap(`tanks/tank_${type}_turret.svg`, cm, w, hgt);
  if (hull) c.drawImage(hull, gx - w / 2, gy - hgt, w, hgt);
  if (barrel) {
    c.save(); c.translate(gx + (px - 24) * u, gy + (py - 40) * u); c.rotate(-angle * Math.PI / 180);
    c.drawImage(barrel, -px * u, -py * u, w, hgt); c.restore();
  }
  if (turret) c.drawImage(turret, gx - w / 2, gy - hgt, w, hgt);
  c.shadowBlur = 0;
  if (o.shield) {
    const b = bitmap(`fx/fx_shield_${o.shield}.svg`, null, 64 * u, 64 * u);
    if (b) { c.globalAlpha = ga * (o.shieldAlpha ?? 1); c.drawImage(b, gx - 32 * u, gy - 12 * u - 32 * u, 64 * u, 64 * u); }
  }
  c.restore();
}

/** 포구 위치(game px), 각도 반영 */
export function muzzlePos(type, x, y, angle) {
  const m = A.meta.types[type] || A.meta.types.classic;
  const [px, py] = m.pivot, len = (m.barrelLen || 17) / 4;
  const a = angle * Math.PI / 180;
  return [x + (px - 24) / 4 + Math.cos(a) * len, y + (py - 40) / 4 - Math.sin(a) * len];
}

// ---------- 아이템 아이콘(assets/items/<id>.svg, 64x64) + 분류 강조색 테두리 + 분류 기호 ----------
const GLYPH = {
  circle: '<circle cx="5" cy="5" r="3.6"/>',
  'triangle-down': '<path d="M1 2h8L5 9z"/>',
  'triangle-up': '<path d="M5 1l4 7H1z"/>',
  bolt: '<path d="M6 0L1.5 5.6H4.6L3.6 10 8.5 4.2H5.4z"/>',
  diamond: '<path d="M5 0.6L9.4 5 5 9.4 0.6 5z"/>',
  shield: '<path d="M5 0.6L9 2v3.2C9 7.6 7.2 9 5 9.6 2.8 9 1 7.6 1 5.2V2z"/>',
  square: '<rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1"/>',
};
/** 아이템 아이콘 요소. size: 32|48|64 등 CSS px. 장식용(alt 빈값) — 이름은 옆에 텍스트로 함께 표시 */
export function itemIcon(id, size = 32) {
  const cat = A.catOf.get(id);
  const el = document.createElement('span');
  el.className = 'iic'; el.style.setProperty('--sz', size + 'px');
  if (cat) { el.style.setProperty('--acc', cat.accent); el.title = cat.label; }
  const img = document.createElement('img');
  img.src = `/assets/items/${id}.svg`; img.alt = ''; img.width = size; img.height = size; img.decoding = 'async'; img.draggable = false;
  img.onerror = () => { img.remove(); };
  el.append(img);
  if (cat && GLYPH[cat.glyph]) {
    const g = document.createElement('span'); g.className = 'iic-g'; g.setAttribute('aria-hidden', 'true');
    g.innerHTML = `<svg viewBox="0 0 10 10" fill="currentColor">${GLYPH[cat.glyph]}</svg>`;
    el.append(g);
  }
  return el;
}
