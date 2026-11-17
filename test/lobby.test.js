import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLobby } from '../server/testkit.js';

test('방 만들기 -> 입장 -> 준비 -> 시작 불가/가능 조건', () => {
  const { client } = makeLobby();
  const host = client('방장님');
  const guest = client('손님');
  assert.equal(host.last('welcome').resumed, false);
  assert.equal(client('방장님').last('error').code, 'NICK_TAKEN'); // 닉네임 유일

  host.say({ t: 'create_room', title: '테스트방', maxPlayers: 4 });
  const roomId = host.last('room_joined').room.id;
  assert.equal(host.last('room_joined').room.start.code, 'START_NEED_PLAYERS'); // 혼자: 2명 미만

  guest.say({ t: 'join_room', roomId });
  assert.equal(guest.last('room_joined').room.title, '테스트방');
  assert.equal(host.last('room_state').room.start.code, 'START_NOT_READY'); // 손님 미준비

  guest.say({ t: 'start' });
  assert.equal(guest.last('error').code, 'NOT_HOST'); // 방장만 시작
  host.say({ t: 'start' });
  assert.equal(host.last('error').code, 'START_NOT_READY');

  guest.say({ t: 'ready', ready: true });
  assert.equal(host.last('room_state').room.start.ok, true);

  // 옵션 변경 시 준비 해제
  host.say({ t: 'set_options', options: { rounds: 3 } });
  assert.equal(guest.last('room_state').room.slots[1].ready, false);
  assert.equal(guest.last('room_state').room.options.rounds, 3);
  guest.say({ t: 'set_options', options: { rounds: 4 } });
  assert.equal(guest.last('error').code, 'NOT_HOST');

  guest.say({ t: 'ready', ready: true });
  host.say({ t: 'start' });
  assert.equal(guest.last('room_state').room.status, 'playing');
  assert.ok(guest.last('game_start'));

  // 게임 중 입장 불가
  const late = client('늦은이');
  late.say({ t: 'join_room', roomId });
  assert.equal(late.last('error').code, 'ROOM_IN_GAME');
});

test('강퇴 후 재입장 차단, 가득 찬 방, 컴퓨터 슬롯', () => {
  const { client } = makeLobby();
  const a = client('가나다');
  const b = client('라마바');
  a.say({ t: 'create_room', title: 'x', maxPlayers: 2 });
  const id = a.last('room_joined').room.id;
  b.say({ t: 'join_room', roomId: id });
  const c = client('사아자');
  c.say({ t: 'join_room', roomId: id });
  assert.equal(c.last('error').code, 'ROOM_FULL');
  a.say({ t: 'add_computer' });
  assert.equal(a.last('error').code, 'ROOM_FULL'); // 사람+컴퓨터 <= 최대
  const bId = b.last('room_joined').you;
  b.say({ t: 'kick', id: bId });
  assert.equal(b.last('error').code, 'NOT_HOST');
  a.say({ t: 'kick', id: bId });
  assert.equal(b.last('kicked').msg, '방장에 의해 강퇴되었습니다');
  b.say({ t: 'join_room', roomId: id });
  assert.equal(b.last('error').code, 'ROOM_KICKED');
});

test('방장 위임, 사람 0명이면 방 삭제', () => {
  const { client, lobby, clock } = makeLobby();
  const a = client('가나다');
  const b = client('라마바');
  a.say({ t: 'create_room', title: '방', maxPlayers: 3 });
  const id = a.last('room_joined').room.id;
  b.say({ t: 'join_room', roomId: id });
  a.say({ t: 'leave_room' });
  const st = b.last('room_state').room;
  assert.equal(st.hostId, b.last('room_joined').you); // 자동 위임
  assert.ok(b.all('chat').some((m) => m.key === 'HOST'));

  // 방장 연결 끊김 -> 유예 후 위임
  const d = client('차카타');
  d.say({ t: 'join_room', roomId: id });
  lobby.onClose(b);
  clock.advance(29_000);
  assert.equal(lobby.rooms.get(id).hostId, b.last('room_joined').you); // 유예 중에는 유지
  clock.advance(2_000);
  assert.equal(lobby.rooms.get(id).hostId, d.last('room_joined').you);

  d.say({ t: 'leave_room' });
  assert.equal(lobby.rooms.has(id), false);
});

test('채팅 길이·속도 제한', () => {
  const { client, clock } = makeLobby();
  const a = client('가나다');
  a.say({ t: 'create_room', title: 'x', maxPlayers: 2 });
  a.say({ t: 'chat', text: '가'.repeat(201) });
  assert.equal(a.last('error').code, 'CHAT_TOO_LONG');
  a.say({ t: 'chat', text: '안녕' });
  a.say({ t: 'chat', text: '또' });
  assert.equal(a.last('error').code, 'CHAT_RATE');
  clock.advance(500);
  a.say({ t: 'chat', text: '또' });
  assert.equal(a.last('chat').text, '또');
});

test('컴퓨터 추가 시 탱크 모양이 슬롯별로 서로 다르게 자동 배정(트리플·fixed 제외)', () => {
  const { client } = makeLobby();
  const host = client('방장');
  host.say({ t: 'create_room', title: '탱크방', maxPlayers: 5 });
  for (let i = 0; i < 4; i++) host.say({ t: 'add_computer' });
  const tanks = host.last('room_state').room.slots.filter((s) => s.kind === 'computer').map((s) => s.tank);
  assert.equal(tanks.length, 4);
  assert.equal(new Set(tanks).size, 4);
  assert.ok(tanks.every((t) => t !== 'triple' && t !== 'fixed'));
});

test('채팅: 검증(120자·제어문자·공백), 게임 중 허용, 방 격리, 재접속 시 기록 복귀', () => {
  const { client, clock, lobby } = makeLobby();
  const a = client('가나다'), b = client('라마바'), out = client('방밖');
  a.say({ t: 'chat', text: '로비' });
  assert.equal(a.last('error').code, 'NOT_IN_ROOM'); // 방 참가자만
  a.say({ t: 'create_room', title: 'x', maxPlayers: 2 });
  const roomId = a.last('room_joined').room.id;
  b.say({ t: 'join_room', roomId });
  out.say({ t: 'create_room', title: '다른방', maxPlayers: 2 });

  a.say({ t: 'chat', text: '가'.repeat(121) });
  assert.equal(a.last('error').code, 'CHAT_TOO_LONG');
  a.say({ t: 'chat', text: ' \u0007 ‮   ' });
  assert.equal(a.last('error').code, 'CHAT_EMPTY');
  a.say({ t: 'chat', text: '  안\u0000녕  ' });
  assert.deepEqual(b.last('chat').from.name, '가나다'); // 닉네임은 서버가 붙임
  assert.equal(b.last('chat').text, '안 녕');
  assert.equal(out.all('chat').some((m) => m.text === '안 녕'), false); // 다른 방에는 안 감

  // 게임 중에도 채팅 가능
  b.say({ t: 'ready', ready: true });
  a.say({ t: 'start' });
  assert.ok(a.last('game_start'));
  clock.advance(500);
  b.say({ t: 'chat', text: '게임중' });
  assert.equal(a.last('chat').text, '게임중');

  // 끊겼다가 토큰으로 복귀하면 방 기록(최근 50개)을 받는다
  const token = b.last('welcome').token;
  lobby.onClose(b);
  const b2 = client();
  b2.say({ t: 'hello', token });
  const joined = b2.last('room_joined');
  assert.ok(joined.chat.some((m) => m.text === '게임중'));
  assert.ok(joined.chat.length <= 50);
});
