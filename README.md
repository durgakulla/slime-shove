# Slime Shove

A one-finger merge game for phones. Slide a slime along the launch line, let go,
and it shoots straight up the board. Two slimes of the same size merge into the
next size up with a shockwave that shoves everything nearby, setting off chains.
The game ends when slimes settle past the overflow line.

Top-down and sliding, like shuffleboard — not dropping with gravity. There is no
aim angle and no power meter: where you place the slime is the only decision.

## Playing

Drag anywhere to move the waiting slime left or right, release to shove. The
`?` button in the header explains the rest in game.

**Nine tiers**, from Droplet up to King Goo. Two King Goos annihilate each other
for a large bonus. The ladder at the foot of the screen tracks how far you've got.

**Three powers**, about 3% of spawns, split evenly and shown in the NEXT preview:

| | |
|---|---|
| **Bomb** | Explodes on contact, clearing every slime nearby and banking their points. The way out of a crowded board. |
| **Magnet** | Sticks to the first slime it hits, or to the back wall, drags everything nearby into a clump, then vanishes. A setup tool. |
| **Rainbow** | Merges with whatever it touches, becoming the next size up. For a big slime stuck with no partner. |

**Scoring** rewards placement rather than speed. The nth merge cascading from a
single shove pays ×n, and the chain resets every time you launch — so shoving
again early cuts your own cascade short. A separate streak multiplier builds
while every shove keeps merging something.

**Two modes**, differing only in board height: **Classic** is a long board,
**Rush** is shorter so the overflow line arrives sooner. Each keeps its own best
score, and the choice is remembered.

## Stack

No game engine and no framework. The whole thing is TypeScript and a single
Canvas 2D context.

- **Vite** + **TypeScript** (strict), building to static files
- **Canvas 2D** for everything on the board — slimes are drawn procedurally
  (wobbling blob outlines, gradients, faces), so there are no sprite assets
- **Hand-rolled physics**: circle collisions, friction and impulse resolution on
  a fixed 1/120 s timestep. No physics library
- **WebAudio** for all sound — oscillators and filtered noise, no audio files
- **PWA** via `vite-plugin-pwa` / Workbox: installable, and fully playable
  offline because fonts are self-hosted rather than runtime-cached
- Fonts: Bagel Fat One and Fredoka, bundled through `@fontsource`

Gameplay is deterministic given a seed. Only the spawn sequence draws from the
seeded RNG; cosmetic randomness stays separate, so a run can be reproduced
exactly from its seed.

```
src/
  constants.ts  tuning numbers, all of them
  types.ts      Slime, State, GameEvent
  physics.ts    step(), blasts, merges, overflow — pure, returns events
  slimes.ts     tier data and all procedural drawing
  combo.ts      chain and streak multipliers
  rng.ts        seeded generator
  input.ts      pointer → launch position
  audio.ts      WebAudio synthesis
  hud.ts        score, ladder, game-over overlay
  help.ts       how-to-play sheet
  tuning.ts     game modes
  game.ts       state, rendering, fixed-timestep loop
  main.ts       boot and wiring
```

`physics.ts` never touches the DOM. It mutates bodies and returns a list of
events that `game.ts` turns into score, sound and particles.

## Developing

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | Does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run preview` | serve the built output — use this to test the service worker |
| `npm run icons` | regenerate PWA icons |
| `npm run typecheck` | `tsc --noEmit` |

The service worker only runs in a built app, so test install and offline
behaviour against `npm run preview`, not `npm run dev`.

[DESIGN.md](DESIGN.md) is the full design document: tiers, physics, tuning
values, and the reasoning behind the balance decisions.
`reference/slime-shove-prototype.html` is the original single-file prototype,
kept as the benchmark for game feel.
