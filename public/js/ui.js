// 공통 UI 컴포넌트: 토스트, 모달, 바텀 시트/드로어, 스위치, 세그먼트, 스텝퍼+슬라이더, 라이브 영역
import { h, clear, clamp, holdRepeat } from './util.js';

// ---------- 토스트 (오류·거절·시스템 알림 전부) ----------
let toastHost;
export function toast(msg, kind = 'info', ms = 3200) {
  if (!toastHost) toastHost = document.getElementById('toasts');
  // 같은 문구(문자열)는 1개로 합치고 횟수·타이머만 갱신. 동시에 최대 3개
  const key = typeof msg === 'string' ? kind + '|' + msg : null;
  if (key) {
    const same = [...toastHost.children].find(x => x.dataset.key === key && !x.dataset.closing);
    if (same) {
      const n = (+same.dataset.n || 1) + 1; same.dataset.n = n;
      same.textContent = `${msg} ×${n}`;
      clearTimeout(same._tmo); same._tmo = setTimeout(() => closeToast(same), ms);
      return;
    }
  }
  const el = h('div.toast.' + kind, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  if (key) el.dataset.key = key;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el._tmo = setTimeout(() => closeToast(el), ms);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
}
function closeToast(el) { el.dataset.closing = '1'; el.classList.remove('show'); setTimeout(() => el.remove(), 300); }

// ---------- 스크린리더 라이브 영역 ----------
export function announce(msg) {
  const el = document.getElementById('live');
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}

// ---------- 모달/시트/드로어 ----------
const stack = [];
export function isOverlayOpen() { return stack.length > 0; }
export function closeTop() { const t = stack[stack.length - 1]; if (t) t.close(); }

/**
 * openLayer({ title, body, actions, kind:'modal'|'sheet'|'drawer', onClose, dismissible })
 * returns { el, close }
 */
export function openLayer({ title, body, actions = [], kind = 'modal', onClose, dismissible = true, className = '' }) {
  const host = document.getElementById('layers');
  const prevFocus = document.activeElement;
  const titleId = 'lt' + Math.random().toString(36).slice(2, 8);
  const panel = h(`div.layer-panel.${kind}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, class: className });
  const head = h('div.layer-head',
    h('h2', { id: titleId }, title || ''),
    dismissible ? h('button.icon-btn', { type: 'button', 'aria-label': '닫기', onclick: () => api.close() }, '✕') : null);
  const content = h('div.layer-body');
  if (body) content.append(...(Array.isArray(body) ? body : [body]));
  const foot = actions.length ? h('div.layer-foot', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
    type: 'button', disabled: a.disabled, onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) api.close(); },
  }, a.label))) : null;
  panel.append(head, content, ...(foot ? [foot] : []));
  const backdrop = h(`div.layer.${kind}`, { onpointerdown: e => { if (e.target === backdrop && dismissible) api.close(); } }, panel);
  host.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const api = {
    el: panel, body: content, foot,
    closed: false,
    close() {
      if (api.closed) return; api.closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 180);
      onClose && onClose();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    },
    dismissible,
  };
  stack.push(api);
  const f = panel.querySelector('[autofocus]') || panel.querySelector('input,button.primary,button:not(.icon-btn),select') || panel;
  setTimeout(() => f.focus && f.focus(), 30);
  return api;
}

export function confirmDialog(title, { okLabel = '확인', cancelLabel = '취소', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    openLayer({
      title, kind: 'modal', className: 'confirm',
      actions: [
        { label: cancelLabel, onClick: () => { done = true; res(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { done = true; res(true); } },
      ],
      onClose: () => { if (!done) res(false); },
    });
  });
}

// 레이어 포커스 트랩 + ESC
document.addEventListener('keydown', e => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.dismissible) { e.preventDefault(); e.stopPropagation(); top.close(); return; }
  if (e.key === 'Tab') {
    const f = [...top.el.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

// ---------- 폼 컨트롤 ----------
let uid = 0;
const nid = p => p + (++uid);

export function switchCtl({ label, value, onChange, disabled, hint }) {
  const id = nid('sw');
  const input = h('input', { type: 'checkbox', id, role: 'switch', checked: !!value, disabled, onchange: () => onChange && onChange(input.checked) });
  return h('label.field.switch-field', { for: id, title: hint || null },
    h('span.field-label', label),
    h('span.switch', input, h('span.switch-track', h('span.switch-thumb'))));
}

export function segmentCtl({ label, choices, value, onChange, disabled, name }) {
  const group = name || nid('seg');
  const wrap = h('div.segment', { role: 'radiogroup', 'aria-label': label });
  for (const c of choices) {
    const id = nid('sg');
    const input = h('input', { type: 'radio', name: group, id, checked: c.v === value, disabled, onchange: () => onChange && onChange(c.v) });
    wrap.append(h('span.seg-item', input, h('label', { for: id, title: c.hint || null }, c.label)));
  }
  return h('div.field', h('span.field-label', label), wrap);
}

export function selectCtl({ label, choices, value, onChange, disabled }) {
  const id = nid('sel');
  const sel = h('select', { id, disabled, onchange: () => onChange && onChange(choices[sel.selectedIndex].v) },
    choices.map(c => h('option', { selected: c.v === value }, c.label)));
  return h('div.field', h('label.field-label', { for: id }, label), sel);
}

/** 스텝퍼(−/+) + 슬라이더 + 값 표시 */
export function rangeCtl({ label, min, max, step = 1, value, onChange, fmt, disabled, presets, numberInput }) {
  const id = nid('rg');
  const dec = (String(step).split('.')[1] || '').length;
  const norm = v => clamp(Number((Math.round(v / step) * step).toFixed(dec)), min, max);
  let cur = norm(value);
  const out = h('output.val', { for: id }, fmt ? fmt(cur) : cur);
  const slider = h('input', { type: 'range', id, min, max, step, value: cur, disabled, 'aria-label': label });
  const num = numberInput ? h('input.num', { type: 'number', min, max, step, value: cur, disabled, 'aria-label': label }) : null;
  const set = (v, fire = true) => {
    cur = norm(v); slider.value = cur; if (num) num.value = cur; out.textContent = fmt ? fmt(cur) : cur;
    if (fire && onChange) onChange(cur);
  };
  slider.addEventListener('input', () => set(+slider.value));
  num && num.addEventListener('change', () => set(+num.value));
  const minus = h('button.step', { type: 'button', 'aria-label': label + ' 감소', disabled }, '−');
  const plus = h('button.step', { type: 'button', 'aria-label': label + ' 증가', disabled }, '+');
  holdRepeat(minus, () => set(cur - step)); holdRepeat(plus, () => set(cur + step));
  const row = h('div.range-row', minus, slider, plus, num || out);
  const chips = presets ? h('div.chips', presets.map(p => h('button.chip', { type: 'button', disabled, onclick: () => set(p) }, fmt ? fmt(p) : p))) : null;
  const el = h('div.field.range-field', h('label.field-label', { for: id }, label, numberInput ? null : null), row, chips);
  el.set = set; el.get = () => cur;
  return el;
}

export function textField({ label, value = '', placeholder, maxLength, type = 'text', autofocus, onEnter, autocomplete = 'off' }) {
  const id = nid('tf');
  const input = h('input', { id, type, value, placeholder, maxLength, autofocus, autocomplete, spellcheck: false });
  if (onEnter) input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onEnter(input.value); } });
  const el = h('div.field', h('label.field-label', { for: id }, label), input);
  el.input = input;
  return el;
}

export function tabs(list, onSelect, active) {
  const bar = h('div.tabs', { role: 'tablist' });
  const btns = list.map(t => h('button.tab', {
    type: 'button', role: 'tab', 'aria-selected': String(t.id === active), onclick: () => select(t.id),
  }, t.label));
  bar.append(...btns);
  bar.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement); if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length; btns[n].focus(); select(list[n].id); }
  });
  function select(id) { btns.forEach((b, i) => b.setAttribute('aria-selected', String(list[i].id === id))); onSelect(id); }
  bar.select = select;
  return bar;
}

export { clear };
