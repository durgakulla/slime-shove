// The "how to play" sheet. The power icons are painted with the game's own
// drawSlime(), so they can never drift out of sync with what is on the board.

import { POWER_R } from './constants';
import { drawSlime } from './slimes';
import type { PowerKind } from './types';

interface PowerInfo {
  kind: PowerKind;
  name: string;
  text: string;
}

const POWER_INFO: PowerInfo[] = [
  {
    kind: 'bomb',
    name: 'Bomb',
    text: 'Explodes on contact, clearing every slime nearby and banking their points. Your way out of a crowded board.',
  },
  {
    kind: 'magnet',
    name: 'Magnet',
    text: 'Sticks to the first slime it hits, or to the back wall, then drags everything nearby together and vanishes. Once stuck, slimes pass right through it, so pairs meet on top of it and merge.',
  },
  {
    kind: 'rainbow',
    name: 'Rainbow',
    text: 'Merges with whatever it touches, becoming the next size up. Perfect for a big slime with no partner.',
  },
  {
    kind: 'fan',
    name: 'Fan',
    text: 'Hovers just above the overflow line and blows every slime in the two lit lanes back toward the far wall. It never touches anything itself.',
  },
];

const ICON = 54; // css px

function paintIcon(cv: HTMLCanvasElement, kind: PowerKind): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(ICON * dpr);
  cv.height = Math.round(ICON * dpr);
  cv.style.width = `${ICON}px`;
  cv.style.height = `${ICON}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // A fixed time so the rainbow's sweep and the bomb's spark sit at a
  // flattering point rather than wherever the clock happens to be.
  drawSlime(ctx, 0.75, 0, ICON / 2, ICON / 2 + 2, {
    power: kind,
    radius: POWER_R,
    seed: 1.2,
  });
}

let built = false;

function build(): void {
  if (built) return;
  const list = document.getElementById('powerList');
  if (!list) return;
  for (const p of POWER_INFO) {
    const row = document.createElement('div');
    row.className = 'power';
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = p.name;
    const d = document.createElement('p');
    d.textContent = p.text;
    txt.append(b, d);
    row.append(cv, txt);
    list.appendChild(row);
    paintIcon(cv, p.kind);
  }
  built = true;
}

export function isHelpOpen(): boolean {
  const el = document.getElementById('helpPanel');
  return !!el && !el.hidden;
}

export function openHelp(): void {
  const el = document.getElementById('helpPanel');
  if (!el) return;
  build();
  el.hidden = false;
  el.scrollTop = 0;
  // preventScroll matters: the close button sits at the bottom, and a plain
  // focus() scrolls it into view, which pushes the heading off the top.
  (document.getElementById('helpClose') as HTMLElement | null)?.focus({ preventScroll: true });
}

export function closeHelp(): void {
  const el = document.getElementById('helpPanel');
  if (el) el.hidden = true;
}
