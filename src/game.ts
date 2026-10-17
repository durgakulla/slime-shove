// Game state, the canvas rendering pass and the fixed-timestep loop.
// DOM chrome lives in hud.ts; everything here is either state or pixels.

import { ensureAudio, sfx } from './audio';
import {
  applyProfile,
  BUMP_SPEED,
  COOLDOWN,
  FAN_HALF,
  FAN_RISE,
  FIXED_DT,
  H,
  LAUNCH_Y,
  LINE_Y,
  MAX_FRAME_DT,
  MAX_SUBSTEPS,
  MAGNET_TIME,
  MAX_V,
  POWER_R,
  W,
  WARN_RANGE,
} from './constants';
import { chainMultiplier, mergeScore, onLaunch, streakMultiplier } from './combo';
import { hideGameOver, renderLadder, setBest, setScore, showGameOver } from './hud';
import { initInput, type InputHandle } from './input';
import { maybeOfferInstall } from './install';
import { fanStrength, pickSpawn, step } from './physics';
import {
  KING_POINTS,
  MAXT,
  POINTS,
  POWERS,
  TIERS,
  body,
  drawSlime,
  spawnColor,
  spawnRadius,
} from './slimes';
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
/** Set while the help sheet is open, so you cannot lose while reading it. */
let paused = false;
/** Screen shake magnitude in world units; decays every frame. */
let shake = 0;
/** 1 -> 0 after a power arrives on the line; drives the one-shot wave. */
let powerFlash = 0;
/** Whether a power was on the line last frame, so the wave fires only once. */
let powerOnLine = false;
/** Blade angle of the fan in play, accumulated each frame from its speed. */
let fanRot = 0;
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
function freshState(seed = randomSeed()): State {
  rnd = makeRng(seed);
  const s: State = {
    bodies: [],
    score: 0,
    maxTier: 0,
    pending: pickSpawn(rnd),
    next: pickSpawn(rnd),
    cool: 0,
    launchX: W / 2,
    over: false,
    chain: 0,
    streak: 0,
    seed,
    run: { merges: 0, bestChain: 0, bestStreak: 0, shoves: 0 },
  };
  return s;
}

// ---------- scoring ----------
/** One more merge in the current shove. */
function bumpChain(): void {
  S.chain++;
  S.run.merges++;
  S.run.bestChain = Math.max(S.run.bestChain, S.chain);
  if (S.chain >= 2) comboPop = 1;
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
  if (S.chain >= 2) {
    texts.push({ x: clamp(x, 52), y: y - 22, txt: `CHAIN ×${S.chain}`, life: 1.2, style: 'combo' });
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
        bumpChain();
        addScore(mergeScore(POINTS[e.tier], S.chain, S.streak), e.x, e.y);
        // A long chain throws more goo, so a big combo visibly reads as bigger.
        const boost = 1 + Math.min(S.chain, 8) * 0.18;
        splat(
          e.x,
          e.y,
          TIERS[e.fromTier].c,
          Math.round((10 + e.fromTier * 2) * boost),
          120 + e.fromTier * 12,
        );
        if (e.rainbow) sfx.rainbow();
        else sfx.merge(e.tier);
        // Only the heavy tiers shake the table, or it would never sit still.
        if (!reduced && e.tier >= 5) shake = Math.min(9, shake + (e.tier - 4) * 1.4);
        tierChanged = true;
        break;
      }
      case 'bomb': {
        // Points without a combo multiplier — this is a relief valve, not a chain.
        if (e.points > 0) addScore(e.points, e.x, e.y);
        for (const tier of e.colors) splat(e.x, e.y, TIERS[+tier].c, 8, 200);
        splat(e.x, e.y, '#ffd24a', 26, 300);
        rings.push({ x: e.x, y: e.y, R: e.R, life: 1 });
        sfx.bomb();
        if (!reduced) shake = 12;
        tierChanged = true;
        break;
      }
      case 'magnetOn':
        sfx.magnet();
        rings.push({ x: e.x, y: e.y, R: e.R, life: 1 });
        break;
      case 'magnetOff':
        splat(e.x, e.y, POWERS.magnet.c, 14, 150);
        break;
      case 'fanOn':
        sfx.fan();
        break;
      case 'fanOff':
        splat(e.x, e.y, POWERS.fan.c, 12, 120);
        break;
      case 'king':
        bumpChain();
        addScore(mergeScore(KING_POINTS, S.chain, S.streak), e.x, e.y);
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
  // The last shove's merges only reach the streak on the next launch, which
  // never comes, so count it here.
  const streak = S.chain > 0 ? S.streak + 1 : S.streak;
  S.run.bestStreak = Math.max(S.run.bestStreak, streak);
  showGameOver(S.score, S.run, beatBest, runStartBest, profile.label);
  maybeOfferInstall();
}

// ---------- input wiring ----------
function aimAt(worldX: number): void {
  // A fan aims its whole two-lane band, so that is what has to stay on the board.
  const r = S.pending.power === 'fan' ? FAN_HALF : spawnRadius(S.pending) + 4;
  S.launchX = Math.max(r, Math.min(W - r, worldX));
}

function launch(): void {
  if (S.over || S.cool > 0) return;
  // Score the shove that just finished, then start a fresh chain.
  onLaunch(S);
  S.run.shoves++;
  S.run.bestStreak = Math.max(S.run.bestStreak, S.streak);
  if (S.pending.power === 'fan') {
    // Not a body: physics flies it up to its hover point and runs the wind.
    S.fan = { x: S.launchX, y: LAUNCH_Y, age: 0, on: false };
  } else {
    const b = body(S.pending.t, S.launchX, LAUNCH_Y, 0, -MAX_V, S.pending.power);
    b.wob = 0.25;
    S.bodies.push(b);
  }
  S.pending = S.next;
  S.next = pickSpawn(rnd);
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
  const r = spawnRadius(S.pending),
    x = S.launchX;
  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, LAUNCH_Y);
  ctx.lineTo(W - 14, LAUNCH_Y);
  ctx.stroke();

  // The guide takes the colour of whatever is on the line, so you can see what
  // you are about to shove without looking away from where it will land. A
  // power also makes it glow, so the whole lane signals what you are holding.
  const aiming = input.isAiming();
  const colour = spawnColor(S.pending, time);
  const power = !!S.pending.power;
  if (S.pending.power === 'fan') {
    // The fan aims a two-lane band rather than a line: light up what it will blow.
    drawWindBand(x, aiming ? 1 : 0.5, aiming);
    return;
  }
  const dots = (radius: number): void => {
    for (let y = LAUNCH_Y - r - 10; y > 8; y -= 16) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 7);
      ctx.fill();
    }
  };
  ctx.save();
  if (power) {
    // Bloom pass, drawn additively under the dots. Two flat passes rather than
    // shadowBlur or a gradient per dot: there are ~28 dots every frame and
    // this stays cheap on a phone.
    const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(time * 4.5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colour;
    // Three widening passes rather than two: with only two, the alpha step is
    // visible as a hard ring around each dot instead of a falloff.
    const base = aiming ? 1 : 0.55;
    for (const [radius, alpha] of [
      [8.5, 0.1],
      [5.6, 0.13],
      [3.6, 0.17],
    ] as const) {
      ctx.globalAlpha = alpha * base * pulse;
      dots(radius * pulse);
    }
  }
  ctx.globalCompositeOperation = power ? 'lighter' : 'source-over';
  ctx.globalAlpha = aiming ? 0.9 : 0.34;
  ctx.fillStyle = colour;
  dots(power ? (aiming ? 3 : 2.4) : aiming ? 2.6 : 2);
  ctx.restore();
}

/** Turns per second for the fan in play: idling while it rises, then full speed with the wind. */
function fanSpin(): number {
  return S.fan ? 0.4 + 5.5 * fanStrength(S.fan.age - FAN_RISE) : 0;
}

/**
 * The two lanes a fan blows up: a cyan wash between waving edges, with
 * rippling wisps of breeze drifting toward the far wall. Every line is a sine
 * wave travelling upward. `k` is 0..1 strength;
 * `edges` adds the borders, shown while aiming.
 */
function drawWindBand(cx: number, k: number, edges: boolean): void {
  const x0 = cx - FAN_HALF,
    x1 = cx + FAN_HALF;
  const t = reduced ? 0 : time;
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, LINE_Y);
  g.addColorStop(0, `rgba(127,231,255,${(0.16 * k).toFixed(3)})`);
  g.addColorStop(1, `rgba(127,231,255,${(0.05 * k).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, LINE_Y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (edges) {
    // Waving borders, kept just inside the band so they never wobble outside
    // what the fan blows. The wave travels upward, like the wisps.
    ctx.strokeStyle = `rgba(127,231,255,${(0.45 * k).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    for (const [ex, dir] of [
      [x0, 1],
      [x1, -1],
    ] as const) {
      ctx.beginPath();
      for (let y = LINE_Y; y >= 0; y -= 6) {
        const x = ex + dir * (3 + 3 * Math.sin(y * 0.06 + t * 7));
        if (y === LINE_Y) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Wisps: short sine-wave strands drifting toward the far wall, with the wave
  // itself travelling up each strand so the breeze ripples as it goes.
  const gap = 84,
    len = 54,
    amp = 5,
    off = (t * 75) % gap;
  const lanes = [-0.55, 0.05, 0.6];
  ctx.lineWidth = 2;
  lanes.forEach((lx, i) => {
    const stagger = (i * gap) / lanes.length;
    const ph = i * 2.1 - t * 7;
    for (let y0 = LINE_Y - 10 - ((off + stagger) % gap); y0 > len + 8; y0 -= gap) {
      // fade in near the fan and out near the far wall
      const fade = Math.min(1, (LINE_Y - y0) / 60, (y0 - len) / 80);
      if (fade <= 0) continue;
      ctx.strokeStyle = `rgba(220,248,255,${(0.45 * k * fade).toFixed(3)})`;
      const bx = cx + lx * FAN_HALF;
      ctx.beginPath();
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const x = bx + amp * Math.sin(s * Math.PI * 2.5 + ph),
          y = y0 - s * len;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  ctx.restore();
}

/**
 * Chain and streak readout, mirroring the NEXT chip on the opposite side. It
 * sits in the launch zone where no slime can cover it. There is no timer bar
 * any more: the chain holds until your next shove, it does not tick away.
 */
function drawComboMeter(): void {
  const showChain = S.chain >= 2;
  const showStreak = S.streak >= 2;
  if (!showChain && !showStreak) return;
  const w = 64,
    h = 26,
    x = W - w - 8,
    y = LINE_Y + 2;
  const pop = 1 + comboPop * 0.12;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(pop, pop);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = showChain ? 'rgba(125,255,179,.16)' : 'rgba(255,255,255,.08)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 8);
  ctx.fill();

  ctx.textAlign = 'center';
  if (showChain) {
    ctx.fillStyle = '#7dffb3';
    ctx.font = '400 14px "Bagel Fat One", Fredoka, sans-serif';
    ctx.fillText(`×${chainMultiplier(S.chain)}`, w / 2, showStreak ? h / 2 : h / 2 + 2);
  }
  if (showStreak) {
    // The streak multiplier is the quieter, longer-running of the two.
    ctx.fillStyle = 'rgba(255,216,74,.9)';
    ctx.font = `600 ${showChain ? 7 : 9}px Fredoka, system-ui, sans-serif`;
    const label = `STREAK ${S.streak} · ×${streakMultiplier(S.streak).toFixed(2)}`;
    ctx.fillText(label, w / 2, showChain ? h - 5 : h / 2 + 3);
  }
  ctx.textAlign = 'left';
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

  // A blowing fan keeps its lanes lit, under the slimes it is pushing.
  const fanK = S.fan ? fanStrength(S.fan.age - FAN_RISE) : 0;
  if (S.fan && fanK > 0) drawWindBand(S.fan.x, fanK, false);

  // near-to-far so bigger slimes in front overlap correctly
  const sorted = [...S.bodies].sort((a, b) => a.y - b.y);
  for (const b of sorted) {
    // A stuck magnet is intangible, so it is drawn see-through: slimes passing
    // over it should read as intended, not as a collision bug.
    const ghost = b.power === 'magnet' && b.fuse !== undefined;
    if (ghost) ctx.globalAlpha = 0.55;
    drawSlime(ctx, time, b.t, b.x, b.y, {
      ...b,
      radius: b.power ? POWER_R : undefined,
      pull: b.fuse !== undefined ? Math.max(0, b.fuse / MAGNET_TIME) : undefined,
    });
    if (ghost) ctx.globalAlpha = 1;
  }
  // The fan hovers over the slimes, never among them.
  if (S.fan) {
    drawSlime(ctx, time, 0, S.fan.x, S.fan.y, {
      power: 'fan',
      radius: POWER_R,
      spin: fanSpin(),
      rot: fanRot,
    });
  }

  if (!S.over) {
    // "NEXT" preview, tucked into the top of the launch zone. The waiting slime
    // can be dragged the full width of the table, so anything sharing its row
    // gets covered; this band sits just below the overflow line and above the
    // largest spawnable slime's reach (LAUNCH_Y - 27), so it always stays clear.
    // Sits clear of the overflow line above and the waiting slime's reach
    // below; the band between them is only ~34 units tall, so the chip is
    // shortened rather than simply nudged down.
    const ny = LINE_Y + 6;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.roundRect(8, ny, 60, 24, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(183,165,216,.9)';
    ctx.font = '600 8px Fredoka, system-ui, sans-serif';
    ctx.fillText('NEXT', 13, ny + 16);
    drawSlime(ctx, time, S.next.t, 52, ny + 12, {
      scale: Math.min(1, 9 / spawnRadius(S.next)),
      seed: 2,
      power: S.next.power,
      radius: spawnRadius(S.next),
    });

    if (S.cool <= 0) {
      // A power waiting on the line glows, so during fast play it is obvious
      // you are holding something special before you let go of it.
      if (S.pending.power) {
        const pr = spawnRadius(S.pending);
        const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(time * 5);
        const halo = ctx.createRadialGradient(
          S.launchX,
          LAUNCH_Y,
          pr * 0.55,
          S.launchX,
          LAUNCH_Y,
          pr * 2.5 * pulse,
        );
        halo.addColorStop(0, 'rgba(255,255,255,.34)');
        halo.addColorStop(0.45, 'rgba(210,235,255,.12)');
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        // Additive, so it reads as light rather than a grey disc: plain white
        // at low alpha over this dark table just looks like fog.
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(S.launchX, LAUNCH_Y, pr * 2.5 * pulse, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      drawSlime(ctx, time, S.pending.t, S.launchX, LAUNCH_Y, {
        seed: 1,
        wob: 0.05,
        ph: time * 6,
        look: [0, -1],
        blink: time % 4 < 0.12 ? 1 : 0,
        power: S.pending.power,
        radius: spawnRadius(S.pending),
      });
    }

    drawComboMeter();

    // Only until the first shove of a game: an empty, unscored table means none yet.
    if (!input.isAiming() && S.bodies.length === 0 && S.score === 0) {
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

  // One-shot wave when a power loads: a broad ring of light sweeping out from
  // the launch line across the whole board, so it is impossible to miss.
  if (powerFlash > 0) {
    const k = 1 - powerFlash; // 0 -> 1 as it travels
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = 30 + k * H * 1.25;
    const wave = ctx.createRadialGradient(
      S.launchX,
      LAUNCH_Y,
      Math.max(0, R - H * 0.42),
      S.launchX,
      LAUNCH_Y,
      R,
    );
    wave.addColorStop(0, 'rgba(255,255,255,0)');
    wave.addColorStop(0.72, `rgba(236,246,255,${(0.3 * powerFlash).toFixed(3)})`);
    wave.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wave;
    ctx.fillRect(0, 0, W, H);
    // a brief wash over everything at the very start of the burst
    ctx.fillStyle = `rgba(255,255,255,${(0.1 * powerFlash * powerFlash).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

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

  if (!S.over && !paused) {
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
  // A power appearing on the launch line sets off a single wave over the board.
  const onLine = !S.over && S.cool <= 0 && !!S.pending.power;
  if (onLine && !powerOnLine) powerFlash = 1;
  powerOnLine = onLine;
  if (powerFlash > 0) powerFlash = Math.max(0, powerFlash - dt * 1.15);

  if (S.fan) fanRot += fanSpin() * dt * Math.PI * 2;
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
/** Scale the canvas to fill the stage while keeping the 360×620 aspect,
 *  leaving room for the ladder and score stacked beneath it. */
export function fit(): void {
  const wrap = cv.parentElement;
  const gap = parseFloat(getComputedStyle(stage).rowGap) || 0;
  let below = 0;
  for (const c of stage.children) {
    if (c !== wrap) below += (c as HTMLElement).offsetHeight + gap;
  }
  const sw = stage.clientWidth - 10,
    sh = stage.clientHeight - 10 - below;
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
  S = freshState();
  particles = [];
  texts = [];
  rings = [];
  lineHot = 0;
  pressure = 0;
  shake = 0;
  powerFlash = 0;
  powerOnLine = false;
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

export function setPaused(p: boolean): void {
  paused = p;
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

  S = freshState();
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
