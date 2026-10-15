// All sound is synthesized with WebAudio oscillators — no files (DESIGN.md §8).
// The context is created lazily on the first touch, since browsers refuse to
// start one without a gesture.

import { MAXT } from './slimes';

let actx: AudioContext | null = null;
let soundOn = false;
let lastBump = 0;

type AudioCtor = typeof AudioContext;

export function ensureAudio(): void {
  if (!actx) {
    try {
      const Ctor: AudioCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
      actx = new Ctor();
    } catch {
      /* no audio available; the game plays fine silently */
    }
  }
  if (actx && actx.state === 'suspended') void actx.resume();
}

export function isSoundOn(): boolean {
  return soundOn;
}

/** Returns the new state, so the caller can update its button label. */
export function toggleSound(): boolean {
  ensureAudio();
  soundOn = !soundOn;
  if (soundOn) tone(400, 800, 0.1, 0.12);
  return soundOn;
}

export function tone(
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  type: OscillatorType = 'sine',
): void {
  if (!soundOn || !actx) return;
  const t = actx.currentTime,
    o = actx.createOscillator(),
    g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  /** Pitch drops as the tier rises, so big merges land heavier. */
  merge(t: number): void {
    const f = 620 - t * 48;
    tone(f * 0.6, f * 1.5, 0.12, 0.22);
    setTimeout(() => tone(f * 1.2, f * 0.7, 0.16, 0.16, 'triangle'), 60);
  },
  king(): void {
    sfx.merge(MAXT);
  },
  /** Throttled to one thud per 70 ms so pile-ups don't machine-gun. */
  bump(v: number): void {
    const now = performance.now();
    if (now - lastBump < 70) return;
    lastBump = now;
    tone(180 + Math.random() * 60, 90, 0.07, Math.min(0.09, v / 5000));
  },
  shove(): void {
    tone(260, 520, 0.1, 0.12, 'triangle');
  },
  over(): void {
    tone(400, 90, 0.6, 0.2, 'sawtooth');
  },
};
