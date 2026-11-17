import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, WEAPONS, R250, stepProjectile, physConsts, launchVelocity, decodeTerrain, applySpans, parseMtn, encodeMkt, decodeMkt } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorch_data.json'), 'utf8'));

const players = (n = 3, cpu = false) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, colorIndex: i, tankType: 'classic', cpu: cpu ? ['spoiler', 'shooter', 'cyborg', 'tosser'][i % 4] : false, team: i }));

test('R250 matches the documented seed-0 rand(100) sample', () => {
  const r = new R250(0);
  assert.deepEqual(Array.from({ length: 10 }, () => r.int(100)), [11, 77, 10, 77, 75, 81, 99, 14, 85, 2]);
});

test('weapon table: 48 records equal scorch_data.json items (EXE values)', () => {
  assert.equal(WEAPONS.length, 48);
  assert.equal(DATA.items.length, 48);
  for (const it of DATA.items) {
    const w = WEAPONS[it.id];
    assert.equal(w.price, it.price, it.name_en + ' price');
    assert.equal(w.bundle, it.bundle_size, it.name_en + ' bundle');
    assert.equal(w.arms, it.arms_level, it.name_en + ' arms');
    assert.equal(w.param, it.blast_radius_raw, it.name_en + ' param');
  }
  const ko = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items_ko.json'), 'utf8'));
  assert.deepEqual(ko.map((x) => x.id), WEAPONS.map((w) => w.id));
});

test('flight integrator equals the documented formula (RE 3.1/3.2)', () => {
  const opt = { gravity: 0.2, airViscosity: 5 };
  const wind = 80;
  const k = physConsts(opt, wind);
  assert.equal(k.gravStep, 10);                            // 50*G
  assert.equal(k.windStep, 2);                             // wind/40
  assert.equal(k.visc, 1 - 5 / 10000);
  const v = launchVelocity(60, 400);
  assert.equal(v.vx, Math.floor(Math.trunc(Math.cos(60 * 0.017453293) * 400) * 36044 / 65536));   // x velocity x0.55 pixel aspect
  assert.equal(v.vy, Math.trunc(Math.sin(60 * 0.017453293) * 400));
  // independent re-derivation
  let x = 100, y = 300, vx = v.vx, vy = v.vy;
  const p = { x, y, vx, vy };
  for (let i = 0; i < 120; i++) {
    x += vx * 0.02; y -= vy * 0.02;
    vx *= 0.9995; vy *= 0.9995;
    vy -= 10; vx += 2;
    stepProjectile(p, k);
    assert.equal(p.x, x); assert.equal(p.y, y); assert.equal(p.vx, vx); assert.equal(p.vy, vy);
  }
  // speed cap 1000
  const q = { x: 0, y: 0, vx: 1500, vy: 0 };
  stepProjectile(q, physConsts({ gravity: 0.2, airViscosity: 0 }, 0));
  assert.ok(Math.abs(Math.hypot(1000, 10) - Math.hypot(q.vx, q.vy)) < 1e-9 || Math.abs(q.x - 20) < 1e-9);
});

function flatGame(extra = {}) {
  const g = createGame({ seed: 42, options: { maxWind: 0, sky: 'plain', mtnPercent: 0, ...extra }, players: players(2) });
  g.startRound();
  const T = g.terrain;
  T.cells.fill(0);
  for (let y = 300; y < T.h; y++) for (let x = 0; x < T.w; x++) T.cells[y * T.w + x] = 0x50;
  const a = g.P('p0'), b = g.P('p1');
  a.x = 100; a.y = 299; b.x = 200; b.y = 299;
  return { g, a, b };
}

test('explosion damage = (int)((R-d)*100/R) * (weaponIdx+1), >100 -> 110, shield absorbs', () => {
  const { g, a, b } = flatGame();
  const rd = g._radialDamages(150, 296, 10, 1);
  assert.deepEqual(rd, []);                                  // nobody in range
  const near = g._radialDamages(b.x + 5, b.y - 3, 10, 1);    // baby missile idx0 -> x1, d=5 -> 50
  assert.equal(near[0].dmg, 50);
  assert.equal(g._radialDamages(b.x + 5, b.y - 3, 20, 2)[0].dmg, 110);   // missile: pct 75 * 2 = 150 -> 110
  assert.equal(g._radialDamages(b.x + 15, b.y - 3, 20, 2)[0].dmg, 50);   // pct 25 * 2
  // real shot: baby missile onto the floor next to b, hp event matches formula
  b.x = 140; a.x = 100;
  const r = g.fire('p0', { weapon: 'baby_missile', angle: 45, power: 200 });
  assert.ok(r.ok);
  const ex = r.events.find((e) => e.t === 'explode');
  const d = Math.hypot(ex.x - b.x, ex.y - (b.y - 3));
  const hpev = r.events.find((e) => e.t === 'hp' && e.tank === 'p1');
  if (d < 10) assert.equal(hpev.delta, -Math.trunc((10 - d) * 100 / 10));
  else assert.equal(hpev, undefined);
  // shield absorbs
  b.hp = 100; b.shield = { item: 'shield', hp: 30 };
  const shot = g._newShot();
  g.damageTank(shot, b, 50, { owner: a, idx: 0 });
  assert.equal(b.hp, 80); assert.equal(b.shield, null);      // 30 absorbed, 20 passes through 1:1
  assert.equal(a.score, 30 * 20 + 2 * 30);                   // score: 30/hp + 2/shield point
});

test('determinism: same seed and inputs -> identical events; different seed differs', () => {
  const run = (seed) => {
    const g = createGame({ seed, options: {}, players: players(3, true) });
    const out = [JSON.stringify(g.startRound())];
    for (let t = 0; t < 12 && !g.roundOver().over; t++) {
      for (const id of g.nextOrder()) {
        if (g.roundOver().over) break;
        if (!g.P(id).alive) continue;
        g.beginTurn(id);
        const r = g.aiTurn(id);
        out.push(JSON.stringify([r.events, r.state]));
      }
    }
    out.push(JSON.stringify(g.rngState()), String(g.terrain.checksum()));
    return out.join('|');
  };
  assert.equal(run(99), run(99));
  assert.notEqual(run(99), run(100));
});

test('MTN files parse to EOF and are usable terrain', () => {
  const dir = path.join(ROOT, 'data', 'mtn');
  const files = fs.readdirSync(dir).filter((f) => /\.mtn$/i.test(f));
  assert.equal(files.length, 10);
  for (const f of files) { const m = parseMtn(fs.readFileSync(path.join(dir, f))); assert.ok(m.w > 300 && m.cols.length === m.w); }
  const g = createGame({ seed: 3, options: { mtnPercent: 100, sky: 'plain' }, players: players(2) });
  const r = g.startRound();
  assert.ok(r.palette.mountain);
  assert.equal(decodeTerrain(r.terrain).length, 360 * 480);
});

test('full rounds with every AI type, shop between rounds, events replay to the same terrain', () => {
  const g = createGame({ seed: 2024, options: { rounds: 3, initialCash: 60000, sky: 'random', wall: 'random', changingWind: true, suspendDirt: 30 }, players: [
    { id: 'a', name: 'A', colorIndex: 0, tankType: 'classic', cpu: 'moron' }, { id: 'b', name: 'B', colorIndex: 1, tankType: 'wedge', cpu: 'shooter' },
    { id: 'c', name: 'C', colorIndex: 2, tankType: 'heavy', cpu: 'poolshark' }, { id: 'd', name: 'D', colorIndex: 3, tankType: 'scout', cpu: 'tosser' },
    { id: 'e', name: 'E', colorIndex: 4, tankType: 'wheeled', cpu: 'chooser' }, { id: 'f', name: 'F', colorIndex: 5, tankType: 'classic', cpu: 'spoiler' },
    { id: 'h', name: 'H', colorIndex: 6, tankType: 'classic', cpu: 'cyborg' }, { id: 'i', name: 'I', colorIndex: 7, tankType: 'triple', cpu: 'unknown' } ] });
  let rounds = 0;
  while (!g.over) {
    for (const p of g.players) g.aiShop(p.id);
    const info = g.startRound();
    rounds++;
    const grid = decodeTerrain(info.terrain);
    let turns = 0;
    while (!g.roundOver().over && turns < 300) {
      for (const id of g.nextOrder()) {
        if (g.roundOver().over) break;
        if (!g.P(id).alive) continue;
        const bt = g.beginTurn(id);
        assert.ok(bt.ok);
        for (const e of bt.events) if (e.t === 'terrain') applySpans(grid, 360, e.spans);
        const r = g.aiTurn(id);
        assert.ok(r.ok, JSON.stringify(r));
        for (const ev of r.events) {
          if (ev.t === 'terrain') applySpans(grid, 360, ev.spans);
          assert.ok(Number.isInteger(ev.tick) && ev.tick >= 0);
        }
        turns++;
      }
    }
    assert.deepEqual(Array.from(grid), Array.from(g.terrain.cells), 'client replay == server terrain (round ' + rounds + ')');
    const s = g.endRound();
    assert.ok(s.ok);
  }
  assert.equal(rounds, 3);
});

test('MIRV splits at the apex into 5 warheads; Death\'s Head into 9', () => {
  for (const [id, n] of [['mirv', 5], ['deaths_head', 9]]) {
    const { g, a } = flatGame();
    for (const w of WEAPONS) a.inv[w.idx] = 5;
    const r = g.fire('p0', { weapon: id, angle: 80, power: 300 });
    assert.ok(r.ok);
    assert.equal(r.events.filter((e) => e.t === 'split').length, 1);
    assert.equal(r.events.filter((e) => e.t === 'proj').length, n);
  }
});

test('shop: partial purchase +20%, sell 80%, interest on round start', () => {
  const g = createGame({ seed: 1, options: { initialCash: 100000, mtnPercent: 0 }, players: players(2) });
  assert.equal(g.buy('p0', 'baby_nuke', 1).cost, 10000);
  assert.equal(g.inventory('p0').items.baby_nuke, 3);
  for (let i = 0; i < 40; i++) g.buy('p0', 'tracer', 1);     // 20 per bundle: cap 99
  assert.equal(g.inventory('p0').items.tracer, 99);
  const before = g.inventory('p0').cash;
  const so = g.sellOffer('p0', 'baby_nuke', 3);
  assert.equal(so.offer, Math.trunc(10000 / 3 * 3 * 0.8));
  g.sell('p0', 'baby_nuke', 3);
  assert.equal(g.inventory('p0').cash, before + so.offer);
  const cash = g.inventory('p1').cash;
  g.startRound();
  assert.equal(g.inventory('p1').cash, cash + Math.trunc(cash * 500 / 10000));
  const m = decodeMkt(encodeMkt(g.exportMarket()));
  assert.equal(m.cur.length, 48);
});

test('tank fall damage lowers HP and the max power (HP x 10); power is clamped and over-limit fire is rejected', () => {
  const g = createGame({ options: { sky: 'plain', maxWind: 0 }, players: players(2), seed: 5 });
  g.startRound();
  const t = g.players[0];
  t.power = 1000;
  t.y -= 15;                                                   // tank hovering 15 px above its pad: falls and takes 2 dmg/px
  const shot = g._newShot();
  g._tanksSettle(shot);
  assert.equal(t.hp, 100 - 30);
  assert.equal(t.power, 700);
  const ev = shot.events.find((e) => e.t === 'hp');
  assert.ok(ev && ev.delta === -30 && ev.tank === t.id);
  assert.equal(g.view(t).maxPower, 700);
  const r = g.fire(t.id, { angle: 90, power: 800 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BAD_POWER');
});
