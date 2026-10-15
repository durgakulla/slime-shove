# Slime Shove

A casual, one-finger merge game for phones, built as an installable PWA.

Slide a slime along the launch line, let go, and it shoots straight up the table.
Same sizes merge into the next size up with a blast that shoves everything nearby
around. Merges that land within a second of each other multiply your score. The
game ends when the tub overflows.

Top-down and sliding, like shuffleboard — not dropping with gravity.

**[DESIGN.md](DESIGN.md)** is the design document: tiers, physics, tuning numbers
and what to build next.

## Running it

```bash
npm install
npm run dev        # play at http://localhost:5173
```

| Script | Does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run preview` | serve the built `dist/` — use this to test the service worker |
| `npm run icons` | regenerate PWA icons from `scripts/icons.mjs` |
| `npm run typecheck` | `tsc --noEmit` |

The service worker only runs in a built app, so test install and offline behaviour
against `npm run preview`, not `npm run dev`.

## Game modes

Two modes, switched with the pill in the header. **The only difference is the
height of the board** — same physics, same scoring:

- **Classic** — a long table, roughly 3-4 minutes a run.
- **Rush** — a short table, roughly 2-3 minutes, with the overflow line arriving
  much sooner.

Each keeps its own best score. The choice is remembered and mirrored into
`?mode=`, so a link shares the mode it was played in. Modes live in
`src/tuning.ts`; DESIGN.md §9a has the measurements behind them.

## Layout

```
src/            game modules — see the table in DESIGN.md §10
public/         generated icons
scripts/        icon generation
reference/      the original single-file prototype, kept as the feel reference
```

`reference/slime-shove-prototype.html` opens standalone in a browser with no build
step. It is the benchmark: if the game ever stops feeling right, diff against it.

## Deploying to Vercel

The repo is a stock Vite app, so Vercel detects everything on its own. `vercel.json`
only adds cache headers that keep the service worker and manifest from going stale.

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Vercel should detect **Vite**, `npm run build`, output `dist`. Accept the defaults.
3. Deploy.

### Pointing slimeshove.durgakulla.com at it

1. In the project: **Settings → Domains → Add**, enter `slimeshove.durgakulla.com`.
2. Vercel shows a DNS record to create — a `CNAME` on the host `slimeshove`
   pointing at `cname.vercel-dns.com`.
3. Add that record wherever `durgakulla.com`'s DNS lives. It usually resolves within
   minutes; Vercel issues the HTTPS certificate automatically once it does.

HTTPS matters here: service workers refuse to run on plain HTTP (localhost aside),
so installing and offline play only work once the domain is live over TLS.

### After it is live

Open the site on a phone and confirm:

- it installs to the home screen, opens standalone in portrait, and shows the slime icon
- it still plays with the network off
- pull-to-refresh and double-tap zoom do nothing while dragging
