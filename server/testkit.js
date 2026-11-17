// 테스트 보조: 가짜 시계, 가짜 연결. (운영 코드에서는 쓰지 않는다)
import { Lobby } from './lobby/lobby.js';
import { makeEngineFactory } from './game/engineAdapter.js';
import { createStubEngine } from './game/stubEngine.js';

export class FakeClock {
  constructor(start = 1_000_000) { this.t = start; this.timers = []; this.seq = 0; }
  now() { return this.t; }
  setTimeout(fn, ms) { const h = { at: this.t + ms, fn, id: ++this.seq }; this.timers.push(h); return h; }
  clearTimeout(h) { this.timers = this.timers.filter((x) => x !== h); }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

export class FakeConn {
  constructor() { this.inbox = []; this.session = null; this.closed = false; this.msgTimes = []; }
  send(o) { this.inbox.push(o); }
  close() { this.closed = true; }
  last(t) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i]; return undefined; }
  all(t) { return this.inbox.filter((m) => m.t === t); }
}

export function makeLobby(opts = {}) {
  const clock = opts.clock || new FakeClock();
  const engine = opts.engine || makeEngineFactory(createStubEngine());
  const lobby = new Lobby({ clock, engine, config: opts.config, gameConfig: opts.gameConfig, rng: () => 0.5 });
  const client = (nick) => {
    const c = new FakeConn();
    lobby.onConnect(c);
    c.say = (msg) => lobby.onMessage(c, msg);
    if (nick) c.say({ t: 'hello', nickname: nick });
    return c;
  };
  return { lobby, clock, client };
}
