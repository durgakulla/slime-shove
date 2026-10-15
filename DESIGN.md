# Slime Shove — Game Design Document

A casual, one-finger merge game for phones, built as a PWA. The player slides a slime left or right along a launch line at the bottom of a top-down table, lets go, and the slime shoots straight up the table at full speed. Slimes of the same size merge on contact into the next size up, with a small explosion that shoves nearby slimes around and sets up chain reactions. The game ends when slimes pile up back over the overflow line.

Genre reference: "Suika / Watermelon Game"-style merging, but top-down and sliding like shuffleboard or curling, instead of dropping with gravity.

The game ships as a Vite + TypeScript PWA in `src/`. The original single-file prototype is kept at `reference/slime-shove-prototype.html` as the source of truth for **feel and numbers** — the port copies its constants verbatim, and it is the thing to diff against if the game ever stops feeling right.

---

## 1. Core loop

1. A slime waits on the launch line. A smaller "Next" preview shows the slime after it.
2. The player touches anywhere on the table and drags left/right. The waiting slime follows the finger horizontally only (clamped so it stays inside the walls). A dotted guide line shows its straight-up path.
3. On release, the slime launches straight up (velocity `(0, -MAX_V)`). There is no aiming angle and no power control. Position is the only decision.
4. The slime slides, slows from friction, bounces off walls and other slimes.
5. Two slimes of the same tier that touch merge instantly into one slime of the next tier, plus a shockwave.
6. After a 0.45 s cooldown, the next slime appears on the launch line. Repeat.
7. Game over when any slime rests past the overflow line for 2.2 s.

Design intent: simple controls, chaotic but readable physics. Skill comes from picking the lane, banking off the pile, and setting up chains.

---

## 2. World and layout

- Logical world size: **360 × 620** units (portrait). The canvas scales to fit the screen while keeping this aspect ratio; all game logic uses world units.
- View is **top-down**. There is **no gravity**. "Forward" is up the screen (negative y).
- **Walls**: left, right, top, and bottom edges are solid. Slimes bounce off all four.
- **Launch line**: y = `H - 46` (574). The waiting slime sits here.
- **Overflow line**: y = `H - 108` (512). Drawn as a dashed red line labeled "OVERFLOW LINE". The strip below it is shaded darker (the launch zone).
- Faint vertical lane lines on the table (every W/6), above the overflow line only.

---

## 3. Slime tiers

Nine tiers. Radius in world units. Score is awarded when that tier is **created** by a merge.

| Tier | Name        | Radius | Color     | Points on creation |
|-----:|-------------|-------:|-----------|-------------------:|
| 0    | Droplet     | 13     | `#7fe3ff` | –                  |
| 1    | Squirt      | 17     | `#5ff0a6` | 2                  |
| 2    | Blob        | 22     | `#c4ee52` | 6                  |
| 3    | Wobbler     | 27     | `#ffd84a` | 12                 |
| 4    | Glooper     | 33     | `#ff9f45` | 20                 |
| 5    | Big Gloop   | 40     | `#ff6577` | 30                 |
| 6    | Jellyfiend  | 48     | `#ff6cd0` | 42                 |
| 7    | Slime Lord  | 57     | `#a97bff` | 56                 |
| 8    | King Goo    | 67     | `#6d8bff` | 72                 |

- Two **King Goos** merging: both vanish, **+250** points, and a big blast (see §5).
- All merge points are multiplied by the current **combo** (see §5a).
- **Spawn table** for new slimes (only tiers 0–3 ever spawn): 40% Droplet, 30% Squirt, 20% Blob, 10% Wobbler.
- Mass = `r²` (used in collisions and blast response).

---

## 4. Physics

Custom, hand-rolled 2D circle physics (no library). Fixed timestep **1/120 s**, max 8 substeps per frame, frame dt capped at 0.05 s.

Per body, per step:

- **Friction**: exponential damping `v *= exp(-FRICTION * dt)` with `FRICTION = 0.95`, plus a small constant deceleration of `14 units/s²` along the velocity direction so slimes come to a clean stop. Speeds under 2 snap to 0.
- **Integrate**: `x += vx*dt`, `y += vy*dt`.
- **Walls**: clamp the position inside `[r, W-r] × [r, H-r]` and reflect the velocity component with restitution `REST = 0.5`.

Collisions (pairwise, two passes per step):

- If two circles overlap and are the **same tier** → mark both for merge (see §5) and skip resolution.
- Otherwise: separate them along the normal by mass ratio, then apply an impulse with restitution 0.5: `j = -(1+e)·vn / (1/ma + 1/mb)`.
- Each impact adds wobble to both slimes, scaled by impact speed (purely visual).

Launch: `MAX_V = 950` units/s, straight up. With this friction, a shot on an empty table reaches and bounces off the top wall.

---

## 5. Merging and blasts

When two same-tier slimes touch:

- The new slime spawns at their **mass-weighted center**, clamped inside the walls.
- Its velocity = mass-weighted average velocity × 0.45 (so merges don't fling the result away).
- It starts with big wobble, a happy open-mouth face for ~0.7 s, and inherits the "armed" flag (see §6).
- Award points from §3, show floating "+N" text at the merge point, spawn splat particles in the old tier's color, and play the merge sound.
- **Shockwave blast** around the merge point:
  - Radius `R = newSlime.r * 2.4 + 30`; power `230 + newTier * 22`.
  - For every other slime whose edge is within reach (`d < R + b.r`): `falloff = 1 - d/(R + b.r)`, `heft = (400 / b.mass)^0.3`, and the slime gets `dv = power × falloff × heft` added, pointing away from the center. Light slimes fly; heavy ones budge.
  - Blasted slimes also get extra wobble.
  - Visual: an expanding white ring that fades over ~0.3 s.
- King Goo + King Goo: blast radius 220, power 520, 40 particles.

Chain reactions come naturally from blasts and from new slimes touching same-tier neighbors.

### 5a. Combo multiplier

Merges that land close together multiply each other, which is what rewards setting up a chain rather than merging one pair at a time.

- Each merge checks a countdown. If it is still running, the combo steps up by one (capped at **9**); otherwise the combo resets to **1**. Either way the countdown is set back to **1.0 s**.
- Points awarded = tier points (or the King Goo 250) **× the combo**.
- A floating `+N` rises at the merge point, and from ×2 up a green `COMBO ×N` rises above it. Both are clamped away from the walls so they stay readable.
- A four-merge chain of mid tiers is worth about 210 points, against 68 unmultiplied.

---

## 6. Lose condition

- A slime becomes **armed** once it has fully crossed above the overflow line, or once it is 1.3 s old (so weak bounce-backs can't be ignored forever).
- An armed slime is **in danger** when its speed is below 70 and `y + 0.4r > LINE_Y`.
- Each body accumulates danger time while in danger and decays it at 2× speed when not.
- When any body reaches **2.2 s** of danger → game over.
- Warnings: the slime flashes red and its mouth flips to a worried frown; the overflow line pulses brighter.
- Game over overlay: "The tub overflowed", final score, biggest slime reached, and a "Shove again" button.

---

## 7. Visuals and feel

Art direction: a "goo lab" — a deep plum table under glossy, cartoony slimes with faces. Single dark look (not theme-switching).

- Palette: background `#1a1030`, panel `#271944`, text `#f6eeff`, muted `#b7a5d8`, goo accent `#7dffb3`, danger `#ff5d73`, rail `#3b2763`.
- Fonts: **Bagel Fat One** (title, floating score text) and **Fredoka** (UI).
- Table: vertical gradient `#2b1f52 → #1f1640`, a faint green diagonal sheen, a thick rounded rail around the canvas.

Each slime is drawn procedurally on canvas:

- A **blob outline** with 26 points around the circle, where the radius gently oscillates (two sine layers keyed to time and a per-slime seed) and is smoothed with quadratic curves.
- A **radial gradient** fill (light top-left → base → dark edge), a darker rim stroke, and a glossy highlight ellipse plus a small sparkle dot.
- A soft drop shadow offset down-right.
- **Squash and stretch** along the movement direction: stretch up to 20% at high speed (`speed/1600`).
- **Wobble**: a decaying spring (`wob *= exp(-3.5·dt)`, phase += 17·dt) that scales x/y in opposition. Impacts and merges add to it.
- **Face**: two eyes with pupils that look along the velocity (or up when waiting); random blinks every 2–6 s; pink cheeks from tier 1 up; a smile by default, an open "O" mouth after merging, a frown in danger.
- Tiers 7–8 wear a gold **crown**; King Goo's crown has a pink gem.
- Splat particles fade in ~0.7 s; floating "+N" text rises and fades over 1 s.
- Respect `prefers-reduced-motion` (fewer particles).

HUD:

- Header: "Slime Shove" title, Score, Best (persisted in `localStorage` key `slimeShoveBest`), a Sound toggle (off by default), and a New game button.
- Bottom **tier ladder**: all 9 tiers as colored dots sized by radius with names; tiers reached so far light up, and the highest one is slightly enlarged.
- In-canvas: a "NEXT" preview box at the bottom-left, a faint rail along the launch line, and a dotted lane guide above the waiting slime (brighter while dragging). The hint "Drag to aim, let go to shove" shows until the first merge.
- The first load seeds 6 sample slimes on the table so the screen isn't empty; New game starts with an empty table.

---

## 8. Audio

All synthesized with WebAudio oscillators (no files). The audio context starts on the first touch.

- **Shove**: triangle wave 260 → 520 Hz, 0.1 s.
- **Merge**: sine sweep up then a triangle sweep down; pitch drops as tier rises (`620 - tier*48` Hz base).
- **Bump**: a short low thud on impacts faster than 120, throttled to one per 70 ms.
- **Game over**: sawtooth 400 → 90 Hz, 0.6 s.

---

## 9. Tuning constants (current values)

```
W = 360, H = 620
LAUNCH_Y = H - 46, LINE_Y = H - 108
MAX_V = 950            // launch speed, straight up
FRICTION = 0.95        // exponential damping per second
LINEAR_DECEL = 14      // units/s², stops slimes cleanly
REST = 0.5             // restitution for walls and slime-slime hits
COOLDOWN = 0.45 s      // between shots
DANGER_TIME = 2.2 s    // resting past the line before game over
ARM_AGE = 1.3 s
BLAST_RADIUS = r*2.4 + 30, BLAST_POWER = 230 + tier*22
FIXED_DT = 1/120
COMBO_WINDOW = 1.0 s    // merges inside this keep chaining
COMBO_MAX = 9           // multiplier cap
```

These live in `src/constants.ts`.

---

## 10. Build and next steps

**Project setup — done**

Vite + TypeScript, no framework, Canvas 2D. Modules in `src/`:

| File | Holds |
|---|---|
| `constants.ts` | every tuning number from §9 |
| `types.ts` | `Slime`, `State`, `GameEvent` |
| `physics.ts` | `step()`, blast, merge resolution, overflow check |
| `slimes.ts` | `TIERS`, `POINTS`, `body()`, `drawSlime()` |
| `combo.ts` | `nextCombo()` (§5a) |
| `rng.ts` | seeded mulberry32 |
| `input.ts` | pointer → launch position |
| `audio.ts` | WebAudio sfx (§8) |
| `hud.ts` | score, ladder, game-over overlay |
| `install.ts` | add-to-home-screen offer |
| `game.ts` | state, canvas rendering, fixed-timestep loop |
| `main.ts` | boot, fonts, resize |

`physics.ts` is pure: it mutates bodies and returns a `GameEvent[]` that `game.ts` turns into score, sound and particles. It never touches the DOM, which is what keeps a seeded run reproducible.

**Determinism.** Only the spawn sequence (`pickTier`) draws from the seeded RNG; blob seeds, blinks, particle spray and bump pitch stay on `Math.random()` because they cannot affect play. The seed is stored on `State`, so a daily challenge only needs to set it.

**PWA — done**

- Manifest via `vite-plugin-pwa`: standalone, portrait, theme `#1a1030`, 192/512 plus a maskable 512.
- Workbox precaches the whole build, so play is fully offline. Fonts are **self-hosted** (`@fontsource`, latin subsets only) rather than runtime-cached, so the first offline load is already styled.
- Icons are generated by `scripts/icons.mjs` from the game's own `blobPath()` — the home-screen icon is a real Slime Shove slime. Run `npm run icons` after changing it.
- "Add to home screen" is offered once after the first game over: the real prompt where `beforeinstallprompt` fires, an instructional line on iOS, nothing once installed. Dismissal is remembered under `slimeShoveA2HS`.
- Zoom locked, pull-to-refresh and overscroll disabled.

**Gameplay ideas to try (in rough priority)**

1. ~~Chain combo multiplier~~ — shipped, see §5a.
2. Haptics on merge (`navigator.vibrate`) where supported.
3. Daily challenge using a seeded spawn sequence, with a shareable result. `rng.ts` and `State.seed` are already in place for this.
4. Special slimes: sticky (stops dead, glues neighbors), heavy (plows through), bouncy (high restitution), and rainbow (merges with any tier).
5. Table surfaces with different friction (ice / normal / goo).
6. Unlockable slime skins (hats, patterns) bought with points.

**Things to keep**

- One-finger controls: drag horizontally, release to launch at max speed. No aim angle or power meter.
- Original names and art. Don't copy assets or branding from existing merge games.
