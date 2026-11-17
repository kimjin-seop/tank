// Terrain: pixel grid (RE §1.3, §8.2). 0 = sky; 0x50..0x68 = dirt color index (solid).
// The original has no height array: terrain is video memory. Same here: Uint8Array(w*h).
import fs from 'node:fs';
import path from 'node:path';
import { DIRT_BASE, GROUND_COLORS } from './config.js';


const _discCache = new Map();
/** Half-width per |dy| (0..R) of the original midpoint disc 3c70:09ca; -1 = row absent. */
function discRows(R) {
  R = Math.max(0, Math.trunc(R)); if (!Number.isFinite(R)) return [];   // NaN/Infinity -> no rows; negative -> R=0
  let rows = _discCache.get(R);
  if (rows) return rows;
  rows = new Array(R + 1).fill(-1);
  const put = (dy, hw) => { dy = Math.abs(dy); if (dy <= R && rows[dy] < hw) rows[dy] = hw; };
  const plot8 = (a, b) => { put(b, a); put(a, b); };                  // (a,b): rows +-b width a, rows +-a width b
  let si = 0, di = 2 * R, err = 0;
  while (si <= di) {
    if (!(si & 1)) plot8(si >> 1, (di + 1) >> 1);
    err += 2 * si + 1; si++;
    if (err > 0) { err -= 2 * di - 1; di--; }
  }
  plot8(si >> 1, (di + 1) >> 1);
  _discCache.set(R, rows);
  return rows;
}

export class Terrain {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.cells = new Uint8Array(w * h);
    this.dirtColors = [DIRT_BASE];       // pool for falling-dirt pixels (RE §5.3 "흙 색 목록")
    this.dirtyMin = Infinity; this.dirtyMax = -Infinity;
  }
  inb(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
  get(x, y) { return this.inb(x, y) ? this.cells[y * this.w + x] : 0; }
  solid(x, y) { return this.inb(x, y) && this.cells[y * this.w + x] !== 0; }
  markDirty(x0, x1) { if (x0 < this.dirtyMin) this.dirtyMin = x0; if (x1 > this.dirtyMax) this.dirtyMax = x1; }
  clearDirty() { this.dirtyMin = Infinity; this.dirtyMax = -Infinity; }

  /** first solid row at or below `fromY` in column x, or -1 */
  surface(x, fromY = 0) {
    if (x < 0 || x >= this.w) return -1;
    for (let y = Math.max(0, fromY); y < this.h; y++) if (this.cells[y * this.w + x]) return y;
    return -1;
  }

  // ---- procedural generation (RE §8.2, 223a:0a68) ----
  generate(rng, o) {
    const { left, right, top, bottom, land1, land2, flatland, dir, color } = o;
    this.cells.fill(0);
    this.dirtColors = [color];
    let slope = 0;
    let y = rng.int(bottom - top - 60) + top + 40;
    let x = dir === 1 ? left : right;
    do {
      for (let yy = y; yy <= bottom; yy++) this.cells[yy * this.w + x] = color;
      if (rng.int(100) < land1) {
        let d = rng.int(3) - 1;
        if (rng.int(100) < land2) d *= 2;
        slope += d;
        if (flatland && (slope < -3 || slope > 3)) slope = 0;
      }
      y += slope;
      if (y < top + 40) { y = top + 40; if (slope < 0) slope = 1; }
      if (y > bottom - 1) { y = bottom - 1; if (slope > 0) slope = 0; }
      x += dir;
    } while (x >= left && x <= right);
  }

  /** Cavern ceiling: same walk as generate() over rows top..mid (originally confirmed against scenario_001, 347/354 columns
   *  before tank pads/floor overlap); dirt fills rows top..y-1 (y = walk value, clamped to top+40 .. mid-1). */
  generateCeiling(rng, o) {
    const { left, right, top, bottom, land1, land2, flatland, dir, color } = o;
    const mid = o.mid ?? ((top + bottom) >> 1);
    let slope = 0;
    let y = rng.int(mid - top - 60) + top + 40;
    let x = dir === 1 ? left : right;
    do {
      for (let yy = top; yy < y; yy++) this.cells[yy * this.w + x] = color;
      if (rng.int(100) < land1) {
        let d = rng.int(3) - 1;
        if (rng.int(100) < land2) d *= 2;
        slope += d;
        if (flatland && (slope < -3 || slope > 3)) slope = 0;
      }
      y += slope;
      if (y < top + 40) { y = top + 40; if (slope < 0) slope = 1; }
      if (y > mid - 1) { y = mid - 1; if (slope > 0) slope = 0; }
      x += dir;
    } while (x >= left && x <= right);
  }

  /** Scanned mountain (*.MTN, RE §8.2, loader 2bf9:04b4). */
  fromMountain(rng, mtn, o) {
    const { left, right, bottom, top } = o;
    const playW = right - left + 1;
    this.cells.fill(0);
    let start = 0;
    if (mtn.w > playW) start = rng.int(mtn.w - playW + 1);          // random window
    const colors = [];
    for (let i = 0; i < 16; i++) if ((mtn.mask >> i) & 1) colors.push(0x58 + i);
    this.dirtColors = colors.length ? colors : [0x58];
    for (let x = left; x <= right; x++) {
      let src = x - left;
      if (mtn.w > playW) src += start;
      else if (mtn.w < playW) { const p = src % (2 * mtn.w); src = p < mtn.w ? p : 2 * mtn.w - 1 - p; }   // mirror tiling
      const col = mtn.cols[src];
      const hh = Math.min(col.h, bottom - top - 40);
      for (let k = 0; k < hh; k++) this.cells[(bottom - k) * this.w + x] = 0x58 + col.pix[k];
    }
  }

  // ---- shape operations; each returns the changed column spans [x,y0,y1,color] ----
  discRows(R) { return discRows(R); }

  /** Disc whose all pixels become `color` (0 = carve to sky). skipSolid: do not paint over existing dirt. */
  disc(cx, cy, R, color, skipSolid = false, rMin = 0) {
    const spans = [];
    // Original midpoint disc (3c70:09ca / 3c70:0590): per row dy the half-width is the max over the 8-fold plotted points; the row span runs from
    // x-offset floor(-hw*36044/65536) to floor(+hw*36044/65536) (pixel aspect 0.55, DS:EF34, 3c70:0a4e). Verified: scenario_001/002 (R=10) and scenario_003 (R=6..30).
    const hws = discRows(R);
    const ext = new Map();
    for (let dy = 0; dy <= R; dy++) {
      const hw = hws[dy];
      if (hw < 0) continue;
      const lo = Math.floor(-hw * 36044 / 65536), hi = Math.floor(hw * 36044 / 65536);
      for (let o = lo; o <= hi; o++) { const x = cx + o; if (!ext.has(x) || ext.get(x) < dy) ext.set(x, dy); }
    }
    let x0 = Infinity, x1 = -Infinity;
    for (const [x, hy] of [...ext.entries()].sort((p, q) => p[0] - q[0])) {
      if (x < 0 || x >= this.w) continue;
      const dx = x - cx;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      const ya = Math.max(0, cy - hy), yb = Math.min(this.h - 1, cy + hy);
      this._setRange(x, ya, yb, color, skipSolid, spans, rMin ? (yy) => (dx * dx + (yy - cy) * (yy - cy)) >= rMin * rMin : null);
    }
    if (spans.length) this.markDirty(x0, x1);
    return spans;
  }

  _setRange(x, ya, yb, color, skipSolid, spans, pred) {
    let runStart = -1;
    for (let y = ya; y <= yb + 1; y++) {
      let change = false;
      if (y <= yb) {
        const i = y * this.w + x;
        const cur = this.cells[i];
        if (pred && !pred(y)) change = false;
        else if (color === 0) change = cur !== 0;
        else change = skipSolid ? cur === 0 : cur !== color;
        if (change) this.cells[i] = color;
      }
      if (change) { if (runStart < 0) runStart = y; }
      else if (runStart >= 0) { spans.push([x, runStart, y - 1, color]); runStart = -1; }
    }
  }

  /** Filled sector (Riot Charge/Blast wedge): pivot (px,py), radius R, center angle deg (0=right, 90=up), half angle deg. */
  wedge(px, py, R, centerDeg, halfDeg) {
    const spans = [];
    const c = centerDeg * Math.PI / 180, hz = halfDeg * Math.PI / 180;
    const x0 = Math.max(0, Math.floor(px - R)), x1 = Math.min(this.w - 1, Math.ceil(px + R));
    for (let x = x0; x <= x1; x++) {
      let runStart = -1;
      const ya = Math.max(0, Math.floor(py - R)), yb = Math.min(this.h - 1, Math.ceil(py + R));
      for (let y = ya; y <= yb + 1; y++) {
        let hit = false;
        if (y <= yb) {
          const dx = x - px, dy = py - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= R * R) {
            let inside = d2 === 0;
            if (!inside) {
              let da = Math.atan2(dy, dx) - c;
              while (da > Math.PI) da -= 2 * Math.PI;
              while (da < -Math.PI) da += 2 * Math.PI;
              inside = Math.abs(da) <= hz;
            }
            hit = inside && this.cells[y * this.w + x] !== 0;
          }
        }
        if (hit) { this.cells[y * this.w + x] = 0; if (runStart < 0) runStart = y; }
        else if (runStart >= 0) { spans.push([x, runStart, y - 1, 0]); runStart = -1; }
      }
    }
    if (spans.length) this.markDirty(x0, x1);
    return spans;
  }

  setCell(x, y, c) {
    if (!this.inb(x, y)) return false;
    const i = y * this.w + x;
    if (this.cells[i] === c) return false;
    this.cells[i] = c; return true;
  }

  // ---- RLE (API contract) ----
  toRLE() {
    const cols = [];
    for (let x = 0; x < this.w; x++) cols.push(this.colRLE(x));
    return { w: this.w, h: this.h, cols };
  }
  colRLE(x) {
    const out = [];
    let y = 0;
    while (y < this.h) {
      const c = this.cells[y * this.w + x];
      if (!c) { y++; continue; }
      let y1 = y;
      while (y1 + 1 < this.h && this.cells[(y1 + 1) * this.w + x] === c) y1++;
      out.push(y, y1, c);
      y = y1 + 1;
    }
    return out;
  }
  clone() { const t = new Terrain(this.w, this.h); t.cells.set(this.cells); t.dirtColors = this.dirtColors.slice(); return t; }
  checksum() { let h = 2166136261; for (let i = 0; i < this.cells.length; i++) h = Math.imul(h ^ this.cells[i], 16777619) >>> 0; return h; }
}

export function decodeTerrain(rle) {
  const g = new Uint8Array(rle.w * rle.h);
  for (let x = 0; x < rle.w; x++) {
    const c = rle.cols[x];
    for (let i = 0; i < c.length; i += 3) for (let y = c[i]; y <= c[i + 1]; y++) g[y * rle.w + x] = c[i + 2];
  }
  return g;
}

/** Apply `terrain` event spans [x,y0,y1,c] to a grid (client helper, used in tests). */
export function applySpans(grid, w, spans) {
  for (const [x, y0, y1, c] of spans) for (let y = y0; y <= y1; y++) grid[y * w + x] = c;
}

// ---- MTN loader (RE §8.2) ----
export function parseMtn(buf) {
  if (buf.length < 0x18 + 48 || buf[0] !== 0x4d || buf[1] !== 0x54) throw new Error('not an MTN file');
  const w = buf.readUInt16LE(6);
  const trim = buf.readUInt16LE(8);
  const height = buf.readUInt16LE(0x0a);
  const mask = buf.readUInt16LE(0x12);
  const palette = [];
  for (let i = 0; i < 16; i++) palette.push([buf[0x18 + i * 3] >> 2, buf[0x18 + i * 3 + 1] >> 2, buf[0x18 + i * 3 + 2] >> 2]);
  const cols = [];
  let off = 0x18 + 48;
  for (let x = 0; x < w; x++) {
    const h = buf.readUInt16LE(off); off += 2;
    const pix = new Uint8Array(h);
    for (let k = 0; k < h; k++) { const b = buf[off + (k >> 1)]; pix[k] = (k & 1) ? b >> 4 : b & 15; }   // low nibble first, bottom->top
    off += (h + 1) >> 1;
    cols.push({ h, pix });
  }
  if (off !== buf.length) throw new Error('MTN trailing/short data');
  return { w, trim, height, mask, palette, cols };
}

export function listMtn(dir) {
  try { return fs.readdirSync(dir).filter((f) => /\.mtn$/i.test(f)).sort(); } catch { return []; }
}
export function loadMtn(dir, name) { return parseMtn(fs.readFileSync(path.join(dir, name))); }

/** random ground color index choice (RE §8.2: rand(6)) */
export function groundRgb(i) { return GROUND_COLORS[i]; }
