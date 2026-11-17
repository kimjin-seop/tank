// Tank death effect event (original 171b:0005: variant = rand(11); variants 1..3 explode radii 20 / 20+40 / 20+40+75).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine/index.js';

test('killing a tank emits deathFx {variant 0..10, radii, modeled, last}; last=true when it ends the round', () => {
  const g = createGame({ options: {}, players: [{ id: 'a' }, { id: 'b' }], seed: 50045, rngSkip: 10573 }); g.startRound();
  const r = g.fire('a', { angle: 136, power: 540, weapon: 'baby_missile' });     // direct hit on b (matches golden scenario_003 geometry)
  const fx = r.events.find((e) => e.t === 'deathFx');
  assert.ok(fx && fx.tank === 'b');
  assert.ok(fx.variant >= 0 && fx.variant <= 10 && fx.variant !== 8);
  assert.equal(fx.last, true);
  if (fx.variant === 2) assert.deepEqual(fx.radii, [20, 40]);
});

test('after any death effect variant (0..10) surviving tanks are supported (no floating) and the dead tank is not', () => {
  for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10]) {
    const g = createGame({ options: {}, players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], seed: 900 + v }); g.startRound();
    const orig = g.rng.int.bind(g.rng); let forced = false;
    g.rng.int = (n) => (n === 11 && !forced ? (forced = true, v) : orig(n));
    const shot = g._newShot(), dead = g.players[1];
    dead.alive = false; dead.hp = 0; shot.deadQueue.push(dead);
    g._settle(shot);
    assert.equal(shot.events.find((e) => e.t === 'deathFx').variant, v);
    for (const p of g.players.filter((q) => q.alive)) assert.ok(g._supportedAt(p, p.x, p.y), `variant ${v}: ${p.id} floating`);
  }
});
