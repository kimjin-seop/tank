// 상점 오버레이 (SPEC 4.4, 5.7.2, UI U1.4): 카드 그리드·필터·검색, 내 장비·판매 시트, 현금/이자 헤더, 상점 타이머
import { h, clear, clamp, remainSec, fmtMoney, holdRepeat, isTyping } from '../util.js';
import { openLayer, rangeCtl, tabs, toast, isOverlayOpen, announce } from '../ui.js';
import { net } from '../net.js';
import { A, itemIcon } from '../game/assets.js';
import { PRICE, ITEM_ORDER } from '../game/prices.js';
import { CATEGORY_WEAPON, CATEGORY_LABEL } from '../i18n.js';

const MAX = 99;

export class ShopView {
  constructor(host, { G }) {
    this.host = host; this.G = G; this.el = null; this.cur = null; this.items = null;
    this.tab = 'weapon'; this.cat = null; this.q = '';
    this.timerIv = 0; this.sell = null;
    this.onKey = e => this.key(e);
  }
  isOpen() { return !!this.el; }
  destroy() { this.close(); }

  // shop_open / game_resume.shop: 전원 동시 구매 {deadline, limitMs, ids, doneIds}
  start(m) {
    this.cur = { deadline: m.deadline, limitMs: m.limitMs, ids: m.ids || [], doneIds: m.doneIds || [] };
    this.open();
    announce(this.mode() === 'buy' ? '상점이 열렸습니다' : this.progText());
  }
  // shop_progress {doneIds}: 내 상태(구매/완료)가 바뀌면 화면 전환, 아니면 현황 줄만 갱신
  progress(m) {
    if (!this.cur) return;
    const before = this.mode();
    this.cur.doneIds = m.doneIds || [];
    if (this.mode() !== before) { this.closeSell(); this.render(); } else this.renderProg();
  }
  setItems(list) { if (Array.isArray(list)) this.items = list; }
  result(m) {
    this.setItems(m.shop || m.items);
    if (m.action === 'sell' || m.action === 'sell_reject') this.closeSell();
    this.refresh();
  }
  closeSell() { if (this.sell) { this.sell.decided = true; this.sell.L.close(); this.sell = null; } }
  quote(m) { if (this.sell && this.sell.item === m.item) this.sell.show(m.quote, m.qty); }

  open() {
    if (!this.el) {
      this.host.style.pointerEvents = 'auto';
      this.el = h('section.shop', { role: 'region', 'aria-label': '상점' });
      this.host.append(this.el);
      window.addEventListener('keydown', this.onKey);
      this.timerIv = setInterval(() => this.tick(), 250);
    }
    this.render();
  }
  close() {
    if (!this.el) return;
    this.closeSell();
    this.el.remove(); this.el = null; this.cur = null;
    if (!this.host.children.length) this.host.style.pointerEvents = 'none';
    window.removeEventListener('keydown', this.onKey);
    clearInterval(this.timerIv);
  }
  refresh() { if (this.el) this.renderBody(); }

  // 'buy' = 구매 중, 'done' = 완료 후 대기(다시 열기 가능), 'wait' = 상점 대상 아님(현금 0 등)
  mode() {
    const c = this.cur, me = this.G.me;
    if (!c || !c.ids.includes(me)) return 'wait';
    return c.doneIds.includes(me) ? 'done' : 'buy';
  }
  mine() { return !!this.cur && this.mode() === 'buy'; }
  progText() {
    const c = this.cur; if (!c || !c.ids.length) return '';
    const left = c.ids.filter(id => !c.doneIds.includes(id));
    const names = left.map(id => this.G.seats.get(id)?.name || id).join(', ');
    return `완료 ${c.ids.length - left.length}/${c.ids.length}` + (left.length ? ` · 대기: ${names}` : '');
  }
  renderProg() { if (this.progEl) { const t = this.progText(); this.progEl.textContent = t; this.progEl.title = t; } }
  cash() { return this.G.inv?.cash ?? 0; }
  owned(id) { return id === 'baby_missile' ? MAX : (this.G.inv?.items?.[id] || 0); }

  list() {
    const arms = this.G.options.armsLevel ?? 4;
    const src = this.items ? this.items.map(x => ({ ...PRICE.get(x.id), ...x })) : ITEM_ORDER.map(id => PRICE.get(id)).filter(p => p.arms <= arms);
    return src.filter(x => x && x.allowed !== false);
  }

  render() {
    const el = this.el; clear(el);
    this.timerTxt = h('span.tt'); this.timerBar = h('i');
    const timer = h('div.timer', { role: 'timer', 'aria-label': '상점 남은 시간' }, this.timerTxt, h('div.tb', this.timerBar));
    this.progEl = h('div.shop-prog', { role: 'status' });
    this.waitTxt = null;
    const mode = this.mode();
    if (mode !== 'buy') {
      this.waitTxt = h('b');
      const reopen = mode === 'done' ? h('button.btn', { type: 'button', onclick: () => this.reopen() }, '다시 열기') : null;
      el.append(h('header.shop-head', h('h1', '상점'), h('div.spacer'), timer),
        h('div.wait-shop', h('h2', mode === 'done' ? '구매 완료' : '구매 대기'), this.waitTxt, this.progEl, reopen));
      this.renderProg(); this.tick(); reopen?.focus(); return;
    }
    this.cashEl = h('b');
    const head = h('header.shop-head',
      h('h1', '상점'),
      h('div.money', h('div', h('small', '현금'), this.cashEl), h('div', h('small', '이자'), h('b', '+' + fmtMoney(this.G.interest || 0)))),
      this.progEl, timer,
      h('button.btn.small', { type: 'button', title: '현황 [u]', onclick: () => this.status() }, '현황'),
      h('button.btn.primary', { type: 'button', title: '완료 [Esc]', onclick: () => this.done() }, '완료'));
    const search = h('input', { type: 'search', placeholder: '검색', 'aria-label': '검색', value: this.q, oninput: () => { this.q = search.value.trim(); this.renderBody(); } });
    const tabBar = tabs([{ id: 'weapon', label: '무기' }, { id: 'misc', label: '기타 장비' }, { id: 'all', label: '전체' }], id => { this.tab = id; this.cat = null; this.renderBody(); }, this.tab);
    this.chips = h('div.chips');
    this.grid = h('div.item-grid', { role: 'list' });
    this.mineEl = h('aside.mine', { 'aria-label': '내 장비', tabindex: '-1' });
    el.append(head, h('div.shop-body', h('div.shop-main', tabBar, h('div.shop-filter', this.chips, h('div.spacer'), search), this.grid), this.mineEl));
    this.renderProg(); this.renderBody(); this.tick();
  }

  renderBody() {
    if (!this.el || !this.mine()) return;
    this.cashEl.textContent = fmtMoney(this.cash());
    // 분류 칩
    const isW = it => CATEGORY_WEAPON.includes(A.itemById.get(it.id)?.category);
    const cats = this.tab === 'weapon' ? CATEGORY_WEAPON : this.tab === 'misc' ? ['유도', '방어', '기타'] : [];
    clear(this.chips);
    if (cats.length) {
      this.chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(!this.cat), onclick: () => { this.cat = null; this.renderBody(); } }, '전체'));
      for (const c of cats) this.chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(this.cat === c), onclick: () => { this.cat = c; this.renderBody(); } }, CATEGORY_LABEL[c] || c));
    }
    clear(this.grid);
    const cash = this.cash();
    let shown = 0;
    for (const it of this.list()) {
      const meta = A.itemById.get(it.id) || {};
      if (this.tab === 'weapon' && !isW(it)) continue;
      if (this.tab === 'misc' && isW(it)) continue;
      if (this.cat && meta.category !== this.cat) continue;
      if (this.q && !(meta.name_ko || '').includes(this.q) && !(meta.name_en || '').toLowerCase().includes(this.q.toLowerCase())) continue;
      const own = this.owned(it.id), maxed = own >= MAX;
      if (!maxed && (it.affordable === false || it.price > cash)) continue; // 원본 규칙: 살 수 없는 품목 숨김
      if (it.id === 'baby_missile') continue;
      shown++;
      const buy = h('button.btn.small.primary', { type: 'button', disabled: maxed, 'aria-label': `${meta.name_ko} 구매` }, maxed ? '최대' : '+ 구매');
      if (!maxed) holdRepeat(buy, () => this.buy(it), { delay: 450, interval: 300 });
      this.grid.append(h('div.card.item', { role: 'listitem', title: meta.detail || '' },
        h('div.item-head', itemIcon(it.id, 48), h('span.n', meta.name_ko || it.id)), h('span.s', meta.short || ''),
        h('div.p', h('b', fmtMoney(it.price)), h('span.muted', `${it.bundle}개 묶음`)),
        h('div.row', h('span.own.grow', `보유 ${own}`), buy)));
    }
    if (!shown) this.grid.append(h('div.empty', '살 수 있는 품목이 없습니다'));
    // 내 장비
    clear(this.mineEl);
    this.mineEl.append(h('h2', { style: { marginBottom: '8px' } }, '내 장비'));
    for (const id of ITEM_ORDER) {
      const n = this.owned(id); if (!n) continue;
      const meta = A.itemById.get(id) || {};
      this.mineEl.append(h('div.mine-row', h('span.mine-nm', itemIcon(id, 32), h('span', meta.name_ko || id)), h('span.tabular', String(n)),
        id === 'baby_missile' ? h('span') : h('button.btn.small', { type: 'button', onclick: () => this.openSell(id) }, '판매')));
    }
  }

  buy(it) {
    if (!this.mine()) return false;
    if (it.price > this.cash()) { toast('현금이 부족합니다', 'error'); return false; }
    const own = this.owned(it.id);
    if (own >= MAX) { toast('보유 한도(99개)입니다', 'error'); return false; }
    net.send('buy', { item: it.id, qty: 1 });
  }

  openSell(id) {
    const own = this.owned(id), meta = A.itemById.get(id) || {};
    let qty = 1, tmo = 0;
    const offer = h('b', '…');
    const reqQuote = () => { clearTimeout(tmo); offer.textContent = '…'; tmo = setTimeout(() => net.send('sell_quote', { item: id, qty }), 200); };
    const q = rangeCtl({ label: '수량', min: 1, max: own, step: 1, value: 1, onChange: v => { qty = v; reqQuote(); } });
    const L = openLayer({
      title: `${meta.name_ko || id} 판매`, kind: 'sheet',
      body: [h('div.row', itemIcon(id, 64), h('span', { style: { fontWeight: 700 } }, meta.name_ko || id), h('span.muted', `보유 ${own}`)), q, h('div.row', { style: { fontSize: '18px' } }, h('span.grow.muted', '제시가'), offer), h('p.muted', h('kbd', 'q'), ' ', h('kbd', 'Alt+q'), ' 수량 · ', h('kbd', 'a'), ' 수락 · ', h('kbd', 'r'), ' 거절')],
      actions: [
        { label: '거절', onClick: () => { net.send('sell_reject'); } },
        { label: '수락', primary: true, onClick: () => { if (offer.textContent === '…') return false; net.send('sell_accept'); return false; } },
      ],
      onClose: () => { if (this.sell?.L === L) { if (!this.sell.decided) net.send('sell_reject'); this.sell = null; } },
    });
    this.sell = {
      L, item: id,
      show: (price, n) => { if (n === qty) offer.textContent = fmtMoney(price); },
      inc: d => q.set(clamp(qty + d, 1, own)),
      decided: false,
    };
    // 수락/거절 버튼 클릭 시 decided 표시
    L.foot?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (this.sell) this.sell.decided = true; }, true));
    reqQuote();
  }

  status() {
    const G = this.G, row = (k, v) => h('div.row', { style: { minHeight: '36px', borderBottom: '1px solid var(--line)' } }, h('span.grow.muted', k), h('b', v));
    openLayer({ title: '현황', kind: 'modal', body: [row('남은 라운드', String(Math.max(0, (G.rounds || 0) - (G.round || 0)))), row('현금', fmtMoney(this.cash())), row('이자', fmtMoney(G.interest || 0))] });
  }
  // 화면 전환은 서버의 shop_progress 로만 한다(거절되면 토스트)
  done() { if (this.mine()) net.send('shop_done'); }
  reopen() { if (this.cur && this.mode() === 'done') net.send('shop_reopen'); }

  tick() {
    if (!this.el || !this.cur) return;
    const s = remainSec(this.cur.deadline, net.offset) ?? 0, sec = Math.ceil(s);
    if (this.timerTxt) {
      this.timerTxt.textContent = sec + '초';
      this.timerBar.style.width = (this.cur.limitMs ? clamp(s * 1000 / this.cur.limitMs, 0, 1) * 100 : 0) + '%';
      const urgent = s <= 10; this.timerTxt.parentElement.classList.toggle('urgent', urgent); this.timerTxt.parentElement.classList.toggle('blink', urgent);
    }
    if (this.waitTxt) this.waitTxt.textContent = sec + '초';
  }

  key(e) {
    if (!this.el || isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (this.sell && !this.sell.L.closed) {
      if (k === 'q') { e.preventDefault(); this.sell.inc(e.altKey ? -1 : 1); }
      else if (k === 'a') { e.preventDefault(); this.sell.decided = true; net.send('sell_accept'); }
      else if (k === 'r') { e.preventDefault(); this.sell.decided = true; net.send('sell_reject'); }
      return;
    }
    if (isOverlayOpen()) return;
    if (!this.mine()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.done(); }
    else if (k === 'u') { e.preventDefault(); this.status(); }
    else if (k === 'i') { e.preventDefault(); this.mineEl?.focus(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) {
      const btns = [...this.grid.querySelectorAll('button:not(:disabled)')]; if (!btns.length) return;
      e.preventDefault();
      let i = btns.indexOf(document.activeElement);
      const step = e.key.startsWith('Page') ? 6 : 1;
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = btns.length - 1;
      else i = clamp((i < 0 ? 0 : i) + ((e.key === 'ArrowDown' || e.key === 'PageDown') ? step : -step), 0, btns.length - 1);
      btns[i].focus();
    }
  }
}
