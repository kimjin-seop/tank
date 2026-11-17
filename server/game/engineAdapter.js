// 엔진 어댑터: docs/ENGINE_API.md(server/engine/index.js 의 createGame)를 roomGame이 쓰는 "포트"로 감싼다.
// 엔진은 모드·턴·타이머를 모르므로 순차 모드의 턴 순서 커서는 여기서 관리한다(엔진 계약 §0: 턴·타이머·동시성은 로비 서버 담당).
// 엔진 계약이 바뀌면 이 파일(과 stubEngine.js)만 고치면 된다.
//
// 포트(roomGame이 호출):
//   startRound() -> {events, info}          info = 엔진 RoundInfo(지형·탱크·바람·하늘 등)
//   beginTurn(pid) -> {events}|undefined    턴 시작 처리(바람 변동·번개 등)
//   snapshot(pid) -> object                 재접속용 전체 상태(+ 본인 인벤토리)
//   currentTurn() -> pid|null               순차 모드 현재 턴 플레이어
//   aliveIds() / isRoundOver() / isGameOver()
//   fire(pid, input) -> {events, state, ticks}      실패(ok:false)는 {code:'ENGINE_REJECT', params:{reason}} 로 throw
//   fireBatch([{playerId,input}|{playerId,ai:true}]) -> {events, state, ticks}   동기 모드(fireVolley)
//   act(pid, {action,...}) -> {events, state}       battery|parachute|shield|trigger|guidance|move|aim
//   pass(pid) / retreat(pid) / aiAct(pid) / setProxy(pid,on)
//   shopOrder() / aiShop(pid) / buy / sellQuote / sellAccept / sellReject(pid) / bankPeers(pid)   판매 제시는 플레이어별
//   endRound() -> {state: Settlement}       state.gameOver 로 게임 종료 판단
//   ranking(final)                          final=false(진행 중)면 cash·netWorth 제거
//   privateFor(pid) -> {inventory, tank, interest?}  본인에게만 보내는 비공개 상태(재고·현금·연료 등)
//
// 공개/비공개 분리: 포트가 돌려주는 state/info/snapshot/Settlement 는 모두 "공개용"(방 전원에게 브로드캐스트해도 안전)이다.
// 현금·인벤토리·연료·유도/방아쇠/낙하산 설정·선택 무기는 privateFor 와 act 의 privateState 로만 본인에게 간다.

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createStubEngine } from './stubEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const low = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
const PLAY_ORDER = { RANDOM: 'random', LOSERS_FIRST: 'losers', WINNERS_FIRST: 'winners', ROUND_ROBIN: 'roundrobin' };

// 방 옵션(PROTOCOL.md) -> 엔진 옵션(ENGINE_API.md §1). 엔진이 모르는 옵션(표시·시간·말하기 등)은 넘기지 않는다.
export function toEngineOptions(o) {
  return {
    rounds: o.rounds, gravity: o.gravity, airViscosity: o.airViscosity, maxWind: o.maxWind, changingWind: o.changingWind,
    wall: low(o.wallEffect), edgesExtend: o.bordersExtend, sky: low(o.sky), hostile: o.hostileEnvironment,
    land1: o.bumpiness, land2: o.slope, flatland: o.flattenPeaks, randomLand: o.randomLand, mtnPercent: o.scannedMountains,
    suspendDirt: o.suspendDirt, tanksFall: o.tanksFall, impactDamage: o.impactDamage, scale: low(o.scale), armsLevel: o.armsLevel,
    tunneling: o.tunneling, traceBomb: o.tracePaths, extraDirt: o.extraDirt, interestRate: o.interestRate,
    initialCash: o.cashAtStart, computersBuy: o.computersBuy, freeMarket: o.freeMarket, scoring: low(o.scoringMode),
    teams: low(o.teams), playOrder: PLAY_ORDER[o.playOrder] || 'random',
  };
}

export function toEnginePlayers(players) {
  return players.map((p) => ({ id: p.id, name: p.name, colorIndex: p.color, tankType: p.tank, cpu: p.ai || false, team: p.team }));
}

function reject(res, fallback = 'ENGINE_REJECT') {
  const e = new Error(res?.message || res?.error || '요청을 처리할 수 없습니다');
  e.code = fallback;
  e.params = { reason: res?.error };
  return e;
}
function unsupported() { const e = new Error('지원하지 않는 기능입니다'); e.code = 'ENGINE_UNSUPPORTED'; return e; }

// 공개 탱크 필드(화면에 보이는 것). 현금·연료·무기 선택·유도/방아쇠/낙하산 설정은 비공개.
const PUBLIC_TANK_KEYS = ['id', 'name', 'colorIndex', 'tankType', 'team', 'cpu', 'x', 'y', 'alive', 'hp', 'angle', 'power', 'shield', 'score'];
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
export const publicTank = (t) => pick(t, PUBLIC_TANK_KEYS);
export function publicState(st) {
  if (!st || typeof st !== 'object') return st;
  const out = { ...st };
  if (st.tanks && typeof st.tanks === 'object' && !Array.isArray(st.tanks)) {
    out.tanks = {};
    for (const [id, d] of Object.entries(st.tanks)) { const pd = pick(d, PUBLIC_TANK_KEYS); if (Object.keys(pd).length) out.tanks[id] = pd; }
  }
  if (st.players) {
    out.players = {};
    for (const [id, d] of Object.entries(st.players)) if (d && d.score !== undefined) out.players[id] = { score: d.score };
  }
  return out;
}
export function publicSnapshot(s) {
  if (!s || typeof s !== 'object') return s;
  return Array.isArray(s.tanks) ? { ...s, tanks: s.tanks.map(publicTank) } : s;
}
// 엔진 explode 이벤트에는 쏜 사람(pid)이 없다(kind='death' 는 쏜 사람 없음). 단발 사격(fire/aiAct)은 그 샷의 모든 non-death explode 가 발사자 것이므로 pid 를 덧붙인다. 동기 일제사격은 구분 불가 -> 붙이지 않음.
const tagPid = (events, pid) => (events || []).map((e) => (e && e.t === 'explode' && e.kind !== 'death' && e.pid === undefined ? { ...e, pid } : e));
const stripMoney = (r) => { const { cash, netWorth, ...rest } = r; void cash; void netWorth; return rest; };

export function wrapGame(raw, ids = [], itemIds = null) {
  const itemSet = Array.isArray(itemIds) ? new Set(itemIds) : null; // 엔진 아이템 id 화이트리스트(없으면 null: 스텁 엔진)
  let order = [];
  let cursor = 0;
  let gameOver = false;
  const pending = new Map(); // pid -> 판매 제시(수락 전). 동시 상점이므로 플레이어별로 분리한다.
  const proxy = new Set();
  const ok = (r) => { if (r && r.ok === false) throw reject(r); return r; };
  const aliveIds = () => raw.roundOver().aliveIds;
  const alive = (id) => aliveIds().includes(id);
  // 엔진 aiAct/aiShop/aiTurn 은 cpu 탱크만 허용한다. 대행 중인 사람 탱크는 호출 동안만 moron 컴퓨터로 취급한다(엔진 수정 없이).
  const asCpu = (pid, fn) => {
    const p = raw.P ? raw.P(pid) : null;
    if (!p || p.cpu || !proxy.has(pid)) return fn();
    const saved = { cpu: p.cpu, aiType: p.aiType };
    p.cpu = 'moron'; p.aiType = 'moron';
    try { return fn(); } finally { p.cpu = saved.cpu; p.aiType = saved.aiType; }
  };
  const publicSettlement = (s) => s && ({ ...s, scores: s.scores?.map(({ id, score }) => ({ id, score })), ranking: s.ranking?.map(stripMoney) });
  const refreshOrder = () => { order = raw.nextOrder().slice(); cursor = 0; };

  const port = {
    raw,
    startRound() {
      const info = ok(raw.startRound());
      order = (info.order || []).slice();
      cursor = 0;
      return { events: info.events || [], info: port.publicInfo(info), raw: info };
    },
    beginTurn(pid) {
      const r = raw.beginTurn ? raw.beginTurn(pid) : undefined;
      return r && r.state ? { ...r, state: publicState(r.state) } : r;
    },
    // 재접속·상점용: 공개 스냅샷 + 본인 탱크 전체 뷰 + 본인 인벤토리. 타인의 현금·재고는 포함하지 않는다.
    snapshot(pid) {
      const s = raw.snapshot();
      if (!s || typeof s !== 'object') return s;
      const pub = publicSnapshot(s);
      if (!pid) return pub;
      const mine = Array.isArray(s.tanks) ? s.tanks.find((t) => t.id === pid) : undefined;
      return { ...pub, ...(mine ? { you: mine } : {}), inventory: raw.inventory(pid) };
    },
    privateFor(pid, extra) {
      const st = raw.state ? raw.state() : null;
      const tank = st?.tanks?.find((t) => t.id === pid);
      return { inventory: raw.inventory(pid), ...(tank ? { tank } : {}), ...(extra || {}) };
    },
    publicInfo(info) {
      if (!info || typeof info !== 'object') return info;
      const { interest, ...rest } = info; void interest; // 이자 = 현금 노출
      return { ...rest, tanks: Array.isArray(info.tanks) ? info.tanks.map(publicTank) : info.tanks };
    },
    interestOf: (info, pid) => info?.interest?.[pid] ?? 0,
    currentTurn() {
      for (let pass = 0; pass < 2; pass++) {
        while (cursor < order.length && !alive(order[cursor])) cursor++;
        if (cursor < order.length) return order[cursor];
        refreshOrder(); // 한 바퀴 끝 -> 다음 순서(playOrder 규칙)
      }
      return null;
    },
    aliveIds,
    isRoundOver: () => raw.roundOver().over,
    isGameOver: () => gameOver,
    _advance(pid) { if (order[cursor] === pid) cursor++; },
    fire(pid, input) {
      const r = ok(raw.fire(pid, input));
      port._advance(pid);
      return { ...r, state: publicState(r.state), events: tagPid(r.events, pid) };
    },
    // 동기 모드 입력 접수 시점 검증(보유·범위). 엔진에 validateFire 가 없으면 건너뛰고, 일제 사격 단계에서 실패하면 그 단계는 샷 없이 넘어간다.
    validate(pid, input) { if (raw.validateFire) ok(raw.validateFire(pid, input)); },
    fireBatch(shots) {
      const events = [];
      const volley = shots.map((s) => {
        if (!s.ai) return { playerId: s.playerId, ...s.input };
        const inp = ok(asCpu(s.playerId, () => raw.aiAct(s.playerId)));
        if (inp.pre) events.push(...inp.pre);
        const { pre, ok: _ok, ...rest } = inp;
        void pre; void _ok;
        return { playerId: s.playerId, ...rest };
      });
      const r = ok(raw.fireVolley(volley));
      return { ...r, state: publicState(r.state), events: [...events, ...(r.events || [])] };
    },
    act(pid, p) {
      const a = p.action;
      let r;
      if (a === 'battery') r = raw.useBattery(pid);
      else if (a === 'parachute') r = raw.parachute(pid, { on: !!p.on, threshold: p.threshold });
      else if (a === 'shield') r = raw.shield(pid, p.item ?? null);
      else if (a === 'trigger') r = raw.trigger(pid, !!p.on);
      else if (a === 'guidance') r = raw.guidance(pid, p.type ? { type: p.type, target: p.target } : null);
      else if (a === 'move') r = raw.fuelMove(pid, { dir: p.dir, steps: p.steps ?? 1 });
      else if (a === 'aim') r = raw.aim(pid, { angle: p.angle, power: p.power, weapon: p.weapon });
      else throw unsupported();
      ok(r);
      // state: 공개용(타인에게), privateState: 본인에게만(낙하산·방아쇠·유도·연료 등 설정 결과 포함)
      return { events: r.events || [], state: publicState(r.state), privateState: r };
    },
    pass(pid) { port._advance(pid); },
    retreat(pid) {
      const r = ok(raw.retreat(pid));
      port._advance(pid);
      return { ...r, state: publicState(r.state), events: r.events || [] };
    },
    // 컴퓨터 좌석뿐 아니라 사람 탱크(대행·이탈)도 성향 'moron' 으로 대신 쏜다(엔진은 cpu 탱크만 허용 -> asCpu 로 임시 전환).
    aiAct(pid) {
      const r = ok(asCpu(pid, () => raw.aiTurn(pid)));
      port._advance(pid);
      return { ...r, state: publicState(r.state), events: tagPid([...(r.pre || []), ...(r.events || [])], pid) };
    },
    setProxy(pid, on) { if (on) proxy.add(pid); else proxy.delete(pid); },
    // 상점 목록: 엔진 shopList(pid) -> [{id,price,bundle,unitPrice,owned,arms,allowed,affordable}] (자유 시장이면 현재가). 엔진에 없으면 null.
    shopList(pid) { if (!raw.shopList) return null; const r = raw.shopList(pid); return Array.isArray(r) ? r : null; },
    shopOrder: () => ids.filter((id) => (raw.inventory(id)?.cash ?? 0) > 0),
    aiShop: (pid) => asCpu(pid, () => raw.aiShop(pid)),
    // 클라이언트가 보낸 아이템 id 가 엔진 아이템인지. 화이트리스트가 없으면(스텁) 판단하지 않는다(true).
    isItem: (item) => (itemSet ? itemSet.has(item) : true),
    buy(pid, item, qty) { const r = ok(raw.buy(pid, item, qty)); return { state: r }; },
    sellQuote(pid, item, qty) {
      const r = ok(raw.sellOffer(pid, item, qty));
      pending.set(pid, { item, qty });
      return r.offer;
    },
    sellAccept(pid) {
      const p = pending.get(pid);
      if (!p) return undefined;
      pending.delete(pid);
      return { state: ok(raw.sell(pid, p.item, p.qty)) };
    },
    sellReject(pid) { pending.delete(pid); },
    // 같은 은행을 쓰는 다른 플레이어(공유 은행 팀). 엔진이 P()를 노출하지 않으면 없음.
    bankPeers(pid) {
      const bank = raw.P ? raw.P(pid)?.bank : null;
      return bank ? ids.filter((id) => id !== pid && raw.P(id)?.bank === bank) : [];
    },
    endRound() {
      const s = ok(raw.endRound());
      gameOver = !!s?.gameOver;
      return { events: [], state: publicSettlement(s), raw: s };
    },
    ranking: (final = false) => (final ? raw.ranking() : raw.ranking().map(stripMoney)),
  };
  return port;
}

// 엔진 팩토리: { createGame({options(방 옵션), players:[{id,name,color,tank,team,ai}], seed}) -> 포트 }
export function makeEngineFactory(mod) {
  return {
    createGame: ({ options, players, seed }) =>
      wrapGame(mod.createGame({ options: toEngineOptions(options), players: toEnginePlayers(players), seed }), players.map((p) => p.id), mod.ITEM_IDS),
  };
}

// server/engine/index.js 가 있으면 로드, 없으면 스텁(개발용)을 쓴다.
export async function loadEngine({ log = console } = {}) {
  const file = path.join(here, '..', 'engine', 'index.js');
  if (fs.existsSync(file)) {
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.createGame === 'function') return makeEngineFactory(mod);
      log.warn?.('[engine] server/engine/index.js 에 createGame 이 없어 스텁 엔진을 사용합니다');
    } catch (e) {
      log.warn?.(`[engine] 엔진 로드 실패, 스텁 사용: ${e.message}`);
    }
  } else {
    log.warn?.('[engine] server/engine/index.js 없음 - 스텁 엔진 사용(개발용)');
  }
  return makeEngineFactory(createStubEngine());
}
