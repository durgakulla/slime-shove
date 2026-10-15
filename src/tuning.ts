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
    bestKey: 'slimeShoveBest',
    blurb: 'A long table. Room to plan.',
  },
  rush: {
    id: 'rush',
    label: 'Rush',
    H: 520,
    bestKey: 'slimeShoveBest:rush',
    blurb: 'A short table. The line comes fast.',
  },
};

export const DEFAULT_PROFILE = PROFILES.classic;

const MODE_KEY = 'slimeShoveMode';
const SCORING_KEY = 'slimeShoveScoring';
const SCORING_VERSION = '2';

/**
 * Scores from before the combo was uncapped are not comparable — the old ×9
 * ceiling was hit in nearly every run, so lifting it inflates totals two to
 * three times over. Clear Classic's record once rather than leave a best that
 * can never be read as meaningful. Rush has always been uncapped.
 */
export function migrateScores(): void {
  try {
    if (localStorage.getItem(SCORING_KEY) === SCORING_VERSION) return;
    localStorage.removeItem(PROFILES.classic.bestKey);
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
