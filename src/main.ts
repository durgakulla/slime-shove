// Entry point: fonts, styles, button wiring and the resize observer.

import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import './style.css';

import { isSoundOn, toggleSound } from './audio';
import { applyProfile } from './constants';
import { currentProfile, fit, restart, setProfile, start } from './game';
import { setSoundLabel } from './hud';
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

function showMode(p: Profile): void {
  modeBtn.textContent = p.label;
  modeBtn.title = `${p.label} — ${p.blurb}  (tap for ${otherProfile(p).label})`;
  modeBtn.setAttribute('aria-label', `Game mode: ${p.label}. Switch to ${otherProfile(p).label}`);
  // Keep the URL in step so a refresh or a shared link lands in the same mode.
  const url = new URL(location.href);
  url.searchParams.set('mode', p.id);
  history.replaceState(null, '', url);
}

modeBtn.addEventListener('click', () => {
  // Switching starts a fresh game, same as New — the board changes size.
  const next = otherProfile(currentProfile());
  rememberProfile(next);
  setProfile(next);
  showMode(next);
});

el('rst').addEventListener('click', () => restart());
el('again').addEventListener('click', () => restart());
el('snd').addEventListener('click', () => setSoundLabel(toggleSound()));

new ResizeObserver(() => fit()).observe(stage);

showMode(profile);
setSoundLabel(isSoundOn());
start(canvas, stage, profile);
