// Single source of truth for colors. build.mjs writes assets/palette.json from this.
export const TOKENS = { P: '#FF00FF', PD: '#990099', PL: '#FF99FF' };

export const OUTLINE = '#0B0E16';

export const NEUTRAL = {
  steel: '#C9D1DE', steelDark: '#6B7588', steelLight: '#EEF2F8',
  tread: '#1D2330', treadLight: '#46526A', wheel: '#2A3142', hub: '#9AA4B8',
  concrete: '#8E96A3', concreteDark: '#5B626E', lens: '#BFF6FF',
};

export const WRECK = {
  P: '#3A3532', PD: '#1E1A18', PL: '#5A524C',
  steel: '#4A4642', steelDark: '#2A2725', steelLight: '#6A645E',
  tread: '#141210', treadLight: '#2A2725', wheel: '#1C1917', hub: '#4A4642',
  ember: '#FF7A1A', emberHot: '#FFD27A',
};

// 10 player colors: hue-separated + luminance-staggered. marker = shape id, ink = number text color.
export const PLAYERS = [
  { n: 1,  name: 'red',     base: '#FF3B3B', marker: 'circle',   ink: '#FFFFFF' },
  { n: 2,  name: 'blue',    base: '#3D7BFF', marker: 'square',   ink: '#FFFFFF' },
  { n: 3,  name: 'yellow',  base: '#FFD21F', marker: 'triangle', ink: '#0B0E16' },
  { n: 4,  name: 'green',   base: '#22C55E', marker: 'diamond',  ink: '#0B0E16' },
  { n: 5,  name: 'orange',  base: '#FF8A1F', marker: 'pentagon', ink: '#0B0E16' },
  { n: 6,  name: 'violet',  base: '#A66BFF', marker: 'hexagon',  ink: '#FFFFFF' },
  { n: 7,  name: 'cyan',    base: '#1FD6F0', marker: 'star',     ink: '#0B0E16' },
  { n: 8,  name: 'magenta', base: '#FF4FC3', marker: 'plus',     ink: '#0B0E16' },
  { n: 9,  name: 'lime',    base: '#C8F23A', marker: 'invtri',   ink: '#0B0E16' },
  { n: 10, name: 'white',   base: '#F2F4F8', marker: 'badge',  ink: '#0B0E16' },
];

export function mix(hex, toHex, t) {
  const a = hex.match(/\w\w/g).map(h => parseInt(h, 16));
  const b = toHex.match(/\w\w/g).map(h => parseInt(h, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function shades(base) {
  return { P: base, PD: mix(base, '#0B0E16', 0.48), PL: mix(base, '#FFFFFF', 0.5) };
}

// Sky = gradient stops (top->horizon) + decoration. Terrain per sky: body layers top->deep, rim = top-surface highlight.
export const SKIES = {
  PLAIN:   { label: '맑음',     stops: [[0, '#2F6FD0'], [0.65, '#6FB4F2'], [1, '#CDEBFF']], deco: 'clouds',
             terrain: { rim: '#9BD46A', rimDark: '#5E9A3A', layers: ['#8A6A44', '#6E5134', '#523A25'], speck: '#A88660' } },
  STORMY:  { label: '폭풍',     stops: [[0, '#1A2029'], [0.6, '#36414E'], [1, '#5E6B78']], deco: 'stormclouds', flash: '#CFE6FF',
             terrain: { rim: '#7E8A80', rimDark: '#4E5852', layers: ['#4A4842', '#3A3833', '#2A2925'], speck: '#5E5B53' } },
  STARS:   { label: '별밤',     stops: [[0, '#03050F'], [0.7, '#0E1636'], [1, '#22305E']], deco: 'stars',
             terrain: { rim: '#8E9BD0', rimDark: '#4B5688', layers: ['#2E3552', '#232941', '#191D30'], speck: '#3C4466' } },
  SHADED:  { label: '그라데이션', stops: [[0, '#1F1850'], [0.5, '#2D4E8C'], [1, '#3FA9A2']], deco: 'bands', bands: 12,
             terrain: { rim: '#D9C27A', rimDark: '#9C8445', layers: ['#7A6A4A', '#5E5038', '#433928'], speck: '#94825C' } },
  SUNSET:  { label: '노을',     stops: [[0, '#25184A'], [0.45, '#9B3C6E'], [0.78, '#F07C55'], [1, '#FFD08A']], deco: 'sun',
             terrain: { rim: '#FFAE6B', rimDark: '#B8603F', layers: ['#4A2B3C', '#38202E', '#271621'], speck: '#5C3A4A' } },
  CAVERN:  { label: '동굴',     stops: [[0, '#0E0A07'], [0.5, '#22180F'], [1, '#3A2A1C']], deco: 'ceiling',
             terrain: { rim: '#A88A64', rimDark: '#6E5638', layers: ['#5A4636', '#45352A', '#30251D'], speck: '#6E5843' } },
  BLACK:   { label: '칠흑',     stops: [[0, '#000000'], [1, '#05060A']], deco: 'none',
             terrain: { rim: '#3A3F4A', rimDark: '#22252C', layers: ['#16181D', '#101115', '#0A0B0E'], speck: '#1E2127' }, darkSky: true },
};
SKIES.STARS.darkSky = true; SKIES.CAVERN.darkSky = true; SKIES.STORMY.darkSky = true;

// Wall colors keep original semantics (hue mapping fixed).
export const WALLS = {
  NONE: '#8A8F98', CONCRETE: '#FFFFFF', PADDED: '#3BD16F', RUBBER: '#FF4040', SPRING: '#22D3EE', WRAP: '#FFD21F',
};

export const SHIELDS = {
  shield:   { label: '방어막',  core: '#5AC8FA', rim: '#C8F0FF' },
  force:    { label: '역장',    core: '#36F5C0', rim: '#D2FFF0' },
  heavy:    { label: '중장갑',  core: '#FFB21E', rim: '#FFE6A8', seam: '#7A4A00' },
  supermag: { label: '초자력',  core: '#C46BFF', rim: '#F3D9FF', accent: '#FF6BE6' },
};

export const UI = {
  turnRing: '#FFFFFF', readyMark: '#3BD16F', damageText: '#FFFFFF', textShadow: '#0B0E16',
};
