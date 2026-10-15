// Tuning constants. These are copied verbatim from the prototype (DESIGN.md §9)
// and are the reason the game feels the way it does. Change them deliberately.

export const W = 360;

// The launch line and overflow line keep a fixed distance from the near edge,
// so a shorter table removes room from the middle rather than from the player.
const LAUNCH_OFFSET = 46;
const LINE_OFFSET = 108;

// Geometry is per-profile (see tuning.ts), so these are `let` and are set once
// by applyProfile() before anything draws. ES module live bindings mean every
// `import { H }` elsewhere sees the updated value — which holds only because
// nothing reads them at module scope.
export let H = 620;
export let LAUNCH_Y = H - LAUNCH_OFFSET; // where the waiting slime sits
export let LINE_Y = H - LINE_OFFSET; // the overflow line

export const MAX_V = 950; // launch speed, straight up
export const FRICTION = 0.95; // exponential damping per second
export const LINEAR_DECEL = 14; // units/s², stops slimes cleanly
export const REST = 0.5; // restitution, walls and slime-slime
export const SNAP_SPEED = 2; // below this, velocity snaps to zero

export const COOLDOWN = 0.45; // seconds between shots
export const DANGER_TIME = 2.2; // resting past the line before game over
export const ARM_AGE = 1.3; // age at which a slime starts counting as a threat
export const DANGER_SPEED = 70; // "at rest" threshold for the overflow check

export const FIXED_DT = 1 / 120;
export const MAX_SUBSTEPS = 8;
export const MAX_FRAME_DT = 0.05;

export const BUMP_SPEED = 120; // impact speed that earns a thud

// Combo multiplier (DESIGN.md §10 priority 1)
export const COMBO_WINDOW = 1.0; // seconds within which merges keep chaining
// Uncapped in practice: the highest combo measured in a strong run is ~41, so
// this is headroom rather than a ceiling anyone should meet. A low cap (the
// original 9) is reached in 39 of 40 runs even by random play, which makes the
// multiplier carry no information about how well you are playing.
export const COMBO_MAX = 50;

// How far above the overflow line the pile starts showing as a threat. The
// danger timer only fires in the last few percent of a run, so this is what
// makes the pressure visible while there is still time to react.
export const WARN_RANGE = 160;

/**
 * Board height is the only thing a game mode changes. Called before the game
 * draws, and again whenever the player switches mode.
 */
export function applyProfile(p: { H: number }): void {
  H = p.H;
  LAUNCH_Y = H - LAUNCH_OFFSET;
  LINE_Y = H - LINE_OFFSET;
}
