// Nuke (idx 3, R 75, x4) / Baby Nuke (idx 2, R 40, x3) radial damage table (RE 5.2: trunc((R-d)*100/R)*(idx+1), >100 -> 110).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine/index.js';

test('nuke kills outright within 55px of the tank center, 80 dmg at 60px; baby nuke kills within ~31px', () => {
  const g = createGame({ options: {}, players: [{ id: 'a' }, { id: 'b' }], seed: 1 }); g.startRound();
  const b = g.players[1];
  const dmg = (R, mult, d) => { const r = g._radialDamages(b.x, g._cy(b) - d, R, mult); return r.length ? r[0].dmg : 0; };
  assert.equal(dmg(75, 4, 55), 110);
  assert.equal(dmg(75, 4, 60), 80);
  assert.equal(dmg(75, 4, 75), 0);
  assert.equal(dmg(40, 3, 28), 90);
  assert.equal(dmg(40, 3, 24), 110);
});
