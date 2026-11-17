// 공용 DOM·수치 유틸 (프레임워크 없음)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** h('button.btn.primary', {onclick, 'aria-label': ..}, '텍스트', child) */
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fmtMoney = n => '$' + Math.round(n || 0).toLocaleString('en-US');
export const fmtInt = n => Math.round(n || 0).toLocaleString('en-US');

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) { if (!this._h.has(type)) this._h.set(type, new Set()); this._h.get(type).add(fn); return () => this.off(type, fn); }
  off(type, fn) { this._h.get(type)?.delete(fn); }
  emit(type, data) { for (const fn of [...(this._h.get(type) || [])]) { try { fn(data); } catch (e) { console.error(e); } } for (const fn of [...(this._h.get('*') || [])]) fn(type, data); }
}

/** 텍스트 입력 중인지(게임 키 가로채기 금지 판단) */
export function isTyping(target = document.activeElement) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type);
  if (tag === 'SELECT') return true;
  return false;
}

/** 길게 누르면 반복 실행되는 버튼 동작 */
export function holdRepeat(btn, fn, { delay = 350, interval = 50 } = {}) {
  // 누르고 있기 반복. 버튼이 재렌더로 DOM 에서 빠지거나(pointerup 이 새 요소로 감) 포커스·창 이탈 시에도 반드시 멈춘다.
  // fn 이 false 를 돌려주면(한도·현금 부족 등) 즉시 멈춤
  let t1 = 0, t2 = 0;
  const stop = () => {
    clearTimeout(t1); clearInterval(t2); t1 = t2 = 0;
    window.removeEventListener('pointerup', stop, true); window.removeEventListener('pointercancel', stop, true); window.removeEventListener('blur', stop);
  };
  const tick = e => { if (!btn.isConnected || btn.disabled || fn(e) === false) stop(); };
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); stop();
    if (fn(e) === false) return;
    window.addEventListener('pointerup', stop, true); window.addEventListener('pointercancel', stop, true); window.addEventListener('blur', stop);
    t1 = setTimeout(() => { t2 = setInterval(() => tick(e), interval); }, delay);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); fn(e); } else if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
  return stop;
}

/** 서버 시각 오프셋 기반 남은 초 */
export function remainSec(deadline, offset) {
  if (!deadline) return null;
  return Math.max(0, (deadline - (Date.now() + (offset || 0))) / 1000);
}
