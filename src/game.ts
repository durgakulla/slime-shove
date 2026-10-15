// Game state, the canvas rendering pass and the fixed-timestep loop.
// DOM chrome lives in hud.ts; everything here is either state or pixels.

import { ensureAudio, sfx } from './audio';
import {
  applyProfile,
  BUMP_SPEED,
  COMBO_WINDOW,
  COOLDOWN,
  FIXED_DT,
  H,
  LAUNCH_Y,
  LINE_Y,
  MAX_FRAME_DT,
  MAX_SUBSTEPS,
  MAX_V,
  W,
  WARN_RANGE,
} from './constants';
import { nextCombo } from './combo';
import { hideGameOver, renderLadder, setBest, setScore, showGameOver } from './hud';
import { initInput, type InputHandle } from './input';
import { maybeOfferInstall } from './install';
import { pickTier, step } from './physics';
import { KING_POINTS, MAXT, POINTS, TIERS, body, drawSlime } from './slimes';
import { makeRng, randomSeed, type Rng } from './rng';
import { DEFAULT_PROFILE, type Profile } from './tuning';
import type { GameEvent, State } from './types';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
  c: string;
}
type TextStyle = 'score' | 'combo' | 'best';
interface FloatText {
  x: number;
  y: number;
  txt: string;
  life: number;
  style: TextStyle;
}
interface Ring {
  x: number;
  y: number;
  R: number;
  life: number;
}

let cv: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let stage: HTMLElement;
let input: InputHandle;

let S: State;
let rnd: Rng;
let particles: Particle[] = [];
let texts: FloatText[] = [];
let rings: Ring[] = [];
let time = 0;
let lineHot = 0;
let pressure = 0;
/** Screen shake magnitude in world units; decays every frame. */
let shake = 0;
/** Counts down after each combo step so the meter can pop. */
let comboPop = 0;
/** True once this run has passed the stored best, so it only celebrates once. */
let beatBest = false;
/**
 * The best as it stood when this run began. `best` climbs with the live score,
 * so comparing against it would fire the celebration on your own second merge.
 */
let runStartBest = 0;
// Set in start(), once the profile is known. Reading the best score at module
// scope would bind it to the wrong profile's key.
let profile: Profile = DEFAULT_PROFILE;
let best = 0;

// ---------- persistence ----------
function loadBest(): number {
  try {
    return Number(localStorage.getItem(profile.bestKey)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(n: number): void {
  try {
    localStorage.setItem(profile.bestKey, String(n));
  } catch {
    /* private mode — the score just won't persist */
  }
}

// ---------- state ----------
function freshState(demo: boolean, seed = randomSeed()): State {
  rnd = makeRng(seed);
  const s: State = {
    bodies: [],
    score: 0,
    maxTier: 0,
    pending: pickTier(rnd),
    next: pickTier(rnd),
    cool: 0,
    launchX: W / 2,
    over: false,
    combo: 0,
    comboTimer: 0,
    seed,
  };
  if (demo) {
    // The first load shows a few slimes so the table isn't empty (DESIGN.md §7).
    const sample: [number, number, number][] = [
      [3, 110, 150],
      [2, 210, 120],
      [1, 280, 200],
      [4, 175, 250],
      [0, 70, 260],
      [2, 300, 300],
    ];
    for (const [t, x, y] of sample) {
      const b = body(t, x, y);
      b.armed = true;
      b.age = 5;
      s.bodies.push(b);
    }
    s.maxTier = 4;
  }
  return s;
}

// ---------- scoring ----------
function bumpCombo(): void {
  S.combo = nextCombo(S.combo, S.comboTimer);
  S.comboTimer = COMBO_WINDOW;
  if (S.combo >= 2) comboPop = 1;
}

function addScore(p: number, x: number, y: number): void {
  const before = S.score;
  S.score += p;
  setScore(S.score);
  // Celebrate passing the best this run started with, exactly once.
  if (runStartBest > 0 && before <= runStartBest && S.score > runStartBest && !beatBest) {
    beatBest = true;
    texts.push({ x: W / 2, y: LINE_Y - 40, txt: 'NEW BEST!', life: 1.8, style: 'best' });
    sfx.newBest();
    if (!reduced) shake = Math.max(shake, 5);
  }
  if (S.score > best) {
    best = S.score;
    setBest(best);
    saveBest(best);
  }
  // Floating text is centred, so keep it clear of the walls or it clips.
  const clamp = (v: number, pad: number) => Math.max(pad, Math.min(W - pad, v));
  texts.push({ x: clamp(x, 18), y, txt: '+' + p, life: 1, style: 'score' });
  if (S.combo >= 2) {
    texts.push({ x: clamp(x, 52), y: y - 22, txt: `COMBO ×${S.combo}`, life: 1.2, style: 'combo' });
  }
}

function splat(x: number, y: number, c: string, n: number, sp: number): void {
  if (reduced) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283,
      v = sp * (0.3 + Math.random() * 0.7);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 1,
      r: 2 + Math.random() * 4,
      c,
    });
  }
}

/** Turn a step's reported events into score, sound and effects. */
function applyEvents(ev: GameEvent[]): void {
  let tierChanged = false;
  for (const e of ev) {
    switch (e.kind) {
      case 'bump':
        if (e.v > BUMP_SPEED) sfx.bump(e.v);
        break;
      case 'ring':
        rings.push({ x: e.x, y: e.y, R: e.R, life: 1 });
        break;
      case 'merge': {
        bumpCombo();
        addScore(POINTS[e.tier] * S.combo, e.x, e.y);
        // A long chain throws more goo, so a big combo visibly reads as bigger.
        const boost = 1 + Math.min(S.combo, 8) * 0.18;
        splat(
          e.x,
          e.y,
          TIERS[e.fromTier].c,
          Math.round((10 + e.fromTier * 2) * boost),
          120 + e.fromTier * 12,
        );
        sfx.merge(e.tier);
        // Only the heavy tiers shake the table, or it would never sit still.
        if (!reduced && e.tier >= 5) shake = Math.min(9, shake + (e.tier - 4) * 1.4);
        tierChanged = true;
        break;
      }
      case 'king':
        bumpCombo();
        addScore(KING_POINTS * S.combo, e.x, e.y);
        splat(e.x, e.y, TIERS[MAXT].c, 40, 260);
        sfx.king();
        if (!reduced) shake = 11;
        break;
    }
  }
  if (tierChanged) renderLadder(S.maxTier);
}

function gameOver(): void {
  S.over = true;
  sfx.over();
  showGameOver(S.score, S.maxTier);
  maybeOfferInstall();
}

// ---------- input wiring ----------
function aimAt(worldX: number): void {
  const r = TIERS[S.pending].r;
  S.launchX = Math.max(r + 4, Math.min(W - r - 4, worldX));
}

function launch(): void {
  if (S.over || S.cool > 0) return;
  const b = body(S.pending, S.launchX, LAUNCH_Y, 0, -MAX_V);
  b.wob = 0.25;
  S.bodies.push(b);
  S.pending = S.next;
  S.next = pickTier(rnd);
  S.cool = COOLDOWN;
  sfx.shove();
}

// ---------- drawing ----------
function drawTable(): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b1f52');
  g.addColorStop(1, '#1f1640');
  ctx.fillStyle = g;
  // Overfill: screen shake translates the world, and an exact W×H fill would
  // leave a sliver of stale pixels along the trailing edges.
  ctx.fillRect(-14, -14, W + 28, H + 28);

  // lane boards
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let x = W / 6; x < W; x += W / 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LINE_Y);
    ctx.stroke();
  }

  // goo sheen
  const sh = ctx.createLinearGradient(0, 0, W, H * 0.6);
  sh.addColorStop(0, 'rgba(125,255,179,.06)');
  sh.addColorStop(0.5, 'rgba(125,255,179,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, W, LINE_Y);

  // launch zone
  ctx.fillStyle = 'rgba(10,4,26,.35)';
  ctx.fillRect(0, LINE_Y, W, H - LINE_Y);

  // Pressure glow: an amber haze that swells up from the line as the pile
  // creeps toward it. The danger timer only fires in the last moments of a
  // run, so this is what makes the threat legible while there is still time.
  if (pressure > 0.02) {
    const band = WARN_RANGE * pressure;
    const gl = ctx.createLinearGradient(0, LINE_Y - band, 0, LINE_Y);
    gl.addColorStop(0, 'rgba(255,145,80,0)');
    gl.addColorStop(1, `rgba(255,145,80,${(0.1 + 0.26 * pressure).toFixed(3)})`);
    ctx.fillStyle = gl;
    ctx.fillRect(0, LINE_Y - band, W, band);
  }

  // overflow line — pulses brighter as something nears the limit
  const hot = Math.min(1, lineHot);
  ctx.strokeStyle =
    hot > 0.05
      ? `rgba(255,93,115,${0.5 + 0.5 * Math.abs(Math.sin(time * 10))})`
      : 'rgba(255,93,115,.45)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(0, LINE_Y);
  ctx.lineTo(W, LINE_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,93,115,.6)';
  ctx.font = '600 9px Fredoka, system-ui, sans-serif';
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing: string };
  spaced.letterSpacing = '2px';
  ctx.fillText('OVERFLOW LINE', 10, LINE_Y - 7);
  spaced.letterSpacing = '0px';
}

function drawAim(): void {
  if (S.over || S.cool > 0) return;
  const r = TIERS[S.pending].r,
    x = S.launchX;
  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, LAUNCH_Y);
  ctx.lineTo(W - 14, LAUNCH_Y);
  ctx.stroke();

  const aiming = input.isAiming();
  ctx.fillStyle = aiming ? 'rgba(125,255,179,.85)' : 'rgba(125,255,179,.25)';
  for (let y = LAUNCH_Y - r - 10; y > 8; y -= 16) {
    ctx.beginPath();
    ctx.arc(x, y, aiming ? 2.6 : 2, 0, 7);
    ctx.fill();
  }
}

/**
 * Live combo readout, mirroring the NEXT chip on the opposite side. It sits in
 * the launch zone where no slime can cover it, and the bar drains with the
 * window so you can see how long you have to land the next merge.
 */
function drawComboMeter(): void {
  if (S.combo < 2 || S.comboTimer <= 0) return;
  const w = 60,
    h = 26,
    x = W - w - 8,
    y = LINE_Y + 2;
  const pop = 1 + comboPop * 0.12;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(pop, pop);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = 'rgba(125,255,179,.14)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();

  ctx.fillStyle = '#7dffb3';
  ctx.font = '400 15px "Bagel Fat One", Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`×${S.combo}`, w / 2, h / 2 + 2);
  ctx.textAlign = 'left';

  // draining window bar
  const frac = Math.max(0, Math.min(1, S.comboTimer / COMBO_WINDOW));
  ctx.fillStyle = 'rgba(125,255,179,.75)';
  ctx.beginPath();
  ctx.roundRect(7, h - 6, (w - 14) * frac, 3, 1.5);
  ctx.fill();
  ctx.restore();
}

function draw(): void {
  // Screen shake: shift the whole world, then put it back at the end.
  ctx.save();
  if (shake > 0.1) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  drawTable();
  drawAim();

  // near-to-far so bigger slimes in front overlap correctly
  const sorted = [...S.bodies].sort((a, b) => a.y - b.y);
  for (const b of sorted) drawSlime(ctx, time, b.t, b.x, b.y, b);

  if (!S.over) {
    // "NEXT" preview, tucked into the top of the launch zone. The waiting slime
    // can be dragged the full width of the table, so anything sharing its row
    // gets covered; this band sits just below the overflow line and above the
    // largest spawnable slime's reach (LAUNCH_Y - 27), so it always stays clear.
    const ny = LINE_Y + 2;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.roundRect(8, ny, 60, 26, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(183,165,216,.9)';
    ctx.font = '600 8px Fredoka, system-ui, sans-serif';
    ctx.fillText('NEXT', 13, ny + 17);
    drawSlime(ctx, time, S.next, 52, ny + 13, {
      scale: Math.min(1, 9 / TIERS[S.next].r),
      seed: 2,
    });

    if (S.cool <= 0) {
      drawSlime(ctx, time, S.pending, S.launchX, LAUNCH_Y, {
        seed: 1,
        wob: 0.05,
        ph: time * 6,
        look: [0, -1],
        blink: time % 4 < 0.12 ? 1 : 0,
      });
    }

    drawComboMeter();

    if (!input.isAiming() && S.bodies.length < 9 && S.score === 0) {
      ctx.fillStyle = 'rgba(246,238,255,.7)';
      ctx.font = '500 12px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Drag to aim, let go to shove', W / 2, LAUNCH_Y + 38);
      ctx.textAlign = 'left';
    } else if (!beatBest && runStartBest > 0 && S.score >= runStartBest * 0.8) {
      // Only nudge once you are genuinely in range, so it stays meaningful.
      const away = runStartBest - S.score + 1;
      ctx.fillStyle = `rgba(255,216,74,${(0.78 + 0.22 * Math.sin(time * 5)).toFixed(3)})`;
      ctx.font = '600 12px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${away} from your best!`, W / 2, LAUNCH_Y + 38);
      ctx.textAlign = 'left';
    }
  }

  for (const g of rings) {
    const k = 1 - g.life;
    ctx.globalAlpha = g.life * 0.6;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * g.life + 1;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.R * (0.3 + k * 0.9), 0, 7);
    ctx.stroke();
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life + 0.5, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, t.life * 1.5);
    const big = t.style === 'best';
    ctx.font = `400 ${big ? 26 : t.style === 'combo' ? 14 : 18}px "Bagel Fat One", Fredoka, sans-serif`;
    ctx.lineWidth = big ? 6 : 4;
    ctx.strokeStyle = '#1a1030';
    ctx.strokeText(t.txt, t.x, t.y);
    ctx.fillStyle = big ? '#ffd84a' : t.style === 'combo' ? '#7dffb3' : '#fff';
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.restore();
}

// ---------- loop ----------
let acc = 0;
let last = 0;

function frame(now: number): void {
  const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
  last = now;
  time += dt;

  if (!S.over) {
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < MAX_SUBSTEPS) {
      const ev: GameEvent[] = [];
      const res = step(S, FIXED_DT, ev);
      applyEvents(ev);
      lineHot = res.lineHot;
      pressure = res.pressure;
      acc -= FIXED_DT;
      n++;
      if (res.over) {
        gameOver();
        break;
      }
    }
  }

  if (S.cool > 0) S.cool -= dt;
  if (S.comboTimer > 0) {
    S.comboTimer -= dt;
    if (S.comboTimer <= 0) S.combo = 0;
  }
  shake *= Math.exp(-9 * dt);
  comboPop = Math.max(0, comboPop - dt * 5);

  for (const b of S.bodies) {
    b.wob *= Math.exp(-3.5 * dt);
    b.ph += 17 * dt;
    b.joy = Math.max(0, b.joy - dt * 1.3);
    if (Math.hypot(b.vx, b.vy) > 30) b.ang = Math.atan2(b.vy, b.vx);
    b.nextBlink -= dt;
    if (b.nextBlink < 0) {
      b.blink = 0.12;
      b.nextBlink = 2 + Math.random() * 4;
    }
    if (b.blink > 0) b.blink -= dt;
  }
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-4 * dt);
    p.vy *= Math.exp(-4 * dt);
    p.life -= dt * 1.4;
  }
  particles = particles.filter((p) => p.life > 0);
  for (const t of texts) {
    t.y -= 40 * dt;
    t.life -= dt;
  }
  texts = texts.filter((t) => t.life > 0);
  for (const g of rings) g.life -= dt * 3.2;
  rings = rings.filter((g) => g.life > 0);

  draw();
  requestAnimationFrame(frame);
}

// ---------- layout ----------
/** Scale the canvas to fill the stage while keeping the 360×620 aspect. */
export function fit(): void {
  const sw = stage.clientWidth - 10,
    sh = stage.clientHeight - 10;
  const sc = Math.max(0.3, Math.min(sw / W, sh / H));
  const cw = Math.floor(W * sc),
    ch = Math.floor(H * sc),
    dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.style.width = cw + 'px';
  cv.style.height = ch + 'px';
  cv.width = Math.floor(cw * dpr);
  cv.height = Math.floor(ch * dpr);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
}

// ---------- lifecycle ----------
export function restart(): void {
  S = freshState(false);
  particles = [];
  texts = [];
  rings = [];
  lineHot = 0;
  pressure = 0;
  shake = 0;
  comboPop = 0;
  beatBest = false;
  runStartBest = best;
  acc = 0;
  setScore(0);
  hideGameOver();
  renderLadder(S.maxTier);
}

/**
 * Switch game mode. Board height is all that changes, so the live bindings in
 * constants.ts are enough — no reload needed — but the best score belongs to
 * the new mode's own key and the board has to be re-measured.
 */
export function setProfile(p: Profile): void {
  profile = p;
  applyProfile(p);
  best = loadBest();
  setBest(best);
  restart();
  fit();
}

export function currentProfile(): Profile {
  return profile;
}

export function start(canvas: HTMLCanvasElement, stageEl: HTMLElement, p: Profile): void {
  profile = p;
  best = loadBest();
  runStartBest = best;
  cv = canvas;
  stage = stageEl;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas 2d unavailable');
  ctx = c;

  S = freshState(true);
  input = initInput({
    canvas,
    canAim: () => !S.over && S.cool <= 0,
    aimAt,
    launch,
    onFirstTouch: ensureAudio,
  });

  setBest(best);
  setScore(S.score);
  renderLadder(S.maxTier);
  fit();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}
