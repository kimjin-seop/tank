// 엔진 샷 이벤트 재생기 (docs/ENGINE_API.md §3 이벤트 계약). tick 1 = 20ms.
// 이벤트 공통: { t, tick }. 지원: fire proj bounce wrap split explode terrain dirtFall hit hp tankFall death
//               shield roller digger napalm laser lightning flash retreat roundEnd talk
import { A, playerColor } from './assets.js';

export const TICK_MS = 20;
/**
 * 투사체 비행 재생 배율(docs/PLAYBACK_TIMING.md §5: 원본 비행 스텝 11.7ms vs 엔진 tick 20ms → 1.71).
 * 투사체가 날고 있는 동안만 재생 시계를 이 배율로 빨리 돌린다(폭발·흙·탱크 낙하 구간은 1배).
 * 조정: localStorage 'se.projRate' (예: 1, 1.71)
 */
export const PROJECTILE_RATE = (() => { try { const v = parseFloat(localStorage.getItem('se.projRate')); return v > 0 && v < 10 ? v : 1.71; } catch { return 1.71; } })();

const pairs = flat => { const out = []; if (!flat) return out; if (Array.isArray(flat[0])) return flat; for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };

export function projectileKind(weaponId) {
  const w = weaponId || '';
  if (w === 'baby_nuke' || w === 'nuke') return 'nuke';
  if (w.includes('napalm')) return 'napalm';
  if (w.includes('roller')) return 'roller';
  if (w.includes('digger') || w.includes('sandhog')) return 'digger';
  if (w === 'dirt_clod' || w === 'dirt_ball' || w === 'ton_of_dirt' || w === 'liquid_dirt' || w === 'dirt_charge') return 'dirt';
  if (w === 'tracer') return 'tracer';
  if (w === 'smoke_tracer') return 'smokeTracer';
  return 'missile';
}
// explode.kind → effects.json 폭발 키
const EXPLODE_FX = { missile: 'blast', blast: 'blast', nuke: 'nuke', death: 'blast', funky: 'funky', plasma: 'plasma', riot: 'riot', dirt: 'dirtAdd', dirtAdd: 'dirtAdd', sandhog: 'blast', lightning: 'blast' };

export function shotDuration(events) {
  let end = 0;
  for (const e of events || []) {
    let t = e.tick || 0;
    if (e.pts) t += pairs(e.pts).length;
    if (e.t === 'tankFall') t += e.ticks || 0;
    if (e.t === 'explode' && e.dur) t += e.dur;
    if (e.t === 'napalm' && e.dur) t += e.dur;
    if (e.t === 'digger' && e.worms) t += Math.max(0, ...e.worms.map(w => pairs(w.pts).length));
    end = Math.max(end, t);
  }
  return end * TICK_MS / 1000;
}

// deathFx variant → 사망 연출(fx.DEATH_VARIANTS 키). r 고정 반경 또는 radii[0]×k
const DEATH_FX = { 5: { fx: 'debris', k: 0.5 }, 6: { fx: 'dirtSpout', r: 20 }, 9: { fx: 'fireball' } };

export class Playback {
  constructor(r, events, { onEvent, onDone, seed = 1, speed = 1 } = {}) {
    this.r = r; this.onEvent = onEvent; this.onDone = onDone; this.speed = speed;
    this.ev = (events || []).map(e => ({ ...e, tick: e.tick || 0 })).sort((a, b) => a.tick - b.tick);
    this.t = 0; this.vt = 0; this.i = 0; this.active = []; this.falls = []; this.done = false; this.seed = seed; this.funkyN = 0;
    this.endT = shotDuration(this.ev);
    this.dies = new Set(this.ev.filter(e => e.t === 'death' && e.tank).map(e => e.tank)); // 이 샷에서 죽는 탱크
  }
  /** 샷 종료: 이 샷에서 죽은 탱크 잔해 제거(deathFx 가 없던 경로 포함, 원본처럼 사망 연출 뒤 탱크는 사라짐) */
  end() {
    for (const id of this.dies) { const t = this.tank(id); if (t && !t.alive) t.gone = true; }
    this.done = true; this.onDone && this.onDone();
  }

  step(dt) {
    if (this.done) return;
    this.t += dt * this.speed;
    const flying = this.active.some(a => a.proj);
    this.vt += dt * this.speed * (flying ? PROJECTILE_RATE : 1);   // 가상 재생 시계(초)
    const tick = this.vt * 1000 / TICK_MS;
    this.stepFalls(tick); // 흙 낙하 먼저 진행 → 같은 tick 의 terrain(최종 지형)이 마지막에 확정
    while (this.i < this.ev.length && this.ev[this.i].tick <= tick) { this.apply(this.ev[this.i]); this.i++; }
    for (let j = this.active.length - 1; j >= 0; j--) {
      const a = this.active[j], n = a.pts.length;
      const idx = Math.min(n - 1, Math.max(0, (tick - a.start) * a.rate));
      const i0 = Math.floor(idx), f = idx - i0, p0 = a.pts[i0], p1 = a.pts[Math.min(n - 1, i0 + 1)];
      const x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f;
      if (a.proj) {
        const p = a.proj, dx = x - p.x, dy = y - p.y;
        if (Math.abs(dx) > 40) p.hist = []; // 랩어라운드 점프
        else { if (dx || dy) { p.vx = dx; p.vy = dy; } p.dist += Math.hypot(dx, dy); }
        p.x = x; p.y = y; p.visible = true;
        p.hist.push([x, y, this.r.time]); if (p.hist.length > 120) p.hist.shift();
        if (a.trace) a.trace.pts.push([x, y]);
        if (p.kind === 'smokeTracer' && (a.k = (a.k || 0) + 1) % 3 === 0) this.r.smoke.push({ x, y, r: 1 + Math.random() * 1.6, color: playerColor(p.n).P });
      } else if (a.tank) { a.tank.x = x; a.tank.y = y; a.tank.falling = true; }
      if (idx >= n - 1) {
        this.active.splice(j, 1);
        if (a.proj) { const k = this.r.projectiles.indexOf(a.proj); if (k >= 0) this.r.projectiles.splice(k, 1); }
        if (a.tank) { a.tank.falling = false; if (n > 1 && Math.abs(a.pts[n - 1][1] - a.pts[0][1]) > 3) this.r.fx.landingDust(x, y, this.seed + j); }
      }
    }
    if (this.i >= this.ev.length && !this.active.length && !this.falls.length && this.vt >= this.endT) {
      this.tail = this.tail ?? this.vt;
      if (this.vt - this.tail > 0.4) this.end();
    }
  }
  /** 즉시 끝까지 적용(재접속·탭 비활성 복귀 등) */
  finish() {
    while (this.i < this.ev.length) { this.apply(this.ev[this.i], true); this.i++; }
    for (const a of this.active) {
      const last = a.pts[a.pts.length - 1];
      if (a.tank) { a.tank.x = last[0]; a.tank.y = last[1]; a.tank.falling = false; }
      if (a.proj) { const k = this.r.projectiles.indexOf(a.proj); if (k >= 0) this.r.projectiles.splice(k, 1); }
    }
    this.active = []; this.falls = []; this.end();
  }

  /**
   * dirtFall(ENGINE_API §3): 열 x 의 y0..y1 덩어리가 t0 tick 부터 tick 당 rate px 씩 dy 만큼 하강.
   * 엔진과 같은 방식(맨 위 셀 지우고 맨 아래 아래 셀 채움)으로 마스크를 직접 갱신. 최종 지형은 뒤따르는 terrain 이벤트가 확정
   */
  startFall(e) {
    const sp = (e.spans || []).map(c => ({ x: c.x, y0: c.y0, y1: c.y1, dy: c.dy || 0, t0: c.t0 ?? e.tick, cur: 0 })).filter(c => c.dy > 0);
    if (!sp.length) return;
    const end = (e.tick || 0) + (e.dur || 0);
    // rate(tick당 px): 엔진이 준 값(server/engine/config.js DIRT_FALL_RATE 반영). 없으면(구 엔진·목업) 마지막 덩어리 착지 = tick + dur 이 되는 ft 로 역산
    let rate = e.rate > 0 ? e.rate : 0;
    if (!rate) { let ft = 1; for (let f = 1; f <= 100; f++) { if (Math.max(...sp.map(c => c.t0 + c.dy * f)) >= end) { ft = f; break; } } rate = 1 / ft; }
    this.falls.push({ sp, rate, end });
  }
  stepFalls(tick) {
    if (!this.falls.length) return;
    const T = this.r.terrain;
    for (let k = this.falls.length - 1; k >= 0; k--) {
      const F = this.falls[k]; let live = false;
      for (const c of F.sp) {
        const want = Math.max(0, Math.min(c.dy, Math.floor((tick - c.t0) * F.rate + 1e-6)));
        while (c.cur < want) { T.setCell(c.x, c.y0 + c.cur, 0); T.setCell(c.x, c.y1 + 1 + c.cur, 1); c.cur++; }
        if (c.cur < c.dy) live = true;
      }
      if (!live) this.falls.splice(k, 1);
    }
  }

  tank(id) { return this.r.tanks.get(id); }
  nOf(id) { return this.tank(id)?.n || 1; }

  addPath(pts, tick, { kind, owner, guided, rate = 1 }) {
    pts = pairs(pts); if (!pts.length) return;
    const n = this.nOf(owner);
    const proj = { kind, n, x: pts[0][0], y: pts[0][1], vx: 1, vy: 0, dist: 0, hist: [], visible: true, seed: this.seed + this.i };
    this.r.projectiles.push(proj);
    let trace = null;
    if (this.r.tracePathsOn && kind !== 'digger') { trace = { color: playerColor(n).P, pts: [], dashed: !!guided }; this.r.tracePaths.push(trace); }
    this.active.push({ pts, start: tick, rate, proj, trace });
  }

  apply(e, silent = false) {
    const r = this.r, fx = r.fx, seed = this.seed * 131 + this.i;
    const tk = this.tank(e.tank);
    if (silent && ['proj', 'roller', 'digger', 'tankFall', 'explode', 'laser', 'napalm', 'lightning', 'flash', 'split', 'bounce', 'dirtFall', 'deathFx'].includes(e.t)) {
      if (e.t === 'tankFall' && tk) { tk.x = e.x ?? tk.x; tk.y = e.y1; }
      if (e.t === 'deathFx' && tk) tk.gone = true;
      this.onEvent && this.onEvent(e);
      return;
    }
    switch (e.t) {
      case 'fire': { const t = this.tank(e.pid); if (t && e.angle != null) t.angle = e.angle; break; }
      case 'proj': this.addPath(e.pts, e.tick, { kind: projectileKind(e.weapon), owner: e.pid, guided: e.guided }); break;
      case 'roller': this.addPath(e.pts, e.tick, { kind: 'roller', owner: e.pid }); break;
      case 'digger': for (const w of e.worms || []) this.addPath(w.pts, e.tick, { kind: 'digger', owner: e.pid }); break;
      case 'bounce': fx.wallHit(e.x, e.y, r.wallColor, seed); break;
      case 'split': fx.mirvSplit(e.x, e.y); break;
      case 'explode': {
        const key = EXPLODE_FX[e.kind] || 'blast', player = playerColor(this.nOf(e.pid)).P;
        if (key === 'riot') fx.riot(e.x, e.y, e.r, { seed, angle: e.angle, wedge: e.wedge || 0 });
        else if (key === 'dirtAdd') fx.dirtAdd(e.x, e.y, e.r, seed);
        else if (e.kind === 'death') fx.tankDeathBlast(e.x, e.y, e.r, seed, e.variant || e.deathKind || 'fireball'); // 엔진 반경 그대로, 변종 필드는 스키마 확정 시 맞춤
        else if (key === 'funky') fx.explode('blast', e.x, e.y, e.r, { seed, player, hue: A.fx.explosions.funky.childHues[this.funkyN++ % 6] });
        else fx.explode(key, e.x, e.y, e.r, { seed, player, terrainHit: e.terrainHit !== false });
        break;
      }
      case 'dirtFall': this.startFall(e); break;
      case 'terrain': this.falls = this.falls.filter(F => F.end > e.tick); // 끝난 낙하는 최종 지형으로 강제 동기화
        if (e.spans) r.terrain.applySpans(e.spans); else if (e.terrain) r.terrain.load(e.terrain); break;
      case 'hit': if (e.kind === 'shieldDirect' && tk?.shield) fx.shieldHit(tk.shield.fx, tk.x, tk.y, 90, seed); break;
      case 'hp': if (tk) {
        if (e.hp != null) tk.hp = e.hp; if (tk.shield && e.shield != null) tk.shield.hp = e.shield;
        if ((e.kind === 'fall' || e.kind === 'crush') && e.delta < 0) r.popup(e.tank, String(e.delta)); // 낙하 피해 수치(체력 바는 숨김 유지)
      } break;
      case 'tankFall': if (tk) {
        const y0 = e.y0 ?? tk.y, y1 = e.y1 ?? tk.y, n = Math.max(2, (e.ticks || Math.abs(y1 - y0)) + 1), x = e.x ?? tk.x, pts = [];
        for (let i = 0; i < n; i++) pts.push([x, y0 + (y1 - y0) * i / (n - 1)]);
        tk.parachute = !!e.chute;
        this.active.push({ pts, start: e.tick, rate: 1, tank: tk });
      } break;
      case 'death': if (tk) {
        tk.alive = false; tk.hp = 0; tk.shield = null;
        // 엔진은 이어서 explode kind:'death'(반경 r)를 보낸다. 없을 때(구 엔진·목업 일부)만 기본 반경 폭발
        // deathFx 변종 5·6·9 는 explode 없이 terrain 만 오므로 폭발은 deathFx 처리에서 그림
        const big = this.ev.some(x => x.tick >= e.tick && ((x.t === 'explode' && x.kind === 'death' && Math.abs((x.x ?? 0) - (e.x ?? tk.x)) <= 3) || (x.t === 'deathFx' && x.tank === e.tank && DEATH_FX[x.variant])));
        fx.tankDeath(tk.x, tk.y - 3, big ? -1 : 0, seed);
      } break;
      case 'deathFx': { // 서버가 explode 를 내지 않는 변종(5 고리 분출·6 흙 장약·9 흙 덩어리)만 연출 보강. radii[0] = 엔진 반경
        const d = DEATH_FX[e.variant];
        if (d && tk) fx.tankDeathBlast(tk.x, tk.y - 3, d.r ?? (e.radii?.[0] || 30) * (d.k || 1), seed, d.fx);
        if (tk) tk.gone = true; // 사망 폭발 시작(같은 tick 의 explode kind:'death' 포함)과 함께 잔해 제거
        break;
      }
      case 'shield': if (tk) {
        if (e.kind === 'on') tk.shield = { item: e.item, hp: e.hp, fx: shieldFx(e.item) };
        else if (e.kind === 'off') tk.shield = null;
        else if (e.kind === 'break') { fx.shieldBreak(tk.shield?.fx || shieldFx(e.item), tk.x, tk.y, seed); tk.shield = null; }
        else if (e.kind === 'reflect' && tk.shield) fx.shieldHit(tk.shield.fx, tk.x, tk.y, 90, seed);
      } break;
      case 'napalm': {
        const px = pairs(e.pixels || e.records || []), cells = [];
        const stepN = Math.max(1, Math.floor(px.length / 60));
        for (let i = 0; i < px.length; i += stepN) cells.push([px[i][0], px[i][1], 0.6]);
        fx.napalm(cells, ((e.dur || 75) * TICK_MS) / 1000, e.kind === 'hot_napalm' || e.kind === 'hot', seed);
        break;
      }
      case 'laser': fx.laser([[e.x0, e.y0], [e.x1, e.y1]], playerColor(this.nOf(e.pid)).P, seed); break;
      case 'lightning': fx.lightning(e.x, e.y, r.H, seed); break;
      case 'flash': { const L = A.fx.explosions.lightning.screenFlash; fx.fx.push({ kind: 'screen', color: L.color, alpha: L.alpha, ts: L.t, t: 0, dur: L.t[1] }); break; }
      case 'retreat': if (tk) { tk.alive = false; tk.gone = true; } break;
      case 'talk': r.say(e.tank ?? e.pid, e.text); break;
      default: break;
    }
    this.onEvent && this.onEvent(e);
  }
}

export function shieldFx(item) {
  return { mag_deflector: 'shield', shield: 'shield', force_shield: 'force', heavy_shield: 'heavy', super_mag: 'supermag' }[item] || 'shield';
}
