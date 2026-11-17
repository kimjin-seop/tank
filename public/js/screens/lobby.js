// 방 목록(실시간) + 방 만들기 모달 (SPEC 5.3·5.4)
import { h, clear } from '../util.js';
import { openLayer, toast } from '../ui.js';
import { net } from '../net.js';
import { MODE, ROOM_STATE } from '../i18n.js';
import { defaultOptions } from '../options.js';
import { optionsForm } from './optionsForm.js';

export function mount(root, app) {
  const list = h('div.room-list', { role: 'list', 'aria-label': '방 목록' });
  const screen = h('div.screen',
    h('header.topbar', h('span.brand', '스코치드 어스'), h('div.spacer'), h('span.muted', '닉네임: '), h('b', app.nick || ''),
      h('button.icon-btn', { type: 'button', 'aria-label': '새로고침', title: '새로고침', onclick: () => net.send('list_rooms') }, '↻')),
    h('div.content',
      h('div.room-head', h('h1', '방 목록'), h('div.spacer'), h('button.btn.primary', { type: 'button', onclick: () => openCreate(app) }, '방 만들기')),
      list));
  root.append(screen);
  net.send('list_rooms');
  const iv = setInterval(() => { if (!net.mock) net.send('list_rooms'); }, 15000); // 푸시 누락 대비

  function update() {
    clear(list);
    if (!app.rooms.length) {
      list.append(h('div.empty.card', h('p', '방이 없습니다'), h('button.btn.primary', { type: 'button', onclick: () => openCreate(app) }, '방 만들기')));
      return;
    }
    for (const r of app.rooms) {
      const full = r.players >= r.maxPlayers, playing = r.status === 'playing';
      const btn = h('button.card.room-row', {
        type: 'button', role: 'listitem', disabled: full || playing,
        'aria-label': `${r.title}, ${r.players}/${r.maxPlayers}명, ${MODE[r.mode] || r.mode}, ${ROOM_STATE[r.status] || r.status}${full ? ', 가득 참' : ''}`,
        onclick: () => net.send('join_room', { roomId: r.id }),
      },
        h('div', { style: { minWidth: 0 } }, h('div.t', r.locked ? '🔒 ' : '', r.title), h('div.h', r.host ? '방장 ' + r.host : '')),
        h('span.tabular', `${r.players}/${r.maxPlayers}`),
        h('span.badge.hide-m', MODE[r.mode] || r.mode),
        h('span.badge' + (playing ? '.off' : '.ready'), ROOM_STATE[r.status] || r.status),
        h('span.hide-m.muted', full && !playing ? '가득 참' : ''));
      list.append(btn);
    }
  }
  update();
  return { update, unmount: () => clearInterval(iv) };
}

function openCreate(app) {
  const f = optionsForm({ title: `${app.nick || ''}의 방`.slice(0, 30), maxPlayers: 4, options: { ...defaultOptions(), ...(app.welcome?.defaults || {}) } });
  const layer = openLayer({
    title: '방 만들기', kind: 'modal', className: 'wide', body: f.el,
    actions: [
      { label: '취소' },
      { label: '만들기', primary: true, onClick: () => {
        const v = f.value();
        if (!v.title) { toast('방 제목은 1~30자로 입력하세요', 'error'); return false; }
        net.send('create_room', v);
        return true;
      } },
    ],
  });
  return layer;
}
