// Shared shapes. Lives apart from the modules that use it so physics, rendering
// and game state can all refer to a slime without importing each other.

/** A slime on the table. Doubles as the options bag for drawSlime(). */
export interface Slime {
  id: number;
  t: number; // tier index
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number; // mass = r²
  age: number;
  wob: number; // wobble amplitude, decays
  ph: number; // wobble phase
  seed: number; // per-slime blob offset
  blink: number;
  nextBlink: number;
  joy: number; // open-mouth timer after a merge
  danger: number; // accumulated time spent past the overflow line
  armed: boolean; // counts toward the lose condition
  ang: number; // movement angle, for squash & stretch
  dead?: boolean; // consumed by a merge this step
}

/** Everything drawSlime() can be told. A Slime satisfies this as-is. */
export interface DrawOpts {
  vx?: number;
  vy?: number;
  wob?: number;
  ph?: number;
  seed?: number;
  ang?: number;
  danger?: number;
  joy?: number;
  blink?: number;
  scale?: number;
  look?: [number, number];
}

export interface State {
  bodies: Slime[];
  score: number;
  maxTier: number;
  pending: number; // tier waiting on the launch line
  next: number; // tier after that
  cool: number;
  launchX: number;
  over: boolean;
  combo: number;
  comboTimer: number;
  seed: number;
}

/**
 * Physics reports what happened rather than doing it, so it stays pure and the
 * spawn sequence can stay deterministic. game.ts drains these each step.
 */
export type GameEvent =
  | { kind: 'merge'; tier: number; fromTier: number; x: number; y: number }
  | { kind: 'king'; x: number; y: number }
  | { kind: 'ring'; x: number; y: number; R: number }
  | { kind: 'bump'; v: number };
