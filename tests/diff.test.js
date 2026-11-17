// Original-vs-engine differential test (golden files only; the emulator is never run here). See docs/ORIGINAL_DIFF_TESTING.md.
// scenario_001: seed = 50045 (time 1995-06-04 10:30:21 + 4h Borland EDT offset), round setup starts at R250 draw 10573 (color pick).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../server/engine/index.js';
import { R250 } from '../server/engine/rng.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const W = 360;
const golden = JSON.parse(fs.readFileSync(path.join(DIR, 'scenario_001.json'), 'utf8'));
const pix = (tag) => zlib.gunzipSync(fs.readFileSync(path.join(DIR, `scenario_001.${tag}.pix.gz`)));
const inSprite = (x, y) => x >= 179 && x <= 185 && y >= 239 && y <= 245;     // wind-arrow HUD sprite drawn over the ceiling (not terrain)
const isDirt = (c) => c >= 0x50 && c <= 0x68;
const rec = (hex, off) => { const b = Buffer.from(hex, 'hex'); return b.readInt16LE(off); };

function setup() {
  const game = createGame({ options: {}, players: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], seed: 50045, rngSkip: 10573 });
  const info = game.startRound();
  return { game, info };
}
function terrainDiff(game, gold) {
  const cells = game.terrain.cells; let bad = 0;
  for (let y = 16; y < 480; y++) for (let x = 0; x < W; x++) {
    if (inSprite(x, y)) continue;
    if ((cells[y * W + x] !== 0) !== isDirt(gold[y * W + x])) bad++;
  }
  return bad;
}

test('scenario_001 round setup: wind, terrain (all columns), tank positions/angles equal the original', () => {
  const { game, info } = setup();
  assert.equal(info.wind, golden.wind_before);
  assert.equal(info.sky, 'cavern');
  assert.equal(terrainDiff(game, pix('before')), 0);
  golden.tanks_before.forEach((t, i) => {
    const p = game.players[i];
    assert.equal(p.x, rec(t.raw_hex, 0xe), `tank ${i} x`);
    assert.equal(p.y, rec(t.raw_hex, 0x10), `tank ${i} y`);
    const ang = rec(t.raw_hex, 0x92), facing = rec(t.raw_hex, 0x94);
    if (i === 0) assert.equal(p.angle, 180 - 78);                // golden tank 0 was already aimed to 45 (D1); its initial field was 78, facing -1 (D0)
    else assert.equal(p.angle, facing === 1 ? ang : 180 - ang, `tank ${i} angle`);
  });
});

test('scenario_001 shot (angle 45 left / power 500 / Baby Missile): path pixels, impact and final terrain equal the original', () => {
  const { game } = setup();
  game._trace = [];
  const res = game.fire('a', { angle: 135, power: 500, weapon: 'baby_missile' });
  assert.equal(res.ok, true);
  const boom = res.events.find((e) => e.t === 'explode');
  assert.deepEqual([boom.x, boom.y], [119, 314]);                 // projectile record x=119.36 y=314.0009 in the original dump
  // trace pixels the fireball erased are not in the golden (mapped disc, R=10)
  const erased = new Set();
  for (let v = -10; v <= 10; v++) for (let u = -10; u <= 10; u++) if (u * u + v * v <= 110) erased.add(`${119 + Math.floor(u * 36044 / 65536)},${314 + v}`);
  const sim = new Set(game._trace.map((p) => p.join(',')).filter((s) => !erased.has(s)));
  const gold = new Set(golden.trace.map((p) => p.join(',')));
  assert.equal(gold.size, 269);
  assert.deepEqual([...sim].filter((s) => !gold.has(s)), []);
  assert.deepEqual([...gold].filter((s) => !sim.has(s)), []);
  assert.equal(terrainDiff(game, pix('after')), 0);
});

// scenario_002: same round as 001, Baby Missile angle 105 (field 75) / power 490 aimed at the cavern CEILING (explodes at 230,208).
// The crater cuts the ceiling underside; the detached lower pieces (x=224,225) fall in the original, the part still attached to the top row stays.
test('scenario_002 cavern ceiling shot: detached ceiling dirt falls, top-attached ceiling stays (final terrain equals the original)', () => {
  const g2 = JSON.parse(fs.readFileSync(path.join(DIR, 'scenario_002.json'), 'utf8'));
  assert.equal(g2.wind_before, golden.wind_before);
  const { game } = setup();
  const res = game.fire('a', { angle: 105, power: 490, weapon: 'baby_missile' });
  assert.equal(res.ok, true);
  assert.ok(res.events.some((e) => e.t === 'dirtFall'));
  const gold = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'scenario_002.after.pix.gz')));
  assert.equal(terrainDiff(game, gold), 0);
});

// scenario_003: direct Baby Missile kill of tank b (2 players). The original's death effect rolled variant 9 (shock blob, 3451:016f; ecc0..ecc6 bbox in the dump = 69,338,112,414).
// RNG alignment: the original R250 was at draw 11765 when D1 (before firing) was dumped; the engine is 2 draws further (its play-order shuffles are estimates),
// so the test puts the engine generator at the original's state. Then rand(11) after the 3 dirt-fall draws = variant 9 exactly as in the original.
// The round-end Rankings dialog (x118..240,y188..290) is excluded.
test('scenario_003 direct kill: death-effect variant 9 (shock blob) makes the final terrain equal the original', () => {
  const { game } = setup();
  const natural = new R250(50045); for (let i = 0; i < 11767; i++) natural.r250();
  assert.deepEqual(game.rng.state(), natural.state());            // pins the known 2-draw offset (11767 vs original 11765); fails as soon as the natural path changes
  const ref = new R250(50045); for (let i = 0; i < 11765; i++) ref.r250();
  game.rng.w.set(ref.w); game.rng.idx = ref.idx;
  const res = game.fire('a', { angle: 136, power: 540, weapon: 'baby_missile' });
  assert.equal(res.events.find((e) => e.t === 'deathFx').variant, 9);
  const gold = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'scenario_003.after.pix.gz')));
  let bad = 0;
  for (let y = 24; y < 476; y++) for (let x = 3; x < 357; x++) {
    if (inSprite(x, y) || (x >= 118 && x <= 240 && y >= 188 && y <= 290)) continue;
    if ((game.terrain.cells[y * W + x] !== 0) !== isDirt(gold[y * W + x])) bad++;
  }
  assert.equal(bad, 0);
});

test('death effect variants 0..10 all run without error and report an event', () => {
  for (let v = 0; v <= 10; v++) {
    const { game } = setup();
    const shot = game._newShot();
    const fx = game._deathFx(shot, game.players[1], v);
    assert.ok(Array.isArray(fx.radii), `variant ${v}`);
    game._settle(shot);
  }
});
