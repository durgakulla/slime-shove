// Game modes.
//
// Classic and Rush are the same game — identical physics, scoring and rules.
// The only thing that differs is the height of the board, which decides how
// long the pile takes to reach the overflow line: Classic gives you a long,
// roomy run, Rush a tense one. Each keeps its own best score, so the two are
// never compared against each other.

export interface Profile {
  id: string;
  label: string;
  /** Board height in world units. Width is always 360. This is the only
   *  difference between modes. */
  H: number;
  /** localStorage key for this mode's best score. */
  bestKey: string;
  /** One-line description, shown on the game-over screen. */
  blurb: string;
}

export const PROFILES: Record<string, Profile> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    H: 620,
    bestKey: 'slimeSmashBest',
    blurb: 'A long table. Room to plan.',
  },
  rush: {
    id: 'rush',
    label: 'Rush',
    H: 520,
    bestKey: 'slimeSmashBest:rush',
    blurb: 'A short table. The line comes fast.',
  },
};

export const DEFAULT_PROFILE = PROFILES.classic;

const MODE_KEY = 'slimeSmashMode';
const SCORING_KEY = 'slimeSmashScoring';
const SCORING_VERSION = '3';

/**
 * The game was renamed from Slime Shove to Slime Smash, and its storage keys
 * with it. Copy anything saved under the old names across once, so players
 * keep their bests and settings. Storage is per-origin, so this only helps
 * players who stay on the same address; a new domain starts empty anyway.
 * Runs before migrateScores(), which reads the scoring key it copies.
 */
const RENAMED_KEYS: [string, string][] = [
  ['slimeShoveBest', 'slimeSmashBest'],
  ['slimeShoveBest:rush', 'slimeSmashBest:rush'],
  ['slimeShoveMode', 'slimeSmashMode'],
  ['slimeShoveScoring', 'slimeSmashScoring'],
  ['slimeShoveA2HS', 'slimeSmashA2HS'],
];
export function migrateStorageKeys(): void {
  try {
    for (const [from, to] of RENAMED_KEYS) {
      const v = localStorage.getItem(from);
      if (v === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, v);
      localStorage.removeItem(from);
    }
  } catch {
    /* private mode — nothing stored, nothing to move */
  }
}

/**
 * Records set under an older scoring rule are not comparable to current ones,
 * so they are cleared once rather than left as a best nobody can read.
 *
 *   v2 — the combo cap was lifted, inflating totals.
 *   v3 — the time-window combo was replaced by chain and streak, which removed
 *        the spam bonus and cut typical scores by roughly a third.
 *
 * Bump SCORING_VERSION whenever scoring changes enough to break comparability.
 */
export function migrateScores(): void {
  try {
    if (localStorage.getItem(SCORING_KEY) === SCORING_VERSION) return;
    for (const p of Object.values(PROFILES)) localStorage.removeItem(p.bestKey);
    localStorage.setItem(SCORING_KEY, SCORING_VERSION);
  } catch {
    /* private mode — nothing stored, nothing to migrate */
  }
}

/** ?mode= wins (handy for testing), then the remembered choice, then Classic. */
export function resolveProfile(search = location.search): Profile {
  const fromUrl = new URLSearchParams(search).get('mode');
  if (fromUrl && PROFILES[fromUrl]) return PROFILES[fromUrl];
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved && PROFILES[saved]) return PROFILES[saved];
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_PROFILE;
}

export function rememberProfile(p: Profile): void {
  try {
    localStorage.setItem(MODE_KEY, p.id);
  } catch {
    /* private mode — the choice just won't stick */
  }
}

export function otherProfile(p: Profile): Profile {
  return p.id === 'classic' ? PROFILES.rush : PROFILES.classic;
}
