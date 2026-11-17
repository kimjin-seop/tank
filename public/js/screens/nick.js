// 닉네임 입력 (SPEC 5.2) — 규칙 위반·중복은 서버 거절 토스트
import { h } from '../util.js';
import { textField, toast } from '../ui.js';
import { net } from '../net.js';
import { ERR } from '../i18n.js';

const NICK_RE = /^[가-힣a-zA-Z0-9]{2,12}$/;

export function mount(root) {
  const f = textField({ label: '닉네임', placeholder: '2~12자', maxLength: 12, autofocus: true, onEnter: () => go() });
  const btn = h('button.btn.primary', { type: 'submit', style: { width: '100%' } }, '입장');
  const form = h('form.card.nick-card', { onsubmit: e => { e.preventDefault(); go(); } },
    h('h1.title.brand', '스코치드 어스 포에버'),
    h('div.sub', '모든 게임의 어머니'),
    f, btn);
  root.append(h('div.nick-screen', form));
  const saved = localStorage.getItem('se.nick'); if (saved) f.input.value = saved;
  setTimeout(() => f.input.focus(), 30);
  function go() {
    const v = f.input.value.trim();
    if (!NICK_RE.test(v)) { toast(ERR.NICK_INVALID, 'error'); f.input.focus(); return; }
    localStorage.setItem('se.nick', v);
    btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1200);
    net.send('hello', { nickname: v });
  }
  return { onError: () => { btn.disabled = false; f.input.focus(); f.input.select(); } };
}
