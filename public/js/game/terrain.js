// 지형 마스크(1 game px 셀) + 렌더(셀 nearest 확대, 윗면 림은 벡터)
import { A } from './assets.js';

export class Terrain {
  constructor(w, h) {
    this.w = w; this.h = h; this.mask = new Uint8Array(w * h);
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.dirty = true; this.colors = null; this.surface = new Int16Array(w);
    this.fresh = []; // 새 흙 페이드인 {x,y,r,t}
  }

  /**
   * 서버 지형 디코드. 지원 형식(가정, ENGINE_API.md 확정 시 맞춤):
   *  {enc:'heights', data:[y...]}  열마다 표면 y(아래는 전부 흙)
   *  {enc:'runs', data:[[y0,y1,y0,y1...], ...]} 열마다 흙 구간 [y0,y1)
   *  {enc:'b64', data:'...'} 행 우선 비트마스크(LSB first)
   */
  load(t) {
    this.mask.fill(0);
    const { w, h } = this;
    if (!t) return;
    if (t.w && t.h && (t.w !== w || t.h !== h)) { this.w = t.w; this.h = t.h; this.mask = new Uint8Array(t.w * t.h); this.canvas.width = t.w; this.canvas.height = t.h; this.surface = new Int16Array(t.w); }
    const W = this.w, H = this.h;
    if (Array.isArray(t.cols)) {
      // ENGINE_API: cols[x] = [y0,y1,c, ...] (y1 포함, c=흙 색 인덱스)
      for (let x = 0; x < W; x++) { const r = t.cols[x] || []; for (let i = 0; i + 1 < r.length; i += 3) for (let y = Math.max(0, r[i]); y <= Math.min(H - 1, r[i + 1]); y++) this.mask[y * W + x] = 1; }
    } else if (t.enc === 'heights') {
      for (let x = 0; x < W; x++) { const top = Math.max(0, Math.round(t.data[x] ?? H)); for (let y = top; y < H; y++) this.mask[y * W + x] = 1; }
    } else if (t.enc === 'runs') {
      for (let x = 0; x < W; x++) { const r = t.data[x] || []; for (let i = 0; i + 1 < r.length; i += 2) for (let y = Math.max(0, r[i]); y < Math.min(H, r[i + 1]); y++) this.mask[y * W + x] = 1; }
    } else if (t.enc === 'b64') {
      const bin = atob(t.data);
      for (let i = 0; i < W * H; i++) this.mask[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
    }
    this.dirty = true;
  }

  solid(x, y) { x |= 0; y |= 0; return x >= 0 && x < this.w && y >= 0 && y < this.h && this.mask[y * this.w + x] === 1; }
  surfaceAt(x) { x = Math.max(0, Math.min(this.w - 1, x | 0)); for (let y = 0; y < this.h; y++) if (this.mask[y * this.w + x]) return y; return this.h; }

  carve(cx, cy, r) { this._circle(cx, cy, r, 0); }
  fill(cx, cy, r) { this._circle(cx, cy, r, 1); this.fresh.push({ x: cx, y: cy, r, t: 0 }); }
  _circle(cx, cy, r, v) {
    const { w, h } = this, r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) this.mask[y * w + x] = v;
    this.dirty = true;
  }
  /** 흙 낙하(공중 흙을 아래로 모음) */
  settle() {
    const { w, h } = this;
    for (let x = 0; x < w; x++) {
      let cnt = 0; let firstSolid = -1;
      for (let y = 0; y < h; y++) if (this.mask[y * w + x]) { cnt++; if (firstSolid < 0) firstSolid = y; }
      for (let y = 0; y < h; y++) this.mask[y * w + x] = y >= h - cnt ? 1 : 0;
    }
    this.dirty = true;
  }
  /** ENGINE_API terrain 이벤트: spans [[x,y0,y1,c]] (y1 포함, c=0 하늘) 순서대로 덮어쓰기 */
  applySpans(spans) {
    const { w, h } = this;
    for (const [x, y0, y1, c] of spans) {
      if (x < 0 || x >= w) continue;
      const v = c ? 1 : 0;
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) this.mask[y * w + x] = v;
    }
    this.dirty = true;
  }
  /** 열 단위 델타: [[x, runs]] */
  applyColumns(cols) {
    for (const [x, runs] of cols) {
      for (let y = 0; y < this.h; y++) this.mask[y * this.w + x] = 0;
      for (let i = 0; i + 1 < runs.length; i += 2) for (let y = runs[i]; y < runs[i + 1]; y++) this.mask[y * this.w + x] = 1;
    }
    this.dirty = true;
  }

  setSky(skyKey) {
    const sky = A.pal.skies[skyKey] || A.pal.skies.PLAIN;
    this.colors = sky.terrain; this.dirty = true;
  }

  /** 셀 하나 변경(흙 낙하 애니메이션용). 바뀐 열만 다시 그림 */
  setCell(x, y, v) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = y * this.w + x; if (this.mask[i] === v) return;
    this.mask[i] = v; this.markCol(x);
  }
  markCol(x) { if (this.dx0 == null || x < this.dx0) this.dx0 = x; if (this.dx1 == null || x > this.dx1) this.dx1 = x; }

  render() {
    const full = this.dirty;
    if (!full && this.dx0 == null) return;
    const { w, h, mask } = this, col = this.colors || A.pal.skies.PLAIN.terrain;
    const x0 = full ? 0 : this.dx0, x1 = full ? w - 1 : this.dx1;
    this.dirty = false; this.dx0 = this.dx1 = null;
    const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    const L = col.layers.map(hex), sp = hex(col.speck);
    const ctx = this.canvas.getContext('2d');
    if (full || !this.img || this.img.width !== w || this.img.height !== h) this.img = ctx.createImageData(w, h);
    const d = this.img.data;
    if (!this.tops || this.tops.length !== w) this.tops = new Array(w).fill(null);
    for (let x = x0; x <= x1; x++) {
      let top = -1; const tops = [];
      for (let y = 0; y < h; y++) {
        const i = y * w + x, o = i * 4;
        if (!mask[i]) { top = -1; d[o + 3] = 0; continue; }
        if (top < 0) { top = y; if (y > 0) tops.push(y); }
        const depth = y - top, gy = Math.min(1, (y - h * 0.45) / (h * 0.55));
        const k = Math.max(0, Math.min(1, depth / 90 * 0.6 + Math.max(0, gy) * 0.4));
        let c;
        if (k < 0.55) { const f = k / 0.55; c = [0, 1, 2].map(j => L[0][j] + (L[1][j] - L[0][j]) * f); }
        else { const f = (k - 0.55) / 0.45; c = [0, 1, 2].map(j => L[1][j] + (L[2][j] - L[1][j]) * f); }
        const strata = (depth + Math.round(Math.sin(x / 23 + Math.floor(depth / 9)) * 2)) % 9 === 0 && depth > 4;
        if (strata) c = c.map((v, j) => v + (L[2][j] - v) * 0.18);
        const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        if ((hsh % 100) < 6) c = c.map((v, j) => v + (sp[j] - v) * 0.5);
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
      this.tops[x] = tops;
      this.surface[x] = tops.length ? tops[0] : (mask[x] ? 0 : h);
    }
    ctx.putImageData(this.img, 0, 0, x0, 0, x1 - x0 + 1, h);
    this.rimPaths = null;
  }

  /**
   * 윗면 림 선분: 열마다 '위가 하늘인 흙 셀'(tops) 을 잇되, 이웃 열의 top 과는
   * 높은 쪽 열이 그 사이를 흙으로 채우고 있을 때(=실제 경사·절벽 면)만 연결. 오버행·천장·낙하 중 흙덩이에서 세로 줄이 생기지 않게.
   */
  buildRim() {
    const { w, mask } = this, segs = [];
    const solidRun = (x, ya, yb) => { for (let y = ya; y <= yb; y++) if (!mask[y * w + x]) return false; return true; };
    for (let x = 0; x < w; x++) {
      const A0 = this.tops[x] || [], B0 = x + 1 < w ? (this.tops[x + 1] || []) : [];
      for (const ya of A0) {
        let linked = false;
        for (const yb of B0) {
          const ok = ya <= yb ? solidRun(x, ya, yb) : solidRun(x + 1, yb, ya);
          if (ok) { segs.push([x + 0.5, ya, x + 1.5, yb]); linked = true; break; }
        }
        if (!linked) segs.push([x + 0.5, ya, x + 0.5 + (x + 1 < w ? 0.5 : 0), ya]);
      }
    }
    this.rimPaths = segs;
  }

  /** c: game px 변환 컨텍스트(x·y 배율 다를 수 있음), v: Renderer(strokeU 로 화면 균일 굵기 선) */
  draw(c, dt, v = null) {
    this.render();
    if (!this.rimPaths) this.buildRim();
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(this.canvas, 0, 0);
    c.restore();
    const col = this.colors || A.pal.skies.PLAIN.terrain;
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    const line = (off, w) => { c.beginPath(); for (const [ax, ay, bx, by] of this.rimPaths) { c.moveTo(ax, ay + off); c.lineTo(bx, by + off); } if (v) v.strokeU(c, w); else { c.lineWidth = w; c.stroke(); } };
    c.strokeStyle = col.rimDark; line(0.9, 2.2);
    c.strokeStyle = col.rim; line(0.3, 1.1);
    // 새 흙 페이드인(림 색 덮개가 0.15s 동안 사라짐)
    const fadeT = A.fx?.explosions?.dirtAdd?.newDirtFadeIn || 0.15;
    for (let i = this.fresh.length - 1; i >= 0; i--) {
      const f = this.fresh[i]; f.t += dt;
      if (f.t > fadeT) { this.fresh.splice(i, 1); continue; }
      c.globalAlpha = 0.6 * (1 - f.t / fadeT); c.fillStyle = col.rim; c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
