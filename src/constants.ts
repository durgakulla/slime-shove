// Tuning constants. These are copied verbatim from the prototype (DESIGN.md §9)
// and are the reason the game feels the way it does. Change them deliberately.

export const W = 360;
export const H = 620;
export const LAUNCH_Y = H - 46; // 574 — where the waiting slime sits
export const LINE_Y = H - 108; // 512 — the overflow line

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
export const COMBO_MAX = 9;
