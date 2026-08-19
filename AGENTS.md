# AGENTS.md

Programmatic product demo videos. Playwright records a real app flow and logs
every click; Remotion turns that log into a camera (zoom on click, easing,
motion blur, vector cursor) over a studio backdrop.

## Demos and reels

Two deliverables, do not confuse them:

- A **demo** is one clip — a recorded flow with camera derived from the click
  log, `out/<name>.mp4`. It shows a task end to end. **Read
  `.agents/skills/shoot-demo-video/SKILL.md` before shooting one.**
- A **reel** is a ~15s launch-film intro: authored title cards that narrate,
  demo clips cut in as proof, a logo sign-off — `out/<name>.reel.mp4`. Cards are
  authored motion (no recording); clips are frame ranges of a demo. **Read
  `.agents/skills/intro-reel/SKILL.md` before making one.**

In short: a demo is footage; a reel is a film built from cards + that footage.

## Commands

```bash
pnpm install && pnpm exec playwright install --with-deps chromium
pnpm clip:smoke      # offline record -> convert -> render; run this first
pnpm test            # unit tests (camera, zoom, selectors, batch)
pnpm lint            # eslint + tsc --noEmit, covers src/ scripts/ flows/
```

Demo pipeline: `pnpm record:live <name>` → `pnpm convert <name>` → `pnpm render <name>`.
Reel: author `reels/<name>.ts` (cards + clip ranges), then `pnpm reel <name>`
(cards render, demo clips are cut in, all concatenated).
Needs **system ffmpeg** (`brew install ffmpeg`); the bundled one lacks
`signalstats` and the recorder silently mis-syncs without it.

## Rules

- **Never hardcode a start URL.** They embed private workspace/project/app ids.
  Read `process.env.DEMO_URL_<NAME>` and document the key in `.env.example`.
- **Never commit pipeline output**: `out/`, `recordings/`, `public/*.mp4`,
  `public/*.clicks.json`, `tours/*.json`. `public/backdrop.jpg` is the one
  committed asset — a design file, not output.
- **Demo flows are gitignored** except `smoke`, `google-search`,
  `skillsmp-search`. The engine is public; account-specific demos are not.
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
| `scripts/` | recorders, convert, render, analyze, reel |
| `scripts/lib/` | cursor, flow DSL, selector ladder, session, batch |
| `src/lib/` | click-log types, camera, zoom track, intro/reel types |
| `src/DemoClip.tsx` | demo composition: backdrop, window, motion blur |
| `src/Intro.tsx` | title-card composition: cards, chip, logo lockup |
| `.agents/skills/` | how-to guides for agents |
