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

/**
 * One second of white noise, generated once and replayed at different speeds.
 * Rebuilding the buffer per shot allocates tens of thousands of samples each
 * time, which is exactly the kind of churn phone browsers punish.
 */
let noiseBuf: AudioBuffer | null = null;
function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Filtered noise: a lowpass sweeping down reads as a blast, up as a swell. */
function noise(dur: number, vol: number, f0: number, f1: number): void {
  if (!soundOn || !actx) return;
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = getNoise(actx);
  const flt = actx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(actx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  /** Pitch drops as the tier rises, so big merges land heavier. */
  merge(t: number): void {
    const f = 620 - t * 48;
    tone(f * 0.6, f * 1.5, 0.12, 0.22);
    setTimeout(() => tone(f * 1.2, f * 0.7, 0.16, 0.16, 'triangle'), 60);
    // Heavy tiers get a low body under the chime so they land with weight.
    if (t >= 5) tone(150 - t * 6, 60, 0.26, 0.2, 'sine');
  },
  king(): void {
    sfx.merge(MAXT);
    setTimeout(() => tone(90, 50, 0.5, 0.26, 'sawtooth'), 40);
  },
  /** A bright ascending arpeggio with a shimmer tail. */
  rainbow(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      setTimeout(() => {
        tone(f, f * 1.01, 0.2, 0.13, 'triangle');
        tone(f * 2, f * 2.01, 0.14, 0.04, 'sine'); // octave sparkle
      }, i * 52);
    });
    setTimeout(() => noise(0.3, 0.045, 5000, 9000), 170);
  },

  /** A short rising three-note flourish for passing your best. */
  newBest(): void {
    [0, 90, 180].forEach((d, i) => {
      setTimeout(() => tone(520 + i * 180, 700 + i * 220, 0.16, 0.17, 'triangle'), d);
    });
  },
  /** Throttled to one thud per 70 ms so pile-ups don't machine-gun. */
  bump(v: number): void {
    const now = performance.now();
    if (now - lastBump < 70) return;
    lastBump = now;
    tone(180 + Math.random() * 60, 90, 0.07, Math.min(0.09, v / 5000));
  },
  /** Crack, then a filtered blast, over a deep body that drops away. */
  bomb(): void {
    noise(0.1, 0.26, 8000, 2400); // the initial crack
    noise(0.52, 0.34, 3000, 110); // the blast, lowpass slamming shut
    tone(150, 30, 0.6, 0.34, 'sine'); // body you feel more than hear
    setTimeout(() => tone(380, 80, 0.22, 0.1, 'square'), 70); // debris
  },
  /**
   * A clack as it clamps on, then two slightly detuned sines rising together
   * over roughly MAGNET_TIME, so the sound lasts as long as the pull does.
   */
  magnet(): void {
    tone(760, 300, 0.07, 0.16, 'triangle'); // clamps on
    tone(140, 660, 0.95, 0.12, 'sine');
    setTimeout(() => tone(147, 690, 0.9, 0.09, 'sine'), 35); // detune = beating
    noise(0.85, 0.07, 280, 2400); // airy swell underneath
  },
  /**
   * Spins up and blows: a rising hum under an airy swell that lasts roughly
   * FAN_SPIN + FAN_TIME, then a softer tail as it winds down.
   */
  fan(): void {
    tone(70, 150, 1.5, 0.07, 'triangle');
    noise(0.9, 0.12, 400, 1800);
    setTimeout(() => noise(0.95, 0.1, 1800, 300), 650);
  },
  shove(): void {
    tone(260, 520, 0.1, 0.12, 'triangle');
  },
  over(): void {
    tone(400, 90, 0.6, 0.2, 'sawtooth');
  },
};
