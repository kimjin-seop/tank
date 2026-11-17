// 서버 진입점: HTTP 정적 서빙(public/, assets/, data/) + 같은 포트의 WebSocket(/ws).
// 실행: node server/index.js   (PORT 환경변수 기본 3000, HOST 환경변수 기본 0.0.0.0)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby/lobby.js';
import { loadEngine } from './game/engineAdapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export const realClock = {
  now: () => Math.round(performance.timeOrigin + performance.now()), // 단조 증가 + 서버 벽시계 기준 ms
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), // 서버 소켓이 프로세스를 유지하므로 unref
  clearTimeout: (h) => clearTimeout(h),
};

// 정적 자산 버전: public/css·public/js 아래 파일의 가장 최근 수정 시각(36진수). index.html 을 내보낼 때 계산(1초 캐시)
function assetVersion(root) {
  let max = 0;
  const walk = (dir) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch { /* 사라진 파일 무시 */ } }
    }
  };
  walk(path.join(root, 'public', 'css')); walk(path.join(root, 'public', 'js'));
  return Math.floor(max).toString(36);
}
// index.html 의 /css/*.css · /js/*.js 링크에 ?v=버전 을 붙여, 파일이 바뀌면 주소가 달라지게 한다(브라우저·프록시 캐시 무효화)
export function injectAssetVersion(html, v) {
  return html.replace(/\b(href|src)="(\/(?:css|js)\/[^"?#]+\.(?:css|js))"/g, (_, attr, url) => `${attr}="${url}?v=${v}"`);
}

function makeStaticHandler(root) {
  const indexFile = path.join(root, 'public', 'index.html');
  let ver = { at: -Infinity, v: '' };
  const version = () => { const now = Date.now(); if (now - ver.at > 1000) ver = { at: now, v: assetVersion(root) }; return ver.v; };
  // URL 접두 -> 디렉터리. '/'는 public/ 로 매핑.
  const mounts = [['/assets/', 'assets'], ['/data/', 'data'], ['/', 'public']];
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    if (pathname.includes('\0')) { res.writeHead(400); return res.end(); }
    const [prefix, dir] = mounts.find(([p]) => pathname.startsWith(p));
    let rel = pathname.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const base = path.join(root, dir);
    const file = path.resolve(base, rel);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
      if (file === indexFile) { // 진입 문서: 자산 버전 주입, 문서 자체는 저장하지 않게
        return fs.readFile(file, 'utf8', (e2, html) => {
          if (e2) { res.writeHead(500); return res.end(); }
          const body = Buffer.from(injectAssetVersion(html, version()));
          res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': body.length, 'cache-control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : body);
        });
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size, 'cache-control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  };
}

/**
 * createServer({ engine, clock, config, gameConfig, root, log })
 *  engine: { createGame(args) -> 포트 } (엔진 스텁 주입 가능). 생략하면 server/engine/ 로드(없으면 스텁).
 */
export async function createServer({ engine, clock = realClock, config, gameConfig, root = ROOT, log = () => {} } = {}) {
  const eng = engine || (await loadEngine({ log: console }));
  const lobby = new Lobby({ clock, engine: eng, config, gameConfig, log });
  const httpServer = http.createServer(makeStaticHandler(root));
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    const conn = {
      session: null,
      send: (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); },
      close: () => ws.close(),
    };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    lobby.onConnect(conn);
    ws.on('message', (data) => lobby.onMessage(conn, data));
    ws.on('close', () => lobby.onClose(conn));
    ws.on('error', () => {});
  });

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);
  hb.unref();

  return {
    lobby, httpServer, wss,
    listen: (port = Number(process.env.PORT) || 3000) => new Promise((resolve) => {
      httpServer.listen(port, process.env.HOST || "0.0.0.0", () => resolve(httpServer.address().port));
    }),
    close: () => new Promise((resolve) => {
      clearInterval(hb);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => httpServer.close(() => resolve()));
      httpServer.closeAllConnections?.();
    }),
  };
}

// 직접 실행(node server/index.js) 또는 pm2 아래(argv[1]이 pm2 래퍼가 되므로 pm_id로 판별)에서만 서버를 시작한다
if ((process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) || process.env.pm_id !== undefined) {
  const srv = await createServer({ log: (lvl, e) => console.error(`[${lvl}]`, e) });
  const port = await srv.listen();
  console.log(`서버 시작: http://localhost:${port}  (WebSocket ws://localhost:${port}/ws)`);
}
