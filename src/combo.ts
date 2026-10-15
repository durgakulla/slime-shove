// Combo multiplier (DESIGN.md §10 priority 1): merges that land within
// COMBO_WINDOW of each other keep escalating a score multiplier. Chain
// reactions from blasts cascade inside a single window, which is exactly the
// setup play §1 calls the skill ceiling.

import { COMBO_MAX } from './constants';

/** The multiplier a merge earns, given the current combo and its countdown. */
export function nextCombo(combo: number, timer: number): number {
  return timer > 0 ? Math.min(combo + 1, COMBO_MAX) : 1;
}
