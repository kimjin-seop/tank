// 로비: 세션/닉네임, 방 목록, 방 CRUD, 대기실(준비/시작/강퇴/방장 위임/채팅/컴퓨터 슬롯/옵션), 이탈·재접속.
// 전송 계층과 분리: conn = { send(obj), close() } 만 알면 된다(WebSocket은 server/index.js 에서 연결).

import { randomUUID } from 'node:crypto';
import {
  ProtocolError, errorMsg, parseMessage, defaultOptions, mergeOptions, OPTION_SCHEMA,
  NICK_RE, RESERVED_NICK_RE, TITLE_MAX, CHAT_MAX, MAX_PLAYERS_MIN, MAX_PLAYERS_MAX,
  HUMAN_TANK_TYPES, TANK_TYPES, PERSONALITIES, PERSONALITY_KO, TEAM_MIN, TEAM_MAX, PROTOCOL_VERSION,
} from '../net/protocol.js';
import { RoomGame } from '../game/roomGame.js';

export const DEFAULT_LOBBY_CONFIG = {
  graceMs: 30000,          // 끊김 유예(5.8)
  chatMinGapMs: 400,       // 채팅 최소 간격
  chatBurst: 6,            // chatWindowMs 안 최대 메시지 수
  chatWindowMs: 10000,
  maxMsgPerSec: 60,        // 연결당 전체 메시지 속도 제한
  chatHistory: 30,
};

const GAME_TYPES = new Set(['fire', 'aim', 'act', 'retreat', 'buy', 'sell_quote', 'sell_accept', 'sell_reject', 'shop_done']);

export class Lobby {
  constructor({ clock, engine, config = {}, gameConfig = {}, rng = Math.random, log = () => {} }) {
    this.clock = clock;
    this.engine = engine;
    this.cfg = { ...DEFAULT_LOBBY_CONFIG, ...config };
    this.gameConfig = gameConfig;
    this.rng = rng;
    this.log = log;
    this.sessions = new Map(); // token -> session
    this.nicks = new Map();    // lower nickname -> session
    this.rooms = new Map();    // roomId -> room
    this.roomSeq = 0;
    this.pSeq = 0;
    this.listDirty = false;
  }

  // ===== 전송 계층 진입점 =====
  onConnect(conn) { conn.session = null; conn.msgTimes = []; }

  onMessage(conn, raw) {
    const msg = parseMessage(raw);
    if (!msg) return conn.send(errorMsg('BAD_MESSAGE'));
    const ref = msg.ref;
    try {
      this._rateLimit(conn);
      this._dispatch(conn, msg);
    } catch (e) {
      if (e instanceof ProtocolError) conn.send(errorMsg(e.code, ref, e.params, e.message));
      else {
        this.log('error', e);
        conn.send(errorMsg('INTERNAL', ref));
      }
    }
  }

  onClose(conn) {
    const s = conn.session;
    if (!s || s.conn !== conn) return;
    s.conn = null;
    s.graceExpired = false;
    const room = s.roomId && this.rooms.get(s.roomId);
    if (room) this._broadcastRoom(room);
    this._cancel(s.graceTimer);
    s.graceTimer = this.clock.setTimeout(() => this._graceExpire(s), this.cfg.graceMs);
  }

  // ===== 내부 유틸 =====
  _cancel(h) { if (h) this.clock.clearTimeout(h); }

  _rateLimit(conn) {
    const now = this.clock.now();
    const a = conn.msgTimes;
    a.push(now);
    while (a.length && now - a[0] > 1000) a.shift();
    if (a.length > this.cfg.maxMsgPerSec) throw new ProtocolError('RATE_LIMITED');
  }

  _send(s, msg) { if (s.conn) s.conn.send(msg); }

  _dispatch(conn, msg) {
    if (msg.t === 'ping') return conn.send({ t: 'pong', clientTime: msg.clientTime, serverTime: this.clock.now() });
    if (msg.t === 'hello') return this._hello(conn, msg);
    const s = conn.session;
    if (!s) throw new ProtocolError('NOT_LOGGED_IN');
    switch (msg.t) {
      case 'list_rooms': return this._send(s, this._roomListMsg());
      case 'create_room': return this._createRoom(s, msg);
      case 'join_room': return this._joinRoom(s, msg);
      case 'leave_room': return this._leaveRoom(s);
      case 'ready': return this._ready(s, msg);
      case 'set_options': return this._setOptions(s, msg);
      case 'set_profile': return this._setProfile(s, msg);
      case 'add_computer': return this._addComputer(s, msg);
      case 'remove_computer': return this._removeComputer(s, msg);
      case 'set_computer': return this._setComputer(s, msg);
      case 'kick': return this._kick(s, msg);
      case 'transfer_host': return this._transferHostCmd(s, msg);
      case 'start': return this._start(s);
      case 'chat': return this._chat(s, msg);
      default:
        if (GAME_TYPES.has(msg.t)) return this._gameMsg(s, msg);
        throw new ProtocolError('UNKNOWN_TYPE');
    }
  }

  _roomOf(s) {
    const room = s.roomId && this.rooms.get(s.roomId);
    if (!room) throw new ProtocolError('NOT_IN_ROOM');
    return room;
  }
  _me(room, s) { return room.members.find((p) => p.token === s.token); }
  _requireHost(room, s) {
    const me = this._me(room, s);
    if (!me || room.hostId !== me.id) throw new ProtocolError('NOT_HOST');
    return me;
  }
  _requireWaiting(room) { if (room.phase !== 'waiting') throw new ProtocolError('IN_GAME'); }
  _sessionOf(p) { return p.token ? this.sessions.get(p.token) : null; }
  _isConnected(p) { return p.kind === 'computer' || !!this._sessionOf(p)?.conn; }
  _humans(room) { return room.members.filter((p) => p.kind === 'human' && !p.left); }
  _count(room) { return room.members.filter((p) => !p.left).length; }

  // ===== 세션 =====
  _hello(conn, msg) {
    if (conn.session) throw new ProtocolError('ALREADY_LOGGED_IN');
    let s = typeof msg.token === 'string' ? this.sessions.get(msg.token) : null;
    let resumed = false;
    if (s) {
      resumed = true;
      if (s.conn && s.conn !== conn) {
        s.conn.send(errorMsg('SESSION_REPLACED'));
        s.conn.session = null;
        s.conn.close();
      }
      this._cancel(s.graceTimer);
      s.graceTimer = null;
      s.graceExpired = false;
      s.conn = conn;
    } else {
      const nick = typeof msg.nickname === 'string' ? msg.nickname.trim() : '';
      if (!NICK_RE.test(nick) || RESERVED_NICK_RE.test(nick)) throw new ProtocolError('NICK_INVALID');
      const exist = this.nicks.get(nick.toLowerCase());
      if (exist) {
        // 끊겨 있고 방에도 없는 세션은 잃을 것이 없으므로 같은 닉네임 재접속을 허용
        if (!exist.conn && !exist.roomId) this._dropSession(exist);
        else throw new ProtocolError('NICK_TAKEN');
      }
      s = { token: randomUUID(), nickname: nick, conn, roomId: null, graceTimer: null, graceExpired: false, chatTimes: [] };
      this.sessions.set(s.token, s);
      this.nicks.set(nick.toLowerCase(), s);
    }
    conn.session = s;
    const room = s.roomId && this.rooms.get(s.roomId);
    this._send(s, {
      t: 'welcome', protocol: PROTOCOL_VERSION, token: s.token, nickname: s.nickname, resumed,
      location: room ? (room.phase === 'playing' ? 'game' : 'room') : 'lobby',
      serverTime: this.clock.now(),
      limits: { chatMax: CHAT_MAX, titleMax: TITLE_MAX, maxPlayers: [MAX_PLAYERS_MIN, MAX_PLAYERS_MAX] },
      defaults: defaultOptions(), schema: OPTION_SCHEMA,
      tanks: TANK_TYPES, humanTanks: HUMAN_TANK_TYPES, personalities: PERSONALITIES,
    });
    if (room) {
      const me = this._me(room, s);
      this._sendRoomJoined(s, room, me);
      if (room.game) { room.game.reclaim(me.id); this._send(s, room.game.resume(me.id)); }
      this._broadcastRoom(room);
    } else {
      this._send(s, this._roomListMsg());
    }
  }

  _dropSession(s) {
    this._cancel(s.graceTimer);
    this.sessions.delete(s.token);
    if (this.nicks.get(s.nickname.toLowerCase()) === s) this.nicks.delete(s.nickname.toLowerCase());
  }

  _graceExpire(s) {
    s.graceTimer = null;
    if (s.conn) return;
    s.graceExpired = true;
    const room = s.roomId && this.rooms.get(s.roomId);
    if (!room) return this._dropSession(s);
    const me = this._me(room, s);
    if (room.phase === 'waiting') {
      this._removeMember(room, me, 'timeout');
      this._dropSession(s);
      return;
    }
    // 게임 중: 좌석 유지 + 컴퓨터 대행, 방장이면 위임
    room.game?.setProxy(me.id, 'grace');
    if (room.hostId === me.id) this._autoHost(room, me);
    if (this._humans(room).every((p) => !this._isConnected(p) && this._sessionOf(p)?.graceExpired)) {
      this._destroyRoom(room);
      return;
    }
    this._broadcastRoom(room);
  }

  // ===== 방 =====
  /** 컴퓨터 자동 탱크: 트리플·fixed 제외, 방에서 안 쓰인 모양 우선, 모두 쓰였으면 순환 */
  _autoTank(room) {
    const pool = HUMAN_TANK_TYPES.filter((t) => t !== 'fixed');
    const used = room.members.map((m) => m.tank);
    return pool.find((t) => !used.includes(t)) || pool[room.members.length % pool.length];
  }

  _newMember(room, { kind, name, token, personality }) {
    const used = new Set(room.members.map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const m = {
      id: `p${++this.pSeq}`, kind, name, token: token || null, slot, ready: kind === 'computer',
      tank: kind === 'computer' ? this._autoTank(room) : 'classic', team: (slot % 2) + 1, personality: personality || null,
      joinedSeq: ++this.pSeq, left: false,
    };
    room.members.push(m);
    return m;
  }

  _createRoom(s, msg) {
    if (s.roomId) throw new ProtocolError('ALREADY_IN_ROOM');
    const title = typeof msg.title === 'string' ? msg.title.trim() : '';
    if (title.length < 1 || title.length > TITLE_MAX) throw new ProtocolError('TITLE_INVALID');
    const maxPlayers = msg.maxPlayers === undefined ? MAX_PLAYERS_MIN : msg.maxPlayers;
    if (!Number.isInteger(maxPlayers) || maxPlayers < MAX_PLAYERS_MIN || maxPlayers > MAX_PLAYERS_MAX) throw new ProtocolError('MAX_PLAYERS_INVALID');
    if (msg.password) throw new ProtocolError('PASSWORD_UNSUPPORTED');
    const options = mergeOptions(defaultOptions(), msg.options);
    const room = {
      id: `r${++this.roomSeq}`, title, maxPlayers, options, phase: 'waiting', hostId: null,
      members: [], banned: new Set(), game: null, chat: [], createdSeq: this.roomSeq,
    };
    this.rooms.set(room.id, room);
    const me = this._newMember(room, { kind: 'human', name: s.nickname, token: s.token });
    room.hostId = me.id;
    s.roomId = room.id;
    this._sendRoomJoined(s, room, me);
    this._markList();
  }

  _joinRoom(s, msg) {
    if (s.roomId) throw new ProtocolError('ALREADY_IN_ROOM');
    const room = this.rooms.get(msg.roomId);
    if (!room) throw new ProtocolError('ROOM_NOT_FOUND');
    if (room.banned.has(s.token) || room.banned.has(`n:${s.nickname.toLowerCase()}`)) throw new ProtocolError('ROOM_KICKED');
    if (room.phase !== 'waiting') throw new ProtocolError('ROOM_IN_GAME');
    if (this._count(room) >= room.maxPlayers) throw new ProtocolError('ROOM_FULL');
    if (msg.password) throw new ProtocolError('PASSWORD_UNSUPPORTED');
    const me = this._newMember(room, { kind: 'human', name: s.nickname, token: s.token });
    s.roomId = room.id;
    this._sendRoomJoined(s, room, me);
    this._systemChat(room, 'JOIN', `${s.nickname}님이 입장했습니다`);
    this._broadcastRoom(room);
    this._markList();
  }

  _leaveRoom(s) {
    const room = this._roomOf(s);
    const me = this._me(room, s);
    this._removeMember(room, me, 'leave');
    this._send(s, { t: 'room_left', reason: 'leave' });
    this._send(s, this._roomListMsg());
  }

  // 참가자 제거(나가기/유예 초과/강퇴 공통). 방장 위임·빈 방 삭제 포함.
  _removeMember(room, me, reason) {
    const s = this._sessionOf(me);
    if (s) s.roomId = null;
    if (room.phase === 'playing') {
      me.left = true;
      room.game?.seatLeft(me.id);
    } else {
      room.members = room.members.filter((m) => m !== me);
    }
    if (reason === 'leave') this._systemChat(room, 'LEAVE', `${me.name}님이 나갔습니다`);
    else if (reason === 'timeout') this._systemChat(room, 'LEAVE', `${me.name}님의 연결이 끊어졌습니다`);
    if (this._humans(room).length === 0) { this._destroyRoom(room); return; }
    if (room.hostId === me.id) this._autoHost(room, me);
    this._broadcastRoom(room);
    this._markList();
  }

  // 방장 자동 위임: 방에 가장 오래 있던 사람 참가자(접속 중 우선)
  _autoHost(room, prev) {
    const cands = this._humans(room).filter((p) => p !== prev).sort((a, b) => a.joinedSeq - b.joinedSeq);
    const next = cands.find((p) => this._isConnected(p)) || cands[0];
    if (!next) return;
    room.hostId = next.id;
    this._systemChat(room, 'HOST', `${next.name}님이 새 방장이 되었습니다`);
  }

  _destroyRoom(room) {
    room.game?.destroy();
    room.game = null;
    for (const m of room.members) {
      const s = this._sessionOf(m);
      if (s && s.roomId === room.id) {
        s.roomId = null;
        if (s.conn) { this._send(s, { t: 'room_left', reason: 'closed' }); this._send(s, this._roomListMsg()); }
        else this._dropSession(s);
      }
    }
    this.rooms.delete(room.id);
    this._markList();
  }

  _ready(s, msg) {
    const room = this._roomOf(s);
    this._requireWaiting(room);
    const me = this._me(room, s);
    if (room.hostId === me.id) throw new ProtocolError('HOST_NO_READY');
    if (typeof msg.ready !== 'boolean') throw new ProtocolError('BAD_MESSAGE');
    me.ready = msg.ready;
    this._broadcastRoom(room);
  }

  _setOptions(s, msg) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    this._requireWaiting(room);
    let changed = false;
    const next = mergeOptions(room.options, msg.options);
    // 검증을 전부 마친 뒤 반영
    let title = room.title;
    if (msg.title !== undefined) {
      title = typeof msg.title === 'string' ? msg.title.trim() : '';
      if (title.length < 1 || title.length > TITLE_MAX) throw new ProtocolError('TITLE_INVALID');
    }
    let maxPlayers = room.maxPlayers;
    if (msg.maxPlayers !== undefined) {
      maxPlayers = msg.maxPlayers;
      if (!Number.isInteger(maxPlayers) || maxPlayers < MAX_PLAYERS_MIN || maxPlayers > MAX_PLAYERS_MAX) throw new ProtocolError('MAX_PLAYERS_INVALID');
      if (maxPlayers < this._count(room)) throw new ProtocolError('MAX_PLAYERS_TOO_SMALL');
    }
    if (JSON.stringify(next) !== JSON.stringify(room.options)) { room.options = next; changed = true; }
    if (title !== room.title) { room.title = title; changed = true; }
    if (maxPlayers !== room.maxPlayers) {
      room.maxPlayers = maxPlayers; changed = true;
      this._compactSlots(room);
    }
    if (!changed) return;
    for (const m of room.members) if (m.kind === 'human') m.ready = false; // 옵션 변경 시 준비 해제
    this._systemChat(room, 'OPTIONS', '방 설정이 변경되었습니다');
    this._broadcastRoom(room);
    this._markList();
  }

  _compactSlots(room) {
    const taken = new Set();
    const over = [];
    for (const m of room.members) { if (m.slot < room.maxPlayers) taken.add(m.slot); else over.push(m); }
    for (const m of over) { let i = 0; while (taken.has(i)) i++; m.slot = i; taken.add(i); }
  }

  _setProfile(s, msg) {
    const room = this._roomOf(s);
    this._requireWaiting(room);
    const me = this._me(room, s);
    let target = me;
    if (msg.target !== undefined && msg.target !== me.id) {
      this._requireHost(room, s);
      target = room.members.find((m) => m.id === msg.target && !m.left);
      if (!target) throw new ProtocolError('TARGET_NOT_FOUND');
      if (msg.tank !== undefined) throw new ProtocolError('BAD_MESSAGE'); // 방장은 남의 팀만 바꾼다
    }
    if (msg.tank !== undefined) {
      const ok = (target.kind === 'computer' ? TANK_TYPES : HUMAN_TANK_TYPES).includes(msg.tank);
      if (!ok) throw new ProtocolError('TANK_INVALID');
      target.tank = msg.tank;
    }
    if (msg.team !== undefined) {
      if (!Number.isInteger(msg.team) || msg.team < TEAM_MIN || msg.team > TEAM_MAX) throw new ProtocolError('TEAM_INVALID');
      target.team = msg.team;
    }
    this._broadcastRoom(room);
  }

  _computerName(room) {
    const taken = new Set(room.members.map((m) => m.name));
    let n = 1;
    while (taken.has(`컴퓨터${n}`)) n++;
    return `컴퓨터${n}`;
  }

  _addComputer(s, msg) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    this._requireWaiting(room);
    const personality = msg.personality === undefined ? 'moron' : msg.personality;
    if (!PERSONALITIES.includes(personality)) throw new ProtocolError('PERSONALITY_INVALID');
    if (this._count(room) >= room.maxPlayers) throw new ProtocolError('ROOM_FULL');
    const m = this._newMember(room, { kind: 'computer', name: this._computerName(room), personality });
    this._systemChat(room, 'COMPUTER', `컴퓨터(${PERSONALITY_KO[personality]})가 추가되었습니다`);
    void m;
    this._broadcastRoom(room);
    this._markList();
  }

  _removeComputer(s, msg) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    this._requireWaiting(room);
    const m = room.members.find((x) => x.id === msg.id && x.kind === 'computer');
    if (!m) throw new ProtocolError('TARGET_NOT_FOUND');
    room.members = room.members.filter((x) => x !== m);
    this._broadcastRoom(room);
    this._markList();
  }

  _setComputer(s, msg) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    this._requireWaiting(room);
    const m = room.members.find((x) => x.id === msg.id && x.kind === 'computer');
    if (!m) throw new ProtocolError('TARGET_NOT_FOUND');
    if (!PERSONALITIES.includes(msg.personality)) throw new ProtocolError('PERSONALITY_INVALID');
    m.personality = msg.personality;
    this._broadcastRoom(room);
  }

  _kick(s, msg) {
    const room = this._roomOf(s);
    const me = this._requireHost(room, s);
    this._requireWaiting(room);
    const target = room.members.find((m) => m.id === msg.id);
    if (!target) throw new ProtocolError('TARGET_NOT_FOUND');
    if (target === me) throw new ProtocolError('CANNOT_KICK_SELF');
    if (target.kind === 'computer') return this._removeComputer(s, msg);
    const ts = this._sessionOf(target);
    room.banned.add(target.token);
    room.banned.add(`n:${target.name.toLowerCase()}`);
    room.members = room.members.filter((m) => m !== target);
    if (ts) {
      ts.roomId = null;
      this._send(ts, { t: 'kicked', roomId: room.id, msg: '방장에 의해 강퇴되었습니다' });
      this._send(ts, { t: 'room_left', reason: 'kicked' });
      this._send(ts, this._roomListMsg());
    }
    this._systemChat(room, 'KICK', `${target.name}님이 강퇴되었습니다`);
    this._broadcastRoom(room);
    this._markList();
  }

  _transferHostCmd(s, msg) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    const t = this._humans(room).find((m) => m.id === msg.id);
    if (!t) throw new ProtocolError('TARGET_NOT_FOUND');
    room.hostId = t.id;
    t.ready = false;
    this._systemChat(room, 'HOST', `${t.name}님이 새 방장이 되었습니다`);
    this._broadcastRoom(room);
  }

  canStart(room) {
    if (this._count(room) < 2) return { ok: false, code: 'START_NEED_PLAYERS', msg: '2명 이상이어야 시작할 수 있습니다' };
    if (room.members.some((m) => m.kind === 'human' && m.id !== room.hostId && !m.ready)) {
      return { ok: false, code: 'START_NOT_READY', msg: '준비하지 않은 참가자가 있습니다' };
    }
    if (room.options.teams !== 'NONE' && new Set(room.members.map((m) => m.team)).size < 2) {
      return { ok: false, code: 'START_TEAMS', msg: '팀이 둘 이상이어야 시작할 수 있습니다' };
    }
    return { ok: true };
  }

  _start(s) {
    const room = this._roomOf(s);
    this._requireHost(room, s);
    this._requireWaiting(room);
    const c = this.canStart(room);
    if (!c.ok) throw new ProtocolError(c.code);
    const seats = room.members.filter((m) => !m.left).map((m) => ({
      id: m.id, name: m.name, kind: m.kind, color: m.slot, tank: m.tank, team: m.team, personality: m.personality,
    }));
    room.phase = 'playing';
    room.game = new RoomGame({
      seats, options: { ...room.options }, engine: this.engine, clock: this.clock, rng: this.rng, config: this.gameConfig,
      io: this._gameIo(room), onEnd: (r) => this._gameEnded(room, r),
    });
    this._systemChat(room, 'START', '게임을 시작합니다');
    this._broadcastRoom(room);
    this._markList();
    room.game.start();
  }

  _gameIo(room) {
    const byId = (id) => room.members.find((m) => m.id === id);
    return {
      broadcast: (msg) => this._toRoom(room, msg),
      broadcastExcept: (id, msg) => this._toRoom(room, msg, id),
      sendTo: (id, msg) => { const m = byId(id); const s = m && this._sessionOf(m); if (s) this._send(s, msg); },
      isConnected: (id) => { const m = byId(id); return !!m && this._isConnected(m); },
      system: (key, text) => this._systemChat(room, key, text),
      log: (lvl, e) => this.log(lvl, e),
    };
  }

  _gameMsg(s, msg) {
    const room = this._roomOf(s);
    if (!room.game) throw new ProtocolError('NOT_IN_GAME');
    room.game.handle(this._me(room, s).id, msg);
  }

  // 게임 종료 -> 대기실 복귀: 준비 해제, 옵션/방장 유지, 이탈자 정리
  _gameEnded(room) {
    if (!this.rooms.has(room.id)) return;
    room.game?.destroy();
    room.game = null;
    room.phase = 'waiting';
    for (const m of [...room.members]) {
      const s = this._sessionOf(m);
      if (m.left) { room.members = room.members.filter((x) => x !== m); continue; }
      if (m.kind === 'human' && (!s || (!s.conn && s.graceExpired))) {
        room.members = room.members.filter((x) => x !== m);
        if (s) { s.roomId = null; this._dropSession(s); }
        continue;
      }
      if (m.kind === 'human') m.ready = false;
    }
    if (this._humans(room).length === 0) return this._destroyRoom(room);
    if (!room.members.some((m) => m.id === room.hostId)) {
      room.hostId = null;
      const first = this._humans(room).sort((a, b) => a.joinedSeq - b.joinedSeq)[0];
      room.hostId = first.id;
      this._systemChat(room, 'HOST', `${first.name}님이 새 방장이 되었습니다`);
    }
    this._toRoom(room, { t: 'back_to_room' });
    this._broadcastRoom(room);
    this._markList();
  }

  _chat(s, msg) {
    const room = this._roomOf(s);
    this._requireWaiting(room); // 채팅은 대기실만(5.10)
    if (typeof msg.text !== 'string') throw new ProtocolError('CHAT_EMPTY');
    // eslint-disable-next-line no-control-regex
    const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!text) throw new ProtocolError('CHAT_EMPTY');
    if (text.length > CHAT_MAX) throw new ProtocolError('CHAT_TOO_LONG');
    const now = this.clock.now();
    const a = s.chatTimes;
    while (a.length && now - a[0] > this.cfg.chatWindowMs) a.shift();
    if ((a.length && now - a[a.length - 1] < this.cfg.chatMinGapMs) || a.length >= this.cfg.chatBurst) throw new ProtocolError('CHAT_RATE');
    a.push(now);
    const me = this._me(room, s);
    this._pushChat(room, { t: 'chat', from: { id: me.id, name: me.name }, text, ts: now });
  }

  _systemChat(room, key, text) {
    this._pushChat(room, { t: 'chat', system: true, key, text, ts: this.clock.now() });
  }

  _pushChat(room, m) {
    room.chat.push(m);
    if (room.chat.length > this.cfg.chatHistory) room.chat.shift();
    this._toRoom(room, m);
  }

  // ===== 직렬화/브로드캐스트 =====
  roomState(room) {
    const slots = [];
    for (let i = 0; i < room.maxPlayers; i++) {
      const m = room.members.find((x) => x.slot === i && !x.left);
      if (!m) { slots.push({ slot: i, empty: true }); continue; }
      slots.push({
        slot: i, id: m.id, kind: m.kind, name: m.name, ready: m.ready, tank: m.tank, team: m.team, color: i,
        personality: m.personality, connected: this._isConnected(m), host: m.id === room.hostId,
      });
    }
    return {
      id: room.id, title: room.title, maxPlayers: room.maxPlayers, status: room.phase, hostId: room.hostId,
      options: room.options, slots, start: this.canStart(room), serverTime: this.clock.now(),
    };
  }

  _sendRoomJoined(s, room, me) {
    this._send(s, { t: 'room_joined', you: me.id, room: this.roomState(room), chat: room.chat });
  }

  _toRoom(room, msg, exceptId) {
    for (const m of room.members) {
      if (m.kind !== 'human' || m.left || m.id === exceptId) continue;
      const s = this._sessionOf(m);
      if (s) this._send(s, msg);
    }
  }

  _broadcastRoom(room) {
    this._toRoom(room, { t: 'room_state', room: this.roomState(room) });
  }

  roomList() {
    return [...this.rooms.values()]
      .sort((a, b) => b.createdSeq - a.createdSeq) // 최근 생성 순(5.3)
      .map((r) => ({
        id: r.id, title: r.title, players: this._count(r), maxPlayers: r.maxPlayers, mode: r.options.mode,
        status: r.phase, locked: false, host: r.members.find((m) => m.id === r.hostId)?.name,
      }));
  }
  _roomListMsg() { return { t: 'room_list', rooms: this.roomList() }; }

  _markList() {
    if (this.listDirty) return;
    this.listDirty = true;
    queueMicrotask(() => {
      this.listDirty = false;
      const msg = this._roomListMsg();
      for (const s of this.sessions.values()) if (s.conn && !s.roomId) s.conn.send(msg);
    });
  }
}
