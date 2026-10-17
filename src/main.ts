// Entry point: fonts, styles, button wiring and the resize observer.

import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import './style.css';

import { isSoundOn, toggleSound } from './audio';
import { applyProfile } from './constants';
import { currentProfile, fit, restart, setPaused, setProfile, start } from './game';
import { closeHelp, isHelpOpen, openHelp } from './help';
import { setSoundLabel, shareResult } from './hud';
import { migrateScores, otherProfile, rememberProfile, resolveProfile, type Profile } from './tuning';

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`missing #${id}`);
  return n as T;
}

// Clear records that were set under the old capped scoring, before any are read.
migrateScores();

// Board height is per-mode, so this must happen before anything reads it.
const profile = resolveProfile();
applyProfile(profile);

const canvas = el<HTMLCanvasElement>('c');
const stage = el('stage');
const modeBtn = el<HTMLButtonElement>('mode');

function showMode(p: Profile, updateUrl: boolean): void {
  modeBtn.textContent = p.label;
  modeBtn.title = `${p.label} — ${p.blurb}  (tap for ${otherProfile(p).label})`;
  modeBtn.setAttribute('aria-label', `Game mode: ${p.label}. Switch to ${otherProfile(p).label}`);
  if (!updateUrl) return;
  // Only touched on a deliberate mode switch, and only when it would actually
  // change. Rewriting the URL during initial load sent iOS Safari into a
  // navigation loop: it reloaded the original address, which rewrote the URL
  // again, about 22 times until Safari's loop guard stopped it. The mode is
  // persisted in localStorage regardless, so the URL is only a convenience.
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('mode') === p.id) return;
    url.searchParams.set('mode', p.id);
    history.replaceState(null, '', url);
  } catch {
    /* Safari throttles history writes; the mode is already saved */
  }
}

modeBtn.addEventListener('click', () => {
  // Switching starts a fresh game, same as New — the board changes size.
  const next = otherProfile(currentProfile());
  rememberProfile(next);
  setProfile(next);
  showMode(next, true);
});

// Help pauses the game, so a run cannot end while you are reading.
function showHelp(open: boolean): void {
  if (open) openHelp();
  else closeHelp();
  setPaused(open);
}
el('help').addEventListener('click', () => showHelp(!isHelpOpen()));
el('helpClose').addEventListener('click', () => showHelp(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isHelpOpen()) showHelp(false);
});

el('rst').addEventListener('click', () => restart());
el('again').addEventListener('click', () => restart());
el('share').addEventListener('click', () => void shareResult());
el('snd').addEventListener('click', () => setSoundLabel(toggleSound()));

// The ladder and score share the stage, so their size changes refit the board too.
const ro = new ResizeObserver(() => fit());
for (const e of [stage, el('ladder'), document.querySelector('.stats')!]) ro.observe(e);

showMode(profile, false);
setSoundLabel(isSoundOn());
start(canvas, stage, profile);
