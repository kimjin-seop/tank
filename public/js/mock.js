// ?mock=1 전용 가짜 서버. 실서버(lobby.js / roomGame.js)와 같은 메시지를 보내고,
// 샷 결과는 docs/ENGINE_API.md 이벤트 형식(t, tick, pts 평탄 배열, terrain spans ...)으로 만든다.
// 물리·피해 수치는 시연용 근사치이며 원본 규칙과 무관하다.
import { PRICE } from './game/prices.js';
import { shotDuration } from './game/playback.js';

const W = 360, H = 480;
const TALK1 = ['죽어라!', '이거나 먹어라!', '받아라!', '돌격!', '아~ 해 봐!', '밑져야 본전이지...'];
const TALK2 = ['윽!', '으악!', '이런!', '다시 돌아오마...', '아이고!'];
const PERS = ['moron', 'shooter', 'poolshark', 'tosser', 'chooser', 'spoiler', 'cyborg', 'unknown'];
const DEFAULTS = {
  mode: 'SEQUENTIAL', teams: 'NONE', rounds: 10, turnLimitSec: 60, shopLimitSec: 90, interestRate: 0.05, cashAtStart: 0,
  computersBuy: true, freeMarket: false, scoringMode: 'STANDARD', airViscosity: 0, gravity: 0.2, suspendDirt: 0, tanksFall: true,
  bordersExtend: 75, wallEffect: 'NONE', sky: 'RANDOM', maxWind: 200, changingWind: false, hostileEnvironment: true, bumpiness: 20,
  slope: 20, flattenPeaks: false, randomLand: false, scannedMountains: 20, statusBar: false, playOrder: 'RANDOM', fastComputers: false,
  talkingTanks: 'COMPUTERS', talkProbability: 100, armsLevel: 4, bombIcon: 'BIG', tunneling: true, scale: 'NORMAL', tracePaths: false,
  extraDirt: false, uselessItems: false, impactDamage: true,
};
const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));

export class MockServer {
  constructor(deliver) {
    this.deliver = deliver; this.seq = 0; this.timers = new Set();
    this.me = null; this.room = null; this.game = null;
    this.fakeRooms = [
      { id: 'f1', title: '초보방 환영', players: 2, maxPlayers: 4, mode: 'SEQUENTIAL', status: 'waiting', locked: false, host: '탱크왕' },
      { id: 'f2', title: '핵폭탄 파티', players: 5, maxPlayers: 8, mode: 'SIMULTANEOUS', status: 'playing', locked: false, host: '포병대장' },
      { id: 'f3', title: '조용히 한 판', players: 3, maxPlayers: 3, mode: 'SYNCHRONOUS', status: 'waiting', locked: false, host: '바람계산' },
    ];
    this.every(4000, () => { // 실시간 갱신 시연
      const f = this.fakeRooms[0]; f.players = f.players >= f.maxPlayers ? 1 : f.players + 1;
      if (this.me && !this.room) this.send({ t: 'room_list', rooms: this.roomList() });
    });
  }
  now() { return Date.now(); }
  send(m) { const msg = { ...m }; if (!('serverTime' in msg) && /^(turn|shop_turn|round_start|game_start|welcome)$/.test(m.t)) msg.serverTime = this.now(); setTimeout(() => this.deliver(JSON.parse(JSON.stringify(msg))), 15); }
  after(ms, fn) { const h = setTimeout(() => { this.timers.delete(h); fn(); }, ms); this.timers.add(h); return h; }
  every(ms, fn) { setInterval(fn, ms); }
  cancel(h) { clearTimeout(h); this.timers.delete(h); }
  err(code, msg, ref) { this.send({ t: 'error', code, msg, ref }); }

  roomList() {
    const mine = this.room ? [{ id: this.room.id, title: this.room.title, players: this.room.members.length, maxPlayers: this.room.maxPlayers, mode: this.room.options.mode, status: this.room.phase, locked: false, host: this.me }] : [];
    return [...mine, ...this.fakeRooms];
  }

  handle(m) {
    try { this._handle(m); } catch (e) { console.error(e); this.err('INTERNAL', '서버 오류가 발생했습니다', m.ref); }
  }
  _handle(m) {
    const ref = m.ref;
    if (m.t === 'ping') return this.send({ t: 'pong', serverTime: this.now() });
    if (m.t === 'hello') {
      if (m.token && !m.nickname) return; // mock은 재접속 세션 없음
      const nick = String(m.nickname || '').trim();
      if (!/^[가-힣a-zA-Z0-9]{2,12}$/.test(nick)) return this.err('NICK_INVALID', '닉네임은 2~12자의 한글·영문·숫자만 쓸 수 있습니다', ref);
      if (['탱크왕', '포병대장', '바람계산'].includes(nick)) return this.err('NICK_TAKEN', '이미 사용 중인 닉네임입니다', ref);
      this.me = nick;
      this.send({ t: 'welcome', protocol: 1, token: 'mock-' + nick, nickname: nick, resumed: false, location: 'lobby', defaults: DEFAULTS, tanks: ['classic', 'fixed', 'heavy', 'scout', 'triple', 'wedge', 'wheeled'], personalities: PERS });
      return this.send({ t: 'room_list', rooms: this.roomList() });
    }
    if (!this.me) return this.err('NOT_LOGGED_IN', '먼저 닉네임을 입력하세요', ref);
    const room = this.room;
    switch (m.t) {
      case 'list_rooms': return this.send({ t: 'room_list', rooms: this.roomList() });
      case 'create_room': {
        const title = String(m.title || '').trim();
        if (!title || title.length > 30) return this.err('TITLE_INVALID', '방 제목은 1~30자로 입력하세요', ref);
        if (!(m.maxPlayers >= 2 && m.maxPlayers <= 10)) return this.err('MAX_PLAYERS_INVALID', '최대 인원은 2~10명입니다', ref);
        this.room = { id: 'r1', title, maxPlayers: m.maxPlayers, options: { ...DEFAULTS, ...(m.options || {}) }, phase: 'waiting', hostId: 'p1', members: [], chat: [], pseq: 1 };
        this.room.members.push({ id: 'p1', kind: 'human', name: this.me, slot: 0, ready: false, tank: 'classic', team: 1, personality: null });
        this.send({ t: 'room_joined', you: 'p1', room: this.roomState(), chat: [] });
        // 다른 사람 입장 시연
        this.after(2500, () => {
          if (!this.room || this.room.phase !== 'waiting' || this.room.members.length >= this.room.maxPlayers) return;
          this.addMember({ kind: 'human', name: '박공격', tank: 'heavy' });
          this.sys('JOIN', '박공격님이 입장했습니다'); this.broadcastRoom();
          this.after(2500, () => { const p = this.room?.members.find(x => x.name === '박공격'); if (p) { p.ready = true; this.chat(p, '준비!'); this.broadcastRoom(); } });
        });
        return;
      }
      case 'join_room': {
        const f = this.fakeRooms.find(r => r.id === m.roomId);
        if (!f) return this.err('ROOM_NOT_FOUND', '방을 찾을 수 없습니다', ref);
        if (f.status === 'playing') return this.err('ROOM_IN_GAME', '게임이 진행 중인 방입니다', ref);
        if (f.players >= f.maxPlayers) return this.err('ROOM_FULL', '방이 가득 찼습니다', ref);
        this.room = { id: f.id, title: f.title, maxPlayers: f.maxPlayers, options: { ...DEFAULTS, mode: f.mode }, phase: 'waiting', hostId: 'p1', members: [], chat: [], pseq: 0 };
        this.addMember({ kind: 'human', name: f.host, tank: 'wedge' });
        const me = this.addMember({ kind: 'human', name: this.me });
        this.addMember({ kind: 'computer', name: '컴퓨터1', personality: 'shooter', tank: 'triple' });
        this.myId = me.id;
        this.send({ t: 'room_joined', you: me.id, room: this.roomState(), chat: [] });
        this.sys('JOIN', `${this.me}님이 입장했습니다`); this.broadcastRoom();
        return;
      }
      case 'leave_room': if (!room) return this.err('NOT_IN_ROOM', '방에 들어가 있지 않습니다', ref); this.endGameTimers(); this.room = null; this.game = null; this.send({ t: 'room_left', reason: 'leave' }); return this.send({ t: 'room_list', rooms: this.roomList() });
      case 'ready': {
        const me = this.mine(); if (room.hostId === me.id) return this.err('HOST_NO_READY', '방장은 준비할 필요가 없습니다', ref);
        me.ready = !!m.ready; this.broadcastRoom();
        if (me.ready && room.hostId !== me.id) this.after(1500, () => { if (this.room && this.room.phase === 'waiting' && this.mine().ready) { this.sys('START', '게임을 시작합니다'); this.startGame(); } });
        return;
      }
      case 'set_options': {
        if (!this.isHost()) return this.err('NOT_HOST', '방장만 할 수 있습니다', ref);
        Object.assign(room.options, m.options || {});
        if (m.title) room.title = m.title; if (m.maxPlayers) room.maxPlayers = m.maxPlayers;
        room.members.forEach(p => { if (p.kind === 'human') p.ready = false; });
        this.sys('OPTIONS', '방 설정이 변경되었습니다'); return this.broadcastRoom();
      }
      case 'set_profile': {
        const me = this.mine();
        if (m.tank) { if (m.tank === 'triple' && me.kind === 'human') return this.err('TANK_INVALID', '선택할 수 없는 탱크 모양입니다', ref); me.tank = m.tank; }
        if (m.team) me.team = m.team;
        return this.broadcastRoom();
      }
      case 'add_computer': {
        if (!this.isHost()) return this.err('NOT_HOST', '방장만 할 수 있습니다', ref);
        if (room.members.length >= room.maxPlayers) return this.err('ROOM_FULL', '방이 가득 찼습니다', ref);
        const n = room.members.filter(x => x.kind === 'computer').length + 1;
        this.addMember({ kind: 'computer', name: '컴퓨터' + n, personality: m.personality || 'moron', tank: ['classic', 'wedge', 'heavy', 'wheeled', 'scout', 'triple'][n % 6] });
        this.sys('COMPUTER', '컴퓨터가 추가되었습니다'); return this.broadcastRoom();
      }
      case 'remove_computer': room.members = room.members.filter(x => x.id !== m.id); return this.broadcastRoom();
      case 'set_computer': { const c = room.members.find(x => x.id === m.id); if (c) c.personality = m.personality; return this.broadcastRoom(); }
      case 'kick': {
        if (!this.isHost()) return this.err('NOT_HOST', '방장만 할 수 있습니다', ref);
        const t = room.members.find(x => x.id === m.id); if (!t) return this.err('TARGET_NOT_FOUND', '대상을 찾을 수 없습니다', ref);
        room.members = room.members.filter(x => x !== t); this.sys('KICK', `${t.name}님이 강퇴되었습니다`); return this.broadcastRoom();
      }
      case 'start': {
        if (!this.isHost()) return this.err('NOT_HOST', '방장만 할 수 있습니다', ref);
        const c = this.canStart(); if (!c.ok) return this.err(c.code, c.msg, ref);
        this.sys('START', '게임을 시작합니다'); return this.startGame();
      }
      case 'chat': {
        const text = String(m.text || '').trim(); if (!text) return this.err('CHAT_EMPTY', '메시지를 입력하세요', ref);
        if (text.length > 200) return this.err('CHAT_TOO_LONG', '메시지는 200자까지 입력할 수 있습니다', ref);
        this.chat(this.mine(), text);
        if (room.members.some(x => x.name === '박공격') && Math.random() < 0.5) this.after(1200, () => { const p = this.room?.members.find(x => x.name === '박공격'); if (p) this.chat(p, 'ㅋㅋ 한 판 하자'); });
        return;
      }
      default: return this.gameMsg(m);
    }
  }

  mine() { return this.room.members.find(x => x.name === this.me); }
  isHost() { return this.room && this.room.hostId === this.mine().id; }
  addMember({ kind, name, tank = 'classic', personality = null }) {
    const used = new Set(this.room.members.map(x => x.slot)); let slot = 0; while (used.has(slot)) slot++;
    const p = { id: 'p' + (++this.room.pseq), kind, name, slot, ready: kind === 'computer', tank, team: (slot % 2) + 1, personality };
    this.room.members.push(p); return p;
  }
  canStart() {
    const r = this.room;
    if (r.members.length < 2) return { ok: false, code: 'START_NEED_PLAYERS', msg: '2명 이상이어야 시작할 수 있습니다' };
    if (r.members.some(m => m.kind === 'human' && m.id !== r.hostId && !m.ready)) return { ok: false, code: 'START_NOT_READY', msg: '준비하지 않은 참가자가 있습니다' };
    if (r.options.teams !== 'NONE' && new Set(r.members.map(m => m.team)).size < 2) return { ok: false, code: 'START_TEAMS', msg: '팀이 둘 이상이어야 시작할 수 있습니다' };
    return { ok: true };
  }
  roomState() {
    const r = this.room, slots = [];
    for (let i = 0; i < r.maxPlayers; i++) {
      const m = r.members.find(x => x.slot === i);
      slots.push(m ? { slot: i, id: m.id, kind: m.kind, name: m.name, ready: m.ready, tank: m.tank, team: m.team, color: i, personality: m.personality, connected: true, host: m.id === r.hostId } : { slot: i, empty: true });
    }
    return { id: r.id, title: r.title, maxPlayers: r.maxPlayers, status: r.phase, hostId: r.hostId, options: r.options, slots, start: this.canStart(), serverTime: this.now() };
  }
  broadcastRoom() { if (this.room) this.send({ t: 'room_state', room: this.roomState() }); }
  sys(key, text) { this.send({ t: 'chat', system: true, key, text, ts: this.now() }); }
  chat(p, text) { this.send({ t: 'chat', from: { id: p.id, name: p.name }, text, ts: this.now() }); }

  // ================= 게임 =================
  endGameTimers() { for (const h of this.timers) clearTimeout(h); this.timers.clear(); }

  startGame() {
    const r = this.room; r.phase = 'playing'; this.broadcastRoom();
    const seats = r.members.slice().sort((a, b) => a.slot - b.slot).map(m => ({ id: m.id, name: m.name, kind: m.kind, color: m.slot, tank: m.tank, team: m.team, personality: m.personality, proxy: false, connected: true }));
    const g = this.game = { seats, round: 0, rounds: Math.min(r.options.rounds, 3), opts: r.options, players: new Map() };
    for (const s of seats) {
      const human = s.kind === 'human' && s.name === this.me;
      g.players.set(s.id, {
        id: s.id, cash: r.options.cashAtStart || 0, score: 0,
        items: human ? { baby_missile: 99, missile: 5, baby_nuke: 2, nuke: 1, napalm: 3, mirv: 2, funky_bomb: 2, dirt_ball: 3, roller: 3, laser: 2, plasma_blast: 2, tracer: 5, battery: 3, shield: 2, force_shield: 1, parachute: 2, contact_trigger: 5, heat_guidance: 2, fuel_tank: 2 } : { baby_missile: 99, missile: 3, baby_nuke: 1 },
      });
    }
    this.send({ t: 'game_start', seats, options: r.options });
    this.after(300, () => (r.options.cashAtStart > 0 ? this.beginShop() : this.beginRound()));
  }

  inv(id) { const p = this.game.players.get(id); return { cash: p.cash, score: p.score, items: { ...p.items } }; }
  sendInv(interest) { const me = this.game.seats.find(s => s.name === this.me); if (!me) return; const t = this.game.tanks && this.T(me.id); this.send({ t: 'me', inventory: this.inv(me.id), tank: t ? { ...this.tankView(t), cash: this.game.players.get(me.id).cash } : null, ...(interest != null ? { interest } : {}), serverTime: this.now() }); }

  genTerrain() {
    const g = this.game, mask = new Uint8Array(W * H), ph = Math.random() * 10, amp = 50 + Math.random() * 60;
    for (let x = 0; x < W; x++) {
      const top = Math.round(H * 0.62 + Math.sin(x / W * 6.3 + ph) * amp * 0.9 + Math.sin(x / W * 17 + ph * 2) * 16 + Math.sin(x / W * 41 + ph) * 4);
      for (let y = Math.max(40, top); y < H; y++) mask[y * W + x] = 1;
    }
    g.mask = mask;
  }
  solid(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && x < W && y >= 0 && y < H && this.game.mask[y * W + x] === 1; }
  surface(x) { x = Math.max(0, Math.min(W - 1, Math.round(x))); for (let y = 0; y < H; y++) if (this.game.mask[y * W + x]) return y; return H; }
  colRLE(x) { const out = []; let y = 0; const m = this.game.mask; while (y < H) { if (!m[y * W + x]) { y++; continue; } let y1 = y; while (y1 + 1 < H && m[(y1 + 1) * W + x]) y1++; out.push(y, y1, 0x50); y = y1 + 1; } return out; }
  spansFor(x0, x1) { const s = []; for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) { s.push([x, 0, H - 1, 0]); const r = this.colRLE(x); for (let i = 0; i < r.length; i += 3) s.push([x, r[i], r[i + 1], r[i + 2]]); } return s; }
  circle(cx, cy, r, v) { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.game.mask[y * W + x] = v; }

  tankView(t) { return { id: t.id, name: t.name, colorIndex: t.color, tankType: t.tank, team: t.team, cpu: t.cpu, x: t.x, y: t.y, alive: t.alive, hp: t.hp, angle: t.angle, power: t.power, weapon: t.weapon, shield: t.shield, parachute: t.parachute, trigger: false, fuel: t.fuel, guidance: null, score: this.game.players.get(t.id).score }; }

  beginRound() {
    const g = this.game; g.round++; this.genTerrain();
    const skies = ['PLAIN', 'STORMY', 'STARS', 'SHADED', 'SUNSET', 'CAVERN', 'BLACK'];
    g.sky = g.opts.sky === 'RANDOM' ? skies[RI(0, 5)] : g.opts.sky;
    g.wall = ['RANDOM', 'ERRATIC'].includes(g.opts.wallEffect) ? 'NONE' : g.opts.wallEffect;
    g.wind = g.opts.maxWind ? RI(-g.opts.maxWind, g.opts.maxWind) : 0;
    const n = g.seats.length;
    g.tanks = g.seats.map((s, i) => {
      const x = Math.round((i + 0.5) * W / n + R(-12, 12));
      for (let xx = x - 6; xx <= x + 6; xx++) { const top = this.surface(x); for (let y = 0; y < H; y++) g.mask[y * W + Math.max(0, Math.min(W - 1, xx))] = y >= top ? 1 : 0; }
      return { id: s.id, name: s.name, color: s.color, tank: s.tank, team: s.team, cpu: s.kind === 'computer' ? s.personality : false, x, y: this.surface(x), alive: true, hp: 100, angle: x < W / 2 ? 45 : 135, power: 400, weapon: 'baby_missile', shield: null, parachute: { on: true, threshold: 5 }, fuel: 0 };
    });
    g.order = g.tanks.map(t => t.id).sort(() => Math.random() - 0.5); g.cursor = 0;
    const terrain = { w: W, h: H, cols: Array.from({ length: W }, (_, x) => this.colRLE(x)) };
    this.send({ t: 'round_start', round: g.round, rounds: g.rounds, info: { round: g.round, terrain, tanks: g.tanks.map(t => this.tankView(t)), wind: g.wind, wall: g.wall.toLowerCase(), sky: g.sky.toLowerCase(), order: g.order }, events: [] });
    this.sendInv(Math.round(g.players.get(g.seats.find(s => s.name === this.me)?.id)?.cash * g.opts.interestRate || 0));
    if (g.opts.mode === 'SIMULTANEOUS') { this.send({ t: 'turn', mode: 'sim', deadline: null, limitMs: null, auto: false }); this.simLoop(); }
    else this.after(500, () => this.nextTurn());
  }

  alive() { return this.game.tanks.filter(t => t.alive); }
  T(id) { return this.game.tanks.find(t => t.id === id); }

  nextTurn() {
    const g = this.game; if (!g) return;
    if (this.alive().length <= 1) return this.endRound();
    let pid = null;
    for (let k = 0; k < g.order.length * 2; k++) { const id = g.order[g.cursor % g.order.length]; g.cursor++; if (this.T(id).alive) { pid = id; break; } }
    const seat = g.seats.find(s => s.id === pid), events = [];
    if (g.sky === 'STORMY' && g.opts.hostileEnvironment && Math.random() < 0.35) { const x = RI(10, W - 10); events.push({ t: 'lightning', tick: 0, x, y: this.surface(x) }); }
    if (seat.kind === 'computer' || seat.name !== this.me) {
      g.turn = { mode: 'seq', playerId: pid, deadline: null, limitMs: null, auto: true };
      this.send({ t: 'turn', ...g.turn, events });
      g.turnTimer = this.after(g.opts.fastComputers ? 300 : 900, () => this.aiFire(pid));
    } else {
      const limitMs = g.opts.turnLimitSec * 1000;
      g.turn = { mode: 'seq', playerId: pid, deadline: this.now() + limitMs, limitMs, auto: false, timeouts: 0 };
      this.send({ t: 'turn', ...g.turn, events });
      g.turnTimer = this.after(limitMs, () => {
        g.turn = null; this.send({ t: 'toast', code: 'TURN_TIMEOUT', msg: `시간 초과! ${seat.name}님의 턴이 넘어갑니다`, params: { playerId: pid, name: seat.name } });
        // 서버와 같게: 연속 시간 초과 3회면 자동 후퇴(roomGame maxTimeouts)
        g.timeouts = g.timeouts || {}; g.timeouts[pid] = (g.timeouts[pid] || 0) + 1;
        if (g.timeouts[pid] >= 3) { g.timeouts[pid] = 0; const t = this.T(pid); t.alive = false; return this.afterShot(pid, this.retreatEvents(t, pid)); }
        this.nextTurn();
      });
    }
  }

  simLoop() {
    const g = this.game;
    g.simTimer = this.after(2500, () => {
      if (!this.game || g.phase === 'end') return;
      for (const s of g.seats) if (s.kind === 'computer' && this.T(s.id).alive && Math.random() < 0.6) { this.aiFire(s.id, true); break; }
      if (this.alive().length > 1) this.simLoop();
    });
  }

  aiFire(pid, sim = false) {
    const g = this.game, t = this.T(pid); if (!t || !t.alive) return;
    const foes = this.alive().filter(x => x.id !== pid);
    const tgt = foes[RI(0, foes.length - 1)];
    const dx = tgt.x - t.x, dir = dx >= 0 ? 1 : -1;
    const ang = 45 + RI(-8, 12), a = ang * Math.PI / 180;
    const g0 = 150, need = Math.sqrt(Math.abs(dx) * g0 / Math.sin(2 * a)) / 0.346;
    const power = Math.max(80, Math.min(t.hp * 10, Math.round(need * R(0.93, 1.07))));
    const inv = g.players.get(pid).items;
    const weapon = inv.baby_nuke > 0 && Math.random() < 0.15 ? 'baby_nuke' : inv.missile > 0 && Math.random() < 0.4 ? 'missile' : 'baby_missile';
    this.doFire(pid, { weapon, angle: dir > 0 ? ang : 180 - ang, power }, sim);
  }

  retreatEvents(t, pid) { return [{ t: 'retreat', tick: 0, tank: pid }, { t: 'death', tick: 20, tank: pid, x: t.x, y: t.y, retreat: true }, { t: 'explode', tick: 30, x: t.x, y: t.y - 3, r: 12, kind: 'death', dur: 35 }]; }

  gameMsg(m) {
    const g = this.game; if (!g) return this.err('NOT_IN_GAME', '게임 중이 아닙니다', m.ref);
    const meSeat = g.seats.find(s => s.name === this.me), pid = meSeat.id, ref = m.ref;
    switch (m.t) {
      case 'aim': return;
      case 'fire': {
        if (g.opts.mode !== 'SIMULTANEOUS') {
          if (!g.turn || g.turn.playerId !== pid) return this.err('NOT_YOUR_TURN', '당신의 턴이 아닙니다', ref);
          if (g.turn.deadline && this.now() > g.turn.deadline) return this.err('TURN_EXPIRED', '제한시간이 지났습니다', ref);
        }
        const t = this.T(pid);
        if (!(m.power >= 0 && m.power <= t.hp * 10)) return this.err('ENGINE_REJECT', '파워가 범위를 벗어났습니다', ref);
        const inv = g.players.get(pid).items;
        if (!(inv[m.weapon] > 0)) return this.err('ENGINE_REJECT', '보유하지 않은 무기입니다', ref);
        if (g.turnTimer) this.cancel(g.turnTimer);
        if (g.timeouts) g.timeouts[pid] = 0;
        return this.doFire(pid, m, g.opts.mode === 'SIMULTANEOUS');
      }
      case 'retreat': {
        if (!g.turn || g.turn.playerId !== pid) return this.err('NOT_YOUR_TURN', '당신의 턴이 아닙니다', ref);
        if (g.turnTimer) this.cancel(g.turnTimer);
        const t = this.T(pid); t.alive = false;
        return this.afterShot(pid, this.retreatEvents(t, pid));
      }
      case 'act': {
        const t = this.T(pid), inv = g.players.get(pid).items, events = [];
        if (m.action === 'battery') {
          if (!(inv.battery > 0)) return this.err('ENGINE_REJECT', '배터리가 없습니다', ref);
          if (t.hp >= 100) return this.err('ENGINE_REJECT', '에너지가 가득 찼습니다', ref);
          inv.battery--; t.hp = Math.min(100, t.hp + 10); events.push({ t: 'hp', tick: 0, tank: pid, hp: t.hp, delta: 10, src: 'battery' });
        } else if (m.action === 'shield') {
          if (m.item) { if (!(inv[m.item] > 0)) return this.err('ENGINE_REJECT', '보유하지 않은 아이템입니다', ref); inv[m.item]--; const hp = { mag_deflector: 55, heavy_shield: 150, super_mag: 200 }[m.item] || 100; t.shield = { item: m.item, hp }; events.push({ t: 'shield', tick: 0, tank: pid, item: m.item, hp, kind: 'on' }); }
          else if (t.shield) { events.push({ t: 'shield', tick: 0, tank: pid, item: t.shield.item, hp: 0, kind: 'off' }); t.shield = null; }
        } else if (m.action === 'parachute') { t.parachute = { on: !!m.on, threshold: m.threshold ?? t.parachute.threshold };
        } else if (m.action === 'trigger') { if (m.on && !(inv.contact_trigger > 0)) return this.err('ENGINE_REJECT', '컨택트 트리거가 없습니다', ref);
        } else if (m.action === 'guidance') { if (m.type && !(inv[{ heat: 'heat_guidance', ballistic: 'ballistic_guidance', horz: 'horz_guidance', vert: 'vert_guidance', lazy: 'lazy_boy' }[m.type]] > 0)) return this.err('ENGINE_REJECT', '보유하지 않은 유도 장치입니다', ref);
        } else if (m.action === 'move') {
          if (t.tank === 'fixed') return this.err('ENGINE_REJECT', '고정 포대는 이동할 수 없습니다', ref);
          if (t.fuel <= 0) { if (inv.fuel_tank > 0) { inv.fuel_tank--; t.fuel += 10; } else return this.err('ENGINE_REJECT', '연료가 없습니다', ref); }
          const nx = Math.max(5, Math.min(W - 6, t.x + (m.dir < 0 ? -1 : 1) * (m.steps || 1)));
          const ny = this.surface(nx);
          if (t.y - ny > 4) return this.err('ENGINE_REJECT', '너무 가파릅니다', ref);
          t.fuel--; const y0 = t.y; t.x = nx; t.y = ny;
          if (ny > y0 + 1) events.push({ t: 'tankFall', tick: 0, tank: pid, x: nx, y0, y1: ny, ticks: ny - y0, chute: false, dmg: 0 });
          this.send({ t: 'act_result', playerId: pid, events, state: { ok: true, x: t.x, y: t.y, fuel: t.fuel, events } });
          return this.sendInv();
        }
        this.send({ t: 'act_result', playerId: pid, events, state: { ok: true, tank: this.tankView(t) } });
        return this.sendInv();
      }
      case 'buy': {
        if (!g.shop || g.shop.playerId !== pid) return this.err('NOT_YOUR_SHOP', '지금은 당신의 상점 차례가 아닙니다', ref);
        const it = PRICE.get(m.item), p = g.players.get(pid);
        if (!it) return this.err('INVALID_INPUT', '입력 값이 올바르지 않습니다', ref);
        if (p.cash < it.price) return this.err('ENGINE_REJECT', '현금이 부족합니다', ref);
        const owned = p.items[m.item] || 0; if (owned >= 99) return this.err('ENGINE_REJECT', '보유 한도(99개)입니다', ref);
        const add = Math.min(it.bundle, 99 - owned), cost = add < it.bundle ? Math.round(it.price / it.bundle * add * 1.2) : it.price;
        p.cash -= cost; p.items[m.item] = owned + add;
        return this.send({ t: 'shop_result', ok: true, action: 'buy', item: m.item, qty: 1, state: { cost, added: add, cash: p.cash }, snapshot: { inventory: this.inv(pid) } });
      }
      case 'sell_quote': {
        if (!g.shop || g.shop.playerId !== pid) return this.err('NOT_YOUR_SHOP', '지금은 당신의 상점 차례가 아닙니다', ref);
        if (m.item === 'baby_missile') return this.err('ENGINE_REJECT', '베이비 미사일은 팔 수 없습니다', ref);
        const p = g.players.get(pid); if ((p.items[m.item] || 0) < m.qty) return this.err('ENGINE_REJECT', '보유 수량이 부족합니다', ref);
        const it = PRICE.get(m.item); g.pending = { item: m.item, qty: m.qty, quote: Math.round(it.price / it.bundle * m.qty * 0.8) };
        return this.send({ t: 'sell_quote', item: m.item, qty: m.qty, quote: g.pending.quote });
      }
      case 'sell_accept': case 'sell_reject': {
        if (!g.pending) return this.err('WRONG_PHASE', '지금은 할 수 없는 행동입니다', ref);
        const p = g.players.get(pid);
        if (m.t === 'sell_accept') { p.items[g.pending.item] -= g.pending.qty; p.cash += g.pending.quote; }
        g.pending = null;
        return this.send({ t: 'shop_result', ok: true, action: m.t === 'sell_accept' ? 'sell' : 'sell_reject', snapshot: { inventory: this.inv(pid) } });
      }
      case 'shop_done': if (!g.shop || g.shop.playerId !== pid) return this.err('NOT_YOUR_SHOP', '지금은 당신의 상점 차례가 아닙니다', ref); this.cancel(g.shopTimer); return this.nextShop();
      default: return this.err('UNKNOWN_TYPE', '알 수 없는 요청입니다', ref);
    }
  }

  // ---- 시연용 탄도 계산 → ENGINE_API 이벤트 ----
  doFire(pid, input, sim) {
    const g = this.game, t = this.T(pid), w = input.weapon, inv = g.players.get(pid).items;
    if (w !== 'baby_missile') inv[w] = Math.max(0, (inv[w] || 0) - 1);
    t.angle = input.angle; t.power = input.power; t.weapon = w;
    const a = input.angle * Math.PI / 180, mx = t.x + Math.cos(a) * 4, my = t.y - 5 - Math.sin(a) * 4;
    const ev = [{ t: 'fire', tick: 0, pid, weapon: w, x: Math.round(mx), y: Math.round(my), angle: input.angle, power: input.power }];
    const talk = g.opts.talkingTanks === 'ALL' || (g.opts.talkingTanks === 'COMPUTERS' && t.cpu);
    if (talk && Math.random() < 0.5) ev.push({ t: 'talk', tick: 0, tank: pid, text: TALK1[RI(0, TALK1.length - 1)] });
    const dmg = new Map();
    let tick = 2;
    if (w === 'laser') {
      const x1 = mx + Math.cos(a) * 600, y1 = my - Math.sin(a) * 600;
      ev.push({ t: 'laser', tick, pid, x0: Math.round(mx), y0: Math.round(my), x1: Math.round(x1), y1: Math.round(y1) });
      for (const o of this.alive()) if (o.id !== pid) { const d = Math.abs((x1 - mx) * (my - (o.y - 3)) - (mx - o.x) * (y1 - my)) / 600; if (d < 6) dmg.set(o.id, (dmg.get(o.id) || 0) + 20 + 10 * (input.batteries || 0)); }
      return this.resolve(pid, ev, dmg, tick + 22, sim);
    }
    if (w === 'plasma_blast') {
      const r = 10 + 7 * (input.batteries || 0);
      ev.push({ t: 'explode', tick, pid, x: t.x, y: t.y - 3, r, kind: 'plasma', dur: 30 });
      this.damageAround(t.x, t.y - 3, r + 4, 50, dmg, pid);
      return this.resolve(pid, ev, dmg, tick + 30, sim);
    }
    const shoot = (x, y, vx, vy, start, wpn) => {
      const pts = [], gv = 150, wind = g.wind * 0.05, dt = 0.02; let k = 0, end = 'out', apex = null;
      while (k < 1500) {
        pts.push(Math.round(x), Math.round(y));
        const pvy = vy; vx += wind * dt; vy += gv * dt; x += vx * dt; y += vy * dt; k++;
        if (pvy < 0 && vy >= 0 && !apex) apex = { x, y, vx, idx: k };
        if (x < -g.opts.bordersExtend || x > W + g.opts.bordersExtend || y > H) { end = 'out'; break; }
        if (this.solid(x, y)) { end = 'ground'; break; }
        const hitT = this.alive().find(o => Math.abs(o.x - x) <= 4 && y >= o.y - 6 && y <= o.y && (o.id !== pid || k > 15));
        if (hitT) { end = 'tank'; break; }
      }
      return { pts, end, x, y, apex, ticks: k, start };
    };
    const v = input.power * 0.346;
    const main = shoot(mx, my, Math.cos(a) * v, -Math.sin(a) * v, tick, w);
    const kind = w === 'baby_nuke' || w === 'nuke' ? 'nuke' : ['dirt_clod', 'dirt_ball', 'ton_of_dirt'].includes(w) ? 'dirt' : w === 'funky_bomb' ? 'funky' : 'missile';
    const radius = { baby_missile: 10, missile: 20, baby_nuke: 40, nuke: 75, dirt_clod: 20, dirt_ball: 35, ton_of_dirt: 70, funky_bomb: 20, mirv: 20, roller: 20, napalm: 6, tracer: 0 }[w] ?? 15;
    if (w === 'mirv' && main.apex) {
      const cut = main.apex.idx; ev.push({ t: 'proj', tick, id: 1, pid, weapon: w, pts: main.pts.slice(0, cut * 2), end: 'apex' });
      ev.push({ t: 'split', tick: tick + cut, id: 1, children: [2, 3, 4, 5, 6], x: Math.round(main.apex.x), y: Math.round(main.apex.y) });
      let last = tick + cut;
      [-40, -20, 0, 20, 40].forEach((dv, i) => {
        const c = shoot(main.apex.x, main.apex.y, main.apex.vx + dv, 0, tick + cut, 'missile');
        ev.push({ t: 'proj', tick: tick + cut, id: 2 + i, pid, weapon: 'missile', pts: c.pts, end: c.end });
        if (c.end !== 'out') this.boom(ev, pid, c.x, c.y, 20, 'missile', tick + cut + c.ticks, dmg, false);
        last = Math.max(last, tick + cut + c.ticks);
      });
      return this.resolve(pid, ev, dmg, last + 35, sim);
    }
    ev.push({ t: 'proj', tick, id: 1, pid, weapon: w, pts: main.pts, end: main.end });
    let endTick = tick + main.ticks;
    if (main.end !== 'out' && w !== 'tracer' && w !== 'smoke_tracer') {
      if (w === 'roller' && main.end === 'ground') {
        let x = main.x, dir = this.surface(x - 2) > this.surface(x + 2) ? -1 : 1; const pts = [];
        for (let i = 0; i < 120; i++) { const y = this.surface(x) - 2; pts.push(Math.round(x), y); const nx = x + dir; if (this.surface(nx) < this.surface(x) - 1 || nx < 2 || nx > W - 3 || this.alive().some(o => Math.abs(o.x - nx) < 4)) break; x = nx; }
        ev.push({ t: 'roller', tick: endTick, id: 2, pid, pts, x: Math.round(x), y: this.surface(x) });
        endTick += pts.length / 2; this.boom(ev, pid, x, this.surface(x) - 2, radius, 'missile', endTick, dmg, false);
      } else if (w === 'napalm') {
        const pix = []; for (let dx = -14; dx <= 14; dx += 2) { const xx = Math.round(main.x + dx); pix.push(xx, this.surface(xx) - 1); }
        ev.push({ t: 'napalm', tick: endTick, kind: 'napalm', pixels: pix, records: [], dur: 110 });
        this.damageAround(main.x, main.y, 18, 30, dmg, pid); endTick += 110;
      } else if (kind === 'funky') {
        this.boom(ev, pid, main.x, main.y, radius, 'funky', endTick, dmg, false);
        for (let i = 0; i < 6; i++) { const xx = main.x + R(-40, 40); this.boom(ev, pid, xx, this.surface(xx), 14, 'funky', endTick + 4 + i * 4, dmg, false); }
        endTick += 30;
      } else {
        this.boom(ev, pid, main.x, main.y, radius, kind, endTick, dmg, kind === 'dirt');
      }
    }
    return this.resolve(pid, ev, dmg, endTick + (kind === 'nuke' ? 110 : 35), sim);
  }

  damageAround(x, y, rr, base, dmg, pid) {
    for (const o of this.alive()) { const d = Math.hypot(o.x - x, o.y - 3 - y); if (d < rr) dmg.set(o.id, (dmg.get(o.id) || 0) + Math.round(base * (1 - d / rr) + 5)); }
  }
  boom(ev, pid, x, y, r, kind, tick, dmg, add) {
    x = Math.round(x); y = Math.round(y);
    ev.push({ t: 'explode', tick, pid, x, y, r, kind, dur: kind === 'nuke' ? 110 : 35 });
    this.circle(x, y, r, add ? 1 : 0);
    ev.push({ t: 'terrain', tick: tick + 2, spans: this.spansFor(x - r - 1, x + r + 1) });
    if (!add) this.damageAround(x, y, r + 6, Math.min(95, 40 + r * 1.5), dmg, pid);
  }

  resolve(pid, ev, dmg, tick, sim) {
    const g = this.game;
    for (const [id, d] of dmg) {
      const o = this.T(id); if (!o.alive) continue;
      let left = d;
      if (o.shield) { const s = Math.min(o.shield.hp, left); o.shield.hp -= s; left -= s; ev.push({ t: 'hit', tick, tank: id, kind: 'shieldDirect', x: o.x, y: o.y }); if (o.shield.hp <= 0) { ev.push({ t: 'shield', tick, tank: id, item: o.shield.item, hp: 0, kind: 'break' }); o.shield = null; } }
      o.hp = Math.max(0, o.hp - left);
      ev.push({ t: 'hp', tick, tank: id, hp: o.hp, delta: -left, shield: o.shield?.hp ?? 0, shieldDelta: 0, src: pid });
      if (id !== pid) g.players.get(pid).score += Math.round(left);
      if (o.hp <= 0) {
        o.alive = false; ev.push({ t: 'death', tick: tick + 3, tank: id, killer: pid, x: o.x, y: o.y });
        if (o.cpu && Math.random() < 0.6 && g.opts.talkingTanks !== 'OFF') ev.push({ t: 'talk', tick: tick + 3, tank: id, text: TALK2[RI(0, TALK2.length - 1)] });
        if (id !== pid) g.players.get(pid).score += 500;
      }
    }
    // 탱크 낙하
    let t2 = tick + 6;
    for (const o of g.tanks) {
      if (!o.alive) continue;
      const ny = this.surface(o.x);
      if (ny > o.y + 1) {
        const dy = ny - o.y, chute = o.parachute?.on && dy > 6;
        ev.push({ t: 'tankFall', tick: t2, tank: o.id, x: o.x, y0: o.y, y1: ny, ticks: dy, chute, dmg: chute ? 0 : Math.floor(dy / 4) });
        if (!chute && dy > 4) { o.hp = Math.max(0, o.hp - Math.floor(dy / 4)); ev.push({ t: 'hp', tick: t2 + dy, tank: o.id, hp: o.hp, delta: -Math.floor(dy / 4), kind: 'fall' }); if (o.hp <= 0) { o.alive = false; ev.push({ t: 'death', tick: t2 + dy, tank: o.id, x: o.x, y: ny }); } }
        o.y = ny;
      }
    }
    if (this.alive().length <= 1) ev.push({ t: 'roundEnd', tick: t2 + 10, winners: this.alive().map(x => x.id) });
    ev.sort((a, b) => a.tick - b.tick);
    if (sim) { this.send({ t: 'shot', playerId: pid, events: ev, state: this.stateDelta() }); this.sendInv(); if (this.alive().length <= 1) { g.phase = 'end'; this.after(shotDuration(ev) * 1000 + 800, () => this.endRound()); } return; }
    return this.afterShot(pid, ev);
  }
  stateDelta() { const g = this.game, tanks = {}, players = {}; for (const t of g.tanks) tanks[t.id] = { x: t.x, y: t.y, hp: t.hp, alive: t.alive, shield: t.shield }; for (const [id, p] of g.players) players[id] = { score: p.score }; return { tanks, players, wind: g.wind }; }

  afterShot(pid, ev) {
    const g = this.game; g.turn = null;
    this.send({ t: 'shot', playerId: pid, events: ev, state: this.stateDelta() });
    this.sendInv();
    this.after(shotDuration(ev) * 1000 + 800, () => this.nextTurn());
  }

  endRound() {
    const g = this.game; if (!g || g.phase === 'roundEnd') return;
    g.phase = 'roundEnd'; this.endGameTimersExcept();
    const winners = this.alive().map(t => t.id), payouts = {};
    for (const [id, p] of g.players) { const pay = (winners.includes(id) ? 8000 : 2000) + p.score * 20; p.cash += pay; payouts[id] = pay; }
    const ranking = this.ranking();
    this.send({ t: 'round_end', round: g.round, events: [], state: { round: g.round, winners, payouts, scores: [...g.players.values()].map(p => ({ id: p.id, score: p.score })), gameOver: g.round >= g.rounds, ranking: ranking.map(({ cash, ...r }) => r) }, ranking: ranking.map(({ cash, ...r }) => r) });
    this.sendInv();
    this.after(4000, () => { g.phase = null; if (g.round >= g.rounds) this.gameOver(); else this.beginShop(); });
  }
  endGameTimersExcept() { for (const h of this.timers) clearTimeout(h); this.timers.clear(); }
  ranking() { const g = this.game; return g.seats.map(s => { const p = g.players.get(s.id); return { id: s.id, name: s.name, score: p.score, cash: p.cash }; }).sort((a, b) => b.score - a.score); }

  gameOver() {
    this.send({ t: 'game_over', ranking: this.ranking() });
    this.after(8000, () => {
      if (!this.room) return;
      this.room.phase = 'waiting'; this.game = null;
      this.room.members.forEach(m => { if (m.kind === 'human' && m.id !== this.room.hostId) m.ready = false; });
      this.send({ t: 'back_to_room' }); this.broadcastRoom();
    });
  }

  shopList(pid) {
    const p = this.game.players.get(pid), arms = this.game.opts.armsLevel;
    return [...PRICE.values()].filter(it => it.arms <= arms).map(it => ({ id: it.id, price: it.price, bundle: it.bundle, unitPrice: it.price / it.bundle, owned: p.items[it.id] || 0, arms: it.arms, allowed: true, affordable: p.cash >= it.price }));
  }
  beginShop() {
    const g = this.game; g.shopQueue = g.seats.map(s => s.id).filter(id => g.players.get(id).cash > 0); this.nextShop();
  }
  nextShop() {
    const g = this.game; g.shop = null; g.pending = null;
    while (g.shopQueue.length) {
      const pid = g.shopQueue.shift(), seat = g.seats.find(s => s.id === pid);
      if (seat.kind === 'computer') continue; // 컴퓨터는 즉시 구매(시연: 생략)
      if (seat.name !== this.me) { // 다른 사람 차례: '구매 중' 대기 화면 시연(4초 뒤 끝냄)
        g.shop = { playerId: pid, deadline: this.now() + 4000, limitMs: 4000 };
        this.send({ t: 'shop_turn', ...g.shop });
        g.shopTimer = this.after(4000, () => this.nextShop());
        return;
      }
      const limitMs = g.opts.shopLimitSec * 1000;
      g.shop = { playerId: pid, deadline: this.now() + limitMs, limitMs };
      this.send({ t: 'shop_turn', ...g.shop }); this.sendInv();
      g.shopTimer = this.after(limitMs, () => { this.send({ t: 'toast', code: 'SHOP_TIMEOUT', msg: `상점 시간 초과! ${seat.name}님의 구매가 종료됩니다`, params: { playerId: pid, name: seat.name } }); this.nextShop(); });
      return;
    }
    this.send({ t: 'shop_end' });
    this.after(200, () => this.beginRound());
  }
}
