// endRound() public settlement carries per-player round earnings: gains:[{id,payout,earned}] (payouts map is survivors-only, unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine/index.js';

test('endRound gains: payout for survivors, earned = score delta over the round', () => {
  const g = createGame({ options: {}, players: [{ id: 'a' }, { id: 'b' }], seed: 3 }); g.startRound();
  g.players[1].alive = false;                                   // b dead, a survives
  const s0 = g.players[0].score;
  const res = g.endRound();
  const ga = res.gains.find((x) => x.id === 'a'), gb = res.gains.find((x) => x.id === 'b');
  assert.equal(ga.payout, res.payouts.a);
  assert.equal(ga.earned, g.players[0].score - s0);
  assert.deepEqual([gb.payout, gb.earned], [0, 0]);
});
