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
export const REST = 0.5; // restitution, side/near walls and slime-slime
// The far wall takes every shot at full speed, so it is the one bounce the
// player feels most. At REST (0.5) a shot rebounds 169 units — close to a
// third of the table — which playtested as too bouncy. At 0.25 it comes back
// 73 units and settles near the back. Game length is barely affected either
// way; this is a feel number.
export const TOP_REST = 0.25;
export const SNAP_SPEED = 2; // below this, velocity snaps to zero

export const COOLDOWN = 0.45; // seconds between shots
export const DANGER_TIME = 2.2; // resting past the line before game over
export const ARM_AGE = 1.3; // age at which a slime starts counting as a threat
export const DANGER_SPEED = 70; // "at rest" threshold for the overflow check

export const FIXED_DT = 1 / 120;
export const MAX_SUBSTEPS = 8;
export const MAX_FRAME_DT = 0.05;

export const BUMP_SPEED = 120; // impact speed that earns a thud

// --- Scoring multipliers (DESIGN.md §5a) ---
// Chain: the nth merge of a single shove pays xn. A long cascade is where the
// big scores come from, and it is earned by placement, not by shoving fast.
export const CHAIN_MAX = 20;
// Streak: a steadier bonus for keeping every shove productive.
export const STREAK_STEP = 0.25;
export const STREAK_MAX_MULT = 3;

// --- Power slimes (DESIGN.md §3a) ---
// Share of spawns that arrive as a power rather than a tier slime, split
// evenly between the four kinds.
export const POWER_CHANCE = 0.04;
export const POWER_R = 20; // every power slime is this size
export const BOMB_RADIUS = 86; // slimes inside this are destroyed
export const MAGNET_RADIUS = 150;
// The magnet steers rather than yanks: each slime eases toward a target
// velocity aimed at the magnet, which shrinks as it closes in, so slimes arrive
// gently instead of overshooting or crashing into the clump.
export const MAGNET_SPEED = 170; // fastest approach speed
export const MAGNET_GAIN = 3.5; // target speed per unit of distance, so it slows on arrival
export const MAGNET_STEER = 5; // how quickly velocity turns toward the target, per second
export const MAGNET_TIME = 1.1; // seconds it pulls before vanishing
export const MAGNET_LAND_SPEED = 70; // it starts pulling once this slow
// Fan: hovers above the overflow line and blows a two-lane band toward the
// far wall. Phases run back to back: rise, spin up, blow, spin down.
export const FAN_HALF = W / 6; // half the band width: the band is two lanes
export const FAN_HOVER = 26; // hover height above the overflow line
export const FAN_RISE = 0.18;
export const FAN_SPIN = 0.35;
export const FAN_TIME = 1.2;
export const FAN_FADE = 0.25;
export const FAN_PUSH = 1500; // upward acceleration at full strength

// How far past a blast's physical reach slimes still pull a surprised face.
export const REACT_REACH = 1.5;

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
