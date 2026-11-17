// 게임 캔버스 렌더러: 하늘 7종, 지형, 벽, 탱크 레이어 합성, 마커·턴 링, 방어막, 궤적, 투사체, 이펙트, 말풍선
import { A, drawTankLayers, bitmap, playerColor } from './assets.js';
import { Terrain } from './terrain.js';
import { FxSystem } from './fx.js';
import { rng, lerp } from '../util.js';
import { SHIELD_MAX } from '../i18n.js';

const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 표시 종횡비(전장 전체의 화면상 가로/세로). 원본 기본 모드 360x480 은 비정방 픽셀(h/w≈0.55)로
 * 4:3 모니터에 꽉 차게 보였으므로 기본 4/3. 월드(판정) 좌표는 그대로이고 x 에만 배율이 더 붙는다.
 */
export const DISPLAY_ASPECT = 4 / 3;
/** 스프라이트(탱크·투사체·입자) 균일 배율 = ky·(kx/ky)^SPRITE_MIX. 0=세로 기준, 1=가로(판정 폭) 기준 */
export const SPRITE_MIX = 0.5;
/** 탱크(차체·포신·방어막·낙하산·턴 링·번호 마커) 시각 배율. 판정·월드 크기와 무관한 표시 전용 */
export const TANK_SCALE = 2;
/** 엔진 탱크 판정(server/engine/config.js TANK 와 같은 값; 서버가 값을 내려주면 그쪽으로 대체) */
export const TANK_HIT = { halfW: 4, height: 6, pivotDy: 5, barrel: 8, shieldR: 10, shieldCy: 3 };
/** 작은 화면(모바일) 탱크 최소 배율: game px 1 = 이 CSS px 이상(차체 12 game px ≈ 26 CSS px) */
export const TANK_MIN_CSS = 2.2;

export class Renderer {
  constructor(canvas, wrap, { bg = null } = {}) {
    this.cv = canvas; this.wrap = wrap; this.bg = bg; this.c = canvas.getContext('2d');
    this.W = 360; this.H = 480; this.S = 1; this.dpr = 1;
    this.kx = 1; this.ky = 1; this.ks = 1; this.ox = 0; this.oy = 0;
    this.terrain = new Terrain(this.W, this.H);
    this.fx = new FxSystem();
    this.sky = 'PLAIN'; this.wall = 'NONE'; this.wallColor = A.pal.walls.NONE;
    this.tanks = new Map();      // id -> tank
    this.projectiles = [];        // 재생 중 탄
    this.tracePaths = [];         // {color, pts, dashed}
    this.smoke = [];              // 스모크 트레이서 퍼프 {x,y,r,color}
    this.bubbles = [];            // 말풍선 {id, text, t, dur}
    this.popups = [];             // 피해 수치 팝업 {id, text, t, dur}
    this.turnId = null; this.readyIds = new Set();
    this.tankSize = (() => { try { return localStorage.getItem('se.tankSize') === 'big' ? 'big' : 'orig'; } catch { return 'orig'; } })(); // 탱크 크기: 원작(판정 일치)/크게
    this.showGauge = (() => { try { return localStorage.getItem('se.tankGauge') !== '0'; } catch { return true; } })(); // 탱크 밑 게이지(기본 켬)
    this.selectTarget = false; this.hoverPt = null;
    this.time = 0; this.skyCanvas = null; this.skySeed = 7;
    this._last = performance.now();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(wrap);
    this.resize();
    this.running = true;
    const loop = now => { if (!this.running) return; const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; this.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  destroy() { this.running = false; this._ro.disconnect(); }

  setWorld({ w = 360, h = 480, sky = 'PLAIN', walls = 'NONE', terrain, seed = 7 }) {
    this.W = w; this.H = h; this.sky = A.pal.skies[sky] ? sky : 'PLAIN'; this.skySeed = seed;
    this.setWall(walls);
    this.terrain = new Terrain(w, h); this.terrain.setSky(this.sky); this.terrain.load(terrain);
    this.fx.clear(); this.fx.ctxColors.terrain = A.pal.skies[this.sky].terrain;
    this.tracePaths = []; this.smoke = []; this.projectiles = []; this.bubbles = []; this.popups = [];
    this.skyCanvas = null; this.resize();
  }
  setWall(mode) {
    this.wall = mode; this.wallColor = A.pal.walls[mode] || A.pal.walls.NONE; this.fx.ctxColors.wall = this.wallColor;
    // 월드 경계 표시(캔버스 밖은 월드가 아님)
    const vis = mode && mode !== 'NONE';
    this.cv.style.boxShadow = `0 0 0 1px ${vis ? this.wallColor : 'rgba(255,255,255,.18)'}, 0 0 ${vis ? 14 : 8}px ${vis ? this.wallColor : 'rgba(0,0,0,.6)'}`;
  }
  clearScreen() { this.tracePaths = []; this.smoke = []; }

  /** 표시 종횡비 고정, 가용 영역 최대(비정수 배율). 백버퍼는 devicePixelRatio 반영. 남는 영역은 배경 */
  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cssW = Math.max(60, Math.floor(Math.min(r.width, r.height * DISPLAY_ASPECT)));
    const cssH = Math.floor(cssW / DISPLAY_ASPECT);
    this.dpr = window.devicePixelRatio || 1;
    this.cv.style.width = cssW + 'px'; this.cv.style.height = cssH + 'px';
    this.cv.width = Math.round(cssW * this.dpr); this.cv.height = Math.round(cssH * this.dpr);
    this.kx = this.cv.width / this.W; this.ky = this.cv.height / this.H;  // game px → device px (축별)
    this.ks = this.ky * Math.pow(this.kx / this.ky, SPRITE_MIX);         // 정상 비율 스프라이트 배율
    this.kt = Math.max(this.ks * TANK_SCALE, TANK_MIN_CSS * this.dpr);  // 탱크 표시 배율(작은 화면은 최소 보장)
    this.k = this.ks; this.S = this.ky / this.dpr;
    this.skyCanvas = null;
  }
  /** game 좌표 → device px */
  sx(x) { return this.ox + x * this.kx; }
  sy(y) { return this.oy + y * this.ky; }
  /** 현재 경로를 화면 균일 선 굵기(game px 단위 w × ks)로 그림 */
  strokeU(c, w) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.lineWidth = Math.max(0.5, w * this.ks); c.stroke(); c.restore(); }
  /** 엔진 각도(월드) → 화면 각도. 포신이 실제 탄 진행 방향을 가리키게 함 */
  screenAngle(deg) { const a = deg * Math.PI / 180; return Math.atan2(Math.sin(a) * this.ky, Math.cos(a) * this.kx) * 180 / Math.PI; }

  /** 번호 마커 크기(device px): 탱크 배율에 비례, 최소 14·최대 40 CSS px */
  markerSize() { return Math.max(14 * this.dpr, Math.min(40 * this.dpr, 4.5 * this.kt)); }

  /** 클라이언트 px → game px */
  toWorld(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    return [(clientX - r.left) / r.width * this.W, (clientY - r.top) / r.height * this.H];
  }
  tankAt(gx, gy) {
    let best = null, bd = 10;
    for (const t of this.tanks.values()) { if (!t.alive) continue; const d = Math.hypot(t.x - gx, t.y - 4 - gy); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  // ---------- 하늘 ----------
  buildSky() {
    const cv = document.createElement('canvas'); cv.width = this.cv.width; cv.height = this.cv.height;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, k = this.ks, kx = this.kx, ky = this.ky;
    const sk = A.pal.skies[this.sky], R = rng(this.skySeed);
    const g = c.createLinearGradient(0, 0, 0, H); sk.stops.forEach(([o, col]) => g.addColorStop(o, col));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // 캔버스 밖 배경: 하늘 그라데이션 연장 + 어둡게 + 모서리 비네팅
    if (this.bg) {
      const st = sk.stops.map(([o, col]) => `${col} ${Math.round(o * 100)}%`).join(', ');
      this.bg.style.background = `radial-gradient(ellipse at 50% 45%, rgba(11,14,22,0) 35%, rgba(5,7,12,.85) 100%), linear-gradient(rgba(11,14,22,.55), rgba(11,14,22,.55)), linear-gradient(180deg, ${st})`;
    }
    if (sk.deco === 'bands') { const n = sk.bands || 12; for (let i = 0; i < n; i++) { c.globalAlpha = 0.06; c.fillStyle = i % 2 ? '#000' : '#fff'; c.fillRect(0, i * H / n, W, H / n + 1); } c.globalAlpha = 1; }
    if (sk.deco === 'sun') { const sx = W * 0.72, sy = H * 0.7; const sg = c.createRadialGradient(sx, sy, 0, sx, sy, 60 * k); sg.addColorStop(0, 'rgba(255,240,200,0.95)'); sg.addColorStop(0.18, 'rgba(255,210,140,0.8)'); sg.addColorStop(1, 'rgba(255,160,90,0)'); c.fillStyle = sg; c.fillRect(0, 0, W, H); }
    if (sk.deco === 'ceiling') {
      c.fillStyle = sk.terrain.layers[1]; c.beginPath(); c.moveTo(0, 0);
      for (let x = 0; x <= W; x += 3 * kx) { const d = (4 + 3 * Math.sin(x / (9 * kx)) + (R() < 0.12 ? 6 + R() * 6 : R() * 2)) * ky; c.lineTo(x, d); }
      c.lineTo(W, 0); c.fill(); c.strokeStyle = sk.terrain.rimDark; c.lineWidth = 0.6 * k; c.stroke();
    }
    this.skyCanvas = cv;
    // 동적 장식 시드
    this.clouds = []; this.stars = [];
    if (sk.deco === 'clouds' || sk.deco === 'stormclouds') for (let i = 0; i < 9; i++) this.clouds.push({ x: R() * this.W, y: R() * this.H * 0.35, rx: (20 + R() * 40) / 2, ry: (5 + R() * 6) / 2, v: 2 * (0.5 + R()) });
    if (sk.deco === 'stars') for (let i = 0; i < this.W * this.H / 400; i++) { const a = R(); this.stars.push({ x: R() * this.W, y: R() * this.H * 0.85, a: 0.3 + 0.7 * a, s: a > 0.95 ? 1.6 : 0.9, tw: R() < 0.05 ? 0.5 + R() : 0, ph: R() * 6.28 }); }
  }

  drawSkyDyn(c) {
    const sk = A.pal.skies[this.sky];
    if (this.clouds?.length) {
      c.fillStyle = sk.deco === 'clouds' ? '#FFFFFF' : '#141A22';
      for (const cl of this.clouds) {
        const x = ((cl.x + this.time * cl.v) % (this.W + cl.rx * 2)) - cl.rx;
        c.globalAlpha = sk.deco === 'clouds' ? 0.22 : 0.45; c.beginPath(); c.ellipse(x, cl.y, cl.rx, cl.ry, 0, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (this.stars?.length) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      for (const s of this.stars) {
        const a = s.tw && !reduced() ? s.a * (0.55 + 0.45 * Math.sin(this.time * s.tw * 6.28 + s.ph)) : s.a;
        c.globalAlpha = a; c.fillStyle = s.a > 0.92 ? '#CFE0FF' : '#FFFFFF';
        const z = s.s * 0.6 * this.ks; c.fillRect(this.sx(s.x), this.sy(s.y), z, z);
      }
      c.restore();
    }
  }

  // ---------- 메인 프레임 ----------
  frame(dt) {
    this.time += dt;
    this.onFrame && this.onFrame(dt);
    this.fx.update(dt);
    const c = this.c, kx = this.kx, ky = this.ky;
    if (!this.skyCanvas) this.buildSky();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0B0E16'; c.fillRect(0, 0, this.cv.width, this.cv.height);
    const [sx, sy] = this.fx.shakeOffset();
    this.ox = sx * kx; this.oy = sy * ky;
    c.drawImage(this.skyCanvas, this.ox, this.oy);
    // 월드 변환: x 와 y 배율이 다름(DISPLAY_ASPECT). 지형·분화구·폭발 원은 월드 기준
    c.setTransform(kx, 0, 0, ky, this.ox, this.oy);
    this.drawSkyDyn(c);
    // 스모크 트레이서 연기(영구) — 화면 기준 원
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 0.45;
    for (const p of this.smoke) { c.fillStyle = p.color; c.beginPath(); c.arc(this.sx(p.x), this.sy(p.y), p.r * this.ks, 0, Math.PI * 2); c.fill(); }
    c.restore();
    this.terrain.draw(c, dt, this);
    this.drawTracePaths(c);
    this.drawWalls(c);
    this.drawTanks(c);
    this.drawProjectiles(c, dt);
    this.fx.draw(c, this, this.W, this.H);
    // 화면 고정 크기 요소(마커·말풍선): 디바이스 px 좌표
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawOffscreen(c);
    this.drawMarkers(c);
    this.drawBubbles(c, dt);
    this.drawPopups(c, dt);
    if (this.selectTarget && this.hoverPt) this.drawCrosshair(c);
  }

  /** 경계 확장으로 월드(캔버스) 밖에 있는 탄: 가장자리 화살표로 표시 */
  drawOffscreen(c) {
    const d = this.dpr, Wd = this.cv.width, Hd = this.cv.height, m = 7 * d;
    for (const p of this.projectiles) {
      if (!p.visible) continue;
      const X = this.sx(p.x), Y = this.sy(p.y);
      if (X >= 0 && X <= Wd && Y >= 0 && Y <= Hd) continue;
      const ex = Math.max(m, Math.min(Wd - m, X)), ey = Math.max(m, Math.min(Hd - m, Y));
      const ang = Math.atan2(Y - ey, X - ex);
      c.save(); c.translate(ex, ey); c.rotate(ang);
      c.fillStyle = playerColor(p.n || 1).P; c.strokeStyle = '#0B0E16'; c.lineWidth = 1.2 * d;
      c.beginPath(); c.moveTo(6 * d, 0); c.lineTo(-4 * d, -5 * d); c.lineTo(-4 * d, 5 * d); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
  }

  drawWalls(c) {
    let col = this.wallColor;
    c.save(); c.shadowColor = col; c.shadowBlur = 3 * this.ks; c.globalAlpha = 1; c.fillStyle = col;
    c.fillRect(0, 0, 2, this.H); c.fillRect(this.W - 2, 0, 2, this.H);
    c.restore();
  }

  drawTracePaths(c) {
    const T = A.fx.tracePath;
    for (const p of this.tracePaths) {
      if (p.pts.length < 2) continue;
      c.save(); c.strokeStyle = p.color; c.globalAlpha = T.alpha; c.lineJoin = 'round';
      c.shadowColor = p.color; c.shadowBlur = T.glowBlur * this.ks * 0.5;
      if (p.dashed) c.setLineDash(T.dashWhenGuided.map(v => v * this.ks));
      c.beginPath(); p.pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); this.strokeU(c, T.w); c.restore();
    }
  }

  drawTanks(c) {
    const dark = !!A.pal.skies[this.sky].darkSky, orig = this.tankSize !== 'big';
    // 원작(기본): 월드 1 game px = 스프라이트 4 unit 그대로, x 는 kx·y 는 ky → 그림 = 엔진 판정 상자(폭 9, 높이 6, TANK_HIT)
    //   (원본도 비정방 픽셀로 가로로 넓게 보였다). 포신은 같은 변환 안에서 엔진 각도로 돌리므로 화면 방향이 탄 진행과 일치
    // 크게: 정상 비율 균일 배율 kt(판정보다 큼, 식별용)
    const sxk = orig ? this.kx / this.ky : 1, k = orig ? this.ky : this.kt;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    for (const t of this.tanks.values()) {
      if (t.gone) continue;
      const gx = this.sx(t.x), gy = this.sy(t.y);
      let shield = null, shieldAlpha = 1;
      if (t.alive && t.shield && t.shield.fx) {
        shield = t.shield.fx; const hp = Math.max(0, Math.min(1, (t.shield.hp ?? 100) / (SHIELD_MAX[t.shield.item] || 100)));
        shieldAlpha = 0.35 + 0.65 * hp;
        if (hp < 0.25 && !reduced() && Math.floor(this.time * 12) % 2) shieldAlpha *= 0.4;
      }
      // 동시 모드 깜박임 피드백: flash {color,t}
      let alpha = 1;
      if (t.flash && this.time < t.flash.until) alpha = Math.floor(this.time * 10) % 2 ? 0.55 : 1;
      c.save(); c.translate(gx, gy); c.scale(sxk, 1);
      if (t.alive && t.id === this.turnId) {
        const ring = bitmap('fx/fx_turn_ring.svg', { [A.pal.tokens.P]: playerColor(t.n).P }, 15 * k, 4 * k);
        if (ring) c.drawImage(ring, -7.5 * k, -2.5 * k);
      }
      drawTankLayers(c, t.type, t.n, 0, 0, k, orig ? (t.angle ?? 45) : this.screenAngle(t.angle ?? 45), { wreck: !t.alive, glow: dark, shield, shieldAlpha, alpha, outline: orig });
      if (t.parachute && t.falling) this.drawParachute(c, 0, 0, k, t.n);
      c.restore();
      if (this.showGauge && t.alive) this.drawGauge(c, t, gx, gy);
    }
    c.restore();
  }
  /** 탱크 머리 위 기준 높이(device px): 마커·말풍선·팝업 위치 */
  tankTop(t) { return this.sy(t.y) - (this.tankSize !== 'big' ? TANK_HIT.height + 3 : 11) * (this.tankSize !== 'big' ? this.ky : this.kt); }

  /** 탱크 밑 상태 게이지(숫자 없음): 체력(초록→노랑→빨강), 방어막 보유 시 위에 하늘색 보조 줄. 폭은 탱크 배율 비례 */
  drawGauge(c, t, gx, gy) {
    const d = this.dpr, w = Math.max(18 * d, this.tankSize !== 'big' ? (2 * TANK_HIT.halfW + 1) * this.kx : 10 * this.kt), h = 3 * d, x = Math.round(gx - w / 2);
    let y = Math.round(gy + 2 * d);
    const bar = (frac, col) => {
      c.fillStyle = 'rgba(11,14,22,.85)'; c.fillRect(x - d, y - d, w + 2 * d, h + 2 * d);
      c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x, y, w, h);
      c.fillStyle = col; c.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
      y += h + 2 * d;
    };
    c.save(); c.globalAlpha = 0.95;
    if (t.shield) bar((t.shield.hp ?? 0) / (SHIELD_MAX[t.shield.item] || 100), '#5AC8FA');
    const p = Math.max(0, Math.min(1, (t.hp ?? 100) / 100));
    const col = p > 0.5 ? `hsl(${60 + (p - 0.5) * 2 * 60}, 85%, 50%)` : `hsl(${p * 2 * 60}, 90%, 52%)`;
    bar(p, col);
    c.restore();
  }

  drawParachute(c, gx, gy, k, n) {
    const top = gy - 22 * k;
    c.save(); c.fillStyle = playerColor(n).PL; c.strokeStyle = '#0B0E16'; c.lineWidth = 0.4 * k;
    c.beginPath(); c.arc(gx, top, 7 * k, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(gx - 7 * k, top); c.lineTo(gx - 3 * k, gy - 8 * k); c.moveTo(gx + 7 * k, top); c.lineTo(gx + 3 * k, gy - 8 * k); c.stroke();
    c.restore();
  }

  drawMarkers(c) {
    const k = this.kt, d = this.dpr, sz = this.markerSize();
    for (const t of this.tanks.values()) {
      if (!t.alive || t.gone) continue;
      const gx = this.sx(t.x), top = this.tankTop(t);
      const m = bitmap(`tanks/marker_${String(t.n).padStart(2, '0')}.svg`, null, sz, sz);
      if (m) c.drawImage(m, gx - sz / 2, top - sz);
      if (t.id === this.turnId) {
        const bounce = reduced() ? 0 : Math.sin(this.time / 0.8 * Math.PI * 2) * 2 * d;
        const ch = bitmap('fx/fx_turn_chevron.svg', { [A.pal.tokens.P]: playerColor(t.n).P }, 16 * d, 10.7 * d);
        if (ch) c.drawImage(ch, gx - 8 * d, top - sz - 13 * d + bounce);
      }
      if (this.readyIds.has(t.id)) {
        const ok = bitmap('fx/fx_ready_check.svg', null, 10 * d, 10 * d);
        if (ok) c.drawImage(ok, gx + sz / 2 - 2 * d, top - sz - 4 * d);
      }
      if (this.selectTarget) {
        c.save(); c.strokeStyle = '#FFFFFF'; c.lineWidth = 1.5 * d; c.setLineDash([3 * d, 2 * d]);
        c.beginPath(); c.arc(gx, this.sy(t.y) - 4 * k, 8 * k, 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
  }

  drawCrosshair(c) {
    const d = this.dpr, X = this.sx(this.hoverPt[0]), Y = this.sy(this.hoverPt[1]);
    c.save(); c.strokeStyle = '#FFFFFF'; c.lineWidth = 1.2 * d; c.shadowColor = '#000'; c.shadowBlur = 3 * d;
    c.beginPath(); c.arc(X, Y, 7 * d, 0, Math.PI * 2);
    c.moveTo(X - 11 * d, Y); c.lineTo(X - 3 * d, Y); c.moveTo(X + 3 * d, Y); c.lineTo(X + 11 * d, Y);
    c.moveTo(X, Y - 11 * d); c.lineTo(X, Y - 3 * d); c.moveTo(X, Y + 3 * d); c.lineTo(X, Y + 11 * d);
    c.stroke(); c.restore();
  }

  popup(id, text, dur = 1.2) { this.popups.push({ id, text, t: 0, dur }); }
  drawPopups(c, dt) {
    const d = this.dpr, k = this.kt;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]; p.t += dt;
      if (p.t > p.dur) { this.popups.splice(i, 1); continue; }
      const t = this.tanks.get(p.id); if (!t) continue;
      const f = p.t / p.dur, x = this.sx(t.x), y = this.tankTop(t) - (reduced() ? 0 : f * 18 * d);
      c.save(); c.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
      c.font = `800 ${16 * d}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.lineWidth = 3 * d; c.strokeStyle = '#0B0E16'; c.strokeText(p.text, x, y); c.fillStyle = '#FF6A5A'; c.fillText(p.text, x, y);
      c.restore();
    }
  }

  say(id, text, dur = 2.6) { if (!text) return; this.bubbles = this.bubbles.filter(b => b.id !== id); this.bubbles.push({ id, text, t: 0, dur }); }
  drawBubbles(c, dt) {
    const k = this.kt, d = this.dpr;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]; b.t += dt;
      if (b.t > b.dur) { this.bubbles.splice(i, 1); continue; }
      const t = this.tanks.get(b.id); if (!t) continue;
      c.save();
      c.font = `${12 * d}px var(--font, sans-serif)`; c.font = `${12 * d}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
      const tw = Math.min(c.measureText(b.text).width, 220 * d), pad = 6 * d, bw = tw + pad * 2, bh = 20 * d;
      let bx = this.sx(t.x) - bw / 2, by = this.tankTop(t) - 18 * d - bh - 10 * d;
      bx = Math.max(2 * d, Math.min(this.cv.width - bw - 2 * d, bx)); by = Math.max(2 * d, by);
      c.globalAlpha = b.t > b.dur - 0.3 ? (b.dur - b.t) / 0.3 : 1;
      c.fillStyle = '#F2F4F8'; c.strokeStyle = '#0B0E16'; c.lineWidth = 1.5 * d;
      c.beginPath(); c.roundRect ? c.roundRect(bx, by, bw, bh, 6 * d) : c.rect(bx, by, bw, bh); c.fill(); c.stroke();
      const tx = this.sx(t.x); c.beginPath(); c.moveTo(tx - 4 * d, by + bh); c.lineTo(tx, by + bh + 6 * d); c.lineTo(tx + 4 * d, by + bh); c.fill();
      c.fillStyle = '#0B0E16'; c.textBaseline = 'middle'; c.fillText(b.text, bx + pad, by + bh / 2, 220 * d);
      c.restore();
    }
  }

  // ---------- 투사체 ----------
  drawProjectiles(c, dt) {
    const P = A.fx.projectiles, scaleIcon = this.bombIcon === 'SMALL' ? 0.6 : 1, hidden = this.bombIcon === 'INVISIBLE';
    for (const p of this.projectiles) {
      if (!p.visible) continue;
      const def = P[p.kind] || P.missile;
      const col = playerColor(p.n || 1).P;
      // 꼬리
      const tr = def.trail;
      if (tr && tr.kind === 'ribbon' && p.hist.length > 1) {
        c.save(); c.globalCompositeOperation = tr.blend === 'lighter' ? 'lighter' : 'source-over'; c.lineCap = 'round';
        const now = this.time, colr = tr.color === '$player' ? col : tr.color;
        for (let i = 1; i < p.hist.length; i++) {
          const a = p.hist[i - 1], b = p.hist[i], age = (now - b[2]) / tr.life;
          if (age >= 1) continue;
          c.globalAlpha = lerp(tr.alpha[0], tr.alpha[1], age); c.strokeStyle = colr;
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); this.strokeU(c, Math.max(0.1, lerp(tr.w[0], tr.w[1], age)));
        }
        c.restore();
      } else if (tr && tr.kind === 'dots') {
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = col; const z = tr.r * this.ks;
        for (const q of p.hist) { const age = (this.time - q[2]) / tr.life; if (age >= 1) continue; c.globalAlpha = 1 - age; c.fillRect(this.sx(q[0]) - z / 2, this.sy(q[1]) - z / 2, z, z); }
        c.restore();
      } else if (tr && tr.kind === 'particles') {
        this.fx.trailParticles(tr, p.x, p.y, dt, p, { player: col });
      }
      if (p.kind === 'roller' && def.rollSparks && p.rolling) this.fx.trailParticles(def.rollSparks, p.x, p.y, dt, p.sp || (p.sp = {}), {});
      if (hidden) continue;
      // 몸체
      // 몸체는 화면 기준 정상 비율(위치만 월드→화면 변환)
      c.save(); const u = this.ks * scaleIcon; c.setTransform(u, 0, 0, u, this.sx(p.x), this.sy(p.y));
      const glow = def.glow === '$player' ? col : def.glow;
      if (glow) {
        let gr = def.glowR || 3; if (def.pulseHz) gr *= 0.8 + 0.2 * Math.sin(this.time * def.pulseHz * 6.28);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, gr); g.addColorStop(0, glow); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = def.flicker ? 1 - def.flicker * Math.random() : 0.9; c.fillStyle = g; c.fillRect(-gr, -gr, gr * 2, gr * 2);
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      }
      if (def.shape === 'capsule' || def.shape === 'drill') {
        c.rotate(Math.atan2(p.vy * this.ky, p.vx * this.kx)); c.fillStyle = def.core; c.beginPath();
        if (c.roundRect) c.roundRect(-def.len / 2, -def.w / 2, def.len, def.w, def.w / 2); else c.rect(-def.len / 2, -def.w / 2, def.len, def.w);
        c.fill();
      } else if (def.shape === 'ball') {
        c.rotate((p.dist || 0) / (def.r || 1.8)); c.fillStyle = def.fill; c.strokeStyle = def.outline; c.lineWidth = 0.4;
        c.beginPath(); c.arc(0, 0, def.r, 0, Math.PI * 2); c.fill(); c.stroke();
        c.strokeStyle = col; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-def.r, 0); c.lineTo(def.r, 0); c.stroke();
      } else if (def.shape === 'blob') {
        c.fillStyle = def.fill ? this.fx.resolve(def.fill) : def.core; c.beginPath(); c.arc(0, 0, def.r, 0, Math.PI * 2); c.fill();
        if (def.outline) { c.strokeStyle = def.outline; c.lineWidth = 0.35; c.stroke(); }
      } else {
        c.fillStyle = col; c.beginPath(); c.arc(0, 0, def.r || 0.9, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
  }
}
