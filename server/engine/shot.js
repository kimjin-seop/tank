// Shot resolution: flight, impacts, weapon handlers, damage, settle (RE §3, §5, §6).
// Mixed into Game.prototype by index.js. All timing is in ticks (1 tick = 20 ms = one integration step).
import { Game } from './game.js';
import { physConsts, flightConsts, launchVelocity, stepProjectile } from './physics.js';
import { TANK, DIRT_BASE, WALLS } from './config.js';
import { BY_ID, WEAPONS, SHIELDS, GUIDANCE_KIND, UNGUIDABLE, MAX_HP } from './weapons.js';
import { dirtFall } from './dirtfall.js';

const r2 = (v) => Math.round(v * 100) / 100;
const MAX_FLIGHT_STEPS = 60000;
const WALL_COEF = { 2: -0.5, 3: -1.0, 4: -2.0 };          // RE §8.5: padded, rubber, spring
const HEAT_RANGE = 70;                                    // estimated (RE §6 "미상")
const GUIDE_SPEED = 250;                                  // estimated
const MAG_RANGE = 45;                                     // estimated (RE §6 "미상")
const P = Game.prototype;

// ---------------------------------------------------------------- shot context
P._newShot = function () {
  const before = new Map();
  for (const p of this.players) before.set(p.id, JSON.stringify(this.view(p)));
  return { events: [], seq: 0, cursor: 0, now: 0, before, deadQueue: [], forceDirt: false, spawn: [], windBefore: this.wind };
};
P._ev = function (shot, e) { e.seq = shot.seq++; shot.events.push(e); return e; };
P._finishEvents = function (shot) {
  const ev = shot.events.slice().sort((a, b) => (a.tick - b.tick) || (a.seq - b.seq));
  for (const e of ev) delete e.seq;
  shot.ticks = ev.reduce((m, e) => Math.max(m, e.tick + (e.dur || 0)), 0);
  return ev;
};
P._stateOf = function (shot) {
  const tanks = {}, players = {};
  for (const p of this.players) {
    const now = this.view(p);
    const old = JSON.parse(shot.before.get(p.id));
    const d = {};
    for (const k of Object.keys(now)) if (JSON.stringify(now[k]) !== JSON.stringify(old[k])) d[k] = now[k];
    if (Object.keys(d).length) tanks[p.id] = d;
    if (d.cash !== undefined || d.score !== undefined) players[p.id] = { cash: now.cash, score: now.score };
  }
  const st = { tanks, players };
  if (this.wind !== shot.windBefore) st.wind = this.wind;
  return st;
};
P._fallTicks = function () { return Math.max(1, Math.round(this.options.fallingDelay / 10)); };

// ---------------------------------------------------------------- geometry helpers
P._cy = function (t) { return t.y - TANK.shieldCy; };
P._bodyContains = function (t, x, y) {
  return t.alive && Math.abs(x - t.x) <= TANK.halfW && y >= t.y - TANK.height + 1 && y <= t.y;
};
P._tankAt = function (x, y) { for (const t of this.players) if (this._bodyContains(t, x, y)) return t; return null; };
P._shieldContains = function (t, x, y) {
  if (!t.alive || !t.shield || t.shield.hp <= 0) return false;
  const dx = x - t.x, dy = y - this._cy(t);
  return dx * dx + dy * dy <= TANK.shieldR * TANK.shieldR;
};
P._pivot = function (t) { return { x: t.x, y: t.y - TANK.pivotDy }; };
/** Barrel tip = launch position (original turret code 3912:021f, verified vs scenario_001 and a 10-angle sweep):
 *  facing = +1 for angle < 90, -1 for angle > 90 (90 keeps the tank's last facing); a = (facing==1 ? angle : 180-angle) * 0.017453293;
 *  y = cy - 5 + trunc(-sin(a)*8); x = cx - 2*facing + floor(trunc(+-cos(a)*8) * 36044 / 65536)  (36044/65536 = 0.55 pixel aspect, DS:EF34). */
P._tip = function (t, angle) {
  const facing = angle < 90 ? 1 : angle > 90 ? -1 : (t.facing || 1);
  const a = (facing === 1 ? angle : 180 - angle) * 0.017453293;
  const dy = Math.trunc(-Math.sin(a) * TANK.barrel);
  const c = Math.trunc((facing === 1 ? 1 : -1) * Math.cos(a) * TANK.barrel);
  return { x: t.x - 2 * facing + Math.floor(c * 36044 / 65536), y: t.y - TANK.pivotDy + dy };
};

// ---------------------------------------------------------------- damage / score (RE §6, §7)
P._addScore = function (p, pts) {
  if (!pts) return;
  p.score += pts;
  p.bank.cash = Math.max(0, p.bank.cash + pts);
};

P.damageTank = function (shot, tank, dmg, src) {
  if (!tank.alive || dmg <= 0) return;
  dmg = Math.trunc(dmg);
  let absorbed = 0;
  if (tank.shield && tank.shield.hp > 0) { absorbed = Math.min(dmg, tank.shield.hp); tank.shield.hp -= absorbed; }   // ShieldAbsorb 3191:0034
  const rest = dmg - absorbed;
  const owner = src.owner || null;
  if (owner && owner !== tank && this.options.scoring !== 'basic') {                                              // RE §7
    if (this.friendly(owner, tank)) this._addScore(owner, -15 * rest - 1 * absorbed);
    else this._addScore(owner, 30 * rest + 2 * absorbed);
  }
  const hpBefore = tank.hp;
  tank.hp = Math.max(0, tank.hp - rest);
  if (tank.power > tank.hp * 10) tank.power = tank.hp * 10;
  this._ev(shot, { t: 'hp', tick: shot.now, tank: tank.id, hp: tank.hp, delta: tank.hp - hpBefore, shield: tank.shield ? tank.shield.hp : 0, shieldDelta: -absorbed, src: owner ? owner.id : null, kind: src.kind || null });
  if (tank.shield && tank.shield.hp <= 0) {
    this._ev(shot, { t: 'shield', tick: shot.now, tank: tank.id, item: tank.shield.item, hp: 0, kind: 'break' });
    tank.shield = null;
  }
  if (tank.hp <= 0) this._die(shot, tank, owner);
};

P._shieldHit = function (shot, tank, dmg, owner) {          // shield pixel direct hit: shield only (RE §5.2)
  const ab = Math.min(dmg, tank.shield.hp);
  tank.shield.hp -= ab;
  if (owner && owner !== tank && this.options.scoring !== 'basic') this._addScore(owner, this.friendly(owner, tank) ? -ab : 2 * ab);
  this._ev(shot, { t: 'hp', tick: shot.now, tank: tank.id, hp: tank.hp, delta: 0, shield: tank.shield.hp, shieldDelta: -ab, src: owner ? owner.id : null, kind: 'shieldDirect' });
  if (tank.shield.hp <= 0) {
    this._ev(shot, { t: 'shield', tick: shot.now, tank: tank.id, item: tank.shield.item, hp: 0, kind: 'break' });
    tank.shield = null;
  }
};

P._die = function (shot, tank, owner) {
  if (!tank.alive) return;
  tank.alive = false; tank.hp = 0; tank.shield = null; tank.power = 0;
  this._ev(shot, { t: 'death', tick: shot.now, tank: tank.id, killer: owner ? owner.id : null, x: tank.x, y: tank.y });
  const basic = this.options.scoring === 'basic';
  if (owner) {                                             // RE §7: kill +500 (BASIC +4000), team kill -2000, suicide -1500
    if (owner === tank) this._addScore(owner, -1500);
    else if (this.friendly(owner, tank)) this._addScore(owner, -2000);
    else { this._addScore(owner, basic ? 4000 : 500); owner.stats.kills++; }
  }
  shot.deadQueue.push(tank);
};

// ---------------------------------------------------------------- fireball / explosion (RE §5.2)
const fireDur = (R) => Math.ceil(R / (R < 40 ? 1 : 2)) + (R > 30 ? 13 : 0);     // growth frames + 49x5ms palette rotation (~13 ticks)

P._carve = function (shot, tick, x, y, R) {
  const spans = this.terrain.disc(x, y, R, 0);
  if (spans.length) this._ev(shot, { t: 'terrain', tick, spans });
};

P._radialDamages = function (x, y, R, mult, extra = {}) {       // returns [{tank, dmg}] without applying
  const out = [];
  for (const t of this.players) {
    if (!t.alive || (extra.exclude && extra.exclude === t)) continue;
    const dx = x - t.x, dy = y - this._cy(t);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (R > d) {
      let dmg = Math.trunc((R - d) * 100.0 / R) * mult;
      if (extra.plus) { dmg = Math.trunc((R - d) * 100.0 / R) + extra.plus; }
      if (dmg > 100) dmg = 110;
      out.push({ tank: t, dmg });
    }
  }
  return out;
};

/** Standard explosion explode(x,y,R) 3d1e:015a. mult = weaponIndex+1 (RE §5.2). */
P._explode = function (shot, o) {
  const { x, y, R, kind, owner, mult } = o;
  const tick = Math.max(shot.cursor, o.tick ?? 0);
  const dur = fireDur(R);
  const end = tick + dur;
  this._ev(shot, { t: 'explode', tick, x, y, r: R, kind, dur, ...(o.color !== undefined ? { color: o.color } : {}) });
  shot.now = end;
  if (o.carve !== false) this._carve(shot, end, x, y, R);
  if (o.damage !== false) for (const { tank, dmg } of this._radialDamages(x, y, R, mult)) this.damageTank(shot, tank, dmg, { owner, idx: mult - 1, kind });
  shot.cursor = end;
  return end;
};

// ---------------------------------------------------------------- firing
P.fire = function (playerId, input = {}) { return this.fireVolley([{ ...input, playerId }]); };

P._err = function (error, message) { return { ok: false, error, message }; };

P._prepareFire = function (inp) {
  const p = this.P(inp.playerId);
  if (!p) return { error: 'NO_PLAYER', message: 'unknown player' };
  if (!p.alive) return { error: 'NOT_ALIVE', message: 'tank is dead' };
  const w = BY_ID[inp.weapon ?? p.weapon];
  if (!w || w.idx > 32) return { error: 'BAD_ARGS', message: 'unknown weapon' };
  if (w.idx !== 0 && p.inv[w.idx] <= 0) return { error: 'NO_WEAPON', message: 'weapon not owned' };
  const angle = inp.angle === undefined ? p.angle : inp.angle;
  const power = inp.power === undefined ? p.power : inp.power;
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) return { error: 'BAD_ARGS', message: 'angle out of range' };
  if (!Number.isFinite(power) || power < 0 || power > p.hp * 10) return { error: 'BAD_POWER', message: 'power out of range' };
  let guide = null;
  const gtype = inp.guidance ?? (p.guidance && p.guidance.type);
  if (gtype && !UNGUIDABLE.has(w.id) && w.idx <= 30) {
    const gid = GUIDANCE_KIND[gtype];
    if (!gid) return { error: 'BAD_ARGS', message: 'unknown guidance' };
    if (p.inv[BY_ID[gid].idx] <= 0) return { error: 'NO_ITEM', message: 'guidance not owned' };
    let target = inp.target ?? (p.guidance && p.guidance.target);
    let tx = null, ty = null, tankId = null;
    if (target !== null && target !== undefined) {
      if (typeof target === 'object') { tx = target.x; ty = target.y; }
      else { const tt = this.P(target); if (tt) { tx = tt.x; ty = this._cy(tt); tankId = tt.id; } }
    }
    if (gtype !== 'heat' && (tx === null || !Number.isFinite(tx) || !Number.isFinite(ty))) return { error: 'BAD_ARGS', message: 'target required' };
    guide = { type: gtype, item: gid, tx, ty, tankId };
  }
  const wantTrigger = inp.trigger ?? p.trigger;
  if (wantTrigger && p.inv[BY_ID.contact_trigger.idx] <= 0) return { error: 'NO_ITEM', message: 'no contact trigger' };
  let batteries = 0;
  if (w.kind === 'plasma' || w.kind === 'laser') batteries = Math.max(0, Math.min(10, Math.trunc(inp.batteries ?? 0), p.inv[BY_ID.battery.idx]));
  return { p, w, angle: Math.trunc(angle), power: Math.trunc(power), guide, trigger: !!wantTrigger, batteries };
};

P.fireVolley = function (inputs) {
  if (!this.roundActive) return this._err('ROUND_OVER', 'no active round');
  if (this.roundOver().over) return this._err('ROUND_OVER', 'round is over');
  const shot = this._newShot();
  this.dirtFlag = 0;
  const valid = [], rejected = [];
  const used = new Set();
  for (const inp of inputs) {
    const r = this._prepareFire(inp);
    if (r.error || used.has(r.p.id)) rejected.push({ playerId: inp.playerId, error: r.error || 'DUPLICATE', message: r.message || 'duplicate shooter' });
    else { valid.push(r); used.add(r.p.id); }
  }
  if (!valid.length) return { ...rejected[0], ok: false, rejected };
  // ammo/consumption, then launch
  const projs = [];
  let erraticWall = null;
  for (const v of valid) {
    const { p, w } = v;
    if (w.idx !== 0) p.inv[w.idx]--;
    if (v.guide) p.inv[BY_ID[v.guide.item].idx]--;
    if (v.trigger) p.inv[BY_ID.contact_trigger.idx]--;
    if (v.batteries) p.inv[BY_ID.battery.idx] -= v.batteries;
    p.angle = v.angle; p.power = v.power; p.weapon = w.id;
    if (v.angle !== 90) p.facing = v.angle > 90 ? -1 : 1;
    if (w.idx !== 0 && p.inv[w.idx] <= 0) p.weapon = 'baby_missile';
    p.guidance = null; p.trigger = false;
  }
  if (this.options.wall === 'erratic') { this.wallCode = this.rng.int(6); this.wall = WALLS[this.wallCode]; }
  for (const v of valid) projs.push(...this._launch(shot, v));
  const impacts = this._flight(shot, projs, 0);
  impacts.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  for (const imp of impacts) this._resolve(shot, imp);
  this._settle(shot);
  const over = this.roundOver();
  if (over.over) this._ev(shot, { t: 'roundEnd', tick: shot.cursor, winners: over.aliveIds });
  const events = this._finishEvents(shot);
  return { ok: true, events, state: this._stateOf(shot), ticks: shot.ticks, roundOver: over.over, ...(rejected.length ? { rejected } : {}) };
};

P._newProj = function (shot, owner, w, x, y, vx, vy, extra = {}) {
  return { id: ++this.projSeq, owner, w, x, y, vx, vy, lx: Math.trunc(x), ly: Math.trunc(y), bounces: 0, damp: 1, pts: [r2(x), r2(y)], born: 0, split: false, group: null, exited: !owner, contact: false, guide: null, straight: false, steps: 0, ...extra };
};

/** returns projectiles to fly (immediate weapons are resolved here at tick 0) */
P._launch = function (shot, v) {
  const { p, w } = v;
  const pv = this._pivot(p);
  const a = v.angle * 0.017453293;
  const tip0 = this._tip(p, v.angle), tipX = tip0.x, tipY = tip0.y;
  this._ev(shot, { t: 'fire', tick: 0, pid: p.id, weapon: w.id, x: tipX, y: tipY, angle: v.angle, power: v.power });
  shot.now = 0;
  if (w.kind === 'riotcharge') { this._riotCharge(shot, p, w, v.angle); return []; }
  if (w.kind === 'plasma') { this._plasma(shot, p, w, v.batteries); return []; }
  if (w.kind === 'laser') { this._laser(shot, p, w, v); return []; }
  let power = v.power;
  const shots = [{ angle: v.angle, power }];
  if (p.tankType === 'triple' && (w.idx === 0 || w.idx === 1)) {               // triple turret: estimated (RE §3.1 1a4a:059a)
    shots.length = 0;
    shots.push({ angle: v.angle, power }, { angle: Math.min(180, v.angle + 2), power: Math.trunc(power * 1.02) }, { angle: Math.max(0, v.angle - 2), power: Math.trunc(power * 0.98) });
  }
  let guide = v.guide;
  if (guide && (guide.type === 'ballistic' || guide.type === 'lazy')) {          // power solved from current angle (SPEC 3.1)
    const sol = this._solvePower(p, v.angle, guide.tx, guide.ty, guide.type === 'lazy');
    if (sol.ok || guide.type === 'lazy') shots[0].power = sol.power;
    else shots[0].power = this.rng.int(p.hp * 10 + 1);                          // "confused" random power
    p.power = shots[0].power;
  }
  const out = [];
  for (const s of shots) {
    const vel = launchVelocity(s.angle, s.power);
    const ar = s.angle * 0.017453293;
    const tp = this._tip(p, s.angle), sx = tp.x, sy = tp.y;
    const proj = this._newProj(shot, p, w, sx, sy, vel.vx, vel.vy, { launchAngle: s.angle, launchPower: s.power });
    proj.contact = v.trigger;
    if (guide) proj.guide = { ...guide };
    if (w.kind === 'tracer') proj.smoke = w.idx === 11;
    out.push(proj);
  }
  return out;
};

// ---------------------------------------------------------------- ballistic solver for guidance (simulation based)
P._simMiss = function (owner, angle, power, tx, ty, useVisc) {
  const k = physConsts(this.options, this.wind);
  if (!useVisc) k.visc = 1;                               // Ballistic guidance cannot correct viscosity (SPEC 3.1)
  const pv = this._pivot(owner);
  const ar = angle * 0.017453293;
  const vel = launchVelocity(angle, power);
  const tp = this._tip(owner, angle);
  const p = { x: tp.x, y: tp.y, vx: vel.vx, vy: vel.vy };
  let best = Infinity;
  for (let i = 0; i < 6000; i++) {
    const px = p.x, py = p.y;
    stepProjectile(p, k);
    // distance from target to segment
    const sx = p.x - px, sy = p.y - py;
    const l2 = sx * sx + sy * sy;
    let u = l2 ? ((tx - px) * sx + (ty - py) * sy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(px + sx * u - tx, py + sy * u - ty);
    if (d < best) best = d;
    if (p.vy < 0 && p.y > ty + 40) break;
    if (p.y > this.options.height + 50 || Math.abs(p.x) > this.options.width * 4) break;
  }
  return best;
};
P._solvePower = function (owner, angle, tx, ty, useVisc) {
  const max = owner.hp * 10;
  let best = { power: 0, miss: Infinity };
  for (let pw = 5; pw <= max; pw += 5) { const m = this._simMiss(owner, angle, pw, tx, ty, useVisc); if (m < best.miss) best = { power: pw, miss: m }; }
  const lo = Math.max(0, best.power - 5), hi = Math.min(max, best.power + 5);
  for (let pw = lo; pw <= hi; pw++) { const m = this._simMiss(owner, angle, pw, tx, ty, useVisc); if (m < best.miss) best = { power: pw, miss: m }; }
  return { power: best.power, miss: best.miss, ok: best.miss < 8 };
};

// ---------------------------------------------------------------- flight (RE §3.2, §8.5)
P._flight = function (shot, projs, t0) {
  const impacts = [];
  let live = projs.slice();
  let order = 0;
  for (const p of live) p.born = t0;
  let t = t0, guard = 0;
  while (live.length && guard++ < MAX_FLIGHT_STEPS) {
    t++;
    const next = [];
    const k = flightConsts(this.options, this.wind, live.length);
    for (const p of live) {
      const imp = this._stepProjTick(shot, p, k, t);
      if (imp) { imp.tick = t; imp.proj = p; imp.order = order++; impacts.push(imp); this._closeProj(shot, p, imp); }
      else next.push(p);
    }
    for (const c of shot.spawn) { c.born = t; next.push(c); }
    shot.spawn = [];
    live = next;
  }
  for (const p of live) { const imp = { type: 'out', x: Math.trunc(p.x), y: Math.trunc(p.y), tick: t, proj: p, order: order++ }; impacts.push(imp); this._closeProj(shot, p, imp); }
  return impacts;
};

P._closeProj = function (shot, p, imp) {
  if (p.rolling) return;
  this._ev(shot, { t: 'proj', id: p.id, pid: p.owner ? p.owner.id : null, weapon: p.w.id, tick: p.born, dur: p.pts.length / 2 - 1, pts: p.pts, end: imp.type === 'tank' ? 'tank' : imp.type === 'shield' ? 'shield' : imp.type === 'out' ? 'out' : imp.type === 'fizzle' ? 'fizzle' : 'ground', ...(p.parent ? { parent: p.parent } : {}), ...(p.smoke ? { smoke: true } : {}) });
};

/** one tick = k.sub integration substeps (collision tested every substep, like the original); only the tick-end position is recorded in p.pts */
P._stepProjTick = function (shot, p, k, t) {
  const real = p.pts;
  let imp = null;
  for (let i = 0; i < k.sub; i++) {
    p.pts = i === k.sub - 1 ? real : [];
    imp = this._stepProj(shot, p, k, t);
    if (this._trace) this._trace.push([Math.trunc(p.x), Math.trunc(p.y)]);
    if (imp) break;
  }
  p.pts = real;
  const n = real.length;
  if (imp && !(n >= 2 && real[n - 2] === r2(p.x) && real[n - 1] === r2(p.y))) real.push(r2(p.x), r2(p.y));
  return imp;
};

/** one step; returns impact object or null */
P._stepProj = function (shot, p, k, t) {
  const o = this.options, T = this.terrain, w = o.width, h = o.height;
  if (p.guide && p.guide.type === 'heat' && !p.hg) {
    let best = null, bd = HEAT_RANGE;
    for (const tk of this.players) {
      if (!tk.alive || tk === p.owner || this.friendly(p.owner, tk)) continue;
      const d = Math.hypot(tk.x - p.x, this._cy(tk) - p.y);
      if (d < bd) { bd = d; best = tk; }
    }
    if (best) { p.hg = best; this._ev(shot, { t: 'guide', tick: t, id: p.id, mode: 'heat' }); }
  }
  if (p.hg) {
    if (!p.hg.alive) p.hg = null;
    else {
      const dx = p.hg.x - p.x, dy = this._cy(p.hg) - p.y, d = Math.hypot(dx, dy) || 1;
      const sp = Math.max(GUIDE_SPEED, Math.hypot(p.vx, p.vy));
      p.vx = dx / d * sp; p.vy = -dy / d * sp; p.straight = true;
    }
  }
  const px = p.x, py = p.y;
  const vs0 = { vx: p.vx, vy: p.vy };
  const keepV = p.straight ? [p.vx, p.vy] : null;      // guided straight flight ignores gravity/wind
  stepProjectile(p, k);
  if (keepV) { p.vx = keepV[0]; p.vy = keepV[1]; }
  // Mag deflector: upward force near/above the tank (RE §6 "미상": estimated)
  for (const tk of this.players) {
    if (!tk.alive || !tk.shield || tk.shield.hp <= 0 || !(SHIELDS[tk.shield.item].flags & (2 | 4))) continue;
    if (tk === p.owner && !p.exited) continue;
    const dx = p.x - tk.x, dy = p.y - this._cy(tk);
    if (Math.abs(dx) <= MAG_RANGE && dy < 0 && dy > -MAG_RANGE * 1.5 && p.vy < 0) {
      p.vy += 1.4 * k.gravStep * (1 - Math.abs(dx) / MAG_RANGE);
      tk.shield.hp -= 1;
      if (tk.shield.hp <= 0) { this._ev(shot, { t: 'shield', tick: t, tank: tk.id, item: tk.shield.item, hp: 0, kind: 'break' }); tk.shield = null; }
    }
  }
  // guidance (RE: 미상 -> estimated)
  if (p.guide && !p.straight) {
    const g = p.guide;
    if (g.type === 'horz' && (py - g.ty) * (p.y - g.ty) <= 0) { p.vy = 0; p.vx = (g.tx >= p.x ? 1 : -1) * Math.max(GUIDE_SPEED, Math.abs(p.vx)); p.straight = true; this._ev(shot, { t: 'guide', tick: t, id: p.id, mode: 'horz' }); }
    else if (g.type === 'vert' && (px - g.tx) * (p.x - g.tx) <= 0) { p.vx = 0; p.vy = -Math.max(GUIDE_SPEED, Math.abs(p.vy)); p.straight = true; this._ev(shot, { t: 'guide', tick: t, id: p.id, mode: 'vert' }); }
  }
  if (p.guide && p.guide.type === 'lazy') {
    const sx = p.x - px, sy = p.y - py, l2 = sx * sx + sy * sy;
    let u = l2 ? ((p.guide.tx - px) * sx + (p.guide.ty - py) * sy) / l2 : 0;
    if (u >= 0 && u <= 1 && Math.hypot(px + sx * u - p.guide.tx, py + sy * u - p.guide.ty) <= 1.5) {
      p.x = p.guide.tx; p.y = p.guide.ty; p.pts.push(r2(p.x), r2(p.y));
      return { type: 'ground', x: Math.round(p.x), y: Math.round(p.y), lx: p.lx, ly: p.ly, lazy: true };
    }
  }
  // MIRV / Death's Head apex split (RE §5.4, 25d5:041b): first step with vy < 0
  if (p.w.kind === 'mirv' && !p.split && p.vy < 0) this._split(shot, p, t);
  // walls (RE §8.5, 1a4a:1349)
  const wc = this.wallCode;
  const ext = o.edgesExtend;
  if (p.x < 0 || p.x > w - 1) {
    const left = p.x < 0;
    if (wc === 0) { if (p.x < -ext || p.x > w - 1 + ext) { p.pts.push(r2(p.x), r2(p.y)); return { type: 'out', x: Math.trunc(p.x), y: Math.trunc(p.y) }; } }
    else if (wc === 1) { p.x += left ? w : -w; this._ev(shot, { t: 'wrap', tick: t, id: p.id, x: Math.trunc(p.x) }); }
    else if (wc === 5) { const x = left ? 0 : w - 1; p.x = x; p.pts.push(r2(p.x), r2(p.y)); return { type: 'ground', x, y: Math.trunc(p.y), lx: p.lx, ly: p.ly, wall: true }; }
    else {
      let coef = WALL_COEF[wc];
      p.bounces++;
      if (p.bounces > 6) { coef *= p.damp; p.damp *= 0.8; }                // RE §8.5: after 6 reflections extra damping x0.8 cumulative
      p.x = left ? 0 : w - 1;
      p.vx *= coef;
      this._ev(shot, { t: 'bounce', tick: t, id: p.id, x: p.x, y: r2(p.y), wall: left ? 'left' : 'right' });
    }
  }
  if (p.y < 0 && wc >= 2) {                                                  // ceiling: reflecting walls only (estimated, RE 미상)
    if (wc === 5) { p.y = 0; p.pts.push(r2(p.x), r2(p.y)); return { type: 'ground', x: Math.trunc(p.x), y: 0, lx: p.lx, ly: p.ly, wall: true }; }
    let coef = WALL_COEF[wc];
    p.bounces++;
    if (p.bounces > 6) { coef *= p.damp; p.damp *= 0.8; }
    p.y = 0; p.vy *= coef;
    this._ev(shot, { t: 'bounce', tick: t, id: p.id, x: r2(p.x), y: 0, wall: 'top' });
  }
  p.pts.push(r2(p.x), r2(p.y));
  const ix = Math.trunc(p.x), iy = Math.trunc(p.y);
  if (iy >= h) return { type: 'ground', x: Math.max(0, Math.min(w - 1, ix)), y: h - 1, lx: p.lx, ly: p.ly };
  if (ix >= 0 && ix < w && iy >= 0) {
    const gi = this._groundContact(shot, p, ix, iy, vs0, t);
    if (gi) return gi;
    for (const tk of this.players) {
      if (!tk.alive) continue;
      if (tk === p.owner && !p.exited) {
        const dx = ix - tk.x, dy = iy - this._cy(tk);
        if (dx * dx + dy * dy > TANK.shieldR * TANK.shieldR + 1) p.exited = true;
        continue;
      }
      if (this._shieldContains(tk, ix, iy)) {
        const f = SHIELDS[tk.shield.item].flags;
        if (f & (1 | 4)) {                                                  // Force Shield / Super Mag: reflect, shield hp -= int(speed/100) (RE §6)
          const cx = tk.x, cy = this._cy(tk);
          let nx = p.x - cx, ny = p.y - cy; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
          const nvx = nx, nvy = -ny;                                        // normal in math coords
          const dot = p.vx * nvx + p.vy * nvy;
          const speed = Math.hypot(p.vx, p.vy);
          if (dot < 0) { p.vx -= 2 * dot * nvx; p.vy -= 2 * dot * nvy; }
          p.x = cx + nx * (TANK.shieldR + 1.5); p.y = cy + ny * (TANK.shieldR + 1.5);
          tk.shield.hp -= Math.max(1, Math.trunc(speed / 100));
          this._ev(shot, { t: 'shield', tick: t, tank: tk.id, item: tk.shield.item, hp: Math.max(0, tk.shield.hp), kind: 'reflect' });
          if (tk.shield.hp <= 0) { this._ev(shot, { t: 'shield', tick: t, tank: tk.id, item: tk.shield.item, hp: 0, kind: 'break' }); tk.shield = null; }
          p.pts.push(r2(p.x), r2(p.y));
          p.lx = Math.trunc(p.x); p.ly = Math.trunc(p.y);
          return null;
        }
        return { type: 'shield', x: ix, y: iy, tank: tk, lx: p.lx, ly: p.ly };
      }
      if (this._bodyContains(tk, ix, iy)) return { type: 'tank', x: ix, y: iy, tank: tk, lx: p.lx, ly: p.ly };
    }
    p.lx = ix; p.ly = iy;
  } else { p.lx = ix; p.ly = iy; }
  return p.steps++ > MAX_FLIGHT_STEPS ? { type: 'out', x: ix, y: iy } : null;
};

/** Terrain contact along the Bresenham walk from the previous pixel (171b:0733 + callback 1a4a:1349). TUNNELING ON: every dirt pixel scales the pre-step
 *  velocity by 0.75 and is erased; the shell explodes when vx^2+vy^2 < 2000 (DS:1D54/1D58). Gate (1a4a:1657): option on, no tank pixel, projectile record
 *  +0x4a != 0 and no contact trigger (DS:1C76 = rec +0x2e). +0x4a is set at creation (1a4a:0a1e..0a7e) to 0 for handlers 3d1e:0002 (tracers), 2fbd:0003 (rollers),
 *  15a0:0081 (dirt charge) and to -1 for every other handler, i.e. all other projectile weapons tunnel. */
const NO_TUNNEL_KINDS = new Set(['tracer', 'roller', 'dirtcharge']);
P._groundContact = function (shot, p, ix, iy, vs, t) {
  const T = this.terrain, w = T.w;
  const solid = (x, y) => x >= 0 && x < w && y >= 0 && y < T.h && T.cells[y * w + x] !== 0;
  // Heat-seeking shells re-set their speed to >= GUIDE_SPEED every step (estimated model), so the x0.75 decay would never stop them and they would drill through any terrain;
  // no original evidence for that -> heat guidance does not tunnel (previous behaviour).
  const tun = this.options.tunneling && !p.contact && !NO_TUNNEL_KINDS.has(p.w.kind) && !(p.guide && p.guide.type === 'heat');
  let x = p.lx, y = p.ly;
  let dx = Math.abs(ix - x), dy = Math.abs(iy - y);
  const sx = ix >= x ? 1 : -1, sy = iy >= y ? 1 : -1;
  let mx = sx, my = 0;                                          // major-axis step (171b:0733)
  if (dx < dy) { const t2 = dx; dx = dy; dy = t2; mx = 0; my = sy; }
  let err = 2 * dy - dx, vx = vs.vx, vy = vs.vy, tunneled = false;
  const spans = [];
  for (let i = 0; i <= dx; i++) {
    if ((x !== p.lx || y !== p.ly || i > 0) && solid(x, y)) {
      if (!tun) return { type: 'ground', x, y, lx: p.lx, ly: p.ly };
      vx *= 0.75; vy *= 0.75; tunneled = true;
      if (vx * vx + vy * vy < 2000) {
        if (spans.length) this._ev(shot, { t: 'terrain', tick: t, spans });
        p.vx = vx; p.vy = vy;
        return { type: 'ground', x, y, lx: p.lx, ly: p.ly };
      }
      T.cells[y * w + x] = 0; spans.push([x, y, y, 0]); T.markDirty(x, x);
    }
    if (err < 0) { x += mx; y += my; err += 2 * dy; } else { x += sx; y += sy; err += 2 * dy - 2 * dx; }
  }
  if (spans.length) this._ev(shot, { t: 'terrain', tick: t, spans });
  if (tunneled) { p.vx = vx; p.vy = vy; }
  return null;
};

P._split = function (shot, p, t) {
  const deaths = p.w.param === 1;
  const N = deaths ? 9 : 5, S = deaths ? 20 : 50;
  const Rr = Math.trunc((deaths ? 35 : 20) * this.scale);
  p.split = true;
  const group = { owner: p.owner, idx: p.w.idx, R: Rr, sites: [], pending: N, kind: p.w.id, tick: 0, direct: [] };
  p.group = group;
  const mid = (N + 1) >> 1;
  const children = [];
  for (let kk = 0; kk < N; kk++) {
    if (kk === mid) continue;                                                  // k == (N+1)/2 is the parent itself
    const c = this._newProj(shot, p.owner, p.w, p.x, p.y, p.vx + S * (kk - mid), p.vy, { split: true, group, parent: p.id, exited: true, bounces: p.bounces, damp: p.damp, wall: p.wall });
    c.pts = [r2(p.x), r2(p.y)]; c.lx = p.lx; c.ly = p.ly; c.contact = p.contact;
    children.push(c);
  }
  this._ev(shot, { t: 'split', tick: t, id: p.id, x: r2(p.x), y: r2(p.y), children: children.map((c) => c.id) });
  for (const c of children) shot.spawn.push(c);
};

// ---------------------------------------------------------------- impact resolution
P._resolve = function (shot, imp) {
  const p = imp.proj, w = p.w;
  shot.cursor = Math.max(shot.cursor, imp.tick);
  if (p.group) return this._groupImpact(shot, imp);
  if (imp.type === 'out') return;
  shot.now = imp.tick;
  if (imp.type === 'shield') {
    this._ev(shot, { t: 'hit', tick: imp.tick, tank: imp.tank.id, kind: 'shieldDirect', x: imp.x, y: imp.y });
    if (imp.tank.shield) this._shieldHit(shot, imp.tank, 10, p.owner);
    return;
  }
  if (w.kind === 'tracer') return;
  if (w.kind === 'mirv') { this._ev(shot, { t: 'fizzle', tick: imp.tick, x: imp.x, y: imp.y, weapon: w.id }); return; }   // never reached the apex: dud (RE §5.4)
  const owner = p.owner;
  if (imp.type === 'tank' && (w.kind === 'explode' || w.kind === 'leapfrog' || w.kind === 'roller')) {
    this._ev(shot, { t: 'hit', tick: imp.tick, tank: imp.tank.id, kind: 'direct', x: imp.x, y: imp.y });
    this.damageTank(shot, imp.tank, imp.tank.hp, { owner, idx: w.idx, kind: 'direct' });          // body hit = all energy (RE §5.2)
  }
  switch (w.kind) {
    case 'explode': this._explode(shot, { x: imp.x, y: imp.y, R: Math.trunc(w.param * this.scale), kind: w.id, owner, mult: w.idx + 1, tick: imp.tick }); break;
    case 'leapfrog': this._leapfrog(shot, imp); break;
    case 'funky': this._funky(shot, imp); break;
    case 'napalm': this._napalm(shot, imp); break;
    case 'roller': this._roller(shot, imp); break;
    case 'riotbomb': {
      const R = Math.trunc(w.param * this.scale);
      this._ev(shot, { t: 'explode', tick: imp.tick, x: imp.x, y: imp.y, r: R, kind: w.id, dur: 8, harmless: true });
      shot.cursor = imp.tick + 8;
      this._carve(shot, shot.cursor, imp.x, imp.y, R);
      break;
    }
    case 'digger': this._digger(shot, imp); break;
    case 'dirt': {
      const R = w.param;                                                     // no scale for dirt (RE §5.1)
      const spans = this.terrain.disc(imp.x, imp.y, Math.max(0, R - 1), DIRT_BASE, true);
      this._ev(shot, { t: 'explode', tick: imp.tick, x: imp.x, y: imp.y, r: R, kind: w.id, dur: Math.min(R, 30), harmless: true });
      shot.cursor = imp.tick + Math.min(R, 30);
      if (spans.length) this._ev(shot, { t: 'terrain', tick: shot.cursor, spans });
      break;
    }
    case 'dirtcharge': this._dirtCharge(shot, imp); break;
    case 'disrupter': {
      this._ev(shot, { t: 'disrupt', tick: imp.tick, x: imp.x, y: imp.y, dur: 100 });         // 100 frames flash (RE §5.3)
      shot.cursor = imp.tick + 100;
      shot.forceDirt = true;
      this.terrain.markDirty(0, this.terrain.w - 1);
      break;
    }
    default: break;
  }
};

P._groupImpact = function (shot, imp) {
  const g = imp.proj.group;
  g.pending--;
  g.tick = Math.max(g.tick, imp.tick);
  if (imp.type === 'ground' || imp.type === 'tank') {
    g.sites.push({ x: imp.x, y: imp.y, tick: imp.tick });
    if (imp.type === 'tank') g.direct.push(imp.tank);
    this._ev(shot, { t: 'explode', tick: imp.tick, x: imp.x, y: imp.y, r: g.R, kind: g.kind, dur: fireDur(g.R), fireballOnly: true });      // fireball only (RE §5.4)
    g.tick = Math.max(g.tick, imp.tick + fireDur(g.R));
  } else if (imp.type === 'shield') {
    this._ev(shot, { t: 'hit', tick: imp.tick, tank: imp.tank.id, kind: 'shieldDirect', x: imp.x, y: imp.y });
    shot.now = imp.tick;
    if (imp.tank.shield) this._shieldHit(shot, imp.tank, 10, g.owner);
  }
  if (g.pending > 0) return;
  // all warheads done: damage summed per tank over all sites, then craters (RE §5.4)
  const end = Math.max(shot.cursor, g.tick);
  shot.now = end;
  const sum = new Map();
  for (const s of g.sites) for (const { tank, dmg } of this._radialDamages(s.x, s.y, g.R, g.idx + 1)) sum.set(tank, (sum.get(tank) || 0) + dmg);
  for (const tk of g.direct) { this._ev(shot, { t: 'hit', tick: end, tank: tk.id, kind: 'direct', x: tk.x, y: tk.y }); sum.set(tk, Math.max(sum.get(tk) || 0, tk.hp)); }
  for (const s of g.sites) this._carve(shot, end, s.x, s.y, g.R);
  for (const [tank, dmg] of sum) this.damageTank(shot, tank, dmg, { owner: g.owner, idx: g.idx, kind: g.kind });
  shot.cursor = end;
};

// ---------------------------------------------------------------- weapon handlers
P._leapfrog = function (shot, imp) {                                         // RE §5.4, 2382:0006
  const p = imp.proj;
  const radii = [30, 25, 20];
  let x = imp.x, y = imp.y, power = p.launchPower, tick = imp.tick;
  const owner = p.owner, w = p.w;
  let lx = imp.lx, ly = imp.ly;
  for (let di = 2; di >= 0; di--) {
    const R = Math.trunc(radii[di] * this.scale);
    const end = this._explode(shot, { x, y, R, kind: w.id, owner, mult: w.idx + 1, tick });
    if (di === 0) break;
    power = Math.trunc(power / 1.5);                                         // previous speed / 1.5, same launch angle (RE: 추정)
    const vel = launchVelocity(p.launchAngle, power);
    const np = this._newProj(shot, owner, w, x, Math.max(0, y - 1), vel.vx, vel.vy, { launchAngle: p.launchAngle, launchPower: power, exited: true });
    const imps = this._flight(shot, [np], end);
    const hit = imps[0];
    if (!hit || hit.type === 'out' || hit.type === 'shield') { if (hit && hit.type === 'shield') { shot.now = hit.tick; this._ev(shot, { t: 'hit', tick: hit.tick, tank: hit.tank.id, kind: 'shieldDirect', x: hit.x, y: hit.y }); this._shieldHit(shot, hit.tank, 10, owner); } return; }
    if (hit.type === 'tank') { this._ev(shot, { t: 'hit', tick: hit.tick, tank: hit.tank.id, kind: 'direct', x: hit.x, y: hit.y }); shot.now = hit.tick; this.damageTank(shot, hit.tank, hit.tank.hp, { owner, idx: w.idx, kind: 'direct' }); }
    x = hit.x; y = hit.y; tick = hit.tick; lx = hit.lx; ly = hit.ly;
    shot.cursor = Math.max(shot.cursor, hit.tick);
  }
};

P._funky = function (shot, imp) {                                            // RE §5.4, 1dce:0000 (bit path 1dce:05df is 추정)
  const p = imp.proj, owner = p.owner, S = this.scale, rng = this.rng;
  const n = rng.int(6) + 5;
  const sx = imp.lx ?? imp.x, sy = imp.ly ?? imp.y;
  const a = 50 * this.options.gravity * 50;                                 // px/s^2
  const bits = [];
  for (let i = 0; i < n; i++) {
    const tx = sx + rng.int(160) - 80;
    const r = Math.trunc((rng.int(10) + 15) * S);
    const hgt = rng.int(60) + 40;
    const vy0 = Math.sqrt(2 * a * hgt), tUp = vy0 / a;
    const vx0 = (tx - sx) / (2 * tUp);
    const bp = this._newProj(shot, owner, p.w, sx, sy, vx0, vy0, { exited: true, bitIdx: i, bitR: r });
    bp.bit = true;
    bits.push(bp);
  }
  const start = Math.max(shot.cursor, imp.tick);
  const imps = this._flight(shot, bits, start);
  imps.sort((x, y) => (x.tick - y.tick) || (x.order - y.order));
  for (const hit of imps) {
    if (hit.type === 'out') continue;
    const bp = hit.proj;
    shot.cursor = Math.max(shot.cursor, hit.tick);
    shot.now = hit.tick;
    const R = bp.bitR;
    const end = Math.max(shot.cursor, hit.tick) + fireDur(R);
    this._ev(shot, { t: 'explode', tick: Math.max(shot.cursor, hit.tick), x: hit.x, y: hit.y, r: R, kind: 'funky', color: 0xaa + (bp.bitIdx % 5) * 12, dur: fireDur(R) });
    shot.now = end;
    this._carve(shot, end, hit.x, hit.y, R);
    for (const { tank, dmg } of this._radialDamages(hit.x, hit.y, R, 1)) this.damageTank(shot, tank, Math.min(dmg, 100), { owner, idx: 5, kind: 'funky' });   // no weapon multiplier (RE §5.4)
    shot.cursor = end;
  }
};

P._napalm = function (shot, imp) {                                           // RE §5.7, 26e6:01a0
  const p = imp.proj, w = p.w, T = this.terrain, W = T.w, H = T.h;
  const liquid = w.idx === 28;
  const pcount = Math.abs(w.param);
  const hot = w.idx === 9;
  let sx = imp.lx, sy = imp.ly;
  if (imp.type === 'tank' || sx === undefined) { sx = imp.x; sy = imp.y; }
  const occupied = new Set();
  const pixels = [], records = [];
  const free = (x, y) => x >= 0 && x < W && y >= 0 && y < H && T.cells[y * W + x] === 0 && !occupied.has(y * W + x) && !this._tankAt(x, y);
  let iters = 0, settled = 0;
  while (records.length < pcount && iters < 1000) {
    iters++;
    let x = sx, y = sy;
    while (y >= 0 && !free(x, y)) y--;                                       // pile up
    if (y < 0) break;
    let run = 0, lost = false;
    for (let steps = 0; steps < 600; steps++) {
      if (free(x, y + 1)) { y++; run = 0; continue; }
      if (y + 1 >= H) break;
      const l = free(x - 1, y), r = free(x + 1, y);
      if (run >= 12) break;
      let d = 0;
      if (l && r) d = this.wind > 0 ? 1 : this.wind < 0 ? -1 : (this.rng.int(2) ? 1 : -1);
      else if (l) d = -1; else if (r) d = 1;
      if (!d) break;
      x += d; run++;
      if (x < 0 || x >= W) { lost = true; break; }
    }
    if (lost) continue;
    occupied.add(y * W + x);
    pixels.push(x, y);
    settled++;
    if (settled % 20 === 0) records.push([x, y]);                            // record point every 20 pixels
  }
  const start = Math.max(shot.cursor, imp.tick);
  const dur = Math.max(1, iters);
  this._ev(shot, { t: 'napalm', tick: start, kind: liquid ? 'liquid' : hot ? 'hot' : 'napalm', pixels, records, dur, weapon: w.id });
  const end = start + dur;
  shot.cursor = end; shot.now = end;
  if (liquid) {                                                              // Liquid Dirt: paint 0x50 and finish (no damage)
    const spans = [];
    const cols = new Map();
    for (let i = 0; i < pixels.length; i += 2) { const x = pixels[i], y = pixels[i + 1]; if (!cols.has(x)) cols.set(x, []); cols.get(x).push(y); }
    for (const [x, ys] of [...cols].sort((a, b) => a[0] - b[0])) {
      ys.sort((a, b) => a - b);
      let a0 = ys[0], prev = ys[0];
      for (let i = 1; i <= ys.length; i++) {
        if (i < ys.length && ys[i] === prev + 1) { prev = ys[i]; continue; }
        for (let y = a0; y <= prev; y++) T.cells[y * W + x] = DIRT_BASE;
        spans.push([x, a0, prev, DIRT_BASE]);
        if (i < ys.length) { a0 = ys[i]; prev = ys[i]; }
      }
      T.markDirty(x, x);
    }
    if (spans.length) this._ev(shot, { t: 'terrain', tick: end, spans });
    return;
  }
  const dmg = new Map();
  for (const [rx, ry] of records) {
    for (const t of this.players) {
      if (!t.alive) continue;
      const d = Math.hypot(rx - t.x, ry - this._cy(t));
      const v = hot ? (d < 40 ? Math.trunc(50 - d) : 0) : (d < 25 ? Math.trunc(30 - d) : 0);   // RE §5.7, no weapon multiplier
      if (v > 0) dmg.set(t, (dmg.get(t) || 0) + v);
    }
  }
  for (const [t, d] of dmg) this.damageTank(shot, t, d, { owner: p.owner, idx: w.idx, kind: w.id });
};

P._roller = function (shot, imp) {                                           // RE §5.5, 2fbd:0003
  const p = imp.proj, w = p.w, T = this.terrain, W = T.w, H = T.h;
  const R = Math.trunc(w.param * this.scale);
  const owner = p.owner;
  const start = Math.max(shot.cursor, imp.tick);
  if (imp.type === 'tank') { this._explode(shot, { x: imp.x, y: imp.y, R, kind: w.id, owner, mult: w.idx + 1, tick: imp.tick }); return; }
  let x = imp.lx, y = imp.ly;
  if (x === undefined) { x = imp.x; y = imp.y; }
  // direction: downhill first (scan both slopes), else sign of vx
  const blocked = (xx, yy) => yy >= H || (xx >= 0 && xx < W && (T.cells[yy * W + xx] !== 0 || !!this._tankAt(xx, yy)));
  let dl = 0, dr = 0;
  for (let k = 1; k <= 8; k++) {
    const yl = T.surface(x - k, Math.max(0, y - 10)), yr = T.surface(x + k, Math.max(0, y - 10));
    if (yl >= 0) dl += yl - y; if (yr >= 0) dr += yr - y;
  }
  let dir = dl > dr ? -1 : dr > dl ? 1 : (p.vx < 0 ? -1 : 1);
  const pts = [x, y];
  let end = false, tickN = 0, how = 'blocked';
  const wc = this.wallCode;
  while (!end && tickN < 3000) {
    tickN++;
    if (this._tankAt(x, y)) { how = 'tank'; break; }
    if (y + 1 < H && !blocked(x, y + 1)) y++;                                // below is sky: fall
    else {
      const nx = x + dir;
      if (nx < 0 || nx >= W) {                                               // walls for rollers
        if (wc === 0) { how = 'out'; break; }
        if (wc === 1) { x = nx < 0 ? W - 1 : 0; pts.push(x, y); continue; }
        if (wc === 5) { how = 'blocked'; break; }
        dir = -dir; continue;                                                // bounce
      }
      if (!blocked(nx, y)) x = nx; else { how = 'blocked'; break; }
    }
    pts.push(x, y);
  }
  this._ev(shot, { t: 'roller', tick: start, id: p.id, pts, weapon: w.id, x, y });
  shot.cursor = start + tickN;
  if (how === 'out') return;
  this._explode(shot, { x, y, R, kind: w.id, owner, mult: w.idx + 1, tick: start + tickN });
};

const DIRS8 = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
P._digger = function (shot, imp) {                                           // RE §5.6, 151b:000a
  const p = imp.proj, w = p.w, T = this.terrain, rng = this.rng;
  const sandhog = w.param > 0;
  const start = Math.max(shot.cursor, imp.tick);
  if (imp.type !== 'ground' || !T.solid(imp.x, imp.y)) {                     // only works when it hits dirt
    this._ev(shot, { t: 'fizzle', tick: imp.tick, x: imp.x, y: imp.y, weapon: w.id });
    return;
  }
  const budget = sandhog ? w.param : Math.abs(w.param) * 2;                 // Digger 20/40/70, Sandhog 10/20/35
  if (p.contact) {                                                           // contact trigger: no tunneling
    this._ev(shot, { t: 'fizzle', tick: imp.tick, x: imp.x, y: imp.y, weapon: w.id, contact: true });
    return;
  }
  const erased = new Map();                                                  // key -> true
  const erase = (x, y) => { if (T.solid(x, y)) { T.cells[y * T.w + x] = 0; erased.set(y * T.w + x, [x, y]); return true; } return false; };
  const worms = [{ x: imp.x, y: imp.y, dir: sandhog ? rng.int(8) : 0, keep: 0, life: budget, pts: [imp.x, imp.y], dead: false, frame: 0 }];
  erase(imp.x, imp.y);
  const deaths = [];
  let frame = 0;
  while (worms.some((q) => !q.dead) && frame < 2000) {
    frame++;
    for (const q of worms) {
      if (q.dead) continue;
      if (q.life <= 0) { q.dead = true; q.frame = frame; deaths.push(q); continue; }
      let moved = false;
      if (sandhog && q.keep > 0) {
        const [dx, dy] = DIRS8[q.dir];
        if (T.solid(q.x + dx, q.y + dy)) { q.x += dx; q.y += dy; q.keep--; moved = true; }
      }
      if (!moved) {
        const cands = [];
        for (let d = 0; d < 8; d++) if (T.solid(q.x + DIRS8[d][0], q.y + DIRS8[d][1])) cands.push(d);
        if (!cands.length) { q.dead = true; q.frame = frame; deaths.push(q); continue; }
        q.dir = cands[rng.int(cands.length)];
        q.x += DIRS8[q.dir][0]; q.y += DIRS8[q.dir][1];
        q.keep = sandhog ? 19 : 0;                                           // Sandhog keeps direction 20 steps
      }
      erase(q.x, q.y);
      if (rng.int(3) === 0) { erase(q.x - 1, q.y); erase(q.x + 1, q.y); }   // 1/3 chance: width 3
      q.pts.push(q.x, q.y);
      q.life--;
    }
    if (frame % 8 === 0) {                                                   // branch every 8 frames, max 20 worms
      const alive = worms.filter((q) => !q.dead);
      if (alive.length && worms.length < 20) {
        const par = alive[rng.int(alive.length)];
        worms.push({ x: par.x, y: par.y, dir: sandhog ? rng.int(8) : 0, keep: 0, life: par.life, pts: [par.x, par.y], dead: false, frame: 0 });
      }
    }
  }
  this._ev(shot, { t: 'digger', tick: start, kind: w.id, worms: worms.map((q) => ({ pts: q.pts })), dur: frame });
  // terrain diff spans
  const cols = new Map();
  for (const [, [x, y]] of erased) { if (!cols.has(x)) cols.set(x, []); cols.get(x).push(y); }
  const spans = [];
  for (const [x, ys] of [...cols].sort((a, b) => a[0] - b[0])) {
    ys.sort((a, b) => a - b);
    let a0 = ys[0], prev = ys[0];
    for (let i = 1; i <= ys.length; i++) {
      if (i < ys.length && ys[i] === prev + 1) { prev = ys[i]; continue; }
      spans.push([x, a0, prev, 0]);
      if (i < ys.length) { a0 = ys[i]; prev = ys[i]; }
    }
    T.markDirty(x, x);
  }
  const end = start + frame;
  if (spans.length) this._ev(shot, { t: 'terrain', tick: end, spans });
  shot.cursor = end;
  if (sandhog) {                                                             // Sandhog worms explode where they die (RE §5.6)
    const R = Math.trunc(10 * this.scale);
    for (const q of deaths) this._explode(shot, { x: q.x, y: q.y, R, kind: w.id, owner: p.owner, mult: w.idx + 1, tick: start + q.frame });
  }
};

P._dirtCharge = function (shot, imp) {                                       // RE §5.6, 15a0:0081 (wedge geometry 추정)
  const T = this.terrain, w = imp.proj.w;
  const x0 = imp.lx ?? imp.x, y0 = imp.ly ?? imp.y;
  const start = Math.max(shot.cursor, imp.tick);
  const H = this.options.extraDirt ? 70 : 45;
  this._ev(shot, { t: 'explode', tick: start, x: x0, y: y0, r: 6, kind: w.id, dur: 50, harmless: true });         // flare 50 frames
  const end = start + 50;
  const spans = [];
  for (let k = 1; k <= H; k++) {
    const y = y0 - k, hw = Math.floor(k * 0.7) + 2;
    if (y < 0) break;
    for (let x = Math.max(0, x0 - hw); x <= Math.min(T.w - 1, x0 + hw); x++) {
      if (T.cells[y * T.w + x] === 0) { T.cells[y * T.w + x] = DIRT_BASE; spans.push([x, y, y, DIRT_BASE]); T.markDirty(x, x); }
    }
  }
  if (spans.length) this._ev(shot, { t: 'terrain', tick: end, spans });
  shot.cursor = end;
};

P._riotCharge = function (shot, p, w, angle) {                               // RE §5.6, 2f76:000d
  const R = Math.trunc((w.idx === 15 ? 36 : 60) * this.scale);
  const half = w.idx === 15 ? 45 : 60;
  const pv = this._pivot(p);
  const spans = this.terrain.wedge(pv.x, pv.y, R, angle, half);
  this._ev(shot, { t: 'riot', tick: 0, x: pv.x, y: pv.y, r: R, angle, half, weapon: w.id, dur: 12 });
  if (spans.length) this._ev(shot, { t: 'terrain', tick: 12, spans });
  shot.cursor = Math.max(shot.cursor, 12);
};

P._plasma = function (shot, p, w, n) {                                       // RE §5.8, 2770:0009
  const S = this.scale;
  const Rm = Math.trunc(20 * S), Rn = Math.trunc(75 * S);
  const R = Math.trunc(Rm + (Rn - Rm) * n / 10);
  const cx = p.x, cy = this._cy(p);
  const dur = fireDur(R);
  this._ev(shot, { t: 'explode', tick: 0, x: cx, y: cy, r: R, kind: 'plasma', dur, batteries: n });
  shot.now = dur;
  for (const { tank, dmg } of this._radialDamages(cx, cy, R, 1, { exclude: p, plus: 80 })) this.damageTank(shot, tank, dmg, { owner: p, idx: w.idx, kind: 'plasma' });
  shot.cursor = Math.max(shot.cursor, dur);
};

P._laser = function (shot, p, w, v) {                                        // RE §5.8: beam code 미상 -> estimated line damage; per step min(p,10), p -= 50
  const pv = this._pivot(p);
  const a = v.angle * 0.017453293;
  const dx = Math.cos(a), dy = -Math.sin(a);
  const L = Math.hypot(this.options.width, this.options.height) * 1.5;
  const x1 = pv.x + dx * L, y1 = pv.y + dy * L;
  this._ev(shot, { t: 'laser', tick: 0, x0: pv.x, y0: pv.y, x1: r2(x1), y1: r2(y1), batteries: v.batteries, dur: 10 });
  shot.now = 10;
  const n = v.batteries;
  if (n > 0) {
    for (const t of this.players) {
      if (!t.alive || t === p) continue;
      const cx = t.x - pv.x, cy = this._cy(t) - pv.y;
      const along = cx * dx + cy * dy;
      if (along <= 0) continue;
      const dist = Math.abs(cx * dy - cy * dx);
      if (dist > TANK.halfW + 1) continue;
      if (t.shield && (SHIELDS[t.shield.item].flags & 4)) continue;        // Super Mag is immune (SPEC 3.1)
      let pp = n * 50, total = 0;
      while (pp > 0) { total += Math.min(pp, 10); pp -= 50; }
      this.damageTank(shot, t, total, { owner: p, idx: w.idx, kind: 'laser' });
    }
  }
  shot.cursor = Math.max(shot.cursor, 10);
};

// ---------------------------------------------------------------- settle: tank fall, dirt fall, deaths (RE §5.3)
P._supportedAt = function (t, x, y) {
  if (y + 1 > this.bounds.bottom) return true;
  for (let dx = -2; dx <= 2; dx++) {
    if (this.terrain.solid(x + dx, y + 1)) return 'ground';
  }
  for (const o of this.players) if (o !== t && o.alive) for (let dx = -2; dx <= 2; dx++) if (this._bodyContains(o, x + dx, y + 1)) return 'tank';
  return false;
};

P._tanksSettle = function (shot) {
  if (!this.options.tanksFall) return;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    const list = this.players.filter((t) => t.alive).sort((a, b) => (b.y - a.y) || (a.index - b.index));
    for (const t of list) {
      if (!t.alive || this._supportedAt(t, t.x, t.y)) continue;
      this._fallTank(shot, t); moved = true;
    }
    if (!moved) break;
  }
};

P._fallTank = function (shot, t) {                                           // RE §6 (fall 2 dmg/px, parachute rule, drift, landing on tank)
  const T = this.terrain, H = T.h, W = T.w;
  const x0 = t.x, y0 = t.y;
  let n = 0;
  while (!this._supportedAt(t, x0, y0 + n) && y0 + n < this.bounds.bottom) n++;
  const acc = 2 * n;
  const chute = t.chuteOn && t.inv[BY_ID.parachute.idx] > 0 && (t.chuteThreshold === 0 || acc > t.chuteThreshold);
  if (chute) t.inv[BY_ID.parachute.idx]--;
  let x = x0, y = y0, frames = 0, drift = false;
  const pts = [x, y];
  const wind = this.wind;
  while (!this._supportedAt(t, x, y) && y < this.bounds.bottom) {
    if (chute && Math.abs(wind) > 10 && this.rng.int(100) < Math.abs(wind)) {
      const nx = x + (wind > 0 ? 1 : -1);
      if (nx >= TANK.halfW && nx <= W - 1 - TANK.halfW) { x = nx; drift = true; }
    }
    y++; frames++;
    pts.push(x, y);
  }
  const ft = this._fallTicks();
  const start = shot.cursor;
  const ticks = frames * ft;
  const landed = this._supportedAt(t, x, y);
  let victim = null;
  if (landed === 'tank') for (const o of this.players) if (o !== t && o.alive) { for (let dx = -2; dx <= 2; dx++) if (this._bodyContains(o, x + dx, y + 1)) { victim = o; break; } if (victim) break; }
  const real = y - y0;
  const dmg = Math.max(0, 2 * real);
  this._ev(shot, { t: 'tankFall', tick: start, tank: t.id, x: x, y0, y1: y, x0, ticks, chute, dmg: chute ? 0 : dmg, ...(drift ? { pts } : {}) });
  t.x = x; t.y = y;
  shot.cursor = start + ticks;
  shot.now = shot.cursor;
  if (victim) {                                                              // landing on a tank: victim acc+50, faller acc/2+10 (RE §6, 1975)
    this.damageTank(shot, victim, dmg + 50, { owner: null, idx: 0, kind: 'crush' });
    this.damageTank(shot, t, Math.trunc(dmg / 2) + 10, { owner: null, idx: 0, kind: 'fall' });
  } else if (!chute && dmg > 0) this.damageTank(shot, t, dmg, { owner: null, idx: 0, kind: 'fall' });
};

P._tankBlocksFn = function () { return (x, y) => !!this._tankAt(x, y); };

// Tank death effect (171b:0005, jump table 171b:039d, variant = rand(11), 8 re-rolled while DS:50D8 != 0 -- DS:50D8 = 1 in the original dumps).
// Terrain-relevant behaviour per variant. [EXE] = read from the disassembly, [golden] = reproduced pixel-exact vs scenario_003, [est] = estimate:
//   0  flash only                                                              [EXE]
//   1..3 explode(Missile 20 [, BabyNuke 40, Nuke 75]) at the tank record (x, y)   [EXE radii]
//   4  lightning storm (1dce:01b4): rand(6)+5 bolts to random x on the bottom row, sky-restore craters R=(rand(10)+15)*scale at the bolt ends,
//      then explode(BabyNuke 40) at the tank. Bolt zig-zag RNG draws are not modelled.   [EXE structure, est. RNG]
//   5  ring burst (171b:0543): rays drawn in colour 250 (each pixel only if rand(4)==2), restored to sky inside R=rand(60)+45; tanks within R take 20   [EXE]
//   6  tank-coloured dirt charge (15a0:0081 with DS:DD58=tank): wedge of dirt over the tank                                  [EXE identity, est. geometry]
//   7  fountain of fireballs (1d4f:0258): dirt only re-shaded, nothing carved                                                [EXE]
//   8  tank hop/collapse (252c:00c9): unreachable while DS:50D8 != 0 (re-rolled); treated as flash only
//   9  shock blob (3451:016f): disc R30 + 15 sizes (si 20..6) x 4 discs of radius si at rand(40-si) / rand(360) deg; all restored to sky   [golden]
//  10  tank debris (171b:081b -> 27d2:0392): visual only                                                                      [est.]
P._deathFx = function (shot, t, variant) {
  const rad = (id) => Math.trunc(BY_ID[id].param * this.scale);
  const x = t.x, y = t.y;                                                     // tank record +0xE/+0x10 (not the shield centre)
  const blast = (R) => this._explode(shot, { x, y, R, kind: 'death', owner: null, mult: 1, tick: shot.cursor });
  if (variant === 0 || variant === 7 || variant === 8 || variant === 10) return { radii: [], modeled: variant === 0 || variant === 7 };
  if (variant >= 1 && variant <= 3) {
    const radii = variant === 1 ? [rad('missile')] : variant === 2 ? [rad('missile'), rad('baby_nuke')] : [rad('missile'), rad('baby_nuke'), rad('nuke')];
    for (const R of radii) blast(R);
    return { radii, modeled: true };
  }
  if (variant === 4) return this._deathLightning(shot, t, rad('baby_nuke'));
  if (variant === 5) return this._deathRing(shot, t);
  if (variant === 6) return this._deathDirt(shot, x, y);
  return this._deathBlob(shot, x, y);                                         // 9
};

P._carveDiscs = function (shot, tick, discs) {
  const spans = [];
  for (const [cx, cy, R] of discs) spans.push(...this.terrain.disc(cx, cy, R, 0));
  if (spans.length) this._ev(shot, { t: 'terrain', tick, spans });
  return spans.length;
};

P._deathBlob = function (shot, x, y) {                                        // variant 9, 3451:016f
  const discs = [[x, y, 30]];
  const deg = 0.017453293;                                                    // DS:6274
  for (let si = 20; si > 5; si--) {
    for (let k = 0; k < 4; k++) {
      const rd = this.rng.int(40 - si);
      const a = this.rng.int(360) * deg;
      const dx = Math.trunc(Math.cos(a) * rd), dy = Math.trunc(Math.sin(a) * rd);
      discs.push([x + Math.floor(dx * 36044 / 65536), y + dy, si]);
    }
  }
  const tick = shot.cursor + 30;
  this._carveDiscs(shot, tick, discs);
  shot.cursor = tick; shot.now = tick;
  return { radii: [30], modeled: true, discCount: discs.length };
};

P._deathRing = function (shot, t) {                                           // variant 5, 171b:0543
  const T = this.terrain, B = this.bounds, x = t.x, y = t.y;
  const L = this.rng.int(60) + 45;
  const deg = 0.017453293;
  const hits = [];
  const plot = (px, py) => {                                                  // 171b:0427
    if (py < B.top || py > B.bottom || px < B.left || px > B.right) return;
    if (this.rng.int(4) === 2) hits.push([px, py]);
  };
  const cb = (ox, oy) => { plot(x + ox, y + oy); plot(x + ox, y - oy); plot(x - ox, y + oy); plot(x - ox, y - oy); };   // 171b:04a3
  let ang = 0;
  for (let r = 5; r < L; r += 2) {
    for (let k = 0; k < 4; k++) {
      const a = ang * deg;
      const x1 = Math.floor(Math.trunc(Math.cos(a) * r) * 36044 / 65536), y1 = Math.trunc(Math.sin(a) * r);
      ang += this.rng.int(30); if (ang > 90) ang -= 90;
      // Bresenham 171b:0733 from (0,0) to (x1,y1), callback on every pixel
      let dx = Math.abs(x1), dy = Math.abs(y1);
      const sx = x1 < 0 ? -1 : 1, sy = y1 < 0 ? -1 : 1;
      let stx, sty;
      if (dx < dy) { [dx, dy] = [dy, dx]; stx = 0; sty = sy; } else { stx = sx; sty = 0; }
      let d = 2 * dy - dx, px = 0, py = 0;
      for (let i = 0; i <= dx; i++) {
        cb(px, py);
        if (d < 0) { px += stx; py += sty; d += 2 * dy; } else { px += sx; py += sy; d += 2 * dy - 2 * dx; }
      }
    }
  }
  for (const o of this.players) {                                             // 171b:0688: other living tanks inside the ring take 20
    if (o === t || !o.alive) continue;
    if (L > Math.hypot(o.x - x, o.y - y)) this.damageTank(shot, o, 20, { owner: null, idx: 0, kind: 'death' });
  }
  const rows = T.discRows(L);
  const spans = [];
  for (const [px, py] of hits) {                                              // final disc R=L restores colour-250 pixels to sky (171b:050e)
    const ady = Math.abs(py - y);
    if (ady > L) continue;
    const h = rows[ady]; if (h < 0) continue;
    const ox = px - x;
    if (ox < Math.floor(-h * 36044 / 65536) || ox > Math.floor(h * 36044 / 65536)) continue;
    if (T.cells[py * T.w + px] !== 0) { T.cells[py * T.w + px] = 0; spans.push([px, py, py, 0]); T.markDirty(px, px); }
  }
  const tick = shot.cursor + 40;
  if (spans.length) this._ev(shot, { t: 'terrain', tick, spans });
  shot.cursor = tick; shot.now = tick;
  return { radii: [L], modeled: true, pixelCount: spans.length };
};

P._deathLightning = function (shot, t, Rnuke) {                               // variant 4, 1dce:01b4 (param -1) then explode(BabyNuke)
  const B = this.bounds;
  const n = this.rng.int(6) + 5;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(this.rng.int(B.right - B.left) + B.left);
  const discs = xs.map((bx) => [bx, B.bottom, Math.trunc((this.rng.int(10) + 15) * this.scale)]);
  const tick = shot.cursor + 20;
  this._carveDiscs(shot, tick, discs);
  shot.cursor = tick; shot.now = tick;
  this._explode(shot, { x: t.x, y: t.y, R: Rnuke, kind: 'death', owner: null, mult: 1, tick: shot.cursor });
  return { radii: [Rnuke], modeled: false, boltCount: n };
};

P._deathDirt = function (shot, x, y) {                                        // variant 6, 15a0:0081 (tank colours): dirt wedge over the tank, geometry as the Dirt Charge estimate
  const T = this.terrain;
  const H = this.options.extraDirt ? 70 : 45;
  const spans = [];
  for (let k = 1; k <= H; k++) {
    const yy = y - k, hw = Math.floor(k * 0.7) + 2;
    if (yy < 0) break;
    for (let xx = Math.max(0, x - hw); xx <= Math.min(T.w - 1, x + hw); xx++) {
      if (T.cells[yy * T.w + xx] === 0) { T.cells[yy * T.w + xx] = DIRT_BASE; spans.push([xx, yy, yy, DIRT_BASE]); T.markDirty(xx, xx); }
    }
  }
  const tick = shot.cursor + 50;
  if (spans.length) this._ev(shot, { t: 'terrain', tick, spans });
  shot.cursor = tick; shot.now = tick;
  return { radii: [], modeled: false };
};

P._settle = function (shot) {
  const o = this.options, T = this.terrain;
  for (let iter = 0; iter < 12; iter++) {
    this._tanksSettle(shot);
    let fall = false;
    if (shot.forceDirt) { fall = true; shot.forceDirt = false; }
    else if (T.dirtyMin <= T.dirtyMax) {
      if (o.suspendDirt === 0) fall = true;
      else if (this.dirtFlag === 0 && this.rng.int(100) < 100 - o.suspendDirt) { fall = true; this.dirtFlag = 1; }
    }
    if (fall && T.dirtyMin <= T.dirtyMax) {
      const range = { x0: T.dirtyMin - 5, x1: T.dirtyMax + 5 };
      const res = dirtFall(T, this.rng, this._tankBlocksFn(), range, { bottom: this.bounds.bottom, anchorTop: this.sky === 'cavern' ? this.bounds.top : -1 });
      T.clearDirty();
      if (res.chunks.length) {
        const ft = this._fallTicks();
        const start = shot.cursor;
        const dur = res.frames * ft;
        this._ev(shot, { t: 'dirtFall', tick: start, dur, spans: res.chunks.map((c) => ({ x: c.x, y0: c.y0, y1: c.y1, dy: c.dy, t0: start + c.t0 * ft })) });
        if (res.spans.length) this._ev(shot, { t: 'terrain', tick: start + dur, spans: res.spans });
        shot.cursor = start + dur;
      }
      this._tanksSettle(shot);
    }
    if (!shot.deadQueue.length) break;
    const q = shot.deadQueue.splice(0);
    for (const t of q) {                                                     // destroyed tanks: death effect (171b:0005, variant = rand(11), re-roll 8 while DS:50D8 != 0)
      let variant = this.rng.int(11);
      while (variant === 8) variant = this.rng.int(11);
      const last = this.roundOver().over;
      const ev = this._ev(shot, { t: 'deathFx', tick: shot.cursor, tank: t.id, variant, radii: [], modeled: true, last });
      Object.assign(ev, this._deathFx(shot, t, variant));
    }
  }
};

// ---------------------------------------------------------------- retreat / fuel move
P.retreat = function (playerId) {
  const [p, err] = this._chk(playerId); if (err) return err;
  if (!this.roundActive || this.roundOver().over) return this._err('ROUND_OVER', 'round is over');
  const shot = this._newShot();
  this._ev(shot, { t: 'retreat', tick: 0, tank: p.id });
  shot.now = 20;
  p.alive = false; p.hp = 0; p.shield = null;                                // no score (SPEC 1.3)
  this._ev(shot, { t: 'death', tick: 20, tank: p.id, killer: null, x: p.x, y: p.y, retreat: true });
  shot.cursor = 20;
  shot.deadQueue.push(p);
  this._settle(shot);
  const over = this.roundOver();
  if (over.over) this._ev(shot, { t: 'roundEnd', tick: shot.cursor, winners: over.aliveIds });
  return { ok: true, events: this._finishEvents(shot), state: this._stateOf(shot), ticks: shot.ticks, roundOver: over.over };
};

P.fuelMove = function (playerId, { dir = 1, steps = 1 } = {}) {              // RE §6: 1 unit/px, uphill costs more (estimated)
  const [p, err] = this._chk(playerId); if (err) return err;
  if (p.tankType === 'fixed') return this._err('IMMOBILE', 'fixed turret cannot move');
  const T = this.terrain;
  const shot = this._newShot();
  dir = dir < 0 ? -1 : 1;
  let moved = 0;
  for (let s = 0; s < Math.max(1, Math.trunc(steps)); s++) {
    const nx = p.x + dir;
    if (nx < TANK.halfW || nx > T.w - 1 - TANK.halfW) break;
    const gy = T.surface(nx, Math.max(0, p.y - 12));
    if (gy < 0) break;
    const ny = gy - 1;
    const rise = p.y - ny;
    if (rise > 5) break;                                                     // too steep to climb (estimated limit)
    const cost = 1 + Math.max(0, rise);
    if (p.fuel < cost) {
      if (p.inv[BY_ID.fuel_tank.idx] > 0) { p.inv[BY_ID.fuel_tank.idx]--; p.fuel += 10; }
      if (p.fuel < cost) break;
    }
    p.fuel -= cost;
    p.x = nx; p.y = ny; moved++;
    if (-rise > 6) break;                                                    // steep downhill: slides and falls (estimated)
  }
  this._settle(shot);
  const over = this.roundOver();
  if (!moved && !shot.events.length) return { ok: false, error: 'NO_FUEL', message: 'cannot move', x: p.x, y: p.y, fuel: p.fuel };
  return { ok: true, x: p.x, y: p.y, fuel: p.fuel, moved, events: this._finishEvents(shot), state: this._stateOf(shot), roundOver: over.over };
};
