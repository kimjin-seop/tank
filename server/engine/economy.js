// Economy: shop, free market, interest, settlement, scoring (RE §7). Mixed into Game.prototype.
import { Game } from './game.js';
import { WEAPONS, BY_ID, MAX_STOCK, MAX_HP, SHIELDS } from './weapons.js';

const P = Game.prototype;

P._initMarket = function () {
  const n = WEAPONS.length;
  const base = WEAPONS.map((w) => w.price);
  const m = { base, cur: base.slice(), A: new Array(n).fill(0), S: new Array(n).fill(0), demand: new Array(n).fill(0) };
  const imp = this.options.market;
  if (imp && Array.isArray(imp.cur) && imp.cur.length === n) {
    m.cur = imp.cur.slice();
    if (Array.isArray(imp.A)) m.A = imp.A.slice();
    if (Array.isArray(imp.S)) m.S = imp.S.slice();
  }
  this.marketState = m;
};

P.market = function () { return { cur: this.marketState.cur.slice(), base: this.marketState.base.slice() }; };
P.exportMarket = function () { const m = this.marketState; return { cur: m.cur.slice(), A: m.A.slice(), S: m.S.slice() }; };

/** SCORCH.MKT binary layout (RE §7): int16 ver=2, int16 count=48, 48 x (int32 price, int16 idle, double S, double A). */
export function encodeMkt(m) {
  const b = Buffer.alloc(1060);
  b.writeInt16LE(2, 0); b.writeInt16LE(48, 2);
  for (let i = 0; i < 48; i++) {
    const o = 4 + i * 22;
    b.writeInt32LE(m.cur[i], o); b.writeInt16LE(0, o + 4); b.writeDoubleLE(m.S[i] || 0, o + 6); b.writeDoubleLE(m.A[i] || 0, o + 14);
  }
  return b;
}
export function decodeMkt(b) {
  if (b.length !== 1060 || b.readInt16LE(0) !== 2 || b.readInt16LE(2) !== 48) throw new Error('bad SCORCH.MKT');
  const m = { cur: [], A: [], S: [] };
  for (let i = 0; i < 48; i++) { const o = 4 + i * 22; m.cur.push(b.readInt32LE(o)); m.S.push(b.readDoubleLE(o + 6)); m.A.push(b.readDoubleLE(o + 14)); }
  return m;
}

P._curPrice = function (w) { return this.options.freeMarket ? this.marketState.cur[w.idx] : w.price; };

/** Auto Defense price (RE §7): P * sum_{k=0..n} (1+r)^-k, n = MAXROUNDS - round - 1 */
P._autoDefensePrice = function () {
  const r = this.options.interestRate;
  const n = Math.max(0, this.options.rounds - this.round - 1);
  let s = 0;
  for (let k = 0; k <= n; k++) s += Math.pow(1 + r, -k);
  return Math.trunc(1500 * s);
};
P._itemPrice = function (w) { return w.id === 'auto_defense' ? this._autoDefensePrice() : this._curPrice(w); };

P.inventory = function (playerId) {
  const p = this.P(playerId);
  if (!p) return this._err('NO_PLAYER', 'unknown player');
  const items = {};
  for (const w of WEAPONS) if (p.inv[w.idx] > 0) items[w.id] = p.inv[w.idx];
  return { ok: true, cash: p.bank.cash, score: p.score, items, autoDefense: p.autoDefense };
};

P.shopList = function (playerId) {
  const p = this.P(playerId);
  if (!p) return this._err('NO_PLAYER', 'unknown player');
  return WEAPONS.filter((w) => w.idx !== 0).map((w) => {
    const price = this._itemPrice(w);
    return { id: w.id, price, bundle: w.bundle, unitPrice: price / w.bundle, owned: w.id === 'auto_defense' ? (p.autoDefense ? 1 : 0) : p.inv[w.idx], arms: w.arms, allowed: w.arms <= this.options.armsLevel, affordable: p.bank.cash >= price };
  });
};

P.buy = function (playerId, itemId, qty = 1) {
  const p = this.P(playerId);
  if (!p) return this._err('NO_PLAYER', 'unknown player');
  const w = typeof itemId === 'string' ? BY_ID[itemId] : undefined;
  if (!w || w.idx === 0) return this._err('BAD_ARGS', 'unknown item');
  if (w.arms > this.options.armsLevel) return this._err('ARMS', 'arms level too low');
  if (w.id === 'fuel_tank' && p.tankType === 'fixed') return this._err('IMMOBILE', 'fixed turret cannot use fuel');
  qty = Math.trunc(qty);
  if (!(qty >= 1)) return this._err('BAD_ARGS', 'qty');
  if (w.id === 'auto_defense') {
    if (p.autoDefense) return this._err('FULL', 'already owned');
    const price = this._autoDefensePrice();
    if (p.bank.cash < price) return this._err('NO_CASH', 'not enough cash');
    p.bank.cash -= price; p.autoDefense = true; p.inv[w.idx] = 1;
    return { ok: true, cost: price, added: 1, cash: p.bank.cash };
  }
  let cost = 0, added = 0;
  for (let i = 0; i < qty; i++) {
    const owned = p.inv[w.idx] + added;
    if (owned >= MAX_STOCK) break;
    const count = Math.min(w.bundle, MAX_STOCK - owned);
    const price = this._curPrice(w);
    const c = count === w.bundle ? price : Math.trunc(price * count / w.bundle * 1.2);      // partial purchase: +20% (RE §7)
    if (p.bank.cash - cost < c) { if (i === 0) return this._err('NO_CASH', 'not enough cash'); break; }
    cost += c; added += count;
    this.marketState.demand[w.idx] += count / w.bundle;
  }
  if (!added) return this._err('FULL', 'stock limit (99)');
  p.bank.cash -= cost; p.inv[w.idx] += added;
  return { ok: true, cost, added, cash: p.bank.cash };
};

P.sellOffer = function (playerId, itemId, qty = 1) {
  const p = this.P(playerId);
  if (!p) return this._err('NO_PLAYER', 'unknown player');
  const w = typeof itemId === 'string' ? BY_ID[itemId] : undefined;
  if (!w || w.idx === 0 || w.id === 'auto_defense') return this._err('BAD_ARGS', 'cannot sell');
  qty = Math.trunc(qty);
  if (!(qty >= 1) || qty > p.inv[w.idx]) return this._err('BAD_ARGS', 'qty');
  const ratio = this.options.freeMarket ? 0.65 : 0.8;
  const offer = Math.trunc(this._curPrice(w) / w.bundle * qty * ratio);
  if (!Number.isFinite(offer) || offer < 0) return this._err('BAD_ARGS', 'cannot sell');   // never credit a non-numeric offer
  return { ok: true, offer, qty, item: w.id };
};
P.sell = function (playerId, itemId, qty = 1, expectedOffer) {
  const o = this.sellOffer(playerId, itemId, qty);
  if (!o.ok) return o;
  if (expectedOffer !== undefined && expectedOffer !== o.offer) return this._err('PRICE_CHANGED', 'offer changed');
  const p = this.P(playerId), w = BY_ID[itemId];
  p.inv[w.idx] -= o.qty; p.bank.cash += o.offer;
  return { ok: true, offer: o.offer, cash: p.bank.cash };
};

/** Computer purchases (RE §7). Moron: weighted random (weights 미상 -> uniform, estimated). */
P.aiShop = function (playerId) {
  const p = this.P(playerId);
  if (!p || !p.cpu || !this.options.computersBuy) return { ok: true, bought: [] };
  const bought = [];
  const own = (id) => p.inv[BY_ID[id].idx];
  const tryBuy = (id) => { const r = this.buy(playerId, id, 1); if (r.ok) { bought.push({ id, cost: r.cost }); return true; } return false; };
  for (let i = 0; i < 40 && p.bank.cash >= 50000; i++) {
    if (p.aiType === 'moron') {
      const cands = WEAPONS.filter((w) => w.idx !== 0 && w.idx <= 47 && w.id !== 'auto_defense' && w.arms <= this.options.armsLevel && this._curPrice(w) <= p.bank.cash);
      if (!cands.length) break;
      tryBuy(cands[this.rng.int(cands.length)].id);
      continue;
    }
    const hasShield = Object.keys(SHIELDS).some((id) => own(id) > 0);
    if (!hasShield) { if (tryBuy('heavy_shield') || tryBuy('force_shield') || tryBuy('shield')) continue; }
    if (own('parachute') < 1 && tryBuy('parachute')) continue;
    if (own('baby_nuke') < 5 && tryBuy('baby_nuke')) continue;
    if (own('missile') < 5 && tryBuy('missile')) continue;
    if (own('battery') < 8 && tryBuy('battery')) continue;
    break;
  }
  return { ok: true, bought };
};

// ---------------------------------------------------------------- settlement (RE §7)
P.endRound = function () {
  if (!this.roundActive) return this._err('NO_ROUND', 'no round to end');
  const o = this.options;
  const surv = this.alive();
  const payouts = {};
  if (surv.length) {
    let pool;
    if (o.scoring === 'basic') pool = this.players.length * 1000 + surv.length * 4000;
    else pool = 5000 + 500 * surv.length + surv.reduce((s, t) => s + 30 * t.hp + 2 * (t.shield ? t.shield.hp : 0), 0);
    const each = Math.trunc(pool / surv.length);
    for (const t of surv) { this._addScore(t, each); payouts[t.id] = each; }
  }
  if (o.freeMarket) this._updateMarket();
  this.roundActive = false;
  if (this.round >= o.rounds) this.over = true;
  const ranking = this.ranking();
  return { ok: true, round: this.round, winners: surv.map((t) => t.id), payouts, scores: this.players.map((t) => ({ id: t.id, cash: t.bank.cash, score: t.score })), gameOver: this.over, ranking,
    gains: this.players.map((t) => ({ id: t.id, payout: payouts[t.id] || 0, earned: t.score - (t.roundStartScore ?? 0) })) };   // public: per-player round earnings (score = cash delta source)
};

P._netWorth = function (p) {
  let v = p.bank.cash;
  for (const w of WEAPONS) if (w.idx !== 0 && p.inv[w.idx] > 0 && w.id !== 'auto_defense') v += Math.trunc(this._curPrice(w) / w.bundle * p.inv[w.idx] * 0.8);
  return v;
};
P.ranking = function () {
  const key = this.options.scoring === 'greedy' ? (p) => this._netWorth(p) : (p) => p.score;
  return this.players.slice().sort((a, b) => (key(b) - key(a)) || (a.index - b.index)).map((p, i) => ({ rank: i + 1, id: p.id, score: p.score, cash: p.bank.cash, netWorth: this._netWorth(p) }));
};

/** Free market update (RE §7, 24e0:035e). D = bundles bought this round, N = players, rate = options.marketRate (추정). */
P._updateMarket = function () {
  const m = this.marketState, N = this.players.length, rate = this.options.marketRate;
  for (let i = 0; i < WEAPONS.length; i++) {
    if (i === 0 || WEAPONS[i].id === 'auto_defense') continue;
    m.A[i] = 0.7 * m.A[i] + 0.3 * m.demand[i] / N;
    const r = m.cur[i] / m.base[i];
    m.S[i] = 0.7 * m.S[i] + 0.03 * r * r;
    m.cur[i] = Math.trunc(m.cur[i] * (1 + (m.A[i] - m.S[i]) * rate));
    if (m.cur[i] < m.base[i] * 0.1 || m.cur[i] > m.base[i] * 100) m.cur[i] = m.base[i];
    m.demand[i] = 0;
  }
};
