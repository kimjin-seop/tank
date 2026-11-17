// R250 shift-register RNG, Scorched Earth v1.5 (REVERSE_ENGINEERING.md §9, 2bf9).
// Deterministic: same 16-bit seed -> same stream. Borland C++ rand() LCG seeds the register.

export class BorlandRand {
  constructor(seed16) { this.seed = seed16 >>> 0; }              // srand: seed32 = seed16
  next() {                                                       // seg0:1FA5
    this.seed = (Math.imul(this.seed, 0x015A4E35) + 1) >>> 0;
    return (this.seed >>> 16) & 0x7fff;
  }
}

export class R250 {
  constructor(seed) {
    this.seed16 = seed & 0xffff;
    this.w = new Uint16Array(250);
    this.idx = 0;
    const b = new BorlandRand(this.seed16);
    const w = this.w;
    for (let k = 0; k < 250; k++) w[k] = b.next();               // 15 bit
    for (let k = 0; k < 250; k++) if (b.next() > 0x4000) w[k] |= 0x8000;
    let m = 0xffff, bit = 0x8000;                                // 2bf9:0004 diagonal bit fix
    for (let i = 0; i < 16; i++) {
      const j = 11 * i + 3;
      w[j] = (w[j] & m) | bit;
      m >>= 1; bit >>= 1;
    }
  }
  r250() {                                                       // 16-bit value
    const w = this.w;
    const i = this.idx;
    const j = i < 147 ? i + 103 : i - 147;
    w[i] ^= w[j];
    const v = w[i];
    this.idx = i >= 249 ? 0 : i + 1;
    return v;
  }
  /** rand_n(n) = r250() % n, n==0 -> 0 (2bf9:048b) */
  int(n) { return n === 0 ? 0 : this.r250() % n; }
  /** frand = r250()/65535.0 in [0,1] (2bf9:00f7) */
  frand() { return this.r250() / 65535.0; }
  state() { let h = this.idx; for (let k = 0; k < 250; k++) h = (Math.imul(h, 31) + this.w[k]) >>> 0; return { idx: this.idx, hash: h }; }
}
