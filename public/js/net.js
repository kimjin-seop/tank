// 네트워크 어댑터: 실서버 WebSocket(/ws) 또는 ?mock=1 일 때 브라우저 내 가짜 서버.
// 메시지 형식은 서버 구현(server/net/protocol.js, lobby.js, roomGame.js) 기준: { t: '타입', ...필드 }
import { Emitter } from './util.js';

const TOKEN_KEY = 'se.token';

export class Net extends Emitter {
  constructor() {
    super();
    const q = new URLSearchParams(location.search);
    // ?mock=1·?ws= 는 개발 호스트(localhost·루프백)에서만 허용
    const hn = location.hostname, dev = hn === 'localhost' || hn.endsWith('.localhost') || /^127\./.test(hn) || hn === '[::1]' || hn === '::1';
    this.mock = dev && q.get('mock') === '1';
    this.url = (dev && q.get('ws')) || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.ws = null; this.open = false; this.offset = 0; this.backoff = 500; this.wantHello = null;
    this.token = sessionStorage.getItem(TOKEN_KEY);
    this.seq = 0;
  }

  async connect() {
    if (this.mock) {
      const { MockServer } = await import('./mock.js');
      this.server = new MockServer(msg => this._recv(msg));
      this.open = true; this.emit('open');
      return;
    }
    return new Promise(res => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => { this.open = true; this.backoff = 500; this.emit('open'); res(); if (this.token) { this.tokenHello = true; this.send('hello', { token: this.token }); } };
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this._recv(m); };
      ws.onclose = () => {
        const was = this.open; this.open = false; this.emit('close', { was }); res();
        if (this.closing) return;
        setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(8000, this.backoff * 2);
      };
      ws.onerror = () => {};
    });
  }

  _recv(m) {
    if (!m || typeof m.t !== 'string') return;
    if (typeof m.serverTime === 'number') this.offset = m.serverTime - Date.now();
    if (m.t === 'welcome' && m.token) { this.tokenHello = false; this.token = m.token; sessionStorage.setItem(TOKEN_KEY, m.token); }
    if (m.t === 'error' && m.code === 'SESSION_REPLACED') { this.closing = true; }
    this.emit(m.t, m);
    this.emit('message', m);
  }

  send(t, data = {}) {
    const msg = { t, ...data, ref: ++this.seq };
    if (this.mock) { this.server.handle(msg); return msg.ref; }
    if (!this.ws || this.ws.readyState !== 1) { this.emit('error', { t: 'error', code: 'DISCONNECTED' }); return 0; }
    this.ws.send(JSON.stringify(msg));
    return msg.ref;
  }

  forgetToken() { this.token = null; sessionStorage.removeItem(TOKEN_KEY); }
  now() { return Date.now() + this.offset; }
}

export const net = new Net();
