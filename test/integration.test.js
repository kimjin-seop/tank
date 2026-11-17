// 통합 테스트: 실제 엔진(server/engine) + 로비/방/게임 서버를 가짜 클라이언트 2명 + 컴퓨터 1대로 끝까지 돌린다.
// 시간은 FakeClock 으로 빠르게 진행한다(WebSocket 전송 계층은 server.test.js 에서 별도 검증).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLobby } from '../server/testkit.js';
import { loadEngine, makeEngineFactory } from '../server/game/engineAdapter.js';
import * as engineMod from '../server/engine/index.js';

const ROUNDS = 2;
// 방 전원에게 가는 메시지에 다른 사람의 비공개 정보가 들어가면 안 된다.
const SECRET_KEYS = new Set(['cash', 'inventory', 'fuel', 'netWorth', 'interest', 'guidance', 'trigger', 'parachute', 'items']);
function findSecret(v, path = '') {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = findSecret(v[i], `${path}[${i}]`); if (r) return r; } return null; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { if (SECRET_KEYS.has(k)) return `${path}.${k}`; const r = findSecret(x, `${path}.${k}`); if (r) return r; }
  }
  return null;
}

async function playGame(mode) {
  const engine = await loadEngine({ log: { warn() {} } });
  const ctx = makeLobby({ engine });
  const { client, clock } = ctx;
  const a = client('가나다'); const b = client('라마바');
  a.say({ t: 'create_room', title: mode, maxPlayers: 3, options: { mode, rounds: ROUNDS, cashAtStart: 100000, turnLimitSec: 30, shopLimitSec: 60, fastComputers: true } });
  b.say({ t: 'join_room', roomId: a.last('room_joined').room.id });
  a.say({ t: 'add_computer', personality: 'moron' });
  b.say({ t: 'ready', ready: true });
  a.say({ t: 'start' });
  assert.equal(a.last('game_start')?.options.mode, mode, '게임이 시작되어야 한다');

  const bots = [a, b].map((c) => ({ c, id: c.last('room_joined').you, cursor: 0, hp: 100, x: 0, tanks: [], retreatAfter: 0, turns: 0, shopped: false }));
  const act = (bot, m) => {
    if (m.t === 'round_start') { bot.tanks = m.info.tanks; bot.inRound = true; bot.turns = 0; }
    else if (m.t === 'round_end') bot.inRound = false;
    else if (m.t === 'me' && m.tank) { bot.hp = m.tank.hp; bot.alive = m.tank.alive; bot.nukes = m.inventory.items.baby_nuke || 0; }
    else if (m.t === 'shop_turn' && m.playerId === bot.id) {
      bot.c.say({ t: 'buy', item: 'baby_nuke', qty: 5 }); // 상점: 구매 -> 완료
      bot.c.say({ t: 'shop_done' });
    } else if (m.t === 'turn' && !m.auto && (mode === 'SEQUENTIAL' ? m.playerId === bot.id : mode === 'SYNCHRONOUS')) bot.wantFire = true;
  };
  const fire = (bot) => {
    const me = bot.tanks.find((t) => t.id === bot.id);
    const foe = bot.tanks.find((t) => t.id !== bot.id && t.alive);
    const angle = foe && me && foe.x < me.x ? 135 : 45;
    const power = Math.min(bot.hp * 10, 300 + ((bot.turns * 137) % 500));
    bot.turns++;
    // 순차 모드: 라운드가 오래 가지 않도록 일정 횟수 뒤 후퇴(후퇴·발사 모두 실제 엔진 경로)
    if (mode === 'SEQUENTIAL' && bot.turns > 3 + (bot.id === bots[0].id ? 1 : 0)) bot.c.say({ t: 'retreat' });
    else bot.c.say({ t: 'fire', weapon: bot.nukes > 0 && bot.turns % 2 ? 'baby_nuke' : 'baby_missile', angle, power });
  };

  let iter = 0;
  for (; iter < 4000 && !(a.last('back_to_room') && b.last('back_to_room')); iter++) {
    for (const bot of bots) {
      while (bot.cursor < bot.c.inbox.length) act(bot, bot.c.inbox[bot.cursor++]);
      if (bot.wantFire) { bot.wantFire = false; fire(bot); }
      else if (mode === 'SIMULTANEOUS' && bot.inRound && bot.alive) fire(bot);
    }
    clock.advance(1000);
  }
  return { ctx, a, b, bots, iter };
}

for (const mode of ['SEQUENTIAL', 'SYNCHRONOUS', 'SIMULTANEOUS']) {
  test(`실제 엔진 ${mode}: 방 생성~발사~상점~종료~대기실 복귀`, async () => {
    const { a, b, iter } = await playGame(mode);
    for (const c of [a, b]) {
      assert.ok(iter < 4000, `게임이 끝나지 않음(${mode})`);
      assert.equal(c.all('round_start').length, ROUNDS);
      assert.equal(c.all('round_end').length, ROUNDS);
      assert.ok(c.all('shot').length >= 2, '샷이 있어야 한다');
      assert.ok(c.all('shop_turn').length + c.all('shop_end').length >= 2, '상점 단계가 있어야 한다');
      assert.equal(c.last('game_over').ranking.length, 3);
      assert.equal(c.last('room_state').room.status, 'waiting');
      assert.equal(c.all('toast').filter((t) => t.code === 'INTERNAL').length, 0, '엔진 오류 없음');
      const errs = c.all('error').filter((e) => !(mode === 'SIMULTANEOUS' && e.code === 'WRONG_PHASE'));
      assert.deepEqual(errs.map((e) => e.code + ':' + (e.params?.reason ?? '')), [], '정상 입력은 거절되지 않는다');
      // 공개 메시지에 비공개 정보(현금·인벤토리 등) 없음 + 비공개 메시지는 본인 것만
      for (const m of c.inbox) {
        if (['round_start', 'shot', 'round_end', 'turn'].includes(m.t)) assert.equal(findSecret(m), null, `${m.t} 에 비공개 정보 노출`);
        if (m.t === 'act_result' && m.playerId !== c.last('room_joined').you) assert.equal(findSecret(m), null);
        if (m.t === 'me') assert.equal(m.tank?.id ?? c.last('room_joined').you, c.last('room_joined').you);
      }
      assert.ok(c.all('me').length > 0 && c.last('me').inventory.items);
    }
    // 정산 결과: 현금 없는 공개 Settlement
    assert.deepEqual(Object.keys(a.last('round_end').state.scores[0]).sort(), ['id', 'score']);
  });
}

test('어댑터: 사람 탱크 대행(aiAct)·상점 aiShop·죽은 플레이어 턴 건너뛰기', async () => {
  const f = await loadEngine({ log: { warn() {} } });
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: i, tank: 'classic', team: 1, ai: i === 2 ? 'moron' : null }));
  const opts = { rounds: 2, mode: 'SEQUENTIAL', wallEffect: 'NONE', sky: 'PLAIN', maxWind: 0, cashAtStart: 100000, computersBuy: true, playOrder: 'ROUND_ROBIN', scannedMountains: 0 };
  const port = f.createGame({ options: { ...opts }, players: mk(3), seed: 7 });
  port.startRound();
  // 사람 탱크는 대행 지정 전에는 aiAct 불가, 지정 후에는 moron 으로 발사하고 원래 상태(사람)로 복구
  assert.throws(() => port.aiAct('p0'), (e) => e.code === 'ENGINE_REJECT' && e.params.reason === 'NOT_CPU');
  port.setProxy('p0', true);
  const r = port.aiAct('p0');
  assert.ok(r.events.some((e) => e.t === 'fire') && r.ticks >= 0);
  assert.equal(port.raw.P('p0').cpu, false);
  const cash = port.raw.inventory('p0').cash;
  port.aiShop('p0');
  assert.ok(port.raw.inventory('p0').cash <= cash);
  // 후퇴한 플레이어는 턴 순서에서 건너뛴다(NOT_ALIVE)
  const first = port.currentTurn();
  port.retreat(first);
  for (let i = 0; i < 6; i++) { const t = port.currentTurn(); if (t == null) break; assert.notEqual(t, first); port.pass(t); }
  assert.throws(() => port.fire(first, { weapon: 'baby_missile', angle: 45, power: 100 }), (e) => e.params?.reason === 'ROUND_OVER' || e.params?.reason === 'NOT_ALIVE');
});

test('어댑터: 엔진 export 로 직접 구성한 팩토리도 동작(엔진 모듈 연결 확인)', () => {
  const f = makeEngineFactory(engineMod);
  const port = f.createGame({ options: { rounds: 1, mode: 'SEQUENTIAL', wallEffect: 'NONE', sky: 'PLAIN' }, players: [{ id: 'x', name: 'x', color: 0, tank: 'classic' }, { id: 'y', name: 'y', color: 1, tank: 'wedge', ai: 'shooter' }], seed: 1 });
  const { info } = port.startRound();
  assert.equal(info.tanks.length, 2);
  assert.equal(findSecret(info), null);
});
