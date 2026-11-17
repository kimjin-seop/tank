// Computer players (RE §10, 11b5/1e50/1276): 7 types + Unknown. Mixed into Game.prototype.
import { Game } from './game.js';
import { TANK, AI_TYPES } from './config.js';
import { BY_ID, SHIELDS } from './weapons.js';

const P = Game.prototype;
const DEG = 180 / Math.PI;

/** Analytic ballistic solver (RE §10, 1e50:05e9). Returns power or -1 (unreachable) / -2 (degenerate angle). No viscosity term (matches manual). */
export function solveBallistic({ dx, dy, angleDeg, gravity, wind }) {
  const g = gravity, a = wind / 2000;
  const ge = Math.sqrt(g * g + a * a);
  const phi = a === 0 ? 0 : Math.atan(a / g);
  let dxr = dx, dyr = dy, th = angleDeg / DEG;
  if (a !== 0) {                                           // rotate so the effective gravity points straight down
    dxr = dx * Math.cos(phi) + dy * Math.sin(phi);
    dyr = -dx * Math.sin(phi) + dy * Math.cos(phi);
    th -= phi;
  }
  const c = Math.cos(th);
  if (Math.abs(c) < 1e-6) return -2;
  const den = 2 * c * c * (dxr * Math.tan(th) - dyr);
  if (den <= 0) return -1;
  const v2 = ge * dxr * dxr / den;
  if (!(v2 > 0)) return -1;
  return Math.sqrt(v2) * 50;
}

P._aiResolveType = function (p) {
  if (p.aiType === 'unknown') p.aiType = AI_TYPES[this.rng.int(7)];       // hidden type: rand(7)+1 (RE §10)
  return p.aiType;
};

P._aiLos = function (p, t) {                                              // clear straight line between turret and target
  const T = this.terrain, pv = this._pivot(p), ty = this._cy(t);
  const n = Math.max(2, Math.ceil(Math.hypot(t.x - pv.x, ty - pv.y)));
  for (let i = 3; i < n - 3; i++) {
    const x = Math.round(pv.x + (t.x - pv.x) * i / n), y = Math.round(pv.y + (ty - pv.y) * i / n);
    if (T.solid(x, y)) return false;
  }
  return true;
};

P._aiSolve = function (p, t, angle) {
  const pv = this._pivot(p);
  const dx = t.x - pv.x, dy = pv.y - this._cy(t);
  const pw = solveBallistic({ dx, dy, angleDeg: angle, gravity: this.options.gravity, wind: this.wind });
  if (pw <= 0) return pw;
  // The analytic solution assumes continuous time; the engine integrates with Euler steps (RE §3.2), which
  // shifts the landing by ~0.1 px per step. Refine locally by simulation (estimated: original feedback loop). Viscosity is not corrected.
  let best = Math.round(pw), bm = Infinity;
  const max = p.hp * 10;
  for (let q = Math.max(0, Math.round(pw) - 14); q <= Math.min(max, Math.round(pw) + 14); q++) {
    const m = this._simMiss(p, angle, q, t.x, this._cy(t), false);
    if (m < bm) { bm = m; best = q; }
  }
  return best;
};

P._aiEnemies = function (p) { return this.alive().filter((t) => t !== p && !this.friendly(p, t)); };

const DAMAGING = ['deaths_head', 'nuke', 'mirv', 'baby_nuke', 'leap_frog', 'funky_bomb', 'hot_napalm', 'napalm', 'heavy_roller', 'roller', 'missile', 'baby_roller', 'baby_missile'];
P._aiPickWeapon = function (p, distToTarget, random) {                    // 11b5:0abc (details 미상: estimated)
  const owned = DAMAGING.filter((id) => p.inv[BY_ID[id].idx] > 0);
  if (random) return owned.length ? owned[this.rng.int(owned.length)] : 'baby_missile';
  for (const id of owned) {
    const w = BY_ID[id];
    const R = (w.kind === 'explode' || w.kind === 'roller') ? w.param * this.scale : w.kind === 'mirv' ? (w.param ? 35 : 20) * this.scale : w.kind === 'leapfrog' ? 30 * this.scale : w.kind === 'funky' ? 80 : 30;
    if (distToTarget > R + 15 || id === 'baby_missile') return id;                 // do not blast ourselves
  }
  return 'baby_missile';
};

/** returns {angle, power} for a chosen target, per type. null power -> fall back */
P._aiAim = function (p, type, target) {
  const rng = this.rng;
  const right = target.x >= p.x;
  const shooter = () => {
    const base = Math.round(Math.atan2(p.y - this._cy(target), Math.abs(target.x - p.x)) * DEG);   // starting angle toward target
    let ang = Math.max(5, Math.min(85, base + 15));
    for (let tries = 0; tries < 12; tries++) {
      const a = right ? ang : 180 - ang;
      const pw = this._aiSolve(p, target, a);
      if (pw > 0) return { angle: a, power: pw };
      ang = Math.min(85, ang + 5);
    }
    return null;
  };
  const spoiler = () => {
    for (const ang of [65, 55, 75, 45, 85, 35]) {
      const a = right ? ang : 180 - ang;
      const pw = this._aiSolve(p, target, a);
      if (pw > 0) return { angle: a, power: pw };
    }
    return null;
  };
  const tosser = () => {
    const m = p.aiMemo;
    if (m.tosserFor !== target.id || m.angle === undefined) { m.tosserFor = target.id; m.angle = rng.int(70) + 10; m.power = (rng.int(Math.max(1, p.hp)) + 1) * 10; }
    else if (p.lastImpact) {                                              // feedback: +-10 power by previous landing
      const short = Math.abs(p.lastImpact.x - p.x) < Math.abs(target.x - p.x);
      m.power += short ? 10 : -10;
    }
    return { angle: right ? m.angle : 180 - m.angle, power: m.power };
  };
  const poolshark = () => {                                               // reflect off the wall: mirror the target (rubber only exact)
    if (this.wallCode === 3 || this.wallCode === 4) {
      const W = this.options.width - 1;
      const mx = right ? 2 * W - target.x : -target.x;
      const mt = { ...target, x: mx };
      for (const ang of [55, 45, 65]) {
        const a = right ? ang : 180 - ang;
        const pw = this._aiSolve(p, mt, a);
        if (pw > 0) return { angle: a, power: pw };
      }
    }
    return shooter() || spoiler();
  };
  switch (type) {
    case 'shooter': return (this._aiLos(p, target) ? shooter() : tosser()) || tosser();
    case 'poolshark': return poolshark() || tosser();
    case 'tosser': return tosser();
    case 'chooser':
      if (this._aiLos(p, target)) return shooter() || spoiler() || tosser();
      if (this.wallCode === 3 || this.wallCode === 4) return poolshark() || tosser();
      return spoiler() || tosser();
    case 'spoiler': return spoiler() || tosser();
    case 'cyborg': return spoiler() || shooter() || tosser();
    default: return null;
  }
};

P.aiAct = function (playerId) {
  const p = this.P(playerId);
  if (!p) return this._err('NO_PLAYER', 'unknown player');
  if (!p.alive) return this._err('NOT_ALIVE', 'tank is dead');
  if (!p.cpu) return this._err('NOT_CPU', 'not a computer player');
  const type = this._aiResolveType(p);
  const pre = [];
  // 1. battery when energy < 85 (RE §10)
  for (let i = 0; i < 3 && p.hp < 85 && p.inv[BY_ID.battery.idx] > 0; i++) { const r = this.useBattery(playerId); if (r.ok) pre.push(...r.events); else break; }
  // 2. best shield / parachute on
  if (!p.shield) {
    const best = Object.keys(SHIELDS).filter((id) => p.inv[BY_ID[id].idx] > 0).sort((a, b) => SHIELDS[b].hp - SHIELDS[a].hp)[0];
    if (best) { const r = this.shield(playerId, best); if (r.ok) pre.push(...r.events); }
  }
  p.chuteOn = true;
  const enemies = this._aiEnemies(p);
  let angle, power, weapon;
  if (!enemies.length) { angle = 90; power = 200; weapon = 'baby_missile'; }
  else if (type === 'moron') {
    const t = enemies.slice().sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    angle = t.x >= p.x ? this.rng.int(91) : 90 + this.rng.int(91);        // never toward the empty side
    power = (this.rng.int(p.hp) + 1) * 10;
    weapon = this._aiPickWeapon(p, 0, true);
  } else {
    let target;
    if (type === 'cyborg') {                                              // weakest / attacker first (score is estimated)
      const scoreOf = (t) => t.hp + (t.shield ? t.shield.hp : 0) - 0.05 * Math.abs(t.x - p.x) + (p.aiMemo.attacker === t.id ? -30 : 0);
      target = enemies.slice().sort((a, b) => scoreOf(a) - scoreOf(b))[0];
    } else {
      const los = enemies.filter((t) => this._aiLos(p, t)).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
      target = los[0] || enemies.slice().sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    }
    const aim = this._aiAim(p, type, target);
    angle = aim.angle; power = aim.power;
    weapon = this._aiPickWeapon(p, Math.hypot(target.x - p.x, this._cy(target) - p.y), false);
  }
  power = Math.max(0, Math.min(p.hp * 10, Math.round(power)));
  angle = Math.max(0, Math.min(180, Math.round(angle)));
  return { ok: true, weapon, angle, power, pre };
};

P.aiTurn = function (playerId) {
  const a = this.aiAct(playerId);
  if (!a.ok) return a;
  const { pre, ...input } = a;
  delete input.ok;
  const r = this.fire(playerId, input);
  if (!r.ok) return { ...r, pre };
  const p = this.P(playerId);
  const ex = r.events.find((e) => e.t === 'explode');
  if (ex) p.lastImpact = { x: ex.x, y: ex.y };                           // feedback for Tosser etc.
  return { ...r, pre, input };
};
