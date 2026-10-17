// Shared shapes. Lives apart from the modules that use it so physics, rendering
// and game state can all refer to a slime without importing each other.

/** Special slimes that do something instead of merging. */
export type PowerKind = 'bomb' | 'magnet' | 'rainbow' | 'fan';

/** What is queued on the launch line: a tier, or a power instead. */
export interface Spawn {
  t: number;
  power?: PowerKind;
}

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
  power?: PowerKind; // set only on special slimes; these never merge
  fuse?: number; // magnet: seconds of pull left. undefined until it lands
  /**
   * Set each step by a magnet that is pulling this slime. Exempts it from the
   * clean-stop snap: the pull accumulates ~1.4/step, below SNAP_SPEED, so
   * without this the snap zeroes it every step and nothing ever moves.
   */
  pulled?: boolean;
  ax?: number; // magnet: anchor, so the slimes it drags in cannot shove it
  ay?: number;
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
  power?: PowerKind;
  /** Overrides the tier radius — power slimes are a fixed size. */
  radius?: number;
  /** Magnet: 0..1 of its pull remaining, for the ring animation. */
  pull?: number;
  /** Fan: blade speed in turns per second. Omitted, it idles slowly. */
  spin?: number;
  /**
   * Fan: blade angle in radians, accumulated by the caller. Deriving it from
   * time × spin would jump every time the speed changes.
   */
  rot?: number;
}

/**
 * A fan in play. Deliberately not a Slime and not in `bodies`: it hovers over
 * the table without colliding, so it can never block a slime or overflow.
 */
export interface Fan {
  x: number; // centre of the two-lane band it blows up
  y: number;
  age: number; // seconds since launch; drives rise, spin-up, blow and fade
  on: boolean; // fanOn has fired
}

/** Totals for one run, shown on the game-over screen. */
export interface RunStats {
  merges: number;
  bestChain: number; // most merges from a single shove
  bestStreak: number; // most consecutive shoves that each merged
  shoves: number;
}

export interface State {
  bodies: Slime[];
  score: number;
  maxTier: number;
  pending: Spawn; // waiting on the launch line
  next: Spawn; // queued after that
  cool: number;
  launchX: number;
  over: boolean;
  /** Merges so far in the current shove. Reset on every launch. */
  chain: number;
  /** Consecutive shoves that each merged something. */
  streak: number;
  seed: number;
  fan?: Fan;
  run: RunStats;
}

/**
 * Physics reports what happened rather than doing it, so it stays pure and the
 * spawn sequence can stay deterministic. game.ts drains these each step.
 */
export type GameEvent =
  | { kind: 'merge'; tier: number; fromTier: number; x: number; y: number; rainbow?: boolean }
  | { kind: 'king'; x: number; y: number }
  | { kind: 'ring'; x: number; y: number; R: number }
  | { kind: 'bump'; v: number }
  | { kind: 'bomb'; x: number; y: number; R: number; points: number; colors: string[] }
  | { kind: 'magnetOn'; x: number; y: number; R: number }
  | { kind: 'magnetOff'; x: number; y: number }
  | { kind: 'fanOn'; x: number }
  | { kind: 'fanOff'; x: number; y: number };
