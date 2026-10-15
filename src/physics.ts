// Hand-rolled circle physics (DESIGN.md §4, §5). No library, no gravity.
//
// This module is pure: it mutates the bodies it is given and reports what
// happened through an event list, but it never touches the DOM, audio or the
// score. That keeps a seeded run reproducible and the renderer swappable.

import {
  ARM_AGE,
  DANGER_SPEED,
  DANGER_TIME,
  FRICTION,
  H,
  LINEAR_DECEL,
  LINE_Y,
  REST,
  SNAP_SPEED,
  W,
  WARN_RANGE,
} from './constants';
import { MAXT, body } from './slimes';
import type { GameEvent, Slime, State } from './types';

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
    if (sp < SNAP_SPEED) {
      b.vx = 0;
      b.vy = 0;
    }
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
      b.y = b.r;
      if (b.vy < 0) {
        impact(b, -b.vy, ev);
        b.vy = -b.vy * REST;
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

  // --- pairwise collisions, two passes ---
  const merges: [Slime, Slime][] = [];
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
        if (a.t === b.t) {
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
        // Two King Goos annihilate each other with a much bigger blast.
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
      ev.push({ kind: 'merge', tier: nb.t, fromTier: a.t, x, y });
      blast(S, x, y, nb.r * 2.4 + 30, 230 + nb.t * 22, ev, nb);
    }
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

/** Tier for a newly spawned slime: 40% / 30% / 20% / 10% across tiers 0–3. */
export function pickTier(rnd: () => number): number {
  const x = rnd();
  return x < 0.4 ? 0 : x < 0.7 ? 1 : x < 0.9 ? 2 : 3;
}
