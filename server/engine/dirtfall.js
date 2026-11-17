// Dirt collapse (RE §5.3, 1a1e:0107 + 162c:0238): vertical only, columns in parallel, 1 px per frame.
// A floating chunk moves down by erasing its top pixel and adding a new random-colored pixel under its bottom.

/**
 * @param {Terrain} T
 * @param {R250} rng
 * @param {(x:number,y:number)=>boolean} tankAt  true if a tank body occupies the cell (tanks block falling dirt, RE: tank pixels < 0x69)
 * @param {{x0:number,x1:number}} range  inclusive column range (already includes the +-5 margin if desired)
 * @returns {{frames:number, chunks:Array, spans:Array}}
 */
export function dirtFall(T, rng, tankAt, range, lim = {}) {
  const x0 = Math.max(0, range.x0), x1 = Math.min(T.w - 1, range.x1);
  const w = T.w, h = T.h, cells = T.cells;
  const bottom = lim.bottom ?? h - 1;                // last row dirt can rest on (original: playfield bottom, below it is the frame)
  const anchorTop = lim.anchorTop ?? -1;             // cavern: dirt attached to the ceiling row never falls
  const free = (x, y) => y <= bottom && cells[y * w + x] === 0 && !tankAt(x, y);
  const find = (x) => {                         // lowest unsupported chunk in column
    for (let y = bottom - 1; y >= 0; y--) {
      if (cells[y * w + x] !== 0 && free(x, y + 1)) {
        let top = y;
        while (top - 1 >= 0 && cells[(top - 1) * w + x] !== 0) top--;
        if (top <= anchorTop) continue;
        return { top, bot: y };
      }
    }
    return null;
  };
  const before = new Map();
  const active = [];
  const chunks = [];
  for (let x = x0; x <= x1; x++) {
    const c = find(x);
    if (c) {
      before.set(x, T.colRLE(x));
      const rec = { x, y0: c.top, y1: c.bot, dy: 0, t0: 0 };
      chunks.push(rec);
      active.push({ x, top: c.top, bot: c.bot, rec });
    }
  }
  let frame = 0;
  let live = active;
  while (live.length) {
    frame++;
    const next = [];
    for (const col of live) {
      const x = col.x;
      cells[col.top * w + x] = 0;
      col.top++;
      const colors = T.dirtColors;
      cells[(col.bot + 1) * w + x] = colors[rng.int(colors.length)];
      col.bot++;
      col.rec.dy++;
      if (free(x, col.bot + 1)) { next.push(col); continue; }
      const c = find(x);                        // landed: re-scan the column
      if (c) {
        const rec = { x, y0: c.top, y1: c.bot, dy: 0, t0: frame };
        chunks.push(rec);
        next.push({ x, top: c.top, bot: c.bot, rec });
      }
    }
    live = next;
  }
  // changed spans = diff against the pre-state of touched columns
  const spans = [];
  for (const [x, oldRle] of before) {
    const old = new Uint8Array(h);
    for (let i = 0; i < oldRle.length; i += 3) for (let y = oldRle[i]; y <= oldRle[i + 1]; y++) old[y] = oldRle[i + 2];
    let y = 0;
    while (y < h) {
      const nv = cells[y * w + x];
      if (nv === old[y]) { y++; continue; }
      let y1 = y;
      while (y1 + 1 < h && cells[(y1 + 1) * w + x] === nv && old[y1 + 1] !== nv) y1++;
      spans.push([x, y, y1, nv]);
      y = y1 + 1;
    }
  }
  if (before.size) T.markDirty(x0, x1);
  return { frames: frame, chunks, spans };
}
