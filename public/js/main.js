// 앱 진입점: 에셋 로드 → 연결 → 화면 라우팅(닉네임 → 방 목록 → 대기실 → 게임 → 대기실)
import { net } from './net.js';
import { loadAssets, warmup } from './game/assets.js';
import { toast, announce, closeTop, isOverlayOpen } from './ui.js';
import { ERR } from './i18n.js';
import { $ } from './util.js';
import * as Nick from './screens/nick.js';
import * as Lobby from './screens/lobby.js';
import * as Room from './screens/room.js';
import * as Game from './screens/game.js';

export const app = {
  nick: null, you: null, rooms: [], room: null, chat: [], welcome: null,
  view: null, screen: null,
  go(name, data) {
    const mods = { nick: Nick, lobby: Lobby, room: Room, game: Game };
    if (this.screen && this.screen.unmount) this.screen.unmount();
    while (isOverlayOpen()) closeTop();
    const root = $('#app'); root.innerHTML = '';
    this.view = name;
    this.screen = mods[name].mount(root, this, data) || {};
    document.body.dataset.view = name;
  },
};
window.__app = app; window.__net = net; // 디버그·검증용

function errText(m) { return m.msg || ERR[m.code] || ERR.UNKNOWN; }

function wire() {
  net.on('error', m => {
    if (m.code === 'DISCONNECTED') return toast(ERR.DISCONNECTED, 'error');
    if (m.code === 'NICK_INVALID' && net.tokenHello) { net.tokenHello = false; net.forgetToken(); if (app.view !== 'nick') app.go('nick'); return; } // 만료된 세션 토큰
    toast(errText(m), 'error');
    app.screen?.onError?.(m);
    if (m.code === 'SESSION_REPLACED') { net.forgetToken(); app.go('nick'); }
  });
  net.on('toast', m => toast(m.msg || ERR[m.code] || '', m.code?.includes('TIMEOUT') || m.code === 'IDLE_RETREAT' ? 'warn' : 'info'));
  net.on('close', ({ was }) => { if (was) toast(ERR.DISCONNECTED, 'error'); });
  net.on('welcome', m => {
    app.welcome = m; app.nick = m.nickname;
    if (m.location === 'lobby' && app.view !== 'lobby') app.go('lobby');
  });
  net.on('room_list', m => { app.rooms = m.rooms || []; if (app.view === 'lobby') app.screen.update?.(); });
  net.on('room_joined', m => { app.you = m.you; app.room = m.room; app.chat = m.chat || []; app.go('room'); });
  net.on('room_state', m => {
    app.room = m.room;
    if (app.view === 'room') app.screen.update?.();
    else if (app.view === 'game') app.screen.onRoom?.(m.room);
  });
  net.on('room_left', m => {
    app.room = null; app.chat = [];
    if (m.reason === 'closed') toast('방이 닫혔습니다', 'warn');
    if (app.view !== 'lobby') app.go('lobby');
  });
  net.on('kicked', m => toast(m.msg || ERR.KICKED, 'error'));
  net.on('chat', m => {
    app.chat.push(m); if (app.chat.length > 100) app.chat.shift();
    app.screen?.onChat?.(m);
    if (m.system && m.key === 'HOST') announce(m.text);
  });
  net.on('game_start', m => app.go('game', { start: m }));
  net.on('game_resume', m => app.go('game', { resume: m }));
  net.on('back_to_room', () => { if (app.view === 'game') app.screen.onBackToRoom?.(); else if (app.room) app.go('room'); });
}

async function boot() {
  const root = $('#app');
  root.innerHTML = '<div class="nick-screen"><div class="muted">불러오는 중…</div></div>';
  try { await loadAssets(); } catch (e) { console.error(e); toast('리소스를 불러오지 못했습니다', 'error'); return; }
  warmup();
  wire();
  await net.connect();
  if (!(net.token && !net.mock)) app.go('nick');
  else setTimeout(() => { if (!app.view) app.go('nick'); }, 1500);
}
boot();
