// Generates the PWA icons from the same procedural blob the game draws, so the
// home-screen icon is literally a Slime Smash slime rather than a lookalike.
//
//   npm run icons

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const BG = '#1a1030'; // DESIGN.md §7 background
const BASE = '#5ff0a6'; // Squirt green

/** Same colour blend the game uses for tier light/dark/rim values. */
function mix(hex, amt) {
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

/** The game's blobPath(), frozen at one flattering moment of its wobble. */
function blobPath(cx, cy, r, seed = 1.1, time = 0.6) {
  const N = 26;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const rr =
      r *
      (1 +
        0.035 * Math.sin(3 * th + time * 2.2 + seed) +
        0.02 * Math.sin(5 * th - time * 1.7 + seed * 2));
    pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr]);
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[N - 1], pts[0]);
  let d = `M ${m0[0].toFixed(2)} ${m0[1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % N]);
    d += ` Q ${p[0].toFixed(2)} ${p[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`;
  }
  return d + ' Z';
}

/**
 * @param scale fraction of the 512 box the slime occupies. Maskable icons need
 *   all content inside the central 80%, so they pass a smaller scale.
 */
function svg(scale) {
  const S = 512;
  const cx = S / 2,
    cy = S / 2;
  const r = S * 0.46 * scale;
  const er = r * 0.17, // eye radius
    ex = r * 0.33,
    ey = -r * 0.08;
  const look = -r * 0.03; // pupils glance upward, like a waiting slime
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="goo" cx="33%" cy="28%" r="78%">
      <stop offset="0" stop-color="${mix(BASE, 0.55)}"/>
      <stop offset="0.55" stop-color="${BASE}"/>
      <stop offset="1" stop-color="${mix(BASE, -0.38)}"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="${BG}"/>
  <ellipse cx="${cx + r * 0.08}" cy="${cy + r * 0.24}" rx="${r * 1.0}" ry="${r * 0.86}" fill="rgba(8,2,22,.35)"/>
  <path d="${blobPath(cx, cy, r)}" fill="url(#goo)" stroke="${mix(BASE, -0.55)}" stroke-width="${r * 0.06}" stroke-opacity="0.55"/>
  <ellipse cx="${cx - r * 0.38}" cy="${cy - r * 0.44}" rx="${r * 0.26}" ry="${r * 0.14}" fill="rgba(255,255,255,.55)" transform="rotate(-34 ${cx - r * 0.38} ${cy - r * 0.44})"/>
  <circle cx="${cx - r * 0.12}" cy="${cy - r * 0.6}" r="${r * 0.06}" fill="rgba(255,255,255,.55)"/>
  <ellipse cx="${cx - r * 0.55}" cy="${cy + r * 0.18}" rx="${r * 0.14}" ry="${r * 0.085}" fill="rgba(255,105,160,.6)"/>
  <ellipse cx="${cx + r * 0.55}" cy="${cy + r * 0.18}" rx="${r * 0.14}" ry="${r * 0.085}" fill="rgba(255,105,160,.6)"/>
  <circle cx="${cx - ex}" cy="${cy + ey}" r="${er}" fill="#fff"/>
  <circle cx="${cx + ex}" cy="${cy + ey}" r="${er}" fill="#fff"/>
  <circle cx="${cx - ex}" cy="${cy + ey + look}" r="${er * 0.58}" fill="#2a1238"/>
  <circle cx="${cx + ex}" cy="${cy + ey + look}" r="${er * 0.58}" fill="#2a1238"/>
  <circle cx="${cx - ex - er * 0.2}" cy="${cy + ey + look - er * 0.24}" r="${er * 0.2}" fill="#fff"/>
  <circle cx="${cx + ex - er * 0.2}" cy="${cy + ey + look - er * 0.24}" r="${er * 0.2}" fill="#fff"/>
  <path d="M ${cx - r * 0.17} ${cy + r * 0.26} Q ${cx} ${cy + r * 0.44} ${cx + r * 0.17} ${cy + r * 0.26}"
        fill="none" stroke="#2a1238" stroke-width="${r * 0.07}" stroke-linecap="round"/>
</svg>`;
}

const TARGETS = [
  { file: 'icons/icon-192.png', size: 192, scale: 0.92 },
  { file: 'icons/icon-512.png', size: 512, scale: 0.92 },
  // Maskable: content kept inside the central 80% so no face gets cropped.
  { file: 'icons/icon-512-maskable.png', size: 512, scale: 0.66 },
  { file: 'icons/apple-touch-icon.png', size: 180, scale: 0.92 },
  { file: 'icons/favicon.png', size: 64, scale: 0.98 },
];

await mkdir(join(PUBLIC, 'icons'), { recursive: true });
await writeFile(join(PUBLIC, 'icon.svg'), svg(0.92));

for (const t of TARGETS) {
  const out = join(PUBLIC, t.file);
  await sharp(Buffer.from(svg(t.scale)), { density: 384 })
    .resize(t.size, t.size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  ${t.file.padEnd(32)} ${t.size}×${t.size}`);
}
console.log('  icon.svg');
