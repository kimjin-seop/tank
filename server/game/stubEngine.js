// 개발·테스트용 스텁 엔진(물리 없음). docs/ENGINE_API.md 의 계약 모양만 흉내 낸다.

export function createStubEngine() {
  return {
    createGame({ options = {}, players }) {
      const rounds = options.rounds ?? 10;
      const ps = players.map((p) => ({
        id: p.id, name: p.name, cpu: p.cpu || false, hp: 100, alive: true, cash: options.initialCash || 0, score: 0, items: {},
      }));
      const by = (id) => ps.find((p) => p.id === id);
      const aliveIds = () => ps.filter((p) => p.alive).map((p) => p.id);
      let round = 0;
      const fail = (error, message) => ({ ok: false, error, message });
      const g = {
        startRound() {
          round++;
          ps.forEach((p) => { p.hp = 100; p.alive = true; });
          return { round, tanks: ps.map((p) => ({ ...p })), order: ps.map((p) => p.id), wind: 0, events: [] };
        },
        beginTurn() { return { events: [] }; },
        roundOver() { const a = aliveIds(); return { over: a.length <= 1, aliveIds: a }; },
        nextOrder() { return aliveIds(); },
        _hit(shooter, power) {
          const victim = ps.find((p) => p.alive && p.id !== shooter);
          if (!victim) return [];
          victim.hp -= Math.round(power);
          const ev = [{ t: 'fire', tick: 0, pid: shooter }, { t: 'hp', tick: 10, tank: victim.id, hp: victim.hp }];
          if (victim.hp <= 0) { victim.alive = false; by(shooter).score += 100; ev.push({ t: 'death', tick: 10, tank: victim.id, killer: shooter }); }
          return ev;
        },
        fire(pid, input, volley) {
          const p = by(pid);
          if (!p || !p.alive) return fail('NOT_ALIVE', '탱크가 살아 있지 않습니다');
          if (!volley && !(input.power >= 0 && input.power <= p.hp * 10)) return fail('BAD_POWER', '파워가 범위를 벗어났습니다');
          const events = g._hit(pid, input.power);
          return { ok: true, events, state: { tanks: {} }, ticks: 25, roundOver: g.roundOver().over };
        },
        validateFire(pid, input) {
          const p = by(pid);
          if (!p || !p.alive) return fail('NOT_ALIVE', '탱크가 살아 있지 않습니다');
          if (!(input.power >= 0 && input.power <= p.hp * 10)) return fail('BAD_POWER', '파워가 범위를 벗어났습니다');
          return { ok: true };
        },
        fireVolley(shots) {
          const events = [];
          const startAlive = new Set(aliveIds()); for (const s of shots) { if (!startAlive.has(s.playerId)) continue; by(s.playerId).alive = true; const r = g.fire(s.playerId, s, true); if (!r.ok) return r; events.push(...r.events); }
          return { ok: true, events, state: { tanks: {} }, ticks: 25, roundOver: g.roundOver().over };
        },
        aiAct() { return { weapon: 'baby_missile', angle: 45, power: 30, pre: [] }; },
        aiTurn(pid) { return g.fire(pid, g.aiAct(pid)); },
        retreat(pid) { by(pid).alive = false; return { ok: true, events: [{ t: 'retreat', tick: 0, tank: pid }] }; },
        inventory(pid) { const p = by(pid); return { cash: p.cash, score: p.score, items: p.items }; },
        buy(pid, item, qty = 1) {
          const p = by(pid); const cost = 100 * qty;
          if (p.cash < cost) return fail('NO_CASH', '현금이 부족합니다');
          p.cash -= cost; p.items[item] = (p.items[item] || 0) + qty;
          return { ok: true, cost, added: qty, cash: p.cash };
        },
        sellOffer(pid, item, qty = 1) {
          if ((by(pid).items[item] || 0) < qty) return fail('NO_ITEM', '보유 수량이 부족합니다');
          return { ok: true, offer: 50 * qty };
        },
        sell(pid, item, qty = 1) { const p = by(pid); p.items[item] -= qty; p.cash += 50 * qty; return { ok: true, cash: p.cash }; },
        shopList(pid) { const p = by(pid); return [{ id: 'missile', price: 100, bundle: 10, unitPrice: 10, owned: p.items.missile || 0, arms: 0, allowed: true, affordable: p.cash >= 100 }]; },
        aiShop() {},
        endRound() {
          const winners = aliveIds();
          return { round, winners, payouts: {}, scores: ps.map((p) => ({ id: p.id, cash: p.cash, score: p.score })), gameOver: round >= rounds, ranking: g.ranking() };
        },
        snapshot() { return { round, tanks: ps.map((p) => ({ id: p.id, hp: p.hp, alive: p.alive })) }; },
        ranking() { return ps.slice().sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, name: p.name, score: p.score })); },
      };
      return g;
    },
  };
}
