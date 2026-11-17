// Game: players, rounds, round setup (RE §8), equipment controls (RE §6), views.
// Shot resolution lives in shot.js, economy in economy.js, AI in ai.js (mixed into the prototype in index.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { R250 } from './rng.js';
import { normalizeOptions, explosionScale, WALLS, SKIES, AI_TYPES, TANK, GROUND_COLORS, DIRT_BASE } from './config.js';
import { WEAPONS, BY_ID, SHIELDS, MAX_HP, MAX_STOCK, GUIDANCE_KIND } from './weapons.js';
import { Terrain, listMtn, loadMtn } from './terrain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MTN_DIR = path.resolve(HERE, '..', '..', 'data', 'mtn');

export class Game {
  constructor({ options, players, seed, rngSkip } = {}) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 10) throw new Error('players: 2..10 required');
    this.options = normalizeOptions(options);
    this.seed = (seed ?? 0) & 0xffff;
    this.rng = new R250(this.seed);
    for (let i = 0; i < (rngSkip | 0); i++) this.rng.r250();      // diff-test hook: original consumed many draws before round setup
    this.scale = explosionScale(this.options);
    this.mtnDir = this.options.mtnDir || DEFAULT_MTN_DIR;
    this.round = 0;
    this.wind = 0;
    this.wall = 'none';
    this.wallCode = 0;
    this.sky = 'plain';
    this.land = { land1: this.options.land1, land2: this.options.land2, flatland: this.options.flatland };
    this.terrain = new Terrain(this.options.width, this.options.height);
    this.dirFlip = 1;
    this.over = false;
    this.roundActive = false;
    this.dirtFlag = 0;
    this.shotCounter = 0;
    this.projSeq = 0;
    this.players = [];
    const ids = new Set();
    const banks = new Map();
    players.forEach((p, i) => {
      if (ids.has(p.id)) throw new Error('duplicate player id ' + p.id);
      ids.add(p.id);
      let aiType = null;
      if (p.cpu) {
        aiType = AI_TYPES.includes(p.cpu) ? p.cpu : 'moron';
      }
      const team = this.options.teams === 'none' ? p.id : (p.team ?? p.id);
      let bank;
      if (this.options.teams === 'corporate') { if (!banks.has(team)) banks.set(team, { cash: 0 }); bank = banks.get(team); } else bank = { cash: 0 };
      const inv = new Array(WEAPONS.length).fill(0);
      inv[0] = MAX_STOCK;                                   // Baby Missile: unlimited (RE §4)
      this.players.push({
        id: p.id, name: p.name ?? String(p.id), colorIndex: p.colorIndex ?? i, tankType: (p.tankType === 'triple' && !p.cpu) ? 'classic' : (p.tankType ?? 'classic'),
        cpu: p.cpu || false, aiType, aiDeclared: p.cpu === 'unknown' ? 'unknown' : null, team,
        index: i, inv, bank, score: 0, autoDefense: false,
        alive: false, x: 0, y: 0, hp: MAX_HP, angle: 90, power: 200, weapon: 'baby_missile',
        shield: null, chuteOn: true, chuteThreshold: 5, trigger: false, fuel: 0, guidance: null,
        lastImpact: null, aiMemo: {}, stats: { kills: 0, damage: 0 },
      });
    });
    for (const p of this.players) p.bank.cash = 0;
    const seen = new Set();
    for (const p of this.players) if (!seen.has(p.bank)) { seen.add(p.bank); p.bank.cash = this.options.initialCash; }
    if (this.options.teams === 'corporate') { /* shared bank starts at initialCash once */ }
    // Unknown AI: hide behind rand(7)+1 (RE §10) -> resolved lazily at first use to keep round setup order stable
    this.rrBase = null;
    this._initMarket();
  }

  // ---------- helpers ----------
  P(id) { const p = this.players.find((q) => q.id === id); return p; }
  alive() { return this.players.filter((p) => p.alive); }
  teamOf(p) { return this.options.teams === 'none' ? p.id : p.team; }
  sameTeam(a, b) { return a !== b && this.options.teams !== 'none' && this.teamOf(a) === this.teamOf(b); }
  /** VICIOUS: once only one team remains, teammates are enemies (RE n/a, SPEC 1.14) */
  friendly(a, b) {
    if (a === b || this.options.teams === 'none') return false;
    if (this.options.teams === 'vicious' && this._singleTeamLeft()) return false;
    return this.teamOf(a) === this.teamOf(b);
  }
  _singleTeamLeft() { return new Set(this.alive().map((p) => this.teamOf(p))).size <= 1; }

  // ---------- round setup (RE §8) ----------
  startRound() {
    if (this.over) return { ok: false, error: 'GAME_OVER', message: 'game over' };
    const o = this.options, rng = this.rng, T = this.terrain;
    this.round++;
    const w = o.width, h = o.height;
    // playfield inside the 3px frame / HUD (scenario_001: dirt spans x 3..w-4, y 24..h-4); terrain walk uses top=24, bottom=h-4
    const bounds = { left: 3, right: w - 4, top: 24, bottom: h - 4 };
    this.bounds = bounds;
    // interest after shopping (RE §7), once per bank
    const interest = {};
    const seenBanks = new Set();
    for (const p of this.players) {
      if (seenBanks.has(p.bank)) continue;
      seenBanks.add(p.bank);
      if (p.bank.cash > 0) {
        const add = Math.trunc(p.bank.cash * Math.trunc(o.interestRate * 10000) / 10000);
        p.bank.cash += add;
        interest[p.id] = add;
      }
    }
    for (const p of this.players) p.roundStartScore = p.score;      // baseline for settlement `gains` (this round's earnings)
    // Round-setup RNG order (verified against 3 original runs, docs/ORIGINAL_DIFF_TESTING.md §9):
    // [random land] -> ground color rand(6) -> wall -> wind -> mountain roll frand (+ file pick) -> sky rand(6) -> terrain -> tank shuffle
    if (o.randomLand) this.land = { flatland: rng.int(2) === 1, land1: rng.int(100), land2: rng.int(100) };
    else this.land = { land1: o.land1, land2: o.land2, flatland: o.flatland };
    const colorIdx = rng.int(6);
    if (o.wall === 'random') this.wallCode = rng.int(6);
    else if (o.wall === 'erratic') this.wallCode = rng.int(6);
    else this.wallCode = Math.max(0, WALLS.indexOf(o.wall));
    this.wall = WALLS[this.wallCode];
    // wind (RE §8.4)
    let wind = rng.int(Math.trunc(o.maxWind / 2)) - Math.trunc(o.maxWind / 4);
    if (rng.int(100) < 20) { wind *= 2; if (rng.int(100) < 40) wind *= 2; }
    this.wind = wind;
    // scanned mountain roll + file pick happen before the sky pick in the original (frand()*100 <= MTN_PERCENT)
    const files = listMtn(this.mtnDir);
    let mtnName = null;
    if (rng.frand() * 100 <= o.mtnPercent && files.length) mtnName = files[rng.int(files.length)];
    this.sky = o.sky === 'random' ? SKIES[rng.int(6)] : (SKIES.includes(o.sky) ? o.sky : 'plain');
    // terrain (RE §8.2)
    const palette = { ground: GROUND_COLORS[colorIdx], mtn: null, mountain: null };
    const dir = this.dirFlip;
    this.dirFlip = -this.dirFlip;
    let usedMtn = false;
    if (mtnName && this.sky !== 'cavern') {
      const mtn = loadMtn(this.mtnDir, mtnName);
      T.fromMountain(rng, mtn, bounds);
      palette.mtn = mtn.palette; palette.mountain = mtnName.replace(/\.mtn$/i, '');
      usedMtn = true;
    }
    if (!usedMtn) {
      const gen = { ...bounds, ...this.land, dir, color: DIRT_BASE };
      if (this.sky === 'cavern') {                       // floor walk over [mid, bottom] first, then ceiling walk over [top, mid]
        const mid = (bounds.top + bounds.bottom) >> 1;
        T.generate(rng, { ...gen, top: mid });
        T.generateCeiling(rng, { ...gen, mid });
      } else T.generate(rng, gen);
    }
    T.clearDirty();
    // tanks (RE §8.3)
    const n = this.players.length;
    const slot = Math.trunc((bounds.right - bounds.left + 1) / n);
    // slot order: original 23a1:0a43 mode 0: s = rand(2); while (s++ < 50) { i = rand(n); j = rand(n) until j != i; swap }; first = rand(n)
    const order = this.players.map((p) => p.index);
    if (order.length > 1) {
      for (let s = rng.int(2); s < 50; s++) {
        const i = rng.int(n);
        let j = rng.int(n);
        while (j === i) j = rng.int(n);
        [order[i], order[j]] = [order[j], order[i]];
      }
      rng.int(n);                                          // first-player pick (kept for RNG stream parity)
    }
    order.forEach((pi, slotIdx) => {
      const p = this.players[pi];
      const x = bounds.left + Math.trunc(slot / 2) + slotIdx * slot;
      this._placeTank(p, x);
    });
    for (const p of this.players) {
      p.alive = true; p.hp = MAX_HP; p.shield = null; p.power = 200;
      p.trigger = false; p.guidance = null; p.fuel = 0; p.lastImpact = null; p.aiMemo = {};
      // initial turret angle (23a1:0da3): t = trunc(atan2(y-top, ((w-1)>>1) - x) in degrees); original field = t>90 ? 180-t (facing -1) : t (facing +1) -> unified angle = t
      { const t = Math.trunc(Math.atan2(p.y - bounds.top, ((w - 1) >> 1) - p.x) * 180 / Math.PI); p.angle = Math.min(180, Math.max(0, t)); p.facing = t > 90 ? -1 : 1; }
      if (p.inv[BY_ID[p.weapon].idx] <= 0) p.weapon = 'baby_missile';
      p.chuteOn = true;
      p.autoDefense = p.autoDefense || p.inv[BY_ID.auto_defense.idx] > 0;
    }
    if (this.rrBase === null) { this.rrBase = this._shuffled(this.players.map((p) => p.id)); }
    this.roundActive = true;
    this.dirtFlag = 0;
    this.lastResult = null;
    return {
      round: this.round, terrain: T.toRLE(), tanks: this.players.map((p) => this.view(p)),
      wind: this.wind, wall: this.wall, wallCode: this.wallCode, sky: this.sky, palette, interest,
      order: this._order(), events: [], rounds: o.rounds,
    };
  }

  _shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** Tank placement + flat pad, ported from 23a1:07f2 (normal) and 23a1:08e7 (cavern); tank half width = 4.
   *  Normal: the tank drops from the top until every column under it has dirt at y+1; higher ground is dug away on the way (pad at the lowest surface).
   *  Cavern: y = surface above the center column (scanned up from the bottom); dirt above y is cleared in the 9 columns, sky gaps below y+1 are filled
   *  with dirt (one rand(dirtColors) draw per filled pixel, 223a:0c20). */
  _placeTank(p, x) {
    const T = this.terrain, hw = TANK.halfW, B = this.bounds;
    x = Math.max(hw, Math.min(T.w - 1 - hw, x));
    const dirt = (xx, yy) => T.get(xx, yy) !== 0;
    let y;
    if (this.sky !== 'cavern') {
      y = B.top;
      for (;;) {
        y++;
        let all = true;
        const hit = [];
        for (let dx = -hw; dx <= hw; dx++) { if (dirt(x + dx, y + 1)) hit.push(x + dx); else all = false; }
        if (all) break;
        for (const xx of hit) T.cells[(y + 1) * T.w + xx] = 0;
      }
    } else {
      const mid = (B.top + B.bottom) >> 1;
      let sy = B.bottom;
      while (sy >= mid && dirt(x, sy)) sy--;
      y = sy;
      for (let r = y, found = true; r >= mid && found; r--) {                       // dig upward while the row still has dirt
        found = false;
        for (let dx = -hw; dx <= hw; dx++) if (dirt(x + dx, r)) { found = true; T.cells[r * T.w + x + dx] = 0; }
      }
      for (let r = y + 1, found = true; r <= B.bottom && found; r++) {                // fill gaps below
        found = false;
        for (let dx = -hw; dx <= hw; dx++) if (!dirt(x + dx, r)) { found = true; T.cells[r * T.w + x + dx] = T.dirtColors[this.rng.int(T.dirtColors.length)]; }
      }
    }
    p.x = x; p.y = y;
  }

  _order() {
    const o = this.options.playOrder;
    const al = this.alive();
    let ids = al.map((p) => p.id);
    if (o === 'losers' || o === 'winners') {
      const sorted = al.slice().sort((a, b) => (a.score - b.score) || (a.index - b.index));
      if (o === 'winners') sorted.reverse();
      ids = sorted.map((p) => p.id);
    } else if (o === 'roundrobin') {
      const base = this.rrBase || al.map((p) => p.id);
      const k = (Math.max(1, this.round) - 1) % base.length;
      const rot = base.slice(k).concat(base.slice(0, k));
      ids = rot.filter((id) => this.P(id).alive);
    } else {
      ids = this._shuffled(ids);
    }
    return ids;
  }
  nextOrder() { return this._order(); }

  roundOver() {
    const al = this.alive();
    const teams = new Set(al.map((p) => this.teamOf(p)));
    let over;
    if (this.options.teams === 'vicious') over = al.length <= 1;
    else over = teams.size <= 1;
    return { over, aliveIds: al.map((p) => p.id), winnerTeam: teams.size === 1 ? [...teams][0] : null };
  }

  // ---------- turn start (RE §8.4, §8.6) ----------
  beginTurn(playerId) {
    const p = this.P(playerId);
    if (!p || !p.alive) return { ok: false, error: 'NOT_ALIVE', message: 'not alive' };
    const o = this.options, rng = this.rng;
    const events = [];
    this.dirtFlag = 0;
    if (o.changingWind) {
      this.wind += rng.int(11) - 5;
      this.wind = Math.max(-o.maxWind, Math.min(o.maxWind, this.wind));
    }
    if (o.wall === 'erratic') { this.wallCode = rng.int(6); this.wall = WALLS[this.wallCode]; }
    if (this.sky === 'stormy') {
      if (rng.int(4) === 1) {
        const x = rng.int(o.width);
        let y = this.terrain.surface(x, 0); if (y < 0) y = o.height - 1;
        const ev = { t: 'lightning', tick: 0, x, y: Math.max(0, y - 1) };
        const hit = this.alive().find((q) => Math.abs(q.x - x) <= TANK.halfW);
        if (hit) {
          ev.tank = hit.id;
          if (o.hostile) {
            const shot = this._newShot();
            shot.events.push(ev);
            this.damageTank(shot, hit, 10, { owner: null, idx: 0, kind: 'lightning' });
            this._settle(shot);
            return { ok: true, events: this._finishEvents(shot), wind: this.wind, wall: this.wall, state: this._stateOf(shot) };
          }
        }
        events.push(ev);
      } else if (rng.int(2) === 0) events.push({ t: 'flash', tick: 0 });
    }
    return { ok: true, events, wind: this.wind, wall: this.wall, state: {} };
  }

  // ---------- views ----------
  view(p) {
    return {
      id: p.id, name: p.name, colorIndex: p.colorIndex, tankType: p.tankType, team: this.teamOf(p), cpu: p.cpu,
      x: p.x, y: p.y, alive: p.alive, hp: p.hp, maxPower: p.hp * 10, angle: p.angle, power: p.power, weapon: p.weapon,
      shield: p.shield ? { item: p.shield.item, hp: p.shield.hp } : null,
      parachute: { on: p.chuteOn, threshold: p.chuteThreshold }, trigger: p.trigger, fuel: p.fuel,
      guidance: p.guidance ? { ...p.guidance } : null, cash: p.bank.cash, score: p.score,
    };
  }
  state() { return { round: this.round, wind: this.wind, wall: this.wall, tanks: this.players.map((p) => this.view(p)) }; }
  snapshot() { return { ...this.state(), sky: this.sky, terrain: this.terrain.toRLE(), rng: this.rng.state() }; }
  rngState() { return this.rng.state(); }

  // ---------- aim / equipment (RE §3.1, §6) ----------
  _chk(playerId) {
    const p = this.P(playerId);
    if (!p) return [null, { ok: false, error: 'NO_PLAYER', message: 'unknown player' }];
    if (!p.alive) return [null, { ok: false, error: 'NOT_ALIVE', message: 'tank is dead' }];
    return [p, null];
  }
  aim(playerId, { angle, power, weapon } = {}) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (angle !== undefined) p.angle = Math.max(0, Math.min(180, Math.trunc(angle)));
    if (p.angle !== 90) p.facing = p.angle > 90 ? -1 : 1;
    if (power !== undefined) p.power = Math.max(0, Math.min(p.hp * 10, Math.trunc(power)));
    if (weapon !== undefined) {
      const w = BY_ID[weapon];
      if (!w || w.idx > 32 || p.inv[w.idx] <= 0) return { ok: false, error: 'NO_WEAPON', message: 'weapon not owned' };
      p.weapon = weapon;
    }
    return { ok: true, tank: this.view(p) };
  }

  useBattery(playerId) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (p.inv[BY_ID.battery.idx] <= 0) return { ok: false, error: 'NO_ITEM', message: 'no battery' };
    if (p.hp >= MAX_HP) return { ok: false, error: 'FULL', message: 'energy full' };
    p.inv[BY_ID.battery.idx]--;
    const before = p.hp;
    p.hp = Math.min(MAX_HP, p.hp + 10);                       // RE §6
    if (p.power > p.hp * 10) p.power = p.hp * 10;
    return { ok: true, hp: p.hp, delta: p.hp - before, events: [{ t: 'hp', tick: 0, tank: p.id, hp: p.hp, delta: p.hp - before, shield: p.shield?.hp ?? 0, shieldDelta: 0, src: 'battery' }] };
  }
  parachute(playerId, { on, threshold } = {}) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (on !== undefined) p.chuteOn = !!on;
    if (threshold !== undefined) p.chuteThreshold = Math.max(0, Math.min(100, Math.trunc(threshold)));
    return { ok: true, parachute: { on: p.chuteOn, threshold: p.chuteThreshold } };
  }
  shield(playerId, item) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (item === null || item === undefined) {
      const had = p.shield; p.shield = null;
      return { ok: true, events: had ? [{ t: 'shield', tick: 0, tank: p.id, item: had.item, hp: 0, kind: 'off' }] : [] };
    }
    const def = SHIELDS[item];
    if (!def) return { ok: false, error: 'BAD_ARGS', message: 'not a shield item' };
    const w = BY_ID[item];
    if (p.inv[w.idx] <= 0) return { ok: false, error: 'NO_ITEM', message: 'item not owned' };
    if (p.shield && p.shield.item === item && p.shield.hp >= def.hp) return { ok: false, error: 'FULL', message: 'already full' };
    p.inv[w.idx]--;
    p.shield = { item, hp: def.hp };                           // RE §6: hp = max on activation, replaces the old one
    return { ok: true, shield: { ...p.shield }, events: [{ t: 'shield', tick: 0, tank: p.id, item, hp: def.hp, kind: 'on' }] };
  }
  trigger(playerId, on) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (on && p.inv[BY_ID.contact_trigger.idx] <= 0) return { ok: false, error: 'NO_ITEM', message: 'no contact trigger' };
    p.trigger = !!on;
    return { ok: true, trigger: p.trigger };
  }
  guidance(playerId, g) {
    const [p, err] = this._chk(playerId); if (err) return err;
    if (g === null || g === undefined) { p.guidance = null; return { ok: true, guidance: null }; }
    const id = GUIDANCE_KIND[g.type];
    if (!id) return { ok: false, error: 'BAD_ARGS', message: 'unknown guidance' };
    if (p.inv[BY_ID[id].idx] <= 0) return { ok: false, error: 'NO_ITEM', message: 'guidance not owned' };
    p.guidance = { type: g.type, target: g.target ?? null };
    return { ok: true, guidance: { ...p.guidance } };
  }
}
