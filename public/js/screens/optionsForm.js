// 방 설정 폼(방 만들기·대기실 설정 변경 공용): 기본 항목 + 옵션 탭 5개
import { h, clear } from '../util.js';
import { rangeCtl, switchCtl, segmentCtl, selectCtl, tabs, textField } from '../ui.js';
import { OPTION_TABS, BASE_FIELDS, tabDefaults } from '../options.js';
import { A } from '../game/assets.js';
import { PRICE } from '../game/prices.js';
import { WALLS_HINT, SKY } from '../i18n.js';

const MAIN_KEYS = ['turnLimitSec', 'shopLimitSec'];

/** returns { el, value() -> {title, maxPlayers, options} } */
export function optionsForm({ title = '', maxPlayers = BASE_FIELDS.maxPlayers.def, options, readOnly = false, minPlayers = 2, showTitle = true }) {
  const opt = { ...options };
  const titleF = textField({ label: '방 제목', value: title, maxLength: 30, placeholder: '1~30자', autofocus: showTitle && !readOnly });
  if (readOnly) titleF.input.disabled = true;
  let maxP = maxPlayers;
  const maxF = rangeCtl({ label: '최대 인원', min: Math.max(2, minPlayers), max: 10, step: 1, value: maxP, disabled: readOnly, onChange: v => { maxP = v; } });
  const roundsF = rangeCtl({ label: '라운드 수', min: 1, max: 1000, step: 1, value: opt.rounds, numberInput: true, presets: BASE_FIELDS.rounds.presets, disabled: readOnly, onChange: v => { opt.rounds = v; } });
  const mainItems = OPTION_TABS.flatMap(t => t.items).filter(it => MAIN_KEYS.includes(it.key));
  const mainBox = h('div', mainItems.map(it => control(it)));

  const body = h('div.tab-body', { style: { paddingTop: '14px' } });
  let active = OPTION_TABS[0].id;
  // 탭 전환 시 탭 바가 스크롤 영역 맨 위로 오게 해 새 내용이 바로 보이게
  const tabBar = tabs(OPTION_TABS.map(t => ({ id: t.id, label: t.label })), id => { active = id; renderTab(); requestAnimationFrame(() => tabBar.scrollIntoView?.({ block: 'start', behavior: 'smooth' })); }, active);
  function renderTab() {
    clear(body);
    const tab = OPTION_TABS.find(t => t.id === active);
    const normal = tab.items.filter(it => !it.advanced && !MAIN_KEYS.includes(it.key)), adv = tab.items.filter(it => it.advanced);
    body.append(...normal.map(it => control(it)));
    if (adv.length) body.append(h('details.adv', h('summary', '고급'), ...adv.map(it => control(it))));
    if (!readOnly) body.append(h('div.row', h('div.spacer'), h('button.btn.small', { type: 'button', onclick: () => { Object.assign(opt, tabDefaults(active)); renderTab(); } }, '기본값으로')));
  }
  function control(it) {
    const set = v => { opt[it.key] = v; if (it.key === 'armsLevel') armsInfo(); };
    const v = opt[it.key];
    switch (it.type) {
      case 'switch': return switchCtl({ label: it.label, value: v, disabled: readOnly, onChange: set });
      case 'segment': return segmentCtl({ label: it.label, choices: it.choices, value: v, disabled: readOnly, onChange: set });
      case 'select': return selectCtl({ label: it.label, choices: it.choices, value: v, disabled: readOnly, onChange: set });
      case 'number': return rangeCtl({ label: it.label, min: it.min, max: it.max, step: it.step, value: v, numberInput: true, presets: it.presets, fmt: it.fmt, disabled: readOnly, onChange: set });
      case 'walls': return segmentCtl({ label: it.label, value: v, disabled: readOnly, onChange: set, choices: it.choices.map(c => ({ ...c, hint: WALLS_HINT[c.v], label: A.pal.walls[c.v] ? [dot(A.pal.walls[c.v]), c.label] : c.label })) });
      case 'sky': return skyGrid(it, v, set);
      case 'range': {
        const el = rangeCtl({ label: it.label, min: it.min, max: it.max, step: it.step, value: v, fmt: it.fmt, disabled: readOnly, onChange: set });
        if (it.key === 'armsLevel') { el.append(armsEl); armsInfo(); }
        if (it.hint) el.append(h('p.muted', { style: { margin: '2px 0 0', fontSize: '12px' } }, it.hint));
        return el;
      }
      default: return h('div');
    }
  }
  const armsEl = h('div.muted', { style: { fontSize: '13px' } });
  function armsInfo() { const n = [...PRICE.values()].filter(p => p.arms <= opt.armsLevel).length; armsEl.textContent = `사용 가능 아이템 ${n}개`; }
  function dot(col) { return h('span.wall-dot', { style: { background: col }, 'aria-hidden': 'true' }); }
  function skyGrid(it, v, set) {
    const name = 'sky' + Math.random().toString(36).slice(2, 7);
    const grid = h('div.sky-grid', { role: 'radiogroup', 'aria-label': it.label });
    for (const c of it.choices) {
      const sk = A.pal.skies[c.v];
      const bg = sk ? `linear-gradient(180deg, ${sk.stops.map(([o, col]) => `${col} ${o * 100}%`).join(',')})` : 'conic-gradient(#2F6FD0, #9B3C6E, #1A2029, #3FA9A2, #2F6FD0)';
      const id = name + c.v;
      const input = h('input', { type: 'radio', name, id, checked: v === c.v, disabled: readOnly, onchange: () => set(c.v) });
      grid.append(h('div.sky-opt', input, h('label', { for: id }, h('span.sw', { style: { background: bg } }), SKY[c.v])));
    }
    return h('div.field', h('span.field-label', it.label), grid);
  }
  renderTab();
  const el = h('div', showTitle ? titleF : null, maxF, roundsF, mainBox, tabBar, body);
  return { el, value: () => ({ title: titleF.input.value.trim(), maxPlayers: maxP, options: { ...opt } }) };
}
