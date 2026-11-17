import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { makeEngineFactory } from '../server/game/engineAdapter.js';
import { createStubEngine } from '../server/game/stubEngine.js';

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = waiters.findIndex((x) => x.t === m.t);
      if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
      else inbox.push(m);
    });
    ws.waitFor = (t) => {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve) => waiters.push({ t, resolve }));
    };
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('서버 기동 후 WebSocket 닉네임 -> 방 목록 왕복, 방 생성이 다른 클라이언트에 실시간 반영', async () => {
  const srv = await createServer({ engine: makeEngineFactory(createStubEngine()) });
  const port = await srv.listen(0);
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    const a = await open(url);
    a.send(JSON.stringify({ t: 'hello', nickname: '플레이어' }));
    const welcome = await a.waitFor('welcome');
    assert.equal(welcome.nickname, '플레이어');
    assert.deepEqual((await a.waitFor('room_list')).rooms, []);

    const b = await open(url);
    b.send(JSON.stringify({ t: 'hello', nickname: '플레이어' }));
    assert.equal((await b.waitFor('error')).code, 'NICK_TAKEN');
    b.send(JSON.stringify({ t: 'hello', nickname: '다른이' }));
    await b.waitFor('welcome');
    await b.waitFor('room_list');

    a.send(JSON.stringify({ t: 'create_room', title: '첫방', maxPlayers: 4 }));
    await a.waitFor('room_joined');
    const list = await b.waitFor('room_list'); // 새로고침 없이 푸시
    assert.equal(list.rooms[0].title, '첫방');
    assert.equal(list.rooms[0].players, 1);
    assert.equal(list.rooms[0].status, 'waiting');

    // 정적 서빙, 경로 이탈 차단
    const r = await fetch(`http://127.0.0.1:${port}/data/items_ko.json`);
    assert.equal(r.status, 200);
    const bad = await fetch(`http://127.0.0.1:${port}/assets/..%2fpackage.json`);
    assert.notEqual(bad.status, 200);
    // 진입 문서: CSS·JS 링크에 자산 버전이 붙는다(캐시 무효화)
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /href="\/css\/app\.css\?v=\w+"/);
    assert.match(html, /src="\/js\/main\.js\?v=\w+"/);
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});
