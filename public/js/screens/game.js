// 게임 화면: 캔버스(월드) + HTML HUD + 키보드/터치 입력 + 제어판·인벤토리·이동·표적·배터리 + 상점·결과 오버레이
import { h, clear, clamp, isTyping, holdRepeat, remainSec, fmtMoney } from '../util.js';
import { openLayer, confirmDialog, toast, announce, rangeCtl, switchCtl, segmentCtl, isOverlayOpen, closeTop } from '../ui.js';
import { net } from '../net.js';
import { A, playerColor, itemIcon } from '../game/assets.js';
import { Renderer, DISPLAY_ASPECT } from '../game/renderer.js';
import { Playback, shieldFx } from '../game/playback.js';
import { WEAPON_IDS, ITEM_ORDER } from '../game/prices.js';
import { GUIDANCE, GUIDANCE_TYPE, UNGUIDABLE, ENERGY_WEAPONS, SHIELD_ITEMS, SKY, WALLS, MODE, SHIELD_MAX } from '../i18n.js';
import { ShopView } from './shop.js';

// 키 반복 속도(단위/초) — 원본 값 미상(SPEC 1.3), 가정값
const RATE = { angle: 40, angleSlow: 8, power: 250, powerSlow: 40, powerFast: 1000 };
// 넓은 화면(데스크톱) 좌우 패널 최소 폭(CSS px). 캔버스 폭 = min(전장 높이×DISPLAY_ASPECT, 전체 폭 − 2×이 값)
const PANEL_MIN = 210;

export function mount(root, app, data) {
  const G = {
    me: app.you, seats: new Map(), options: {}, round: 0, rounds: 0, phase: 'init', turn: null, wind: 0, wall: 'NONE', sky: 'PLAIN',
    inv: { cash: 0, items: { baby_missile: 99 } }, aim: { angle: 45, power: 400, weapon: 'baby_missile' },
    guidance: null, trigger: false, readyIds: new Set(), playbacks: [], targeting: null, lastAimSent: 0, aimDirty: false,
    interest: 0, backToRoom: false, wantRoom: false, ranking: null,
  };
  // ---------- DOM ----------
  const whoMarker = h('img.marker', { alt: '' });
  const whoName = h('span.name');
  const roundEl = h('span.round');
  const windEl = h('div.wind', { role: 'img', 'aria-label': '바람' });
  const energyBar = h('i'), energyTxt = h('span.et');
  const energy = h('div.energy', { title: '남은 에너지 / 최대 파워' }, h('div.eb', energyBar), energyTxt);
  const timerTxt = h('span.tt'), timerBar = h('i');
  const timer = h('div.timer', { role: 'timer', 'aria-label': '남은 시간' }, timerTxt, h('div.tb', timerBar));
  const menuBtn = h('button.icon-btn', { type: 'button', 'aria-label': '메뉴', title: '메뉴 [F1]', onclick: () => openMenu() }, '☰');
  const plBtn = h('button.icon-btn.pl-toggle', { type: 'button', 'aria-label': '플레이어 목록', onclick: () => side.classList.toggle('open') }, '👥');
  const hud = h('header.hud', h('div.who', whoMarker, whoName), roundEl, h('div.spacer'), windEl, energy, timer, plBtn, menuBtn);

  const canvas = h('canvas', { 'aria-label': '게임 화면', role: 'img', tabindex: '-1' });
  const banner = h('div.banner', { hidden: true });
  const stage = h('div.stage', canvas, banner);
  const plist = h('div.plist', { role: 'list', 'aria-label': '플레이어' });
  const plFold = h('details.pl-fold', { open: true }, h('summary', '플레이어'), plist);
  const side = h('aside.side', plFold);

  // 각도 규약(PROTOCOL 6.3): 엔진 0..180 ↔ UI 0..90 + 좌/우
  // 슬라이더는 단조: 왼쪽 끝 = 왼쪽 수평(엔진 180), 가운데 = 수직(90), 오른쪽 끝 = 오른쪽 수평(엔진 0). ←/→ 키와 같은 축
  const uiDir = a => (a < 90 ? 'right' : a > 90 ? 'left' : 'up');
  const angleLabel = a => { const r = Math.round(a); return r === 90 ? '수직 90°' : r < 90 ? `오른쪽 ${r}°` : `왼쪽 ${180 - r}°`; };
  const angleCtl = rangeCtl({ label: '각도', min: 0, max: 180, step: 1, value: 135, onChange: v => setAim({ angle: 180 - v }) });
  const angleRange = angleCtl.querySelector('input[type=range]'); angleRange.classList.add('angle-range');
  const dirBtn = h('button.step', { type: 'button', onclick: () => setAim({ angle: 180 - G.aim.angle }) });
  const powerCtl = rangeCtl({ label: '파워', min: 0, max: 1000, step: 1, value: 400, onChange: v => setAim({ power: v }) });
  const angleBig = h('span.big.ang'), powerBig = h('span.big');
  const aimRowA = h('div.aim', h('span.lab', '각도'), angleBig, angleCtl.querySelector('.range-row'));
  const maxPowEl = h('small.maxp', { title: '최대 파워(에너지×10)' });
  const aimRowP = h('div.aim', h('span.lab', '파워'), powerBig, powerCtl.querySelector('.range-row'));
  aimRowA.querySelector('output')?.remove(); aimRowP.querySelector('output')?.remove();
  aimRowA.querySelector('.range-row').prepend(dirBtn);
  aimRowP.querySelector('.range-row').append(maxPowEl);
  const wName = h('span.wn'), wCount = h('span.wc'), wIcon = h('span.wi');
  const weaponChip = h('button.weapon-chip', { type: 'button', title: '무기 선택 [Tab]', onclick: () => openWeaponSheet() }, wIcon, wName, wCount, h('span', { 'aria-hidden': 'true' }, '▾'));
  const quick = h('div.quick', { role: 'toolbar', 'aria-label': '장비' });
  const tools = h('div.tools', weaponChip, quick,
    h('button.btn.small', { type: 'button', title: '탱크 제어판 [t]', onclick: () => openControl() }, '제어판'),
    h('button.btn.small', { type: 'button', title: '인벤토리 [i]', onclick: () => openInventory() }, '인벤토리'),
    h('button.btn.small', { type: 'button', title: '이동 [f]', onclick: () => openMove() }, '이동'));
  const fireBtn = h('button.fire-btn', { type: 'button', title: '발사 [Space]', onclick: () => tryFire() }, '발사');
  const ctrl = h('footer.ctrl', aimRowA, aimRowP, tools, h('div.fire-wrap', fireBtn));
  const overlay = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 20 } });
  const gameEl = h('div.game', hud, stage, side, ctrl);
  root.append(h('div', { style: { position: 'relative', height: '100%' } }, gameEl, overlay));

  const R = new Renderer(canvas, stage, { bg: gameEl });
  // 개발용 점검: 클라이언트 지형의 부유 흙(흙 바로 아래가 하늘) 개수·좌표, 진행 중 낙하 수
  window.__terrainCheck = () => {
    const T = R.terrain, { w, h, mask } = T, bottom = h - 4, out = [];
    const cavern = R.sky === 'CAVERN';
    for (let x = 0; x < w; x++) for (let y = 0; y < Math.min(bottom, h - 1); y++) {
      if (!mask[y * w + x] || mask[(y + 1) * w + x]) continue;
      if (cavern) { let top = y; while (top > 0 && mask[(top - 1) * w + x]) top--; if (top <= 24) continue; } // 동굴 천장에 붙은 흙은 원래 안 떨어짐
      out.push([x, y]);
    }
    const falls = G.playbacks.reduce((n, p) => n + (p.falls?.length || 0), 0);
    const res = { floating: out.length, sample: out.slice(0, 20), activeFalls: falls, playing: G.playbacks.length, sky: R.sky, suspendDirt: G.options.suspendDirt ?? null };
    console.info('[terrainCheck]', res); return res;
  };
  // 개발용: 사망 연출 변종 미리보기(탱크 1번 위치)
  window.__deathFx = (variant = 'fireball', r = 30) => { const t = [...R.tanks.values()][0]; R.fx.tankDeathBlast(t?.x ?? 180, (t?.y ?? 300) - 3, r, 7, variant); };
  // 레이아웃: wide(가로 데스크톱) = 좌 조작 패널 | 캔버스 | 우 플레이어 패널, portrait = 캔버스 폭=뷰포트 폭
  gameEl.style.setProperty('--aspect', String(DISPLAY_ASPECT));
  function layout() {
    const W = gameEl.clientWidth, H = gameEl.clientHeight; if (!W || !H) return;
    const wide = W >= 1024 && W > H, portrait = !wide && H > W;
    gameEl.classList.toggle('wide', wide); gameEl.classList.toggle('portrait', portrait);
    if (wide) {
      const stageH = H; // wide: HUD는 좌 패널 상단(별도 행 없음)
      gameEl.style.setProperty('--cw', Math.floor(Math.max(200, Math.min(stageH * DISPLAY_ASPECT, W - 2 * PANEL_MIN))) + 'px');
    }
  }
  const layoutRO = new ResizeObserver(layout); layoutRO.observe(gameEl); layout();
  // 마우스·터치로 HUD 버튼을 누른 뒤 포커스가 버튼에 남지 않게(키보드 탐색 포커스는 유지)
  gameEl.addEventListener('click', e => { const b = e.target.closest?.('button'); if (b && e.detail > 0) setTimeout(() => { if (document.activeElement === b) { b.blur(); canvas.focus({ preventScroll: true }); } }, 0); });
  const shop = new ShopView(overlay, { G, app, onClose: () => {} });

  // ---------- 상태 헬퍼 ----------
  const myTank = () => R.tanks.get(G.me);
  const seatN = id => (G.seats.get(id)?.color ?? 0) + 1;
  const isMyTurn = () => {
    if (G.phase !== 'aim' || !G.turn || !myTank()?.alive) return false;
    if (G.turn.mode === 'seq') return G.turn.playerId === G.me && !G.turn.auto;
    if (G.turn.mode === 'sync') return !G.turn.auto && !G.readyIds.has(G.me);
    return G.turn.mode === 'sim';
  };
  const canAim = () => !!myTank()?.alive && G.phase !== 'over' && G.phase !== 'shop'; // 조준은 언제든(예약), 발사만 내 턴
  const maxPower = () => Math.max(0, (myTank()?.hp ?? 100) * 10);
  const owned = id => id === 'baby_missile' ? 99 : (G.inv.items?.[id] || 0);
  const ownedWeapons = () => WEAPON_IDS.filter(id => owned(id) > 0);
  const itemName = id => A.itemById.get(id)?.name_ko || id;

  function setAim(p, fromKey = false) {
    if (p.angle != null) G.aim.angle = clamp(Math.round(p.angle * 10) / 10, 0, 180);
    if (p.power != null) G.aim.power = clamp(p.power, 0, maxPower());
    if (p.weapon) { G.aim.weapon = p.weapon; G.weaponPicked = true; } // 사용자가 고른 무기는 서버 기본값으로 덮지 않음
    const t = myTank(); if (t && t.alive) t.angle = G.aim.angle; // 적 턴에도 예약 조준(내 화면에만)
    G.aimDirty = true;
    renderAim(fromKey);
  }
  function renderAim() {
    // 최대 파워(=에너지×10) 연동: 현재 파워가 상한을 넘으면 조용히 내리고 짧게 강조
    const mp = maxPower();
    if (G.aim.power > mp) { G.aim.power = mp; G.aimDirty = true; powerBig.classList.remove('clamped'); void powerBig.offsetWidth; powerBig.classList.add('clamped'); }
    const p = Math.round(G.aim.power), dir = uiDir(G.aim.angle);
    angleBig.textContent = angleLabel(G.aim.angle); powerBig.textContent = p;
    const toLeft = dir !== 'left';
    dirBtn.textContent = toLeft ? '◀' : '▶';
    dirBtn.title = toLeft ? '왼쪽으로 돌리기' : '오른쪽으로 돌리기'; dirBtn.setAttribute('aria-label', dirBtn.title);
    angleCtl.set(180 - Math.round(G.aim.angle), false); powerCtl.set(p, false);
    const ar = angleRange, pos = (180 - G.aim.angle) / 180 * 100;
    ar.style.setProperty('--lo', Math.min(50, pos) + '%'); ar.style.setProperty('--hi', Math.max(50, pos) + '%');
    const slider = aimRowP.querySelector('input[type=range]'); slider.max = String(Math.max(1, mp));
    maxPowEl.textContent = '최대 ' + mp;
    if (!owned(G.aim.weapon)) { // 소진 시에만 폴백
      if (G.aim.weapon !== 'baby_missile' && G.invFresh) toast(`${itemName(G.aim.weapon)} 소진 · ${itemName('baby_missile')}로 바꿨습니다`, 'info');
      G.aim.weapon = 'baby_missile'; G.weaponPicked = false;
    }
    wName.textContent = itemName(G.aim.weapon); wCount.textContent = '×' + owned(G.aim.weapon); weaponChip.title = itemName(G.aim.weapon) + ' — 무기 선택 [Tab]';
    if (wIcon.dataset.id !== G.aim.weapon) { wIcon.dataset.id = G.aim.weapon; clear(wIcon); wIcon.append(itemIcon(G.aim.weapon, 32)); }
  }
  function renderHud() {
    const tid = G.turn?.mode === 'seq' ? G.turn.playerId : G.me;
    const seat = G.seats.get(tid);
    whoName.textContent = seat ? seat.name : '';
    whoMarker.src = `/assets/tanks/marker_${String(seatN(tid)).padStart(2, '0')}.svg`;
    roundEl.textContent = G.rounds ? `라운드 ${G.round}/${G.rounds}` : '';
    // 바람
    const w = G.wind || 0, mag = Math.min(1, Math.abs(w) / Math.max(1, G.options.maxWind || 200));
    clear(windEl);
    if (!w) windEl.append(h('span.muted', '바람 없음'));
    else {
      const len = 14 + 26 * mag, dir = w > 0 ? 1 : -1, x0 = 22 - dir * len / 2, x1 = 22 + dir * len / 2;
      windEl.innerHTML = `<svg viewBox="0 0 44 20" aria-hidden="true"><path d="M${x0} 10 L${x1} 10 M${x1} 10 l${-dir * 6} -5 M${x1} 10 l${-dir * 6} 5" stroke="#CFE6FF" stroke-width="${2 + mag * 2}" fill="none" stroke-linecap="round"/></svg>`;
      windEl.append(h('span', String(Math.abs(w))));
    }
    windEl.setAttribute('aria-label', w ? `바람 ${w > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(w)}` : '바람 없음');
    const t = myTank(), hp = t ? t.hp : 0;
    // 체력은 '상태바' 옵션이 켜졌을 때만 상시 표시(원본 기본 끔). 최대 파워는 파워 옆에 항상
    energy.hidden = !G.options.statusBar;
    energyBar.style.width = hp + '%'; energyTxt.textContent = `에너지 ${hp} · 최대 ${hp * 10}`;
    maxPowEl.textContent = '최대 ' + maxPower();
    renderAim(); renderQuick(); renderPlayers();
    fireBtn.disabled = !isMyTurn();
    fireBtn.textContent = G.turn?.mode === 'sync' && G.readyIds.has(G.me) ? '준비 완료' : '발사';
  }
  function renderQuick() {
    clear(quick);
    const t = myTank();
    // 보유 0개 장비는 켜짐(초록) 표시 금지
    const q = (icon, label, n, on, onclick, title, disabled) => h('button.qi' + (on ? '.on' : ''), { type: 'button', title: title + (n != null ? ` · ${n}` : ''), disabled, 'aria-pressed': on ? 'true' : 'false', onclick }, itemIcon(icon, 24), h('span.ql', label), n != null ? h('b', String(n)) : null);
    const shieldHave = SHIELD_ITEMS.find(id => owned(id) > 0);
    quick.append(
      q('battery', '배터리', owned('battery'), false, () => act('battery'), '배터리 [b]', !owned('battery') || (t?.hp ?? 100) >= 100),
      q('parachute', '파라슈트', owned('parachute'), !!t?.parachute?.on && owned('parachute') > 0, () => act('parachute', { on: !t?.parachute?.on, threshold: t?.parachute?.threshold ?? 5 }), '파라슈트 [p]'),
      q(t?.shield?.item || shieldHave || 'shield', '실드', t?.shield ? Math.round(100 * t.shield.hp / (SHIELD_MAX[t.shield.item] || 100)) + '%' : null, !!t?.shield, () => openControl(), '실드 [s]'),
      q(G.guidance || 'heat_guidance', '유도', G.guidance ? GUIDANCE[G.guidance] : null, !!G.guidance, () => openControl(), '유도 [g]'),
      q('contact_trigger', '트리거', owned('contact_trigger'), G.trigger && owned('contact_trigger') > 0, () => { if (!owned('contact_trigger')) return toast('컨택트 트리거가 없습니다', 'error'); G.trigger = !G.trigger; renderQuick(); }, '컨택트 트리거 [-]', !owned('contact_trigger')),
      q('fuel_tank', '연료', (t?.fuel ?? 0) + owned('fuel_tank') * 10, false, () => openMove(), '연료 [f]', A.meta.types[t?.type]?.can_move === false));
  }
  function renderPlayers() {
    clear(plist);
    const tid = G.turn?.mode === 'seq' ? G.turn.playerId : null;
    for (const [id, s] of G.seats) {
      const t = R.tanks.get(id), n = s.color + 1, alive = t?.alive !== false;
      plist.append(h('div.prow' + (id === tid ? '.turn' : '') + (alive ? '' : '.dead'), { role: 'listitem', 'aria-current': id === tid ? 'true' : null, onclick: () => tankInfo(id) },
        h('img.marker', { src: `/assets/tanks/marker_${String(n).padStart(2, '0')}.svg`, alt: `${n}번`, style: { width: '22px', height: '22px' } }),
        h('span.nm', s.name, s.kind === 'computer' ? ' (컴퓨터)' : '', s.proxy ? ' · 대행' : '', id === G.me ? ' · 나' : ''),
        h('span.tabular', !alive && G.phase !== 'over' ? '×' : G.options.statusBar ? String(t?.hp ?? 100) : (t?.score ?? s.score) != null ? String(t?.score ?? s.score) : ''),
        G.options.statusBar ? h('div.bar', h('i', { style: { width: (t?.hp ?? 0) + '%', background: playerColor(n).P } })) : null,
        h('div.sub', G.readyIds.has(id) ? h('span', { style: { color: 'var(--ok)' } }, '준비') : null, t?.shield ? h('span', '실드') : null, s.connected === false ? h('span', '연결 끊김') : null)));
    }
  }
  function renderTimer() {
    const t = G.turn, s = G.phase === 'aim' && t?.deadline ? remainSec(t.deadline, net.offset) : null;
    if (s == null) { timer.hidden = true; return; }
    timer.hidden = false;
    const sec = Math.ceil(s); timerTxt.textContent = sec + '초';
    timerBar.style.width = (t.limitMs ? clamp(s * 1000 / t.limitMs, 0, 1) * 100 : 0) + '%';
    const urgent = s <= 10; timer.classList.toggle('urgent', urgent); timer.classList.toggle('blink', urgent);
    if (urgent && !G.warned && isMyTurn()) { G.warned = true; announce(`남은 시간 ${sec}초`); }
  }

  // ---------- 월드 동기화 ----------
  function tankFromView(v) {
    const seat = G.seats.get(v.id);
    return {
      id: v.id, n: (v.colorIndex ?? seat?.color ?? 0) + 1, type: v.tankType || seat?.tank || 'classic', name: v.name || seat?.name,
      x: v.x, y: v.y, alive: v.alive !== false, gone: v.alive === false, hp: v.hp ?? 100, angle: v.angle ?? 45, power: v.power, weapon: v.weapon,
      shield: v.shield ? { item: v.shield.item, hp: v.shield.hp, fx: shieldFx(v.shield.item) } : null,
      parachute: v.parachute || { on: true, threshold: 5 }, fuel: v.fuel ?? 0, cash: v.cash, score: v.score,
    };
  }
  function applyRound(info, round, rounds) {
    G.round = round ?? info.round; G.rounds = rounds ?? G.rounds; G.wind = info.wind ?? 0;
    G.wall = String(info.wall || 'none').toUpperCase(); G.sky = String(info.sky || 'plain').toUpperCase();
    G.interest = info.interest?.[G.me] || 0;
    const t = info.terrain || {};
    R.setWorld({ w: t.w || 360, h: t.h || 480, sky: G.sky, walls: G.wall, terrain: t, seed: G.round * 7 + 3 });
    R.tracePathsOn = !!G.options.tracePaths; R.bombIcon = G.options.bombIcon;
    R.tanks.clear();
    for (const v of info.tanks || []) R.tanks.set(v.id, tankFromView(v));
    // 라운드 시작 점수(결과 창의 '이번 라운드' 획득액 기준). 뷰에 score 가 없으면 직전 라운드 결과 점수
    G.roundStartScore = new Map([...G.seats.keys()].map(id => [id, info.tanks?.find(v => v.id === id)?.score ?? G.lastScores?.get(id) ?? 0]));
    const me = myTank();
    if (me) { G.aim.angle = me.angle; G.aim.power = clamp(me.power ?? 400, 0, me.hp * 10); if (!G.weaponPicked && me.weapon && owned(me.weapon)) G.aim.weapon = me.weapon; }
    G.guidance = null; G.trigger = false;
    if (info.terrain && !info.tanks) toast('지형 정보가 없습니다', 'warn');
    announce(`라운드 ${G.round} 시작. 하늘 ${SKY[G.sky] || ''}, 벽 ${WALLS[G.wall] || ''}`);
    renderHud();
  }
  function applyState(st) {
    if (!st) return;
    if (st.tanks) for (const [id, d] of Object.entries(st.tanks)) {
      const t = R.tanks.get(id); if (!t) continue;
      for (const k of ['x', 'y', 'hp', 'alive', 'angle', 'fuel', 'parachute']) if (d[k] !== undefined && !(k === 'angle' && id === G.me && t.alive)) t[k] = d[k]; // 내 포신은 예약 조준 유지
      if (d.alive === false && !G.playbacks.some(p => !p.done && p.dies.has(id))) t.gone = true; // 스냅샷상 사망 = 잔해 없음(재생 중 사망 연출은 유지)
      if (d.shield !== undefined) t.shield = d.shield ? { item: d.shield.item, hp: d.shield.hp, fx: shieldFx(d.shield.item) } : null;
    }
    if (st.wind !== undefined) G.wind = st.wind;
    if (st.players?.[G.me]?.cash != null) G.inv.cash = st.players[G.me].cash;
  }
  function play(events, { state, onDone } = {}) {
    if (!events?.length) { applyState(state); renderHud(); onDone && onDone(); return; }
    const pb = new Playback(R, events, {
      seed: (G.shotSeq = (G.shotSeq || 0) + 1),
      onEvent: e => {
        if (e.t === 'death') { const s = G.seats.get(e.tank); if (s) announce(`${s.name} 탱크 파괴`); renderPlayers(); }
        else if (e.t === 'hp' || e.t === 'shield') { renderPlayers(); if (e.tank === G.me) renderAim(); }
        else if (e.t === 'fire' && e.pid === G.me && e.weapon && e.weapon !== 'baby_missile' && !G.invFresh) { G.inv.items[e.weapon] = Math.max(0, owned(e.weapon) - 1); }
      },
      onDone: () => { G.playbacks = G.playbacks.filter(p => p !== pb); applyState(state); renderHud(); onDone && onDone(); },
    });
    G.playbacks.push(pb);
  }
  R.onFrame = dt => {
    for (const pb of [...G.playbacks]) pb.step(dt);
    applyHeldKeys(dt);
    if (G.aimDirty && performance.now() - G.lastAimSent > 100 && isMyTurn() && G.turn?.mode !== 'sync') {
      G.aimDirty = false; G.lastAimSent = performance.now();
      net.send('aim', { angle: Math.round(G.aim.angle), power: Math.round(G.aim.power), weapon: G.aim.weapon });
    }
    renderTimer();
  };
  document.addEventListener('visibilitychange', onVis);
  function onVis() { if (document.hidden) return; for (const pb of [...G.playbacks]) pb.finish(); }

  // ---------- 서버 메시지 ----------
  const off = [];
  const on = (t, fn) => off.push(net.on(t, fn));
  function setSeats(seats) { G.seats.clear(); for (const s of seats || []) G.seats.set(s.id, s); }
  if (data?.start) { setSeats(data.start.seats); G.options = data.start.options || {}; G.rounds = G.options.rounds; }
  if (data?.resume) {
    const m = data.resume; setSeats(m.seats); G.options = m.options || {}; G.phase = m.phase; G.round = m.round; G.rounds = m.rounds;
    if (m.snapshot) {
      applyRound({ ...m.snapshot, terrain: m.snapshot.terrain, tanks: m.snapshot.tanks }, m.round, m.rounds);
      applyMe({ inventory: m.snapshot.inventory, tank: m.snapshot.you });
    }
    G.turn = m.turn || null; G.readyIds = new Set(m.readyIds || []);
    if (m.phase === 'shop' && m.shop) shop.turn(m.shop);
    renderHud();
  }
  on('round_start', m => { shop.close(); closeRoundModal(); G.phase = 'starting'; G.turn = null; G.readyIds.clear(); if (m.info) applyRound(m.info, m.round, m.rounds); play(m.events); });
  // 개인 채널(PROTOCOL 6.7): 본인 인벤토리·현금·연료·장비 설정은 me로만 온다
  on('me', m => applyMe(m));
  function applyMe(m) {
    if (m.inventory) { G.inv = m.inventory; G.invFresh = true; }
    if (m.interest != null) G.interest = m.interest;
    const t = myTank(), v = m.tank || m.you;
    if (t && v) {
      for (const k of ['fuel', 'parachute', 'hp']) if (v[k] !== undefined) t[k] = v[k];
      if (v.shield !== undefined) t.shield = v.shield ? { item: v.shield.item, hp: v.shield.hp, fx: shieldFx(v.shield.item) } : null;
      if (v.trigger !== undefined) G.trigger = !!v.trigger;
      if (v.guidance !== undefined) G.guidance = v.guidance ? Object.keys(GUIDANCE_TYPE).find(id => GUIDANCE_TYPE[id] === v.guidance.type) || null : null;
      if (!G.playbacks.length && v.x != null) { t.x = v.x; t.y = v.y; }
      if (!G.weaponPicked && !isMyTurn() && v.weapon && owned(v.weapon)) G.aim.weapon = v.weapon; // 직접 고른 적 없을 때만 서버 값
    }
    if (G.myCashCell && m.inventory) G.myCashCell.textContent = fmtMoney(G.inv.cash ?? 0); // 정산 반영 현금
    renderHud(); shop.refresh(); G.redrawControl && G.redrawControl(); G.moveLayer?.upd();
  }
  on('turn', m => {
    G.phase = 'aim'; G.turn = m; G.warned = false;
    if (m.mode === 'sync') G.readyIds = new Set();
    R.turnId = m.mode === 'seq' ? m.playerId : null;
    R.readyIds = G.readyIds;
    if (m.events?.length) play(m.events);
    const s = G.seats.get(m.playerId);
    if (m.mode === 'seq' && m.playerId === G.me && !m.auto) { announce('내 턴입니다'); const t = myTank(); if (t) t.angle = G.aim.angle; G.aimDirty = true; G.lastAimSent = 0; }
    else if (m.mode === 'seq' && s) announce(`${s.name}의 턴`);
    else if (m.mode === 'sync') announce('조준 단계');
    renderHud();
  });
  on('aim', m => { if (m.playerId === G.me) return; const t = R.tanks.get(m.playerId); if (t && m.angle != null) t.angle = m.angle; });
  on('ready', m => { G.readyIds = new Set(m.readyIds || []); R.readyIds = G.readyIds; renderHud(); });
  on('shot', m => {
    if (G.turn?.mode !== 'sim') { G.phase = 'resolving'; G.turn = G.turn?.mode === 'sync' ? null : G.turn && { ...G.turn, deadline: null }; }
    R.readyIds = new Set();
    play(m.events, { state: m.state });
    renderHud();
  });
  on('act_result', m => {
    play(m.events, { state: null });
    const st = m.state; const t = R.tanks.get(m.playerId);
    if (t && st) {
      if (st.x != null && !m.events?.some(e => e.t === 'tankFall')) { t.x = st.x; t.y = st.y; }
      else if (st.x != null) t.x = st.x;
      if (st.fuel != null) t.fuel = st.fuel;
      if (st.tank) Object.assign(t, tankFromView({ ...st.tank, id: t.id }), { x: t.x, y: t.y });
      if (st.parachute) t.parachute = st.parachute;
      if (st.hp != null) t.hp = st.hp;
    }
    renderHud();
  });
  // 정산 점수를 우측 플레이어 패널(탱크·좌석 점수)에 반영
  function setScores(list) { for (const s of list || []) { if (s?.score == null) continue; const t = R.tanks.get(s.id); if (t) t.score = s.score; const seat = G.seats.get(s.id); if (seat) seat.score = s.score; } }
  on('round_end', m => { G.lastScores = new Map((m.state?.scores || []).map(s => [s.id, s.score])); setScores(m.state?.scores); setScores(m.ranking); G.phase = 'roundEnd'; G.turn = null; R.turnId = null; renderHud(); const showIt = () => showRoundEnd(m); waitPlayback(showIt); });
  // 결과 창이 사망 폭발을 가리지 않도록 재생이 끝난 뒤(+잔해 연기 잠깐) 띄움. 서버 정산 대기(4초) 안에서 최대 3.2초
  function waitPlayback(fn) {
    if (!G.playbacks.length) return fn();
    const t0 = performance.now();
    const tick = () => {
      if (G.phase !== 'roundEnd') return;
      if (!G.playbacks.length) return setTimeout(() => { if (G.phase === 'roundEnd') fn(); }, 700);
      if (performance.now() - t0 > 3200) return fn();
      setTimeout(tick, 100);
    };
    tick();
  }
  on('shop_turn', m => { closeRoundModal(); G.phase = 'shop'; G.turn = null; shop.turn(m); renderHud(); });
  on('shop_result', m => { if (m.snapshot) applyMe({ inventory: m.snapshot.inventory, tank: m.snapshot.you }); shop.result(m); renderHud(); });
  on('sell_quote', m => shop.quote(m));
  on('shop_end', () => shop.close());
  on('game_over', m => { closeRoundModal(); shop.close(); for (let i = 0; i < 10 && isOverlayOpen(); i++) closeTop(); /* 결과·시트·드로어 모두 닫고 최종 순위만 */ G.phase = 'over'; G.ranking = m.ranking; setScores(m.ranking); renderPlayers(); showFinal(m.ranking); });

  // ---------- 발사 ----------
  async function tryFire() {
    if (!isMyTurn()) { if (G.phase === 'aim') toast('내 턴이 아닙니다', 'error'); return; }
    const weapon = G.aim.weapon;
    const input = { weapon, angle: Math.round(G.aim.angle), power: Math.round(clamp(G.aim.power, 0, maxPower())) };
    if (ENERGY_WEAPONS.has(weapon)) {
      const n = await pickBatteries(); if (n == null) return; input.batteries = n;
    }
    if (G.guidance && !UNGUIDABLE.has(weapon)) {
      input.guidance = GUIDANCE_TYPE[G.guidance];
      if (G.guidance !== 'heat_guidance') { const tg = await pickTarget(); if (tg == null) return; input.target = tg; }
    }
    if (G.trigger) input.trigger = true;
    if (!isMyTurn()) return;
    net.send('fire', input);
    if (G.guidance && !UNGUIDABLE.has(weapon)) { G.guidance = null; }
    if (G.trigger) G.trigger = false;
    renderHud();
  }
  function pickBatteries() {
    return new Promise(res => {
      const max = Math.min(9, owned('battery')); let done = false;
      const chips = h('div.chips', { style: { gap: '8px' } });
      for (let i = 0; i <= max; i++) chips.append(h('button.btn', { type: 'button', style: { minWidth: '52px' }, onclick: () => { done = true; res(i); L.close(); } }, String(i)));
      const L = openLayer({ title: '배터리 수', kind: 'modal', className: 'confirm-like', body: [chips, h('p.muted', h('kbd', '0'), '~', h('kbd', String(max)))], onClose: () => { if (!done) res(null); } });
      L.pick = i => { if (i <= max) { done = true; res(i); L.close(); } };
      G.batteryLayer = L;
    });
  }
  function pickTarget() {
    return new Promise(res => {
      G.targeting = v => { G.targeting = null; R.selectTarget = false; stage.classList.remove('targeting'); banner.hidden = true; res(v); };
      R.selectTarget = true; stage.classList.add('targeting'); banner.hidden = false; banner.textContent = '표적을 선택하세요';
      announce('표적을 선택하세요');
    });
  }
  function aliveByNumber(num) { // 화면 왼쪽부터 1..9, 0=10번째
    const list = [...R.tanks.values()].filter(t => t.alive).sort((a, b) => a.x - b.x);
    return list[(num === 0 ? 10 : num) - 1] || null;
  }

  // ---------- 캔버스 포인터 ----------
  canvas.addEventListener('pointermove', e => { if (R.selectTarget) R.hoverPt = R.toWorld(e.clientX, e.clientY); });
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = R.toWorld(e.clientX, e.clientY);
    const t = R.tankAt(x, y);
    if (G.targeting) { G.targeting(t ? t.id : { x: Math.round(x), y: Math.round(y) }); return; }
    if (t) tankInfo(t.id);
  });

  // ---------- 장비 동작 ----------
  function act(action, payload = {}) {
    if (!isMyTurn()) { toast('내 턴이 아닙니다', 'error'); return; }
    net.send('act', { action, ...payload });
  }
  function tankInfo(id) {
    const t = R.tanks.get(id), s = G.seats.get(id); if (!t || !s) return;
    const sh = t.shield ? `${itemName(t.shield.item)} ${Math.round(100 * t.shield.hp / (SHIELD_MAX[t.shield.item] || 100))}%` : '실드 없음';
    toast(h('span.tinfo', t.weapon ? itemIcon(t.weapon, 24) : null, t.shield ? itemIcon(t.shield.item, 24) : null,
      h('span', `${seatN(id)}번 ${s.name} · 에너지 ${t.hp} · ${sh}${t.score != null ? ' · 점수 ' + t.score : ''}`)), 'info');
  }

  function openWeaponSheet() {
    const grid = h('div.weapon-grid');
    for (const id of ownedWeapons()) {
      const it = A.itemById.get(id);
      grid.append(h('button.card.wcard', { type: 'button', 'aria-pressed': String(id === G.aim.weapon), title: it?.detail || '', onclick: () => { setAim({ weapon: id }); L.close(); } },
        h('div.wc-head', itemIcon(id, 48), h('span.n', it?.name_ko || id)), h('span.c', '×' + owned(id)), h('span.s', it?.short || '')));
    }
    const L = openLayer({ title: '무기', kind: 'sheet', body: grid });
  }
  function cycleWeapon(dir) {
    const list = ownedWeapons(); if (!list.length) return;
    const i = list.indexOf(G.aim.weapon);
    setAim({ weapon: list[(i + dir + list.length) % list.length] });
    announce(itemName(G.aim.weapon));
  }

  function openControl() {
    const t = myTank(); if (!t) return;
    const body = h('div.cp-grid');
    const L = openLayer({ title: '탱크 제어판', kind: 'drawer', body });
    const draw = () => {
      clear(body);
      const tt = myTank();
      body.append(
        h('div.card.cp-item', h('div.top', h('h3', '에너지'), h('b', String(tt.hp))),
          h('div.energy', h('div.eb', h('i', { style: { width: tt.hp + '%' } }))),
          h('div.row', h('span.muted.grow', '배터리 ×' + owned('battery')), h('button.btn.small', { type: 'button', disabled: !owned('battery') || tt.hp >= 100, onclick: () => act('battery') }, '사용'))),
        h('div.card.cp-item', h('div.top', h('h3', '파라슈트'), h('span.muted', '×' + owned('parachute'))),
          switchCtl({ label: tt.parachute?.on ? '전개' : '대기', value: !!tt.parachute?.on, onChange: v => act('parachute', { on: v, threshold: tt.parachute?.threshold ?? 5 }) }),
          rangeCtl({ label: '안전 임계값', min: 1, max: 100, step: 1, value: tt.parachute?.threshold ?? 5, onChange: v => { clearTimeout(G.thT); G.thT = setTimeout(() => act('parachute', { on: !!tt.parachute?.on, threshold: v }), 300); } })),
        shieldBox(tt),
        h('div.card.cp-item', h('div.top', h('h3', '트리거'), h('span.muted', '×' + owned('contact_trigger'))),
          switchCtl({ label: '컨택트 트리거', value: G.trigger, disabled: !owned('contact_trigger'), onChange: v => { G.trigger = v; renderQuick(); } })),
        h('div.card.cp-item', h('div.top', h('h3', '유도')),
          segmentCtl({ label: '유도 장치', value: G.guidance || 'none', onChange: v => { G.guidance = v === 'none' ? null : v; renderQuick(); },
            choices: Object.entries(GUIDANCE).map(([id, lab]) => ({ v: id, label: id === 'none' ? lab : `${lab} ×${owned(id)}`, hint: A.itemById.get(id)?.name_ko })).filter(c => c.v === 'none' || owned(c.v) > 0) })),
        h('div.card.cp-item', h('div.top', h('h3', '연료'), h('b', String((tt.fuel ?? 0) + owned('fuel_tank') * 10))),
          h('button.btn', { type: 'button', disabled: A.meta.types[tt.type]?.can_move === false, onclick: () => { L.close(); openMove(); } }, '이동')));
    };
    draw();
    G.redrawControl = () => { if (!L.closed) draw(); };
  }
  function shieldBox(tt) {
    const have = SHIELD_ITEMS.filter(id => owned(id) > 0);
    let sel = have[0] || null;
    const cur = tt.shield ? `${itemName(tt.shield.item)} ${Math.round(100 * tt.shield.hp / (SHIELD_MAX[tt.shield.item] || 100))}%` : '실드 없음';
    const box = h('div.card.cp-item', h('div.top', h('h3', '실드'), h('span.muted', cur)));
    if (have.length) box.append(segmentCtl({ label: '선택한 실드', value: sel, onChange: v => { sel = v; }, choices: have.map(id => ({ v: id, label: `${itemName(id)} ×${owned(id)}` })) }));
    box.append(h('div.row', h('button.btn.small.ok', { type: 'button', disabled: !have.length, onclick: () => act('shield', { item: sel }) }, '가동'),
      h('button.btn.small', { type: 'button', disabled: !tt.shield, onclick: () => act('shield', { item: null }) }, '해제')));
    return box;
  }

  function openInventory() {
    const grid = h('div.weapon-grid');
    for (const id of ITEM_ORDER) {
      const n = owned(id); if (!n) continue;
      const it = A.itemById.get(id), isW = WEAPON_IDS.includes(id);
      let label = null, fn = null;
      if (isW) { label = '선택'; fn = () => { setAim({ weapon: id }); L.close(); }; }
      else if (id === 'battery') { label = '사용'; fn = () => act('battery'); }
      else if (SHIELD_ITEMS.includes(id)) { label = '가동'; fn = () => act('shield', { item: id }); }
      else if (id === 'parachute') { label = myTank()?.parachute?.on ? '대기' : '전개'; fn = () => act('parachute', { on: !myTank()?.parachute?.on, threshold: myTank()?.parachute?.threshold ?? 5 }); }
      else if (GUIDANCE[id]) { label = G.guidance === id ? '해제' : '선택'; fn = () => { G.guidance = G.guidance === id ? null : id; renderQuick(); L.close(); }; }
      else if (id === 'contact_trigger') { label = G.trigger ? '끄기' : '켜기'; fn = () => { G.trigger = !G.trigger; renderQuick(); L.close(); }; }
      else if (id === 'fuel_tank') { label = '이동'; fn = () => { L.close(); openMove(); }; }
      grid.append(h('div.card.wcard', { title: it?.detail || '' }, h('div.wc-head', itemIcon(id, 48), h('span.n', it?.name_ko || id)), h('span.c', '×' + n), h('span.s', it?.short || ''),
        label ? h('button.btn.small', { type: 'button', onclick: fn }, label) : null));
    }
    const L = openLayer({ title: '인벤토리', kind: 'modal', className: 'wide', body: grid });
  }

  function openMove() {
    const t = myTank(); if (!t) return;
    if (A.meta.types[t.type]?.can_move === false) { toast('고정 포대는 이동할 수 없습니다', 'error'); return; }
    if (!isMyTurn()) { toast('내 턴이 아닙니다', 'error'); return; }
    const fuelTxt = h('b.tabular');
    const upd = () => { fuelTxt.textContent = String((myTank()?.fuel ?? 0) + owned('fuel_tank') * 10); };
    const mv = dir => { if (!isMyTurn()) return; net.send('act', { action: 'move', dir, steps: 1 }); };
    const left = h('button.btn', { type: 'button', 'aria-label': '왼쪽으로 이동' }, '◀'), right = h('button.btn', { type: 'button', 'aria-label': '오른쪽으로 이동' }, '▶');
    holdRepeat(left, () => mv(-1), { interval: 90 }); holdRepeat(right, () => mv(1), { interval: 90 });
    const L = openLayer({ title: '이동 제어판', kind: 'sheet', body: [h('div.move-pad', left, h('div', { style: { textAlign: 'center' } }, h('div.muted', '남은 연료'), fuelTxt), right)], actions: [{ label: '완료', primary: true }], onClose: () => { G.moveLayer = null; } });
    G.moveLayer = { L, mv, upd }; upd();
  }

  function openMenu() {
    const item = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', style: { width: '100%', justifyContent: 'flex-start' }, onclick: () => { L.close(); fn(); } }, label);
    const L = openLayer({ title: '메뉴', kind: 'drawer', body: h('div', { style: { display: 'grid', gap: '8px' } },
      item('현황 [u]', () => openStatus()),
      item('도움말 [?]', () => openHelp()),
      item(document.fullscreenElement ? '전체 화면 끝내기' : '전체 화면', () => toggleFullscreen()),
      item(R.tankSize === 'big' ? '탱크 크기: 원작(판정과 같게)' : '탱크 크기: 크게', () => { R.tankSize = R.tankSize === 'big' ? 'orig' : 'big'; try { localStorage.setItem('se.tankSize', R.tankSize); } catch {} }),
      item(R.showGauge ? '탱크 밑 게이지 숨기기' : '탱크 밑 게이지 표시', () => { R.showGauge = !R.showGauge; try { localStorage.setItem('se.tankGauge', R.showGauge ? '1' : '0'); } catch {} }),
      item('화면 지우기', () => R.clearScreen()),
      item('후퇴 [r]', () => doRetreat(), '.danger'),
      item('방 나가기', async () => { if (await confirmDialog('정말 그만둘까요?', { okLabel: '나가기', danger: true })) net.send('leave_room'); }),
    ) });
  }
  // Fullscreen API. F 키는 원본 '이동(f)'과 충돌하므로 단축키 없이 메뉴에서만
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement) { d.exitFullscreen?.().catch(() => {}); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { toast('이 브라우저는 전체 화면을 지원하지 않습니다', 'error'); return; }
    Promise.resolve(req.call(el, { navigationUI: 'hide' })).catch(() => toast('전체 화면으로 전환할 수 없습니다', 'error'));
  }
  async function doRetreat() {
    if (!(G.turn?.mode === 'seq' && isMyTurn())) { toast('지금은 후퇴할 수 없습니다', 'error'); return; }
    if (await confirmDialog('정말 후퇴할까요?', { okLabel: '후퇴', danger: true })) net.send('retreat');
  }
  function openStatus() {
    const row = (k, v) => h('div.row', { style: { minHeight: '36px', borderBottom: '1px solid var(--line)' } }, h('span.grow.muted', k), h('b', v));
    openLayer({ title: '현황', kind: 'modal', body: [
      row('라운드', `${G.round} / ${G.rounds}`), row('남은 라운드', String(Math.max(0, G.rounds - G.round))),
      row('진행 방식', MODE[G.options.mode] || ''), row('바람', G.wind ? `${G.wind > 0 ? '→' : '←'} ${Math.abs(G.wind)}` : '바람 없음'),
      row('벽', WALLS[G.wall] || G.wall), row('하늘', SKY[G.sky] || G.sky), row('현금', fmtMoney(G.inv.cash)), row('이자', fmtMoney(G.interest)),
    ] });
  }
  function openHelp() {
    const k = (keys, d) => [h('span', keys.map(x => h('kbd', x)).reduce((a, b) => [...a, ' ', b], [])), h('span', d)];
    openLayer({ title: '단축키', kind: 'modal', body: h('div.keys',
      k(['↑', '↓'], '파워'), k(['PgUp', 'PgDn'], '파워 빠르게'), k(['←', '→'], '각도'), k(['Shift'], '느리게'), k(['Alt'], '1단위'),
      k(['Tab', 'Shift+Tab'], '무기 전환'), k(['Space', 'Enter'], '발사'), k(['t'], '탱크 제어판'), k(['i'], '인벤토리'), k(['f'], '이동'),
      k(['b', 'p', 's', 'e', 'g', '-'], '배터리·파라슈트·실드 선택·실드 가동·유도·트리거'), k(['r'], '후퇴'), k(['u'], '현황'), k(['1~9', '0'], '탱크 정보 / 표적'), k(['F1'], '메뉴')) });
  }

  // ---------- 결과 ----------
  let roundModal = null;
  function closeRoundModal() { if (roundModal) { roundModal.close(); roundModal = null; } }
  // 라운드 결과: 서버 공개판엔 현금이 없다(PROTOCOL 6.1). 점수와 현금은 같이 움직이므로(엔진 _addScore) 점수 증가분 = 이번 라운드 획득액.
  // 보유 현금은 본인만(me 채널), 타인은 획득액만
  function rankTable(ranking, winners = [], { round = false, payouts = {} } = {}) {
    const tb = h('tbody'); G.myCashCell = null;
    (ranking || []).forEach((r, i) => {
      const n = seatN(r.id), me = r.id === G.me;
      const gain = round && r.gain != null ? h('td.tabular', { title: payouts[r.id] ? `생존 보상 ${fmtMoney(payouts[r.id])} 포함` : '' }, (r.gain >= 0 ? '+' : '−') + fmtMoney(Math.abs(r.gain))) : round ? h('td', '') : null;
      let cash;
      if (round) { cash = h('td.tabular', me ? fmtMoney(G.inv.cash ?? 0) : ''); if (me) G.myCashCell = cash; }
      else cash = h('td', r.cash != null ? fmtMoney(r.cash) : '-');
      tb.append(h('tr' + (winners.includes(r.id) || (!winners.length && i === 0) ? '.win' : '') + (me ? '.me' : ''),
        h('td', String(i + 1)), h('td', h('img.marker', { src: `/assets/tanks/marker_${String(n).padStart(2, '0')}.svg`, alt: '', style: { width: '18px', height: '18px', display: 'inline', verticalAlign: 'middle', marginRight: '6px' } }), r.name || G.seats.get(r.id)?.name || r.id),
        h('td', String(r.score ?? 0)), gain, cash, r.netWorth != null ? h('td', fmtMoney(r.netWorth)) : null));
    });
    const greedy = (ranking || []).some(r => r.netWorth != null);
    return h('table.rank', h('thead', h('tr', h('th', '#'), h('th', '플레이어'), h('th', '점수'), round ? h('th', '이번 라운드') : null, h('th', round ? '내 보유 현금' : '현금'), greedy ? h('th', '순자산') : null)), tb);
  }
  function showRoundEnd(m) {
    closeRoundModal();
    const winners = m.state?.winners || [];
    const ranking = m.ranking || m.state?.ranking || [];
    const scores = new Map((m.state?.scores || []).map(s => [s.id, s]));
    const rk = ranking.map(r => {
      const score = r.score ?? scores.get(r.id)?.score;
      const base = G.roundStartScore?.get(r.id);
      return { ...r, score, gain: score != null && base != null ? score - base : null };
    });
    const win = winners.map(id => G.seats.get(id)?.name).filter(Boolean).join(', ');
    roundModal = openLayer({ title: `라운드 ${m.round} 결과`, kind: 'modal', body: [win ? h('p', '승리: ', h('b', win)) : null, rankTable(rk, winners, { round: true, payouts: m.state?.payouts || {} })], onClose: () => { roundModal = null; G.myCashCell = null; } });
    announce(`라운드 ${m.round} 종료${win ? ', 승리 ' + win : ''}`);
  }
  function showFinal(ranking) {
    clear(overlay); overlay.style.pointerEvents = 'auto';
    const btn = h('button.btn.primary', { type: 'button', onclick: () => { if (G.backToRoom) app.go('room'); else { G.wantRoom = true; btn.disabled = true; btn.textContent = '대기실로 이동 중…'; } } }, '대기실로');
    overlay.append(h('div.result', { role: 'dialog', 'aria-label': '최종 순위' }, h('div.card', h('h1', '최종 순위'), rankTable(ranking), h('div.row', h('div.spacer'), btn))));
    setTimeout(() => btn.focus(), 50);
    announce('게임 종료. 최종 순위 ' + (ranking?.[0]?.name || ''));
  }

  // ---------- 키보드 ----------
  const held = new Set(); let acc = { a: 0, p: 0 };
  function applyHeldKeys(dt) {
    if (!held.size || !canAim() || isOverlayOpen()) { acc = { a: 0, p: 0 }; return; }
    const slow = held.has('Shift');
    let da = 0, dp = 0;
    if (held.has('ArrowLeft')) da += 1; if (held.has('ArrowRight')) da -= 1;
    if (held.has('ArrowUp')) dp += 1; if (held.has('ArrowDown')) dp -= 1;
    let fast = 0; if (held.has('PageUp')) fast += 1; if (held.has('PageDown')) fast -= 1;
    acc.a += da * (slow ? RATE.angleSlow : RATE.angle) * dt;
    acc.p += dp * (slow ? RATE.powerSlow : RATE.power) * dt + fast * RATE.powerFast * dt;
    const ia = Math.trunc(acc.a), ip = Math.trunc(acc.p);
    if (ia || ip) { acc.a -= ia; acc.p -= ip; setAim({ angle: G.aim.angle + ia, power: G.aim.power + ip }, true); }
  }
  function onKeyDown(e) {
    if (isTyping(e.target) || G.phase === 'over') return;
    const k = e.key;
    if (k === 'F1' || (e.altKey && (k === 's' || k === 'S'))) { e.preventDefault(); openMenu(); return; }
    // 레이어가 열려 있을 때: 이동 제어판·배터리·표적만 게임 키 처리
    if (G.moveLayer && !G.moveLayer.L.closed) {
      if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); G.moveLayer.mv(k === 'ArrowLeft' ? -1 : 1); }
      return;
    }
    if (G.batteryLayer && !G.batteryLayer.closed && /^[0-9]$/.test(k)) { e.preventDefault(); G.batteryLayer.pick(+k); return; }
    if (G.targeting) {
      if (k === 'Escape') { e.preventDefault(); G.targeting(null); return; }
      if (/^[0-9]$/.test(k)) { e.preventDefault(); const t = aliveByNumber(+k); if (t) G.targeting(t.id); return; }
    }
    if (isOverlayOpen() || shop.isOpen()) return;
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
    if (arrows.includes(k)) {
      e.preventDefault();
      if (e.altKey) { // 1단위
        if (!canAim()) return;
        const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0], PageUp: [0, 10], PageDown: [0, -10] }[k];
        setAim({ angle: G.aim.angle + d[0], power: G.aim.power + d[1] }, true); return;
      }
      if (!held.has(k)) { held.add(k); const s = e.shiftKey; if (canAim()) { const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0], PageUp: [0, s ? 5 : 15], PageDown: [0, s ? -5 : -15] }[k]; setAim({ angle: G.aim.angle + d[0], power: G.aim.power + d[1] }, true); acc = { a: 0, p: 0 }; } }
      return;
    }
    if (k === 'Shift') { held.add('Shift'); return; }
    if (k === 'Tab') { e.preventDefault(); cycleWeapon(e.shiftKey ? -1 : 1); return; }
    if (k === ' ' || k === 'Enter') {
      // 게임 화면(입력칸·열린 레이어 밖)에서는 포커스 위치와 상관없이 항상 발사. 포커스된 버튼의 기본 동작은 막음
      e.preventDefault(); if (!e.repeat) tryFire();
      if (e.target && e.target !== document.body && e.target.blur && e.target.closest?.('.game')) { e.target.blur(); canvas.focus({ preventScroll: true }); }
      return;
    }
    const lower = k.length === 1 ? k.toLowerCase() : k;
    const map = {
      t: openControl, i: openInventory, f: openMove, r: doRetreat, u: openStatus, '?': openHelp,
      b: () => act('battery'),
      p: () => { const t = myTank(); act('parachute', { on: !t?.parachute?.on, threshold: t?.parachute?.threshold ?? 5 }); },
      s: openControl, e: () => { const have = SHIELD_ITEMS.find(id => owned(id) > 0); if (have) act('shield', { item: have }); else toast('실드가 없습니다', 'error'); },
      g: openControl, '-': () => { if (!owned('contact_trigger')) return toast('컨택트 트리거가 없습니다', 'error'); G.trigger = !G.trigger; renderQuick(); },
      k: () => toast('훈수 금지!'),
    };
    if (map[lower] && !e.ctrlKey && !e.metaKey && !(e.altKey && lower !== 's')) { e.preventDefault(); map[lower](); return; }
    if (/^[0-9]$/.test(k) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const t = aliveByNumber(+k); if (t) tankInfo(t.id); }
  }
  function onKeyUp(e) { held.delete(e.key); if (e.key === 'Shift') held.delete('Shift'); }
  function onBlur() { held.clear(); }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);

  // act 결과 후 열린 패널 갱신
  off.push(net.on('act_result', () => { G.redrawControl && G.redrawControl(); G.moveLayer && G.moveLayer.upd(); }));

  renderHud();
  return {
    onBackToRoom() { G.backToRoom = true; app.go('room'); }, // 서버가 방을 waiting 으로 돌리면 결과 화면에 남은 사람도 모두 대기실로
    onRoom() {},
    unmount() {
      off.forEach(f => f()); R.destroy(); layoutRO.disconnect(); delete window.__terrainCheck; delete window.__deathFx; shop.destroy?.();
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
