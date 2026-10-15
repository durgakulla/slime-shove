// Game state, the canvas rendering pass and the fixed-timestep loop.
// DOM chrome lives in hud.ts; everything here is either state or pixels.

import { ensureAudio, sfx } from './audio';
import {
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
} from './constants';
import { nextCombo } from './combo';
import { hideGameOver, renderLadder, setBest, setScore, showGameOver } from './hud';
import { initInput, type InputHandle } from './input';
import { maybeOfferInstall } from './install';
import { pickTier, step } from './physics';
import { KING_POINTS, MAXT, POINTS, TIERS, body, drawSlime } from './slimes';
import { makeRng, randomSeed, type Rng } from './rng';
import type { GameEvent, State } from './types';

const BEST_KEY = 'slimeShoveBest';
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
interface FloatText {
  x: number;
  y: number;
  txt: string;
  life: number;
  combo: boolean;
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
let best = loadBest();

// ---------- persistence ----------
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(n: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(n));
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
}

function addScore(p: number, x: number, y: number): void {
  S.score += p;
  setScore(S.score);
  if (S.score > best) {
    best = S.score;
    setBest(best);
    saveBest(best);
  }
  // Floating text is centred, so keep it clear of the walls or it clips.
  const clamp = (v: number, pad: number) => Math.max(pad, Math.min(W - pad, v));
  texts.push({ x: clamp(x, 18), y, txt: '+' + p, life: 1, combo: false });
  if (S.combo >= 2) {
    texts.push({ x: clamp(x, 52), y: y - 22, txt: `COMBO ×${S.combo}`, life: 1.2, combo: true });
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
      case 'merge':
        bumpCombo();
        addScore(POINTS[e.tier] * S.combo, e.x, e.y);
        splat(e.x, e.y, TIERS[e.fromTier].c, 10 + e.fromTier * 2, 120 + e.fromTier * 12);
        sfx.merge(e.tier);
        tierChanged = true;
        break;
      case 'king':
        bumpCombo();
        addScore(KING_POINTS * S.combo, e.x, e.y);
        splat(e.x, e.y, TIERS[MAXT].c, 40, 260);
        sfx.king();
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
  ctx.fillRect(0, 0, W, H);

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

function draw(): void {
  drawTable();
  drawAim();

  // near-to-far so bigger slimes in front overlap correctly
  const sorted = [...S.bodies].sort((a, b) => a.y - b.y);
  for (const b of sorted) drawSlime(ctx, time, b.t, b.x, b.y, b);

  if (!S.over) {
    if (S.cool <= 0) {
      drawSlime(ctx, time, S.pending, S.launchX, LAUNCH_Y, {
        seed: 1,
        wob: 0.05,
        ph: time * 6,
        look: [0, -1],
        blink: time % 4 < 0.12 ? 1 : 0,
      });
    }
    // "NEXT" preview
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.roundRect(8, H - 50, 54, 42, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(183,165,216,.9)';
    ctx.font = '600 8px Fredoka, system-ui, sans-serif';
    ctx.fillText('NEXT', 14, H - 39);
    drawSlime(ctx, time, S.next, 44, H - 24, {
      scale: Math.min(1, 13 / TIERS[S.next].r),
      seed: 2,
    });

    if (!input.isAiming() && S.bodies.length < 9 && S.score === 0) {
      ctx.fillStyle = 'rgba(246,238,255,.7)';
      ctx.font = '500 12px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Drag to aim, let go to shove', W / 2, LAUNCH_Y + 38);
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
    if (t.combo) {
      ctx.font = '400 14px "Bagel Fat One", Fredoka, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#1a1030';
      ctx.strokeText(t.txt, t.x, t.y);
      ctx.fillStyle = '#7dffb3';
    } else {
      ctx.font = '400 18px "Bagel Fat One", Fredoka, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#1a1030';
      ctx.strokeText(t.txt, t.x, t.y);
      ctx.fillStyle = '#fff';
    }
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
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
  acc = 0;
  setScore(0);
  hideGameOver();
  renderLadder(S.maxTier);
}

export function start(canvas: HTMLCanvasElement, stageEl: HTMLElement): void {
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
