// 상점 가격 폴백표(docs/scorch_data.json items: price/bundle/arms). 서버가 shop 목록을 주면 그쪽이 우선.
// [id, price($/묶음), bundle, arms]
const T = [
  ['baby_missile', 400, 10, 0], ['missile', 1875, 5, 0], ['baby_nuke', 10000, 3, 0], ['nuke', 12000, 1, 1],
  ['leap_frog', 10000, 2, 3], ['funky_bomb', 7000, 2, 4], ['mirv', 10000, 3, 2], ['deaths_head', 20000, 1, 4],
  ['napalm', 10000, 10, 2], ['hot_napalm', 20000, 2, 4], ['tracer', 10, 20, 0], ['smoke_tracer', 500, 10, 0],
  ['baby_roller', 5000, 10, 2], ['roller', 6000, 5, 2], ['heavy_roller', 6750, 2, 3], ['riot_charge', 2000, 10, 2],
  ['riot_blast', 5000, 5, 3], ['riot_bomb', 5000, 5, 3], ['heavy_riot_bomb', 4750, 2, 3], ['baby_digger', 3000, 10, 0],
  ['digger', 2500, 5, 0], ['heavy_digger', 6750, 2, 1], ['baby_sandhog', 10000, 10, 0], ['sandhog', 16750, 5, 0],
  ['heavy_sandhog', 25000, 2, 1], ['dirt_clod', 5000, 10, 0], ['dirt_ball', 5000, 5, 0], ['ton_of_dirt', 6750, 2, 1],
  ['liquid_dirt', 5000, 5, 2], ['dirt_charge', 5000, 10, 1], ['earth_disrupter', 5000, 10, 0], ['plasma_blast', 9000, 5, 3],
  ['laser', 5000, 5, 2], ['heat_guidance', 10000, 6, 2], ['ballistic_guidance', 10000, 2, 2], ['horz_guidance', 15000, 5, 1],
  ['vert_guidance', 20000, 5, 1], ['lazy_boy', 20000, 2, 3], ['parachute', 10000, 8, 2], ['battery', 5000, 10, 2],
  ['mag_deflector', 10000, 2, 2], ['shield', 20000, 3, 3], ['force_shield', 25000, 3, 3], ['heavy_shield', 30000, 2, 4],
  ['super_mag', 40000, 2, 4], ['auto_defense', 1500, 1, 3], ['fuel_tank', 10000, 10, 3], ['contact_trigger', 1000, 25, 3],
];
export const PRICE = new Map(T.map(([id, price, bundle, arms]) => [id, { id, price, bundle, arms }]));
export const ITEM_ORDER = T.map(r => r[0]);
export const WEAPON_IDS = ITEM_ORDER.slice(0, 33);
