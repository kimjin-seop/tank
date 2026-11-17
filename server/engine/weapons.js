// Weapon/item table (REVERSE_ENGINEERING.md §4, DS:0x11F6 + 0x34*i, 48 records) and shield table (§6).
// Prices/bundles/arms are EXE values (Liquid Dirt 5/2 and Dirt Charge 10/1 follow the EXE, §4 note).
// `id` strings equal data/items_ko.json ids; the engine only uses ids.

// [id, price, bundle, arms, param, kind]
const T = [
  ['baby_missile', 400, 10, 0, 10, 'explode'],
  ['missile', 1875, 5, 0, 20, 'explode'],
  ['baby_nuke', 10000, 3, 0, 40, 'explode'],
  ['nuke', 12000, 1, 1, 75, 'explode'],
  ['leap_frog', 10000, 2, 3, 3, 'leapfrog'],
  ['funky_bomb', 7000, 2, 4, 80, 'funky'],
  ['mirv', 10000, 3, 2, 0, 'mirv'],
  ['deaths_head', 20000, 1, 4, 1, 'mirv'],
  ['napalm', 10000, 10, 2, 15, 'napalm'],
  ['hot_napalm', 20000, 2, 4, 20, 'napalm'],
  ['tracer', 10, 20, 0, 0, 'tracer'],
  ['smoke_tracer', 500, 10, 0, 1, 'tracer'],
  ['baby_roller', 5000, 10, 2, 10, 'roller'],
  ['roller', 6000, 5, 2, 20, 'roller'],
  ['heavy_roller', 6750, 2, 3, 45, 'roller'],
  ['riot_charge', 2000, 10, 2, 0, 'riotcharge'],
  ['riot_blast', 5000, 5, 3, 1, 'riotcharge'],
  ['riot_bomb', 5000, 5, 3, 30, 'riotbomb'],
  ['heavy_riot_bomb', 4750, 2, 3, 45, 'riotbomb'],
  ['baby_digger', 3000, 10, 0, -10, 'digger'],
  ['digger', 2500, 5, 0, -20, 'digger'],
  ['heavy_digger', 6750, 2, 1, -35, 'digger'],
  ['baby_sandhog', 10000, 10, 0, 10, 'digger'],
  ['sandhog', 16750, 5, 0, 20, 'digger'],
  ['heavy_sandhog', 25000, 2, 1, 35, 'digger'],
  ['dirt_clod', 5000, 10, 0, 20, 'dirt'],
  ['dirt_ball', 5000, 5, 0, 35, 'dirt'],
  ['ton_of_dirt', 6750, 2, 1, 70, 'dirt'],
  ['liquid_dirt', 5000, 5, 2, -20, 'napalm'],
  ['dirt_charge', 5000, 10, 1, 0, 'dirtcharge'],
  ['earth_disrupter', 5000, 10, 0, 0, 'disrupter'],
  ['plasma_blast', 9000, 5, 3, 0, 'plasma'],
  ['laser', 5000, 5, 2, 0, 'laser'],
  ['heat_guidance', 10000, 6, 2, 0, 'guidance'],
  ['ballistic_guidance', 10000, 2, 2, 0, 'guidance'],
  ['horz_guidance', 15000, 5, 1, 0, 'guidance'],
  ['vert_guidance', 20000, 5, 1, 0, 'guidance'],
  ['lazy_boy', 20000, 2, 3, 0, 'guidance'],
  ['parachute', 10000, 8, 2, 0, 'gear'],
  ['battery', 5000, 10, 2, 0, 'gear'],
  ['mag_deflector', 10000, 2, 2, 0, 'shield'],
  ['shield', 20000, 3, 3, 0, 'shield'],
  ['force_shield', 25000, 3, 3, 0, 'shield'],
  ['heavy_shield', 30000, 2, 4, 0, 'shield'],
  ['super_mag', 40000, 2, 4, 0, 'shield'],
  ['auto_defense', 1500, 1, 3, 0, 'gear'],
  ['fuel_tank', 10000, 10, 3, 0, 'gear'],
  ['contact_trigger', 1000, 25, 3, 0, 'gear'],
];

export const WEAPONS = T.map(([id, price, bundle, arms, param, kind], idx) => ({ idx, id, price, bundle, arms, param, kind }));
// Lookup tables keyed by client-supplied strings are prototype-less: 'constructor', '__proto__', 'toString' ... must miss.
const dict = (o) => Object.assign(Object.create(null), o);
export const BY_ID = dict(Object.fromEntries(WEAPONS.map((w) => [w.id, w])));
export const ITEM_IDS = WEAPONS.map((w) => w.id);
export const isFireable = (w) => w.idx <= 32;                 // 0..32 are weapons
export const GUIDANCE_IDS = ['heat_guidance', 'ballistic_guidance', 'horz_guidance', 'vert_guidance', 'lazy_boy'];
export const GUIDANCE_KIND = dict({ heat: 'heat_guidance', ballistic: 'ballistic_guidance', horz: 'horz_guidance', vert: 'vert_guidance', lazy: 'lazy_boy' });
// weapons that cannot be guided (SPEC 2 notes)
export const UNGUIDABLE = new Set(['mirv', 'deaths_head', 'riot_charge', 'riot_blast', 'plasma_blast', 'laser']);

// Shields (RE §6, DS:0x616C). flags: 1 reflect(force), 2 mag, 4 super-mag (mag + reflect + laser immune)
export const SHIELDS = dict({
  mag_deflector: { hp: 55, flags: 2 },
  shield: { hp: 100, flags: 0 },
  force_shield: { hp: 100, flags: 1 },
  heavy_shield: { hp: 150, flags: 0 },
  super_mag: { hp: 200, flags: 4 },
});

export const MAX_STOCK = 99;
export const MAX_HP = 100;
