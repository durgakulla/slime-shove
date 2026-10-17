// DOM chrome: score, best, the tier ladder and the game-over overlay.
// Everything drawn inside the canvas lives in game.ts instead.

import { TIERS } from './slimes';
import type { RunStats } from './types';

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`missing #${id}`);
  return n as T;
}

const scoreEl = el('score');
const bestEl = el('best');
const ladderEl = el('ladder');
const overEl = el('over');
const finalEl = el('final');
const newBestEl = el('newBest');
const statEls = {
  merges: el('stMerges'),
  bestChain: el('stChain'),
  bestStreak: el('stStreak'),
  shoves: el('stShoves'),
};
const sndEl = el<HTMLButtonElement>('snd');

export function setScore(n: number): void {
  scoreEl.textContent = String(n);
}

export function setBest(n: number): void {
  bestEl.textContent = String(n);
}

export function setSoundLabel(on: boolean): void {
  // Icon-only button: CSS picks the speaker glyph off aria-pressed, so the
  // state only has to be set once, and the label carries it for screen readers.
  sndEl.setAttribute('aria-pressed', String(on));
  sndEl.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  sndEl.title = on ? 'Sound on' : 'Sound off';
}

/** Tiers reached so far light up; the highest sits slightly enlarged. */
export function renderLadder(maxTier: number): void {
  ladderEl.innerHTML = '';
  TIERS.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'rung' + (i <= maxTier ? ' on' : '') + (i === maxTier ? ' top' : '');
    const s = Math.round(8 + t.r * 0.32);
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.width = `${s}px`;
    dot.style.height = `${s}px`;
    dot.style.background = t.c;
    const name = document.createElement('small');
    name.textContent = t.n;
    d.append(dot, name);
    d.title = t.n;
    ladderEl.appendChild(d);
  });
}

const shareNoteEl = el('shareNote');
const shareBtn = el<HTMLButtonElement>('share');
const GAME_URL = 'https://slimeshove.durgakulla.com';
/** The text the Share button sends, rebuilt on every game over. */
let shareText = '';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The share message: score first, then each stat in plain words so someone
 * who has never played can follow it. Lines that would read as zero or
 * meaningless (no streak, no chain) are left out.
 */
function buildShareText(
  score: number,
  run: RunStats,
  newBest: boolean,
  prevBest: number,
  mode: string,
): string {
  // A new best is celebrated; otherwise the standing best gives the score
  // context. A first-ever game has neither.
  const best = newBest
    ? ' 🏆 New best!'
    : prevBest > 0
      ? ` (My best is ${prevBest.toLocaleString()})`
      : '';
  const lines = [
    `🟢 Slime Shove · ${mode}`,
    `I scored ${score.toLocaleString()} points!${best}`,
    '',
    `💥 ${plural(run.merges, 'merge')} in ${plural(run.shoves, 'shove')}`,
  ];
  if (run.bestStreak >= 2) lines.push(`🔥 ${run.bestStreak} shoves in a row with a merge`);
  if (run.bestChain >= 2) lines.push(`⛓️ ${run.bestChain} merges from one shove`);
  lines.push('', 'Can you beat it?');
  return lines.join('\n');
}

export function showGameOver(
  score: number,
  run: RunStats,
  newBest: boolean,
  prevBest: number,
  mode: string,
): void {
  shareText = buildShareText(score, run, newBest, prevBest, mode);
  shareNoteEl.textContent = '';
  finalEl.textContent = String(score);
  newBestEl.hidden = !newBest;
  statEls.merges.textContent = String(run.merges);
  // A chain only means something from the second merge of a shove.
  statEls.bestChain.textContent = run.bestChain >= 2 ? `×${run.bestChain}` : '–';
  statEls.bestStreak.textContent = String(run.bestStreak);
  statEls.shoves.textContent = String(run.shoves);
  overEl.hidden = false;
}

/**
 * Share the last run. Phones get the system share sheet. Desktops copy the
 * text and link instead: desktop Safari and Chrome both expose
 * navigator.share, but there it can open nothing visible and never settle,
 * which reads as a dead button. The button itself confirms the copy.
 */
export async function shareResult(): Promise<void> {
  const full = `${shareText}\n${GAME_URL}`;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text: shareText, url: GAME_URL });
      return;
    } catch (e) {
      // Closing the share sheet rejects with AbortError: the player chose not to.
      if ((e as DOMException)?.name === 'AbortError') return;
      // Anything else falls through to copying.
    }
  }
  if (await copyText(full)) {
    flashShare('Copied!');
  } else {
    shareNoteEl.textContent = 'Could not copy. Try again from the game page.';
  }
}

/** Clipboard API where allowed, else the old textarea trick (plain-http LAN testing). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

let flashTimer = 0;
/** Briefly swap the Share button's label, so the result shows where you tapped. */
function flashShare(label: string): void {
  shareBtn.textContent = label;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (shareBtn.textContent = 'Share'), 1800);
}

export function hideGameOver(): void {
  overEl.hidden = true;
}
