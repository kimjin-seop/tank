// effects.json 파라미터 기반 이펙트 시스템 (game px 좌표계에서 그림)
import { A } from './assets.js';
import { rng, lerp } from '../util.js';

const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function evalN(v, r) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  if (/^[\d.]+r$/.test(v)) return parseFloat(v) * r;
  const expr = v.replace(/\(.*?\)/g, '').trim();
  if (!/^[\d\sr+\-*/.]+$/.test(expr)) return parseFloat(expr) || 0;
  try { return Function('r', 'return ' + expr)(r); } catch { return 0; }
}
function hexRgb(col) {
  if (col.startsWith('rgb')) { const m = col.match(/[\d.]+/g).map(Number); return m.slice(0, 3); }
  let s = col.replace('#', ''); if (s.length === 3) s = s.split('').map(x => x + x).join('');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}
const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
function lerpRgb(cols, t) {
  if (cols.length === 1) return cols[0];
  const n = cols.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, a = cols[i], b = cols[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}
function keyed(vals, ts, t) {
  if (t <= ts[0]) return vals[0];
  for (let i = 1; i < ts.length; i++) if (t <= ts[i]) return lerp(vals[i - 1], vals[i], (t - ts[i - 1]) / (ts[i] - ts[i - 1]));
  return vals[vals.length - 1];
}
const pick = (rangeOrVal, R) => Array.isArray(rangeOrVal) ? lerp(rangeOrVal[0], rangeOrVal[1], R()) : rangeOrVal;

export class FxSystem {
  constructor() {
    this.parts = [];     // 활성 입자
    this.fx = [];        // 시간 기반 레이어 효과
    this.emitters = [];  // 지속 발생기(연기, 불씨, 네이팜)
    this.shake = { amp: 0, dur: 0, t: 0 };
    this.lowFx = false;
    this.ctxColors = { player: '#FFFFFF', terrain: null, wall: '#8A8F98' };
  }
  get maxParts() { return A.fx?.global?.maxParticles || 1500; }
  clear() { this.parts.length = 0; this.fx.length = 0; this.emitters.length = 0; }

  resolve(s, extra = {}) {
    if (typeof s !== 'string') return '#FFFFFF';
    const t = this.ctxColors.terrain;
    if (s === '$player') return extra.player || this.ctxColors.player;
    if (s === '$wall') return extra.wall || this.ctxColors.wall;
    if (s === '$shieldRim') return extra.shieldRim || '#C8F0FF';
    if (s === '$shieldCore') return extra.shieldCore || '#5AC8FA';
    if (s.startsWith('$terrain') && t) { if (s === '$terrainRim') return t.rim; return t.layers[+s.slice(-1)] || t.layers[0]; }
    return s.startsWith('$') ? '#FFFFFF' : s;
  }

  addShake(amp, dur) {
    if (reduced() || this.lowFx) return;
    if (amp > this.shake.amp * (1 - this.shake.t / (this.shake.dur || 1))) this.shake = { amp, dur, t: 0 };
  }
  shakeOffset() {
    const s = this.shake; if (!s.amp || s.t >= s.dur) return [0, 0];
    const k = 1 - s.t / s.dur, f = (A.fx?.global?.shake?.freqHz || 28) * Math.PI * 2;
    return [Math.sin(s.t * f) * s.amp * k, Math.cos(s.t * f * 1.3) * s.amp * k * 0.6];
  }

  /** 입자 레이어 정의(L)로 입자 생성 */
  spawn(L, x, y, r, R, extra = {}, mul = 1) {
    let cnt = Math.round(evalN(L.count ?? 8, r) * mul * (this.lowFx ? (A.fx.global.lowFx.particleMul || 0.4) : 1));
    cnt = Math.min(cnt, this.maxParts - this.parts.length);
    if (cnt <= 0) return;
    const cols = (L.colors || ['#FFFFFF']).map(k => hexRgb(this.resolve(k, extra)));
    const sp = L.spawn || 'point', sm = L.scaleWithR ? Math.sqrt(Math.max(r, 1) / 20) : 1;
    const s0 = evalN(Array.isArray(L.size) ? L.size[0] : (L.size ?? 1), r), s1 = evalN(Array.isArray(L.size) ? L.size[1] : (L.size ?? 1), r);
    let angs = L.angle;
    for (let i = 0; i < cnt; i++) {
      let ox = 0, oy = 0;
      let deg;
      if (Array.isArray(angs) && angs.length === 4) deg = R() < 0.5 ? lerp(angs[0], angs[1], R()) : lerp(angs[2], angs[3], R());
      else if (Array.isArray(angs)) deg = lerp(angs[0], angs[1], R());
      else if (typeof L.angleCenter === 'number') deg = L.angleCenter + (R() - 0.5) * 2 * (L.angleSpread || 30);
      else deg = R() * 360;
      if (sp.startsWith('disc')) { const k = (parseFloat(sp.split(' ')[1]) || 0.5) * r * Math.sqrt(R()), b = R() * Math.PI; ox = Math.cos(b) * k; oy = -Math.sin(b) * k; }
      else if (sp.startsWith('rim')) { const b = R() * Math.PI; ox = Math.cos(b) * r; oy = -Math.sin(b) * r * 0.8; }
      else if (sp.startsWith('column')) { ox = (R() - 0.5) * 0.5 * r; oy = -R() * 1.4 * r; }
      else if (sp.startsWith('ellipse')) { const b = R() * Math.PI * 2; ox = Math.cos(b) * 0.7 * r; oy = -1.4 * r + Math.sin(b) * 0.25 * r; }
      else if (sp === 'line' && L.x1 != null) { const f = R(); ox = (L.x1 - x) * f; oy = (L.y1 - y) * f; }
      const a = deg * Math.PI / 180, s = pick(L.speed || [10, 30], R) * sm;
      this.parts.push({
        x: x + ox, y: y + oy, vx: Math.cos(a) * s, vy: -Math.sin(a) * s,
        life: pick(L.life || [0.5, 1], R), age: -(L.delay || 0) - R() * 0.05,
        g: L.gravity || 0, drag: L.drag || 0, s0, s1, cols,
        a0: L.alpha ? L.alpha[0] : null, a1: L.alpha ? L.alpha[1] : null,
        add: L.blend === 'lighter', soft: !!L.soft, stretch: L.stretch || 0, wob: L.wobbleX || 0, ph: R() * 6.28,
      });
    }
  }

  /** 레이어형 폭발 실행(def: effects.explosions.blast 등) */
  explode(key, x, y, r, { seed = 1, player, terrainHit = true, hue = null } = {}) {
    const E = A.fx.explosions;
    let def = E[key] || E.blast;
    if (key === 'funky') def = E.blast;
    const R = rng(seed * 7919 + 13);
    const extra = { player };
    let layers = def.layers || [];
    if (hue) {
      layers = layers.map(L => L.type === 'fireball' ? { ...L, stops: [[0, '#FFFFFF'], [0.4, hue], [1, rgba(hexRgb(hue), 0)]] }
        : L.name === 'sparks' ? { ...L, colors: ['#FFFFFF', hue] } : L);
    }
    const lay = [];
    for (const L of layers) {
      if (L.type === 'particles') {
        if (L.onlyIfTerrainHit && !terrainHit) continue;
        if (L.name === 'smokeColumn' && this.lowFx) continue;
        this.spawn(L, x, y, r, R, extra);
      } else lay.push(L);
    }
    this.fx.push({ kind: 'layers', layers: lay, x, y, r, t: 0, dur: def.duration || 1, seed, extra });
    if (def.craterRim) this.fx.push({ kind: 'crater', x, y, r, t: 0, dur: def.craterRim.t[1], d: def.craterRim });
    if (def.shake) this.addShake(evalN(def.shake.amp, r), def.shake.dur);
  }

  riot(x, y, r, { seed = 1, angle = null, wedge = 0 } = {}) {
    const def = A.fx.explosions.riot, R = rng(seed);
    for (const L of def.layers) {
      if (L.type !== 'particles') continue;
      if (wedge && angle != null) this.spawn({ ...L, angle: [angle - wedge, angle + wedge], spawn: 'point', speed: [L.speed[0] * 2, L.speed[1] * 3] }, x, y, r, R);
      else this.spawn(L, x, y, r, R);
    }
    this.fx.push({ kind: 'layers', layers: def.layers.filter(L => L.type !== 'particles'), x, y, r, t: 0, dur: def.duration, seed, extra: {} });
  }

  dirtAdd(x, y, r, seed = 1) {
    const def = A.fx.explosions.dirtAdd, R = rng(seed);
    for (const L of def.layers) if (L.type === 'particles') this.spawn(L, x, y, r, R);
    this.fx.push({ kind: 'layers', layers: def.layers.filter(L => L.type !== 'particles'), x, y, r, t: 0, dur: def.duration, seed, extra: {} });
  }

  plasma(x, y, r, seed = 1) { this.explode('plasma', x, y, r, { seed }); }

  napalm(cells, dur, hot, seed = 1) {
    const N = A.fx.explosions.napalm, R = rng(seed);
    const sx = cells.length ? cells.reduce((s, c) => s + c[0], 0) / cells.length : 0;
    const sy = cells.length ? Math.min(...cells.map(c => c[1])) : 0;
    this.spawn(N.splash, sx, sy, 10, R);
    this.emitters.push({ kind: 'napalm', cells, t: 0, dur, hot, R, acc: 0 });
  }

  laser(pts, player, seed = 1) {
    const L = A.fx.explosions.laser, R = rng(seed);
    this.fx.push({ kind: 'laser', pts, player, t: 0, dur: L.duration });
    const last = pts[pts.length - 1];
    if (last) this.spawn({ ...L.impactSparks, angle: [30, 150] }, last[0], last[1], 10, R, { player });
    this.fx.push({ kind: 'scorch', pts, t: 0, dur: L.scorch.t[1] });
  }

  lightning(x, y, H, seed = 1) {
    const L = A.fx.explosions.lightning;
    this.fx.push({ kind: 'bolt', x, y, t: 0, dur: L.bolt.life * (1 + L.bolt.restrikes), seed });
    this.fx.push({ kind: 'screen', color: L.screenFlash.color, alpha: L.screenFlash.alpha, ts: L.screenFlash.t, t: 0, dur: L.screenFlash.t[1] });
    this.addShake(L.shake.amp, L.shake.dur);
  }

  /** 탱크 파괴: r<0 이면 폭발은 뒤따르는 엔진 explode(kind:'death')가 그리고 여기서는 연기·불씨만 */
  tankDeath(x, y, r, seed = 1) {
    if (r >= 0) this.tankDeathBlast(x, y, r || 12, seed);
    const D = A.fx.explosions.tankDeath;
    this.emitters.push({ kind: 'rate', x, y, t: 0, dur: 3, defs: [D.smoke, D.embers], R: rng(seed + 5), acc: [0, 0] });
  }

  /**
   * 사망 폭발(엔진 반경 r, 월드 기준). variant = 엔진 death 변종 ID(스키마 확정 전 가정: 'fireball'|'dirtSpout'|'debris'|'mushroom').
   * 모르는 ID 는 fireball. 연출 정의는 DEATH_VARIANTS(아래)에 데이터로 추가. effects.json 에 explosions.tankDeathVariants 가 있으면 그 값을 우선
   */
  tankDeathBlast(x, y, r, seed = 1, variant = 'fireball') {
    r = Math.max(6, r || 12);
    const fn = DEATH_VARIANTS[variant] || DEATH_VARIANTS.fireball;
    fn(this, x, y, r, seed, A.fx?.explosions?.tankDeathVariants?.[variant] || {});
  }

  mirvSplit(x, y) {
    const f = A.fx.explosions.mirvSplit.flash;
    this.fx.push({ kind: 'layers', layers: [{ type: 'flash', r: 1, color: f.color, alpha: f.alpha, t: f.t, blend: 'lighter' }], x, y, r: f.r, t: 0, dur: f.t[1], extra: {} });
  }

  landingDust(x, y, seed = 1) {
    const L = A.fx.explosions.landingDust;
    this.spawn({ ...L, spawn: 'point' }, x, y, 10, rng(seed));
  }

  shieldHit(fxKey, x, y, angle, seed = 1) {
    const S = A.fx.shieldHit, pal = A.pal.shields[fxKey] || A.pal.shields.shield, R = rng(seed);
    this.fx.push({ kind: 'shieldRipple', x, y, angle, t: 0, dur: S.common.ripple.t[1] + 0.1, rim: pal.rim, core: pal.core });
    const sp = S[fxKey === 'heavy' ? 'heavy' : 'shield'].sparks;
    if (sp) this.spawn({ ...sp, angle: [angle - 60, angle + 60], blend: 'lighter' }, x, y - 3, 6, R);
  }

  shieldBreak(fxKey, x, y, seed = 1) {
    const B = A.fx.shieldHit.break, pal = A.pal.shields[fxKey] || A.pal.shields.shield;
    this.spawn({ count: B.shards, colors: [pal.core], speed: B.speed, life: B.life, gravity: B.gravity, size: [1.4, 1], alpha: B.alpha, angle: [0, 360] }, x, y - 3, 6, rng(seed));
  }

  wallHit(x, y, color, seed = 1) {
    const W = A.fx.walls.hit;
    this.spawn({ ...W, colors: W.colors, angle: [0, 360] }, x, y, 6, rng(seed), { wall: color });
  }

  /** 꼬리 입자 발생(투사체 trail kind=particles) */
  trailParticles(def, x, y, dt, st, extra) {
    st.acc = (st.acc || 0) + def.rate * dt;
    const R = st.R || (st.R = rng(st.seed || 3));
    while (st.acc >= 1) { st.acc -= 1; this.spawn({ ...def, count: 1, angle: [60, 120] }, x, y, 6, R, extra); }
  }

  update(dt) {
    if (this.shake.amp) { this.shake.t += dt; if (this.shake.t >= this.shake.dur) this.shake.amp = 0; }
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt; if (p.age < 0) continue;
      if (p.age > p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      p.vy += p.g * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.t += dt; if (f.t > f.dur) this.fx.splice(i, 1); }
    const N = A.fx?.explosions?.napalm;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]; e.t += dt;
      if (e.t > e.dur) { this.emitters.splice(i, 1); continue; }
      if (e.kind === 'rate') {
        e.defs.forEach((d, k) => { e.acc[k] += d.rate * dt; while (e.acc[k] >= 1) { e.acc[k] -= 1; this.spawn({ ...d, count: 1, angle: [70, 110] }, e.x + (e.R() - 0.5) * 4, e.y - 4, 6, e.R); } });
      } else if (e.kind === 'napalm' && N) {
        const P2 = N.fire.particle, cols = e.hot ? N.hot.colorsOverride : P2.colors;
        const mulRate = e.hot ? N.hot.rateMul : 1;
        const fade = e.t > e.dur - 0.5 ? (e.dur - e.t) / 0.5 : 1;
        for (const c of e.cells) {
          const rate = (4 + (c[2] ?? 0.5) * 10) * mulRate * fade * (this.lowFx ? 0.4 : 1);
          c.acc = (c.acc || 0) + rate * dt;
          while (c.acc >= 1) { c.acc -= 1; this.spawn({ ...P2, colors: cols, count: 1 }, c[0], c[1], 6, e.R); }
          c.sacc = (c.sacc || 0) + N.fire.smoke.perCellRate * dt * 0.3;
          while (c.sacc >= 1) { c.sacc -= 1; this.spawn({ ...N.fire.smoke, count: 1, angle: [80, 100] }, c[0], c[1] - 2, 6, e.R); }
        }
      }
    }
  }

  /**
   * c: 이미 game px(월드) 변환된 컨텍스트. v: Renderer({kx,ky,ks,sx(),sy()}) 또는 숫자 배율.
   * 폭발 원·분화구는 월드 기준(표시 종횡비에 따라 가로로 넓을 수 있음, 원본과 같음), 입자는 화면 기준 정상 비율.
   */
  draw(c, v, W, H) {
    const S = typeof v === 'number' ? v : v.ks;
    const scr = typeof v === 'number' ? null : v;
    const redu = reduced();
    const flashMul = redu ? (A.fx.global.reducedMotion.flashAlphaMul || 0.35) : 1;
    // 네이팜 바닥 글로우
    const N = A.fx?.explosions?.napalm;
    for (const e of this.emitters) if (e.kind === 'napalm' && N) {
      c.save(); c.globalCompositeOperation = 'lighter';
      const gcol = hexRgb(e.hot ? N.hot.groundGlowColor : N.fire.groundGlow.color);
      const fl = 0.85 + 0.15 * Math.sin(e.t * N.fire.groundGlow.flickerHz * 6.28);
      for (const cell of e.cells) {
        const a = (0.25 + (cell[2] ?? 0.5) * 0.35) * fl, rr = N.fire.groundGlow.r;
        const g = c.createRadialGradient(cell[0], cell[1], 0, cell[0], cell[1], rr);
        g.addColorStop(0, rgba(gcol, a)); g.addColorStop(1, rgba(gcol, 0));
        c.fillStyle = g; c.fillRect(cell[0] - rr, cell[1] - rr, rr * 2, rr * 2);
      }
      c.restore();
    }
    for (const f of this.fx) this.drawFx(c, f, S, W, H, flashMul, scr);
    // 입자: normal 먼저, lighter 나중
    const m0 = c.getTransform();
    for (const pass of [false, true]) {
      c.save(); c.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (const p of this.parts) {
        if (p.add !== pass || p.age < 0) continue;
        const k = p.age / p.life;
        const al = p.a0 != null ? lerp(p.a0, p.a1, k) : (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
        if (al <= 0.01) continue;
        const col = lerpRgb(p.cols, k), sz = Math.max(0.15, lerp(p.s0, p.s1, k));
        let x = p.x + (p.wob ? Math.sin(p.age * 9 + p.ph) * p.wob * k * 0.3 : 0), y = p.y, ex = p.vx * p.stretch, ey = p.vy * p.stretch;
        if (scr) { // 화면 기준: 위치만 월드→화면, 크기는 균일 배율
          c.setTransform(S, 0, 0, S, scr.sx(x), scr.sy(y));
          ex *= scr.kx / S; ey *= scr.ky / S; x = 0; y = 0;
        } else c.setTransform(m0);
        if (p.stretch) {
          c.globalAlpha = al; c.strokeStyle = rgba(col, 1); c.lineWidth = sz; c.lineCap = 'round';
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - ex, y - ey); c.stroke();
        } else if (p.soft) {
          c.globalAlpha = 1;
          const g = c.createRadialGradient(x, y, 0, x, y, sz);
          g.addColorStop(0, rgba(col, al)); g.addColorStop(0.55, rgba(col, al * 0.6)); g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g; c.fillRect(x - sz, y - sz, sz * 2, sz * 2);
        } else {
          c.globalAlpha = al; c.fillStyle = rgba(col, 1);
          c.beginPath(); c.arc(x, y, sz, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();
    }
  }

  drawFx(c, f, S, W, H, flashMul, scr = null) {
    const t = f.t;
    c.save();
    if (f.kind === 'layers') {
      const { x, y, r } = f;
      for (const L of f.layers) {
        c.globalCompositeOperation = L.blend === 'lighter' ? 'lighter' : 'source-over';
        if (L.type === 'screenFlash') {
          const a = keyed(L.alpha, L.t, t) * flashMul;
          if (a > 0) { c.globalAlpha = a; c.fillStyle = L.color; c.fillRect(-20, -20, W + 40, H + 40); }
        } else if (L.type === 'flash') {
          const a = keyed(L.alpha, L.t, t) * flashMul;
          if (a > 0) { const rr = L.r * r, g = c.createRadialGradient(x, y, 0, x, y, rr); const rgb = hexRgb(L.color); g.addColorStop(0, rgba(rgb, a)); g.addColorStop(1, rgba(rgb, 0)); c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
        } else if (L.type === 'fireball') {
          const a = keyed(L.alpha, L.t, t), rr = keyed(L.r, L.t, t) * r;
          if (a > 0 && rr > 0.2) { const g = c.createRadialGradient(x, y, 0, x, y, rr); for (const [o, col] of L.stops) g.addColorStop(o, col); c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill(); }
        } else if (L.type === 'ring') {
          if (t >= L.t[0] && t <= L.t[1]) {
            const k = (t - L.t[0]) / (L.t[1] - L.t[0]);
            c.globalAlpha = Math.max(0, lerp(L.alpha[0], L.alpha[1], k)); c.strokeStyle = this.resolve(L.color, f.extra);
            c.lineWidth = Math.max(0.05, lerp(L.w[0], L.w[1], k)); c.beginPath(); c.arc(x, y, lerp(L.r[0], L.r[1], k) * r, 0, Math.PI * 2); c.stroke();
          }
        } else if (L.type === 'arcs') {
          if (t < (f.dur * 0.75)) {
            const n = Math.round(evalN(String(L.count).split(' ')[0], r));
            const AR = rng(f.seed * 31 + Math.floor(t * (L.regenHz || 20)));
            c.globalCompositeOperation = 'lighter';
            for (let i = 0; i < n; i++) {
              const b = AR() * Math.PI, ex = Math.cos(b) * r, ey = -Math.sin(b) * r;
              const pts = [[x, y]];
              for (let s = 1; s <= L.segments; s++) { const ff = s / L.segments, j = s < L.segments ? (AR() - 0.5) * L.jitter * r * 2 : 0; pts.push([x + ex * ff + j, y + ey * ff + j]); }
              for (const [col, w, al] of [[L.glow, L.glowW, 0.45], [L.core, L.w, 1]]) {
                c.globalAlpha = al; c.strokeStyle = col; c.lineWidth = w * 0.5; c.beginPath(); pts.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
              }
            }
          }
        }
      }
    } else if (f.kind === 'crater') {
      const d = f.d, k = (t - d.t[0]) / (d.t[1] - d.t[0]);
      if (k >= 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.max(0, lerp(d.alpha[0], d.alpha[1], k)); c.strokeStyle = d.color; c.lineWidth = d.w; c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI); c.stroke(); }
    } else if (f.kind === 'laser') {
      const B = A.fx.explosions.laser.beam, k = t / f.dur, fl = 1 - B.flickerAmp * Math.abs(Math.sin(t * B.flickerHz * 6.28));
      c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
      const path = () => { c.beginPath(); f.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); };
      c.globalAlpha = lerp(B.glowAlpha[0], B.glowAlpha[1], k) * fl; c.strokeStyle = f.player; c.lineWidth = B.glowW; c.shadowColor = f.player; c.shadowBlur = 8 * S; path(); c.stroke();
      c.shadowBlur = 0; c.globalAlpha = 1 - k * 0.8; c.strokeStyle = B.core; c.lineWidth = B.coreW; path(); c.stroke();
    } else if (f.kind === 'scorch') {
      const sc = A.fx.explosions.laser.scorch, k = t / f.dur;
      c.globalAlpha = lerp(sc.alpha[0], sc.alpha[1], k); c.strokeStyle = sc.color; c.lineWidth = sc.w; c.beginPath(); f.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    } else if (f.kind === 'bolt') {
      const B = A.fx.explosions.lightning.bolt, strike = Math.floor(t / B.life), R = rng(f.seed * 17 + strike);
      const local = (t % B.life) / B.life;
      c.globalCompositeOperation = 'lighter';
      const pts = [[f.x + (R() - 0.5) * 40, 0]];
      for (let s = 1; s <= B.segments; s++) { const ff = s / B.segments; pts.push([lerp(pts[0][0], f.x, ff) + (s < B.segments ? (R() - 0.5) * B.jitter * H * 0.5 : 0), f.y * ff]); }
      for (const [col, w, al] of [[B.glow, B.glowW, 0.4], [B.core, B.w, 1]]) {
        c.globalAlpha = al * (1 - local); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        const bi = 3 + Math.floor(R() * 5);
        if (R() < B.branchChance && pts[bi]) { c.lineWidth = w * 0.6; c.beginPath(); c.moveTo(pts[bi][0], pts[bi][1]); c.lineTo(pts[bi][0] + (R() - 0.5) * 30, pts[bi][1] + 20 + R() * 20); c.stroke(); }
      }
    } else if (f.kind === 'screen') {
      const a = keyed(f.alpha, f.ts, t) * flashMul;
      if (a > 0) { c.globalAlpha = a; c.fillStyle = f.color; c.fillRect(-20, -20, W + 40, H + 40); }
    } else if (f.kind === 'shieldRipple') {
      const Rp = A.fx.shieldHit.common.ripple, k = Math.min(1, t / Rp.t[1]);
      const uni = scr && scr.tankSize === 'big', St = uni ? scr.kt : S; // 원작 크기면 방어막과 같이 월드 기준
      if (uni) c.setTransform(St, 0, 0, St, scr.sx(f.x), scr.sy(f.y) - 3 * St);
      const fx0 = uni ? 0 : f.x, fy0 = uni ? 0 : f.y - 3;
      c.globalCompositeOperation = 'lighter'; c.strokeStyle = f.rim; c.shadowColor = f.core; c.shadowBlur = 4 * S;
      c.lineWidth = Math.max(0.1, lerp(Rp.w[0], Rp.w[1], k)); c.globalAlpha = 1 - k * 0.6;
      const a = -f.angle * Math.PI / 180, sp = Rp.span * Math.PI / 360 * (0.6 + k);
      c.beginPath(); c.arc(fx0, fy0, 6.5 * (1 + 0.05 * k), a - sp, a + sp); c.stroke();
    }
    c.restore();
  }
}

// ---------- 탱크 사망 연출 변종(변종 ID → 연출 함수). 모두 기존 레이어·입자 원시 요소만 사용 ----------
// cfg: effects.json explosions.tankDeathVariants[id] (선택) — 색·개수·배율 덮어쓰기용
const flashL = (color, r, dur) => ({ type: 'flash', r, color, alpha: [0.9, 0], t: [0, dur], blend: 'lighter' });
export const DEATH_VARIANTS = {
  /** 대형 화염구 + 충격파 링 */
  fireball(F, x, y, r, seed, cfg) {
    const k = cfg.scale || 1;
    F.explode('blast', x, y, r * k, { seed });
    F.fx.push({ kind: 'layers', layers: [flashL(cfg.flash || '#FFE2A8', 1.6, 0.35),
      { type: 'ring', r: [0.2, 2.2], w: [1.6, 0.2], alpha: [0.8, 0], t: [0, 0.5], color: cfg.ring || '#FFF2D0', blend: 'lighter' }], x, y, r: r * k, t: 0, dur: 0.5, extra: {} });
    F.addShake(Math.min(8, 2 + r / 8), 0.45);
  },
  /** 흙 분출: 작은 섬광 + 위로 솟는 흙 입자 기둥(지형색) */
  dirtSpout(F, x, y, r, seed, cfg) {
    const R = rng(seed * 31 + 7);
    F.fx.push({ kind: 'layers', layers: [flashL('#FFD8A0', 0.9, 0.2)], x, y, r, t: 0, dur: 0.2, extra: {} });
    F.spawn({ count: cfg.count || Math.round(30 + r * 1.5), colors: ['$terrain0', '$terrain1', '$terrain2'], speed: [40, 110], angle: [70, 110], gravity: 140, drag: 0.4, life: [0.8, 1.6], size: [1.6, 0.6] }, x, y, r, R);
    F.spawn({ count: 10, colors: ['#5A4A3A', '#2E2620'], speed: [8, 20], angle: [60, 120], gravity: -10, life: [1.2, 2], size: [2, 6], alpha: [0.5, 0], soft: true }, x, y - 4, r, R);
    F.addShake(Math.min(6, 1.5 + r / 10), 0.35);
  },
  /** 연쇄 파편: 작은 폭발 여러 번(시간차) + 금속 파편 */
  debris(F, x, y, r, seed, cfg) {
    const R = rng(seed * 17 + 3), n = cfg.bursts || 4;
    F.explode('blast', x, y, r * 0.6, { seed });
    for (let i = 1; i < n; i++) {
      const dx = (R() - 0.5) * r * 1.2, dy = -R() * r * 0.6, delay = i * 0.12;
      F.fx.push({ kind: 'layers', layers: [{ type: 'fireball', r: [0.2, 1, 0.8], alpha: [0, 1, 0], t: [delay, delay + 0.08, delay + 0.4], stops: [[0, '#FFFFFF'], [0.4, '#FFB040'], [1, 'rgba(255,80,20,0)']], blend: 'lighter' }], x: x + dx, y: y + dy, r: r * 0.35, t: 0, dur: delay + 0.45, extra: {} });
    }
    F.spawn({ count: 24, colors: ['#C8CCD4', '#6E7480', '#FFB040'], speed: [50, 140], angle: [10, 170], gravity: 160, life: [0.6, 1.2], size: [1.2, 0.8], stretch: 0.03 }, x, y - 2, r, R);
    F.addShake(Math.min(7, 2 + r / 9), 0.6);
  },
  /** 버섯구름: 핵 폭발 레이어 + 솟는 연기 기둥과 갓 */
  mushroom(F, x, y, r, seed, cfg) {
    const R = rng(seed * 13 + 5);
    F.explode(A.fx?.explosions?.nuke ? 'nuke' : 'blast', x, y, r, { seed });
    F.spawn({ count: 26, colors: ['#4A3A30', '#2A2220'], speed: [20, 40], angle: [85, 95], gravity: -6, drag: 0.6, life: [1.8, 2.6], size: [3, 9], alpha: [0.6, 0], soft: true, spawn: 'column' }, x, y, r, R);
    F.spawn({ count: 30, colors: ['#5A4A40', '#3A302A', '#FF9A4A'], speed: [6, 18], angle: [0, 360], gravity: -2, drag: 0.8, life: [1.8, 2.8], size: [4, 10], alpha: [0.55, 0], soft: true, spawn: 'ellipse' }, x, y, r, R);
    F.addShake(Math.min(10, 3 + r / 6), 0.8);
  },
};
