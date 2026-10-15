// Seeded RNG for the spawn sequence only (DESIGN.md §10: "keep the logic
// deterministic given a seed, to allow a daily challenge later").
//
// Purely cosmetic randomness — blob seeds, blink timing, particle spray, bump
// pitch — deliberately stays on Math.random(), so the renderer never perturbs
// the gameplay sequence and a replay of the same seed plays out identically.

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for a spawn table. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
