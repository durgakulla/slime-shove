// Tier data and the procedural slime renderer (DESIGN.md §3, §7).

import type { DrawOpts } from './types';
import type { Slime } from './types';

export interface Tier {
  n: string;
  r: number;
  c: string;
  light: string;
  dark: string;
  rim: string;
}

interface TierSeed {
  n: string;
  r: number;
  c: string;
}

const TIER_SEEDS: TierSeed[] = [
  { n: 'Droplet', r: 13, c: '#7fe3ff' },
  { n: 'Squirt', r: 17, c: '#5ff0a6' },
  { n: 'Blob', r: 22, c: '#c4ee52' },
  { n: 'Wobbler', r: 27, c: '#ffd84a' },
  { n: 'Glooper', r: 33, c: '#ff9f45' },
  { n: 'Big Gloop', r: 40, c: '#ff6577' },
  { n: 'Jellyfiend', r: 48, c: '#ff6cd0' },
  { n: 'Slime Lord', r: 57, c: '#a97bff' },
  { n: 'King Goo', r: 67, c: '#6d8bff' },
];

/** Blend a hex colour toward white (amt > 0) or black (amt < 0). */
function mix(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255;
  const t = amt > 0 ? 255 : 0,
    a = Math.abs(amt);
  r = Math.round(r + (t - r) * a);
  g = Math.round(g + (t - g) * a);
  b = Math.round(b + (t - b) * a);
  return `rgb(${r},${g},${b})`;
}

export const TIERS: Tier[] = TIER_SEEDS.map((t) => ({
  ...t,
  light: mix(t.c, 0.55),
  dark: mix(t.c, -0.38),
  rim: mix(t.c, -0.55),
}));

export const MAXT = TIERS.length - 1;
export const POINTS = [0, 2, 6, 12, 20, 30, 42, 56, 72];
export const KING_POINTS = 250;

let nextId = 1;

export function body(t: number, x: number, y: number, vx = 0, vy = 0): Slime {
  const r = TIERS[t].r;
  return {
    id: nextId++,
    t,
    x,
    y,
    vx,
    vy,
    r,
    m: r * r,
    age: 0,
    wob: 0,
    ph: 0,
    seed: Math.random() * 6.28,
    blink: 0,
    nextBlink: 1 + Math.random() * 4,
    joy: 0,
    danger: 0,
    armed: false,
    ang: 0,
  };
}

// ---------- drawing ----------

/** A wobbling blob outline: 26 points, radius modulated by two sine layers. */
function blobPath(ctx: CanvasRenderingContext2D, time: number, r: number, seed: number): void {
  const N = 26;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const rr =
      r *
      (1 +
        0.035 * Math.sin(3 * th + time * 2.2 + seed) +
        0.02 * Math.sin(5 * th - time * 1.7 + seed * 2));
    pts.push([Math.cos(th) * rr, Math.sin(th) * rr]);
  }
  ctx.beginPath();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const m0 = mid(pts[N - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < N; i++) {
    const p = pts[i],
      m = mid(p, pts[(i + 1) % N]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

export function drawSlime(
  ctx: CanvasRenderingContext2D,
  time: number,
  t: number,
  x: number,
  y: number,
  o: DrawOpts = {},
): void {
  const T = TIERS[t],
    r = T.r * (o.scale ?? 1);
  const vx = o.vx || 0,
    vy = o.vy || 0,
    sp = Math.hypot(vx, vy);
  ctx.save();
  ctx.translate(x, y);

  // soft drop shadow, offset down-right
  ctx.fillStyle = 'rgba(8,2,22,.32)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, r * 0.28, r * 1.02, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();

  // squash & stretch along the direction of travel, then wobble
  const s = Math.min(0.2, sp / 1600),
    ang = o.ang || 0;
  ctx.rotate(ang);
  ctx.scale(1 + s, 1 - s * 0.55);
  ctx.rotate(-ang);
  const w = (o.wob || 0) * Math.sin(o.ph || 0);
  ctx.scale(1 + w, 1 - w);

  blobPath(ctx, time, r, o.seed || 0);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r * 1.08);
  g.addColorStop(0, T.light);
  g.addColorStop(0.55, T.c);
  g.addColorStop(1, T.dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.strokeStyle = T.rim;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if ((o.danger ?? 0) > 0) {
    ctx.fillStyle = `rgba(255,70,100,${0.25 + 0.25 * Math.sin(time * 16)})`;
    ctx.fill();
  }

  // gloss
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.44, r * 0.26, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.12, -r * 0.6, r * 0.06, 0, Math.PI * 2);
  ctx.fill();

  // crown for the top two tiers; King Goo gets a gem
  if (t >= 7) {
    const cw = r * 0.62,
      cy = -r * 0.82;
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-cw / 2, cy + r * 0.12);
    ctx.lineTo(-cw / 2, cy - r * 0.14);
    ctx.lineTo(-cw / 4, cy - r * 0.02);
    ctx.lineTo(0, cy - r * 0.22);
    ctx.lineTo(cw / 4, cy - r * 0.02);
    ctx.lineTo(cw / 2, cy - r * 0.14);
    ctx.lineTo(cw / 2, cy + r * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (t === MAXT) {
      ctx.fillStyle = '#ff4f7a';
      ctx.beginPath();
      ctx.arc(0, cy + r * 0.01, r * 0.05, 0, 7);
      ctx.fill();
    }
  }

  // face — pupils track the direction of travel, or look where told
  const er = Math.max(2.2, r * 0.14),
    ex = r * 0.33,
    ey = -r * 0.06;
  let lx = 0,
    ly = 0;
  if (sp > 20) {
    lx = (vx / sp) * er * 0.4;
    ly = (vy / sp) * er * 0.4;
  } else if (o.look) {
    lx = o.look[0] * er * 0.4;
    ly = o.look[1] * er * 0.4;
  }
  for (const sx of [-1, 1]) {
    if ((o.blink ?? 0) > 0) {
      ctx.strokeStyle = '#2a1238';
      ctx.lineWidth = Math.max(1.5, er * 0.35);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx * ex - er * 0.8, ey);
      ctx.lineTo(sx * ex + er * 0.8, ey);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx * ex, ey, er, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#2a1238';
      ctx.beginPath();
      ctx.arc(sx * ex + lx, ey + ly, er * 0.58, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx * ex + lx - er * 0.2, ey + ly - er * 0.22, er * 0.2, 0, 7);
      ctx.fill();
    }
  }

  // cheeks from tier 1 up
  if (t >= 1) {
    ctx.fillStyle = 'rgba(255,90,150,.35)';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.55, r * 0.16, r * 0.13, r * 0.08, 0, 0, 7);
      ctx.fill();
    }
  }

  // mouth: open "O" just after merging, frown in danger, otherwise a smile
  ctx.strokeStyle = '#2a1238';
  ctx.fillStyle = '#5a1838';
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.lineCap = 'round';
  const my = r * 0.24,
    mw = r * 0.2;
  if ((o.joy ?? 0) > 0) {
    ctx.beginPath();
    ctx.ellipse(0, my, mw * 0.7, mw * 0.75 * (o.joy as number) + 1, 0, 0, 7);
    ctx.fill();
  } else if ((o.danger ?? 0) > 0) {
    ctx.beginPath();
    ctx.arc(0, my + mw * 0.8, mw * 0.8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, my - mw * 0.4, mw * 0.8, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
  }
  ctx.restore();
}
