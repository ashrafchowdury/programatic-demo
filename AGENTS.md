# AGENTS.md

Programmatic product demo videos. Playwright records a real app flow and logs
every click; Remotion turns that log into a camera (zoom on click, easing,
motion blur, vector cursor) over a studio backdrop.

## Browser

Demos and stills are driven by Playwright's Chromium, launched by the scripts in
this repo. Use those scripts, not your own browser.

```bash
pnpm exec playwright install --with-deps chromium
pnpm capture:session      # headed; a human signs in, once per host
```

Sessions are stored per host in `.sessions/<host>.json`, so a cloud instance and
a local one keep separate logins.

## Three features. Work out which one you are in before you touch anything.

This repo makes three different things. They share a look — the same backdrop,
the same floating window — which makes them easy to confuse and expensive to
confuse. Each has its own spec file, its own command, and its own output
directory. If you cannot name which one you are in, stop and re-read this table.

| | **demo** | **reel** | **still** |
| --- | --- | --- | --- |
| What it is | one recorded flow, played through | a launch film cut from cards + demo footage | one region of the app, as an image |
| Medium | video | video | PNG |
| You author | `flows/<name>.ts` | `reels/<name>.ts` | `shots/<name>.ts` |
| Command | `pnpm record:live <name>` → `pnpm convert` → `pnpm render` | `pnpm reel <name>` | `pnpm still <name>` |
| Output | `out/demo/<name>.mp4` | `out/reel/<name>.mp4` | `out/still/<name>-<preset>.png` |
| Read first | `.agents/skills/shoot-demo-video/SKILL.md` | `.agents/skills/intro-reel/SKILL.md` | `.agents/skills/shoot-still/SKILL.md` |

In one line each: a **demo** is footage; a **reel** is a film built from cards
plus that footage; a **still** is a photograph of one part of the screen.

Things that follow from this, and are not obvious:

- **A reel depends on a demo.** `pnpm reel <name>` cuts frame ranges out of
  `out/demo/<name>.mp4`, so the demo must be rendered first. A demo never
  depends on a reel.
- **A still depends on neither.** It drives the app itself and never touches
  the video pipeline. Do not look for a click log; there isn't one.
- **The name is shared on purpose.** `out/demo/agent-skill.mp4` and
  `out/reel/agent-skill.mp4` are a demo and the film cut from it. The directory
  is what tells them apart — never the filename.
- **Only a still can be 4K.** Playwright's screencast emits CSS-viewport pixels
  whatever `deviceScaleFactor` says; `page.screenshot()` reads the real
  compositor surface. Do not try to raise video resolution this way — measured
  three times, see `src/lib/click-log.ts`.
- Title cards (`pnpm render:intro`, `pnpm stitch`) are the reel's raw material
  and live in `out/reel/` with it.

Output paths come from `outPath(feature, ...)` in `scripts/lib/out.ts`. Use it
rather than joining `"out"` by hand — the `Feature` union is what stops a script
writing into the wrong feature's territory.

## Commands

```bash
pnpm install && pnpm exec playwright install --with-deps chromium
pnpm clip:smoke      # offline record -> convert -> render; run this first
pnpm test            # unit tests (camera, zoom, selectors, batch)
pnpm lint            # eslint + tsc --noEmit, covers src/ scripts/ flows/
```

Demo: `pnpm record:live <name>` → `pnpm convert <name>` → `pnpm render <name>`.
Reel: author `reels/<name>.ts` (cards + clip ranges), then `pnpm reel <name>`
(cards render, demo clips are cut in, all concatenated).
Still: author `shots/<name>.ts` (steps + the region to keep), then
`pnpm still <name> [preset|--all]`. `pnpm shot <name> --probe` writes a
coordinate grid to `.diag/shots/` for picking a rect by eye.

Needs **system ffmpeg** (`brew install ffmpeg`); the bundled one lacks
`signalstats` and the recorder silently mis-syncs without it.

## Rules

- **Never hardcode a start URL.** They embed private workspace/project/app ids.
  Read `process.env.DEMO_URL_<NAME>` and document the key in `.env.example`.
- **Never commit pipeline output**: `out/` (all three features), `recordings/`,
  `public/*.mp4`, `public/*.clicks.json`, `public/shots/`, `tours/*.json`.
  `public/backdrop.jpg` is the one committed asset — a design file, not output.
- **Demo flows are gitignored** except `smoke`, `google-search`,
  `skillsmp-search`. Same for `intros/`, `reels/` and `shots/`. The engine is
  public; account-specific demos are not.
- **Other agents may be working here.** Do not commit, amend or revert work you
  did not create.

## Changing tuned constants

Most non-obvious numbers carry their measurement in a comment beside them —
camera timings in `src/lib/click-log.ts`, framing in `src/lib/zoom.ts`, easing in
`src/lib/camera.ts`, backdrop and the motion-blur banding rule in
`src/DemoClip.tsx`, renderer flags in `scripts/render.ts`.

**Measure before you change one, and measure the effect after.** This codebase
has shipped several confident, plausible, wrong theories — I/O-bound rendering,
memory-bound resolution scaling, a camera guard that fixed nothing. Each survived
because it sounded right and nobody re-measured. Cheap checks:

```bash
pnpm analyze <name>                        # motion, frozen runs, sharpness
pnpm exec remotion still src/index.ts DemoClip out.png --frame=N \
  --props='{"name":"smoke"}'               # single frame, seconds not minutes
```

Never diff against `git HEAD` to measure a change — the working tree usually
carries uncommitted work, so `HEAD` is not the baseline you think it is.

## Layout

| Path | |
| --- | --- |
| `flows/` | one file per demo (the recorded flow + selectors) |
| `reels/` | one file per reel (cards + clip ranges) |
| `intros/` | single title cards, JSON or TS (`pnpm intro`/`stitch`) |
| `shots/` | one file per still (steps + the region to capture) |
| `scripts/` | recorders, convert, render, analyze, reel, shoot-still |
| `scripts/lib/` | cursor, flow DSL, selector ladder, session, batch, out paths |
| `src/lib/` | click-log types, camera, zoom track, intro/reel types |
| `src/DemoClip.tsx` | demo composition: backdrop, window, motion blur |
| `src/Intro.tsx` | title-card composition: cards, chip, logo lockup |
| `src/StillShot.tsx` | still composition: one captured region, preset canvas |
| `src/WindowFrame.tsx` | the floating window + rim light, shared by both |
| `.agents/skills/` | how-to guides for agents |
