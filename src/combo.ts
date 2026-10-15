// Scoring multipliers (DESIGN.md §5a).
//
// Deliberately NOT time-based. A time window rewards shoving fast: with a
// 0.45 s cooldown and a 1 s window, merges from unrelated shoves chained
// together simply because the player spammed the launch line. The two things
// worth rewarding are both about placement:
//
//   chain  — merges that cascade from a single shove. Reset on every launch,
//            so shoving again early cuts your own chain short.
//   streak — consecutive shoves that each produced at least one merge. Breaks
//            the moment a shove merges nothing.

import { CHAIN_MAX, STREAK_MAX_MULT, STREAK_STEP } from './constants';

/** Multiplier for the nth merge of a single shove: the 3rd merge pays x3. */
export function chainMultiplier(chain: number): number {
  return Math.max(1, Math.min(chain, CHAIN_MAX));
}

/** A gentler, steady bonus for keeping every shove productive. */
export function streakMultiplier(streak: number): number {
  return Math.min(1 + STREAK_STEP * streak, STREAK_MAX_MULT);
}

/** Points for one merge, given where it falls in the chain and the streak. */
export function mergeScore(base: number, chain: number, streak: number): number {
  return Math.round(base * chainMultiplier(chain) * streakMultiplier(streak));
}

/**
 * Called as a new slime launches. The shove that just ended is scored: if it
 * merged anything the streak grows, otherwise it breaks. Then the chain resets
 * for the shove about to happen.
 */
export function onLaunch(s: { chain: number; streak: number }): void {
  s.streak = s.chain > 0 ? s.streak + 1 : 0;
  s.chain = 0;
}
