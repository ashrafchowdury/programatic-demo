---
name: remotion-demo-pipeline
description: Record short animated product clips (MP4) — Playwright records a real flow, ffmpeg converts it, Remotion adds auto zoom-on-click. Use when adding or regenerating a demo clip.
metadata:
  tags: remotion, playwright, docs, video
---

# Docs video pipeline

> **Do not drive the app with a browser tool.** Not Claude-in-Chrome, not
> computer-use, not an MCP browser. This pipeline drives its own Playwright
> Chromium; a session you click yourself produces no recording and no click log.
> A request phrased as a click-through is the input to a spec file. Use
> `HEADED=1` to watch a real run.

```
Playwright records the flow  ──►  ffmpeg (Remotion bundled)  ──►  Remotion
  recordings/<name>.webm            public/<name>.mp4              out/demo/<name>.mp4
  public/<name>.clicks.json
```

Zoom is a **pose keyframe track** built from the click log (punch → hold → trail
per **cluster**). The **cursor is drawn by Remotion** from the `cursorTrack` in
the click log, so it stays sharp at any zoom (`DEMO_BAKED_CURSOR=1` falls back to
the legacy in-page cursor for debugging). Camera and cursor share one easing
curve: `cubic-bezier(0.2, 0.2, 0.15, 1)`.

Measure every engine change with `pnpm analyze <name>` — it reports camera glide
duration, frozen-frame runs, motion blur and return-to-base against thresholds
calibrated so real Screen Studio clips pass. Needs a system ffmpeg.

## One-time setup

```bash
cd programatic-demo
pnpm install
pnpm exec playwright install chromium
cp .env.example .env   # APP_BASE_URL only for live-app demos
```

## Reference rhythm (do this for every flow)

| Beat      | Timing                                                   | Purpose                                      |
| --------- | -------------------------------------------------------- | -------------------------------------------- |
| Establish | ≥600ms, scale 1, **static**                              | Full product readable                        |
| Lead-in   | distance-aware ~550–1250ms                               | Camera starts ~35ms before the cursor leaves |
| Hold      | still ≥1.3s after last click of the cluster              | Menu / select / result stay framed           |
| Trail     | ~1.25× the punch-in, only when the next beat needs space | Pull back to base                            |
| End       | exactly 1s after `flow.run()` returns                    | Recorder tail, then cut                      |

**One motion owner:** camera opens as the cursor departs, pointer glides, then
click — they overlap on purpose. Do not wait for the click to start the zoom.

### Explicit clusters

```ts
await moveAndClick(a, "Open", { cluster: "priority" });
await moveAndClick(b, "High", { cluster: "priority" }); // same zoom cycle
await moveAndClick(c, "Far action", { cluster: "done" }); // new lead-in
await moveAndClick(x, "No zoom", { zoom: false }); // use before full page navigations
await moveAndClick(link, "Open card", { cluster: "result", frame: card }); // frame whole card
await focus(card, "Consequence hold", { cluster: "payoff" }); // zoom keyframe, no click
await moveTo(title); // park cursor after nav (keep pointer alive)
```

Different explicit `cluster` ids never sticky-merge. Shared pauses: `BEAT.*` in
`scripts/lib/flow.ts` (CLUSTER_GAP is derived from HOLD_MIN + trail ceiling).
Prefer **flow-local** tighter pacing (`const P = { ... }`) for ad-length clips (~12–16s).

### Demo design rules

1. Prefer **in-page mutations** (menus, filters) over full navigations.
2. Prefer **zero** full page navigations in the kept clip (one continuous scene).
3. After every action that changes the UI: a short **consequence hold**
   (`focus` or readable pause) so the result is sold.
4. Never leave the cursor off-screen after a re-render — `moveTo` a park target.
5. Last click before a page change: `{ zoom: false }` **or** finish CLUSTER_GAP first.
6. Target **12–18s** for hero ads (~1–1.5s intro / dense action / ~1.5s outro).
7. **Camera model:** one transform on the _whole window group_ (chrome + page +
   shadow) in `DemoClip`. Scale + center share one interpolator; CSS origin is
   derived after interpolation.
8. Zoom keyframes from the Playwright click log (`tMs` + `tDepartMs`); region
   framing (not cursor-centred); shuttered motion blur only on fast camera moves.
9. Gate navigations on real paint (`networkidle` / SERP selectors) so reloads
   never show an empty white body.
10. Video records at CSS-viewport resolution. `deviceScaleFactor` never reaches
    Playwright's screencast and a larger `recordVideo.size` just pads the frame
    with grey — both measured; see the note on `DEVICE_SCALE_FACTOR` in
    `src/lib/click-log.ts`. So keep zoom ≤ 1.6×.
11. **Always end at base scale.** All four reference clips do, without exception.
    `END_TAIL_S` (2.5s) exists to leave room for the closing trail plus a beat at
    base — if you shorten it, the camera cannot get home and will cut zoomed in.
12. Camera durations are authored in _output_ time and scaled by `speed` inside
    the track builder. Do not hand-compensate for `DEMO_SPEED`.
13. A flow that MUTATES app state needs a `prepare` hook to undo the last take.
    It runs before the recording clock starts, so the reset is trimmed away.
    Without it the second take opens on the first take's payoff.
14. End the flow where the SCRIPT ends. A trailing `focus` beat costs a glide
    back across the screen plus its own hold — the clip keeps rolling seconds
    after the demo is over and the pointer wanders away from the last action.
    The closing pull-back to base is automatic; the flow does not stage it.
15. `typeInto` records `typeEndMs`, and Remotion fades the arrow out for that
    window so the app's own text caret is the only cursor on screen.
16. Motion blur is ~85% of render time (`samples={8}` renders the tree 8x per
    frame): 60 frames take 70s at 8 samples, 11s at 1. Do NOT drop to 4 — at the
    fastest camera move it renders four separately legible copies instead of a
    smear. Do NOT gate samples per-frame either; changing the count remounts
    `<Video>` and pops mid-move. To iterate, use `remotion still` (3s),
    `--scale=0.5`, or `--frames=A-B` instead of full renders.

## Commands

```bash
# Offline calibration (always first after engine changes)
pnpm clip:smoke
pnpm test          # camera / track unit tests

# Heroes
pnpm clip:google      # web search → first result
pnpm clip:skillsmp    # SkillsMP filter English → open skill (headed / CF)

# Live (authenticated) flows — persistent profile; flow supplies startUrl / ready / prepare
pnpm check:instructions                       # selectors only, no video
pnpm record:instructions && pnpm convert agent-instructions && pnpm render agent-instructions
pnpm record:live <flow-name>                  # any flow with a startUrl

# Intro title card (optional, after the demo has been rendered)
pnpm intro <flow-name>          # render:intro -> stitch -> out/reel/<name>.full.mp4

# Narrative cut: cards interleaved with clip ranges
pnpm reel <flow-name>           # reels/<name>.ts -> out/reel/<name>.mp4

# Generic
pnpm clip <flow-name>
pnpm record <flow-name> && pnpm convert <flow-name> && pnpm render <flow-name>
# Faster playback, same shoot (default 1.25×):
DEMO_SPEED=1.5 pnpm exec tsx scripts/render.ts skillsmp-search
pnpm studio
```

Live app (persistent profile in `.session-profile/`):

```bash
pnpm capture:session       # first run: log in, once
pnpm record:live <name>    # shoot an authenticated flow
pnpm record:live <name> --check   # resolve selectors, no video
pnpm record:batch --all    # several at once
```

Self-tour (no hand-written flow). Click through the UI; the recorder later
replays those selectors with the fake cursor + zoom:

```bash
DEMO_TOUR=capture pnpm record <name>   # you click; Esc or close the window
DEMO_TOUR=replay  pnpm record <name>   # shoot tours/<name>.json
```

Enter is recorded as a press step (search-and-submit works). Prefer clicking
a visible Submit when there is one. Capture is record-only — do not pass
`DEMO_TOUR=capture` to `pnpm clip`. For `pnpm record google-search` capture,
set `DEMO_TOUR_URL` to the site the flow would have opened.

Unset `DEMO_TOUR` keeps the scripted `flows/<name>.ts` path.

## Add a flow

1. `flows/<name>.ts` with `defineFlow` + `BEAT` pauses + `cluster` opts
2. Offline: `pnpm clip <name>`
3. Authenticated app: `pnpm capture:session` once, then `pnpm record:live <name>`
4. Or capture: `DEMO_TOUR=capture pnpm record <name>`, then `DEMO_TOUR=replay`

## Add an intro title card

1. `intros/<name>.ts` with `defineIntro` — copy only, no timings
2. `pnpm intro <name>` after `pnpm clip <name>` has produced `out/demo/<name>.mp4`
3. Card lands in `out/reel/<name>.intro.mp4`, joined file in `out/reel/<name>.full.mp4`

Rules that are load-bearing:

- **Separate composition, never a `<Sequence>` inside `DemoClip`.** `zoomAt` and
  `Cursor` map frame -> time as `(frame/fps)*speed` with t=0 at the first demo
  frame. Prepending frames inside that composition desyncs the camera track and
  the pointer together.
- **No static registry of intros.** `intros/*.ts` are per-account and gitignored
  like `flows/*.ts`, so a static import in `src/Root.tsx` would fail to resolve
  on a clone that lacks them. `scripts/render-intro.ts` imports the file in Node
  and passes the storyboard through `--props`; the cost is that `tsc` never sees
  it, which is why `introProblem()` shape-checks it before a render starts.
- **Geometry must match exactly.** The concat uses `-c copy`, so `compositionSize()`
  in `src/lib/intro.ts` duplicates the size arithmetic from `src/Root.tsx`'s
  DemoClip block on purpose, a test pins it, and `scripts/stitch.ts` re-probes the
  real files and refuses on any mismatch. `--muted` on both renders is part of
  this: a stray AAC track on one side breaks the copy.
- **Intro timing does not scale with `DEMO_SPEED`.** The body is a recording
  replayed faster; the card is authored motion, and copy at 2x is unreadable.
- `pnpm analyze` is now meaningful on a reel or stitched file: cards move
  through their cuts, so the reel passes all six checks rather than tripping the
  dead-air ones. `out/demo/<name>.mp4` is untouched either way.
- Cards must be MOVING at their cut. The reference has motion on both sides of
  8 of its 10 cuts and never lands on a frozen card; an early edit of ours
  managed 2 of 9 and read as slides advancing. But do not overcorrect into
  never resting — the reference is still 34% of the time, and rest is what
  makes the motion legible. `pushAt` encodes both: move in, rest while the copy
  is read, accelerate into the cut.

## Cut a reel

1. `pnpm render <name>` once, then scrub `out/demo/<name>.mp4` for beat boundaries
2. `reels/<name>.ts` with `defineReel` — cards and `{ fromS, toS }` clip ranges
3. `pnpm reel <name>` -> `out/reel/<name>.mp4`

- Clip ranges are SECONDS of the rendered demo; `toS` is exclusive so adjacent
  ranges never share a frame. `reelProblem()` rejects overlapping, backwards or
  past-the-end ranges before anything renders.
- Cut on still beats. The camera holds through each interaction and glides
  between them; a cut mid-glide reads as a mistake.
- Clips are re-rendered via `--frames`, never cut out of the mp4 — no second
  h264 generation on tuned footage. Segments are cached in `.diag/reel/<name>/`
  by a hash of their spec, so editing one card re-renders only that card.
- The reel refuses to run if `out/demo/<name>.mp4` was rendered at a different
  `DEMO_SPEED` than the current run, because the frame ranges would point
  somewhere else.
- Match the card ground to the product: `background: "light"` for a light-theme
  app, `"plain"` for a dark one. This is measured, not taste — light-on-light
  took our mean cut delta from 157 to 42 (reference: 63). Interstitials also
  want a short `holdS` (~0.5s); the 1.2s default reads as a stall.
- A cold open is a short leading clip followed by a card. It is exempt from the
  forward-ordering rule and may replay footage a later clip covers. Choose a
  range that is already moving.
- `drift: 1` on a clip adds a slow push inside long holds. Opt-in by design, so
  `out/demo/<name>.mp4` and everything `analyze` measures are untouched.
- Chip cards: `"Hit {chip}. It'''s live."` + `chip: {label}`. One line only. The
  chip is centred by a `1fr auto 1fr` grid so its centre is known without
  measuring the DOM — a measured origin would vary per worker and per font.
- The chip renders inside CameraMotionBlur, so it uses HARD-EDGED elevation
  only. A blurred box-shadow there bands (see DemoClip.tsx:100-138).
- **Headlines are NORMAL weight by default.** Emphasis is per-word, written
  inline in the `headline` string and parsed by `parseHeadline` (one source of
  truth for stagger, chip split and render, so they cannot disagree):
  - `*word*` bold, `_word_` italic, `==word==` highlight (palette colour)
  - `==word|#ffd54a==` highlight with a custom colour; ink is auto-contrasted
  - `{chip}` the live control (unchanged); marks compose around it
  - A run may span words (`*two words*`); each stays its own stagger unit, so
    the writing rhythm is per-word. An unbalanced marker renders literally.
- Author a card as **JSON or TS** — `render:intro` loads `intros/<name>.json`
  first, else `intros/<name>.ts`. JSON needs no schema beyond the string, since
  the styling lives inside `headline`. `introProblem` validates both (bad hex,
  chip-line length on the VISIBLE text) before a frame renders. Example:
  `{ "name": "x", "headline": "Ship it with *confidence*", "background": "light" }`

## Tuning knobs

| Area                      | File                                                        |
| ------------------------- | ----------------------------------------------------------- |
| Easing / pose / duration  | `src/lib/camera.ts`                                         |
| Track / framing / sticky  | `src/lib/zoom.ts`                                           |
| LEAD / HOLD / DSF / speed | `src/lib/click-log.ts` (`DEMO_SPEED=1.25\|1.5\|2`)          |
| Self-tour capture/replay  | `scripts/lib/tour.ts` (`DEMO_TOUR=capture\|replay`)         |
| Light studio frame + blur | `src/DemoClip.tsx`                                          |
| Cursor drawing / ripple   | `src/Cursor.tsx`, `src/lib/cursor.ts`                       |
| Cursor glide / overshoot  | `scripts/lib/recorder.ts`                                   |
| Output forensics          | `scripts/analyze.ts` (`pnpm analyze <name>`)                |
| Live authed recording     | `scripts/record-live.ts` (`startUrl` / `ready` / `prepare`) |
| Intro copy                | `intros/<name>.ts` (`defineIntro`)                          |
| Intro timing / stagger    | `src/lib/intro.ts`                                          |
| Intro look                | `src/Intro.tsx`                                             |
| Reel structure / cuts     | `reels/<name>.ts` (`defineReel`)                            |
| Pace                      | `pause()` / `BEAT` in the flow                              |
| Drift                     | `offsetMs` in `public/<name>.clicks.json` then re-render    |

## Notes

- ffmpeg comes from Remotion — no system install required.
- Google is recorded **headed** by default (`HEADLESS=1` forces headless).
- Failure dumps: `.diag/` (gitignored); `stitch` writes its concat list there too.
- The bundled ffmpeg is filter-whitelisted: it has `concat` and `scale` but no
  `fade` / `xfade` / `overlay`, so a dissolve at the join would need a system
  ffmpeg or must be rendered inside Remotion.
- Outputs under `out/` stay local until you copy an mp4 into docs static assets.
- Older click logs without `tDepartMs` still render (camera falls back to `tMs − 0.75s`).
