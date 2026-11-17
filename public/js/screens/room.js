// 대기실 (SPEC 5.5): 슬롯, 준비, 시작(방장), 컴퓨터 추가·성향, 탱크 모양 카드, 팀, 채팅, 강퇴, 설정
import { h, clear } from '../util.js';
import { openLayer, confirmDialog, toast } from '../ui.js';
import { net } from '../net.js';
import { MODE, PERSONALITY, PERSONALITY_ORDER, PERSONALITY_HINT, TEAMS } from '../i18n.js';
import { A, drawTankPreview, bitmap } from '../game/assets.js';
import { OPTION_TABS, fmtValue } from '../options.js';
import { optionsForm } from './optionsForm.js';

export function mount(root, app) {
  const titleEl = h('h1.grow', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
  const sub = h('div.opt-summary');
  const slotsEl = h('div.slots', { role: 'list', 'aria-label': '참가자' });
  const log = h('div.chat-log', { role: 'log', 'aria-live': 'polite', 'aria-label': '채팅' });
  const input = h('input', { type: 'text', maxLength: 120, placeholder: '메시지', 'aria-label': '채팅 입력', autocomplete: 'off' });
  const form = h('form.chat-form', { onsubmit: e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; net.send('chat', { text: t }); input.value = ''; } }, input, h('button.btn', { type: 'submit' }, '전송'));
  const settingsBtn = h('button.btn.small', { type: 'button', onclick: () => openSettings(app) }, '설정');
  const readyBtn = h('button.btn', { type: 'button', onclick: () => { const me = mySlot(); net.send('ready', { ready: !me?.ready }); } }, '준비');
  // 시작 불가 상태에서도 클릭·키보드 입력은 받는다(aria-disabled) → 사유는 토스트로
  const startBtn = h('button.btn.primary', { type: 'button', onclick: () => {
    const st = app.room?.start || { ok: false };
    if (st.ok) net.send('start'); else if (st.msg) toast(st.msg, 'error');
  } }, '시작');
  const leaveBtn = h('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog('방에서 나갈까요?', { okLabel: '나가기' })) net.send('leave_room'); } }, '나가기');

  root.append(h('div.screen',
    h('header.topbar', titleEl, settingsBtn),
    h('div.content',
      h('div.room-grid',
        h('section', { 'aria-label': '참가자 슬롯' }, h('div', { style: { marginBottom: '10px' } }, sub), slotsEl),
        h('section.card.chat', { 'aria-label': '채팅' }, h('div.layer-head', h('h2', '채팅')), log, form))),
    h('footer.bottombar', leaveBtn, h('div.spacer'), readyBtn, startBtn)));

  const mySlot = () => app.room?.slots.find(s => s.id === app.you);
  const isHost = () => app.room?.hostId === app.you;

  // 탱크 구분: 입장 시 내 탱크가 기본(표준형)이면 슬롯 번호 순으로 다른 모양을 한 번 자동 선택(사람만 변경 가능, 트리플·고정 포대 제외)
  const AUTO_TANKS = ['classic', 'wedge', 'heavy', 'wheeled', 'scout'];
  let autoTankDone = false;
  function autoTank() {
    if (autoTankDone) return; const me = mySlot(); if (!me) return;
    autoTankDone = true;
    const allowed = (app.welcome?.humanTanks || AUTO_TANKS).filter(t => AUTO_TANKS.includes(t));
    const want = allowed[me.slot % allowed.length];
    if ((me.tank || 'classic') === 'classic' && want && want !== 'classic') net.send('set_profile', { tank: want });
  }
  function update() {
    const r = app.room; if (!r) return;
    autoTank();
    titleEl.textContent = r.title;
    clear(sub);
    const o = r.options || {};
    const chips = [`${MODE[o.mode] || o.mode}`, `라운드 ${o.rounds}`, `턴 ${o.turnLimitSec}초`, `상점 ${o.shopLimitSec}초`];
    if (o.teams && o.teams !== 'NONE') chips.push('팀 ' + TEAMS[o.teams]);
    sub.append(...chips.map(c => h('span.badge', c)));
    clear(slotsEl);
    const host = isHost();
    let canAdd = true;
    for (const s of r.slots) {
      const n = (s.color ?? s.slot) + 1;
      const marker = h('img.marker', { src: `/assets/tanks/marker_${String(Math.min(10, n)).padStart(2, '0')}.svg`, alt: `${n}번` });
      if (s.empty) {
        const add = host ? h('button.btn.small', { type: 'button', onclick: () => net.send('add_computer', { personality: 'moron' }) }, '컴퓨터 추가') : null;
        slotsEl.append(h('div.card.slot.empty', { role: 'listitem' }, marker, h('span.muted', '빈 자리'), h('div.slot-actions', canAdd ? add : null)));
        canAdd = false; // 빈 자리 중 첫 칸에만 버튼
        continue;
      }
      const cv = h('canvas', { 'aria-hidden': 'true' });
      const meta = h('div.meta');
      if (s.host) meta.append(h('span.badge.host', '방장'));
      if (s.kind === 'computer') meta.append(h('span.badge.cpu', '컴퓨터'));
      else if (!s.host) meta.append(h('span.badge' + (s.ready ? '.ready' : ''), s.ready ? '준비 완료' : '대기'));
      if (s.connected === false) meta.append(h('span.badge.off', '연결 끊김'));
      meta.append(h('span.badge', A.meta.types[s.tank]?.name_ko || s.tank));
      if (o.teams && o.teams !== 'NONE') meta.append(h('span.badge', `팀 ${s.team}`));
      const acts = h('div.slot-actions');
      const mine = s.id === app.you;
      if (mine) acts.append(h('button.btn.small', { type: 'button', onclick: () => openTankPicker(app, s) }, '탱크 모양'));
      if ((mine || host) && o.teams && o.teams !== 'NONE') {
        const sel = h('select', { 'aria-label': '팀', onchange: () => net.send('set_profile', mine ? { team: +sel.value } : { target: s.id, team: +sel.value }) },
          [1, 2, 3, 4, 5].map(t => h('option', { value: t, selected: s.team === t }, `팀 ${t}`)));
        acts.append(sel);
      }
      if (host && s.kind === 'computer') {
        const sel = h('select', { 'aria-label': '컴퓨터 성향', onchange: () => net.send('set_computer', { id: s.id, personality: sel.value }) },
          PERSONALITY_ORDER.map(p => h('option', { value: p, selected: s.personality === p, title: PERSONALITY_HINT[p] }, PERSONALITY[p])));
        acts.append(sel, h('button.btn.small', { type: 'button', 'aria-label': '컴퓨터 제거', onclick: () => net.send('remove_computer', { id: s.id }) }, '제거'));
      } else if (s.kind === 'computer') {
        meta.append(h('span.badge', PERSONALITY[s.personality] || ''));
      }
      if (host && !mine && s.kind === 'human') acts.append(h('button.btn.small.danger', { type: 'button', onclick: async () => { if (await confirmDialog(`${s.name}님을 강퇴할까요?`, { okLabel: '강퇴', danger: true })) net.send('kick', { id: s.id }); } }, '강퇴'));
      const card = h('div.card.slot' + (mine ? '.me' : ''), { role: 'listitem' }, marker, cv, h('div', { style: { minWidth: 0 } }, h('div.name', s.name), meta), acts);
      slotsEl.append(card);
      requestAnimationFrame(() => drawTankPreview(cv, s.tank, n, 50));
    }
    const me = mySlot();
    readyBtn.hidden = host;
    readyBtn.textContent = me?.ready ? '준비 해제' : '준비';
    readyBtn.className = 'btn' + (me?.ready ? '' : '.ok').replace('.', ' ');
    startBtn.hidden = !host;
    const st = r.start || { ok: false };
    startBtn.setAttribute('aria-disabled', String(!st.ok));
    startBtn.title = st.ok ? '' : (st.msg || '');
    settingsBtn.textContent = host ? '설정 변경' : '설정 보기';
  }
  function renderChat() { clear(log); for (const m of app.chat) log.append(chatLine(m)); log.scrollTop = log.scrollHeight; }
  function chatLine(m) { return m.system ? h('div.chat-line.sys', m.text) : h('div.chat-line', h('b', m.from?.name || ''), m.text); }
  update(); renderChat();
  return {
    update,
    onChat: m => { log.append(chatLine(m)); while (log.children.length > 100) log.firstChild.remove(); log.scrollTop = log.scrollHeight; },
  };
}

function openTankPicker(app, slot) {
  const n = (slot.color ?? slot.slot) + 1;
  const grid = h('div.tank-grid');
  const cards = [];
  for (const [type, m] of Object.entries(A.meta.types)) {
    const disabled = m.cpu_only && slot.kind === 'human';
    const cv = h('canvas', { 'aria-hidden': 'true' });
    const card = h('button.card.tank-card', {
      type: 'button', disabled, 'aria-pressed': String(slot.tank === type), title: disabled ? '컴퓨터 전용' : m.desc_ko,
      onclick: () => { net.send('set_profile', { tank: type }); layer.close(); },
    }, cv, h('b', m.name_ko),
      h('div.row', { style: { gap: '4px', flexWrap: 'wrap' } }, h('span.badge' + (m.can_move ? '.ready' : '.off'), m.can_move ? '이동 가능' : '고정 포대'), m.cpu_only ? h('span.badge.cpu', '컴퓨터 전용') : null),
      h('span.d', m.desc_ko));
    cards.push([cv, type]); grid.append(card);
  }
  const layer = openLayer({ title: '탱크 모양', kind: 'modal', className: 'wide', body: grid });
  requestAnimationFrame(() => cards.forEach(([cv, t]) => drawTankPreview(cv, t, n, 40)));
}

function openSettings(app) {
  const r = app.room, host = r.hostId === app.you;
  if (!host) {
    const rows = [];
    for (const tab of OPTION_TABS) {
      rows.push(h('h3', { style: { margin: '14px 0 6px' } }, tab.label));
      for (const it of tab.items) rows.push(h('div.row', { style: { minHeight: '32px', borderBottom: '1px solid var(--line)' } }, h('span.grow.muted', it.label), h('span', fmtValue(it, r.options[it.key]))));
    }
    return openLayer({ title: '방 설정', kind: 'drawer', body: [h('div.row', h('span.grow.muted', '라운드 수'), h('b', String(r.options.rounds))), ...rows] });
  }
  const used = r.slots.filter(s => !s.empty).length;
  const f = optionsForm({ title: r.title, maxPlayers: r.maxPlayers, options: r.options, minPlayers: used });
  openLayer({
    title: '설정 변경', kind: 'modal', className: 'wide', body: f.el,
    actions: [{ label: '취소' }, { label: '적용', primary: true, onClick: () => {
      const v = f.value(); if (!v.title) { toast('방 제목은 1~30자로 입력하세요', 'error'); return false; }
      const patch = {}; for (const [k, val] of Object.entries(v.options)) if (r.options[k] !== val) patch[k] = val;
      net.send('set_options', { options: patch, title: v.title !== r.title ? v.title : undefined, maxPlayers: v.maxPlayers !== r.maxPlayers ? v.maxPlayers : undefined });
    } }],
  });
}
void bitmap;
