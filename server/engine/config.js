// Options, ranges, constants (REVERSE_ENGINEERING.md §3.4, §5.1, §8).
export const WALLS = ['none', 'wrap', 'padded', 'rubber', 'spring', 'concrete'];      // codes 0..5 (RE §8.5)
export const SKIES = ['plain', 'shaded', 'stars', 'stormy', 'sunset', 'cavern', 'black'];
export const AI_TYPES = ['moron', 'shooter', 'poolshark', 'tosser', 'chooser', 'spoiler', 'cyborg', 'unknown'];
export const TANK_TYPES = ['classic', 'wedge', 'heavy', 'wheeled', 'scout', 'fixed', 'triple'];

export const DEFAULTS = {
  width: 360, height: 480,
  rounds: 10,
  gravity: 0.2, airViscosity: 0, maxWind: 200, changingWind: false,
  wall: 'none', edgesExtend: 75,
  sky: 'random', hostile: true,
  land1: 20, land2: 20, flatland: false, randomLand: false, mtnPercent: 20, mtnDir: null,
  suspendDirt: 0, tanksFall: true, impactDamage: true,
  scale: 'normal', armsLevel: 4, tunneling: true, traceBomb: false, extraDirt: false, uselessItems: false,
  interestRate: 0.05, initialCash: 0, computersBuy: true, freeMarket: false, scoring: 'standard',
  teams: 'none', playOrder: 'random',
  fallingDelay: 10, marketRate: 1.0, market: null,
  fireDelay: 100, bogoMips: 299,          // flight time scale s = fireDelay*bogoMips/(live*100) (PLAYBACK_TIMING.md 2.1; 299 = golden DOSBox-X environment)
};

const RANGES = {
  rounds: [1, 1000], gravity: [0.05, 10], airViscosity: [0, 20], maxWind: [0, 500], edgesExtend: [0, 10000],
  land1: [0, 100], land2: [0, 100], mtnPercent: [0, 100], suspendDirt: [0, 100], armsLevel: [0, 4],
  interestRate: [0, 0.3], initialCash: [0, 1000000], fallingDelay: [0, 1000], width: [64, 1024], height: [64, 1024],
};

export function normalizeOptions(o = {}) {
  const r = { ...DEFAULTS };
  for (const k of Object.keys(o || {})) if (k in DEFAULTS && o[k] !== undefined && o[k] !== null) r[k] = o[k];
  for (const [k, [lo, hi]] of Object.entries(RANGES)) r[k] = Math.min(hi, Math.max(lo, Number(r[k])));
  for (const k of ['width', 'height', 'rounds', 'airViscosity', 'maxWind', 'edgesExtend', 'land1', 'land2', 'suspendDirt', 'armsLevel', 'initialCash', 'fallingDelay', 'mtnPercent']) r[k] = Math.trunc(r[k]);
  return r;
}

/** EXPLOSION_SCALE (RE §5.1): 320-wide modes use 0.5/0.75/1.0, others 1/2/3. */
export function explosionScale(opt) {
  const idx = { normal: 0, medium: 1, large: 2 }[opt.scale] ?? 0;
  return (opt.width <= 320 ? [0.5, 0.75, 1.0] : [1, 2, 3])[idx];
}

// Physics constants
export const DT = 0.02;                 // RE §3.2 (canonical branch of §3.3)
export const ANG_TO_RAD = 0.017453293;  // DS:0x1d08
export const MAX_SPEED2 = 1000000;
// Tank geometry: estimated (RE §8.7: sprite size unknown). STYLE_GUIDE: 9 px hull.
export const TANK = { halfW: 4, height: 6, pivotDy: 5, barrel: 8, shieldR: 10, shieldCy: 3 };

// Palette data (RE §8.2, §8.7)
export const GROUND_COLORS = [[38, 25, 17], [54, 36, 28], [53, 53, 47], [20, 62, 20], [9, 35, 9], [36, 54, 28]];
export const DIRT_BASE = 0x50;
// Dirt-collapse playback speed multiplier (timing only: the simulation, RNG draws and final terrain are unchanged).
// 1 = one pixel per falling tick (50 px/s at fallingDelay 10). 3 = 150 px/s. Tank falls are not affected.
export const DIRT_FALL_RATE = 3;
export const PLAYER_COLORS = [[63, 10, 10], [35, 55, 10], [40, 20, 63], [63, 63, 10], [10, 63, 63], [63, 10, 63], [60, 60, 60], [63, 40, 20], [20, 63, 40], [0, 0, 63]];
