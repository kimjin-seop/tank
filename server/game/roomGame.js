// 방 단위 게임 진행: 엔진 포트(engineAdapter)를 구동하고 턴/상점 타이머, 이탈·재접속·대행을 처리한다.
// 시간은 전부 주입된 clock 기준(서버 단독 시계). 클라이언트 시계는 어떤 판정에도 쓰지 않는다.

import { ProtocolError, isFiniteNum } from '../net/protocol.js';
import { createTalker } from './talk.js';

export const DEFAULT_GAME_CONFIG = {
  maxTimeouts: 3,        // 연속 시간 초과 한도(5.7.1-11)
  aiDelayMs: 800,        // 컴퓨터 행동 지연(순차/동기)
  fastAiDelayMs: 200,    // Fast Computers ON
  simAiMs: 2000,         // 동시 모드 컴퓨터 행동 주기
  playbackBaseMs: 1500,  // 샷 재생 기본 길이 [확인 필요: EXE 분석 의존]
  playbackMaxMs: 20000,
  playbackPadMs: 800,    // 엔진 ticks(1tick=20ms) 재생 후 낙하·정산 연출 여유 [확인 필요]
  tickMs: 20,
  roundEndMs: 4000,      // 라운드 종료 정산 표시
  gameOverMs: 8000,      // 최종 순위 표시 후 대기실 복귀
  aimMinIntervalMs: 80,  // aim 중계 제한
};

const FIRE_KEYS = ['weapon', 'angle', 'power', 'target', 'batteries', 'guidance', 'trigger'];
const GUIDANCE = new Set(['heat', 'ballistic', 'horz', 'vert', 'lazy']);

export function validateFireInput(msg) {
  const { weapon, angle, power } = msg;
  const wOk = (typeof weapon === 'string' && weapon.length > 0 && weapon.length <= 64) || Number.isInteger(weapon);
  if (!wOk || !isFiniteNum(angle) || !isFiniteNum(power) || angle < 0 || angle > 180 || power < 0 || power > 1000) {
    throw new ProtocolError('INVALID_INPUT');
  }
  const input = {};
  for (const k of FIRE_KEYS) if (msg[k] !== undefined) input[k] = msg[k];
  const t = input.target;
  if (t !== undefined && !((typeof t === 'string' && t.length <= 32) || (t && isFiniteNum(t.x) && isFiniteNum(t.y)))) throw new ProtocolError('INVALID_INPUT');
  if (t && typeof t === 'object') input.target = { x: t.x, y: t.y };
  if (input.batteries !== undefined && !(Number.isInteger(input.batteries) && input.batteries >= 0 && input.batteries <= 10)) throw new ProtocolError('INVALID_INPUT');
  if (input.guidance !== undefined && !GUIDANCE.has(input.guidance)) throw new ProtocolError('INVALID_INPUT');
  if (input.trigger !== undefined && typeof input.trigger !== 'boolean') throw new ProtocolError('INVALID_INPUT');
  return input;
}

export class RoomGame {
  /**
   * seats: [{id,name,kind:'human'|'computer',color,tank,team,personality}]
   * io: { broadcast(msg), sendTo(id,msg), isConnected(id), system(key,text) }
   */
  constructor({ seats, options, engine, clock, io, config = {}, rng = Math.random, onEnd }) {
    this.cfg = { ...DEFAULT_GAME_CONFIG, ...config };
    this.options = options;
    this.engine = engine;
    this.clock = clock;
    this.io = io;
    this.rng = rng;
    this.onEnd = onEnd || (() => {});
    this.seats = seats.map((s) => ({ ...s, proxy: false, left: false, timeouts: 0 }));
    this.phase = 'init'; // init | shop | aim | resolving | roundEnd | over
    this.round = 0;
    this.turn = null;    // 현재 조준 단계 정보
    this.shop = null;    // 현재 상점 단계 정보
    this.ready = new Map(); // 동기 모드: id -> input
    this.timers = new Set();
    this.lastAim = new Map();
    this.destroyed = false;
    this.talker = { insert: (ev) => ev };
  }

  // ---------- 유틸 ----------
  seat(id) { return this.seats.find((s) => s.id === id); }
  now() { return this.clock.now(); }
  _after(ms, fn) {
    const h = this.clock.setTimeout(() => {
      this.timers.delete(h);
      if (this.destroyed) return;
      try { fn(); } catch (e) { this._fatal(e); }
    }, Math.max(0, ms));
    this.timers.add(h);
    return h;
  }
  _cancel(h) { if (h) { this.clock.clearTimeout(h); this.timers.delete(h); } }
  _clearAll() { for (const h of this.timers) this.clock.clearTimeout(h); this.timers.clear(); }
  _fatal(e) {
    // 엔진 오류로 게임 진행이 불가능하면 방을 대기실로 돌려보낸다.
    this.io.broadcast({ t: 'toast', code: 'INTERNAL', msg: '서버 오류로 게임이 종료됩니다' });
    this.io.log?.('error', e);
    this._clearAll();
    this.phase = 'over';
    this.destroyed = true;
    this.onEnd({ aborted: true });
  }
  _isAuto(seat) { return seat.kind === 'computer' || seat.proxy || seat.left; }
  _activeHumans() { return this.seats.filter((s) => s.kind === 'human' && !s.proxy && !s.left && this._alive(s.id)); }
  _alive(id) { return this.port.aliveIds().includes(id); }
  _aiDelay() { return this.options.fastComputers ? this.cfg.fastAiDelayMs : this.cfg.aiDelayMs; }
  _playbackMs(events, ticks) {
    if (isFiniteNum(ticks)) return Math.min(ticks * this.cfg.tickMs + this.cfg.playbackPadMs, this.cfg.playbackMaxMs);
    let ms = this.cfg.playbackBaseMs;
    for (const e of events || []) if (e && isFiniteNum(e.ms)) ms += e.ms;
    return Math.min(ms, this.cfg.playbackMaxMs);
  }
  _timeInfo() { return { serverTime: this.now() }; }

  // 비공개 상태(현금·인벤토리·연료 등)는 본인에게만 보낸다. 방 전원 브로드캐스트에는 절대 싣지 않는다.
  _sendMe(only, extraFor) {
    if (!this.port?.privateFor) return;
    for (const s of this.seats) {
      if (s.kind !== 'human' || s.left || (only && s.id !== only)) continue;
      try { this.io.sendTo(s.id, { t: 'me', ...this.port.privateFor(s.id, extraFor?.(s.id)), ...this._shopExtra(s.id), ...this._timeInfo() }); } catch (e) { this.io.log?.('warn', e); }
    }
  }

  // 상점 차례인 본인에게만: 엔진 shopList(가격·묶음·보유·무장 등급·허용·구매 가능). 자유 시장 현재가가 반영된다.
  _shopListFor(id) {
    if (this.phase !== 'shop' || this.shop?.playerId !== id || !this.port?.shopList) return undefined;
    try { return this.port.shopList(id); } catch (e) { this.io.log?.('warn', e); return undefined; }
  }
  _shopExtra(id) { const l = this._shopListFor(id); return l ? { shop: l } : {}; }

  publicSeats() {
    return this.seats.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, color: s.color, tank: s.tank, team: s.team,
      personality: s.personality || null, proxy: s.proxy || s.left, connected: s.kind === 'computer' ? true : this.io.isConnected(s.id),
    }));
  }

  phaseInfo() {
    const info = { phase: this.phase, round: this.round, rounds: this.options.rounds, mode: this.options.mode, ...this._timeInfo() };
    if (this.turn) info.turn = { ...this.turn };
    if (this.shop) info.shop = { ...this.shop };
    if (this.options.mode === 'SYNCHRONOUS') info.readyIds = [...this.ready.keys()];
    info.timeouts = Object.fromEntries(this.seats.filter((s) => s.timeouts).map((s) => [s.id, s.timeouts]));
    return info;
  }

  // ---------- 시작 ----------
  start() {
    const seed = Math.floor(this.rng() * 0x100000000) >>> 0;
    const players = this.seats.map((s) => ({
      id: s.id, name: s.name, color: s.color, tank: s.tank, team: s.team,
      ai: s.kind === 'computer' ? (s.personality || 'moron') : null,
    }));
    this.port = this.engine.createGame({ options: { ...this.options }, players, seed });
    this.talker = createTalker({
      mode: this.options.talkingTanks, probability: this.options.talkProbability, seed: (seed ^ 0x9E3779B9) >>> 0,
      isComputer: (id) => this.seat(id)?.kind === 'computer',
    });
    this.io.broadcast({ t: 'game_start', seats: this.publicSeats(), options: this.options, ...this._timeInfo() });
    if (this.options.cashAtStart > 0) this._beginShop();
    else this._beginRound();
  }

  destroy() {
    this.destroyed = true;
    this._clearAll();
  }

  // ---------- 라운드 ----------
  _beginRound() {
    this.round++;
    this.shop = null;
    this.ready = new Map();
    const res = this.port.startRound();
    this.io.broadcast({ t: 'round_start', round: this.round, rounds: this.options.rounds, info: res?.info ?? null, events: res?.events || [], ...this._timeInfo() });
    this._sendMe(null, (id) => ({ interest: this.port.interestOf?.(res?.raw, id) ?? 0 }));
    const mode = this.options.mode;
    if (mode === 'SEQUENTIAL') this._nextTurn();
    else if (mode === 'SYNCHRONOUS') this._beginAim();
    else this._beginSim();
  }

  _afterResolve() {
    if (this.phase === 'over') return;
    if (this.port.isGameOver()) return this._gameOver();
    if (this.port.isRoundOver()) return this._endRound();
    const mode = this.options.mode;
    if (mode === 'SEQUENTIAL') this._nextTurn();
    else if (mode === 'SYNCHRONOUS') this._beginAim();
  }

  _afterShot(playerId, res) {
    this._cancelTurnTimer();
    this.phase = 'resolving';
    this.turn = null;
    const events = this.talker.insert(res?.events || []);
    this.io.broadcast({ t: 'shot', playerId, events, state: res?.state, ...this._timeInfo() });
    this._sendMe();
    this._after(this._playbackMs(events, res?.ticks), () => this._afterResolve());
  }

  _cancelTurnTimer() {
    if (this.turnTimer) { this._cancel(this.turnTimer); this.turnTimer = null; }
  }

  _endRound() {
    this._clearAll();
    this.turnTimer = null;
    this.turn = null;
    this.phase = 'roundEnd';
    const res = this.port.endRound();
    this.io.broadcast({ t: 'round_end', round: this.round, events: res?.events || [], state: res?.state, ranking: this.port.ranking(false), ...this._timeInfo() });
    this._sendMe();
    this._after(this.cfg.roundEndMs, () => {
      if (this.round >= this.options.rounds || this.port.isGameOver()) this._gameOver();
      else this._beginShop();
    });
  }

  _gameOver() {
    this._clearAll();
    this.phase = 'over';
    this.turn = null;
    this.io.broadcast({ t: 'game_over', ranking: this.port.ranking(true), ...this._timeInfo() });
    this._after(this.cfg.gameOverMs, () => this.onEnd({ aborted: false }));
  }

  // ---------- 순차 모드 ----------
  _nextTurn() {
    if (this.port.isRoundOver()) return this._endRound();
    const pid = this.port.currentTurn();
    if (pid == null) return this._endRound();
    const seat = this.seat(pid);
    if (!seat) return this._fatal(new Error(`unknown turn player ${pid}`));
    const bt = this.port.beginTurn(pid);
    if (bt?.events?.length && this.port.isRoundOver()) return this._afterShot(null, bt);
    this.phase = 'aim';
    if (this._isAuto(seat)) {
      this.turn = { mode: 'seq', playerId: pid, deadline: null, limitMs: null, auto: true };
      this.io.broadcast({ t: 'turn', ...this.turn, events: bt?.events || [], ...this._timeInfo() });
      const ref = this.turn;
      this.turnTimer = this._after(this._aiDelay(), () => { if (this.turn === ref) this._aiTurn(seat); });
    } else {
      const limitMs = this.options.turnLimitSec * 1000;
      const deadline = this.now() + limitMs;
      this.turn = { mode: 'seq', playerId: pid, deadline, limitMs, auto: false, timeouts: seat.timeouts };
      this.io.broadcast({ t: 'turn', ...this.turn, events: bt?.events || [], ...this._timeInfo() });
      const ref = this.turn;
      this.turnTimer = this._after(limitMs, () => { if (this.turn === ref) this._turnTimeout(seat); });
    }
  }

  _aiTurn(seat) {
    let res;
    try { res = this.port.aiAct(seat.id); } catch (e) { this.io.log?.('warn', e); this.port.pass(seat.id); }
    this._afterShot(seat.id, res);
  }

  _turnTimeout(seat) {
    this.turnTimer = null;
    this.turn = null; // 이후 대행 전환 등이 이 턴을 다시 건드리지 않도록 먼저 해제
    const retreat = this._registerTimeout(seat);
    if (retreat) return this._afterShot(seat.id, retreat);
    this.port.pass(seat.id);
    this._afterResolve();
  }

  // 연속 시간 초과 누적. 한도 도달 시: 접속 중이면 후퇴 결과 반환, 끊김이면 대행 전환.
  _registerTimeout(seat) {
    seat.timeouts++;
    this.io.broadcast({ t: 'toast', code: 'TURN_TIMEOUT', msg: `시간 초과! ${seat.name}님의 턴이 넘어갑니다`, params: { playerId: seat.id, name: seat.name } });
    this.io.system?.('AUTO_PASS', `자동 패스: ${seat.name}`);
    if (seat.timeouts >= this.cfg.maxTimeouts) {
      seat.timeouts = 0;
      if (this.io.isConnected(seat.id)) {
        this.io.broadcast({ t: 'toast', code: 'IDLE_RETREAT', msg: `${seat.name}님이 오랫동안 응답이 없어 후퇴합니다`, params: { playerId: seat.id, name: seat.name } });
        return this.port.retreat(seat.id) || { events: [] };
      }
      this.setProxy(seat.id, 'timeouts');
    }
    return null;
  }

  // ---------- 동기 모드 ----------
  _beginAim() {
    const pre = [];
    for (const id of this.port.aliveIds()) { const bt = this.port.beginTurn(id); if (bt?.events) pre.push(...bt.events); }
    if (pre.length && this.port.isRoundOver()) return this._afterShot(null, { events: pre });
    this.phase = 'aim';
    this.ready = new Map();
    const required = this._activeHumans();
    if (required.length === 0) {
      this.turn = { mode: 'sync', deadline: null, limitMs: null, auto: true };
      this.io.broadcast({ t: 'turn', ...this.turn, events: pre, ...this._timeInfo() });
      this.turnTimer = this._after(this._aiDelay(), () => this._syncResolve());
      return;
    }
    const limitMs = this.options.turnLimitSec * 1000;
    this.turn = { mode: 'sync', deadline: this.now() + limitMs, limitMs, auto: false };
    this.io.broadcast({ t: 'turn', ...this.turn, events: pre, ...this._timeInfo() });
    const ref = this.turn;
    this.turnTimer = this._after(limitMs, () => { if (this.turn === ref) this._syncExpire(); });
  }

  _syncExpire() {
    this.turnTimer = null;
    this.turn = null; // 만료 처리 중 재진입 방지
    const extra = [];
    for (const s of this._activeHumans()) {
      if (this.ready.has(s.id)) continue;
      const r = this._registerTimeout(s);
      if (r?.events) extra.push(...r.events);
    }
    this._syncResolve(extra);
  }

  _syncCheckAllReady() {
    if (this.phase !== 'aim' || this.turn?.mode !== 'sync') return;
    const required = this._activeHumans();
    if (required.every((s) => this.ready.has(s.id))) this._syncResolve();
  }

  _syncResolve(extraEvents = []) {
    this._cancelTurnTimer();
    const shots = [];
    for (const s of this.seats) {
      if (!this._alive(s.id)) continue;
      if (this.ready.has(s.id)) shots.push({ playerId: s.id, input: this.ready.get(s.id) });
      else if (this._isAuto(s)) shots.push({ playerId: s.id, ai: true });
    }
    this.ready = new Map();
    if (shots.length === 0 && extraEvents.length === 0) { this.turn = null; return this._afterResolve(); }
    let res = { events: [] };
    if (shots.length) {
      try { res = this.port.fireBatch(shots) || { events: [] }; } catch (e) {
        this.io.log?.('warn', e); // 엔진이 일제 사격을 거부하면 이번 단계는 샷 없이 넘긴다(멈춤 방지)
        this.turn = null;
        return this._afterResolve();
      }
    }
    res.events = [...extraEvents, ...(res.events || [])];
    this._afterShot(null, res);
  }

  // ---------- 동시 모드 ----------
  _beginSim() {
    this.phase = 'aim';
    this.turn = { mode: 'sim', deadline: null, limitMs: null, auto: false };
    this.io.broadcast({ t: 'turn', ...this.turn, ...this._timeInfo() });
    this._simTick();
  }

  _simTick() {
    this.turnTimer = this._after(this.cfg.simAiMs, () => {
      if (this.phase !== 'aim') return;
      for (const s of this.seats) {
        if (this.phase !== 'aim') break;
        if (!this._isAuto(s) || !this._alive(s.id)) continue;
        let res;
        try { res = this.port.aiAct(s.id); } catch (e) { this.io.log?.('warn', e); continue; }
        if (res) this._simShot(s.id, res);
      }
      if (this.phase === 'aim') this._simTick();
    });
  }

  _simShot(playerId, res) {
    const events = this.talker.insert(res?.events || []);
    this.io.broadcast({ t: 'shot', playerId, events, state: res?.state, ...this._timeInfo() });
    this._sendMe();
    if (this.port.isRoundOver() || this.port.isGameOver()) {
      this._cancelTurnTimer();
      this.phase = 'resolving';
      this._after(this._playbackMs(events, res?.ticks), () => this._afterResolve());
    }
  }

  // ---------- 상점 ----------
  _beginShop() {
    this.phase = 'shop';
    this.turn = null;
    this._sendMe();
    const order = this.port.shopOrder();
    this.shopQueue = (order ?? this.seats.map((s) => s.id)).slice();
    this._nextShop();
  }

  _nextShop() {
    this.shop = null;
    this.pendingSell = null;
    while (this.shopQueue.length) {
      const pid = this.shopQueue.shift();
      const seat = this.seat(pid);
      if (!seat) continue;
      if (this._isAuto(seat)) {
        // 컴퓨터/대행: 즉시 구매, 타이머 없음(AC-S7)
        if (seat.kind === 'human' || this.options.computersBuy) {
          try { this.port.aiShop(pid); } catch (e) { this.io.log?.('warn', e); }
        }
        continue;
      }
      const limitMs = this.options.shopLimitSec * 1000;
      this.shop = { playerId: pid, deadline: this.now() + limitMs, limitMs };
      this.io.broadcast({ t: 'shop_turn', ...this.shop, ...this._timeInfo() });
      this._sendMe(pid); // 본인에게 me + shop(가격 목록)
      const ref = this.shop;
      this.shopTimer = this._after(limitMs, () => { if (this.shop === ref) this._shopExpire(seat); });
      return;
    }
    this.io.broadcast({ t: 'shop_end', ...this._timeInfo() });
    this._beginRound();
  }

  _shopFinish() {
    if (this.shopTimer) { this._cancel(this.shopTimer); this.shopTimer = null; }
    if (this.pendingSell) { // 수락 전 판매 제시는 거절 처리(AC-S3)
      try { this.port.sellReject(this.pendingSell.playerId); } catch { /* noop */ }
      this.pendingSell = null;
    }
    this._nextShop();
  }

  _shopExpire(seat) {
    this.shopTimer = null;
    this.io.broadcast({ t: 'toast', code: 'SHOP_TIMEOUT', msg: `상점 시간 초과! ${seat.name}님의 구매가 종료됩니다`, params: { playerId: seat.id, name: seat.name } });
    this._shopFinish();
  }

  // ---------- 클라이언트 입력 ----------
  handle(id, msg) {
    const seat = this.seat(id);
    if (!seat || seat.kind !== 'human' || seat.left) throw new ProtocolError('NOT_IN_GAME');
    switch (msg.t) {
      case 'fire': return this._onFire(seat, msg);
      case 'aim': return this._onAim(seat, msg);
      case 'act': return this._onAct(seat, msg);
      case 'retreat': return this._onRetreat(seat);
      case 'buy': return this._onBuy(seat, msg);
      case 'sell_quote': return this._onSellQuote(seat, msg);
      case 'sell_accept': return this._onSellDecision(seat, true);
      case 'sell_reject': return this._onSellDecision(seat, false);
      case 'shop_done': return this._onShopDone(seat);
      default: throw new ProtocolError('UNKNOWN_TYPE');
    }
  }

  _wrapEngine(fn) {
    try { return fn(); } catch (e) {
      if (e instanceof ProtocolError) throw e;
      throw new ProtocolError(e?.code && typeof e.code === 'string' ? e.code : 'ENGINE_REJECT', e?.params || {}, e?.message);
    }
  }

  _requireAim() {
    if (this.phase !== 'aim' || !this.turn) throw new ProtocolError('WRONG_PHASE');
  }

  // 마감 이후 도착한 입력은 거부하고, 아직 타이머가 돌지 않았으면 즉시 만료 처리한다(서버 수신 시각 기준).
  _checkDeadline(seat) {
    if (this.turn.deadline != null && this.now() > this.turn.deadline) {
      this._expireNow();
      throw new ProtocolError('TURN_EXPIRED');
    }
  }
  _expireNow() {
    const ref = this.turn;
    if (!ref) return;
    this._cancelTurnTimer();
    if (ref.mode === 'seq') this._turnTimeout(this.seat(ref.playerId));
    else if (ref.mode === 'sync') this._syncExpire();
  }

  _onFire(seat, msg) {
    this._requireAim();
    const input = validateFireInput(msg);
    if (!this._alive(seat.id)) throw new ProtocolError('WRONG_PHASE');
    const mode = this.turn.mode;
    if (mode === 'seq') {
      if (this.turn.playerId !== seat.id) throw new ProtocolError('NOT_YOUR_TURN');
      this._checkDeadline(seat);
      if (this.turn.auto) throw new ProtocolError('WRONG_PHASE');
      const res = this._wrapEngine(() => this.port.fire(seat.id, input));
      seat.timeouts = 0; // 유효한 발사 -> 연속 초과 초기화
      this._afterShot(seat.id, res); // 발사 확정 -> 타이머 정지
    } else if (mode === 'sync') {
      if (this.ready.has(seat.id)) throw new ProtocolError('ALREADY_READY');
      this._checkDeadline(seat);
      if (this.turn.auto) throw new ProtocolError('WRONG_PHASE');
      this._wrapEngine(() => this.port.validate(seat.id, input));
      seat.timeouts = 0;
      this.ready.set(seat.id, input);
      this.io.broadcast({ t: 'ready', playerId: seat.id, readyIds: [...this.ready.keys()] }); // 조준 값은 노출하지 않는다
      this._syncCheckAllReady();
    } else {
      const res = this._wrapEngine(() => this.port.fire(seat.id, input));
      seat.timeouts = 0;
      this._simShot(seat.id, res);
    }
  }

  _onAim(seat, msg) {
    if (this.phase !== 'aim' || !this.turn) return;
    const mode = this.turn.mode;
    if (mode === 'sync') return;
    if (mode === 'seq' && this.turn.playerId !== seat.id) return;
    if (!isFiniteNum(msg.angle) || !isFiniteNum(msg.power)) throw new ProtocolError('INVALID_INPUT');
    const t = this.now();
    if (t - (this.lastAim.get(seat.id) ?? -Infinity) < this.cfg.aimMinIntervalMs) return;
    this.lastAim.set(seat.id, t);
    this.io.broadcastExcept?.(seat.id, { t: 'aim', playerId: seat.id, angle: msg.angle, power: msg.power, weapon: msg.weapon });
  }

  _onAct(seat, msg) {
    this._requireAim();
    if (this.turn.mode === 'seq' && this.turn.playerId !== seat.id) throw new ProtocolError('NOT_YOUR_TURN');
    if (this.turn.mode === 'sync' && this.ready.has(seat.id)) throw new ProtocolError('ALREADY_READY');
    this._checkDeadline(seat);
    if (typeof msg.action !== 'string' || msg.action.length > 32) throw new ProtocolError('INVALID_INPUT');
    const { t, ...payload } = msg;
    const res = this._wrapEngine(() => this.port.act(seat.id, payload));
    // 이동 등은 타이머를 멈추지 않는다(5.7.1-2). 본인에게는 전체 상태, 타인에게는 공개 상태·이벤트만(설정 값 비노출).
    const events = res?.events || [];
    this.io.sendTo(seat.id, { t: 'act_result', playerId: seat.id, events, state: res?.privateState ?? res?.state });
    for (const o of this.seats) {
      if (o.id === seat.id || o.kind !== 'human' || o.left) continue;
      const pubKeys = res?.state ? Object.keys(res.state.tanks || {}).length : 0;
      if (events.length || pubKeys) this.io.sendTo(o.id, { t: 'act_result', playerId: seat.id, events, state: res?.state });
    }
    this._sendMe(seat.id);
  }

  _onRetreat(seat) {
    this._requireAim();
    if (this.turn.mode !== 'seq') throw new ProtocolError('WRONG_PHASE');
    if (this.turn.playerId !== seat.id) throw new ProtocolError('NOT_YOUR_TURN');
    this._checkDeadline(seat);
    const res = this._wrapEngine(() => this.port.retreat(seat.id));
    this._afterShot(seat.id, res || { events: [] });
  }

  _requireShop(seat) {
    if (this.phase !== 'shop' || !this.shop) throw new ProtocolError('WRONG_PHASE');
    if (this.shop.playerId !== seat.id) throw new ProtocolError('NOT_YOUR_SHOP');
    if (this.now() > this.shop.deadline) { // 마감 후 요청 거부 + 즉시 만료 처리(AC-S5)
      this._cancel(this.shopTimer); this.shopTimer = null;
      this._shopExpire(seat);
      throw new ProtocolError('SHOP_EXPIRED');
    }
  }

  _posInt(v) { if (!Number.isInteger(v) || v < 1 || v > 99) throw new ProtocolError('INVALID_INPUT'); return v; }
  _itemId(v) { if (!((typeof v === 'string' && v.length > 0 && v.length <= 64) || Number.isInteger(v))) throw new ProtocolError('INVALID_INPUT'); return v; }

  _onBuy(seat, msg) {
    this._requireShop(seat);
    const item = this._itemId(msg.item); const qty = msg.qty === undefined ? 1 : this._posInt(msg.qty);
    const res = this._wrapEngine(() => this.port.buy(seat.id, item, qty));
    this.io.sendTo(seat.id, { t: 'shop_result', ok: true, action: 'buy', item, qty, state: res?.state, snapshot: this.port.snapshot(seat.id), shop: this._shopListFor(seat.id) });
  }

  _onSellQuote(seat, msg) {
    this._requireShop(seat);
    const item = this._itemId(msg.item); const qty = msg.qty === undefined ? 1 : this._posInt(msg.qty);
    if (this.pendingSell) { try { this.port.sellReject(seat.id); } catch { /* noop */ } this.pendingSell = null; }
    const quote = this._wrapEngine(() => this.port.sellQuote(seat.id, item, qty));
    this.pendingSell = { playerId: seat.id, item, qty };
    this.io.sendTo(seat.id, { t: 'sell_quote', item, qty, quote });
  }

  _onSellDecision(seat, accept) {
    this._requireShop(seat);
    if (!this.pendingSell) throw new ProtocolError('WRONG_PHASE');
    this.pendingSell = null;
    const res = this._wrapEngine(() => (accept ? this.port.sellAccept(seat.id) : this.port.sellReject(seat.id)));
    this.io.sendTo(seat.id, { t: 'shop_result', ok: true, action: accept ? 'sell' : 'sell_reject', state: res?.state, snapshot: this.port.snapshot(seat.id), shop: this._shopListFor(seat.id) });
  }

  _onShopDone(seat) {
    this._requireShop(seat);
    this._shopFinish();
  }

  // ---------- 이탈·재접속·대행 ----------
  // 컴퓨터 대행 전환(유예 초과 / 연속 시간 초과). 성향은 엔진 쪽에서 모론.
  setProxy(id, reason) {
    const seat = this.seat(id);
    if (!seat || seat.proxy || seat.kind !== 'human') return;
    seat.proxy = true;
    try { this.port.setProxy(id, true); } catch { /* noop */ }
    this.io.system?.('PROXY', `컴퓨터 대행: ${seat.name}`);
    this._onSeatBecameAuto(seat);
  }

  seatLeft(id) {
    const seat = this.seat(id);
    if (!seat || seat.left) return;
    seat.left = true;
    try { this.port.setProxy(id, true); } catch { /* noop */ }
    this._onSeatBecameAuto(seat);
  }

  _onSeatBecameAuto(seat) {
    if (this.destroyed) return;
    if (this.phase === 'aim' && this.turn) {
      if (this.turn.mode === 'seq' && this.turn.playerId === seat.id && !this.turn.auto) {
        this._cancelTurnTimer();
        this.turn = { ...this.turn, deadline: null, limitMs: null, auto: true };
        this.io.broadcast({ t: 'turn', ...this.turn, ...this._timeInfo() });
        const ref = this.turn;
        this.turnTimer = this._after(this._aiDelay(), () => { if (this.turn === ref) this._aiTurn(seat); });
      } else if (this.turn.mode === 'sync') {
        this._syncCheckAllReady();
      }
    } else if (this.phase === 'shop' && this.shop?.playerId === seat.id) {
      if (this.shopTimer) { this._cancel(this.shopTimer); this.shopTimer = null; }
      this._shopFinish_auto(seat);
    }
  }

  _shopFinish_auto(seat) {
    try { this.port.aiShop(seat.id); } catch { /* noop */ }
    this._shopFinish();
  }

  // 같은 세션 토큰으로 돌아옴: 대행 중이었다면 즉시 제어 회수(AC-T10).
  reclaim(id) {
    const seat = this.seat(id);
    if (!seat || seat.kind !== 'human' || seat.left) return;
    if (seat.proxy) {
      seat.proxy = false;
      seat.timeouts = 0;
      try { this.port.setProxy(id, false); } catch { /* noop */ }
      this.io.system?.('RECLAIM', `${seat.name}님이 돌아왔습니다`);
    }
  }

  resume(id) {
    return {
      t: 'game_resume',
      seats: this.publicSeats(),
      options: this.options,
      ...this.phaseInfo(),
      snapshot: this.port ? this.port.snapshot(id) : null,
    };
  }
}
