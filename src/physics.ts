// Hand-rolled circle physics (DESIGN.md §4, §5). No library, no gravity.
//
// This module is pure: it mutates the bodies it is given and reports what
// happened through an event list, but it never touches the DOM, audio or the
// score. That keeps a seeded run reproducible and the renderer swappable.

import {
  ARM_AGE,
  BOMB_RADIUS,
  FAN_FADE,
  FAN_HALF,
  FAN_HOVER,
  FAN_PUSH,
  FAN_RISE,
  FAN_SPIN,
  FAN_TIME,
  LAUNCH_Y,
  MAGNET_LAND_SPEED,
  MAGNET_GAIN,
  MAGNET_SPEED,
  MAGNET_STEER,
  MAGNET_RADIUS,
  MAGNET_TIME,
  POWER_CHANCE,
  REACT_REACH,
  DANGER_SPEED,
  DANGER_TIME,
  FRICTION,
  H,
  LINEAR_DECEL,
  LINE_Y,
  REST,
  SNAP_SPEED,
  TOP_REST,
  W,
  WARN_RANGE,
} from './constants';
import { MAXT, POINTS, body } from './slimes';
import type { GameEvent, Slime, Spawn, State } from './types';

export interface StepResult {
  /** 0..1 — how close the worst slime is to overflowing, for the line pulse. */
  lineHot: number;
  /**
   * 0..1 — how far the pile has crept toward the line, measured over
   * WARN_RANGE above it. Unlike lineHot this rises steadily through a run,
   * so the threat is visible long before the danger timer starts.
   */
  pressure: number;
  over: boolean;
}

/** Register an impact: adds wobble, and a thud above BUMP_SPEED. */
function impact(b: Slime, v: number, ev: GameEvent[]): void {
  if (v < 25) return;
  b.wob = Math.min(0.32, b.wob + v / 900);
  ev.push({ kind: 'bump', v });
}

/**
 * Shockwave from a merge: shoves nearby slimes away, with falloff by distance
 * and `heft` by mass, so light slimes fly and heavy ones only budge.
 */
function blast(
  S: State,
  x: number,
  y: number,
  R: number,
  power: number,
  ev: GameEvent[],
  skip?: Slime,
): void {
  ev.push({ kind: 'ring', x, y, R });
  for (const b of S.bodies) {
    if (b.dead || b === skip) continue;
    const dx = b.x - x,
      dy = b.y - y,
      d = Math.hypot(dx, dy) || 0.01,
      reach = R + b.r;

    // Slimes a bit beyond the shove still notice it and pull a surprised face.
    // The reaction reaches further than the physics so the whole neighbourhood
    // reacts, not just the ones that actually get knocked about.
    const notice = reach * REACT_REACH;
    if (d < notice) {
      b.joy = Math.max(b.joy, 0.45 + 0.45 * (1 - d / notice));
    }

    if (d >= reach) continue;
    const fall = 1 - d / reach,
      heft = Math.pow(400 / b.m, 0.3);
    const dv = power * fall * heft;
    b.vx += (dx / d) * dv;
    b.vy += (dy / d) * dv;
    b.wob = Math.min(0.35, b.wob + 0.15 * fall);
    b.armed = b.armed || b.age > 1;
  }
}

/** A magnet that has landed and is pulling. Nothing collides with it. */
function stuckMagnet(b: Slime): boolean {
  return b.power === 'magnet' && b.fuse !== undefined;
}

/** Clamp a magnet in place and start its pull. */
function stickMagnet(m: Slime, ev: GameEvent[]): void {
  if (m.fuse !== undefined) return;
  m.fuse = MAGNET_TIME;
  m.ax = m.x;
  m.ay = m.y;
  m.vx = 0;
  m.vy = 0;
  ev.push({ kind: 'magnetOn', x: m.x, y: m.y, R: MAGNET_RADIUS });
}

export function step(S: State, dt: number, ev: GameEvent[]): StepResult {
  const B = S.bodies;

  // --- friction, integrate, walls ---
  for (const b of B) {
    b.age += dt;
    b.vx *= Math.exp(-FRICTION * dt);
    b.vy *= Math.exp(-FRICTION * dt);
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const d = Math.min(sp, LINEAR_DECEL * dt);
      b.vx -= (b.vx / sp) * d;
      b.vy -= (b.vy / sp) * d;
    }
    if (sp < SNAP_SPEED && !b.pulled) {
      b.vx = 0;
      b.vy = 0;
    }
    b.pulled = false; // a magnet re-sets this below if it is still in range
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) {
      b.x = b.r;
      if (b.vx < 0) {
        impact(b, -b.vx, ev);
        b.vx = -b.vx * REST;
      }
    }
    if (b.x > W - b.r) {
      b.x = W - b.r;
      if (b.vx > 0) {
        impact(b, b.vx, ev);
        b.vx = -b.vx * REST;
      }
    }
    if (b.y < b.r) {
      // far wall — every shot arrives here at full speed
      b.y = b.r;
      if (b.power === 'magnet') {
        // A magnet clamps onto the back wall rather than bouncing off it, so
        // firing it up an empty lane is a deliberate play. The side and near
        // walls still bounce it normally.
        stickMagnet(b, ev);
      } else if (b.vy < 0) {
        impact(b, -b.vy, ev);
        b.vy = -b.vy * TOP_REST;
      }
    }
    if (b.y > H - b.r) {
      b.y = H - b.r;
      if (b.vy > 0) {
        impact(b, b.vy, ev);
        b.vy = -b.vy * REST;
      }
    }
  }

  // --- magnets ---
  // A magnet starts pulling once it has slowed down, gathers everything nearby
  // toward itself for MAGNET_TIME, then vanishes, leaving a clump behind.
  for (const b of B) {
    if (b.power !== 'magnet' || b.dead) continue;
    if (b.fuse === undefined) {
      // Normally it sticks on contact (below, in the collision pass). This is
      // the fallback for a magnet shot into empty space: once it stops, it
      // fires anyway rather than sitting inert forever.
      if (b.age > 0.25 && Math.hypot(b.vx, b.vy) < MAGNET_LAND_SPEED) {
        stickMagnet(b, ev);
      }
      continue;
    }
    b.fuse -= dt;
    b.vx = 0;
    b.vy = 0;
    for (const o of B) {
      if (o === b || o.dead) continue;
      const dx = b.x - o.x,
        dy = b.y - o.y,
        d = Math.hypot(dx, dy) || 0.01;
      if (d > MAGNET_RADIUS) continue;
      // Steer, don't yank: ease the slime's velocity toward a target aimed at
      // the magnet. The target shrinks with distance, so it arrives and stops
      // rather than overshooting. Heavy slimes turn more slowly (same heft
      // curve as a blast), and the edge of the range pulls more gently.
      const fall = 1 - d / MAGNET_RADIUS;
      const speed = Math.min(MAGNET_SPEED, d * MAGNET_GAIN);
      const tvx = (dx / d) * speed;
      let tvy = (dy / d) * speed;
      const rate = Math.min(1, MAGNET_STEER * (0.35 + 0.65 * fall) * Math.pow(400 / o.m, 0.3) * dt);
      o.vx += (tvx - o.vx) * rate;
      // Never toward the overflow line: a slime above a low magnet is gathered
      // sideways only, and its vertical motion is left alone.
      if (tvy > 0) tvy = Math.min(o.vy, 0);
      o.vy += (tvy - o.vy) * rate;
      o.pulled = true;
    }
  }

  // --- fan ---
  // Flies up from the launch line, hovers just above the overflow line, and
  // blows every slime in its band toward the far wall. It is not a body, so
  // nothing collides with it.
  const F = S.fan;
  if (F) {
    F.age += dt;
    const hoverY = LINE_Y - FAN_HOVER;
    const u = Math.min(1, F.age / FAN_RISE);
    F.y = LAUNCH_Y + (hoverY - LAUNCH_Y) * (1 - (1 - u) * (1 - u));
    const w = F.age - FAN_RISE; // time since it reached the hover point
    if (w >= 0 && !F.on) {
      F.on = true;
      ev.push({ kind: 'fanOn', x: F.x });
    }
    const k = fanStrength(w);
    if (k > 0) {
      const lo = F.x - FAN_HALF,
        hi = F.x + FAN_HALF;
      for (const b of B) {
        if (b.dead) continue;
        // Share of the slime's width inside the band, so one straddling the
        // edge gets a partial push rather than all or nothing.
        const overlap = (Math.min(b.x + b.r, hi) - Math.max(b.x - b.r, lo)) / (2 * b.r);
        if (overlap <= 0) continue;
        // Same heft curve as a blast, so heavy slimes are slower to go.
        b.vy -= FAN_PUSH * k * Math.min(1, overlap) * Math.pow(400 / b.m, 0.3) * dt;
        // The push per step is below SNAP_SPEED, the same trap as the magnet.
        b.pulled = true;
        b.armed = b.armed || b.age > 1;
        b.wob = Math.min(0.2, b.wob + 0.004);
      }
    }
    if (w >= FAN_SPIN + FAN_TIME + FAN_FADE) {
      ev.push({ kind: 'fanOff', x: F.x, y: F.y });
      S.fan = undefined;
    }
  }

  // --- pairwise collisions, two passes ---
  const merges: [Slime, Slime][] = [];
  const bombs: Slime[] = [];
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (a.dead) continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (b.dead) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          min = a.r + b.r,
          d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        // Once a magnet has stuck it is intangible: the slimes it drags in pass
        // straight through it and meet each other on top of it, so they merge
        // instead of jamming against the magnet.
        if (stuckMagnet(a) || stuckMagnet(b)) continue;
        // A bomb goes off the instant it touches anything.
        const bomb = a.power === 'bomb' ? a : b.power === 'bomb' ? b : null;
        if (bomb) {
          bomb.dead = true;
          bombs.push(bomb);
          break;
        }
        // A rainbow merges with whatever ordinary slime it meets, taking that
        // slime's tier. Pushed as [other, rainbow] because merge resolution
        // reads the first entry's tier — so a rainbow on a King Slimer
        // annihilates exactly as two King Slimers would.
        const rb = a.power === 'rainbow' ? a : b.power === 'rainbow' ? b : null;
        if (rb) {
          const other = rb === a ? b : a;
          if (!other.power) {
            rb.dead = other.dead = true;
            merges.push([other, rb]);
            break;
          }
        }
        // A magnet sticks to the first thing it touches and starts pulling.
        // This first contact still resolves normally; from the next pair on it
        // is skipped above. The anchor below pins it to the spot it landed.
        const mag = a.power === 'magnet' ? a : b.power === 'magnet' ? b : null;
        if (mag) stickMagnet(mag, ev);

        // Other powers never merge, whatever tier they nominally carry.
        if (a.t === b.t && !a.power && !b.power) {
          a.dead = b.dead = true;
          merges.push([a, b]);
          break;
        }
        const nx = dx / d,
          ny = dy / d,
          ov = min - d,
          tot = a.m + b.m;
        a.x -= (nx * ov * b.m) / tot;
        a.y -= (ny * ov * b.m) / tot;
        b.x += (nx * ov * a.m) / tot;
        b.y += (ny * ov * a.m) / tot;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const jimp = (-(1 + REST) * vn) / (1 / a.m + 1 / b.m);
          a.vx -= (jimp * nx) / a.m;
          a.vy -= (jimp * ny) / a.m;
          b.vx += (jimp * nx) / b.m;
          b.vy += (jimp * ny) / b.m;
          impact(a, ((-vn * b.m) / tot) * 1.6, ev);
          impact(b, ((-vn * a.m) / tot) * 1.6, ev);
        }
      }
    }
  }

  // --- resolve merges ---
  if (merges.length) {
    for (const [a, b] of merges) {
      const tot = a.m + b.m,
        x = (a.x * a.m + b.x * b.m) / tot,
        y = (a.y * a.m + b.y * b.m) / tot;
      const vx = ((a.vx * a.m + b.vx * b.m) / tot) * 0.45,
        vy = ((a.vy * a.m + b.vy * b.m) / tot) * 0.45;
      if (a.t === MAXT) {
        // Two King Slimers annihilate each other with a much bigger blast.
        ev.push({ kind: 'king', x, y });
        blast(S, x, y, 220, 520, ev);
        continue;
      }
      const nb = body(a.t + 1, x, y, vx, vy);
      nb.wob = 0.35;
      nb.joy = 0.9;
      nb.armed = a.armed || b.armed;
      nb.age = Math.max(a.age, b.age);
      nb.x = Math.min(W - nb.r, Math.max(nb.r, nb.x));
      nb.y = Math.min(H - nb.r, Math.max(nb.r, nb.y));
      B.push(nb);
      S.maxTier = Math.max(S.maxTier, nb.t);
      // b is the rainbow when one was involved: merges are pushed as
      // [ordinary slime, rainbow] so the tier comes from the right one.
      ev.push({ kind: 'merge', tier: nb.t, fromTier: a.t, x, y, rainbow: b.power === 'rainbow' });
      // Half the prototype's 230 + t*22: at full strength a merge on a magnet
      // flung away the very slimes the magnet was gathering.
      blast(S, x, y, nb.r * 2.4 + 30, 115 + nb.t * 11, ev, nb);
    }
  }

  // --- bombs ---
  // Everything within reach is destroyed outright and pays out its tier value.
  // No combo multiplier: the bomb is an escape hatch, not a chain.
  for (const bomb of bombs) {
    let points = 0;
    const colors: string[] = [];
    for (const o of B) {
      if (o === bomb || o.dead) continue;
      if (Math.hypot(o.x - bomb.x, o.y - bomb.y) > BOMB_RADIUS + o.r) continue;
      o.dead = true;
      if (!o.power) {
        points += POINTS[o.t];
        colors.push(String(o.t));
      }
    }
    ev.push({ kind: 'bomb', x: bomb.x, y: bomb.y, R: BOMB_RADIUS, points, colors });
    // Shove whatever survived at the edge of the blast.
    blast(S, bomb.x, bomb.y, BOMB_RADIUS, 300, ev);
  }

  // --- magnets that have finished pulling ---
  for (const b of B) {
    if (b.power !== 'magnet' || b.dead || b.fuse === undefined) continue;
    // Anchored, so nothing else (a blast, the fan) can move it once it lands.
    if (b.ax !== undefined && b.ay !== undefined) {
      b.x = b.ax;
      b.y = b.ay;
      b.vx = 0;
      b.vy = 0;
    }
    if (b.fuse <= 0) {
      b.dead = true;
      ev.push({ kind: 'magnetOff', x: b.x, y: b.y });
    }
  }

  if (merges.length || bombs.length || B.some((b) => b.dead)) {
    S.bodies = B.filter((b) => !b.dead);
  }

  // --- overflow / lose condition ---
  let hot = 0;
  let press = 0;
  for (const b of S.bodies) {
    if (!b.armed && (b.y < LINE_Y - b.r || b.age > ARM_AGE)) b.armed = true;
    const sp = Math.hypot(b.vx, b.vy);
    if (b.armed && sp < DANGER_SPEED && b.y + b.r * 0.4 > LINE_Y) {
      b.danger += dt;
    } else {
      b.danger = Math.max(0, b.danger - dt * 2);
    }
    hot = Math.max(hot, b.danger / DANGER_TIME);
    // How far this slime's leading edge has encroached on the warning band.
    // Only settled slimes count, or a shot in flight would spike it to 1.
    if (sp < DANGER_SPEED) {
      const edge = b.y + b.r * 0.4;
      press = Math.max(press, (edge - (LINE_Y - WARN_RANGE)) / WARN_RANGE);
    }
    if (b.danger > DANGER_TIME) {
      return { lineHot: hot, pressure: 1, over: true };
    }
  }
  return { lineHot: hot, pressure: Math.max(0, Math.min(1, press)), over: false };
}

/**
 * 0..1 wind strength `w` seconds after the fan reached its hover point:
 * ramps up over FAN_SPIN, holds for FAN_TIME, then dies away over FAN_FADE.
 */
export function fanStrength(w: number): number {
  if (w <= 0) return 0;
  if (w < FAN_SPIN) return w / FAN_SPIN;
  if (w < FAN_SPIN + FAN_TIME) return 1;
  return Math.max(0, 1 - (w - FAN_SPIN - FAN_TIME) / FAN_FADE);
}

/** Tier for an ordinary slime: 40% / 30% / 20% / 10% across tiers 0–3. */
export function pickTier(rnd: () => number): number {
  const x = rnd();
  return x < 0.4 ? 0 : x < 0.7 ? 1 : x < 0.9 ? 2 : 3;
}

/**
 * What arrives on the launch line. Draws from the seeded RNG like every other
 * gameplay decision, so a seeded run stays reproducible.
 */
export function pickSpawn(rnd: () => number): Spawn {
  if (rnd() < POWER_CHANCE) {
    const k = rnd();
    return { t: 0, power: k < 0.25 ? 'bomb' : k < 0.5 ? 'magnet' : k < 0.75 ? 'rainbow' : 'fan' };
  }
  return { t: pickTier(rnd) };
}
