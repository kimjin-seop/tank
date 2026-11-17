// Projectile physics (RE §3.1, §3.2). IEEE double, Euler, dt = 0.02 (canonical branch of §3.3).
import { ANG_TO_RAD, DT, MAX_SPEED2 } from './config.js';

/** Constants derived from options + wind (RE §3.2: gravStep=50*G, windStep=wind/40, visc=1-AIR_VISCOSITY/10000). */
export function physConsts(options, wind) {
  return {
    dt: DT,
    gravStep: 50 * options.gravity,
    windStep: wind / 40,
    visc: 1 - options.airViscosity / 10000,
  };
}

/** Launch velocity (RE §3.1, 1a4a:02f2): integers by truncation (vx additionally scaled by the 0.55 pixel aspect, verified vs scenario_001). angleDeg: 0=right, 90=up, 180=left. */
export function launchVelocity(angleDeg, power) {
  const a = angleDeg * ANG_TO_RAD;
  // x velocity goes through the screen transform 3dcc:00a1 (pixel aspect 0.55 = DS:EF34 36044/65536, 32-bit multiply, high word => floor); y is unscaled (EF36 = 0)
  return { vx: Math.floor(Math.trunc(Math.cos(a) * power) * 36044 / 65536), vy: Math.trunc(Math.sin(a) * power) };
}

/** One integration step in place (RE §3.2, 1a4a:0c0d~0e64). p = {x,y,vx,vy}. vy is "up positive", screen y grows downward. */
export function stepProjectile(p, k) {
  const s2 = p.vx * p.vx + p.vy * p.vy;
  if (s2 > MAX_SPEED2) {
    const s = Math.sqrt(s2) / 1000;
    p.vx /= s; p.vy /= s;
  }
  p.x += p.vx * k.dt;
  p.y -= p.vy * k.dt;
  if (k.visc !== 1) { p.vx *= k.visc; p.vy *= k.visc; }
  p.vy -= k.gravStep;
  p.vx += k.windStep;
  return p;
}

/** Original flight constants (1a4a:01c4): s = FIRE_DELAY*BogoMips/(live*100); dt = 1/(50 s), gravStep = 50G/s, windStep = wind/(40 s).
 *  One engine tick = 0.02 s of simulated time = `sub` (= s, rounded) integration substeps. s <= 0 -> coarse dt = 0.02 branch (sub = 1). */
export function flightConsts(options, wind, live = 1) {
  const s = options.fireDelay * options.bogoMips / (Math.max(1, live) * 100);
  const visc = 1 - options.airViscosity / 10000;
  if (!(s > 0)) return { dt: DT, gravStep: 50 * options.gravity, windStep: wind / 40, visc, sub: 1 };
  return { dt: 1 / (50 * s), gravStep: 50 * options.gravity / s, windStep: wind / (40 * s), visc, sub: Math.max(1, Math.round(s)) };
}
