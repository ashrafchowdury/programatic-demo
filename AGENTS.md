# AGENTS.md

Programmatic product demo videos. Playwright records a real app flow and logs
every click; Remotion turns that log into a camera (zoom on click, easing,
motion blur, vector cursor) over a studio backdrop.

[CATALOG.md](./CATALOG.md) shows every output the pipeline can make — looks,
presets, knobs, reel styles, backdrops — as pictures with the command under
each. Read it to choose; read the skill to build.

## Browser

Demos and stills are driven by Playwright's Chromium, launched by the scripts in
this repo. Use those scripts for **every** interaction with the app — recording
*and* inspecting element names. Never open the app in any other browser,
including the in-app Browser / preview tools, even just to read the DOM. This ban
covers authoring, not only filming: to discover selectors while writing a flow,
run `pnpm record:live <name> --check`, which resolves them through Playwright
without recording — never a manual DOM peek in another browser.

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
| You author | `flows/<name>.ts` | `reels/<name>.ts`, or a brief `reels/<name>.brief.json` | `shots/<name>.ts` |
| Command | `pnpm record:live <name>` → `pnpm convert` → `pnpm render` | `pnpm reel <name>`; from a brief, `pnpm launch <name>` | `pnpm still <name>` |
| Output | `out/demo/<name>.mp4` | `out/reel/<name>.mp4` | `out/still/<name>-<preset>.png` |
| Read first | `.agents/skills/shoot-demo-video/SKILL.md` | `.agents/skills/agenta-reel/SKILL.md` for Agenta, `.agents/skills/intro-reel/SKILL.md` for any other brand | `.agents/skills/shoot-still/SKILL.md` |

In one line each: a **demo** is footage; a **reel** is a film built from cards
plus that footage; a **still** is a photograph of one part of the screen.

A **social graphic** sits outside the table. It is a designed post image (a
title, a logo pair, a floating card, a chart), written as HTML in
`social/<name>/`. `pnpm exec tsx .agents/skills/social-graphic/render.mts <name>`
renders it to `out/social/<name>/` and audits it against a brand pack. It never
drives the app, though a proof graphic may embed a still's PNG. Two skills:
`.agents/skills/social-graphic/SKILL.md` is brand-neutral (any company, all
thirty-four formats); `.agents/skills/agenta-social-graphic/SKILL.md` is Agenta's
brand pack with a strict audit and only the on-brand formats. Agenta posts use
the second.

Things that follow from this, and are not obvious:

- **A reel depends on a demo.** `pnpm reel <name>` re-renders each clip range
  from the `DemoClip` composition over `public/<name>.mp4` (and its click log);
  it reads `out/demo/<name>.mp4` only for its frame count, and refuses to run
  without it, so the demo must be rendered first. A demo never depends on a
  reel.
- **A still depends on neither.** It drives the app itself and never touches
  the video pipeline. Do not look for a click log; there isn't one.
- **The name is shared on purpose.** `out/demo/agent-skill.mp4` and
  `out/reel/agent-skill.mp4` are a demo and the film cut from it. The directory
  is what tells them apart — never the filename.
- **Only a still RENDERS at 4K; a demo CAPTURES at it.** The screencast emits
  CSS-viewport pixels whatever `deviceScaleFactor` says (measured three times,
  see `src/lib/click-log.ts`), so DSF buys a video nothing. What does work is
  `CAPTURE_SCALE` (default 2): a 2x CSS viewport under a root `zoom`, which the
  CDP recorder films as true 3840x2160 frames — enough that the 2560 render
  never upscales the app, even at the camera's deepest zoom. See
  `scripts/lib/capture-scale.ts` and `scripts/lib/screencast.ts`. The demo and
  reel output stay 2560 (`OUTPUT_WIDTH`); a still's `page.screenshot()` reads
  the compositor surface and renders at 3840. A capture too narrow for the
  deepest zoom is REFUSED before filming; `DEMO_ALLOW_SOFT_CAPTURE=1` (or a
  flow's `captureScale: 1` pin) records it soft. **Agenta automation flows
  need `CAPTURE_SCALE=1` for now** — their popovers land off-screen under the
  root zoom (being fixed). `DEMO_CAPTURE=playwright` is the old 25 fps VP8
  path, for debugging the capture only.
- A lone title card is a one-card reel: `pnpm intro <name>` renders
  `intros/<name>` to `out/reel/<name>.intro.mp4` through the reel pipeline.
  `render:intro` and `stitch` are retired — for card + demo, write a reel.

Output paths come from `outPath(feature, ...)` in `scripts/lib/out.ts`. Use it
rather than joining `"out"` by hand — the `Feature` union is what stops a script
writing into the wrong feature's territory.

## Commands

```bash
pnpm install && pnpm exec playwright install --with-deps chromium
pnpm clip:smoke      # offline record -> convert -> render; run this first
pnpm test            # node:test over src/lib/ and scripts/lib/ — camera, zoom,
                     # cursor, styles, reel/audio, stills, capture, selectors
pnpm lint            # eslint + tsc --noEmit over src/ scripts/ flows/ shots/
```

Demo: `pnpm record:live <name>` → `pnpm convert <name>` → `pnpm render <name>`.
Reel: author `reels/<name>.ts` (a `style`, cards + clip ranges), then
`pnpm reel <name>` (cards render, clip ranges re-render from the demo footage,
all concatenated). Anchor ranges to beats (`fromBeat`/`toBeat` + signed
`leadS`/`tailS`, matched to the click log's labels) rather than hand-typed
seconds, so a re-shoot does not silently shift them. `toEdge: "typeEnd"` ends
the range on a typing beat's last keystroke instead of its press. `--check` resolves beats
and prints every range without rendering — run it first; `--style=<s>` cuts
the same reel in another grammar; `--aspect=9:16|1:1` cuts a click-following
crop. `pnpm render` and `pnpm intro` take `--style=` too.
Brief: a launch reel from a social post with no hand-written flow or reel.
Save the post verbatim to `reels/<name>.post.md`, write `reels/<name>.brief.json`,
then the commands below. The house decides what a brief holds. The default,
`agenta@5`, cuts **one take** in the Agenta brand pack, the app in a window on
a grey ground with the camera zooming inside it, shot in slow motion and
rendered at 60fps, 16:9 only (`agenta@4` lets the window fill the frame on its
zooms; `agenta@3` adds 9:16; `agenta@2` is the same at 30fps in real time): a
title, the footage
(actions from `actions/`, or an already-recorded `demo`), and 1-3 `outro`
lines; the whole interaction plays uncut between them. A `beats` house
(`"house": "agenta@1"`) takes a title, 2-5 beats of card copy plus the action
labels each clip shows, an optional `{chip}` payoff whose pill reads the label's
declared control text (`payoff.text` on a demo brief), and a sign-off. Agenta
reels follow `.agents/skills/agenta-reel/SKILL.md`; any other brand,
`.agents/skills/intro-reel/SKILL.md`.

```bash
pnpm brief --actions [surface]     # what footage can be made of: params, labels
pnpm brief --labels <demo>         # a recorded demo's labels, with times
pnpm brief <name> [--json]         # validate (every problem at once), compile, --check report
pnpm launch <name>                 # validate → compose → check → record → convert →
                                   # render-demo → compile → render-reel → gate;
                                   # out/launch/<name>/status.json; --from <stage> resumes
pnpm actions:check [ids...]        # every action's selectors on its surface, no video
pnpm brief:golden --check|--cut    # golden harness → docs/reel/design/compiler-validation.md
```

The house style (`src/lib/house.ts`, default `agenta@1`: `stage`, 16:9 + 9:16,
music bed + SFX, -14 LUFS) owns every number; a brief sets none. `pnpm reel
<name>` falls back to the brief when there is no `reels/<name>.ts` and renders
each house aspect; `pnpm brief <name> --emit` writes `reels/<name>.ts` to
hand-tune a cut. `pnpm record:live <name>` composes the flow from the brief's
footage when there is no `flows/<name>.ts`.
Still: author `shots/<name>.ts` (steps + the region to keep + a `look`:
`window`, `cutout` or `bleed`), then `pnpm still <name> [preset|--all]`.
`pnpm shot <name> --probe` writes a coordinate grid to `.diag/shots/` for
picking a rect by eye.

Two smoothness settings, both set by a brief's house and both usable by hand.
`DEMO_SLOWMO=<K>` (1-8) shoots the demo K times slower (page animations at 1/K,
every pause and glide K times longer) and compresses the timestamps back, so a
4K capture gets K times the frames per second of footage on a busy machine; see
`resolveSlowmo` in `scripts/lib/footage.ts`. `DEMO_FPS=60` renders at 60fps
(default 30); styles that count motion in 30fps frames (`proof`, `ledger`,
`stage`) refuse it. A demo and the reels cut from it must render at one rate.

Needs **system ffmpeg** (`brew install ffmpeg`) for `pnpm analyze` and
`pnpm reel` — Remotion's bundled one is filter-whitelisted (no `signalstats`,
`xfade`, audio filters). Recording does not strictly need it: the default CDP
capture muxes through the bundled ffmpeg and syncs off the frames' own
timestamps, using the magenta marker (read with system `signalstats`) only as
a cross-check. The `DEMO_CAPTURE=playwright` fallback does need it — without
it that path guesses the trim and warns.

## Rules

- **Never hardcode a start URL.** They embed private workspace/project/app ids.
  Read `process.env.DEMO_URL_<NAME>` and document the key in `.env.example`.
- **Never commit pipeline output**: `out/` (all three features), `recordings/`,
  `public/*.mp4`, `public/*.clicks.json`, `public/shots/`, `tours/*.json`.
  `public/backdrops/` are the committed assets — design files, not output.
- **Demo flows are gitignored** except `smoke`, `google-search`,
  `skillsmp-search`. Same for `intros/`, `reels/` and `shots/`. The engine is
  public; account-specific demos are not.
- **`actions/` and `surfaces/` are committed**, unlike `flows/`: the action
  library is shared and versioned. So they hold no account data: no URL,
  hostname, workspace/project/app id or token. A surface reads its start URL
  from `DEMO_URL_<SURFACE>` (documented in `.env.example`), and
  `scripts/lib/action-hygiene.test.ts` fails on any URL, host or id-shaped
  literal. `flows/` stays gitignored.
- **Other agents may be working here.** Do not commit, amend or revert work you
  did not create.

## Changing tuned constants

Most non-obvious numbers carry their measurement in a comment beside them —
camera timings in `src/lib/click-log.ts`, framing in `src/lib/zoom.ts`, easing in
`src/lib/camera.ts`, the backdrop in `src/Backdrop.tsx` (which ground a render
gets: `resolveGround` in `src/lib/backdrop.ts`), rim light and the motion-blur
banding rule in `src/WindowFrame.tsx`, the shutter in `src/lib/shutter.ts`,
renderer flags in `scripts/lib/remotion.ts`.

**Measure before you change one, and measure the effect after.** This codebase
has shipped several confident, plausible, wrong theories — I/O-bound rendering,
memory-bound resolution scaling, a camera guard that fixed nothing. Each survived
because it sounded right and nobody re-measured. Cheap checks:

```bash
pnpm analyze <name>                        # camera moves, jerk, settle, sharpness
pnpm exec remotion still src/index.ts DemoClip out.png --frame=N \
  --props='{"name":"smoke"}'               # single frame, seconds not minutes
```

`pnpm analyze` has two modes. On a **demo** it block-matches the camera's
per-frame zoom and pan and reports onset jerk (speed on a move's first frames as
a share of its peak), velocity jumps, settle-before-press (camera speed at every
press in the click log), sharpness as mean edge width, and blank share (how much
of a zoomed hold is empty page). On a **reel** (anything under `out/reel/`, or
`--reel`) it first cuts the film at its boundaries, classes each segment card or
footage, measures footage only, and sets the totals against the style's
`targets`. `--json <file>` writes the numbers and `--compare a.json b.json`
prints before → after deltas — use the pair to measure a change. The header
of `scripts/analyze.ts` lists every flag.

Never diff against `git HEAD` to measure a change — the working tree usually
carries uncommitted work, so `HEAD` is not the baseline you think it is.

## Layout

| Path | |
| --- | --- |
| `flows/` | one file per demo (the recorded flow + selectors) |
| `surfaces/` | committed: one file per product surface (start-URL env key, ready check, viewport, backdrop) |
| `actions/` | committed: `actions/<surface>/<id>.ts`, one verified product action each (params, declared labels, verified `prepare`, steps); `pnpm actions:check` probes them |
| `brands/` | committed: one reel brand pack per brand (`brands/<id>/brand.json`: palette, faces, logo SVGs). Licensed font files stay gitignored where the pack's `fontDir` says; `scripts/lib/brand-assets.ts` stages them into gitignored `public/brand/` |
| `reels/` | one file per reel (cards + clip ranges) |
| `intros/` | single title cards, JSON or TS (`pnpm intro`) |
| `shots/` | one file per still (steps + the region to capture) |
| `scripts/` | recorders, convert, render, analyze, reel, shoot-still |
| `scripts/lib/` | cursor, flow DSL, selector ladder, session, batch, out paths, `motion-metrics` (analyze's pure half) |
| `src/lib/` | click-log types, camera, zoom track, `demo-duration`, intro/reel types, `style` (reel choreography styles), `look` (framed / fullbleed) |
| `src/DemoClip.tsx` | demo composition: window, camera, motion blur |
| `src/Backdrop.tsx` · `src/lib/backdrop.ts` | the studio ground every composition draws on; `resolveGround` picks it |
| `src/ShutterBlur.tsx` | the centred-shutter motion blur DemoClip draws through |
| `src/Cursor.tsx` · `src/KeycapHUD.tsx` | the vector pointer; the keycap pill that replaces it in full-bleed footage |
| `src/Intro.tsx` | title-card composition: cards, chip, logo lockup |
| `src/RecapCard.tsx` | the reel's closing recap: lockup + feature list |
| `src/HudOverlay.tsx` · `src/ChipOverlay.tsx` | reel overlays, rendered on transparent and composited over the whole film |
| `src/StillShot.tsx` | still composition: one captured region, preset canvas |
| `src/WindowFrame.tsx` | the floating window + rim light, shared by both |
| `.agents/skills/` | how-to guides for agents |
| `docs/reel/` | reference films taken apart (`<film>/`), reel design records (`design/`) |
