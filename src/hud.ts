// DOM chrome: score, best, the tier ladder and the game-over overlay.
// Everything drawn inside the canvas lives in game.ts instead.

import { TIERS } from './slimes';

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
const biggestEl = el('biggest');
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

export function showGameOver(score: number, maxTier: number): void {
  finalEl.textContent = String(score);
  biggestEl.textContent = 'Biggest slime: ' + TIERS[maxTier].n;
  overEl.hidden = false;
}

export function hideGameOver(): void {
  overEl.hidden = true;
}
