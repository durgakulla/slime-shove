// Tier data and the procedural slime renderer (DESIGN.md §3, §7).

import { POWER_R } from './constants';
import type { DrawOpts, PowerKind, Slime, Spawn } from './types';

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

/** Colours for the power slimes, in the same shape as a tier. */
export const POWERS: Record<PowerKind, { c: string; light: string; dark: string; rim: string }> = {
  bomb: { c: '#4a4063', light: mix('#4a4063', 0.45), dark: mix('#4a4063', -0.45), rim: '#17122b' },
  magnet: { c: '#8fb6ff', light: mix('#8fb6ff', 0.5), dark: mix('#8fb6ff', -0.4), rim: '#2b3f73' },
  // Base tones only — the rainbow is actually filled with a shifting gradient
  // across the tier colours, so it reads as "any tier".
  rainbow: { c: '#c9a6ff', light: '#ffffff', dark: '#7a5bbf', rim: '#4a2f7a' },
  fan: { c: '#7fe7ff', light: mix('#7fe7ff', 0.5), dark: mix('#7fe7ff', -0.45), rim: '#1d5466' },
};

/**
 * The colour that represents whatever is queued, used for the aim guide.
 * Powers get their own signature colour rather than their body colour — the
 * bomb's body is near-black and would vanish against the table.
 */
export function spawnColor(s: Spawn, time = 0): string {
  if (!s.power) return TIERS[s.t].c;
  if (s.power === 'bomb') return '#ffd24a'; // its fuse spark
  if (s.power === 'magnet') return '#ff5d73'; // its red arms
  if (s.power === 'fan') return POWERS.fan.c;
  const sweep = [0, 2, 3, 5, 6, 7]; // rainbow cycles the tier palette
  return TIERS[sweep[Math.floor(Math.abs(time) * 2) % sweep.length]].c;
}

/** Radius of whatever is queued — powers are a fixed size, tiers are not. */
export function spawnRadius(s: Spawn): number {
  return s.power ? POWER_R : TIERS[s.t].r;
}

export function body(
  t: number,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  power?: PowerKind,
): Slime {
  const r = power ? POWER_R : TIERS[t].r;
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
    power,
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


/**
 * A horseshoe magnet: red arms, steel tips, opening downward. Drawn as a real
 * object rather than a slime wearing a badge, so it reads instantly as a tool
 * and not as something you could merge.
 */
function drawMagnet(
  ctx: CanvasRenderingContext2D,
  time: number,
  r: number,
  pull?: number,
): void {
  const Ro = r * 0.95, // outer radius of the arc
    arm = r * 0.46, // thickness of each arm
    Ri = Ro - arm,
    L = r * 0.52, // how far the legs drop below centre
    tip = r * 0.3; // steel tip height
  ctx.save();
  ctx.translate(0, r * 0.18); // centre the whole shape on the body origin

  // body outline: down the left arm, over the top, down the right arm, back
  ctx.beginPath();
  ctx.moveTo(-Ro, L);
  ctx.lineTo(-Ro, 0);
  // anticlockwise=false here: in canvas coords (y down) that sweeps PI -> 2PI,
  // which passes over the TOP. Passing `true` arcs under the bottom instead and
  // fills the horseshoe's gap.
  ctx.arc(0, 0, Ro, Math.PI, 0, false);
  ctx.lineTo(Ro, L);
  ctx.lineTo(Ri, L);
  ctx.lineTo(Ri, 0);
  ctx.arc(0, 0, Ri, 0, Math.PI, true);
  ctx.lineTo(-Ri, L);
  ctx.closePath();

  const g = ctx.createLinearGradient(-Ro, -Ro, Ro, L);
  g.addColorStop(0, '#ff8a93');
  g.addColorStop(0.45, '#e8273f');
  g.addColorStop(1, '#8e0f22');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.055);
  ctx.strokeStyle = '#5e0a16';
  ctx.stroke();

  // steel tips at the business end of each leg
  const steel = ctx.createLinearGradient(0, L - tip, 0, L);
  steel.addColorStop(0, '#f2f6ff');
  steel.addColorStop(0.5, '#c3ccdd');
  steel.addColorStop(1, '#8e99ad');
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(sx < 0 ? -Ro : Ri, L - tip, arm, tip);
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.strokeStyle = '#5a6373';
    ctx.lineWidth = Math.max(1.2, r * 0.045);
    ctx.stroke();
  }

  // highlight on the upper-left shoulder, clear of the face
  ctx.beginPath();
  ctx.arc(0, 0, Ro - arm * 0.3, Math.PI * 1.08, Math.PI * 1.3);
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.strokeStyle = 'rgba(255,255,255,.4)';
  ctx.stroke();

  // A little face on the crown of the arc, like every other piece on the board.
  const fy = -(Ro + Ri) / 2, // middle of the band
    er = Math.max(1.5, r * 0.085),
    ex = r * 0.2;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx * ex, fy - er * 0.4, er, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#2a1238';
    ctx.beginPath();
    ctx.arc(sx * ex, fy - er * 0.4, er * 0.6, 0, 7);
    ctx.fill();
  }
  ctx.strokeStyle = '#2a1238';
  ctx.lineWidth = Math.max(1.1, r * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, fy + er * 0.5, er * 0.9, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  ctx.restore();

  // pull rings while it is working
  if (pull) {
    ctx.strokeStyle = `rgba(143,182,255,${(0.55 * pull).toFixed(2)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const k = (time * 1.6 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(0, 0, r + k * r * 2.6, 0, 7);
      ctx.stroke();
    }
  }
}

/**
 * A little desk fan with a face on its hub: round petal blades, a soft
 * pastel housing and a stubby stand. Drawn as a character rather than a
 * machine so it sits with the slimes, but not as a blob, since it never
 * touches or merges with anything. While it blows hard its eyes squeeze shut
 * and its mouth puffs into an "o".
 */
function drawFan(
  ctx: CanvasRenderingContext2D,
  time: number,
  r: number,
  spin = 0.4,
  rot = time * spin * Math.PI * 2,
): void {
  const T = POWERS.fan;
  const R = r * 0.9;
  const lw = Math.max(1.4, r * 0.07);

  // stubby stand and a soft oval foot
  ctx.fillStyle = T.light;
  ctx.strokeStyle = T.rim;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.roundRect(-r * 0.15, R * 0.62, r * 0.3, r * 0.38, r * 0.15);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, R + r * 0.1, r * 0.48, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // housing: a soft glowing disc
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 1.05);
  g.addColorStop(0, '#8fe4f7');
  g.addColorStop(0.6, '#4fbcd9');
  g.addColorStop(1, '#2f8fb0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  // five round petal blades
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate(rot + (i * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(R * 0.5, 0, R * 0.36, R * 0.2, 0.35, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? '#ffffff' : '#d6f7ff';
    ctx.fill();
    ctx.restore();
  }
  // a fast fan blurs into a soft disc rather than strobing
  const blur = Math.min(1, Math.max(0, (spin - 1) / 3));
  if (blur > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(0.45 * blur).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.88, 0, Math.PI * 2);
    ctx.fill();
  }

  // rim
  ctx.strokeStyle = T.rim;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  // little shine on the rim
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.84, Math.PI * 1.1, Math.PI * 1.4);
  ctx.stroke();

  // the face, on a big round hub
  const hr = R * 0.42;
  ctx.fillStyle = '#fff6e9';
  ctx.strokeStyle = T.rim;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const blowing = spin > 2;
  const ex = hr * 0.42,
    ey = -hr * 0.12,
    er = Math.max(1.4, hr * 0.17);
  ctx.strokeStyle = ctx.fillStyle = '#2a1238';
  ctx.lineWidth = Math.max(1.2, hr * 0.12);
  ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (blowing) {
      // squeezed shut: > <
      ctx.moveTo(sx * ex + sx * er * 0.7, ey - er * 0.8);
      ctx.lineTo(sx * ex - sx * er * 0.5, ey);
      ctx.lineTo(sx * ex + sx * er * 0.7, ey + er * 0.8);
      ctx.stroke();
    } else {
      ctx.arc(sx * ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx * ex - er * 0.3, ey - er * 0.35, er * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1238';
    }
  }
  // blush
  ctx.fillStyle = 'rgba(255,110,160,.45)';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * hr * 0.62, hr * 0.28, hr * 0.17, hr * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // mouth: a small smile, or a puffing "o" while it blows
  ctx.strokeStyle = '#2a1238';
  ctx.fillStyle = '#5a1838';
  ctx.lineWidth = Math.max(1, hr * 0.1);
  ctx.beginPath();
  if (blowing) {
    const puff = 1 + 0.15 * Math.sin(time * 14);
    ctx.ellipse(0, hr * 0.38, hr * 0.13 * puff, hr * 0.16 * puff, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.arc(0, hr * 0.2, hr * 0.2, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}

export function drawSlime(
  ctx: CanvasRenderingContext2D,
  time: number,
  t: number,
  x: number,
  y: number,
  o: DrawOpts = {},
): void {
  const T = o.power ? POWERS[o.power] : TIERS[t];
  const r = o.radius !== undefined ? o.radius * (o.scale ?? 1) : TIERS[t].r * (o.scale ?? 1);
  const vx = o.vx || 0,
    vy = o.vy || 0,
    sp = Math.hypot(vx, vy);
  ctx.save();
  ctx.translate(x, y);

  // soft drop shadow, offset down-right
  ctx.fillStyle = 'rgba(8,2,22,.32)';
  ctx.beginPath();
  if (o.power === 'magnet' || o.power === 'fan') {
    // A flat shadow under the magnet. The body-sized blob used for slimes made
    // it read as a round thing wearing a magnet, which is the whole problem.
    ctx.ellipse(0, r * 0.74, r * 0.8, r * 0.18, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(r * 0.1, r * 0.28, r * 1.02, r * 0.86, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // squash & stretch along the direction of travel, then wobble
  const s = Math.min(0.2, sp / 1600),
    ang = o.ang || 0;
  ctx.rotate(ang);
  ctx.scale(1 + s, 1 - s * 0.55);
  ctx.rotate(-ang);
  const w = (o.wob || 0) * Math.sin(o.ph || 0);
  ctx.scale(1 + w, 1 - w);

  if (o.power === 'magnet') {
    drawMagnet(ctx, time, r, o.pull);
    ctx.restore();
    return;
  }
  if (o.power === 'fan') {
    drawFan(ctx, time, r, o.spin, o.rot);
    ctx.restore();
    return;
  }

  blobPath(ctx, time, r, o.seed || 0);
  if (o.power === 'rainbow') {
    // A slowly rotating sweep through the tier palette.
    const ang = time * 0.9 + (o.seed ?? 0);
    const gx = Math.cos(ang) * r,
      gy = Math.sin(ang) * r;
    const g = ctx.createLinearGradient(-gx, -gy, gx, gy);
    const sweep = [0, 2, 3, 5, 6, 7];
    sweep.forEach((tier, i) => g.addColorStop(i / (sweep.length - 1), TIERS[tier].c));
    ctx.fillStyle = g;
    ctx.fill();
    // a soft white core so the face stays readable over the colours
    const core = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
    core.addColorStop(0, 'rgba(255,255,255,.75)');
    core.addColorStop(0.6, 'rgba(255,255,255,.15)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r * 1.08);
    g.addColorStop(0, T.light);
    g.addColorStop(0.55, T.c);
    g.addColorStop(1, T.dark);
    ctx.fillStyle = g;
    ctx.fill();
  }
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
  if (t >= 7 && !o.power) {
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

  // power emblems, so a bomb or magnet reads instantly
  if (o.power === 'bomb') {
    // fuse curling off the top, with a spark that flickers
    ctx.strokeStyle = '#d8cdf0';
    ctx.lineWidth = Math.max(1.6, r * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.12, -r * 0.82);
    ctx.quadraticCurveTo(r * 0.52, -r * 1.06, r * 0.62, -r * 0.72);
    ctx.stroke();
    const flick = 0.7 + 0.3 * Math.sin(time * 22 + (o.seed ?? 0));
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(r * 0.62, -r * 0.72, r * 0.16 * flick, 0, 7);
    ctx.fill();
    ctx.fillStyle = `rgba(255,120,60,${(0.5 * flick).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(r * 0.62, -r * 0.72, r * 0.26 * flick, 0, 7);
    ctx.fill();
  }

  // face — pupils track the direction of travel, or look where told
  const er = Math.max(2.2, r * (o.power ? 0.11 : 0.14)),
    ex = r * (o.power ? 0.27 : 0.33),
    ey = o.power ? r * 0.12 : -r * 0.06;
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
  if (t >= 1 && !o.power) {
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
  // Powers sit their face lower (the bomb's fuse takes the top), so their
  // mouth drops with it and stays below the eyes.
  const my = o.power ? r * 0.44 : r * 0.24,
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
