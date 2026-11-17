import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLobby } from '../server/testkit.js';

function startGame(ctx, opts = {}) {
  const { client } = ctx;
  const a = client('가나다');
  const b = client('라마바');
  a.say({ t: 'create_room', title: 'g', maxPlayers: 2, options: { rounds: 2, ...opts } });
  b.say({ t: 'join_room', roomId: a.last('room_joined').room.id });
  b.say({ t: 'ready', ready: true });
  a.say({ t: 'start' });
  return { a, b, aId: a.last('room_joined').you, bId: b.last('room_joined').you };
}

test('턴 타이머 만료 시 자동 패스, 타 플레이어 발사 거부, 마감 시각 전달', () => {
  const ctx = makeLobby();
  const { a, b, aId, bId } = startGame(ctx);
  const turn = a.last('turn');
  assert.equal(turn.playerId, aId);
  assert.equal(turn.limitMs, 60000);
  assert.equal(turn.deadline - turn.serverTime, 60000);

  b.say({ t: 'fire', weapon: 'baby', angle: 45, power: 10 });
  assert.equal(b.last('error').code, 'NOT_YOUR_TURN');

  ctx.clock.advance(59_999);
  assert.equal(a.all('shot').length, 0);
  ctx.clock.advance(1);
  const toast = b.last('toast');
  assert.equal(toast.code, 'TURN_TIMEOUT');
  assert.equal(toast.msg, '시간 초과! 가나다님의 턴이 넘어갑니다');
  assert.equal(a.all('shot').length, 0); // 그 턴에는 발사 없음
  assert.equal(b.last('turn').playerId, bId); // 다음 턴 시작

  // 정상 발사는 타이머를 멈추고 shot 이벤트를 보낸다
  b.say({ t: 'fire', weapon: 'baby', angle: 45, power: 10 });
  assert.equal(a.last('shot').playerId, bId);
});

test('마감 이후 도착한 발사는 거부된다(서버 수신 시각 기준)', () => {
  const ctx = makeLobby();
  const { a } = startGame(ctx);
  // 타이머 콜백이 아직 안 돈 상태를 흉내: 시계만 앞으로 보내고 타이머는 보존
  const timers = ctx.clock.timers.slice();
  ctx.clock.t += 61_000;
  a.say({ t: 'fire', weapon: 'baby', angle: 45, power: 10 });
  assert.equal(a.last('error').code, 'TURN_EXPIRED');
  assert.equal(a.all('shot').length, 0);
  void timers;
});

test('연속 3회 시간 초과 시 접속 중이면 후퇴 처리', () => {
  const ctx = makeLobby();
  const { b } = startGame(ctx);
  for (let i = 0; i < 2; i++) {
    ctx.clock.advance(60_000); // a 초과
    b.say({ t: 'fire', weapon: 'baby', angle: 45, power: 1 });
    ctx.clock.advance(2000); // 재생 대기
  }
  ctx.clock.advance(60_000); // a 3회째
  assert.ok(b.all('toast').some((t) => t.code === 'IDLE_RETREAT'));
});

test('끊긴 플레이어도 같은 타이머로 패스되고 재접속 시 남은 시간을 받는다', () => {
  const ctx = makeLobby();
  const { a, b } = startGame(ctx);
  const token = a.last('welcome').token;
  ctx.lobby.onClose(a);
  ctx.clock.advance(20_000);
  const a2 = ctx.client();
  a2.say({ t: 'hello', token });
  assert.equal(a2.last('welcome').resumed, true);
  assert.equal(a2.last('welcome').location, 'game');
  const r = a2.last('game_resume');
  assert.equal(r.turn.deadline - r.serverTime, 40_000);
  ctx.clock.advance(40_000);
  assert.equal(b.last('toast').code, 'TURN_TIMEOUT');
});

test('동기 모드: 만료 시 준비한 샷만 발사', () => {
  const ctx = makeLobby();
  const { a, b } = startGame(ctx, { mode: 'SYNCHRONOUS' });
  assert.equal(a.last('turn').mode, 'sync');
  a.say({ t: 'fire', weapon: 'baby', angle: 45, power: 5 });
  assert.equal(b.last('ready').readyIds.length, 1);
  assert.equal(a.all('shot').length, 0);
  ctx.clock.advance(60_000);
  assert.equal(a.all('shot').length, 1);
  assert.equal(b.all('toast').filter((t) => t.code === 'TURN_TIMEOUT').length, 1);
});

test('게임 종료 후 대기실 복귀(준비 해제, 옵션·방장 유지)', () => {
  const ctx = makeLobby();
  const { a, b, aId } = startGame(ctx, { rounds: 1 });
  a.say({ t: 'fire', weapon: 'baby', angle: 45, power: 100 }); // 스텁: 한 방에 처치
  ctx.clock.advance(2500);
  assert.ok(a.last('round_end'));
  ctx.clock.advance(4000);
  assert.ok(a.last('game_over'));
  ctx.clock.advance(8000);
  assert.ok(b.last('back_to_room'));
  const room = b.last('room_state').room;
  assert.equal(room.status, 'waiting');
  assert.equal(room.hostId, aId);
  assert.equal(room.options.rounds, 1);
  assert.ok(room.slots.filter((s) => s.id !== aId).every((s) => !s.ready));
});

test('말하는 탱크: 발사·사망 시 shot 이벤트에 talk 삽입(OFF면 없음)', () => {
  const ctx = makeLobby();
  const { a, aId, bId } = startGame(ctx, { talkingTanks: 'ALL', talkProbability: 100 });
  a.say({ t: 'fire', weapon: 'baby_missile', angle: 45, power: 100 }); // 스텁: power>=hp 이면 상대 사망
  const ev = a.last('shot').events;
  const talks = ev.filter((e) => e.t === 'talk');
  assert.deepEqual(talks.map((e) => e.tank), [aId, bId]);
  assert.ok(talks.every((e) => typeof e.text === 'string' && e.text.length && Number.isInteger(e.tick)));
  assert.equal(ev[ev.findIndex((e) => e.t === 'fire') + 1].t, 'talk');

  const ctx2 = makeLobby();
  const g2 = startGame(ctx2, { talkingTanks: 'OFF' });
  g2.a.say({ t: 'fire', weapon: 'baby_missile', angle: 45, power: 100 });
  assert.equal(g2.a.last('shot').events.filter((e) => e.t === 'talk').length, 0);
});

test('동시 상점: 대상 전원이 각자 me.shop 을 받고, 두 명 모두 완료하면 즉시 round_start', () => {
  const ctx = makeLobby();
  const { a, b, aId, bId } = startGame(ctx, { cashAtStart: 1000 });
  const open = b.last('shop_open');
  assert.deepEqual(open.ids, [aId, bId]);
  assert.deepEqual(open.doneIds, []);
  assert.equal(open.deadline - open.serverTime, 90_000);
  assert.equal(open.shop, undefined); // 방 전원 브로드캐스트에는 가격 목록을 싣지 않음
  assert.equal(a.last('me').shop[0].affordable, true);
  assert.equal(b.last('me').shop[0].id, 'missile');
  b.say({ t: 'buy', item: 'missile', qty: 1 }); // 차례 없이 동시에 구매
  a.say({ t: 'buy', item: 'missile', qty: 1 });
  assert.equal(a.last('shop_result').shop[0].owned, 1);
  assert.equal(b.last('shop_result').shop[0].owned, 1);
  assert.equal(a.all('error').length + b.all('error').length, 0);
  a.say({ t: 'shop_done' });
  assert.deepEqual(b.last('shop_progress').doneIds, [aId]);
  assert.equal(a.all('round_start').length, 0);
  b.say({ t: 'shop_done' });
  assert.ok(a.last('shop_end'));
  assert.equal(a.all('round_start').length, 1);
});

test('동시 상점: 마감 시 미완료자 자동 완료 후 진행, 토스트 1회, 이후 buy 는 거부', () => {
  const ctx = makeLobby();
  const { a, b } = startGame(ctx, { cashAtStart: 1000 });
  a.say({ t: 'shop_done' });
  ctx.clock.advance(89_999);
  assert.equal(a.all('round_start').length, 0);
  ctx.clock.advance(1);
  const toasts = b.all('toast').filter((t) => t.code === 'SHOP_TIMEOUT');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].msg, '상점 시간 종료');
  assert.equal(b.all('round_start').length, 1);
  b.say({ t: 'buy', item: 'missile', qty: 1 });
  assert.equal(b.last('error').code, 'WRONG_PHASE');
});
