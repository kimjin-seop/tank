// Scorched Earth v1.5 engine core entry. See docs/ENGINE_API.md.
import { Game } from './game.js';
import './shot.js';
import './economy.js';
import './ai.js';

export { Game };
export { decodeTerrain, applySpans, Terrain, parseMtn } from './terrain.js';
export { R250 } from './rng.js';
export { WEAPONS, BY_ID, ITEM_IDS, SHIELDS } from './weapons.js';
export { physConsts, flightConsts, launchVelocity, stepProjectile } from './physics.js';
export { normalizeOptions, explosionScale, DEFAULTS } from './config.js';
export { encodeMkt, decodeMkt } from './economy.js';
export { solveBallistic } from './ai.js';

export function createGame(cfg) { return new Game(cfg); }
