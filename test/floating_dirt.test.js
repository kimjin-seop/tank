// Invariant: with default options (suspendDirt 0) no dirt cell may hang above sky after round setup or after any shot (cavern ceiling excluded).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../server/engine/index.js';
import { WEAPONS } from '../server/engine/weapons.js';

function floating(g) {
  const T = g.terrain, w = T.w, c = T.cells, B = g.bounds.bottom; let n = 0;
  for (let x = 0; x < w; x++) for (let y = 0; y < B; y++) {
    if (!c[y * w + x] || c[(y + 1) * w + x] || g._tankAt(x, y + 1)) continue;
    if (g.sky === 'cavern') { let t = y; while (t >= 0 && c[t * w + x]) t--; if (t < g.bounds.top) continue; }
    n++;
  }
  return n;
}

test('no floating dirt after round setup (mountain + cavern) and after shots of many weapons (tunneling on)', () => {
  const ids = WEAPONS.filter((w) => w.idx <= 31).map((w) => w.id);
  for (let seed = 1; seed <= 10; seed++) {
    const g = createGame({ options: seed > 6 ? { sky: 'cavern' } : { mtnPercent: 50 }, players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], seed });
    g.startRound();
    assert.equal(floating(g), 0, `setup seed ${seed}`);
    for (let k = 0; k < 8; k++) {
      const al = g.alive(); if (al.length < 2) break;
      const p = al[k % al.length], wid = ids[(seed * 7 + k * 5) % ids.length];
      p.inv[WEAPONS.find((w) => w.id === wid).idx] = 9;
      g.fire(p.id, { angle: 20 + ((seed * 37 + k * 53) % 140), power: 300 + ((seed * 91 + k * 77) % 600), weapon: wid });
      assert.equal(floating(g), 0, `seed ${seed} shot ${k} ${wid}`);
    }
  }
});
