<div align="center">

<img src="docs/hero.jpg" alt="A recorded product flow composited on a studio backdrop with an automatic camera" width="820">

# programatic-demo

**Product demo videos, generated from code.**
Playwright records a real flow through your app. Remotion adds a Screen
Studio-style camera — zoom on click, easing, motion blur, a vector cursor and a
studio frame. The result is an MP4 you can regenerate every release.

[Quick start](#quick-start) · [Writing a flow](#writing-a-flow) · [How it works](#how-it-works) · [Reference](#reference)

</div>

---

## Why

Screen recordings go stale. Someone re-records them by hand, the mouse wanders,
the zoom is wrong, and six months later the UI has moved on.

Here a demo is **source code**. You describe the beats; the pipeline shoots it:

```ts
export default defineFlow({
  name: "agent-instructions",
  viewport: { width: 1920, height: 1080 },
  startUrl: process.env.DEMO_URL_AGENT_INSTRUCTIONS,
  steps: [
    { pause: 700 },
    { click: "AGENTS.md", cluster: "file", after: 1400 },
    { hoist: "Save" },
    { type: "editor", text: INSTRUCTIONS, cluster: "write", after: 600 },
    { click: "Save", cluster: "save", after: 900 },
  ],
});
```

No selector file, no keyframes, no timeline. The camera work is derived from
where you clicked and when.

<p align="center">
  <img src="docs/preview.gif" alt="The camera punching in, holding, and panning between beats" width="680">
</p>

## Requirements

| | |
| --- | --- |
| Node | 20+ |
| pnpm | 9+ |
| ffmpeg | **system install required** (`brew install ffmpeg`) — see [Sync](#sync-why-the-recorder-flashes-the-screen) |

## Quick start

```bash
pnpm install
pnpm exec playwright install chromium
```

Then prove the whole pipeline offline, with no network and no login:

```bash
pnpm clip:smoke
```

That records a local fixture, converts it, renders it, and writes
`out/smoke.mp4`. If it works, record → convert → render all work.

```bash
pnpm test     # camera / track unit tests
pnpm studio   # open Remotion Studio and scrub the zooms
```

Two more demos run against public sites, no auth:

```bash
pnpm clip:google     # DuckDuckGo HTML (automation-friendly)
pnpm clip:skillsmp   # skillsmp.com search flow
```

## Recording your own app

Copy `.env.example` to `.env` and point it at your app. For a site behind a
login, sign in once — the session is reused for every later shoot:

```bash
pnpm capture:session
```

Then write `flows/<name>.ts` (see below) and shoot it:

```bash
pnpm record:live <name>
pnpm convert <name>
pnpm render <name>
```

Recording is **headless by default**. That is not only about the distraction: a
window that loses focus blurs inputs, pauses animations and flips
`:focus-visible`, so a visible window was a variable in the take. Set `HEADED=1`
to watch a flow fail. `capture:session` is always headed — you cannot type a
password into a window you cannot see.

### Several at once

```bash
pnpm record:batch --all --concurrency 2
pnpm record:batch a b --check      # resolve selectors only, no video
```

`.session-profile/` can only be held by one browser at a time, which is why
shoots used to be serial. The batch does the one step that needs the profile —
proving the session is live and re-exporting `storageState.json` — **serially up
front**, then fans out into isolated contexts that share nothing.

Two things to know before leaning on it:

- **Concurrency is bound by memory, not cores.** Each worker is a whole Chromium
  plus an encoder. 3 is comfortable on 16GB; a past run with 8 started
  OOM-killing renders.
- **Cold contexts are slower than the warm profile.** Anything that waits a fixed
  number of milliseconds for the app to render can fall through. Wait for
  elements (`findByName`), don't probe after a sleep (`softByName`).

Flows that write the same app state must not overlap — declare it with
`mutates`, and flows sharing a key run in one serial lane.

## Writing a flow

A demo is a list of steps. Each entry is one line of the script, with its beat
beside it rather than interleaved between statements.

| Step | Does |
| --- | --- |
| `{ click }` / `{ type, text }` / `{ focus }` / `{ moveTo }` | the matching `ctx` helper |
| `{ pause: ms }` | hold still — the opening establish beat is just this, first |
| `{ hoist: name }` | resolve a name now, reuse it later |
| `{ do: async (ctx) => … }` | escape hatch: conditionals, nav waits, retries |

Any acting step also takes `label`, `cluster`, `zoom`, `frame` and `after` (the
beat that follows it). `defineFlow` compiles the list into the same `run`
function a hand-written flow provides, so `run:` is still available for flows the
list cannot express — `google-search` and `skillsmp-search` use it.

### Naming targets

A flow addresses elements by the name a viewer would read off the screen. There
is no per-demo selector file to write:

```ts
await moveAndClick("AGENTS.md");            // the row whose label reads AGENTS.md
await typeInto("Search", "deepseek v4");    // the field labelled Search
```

`autoCandidates` ([`scripts/lib/selectors.ts`](scripts/lib/selectors.ts)) turns
the name into an ordered ladder — exact accessible-name matches on real controls
first, then label, placeholder, test id, "control containing this text", and bare
text last. Every run logs which rung won, so an app change shows up as the ladder
degrading:

```
✓ AGENTS.md via control containing "AGENTS.md"
✓ Save via role=button name="Save"
```

Two escape hatches, for what a name cannot express:

| Case | Use |
| --- | --- |
| No accessible name at all, or one name matching several things | `targets` on the flow — a map of name → candidates |
| A layout anchor nobody would say out loud | `css("#title")` |

Resolution is inline and normally costs a few ms. It is only expensive when the
element has not rendered yet, because then it blocks — and a block during a still
beat reads as dead air. Hoist those with `{ hoist: name }` during a beat where
something else is already moving. Doing it after a typing beat once turned a
0.7 s breath into a 1.9 s hole.

## How it works

```
 flows/<name>.ts
        │
        ▼
 Playwright  ──►  recordings/<name>.webm   +   public/<name>.clicks.json
   drives the app, glides a synthetic cursor, logs every click with its
   position, bounding rect, departure time and typing end
        │
        ▼
 ffmpeg      ──►  public/<name>.mp4
        │
        ▼
 Remotion    ──►  out/<name>.mp4
   builds a camera track from the click log, composites it over a studio
   backdrop, draws the cursor as vector at output resolution
```

The click log is the interface between the two halves. Nothing about the camera
is authored by hand: cluster ids group clicks into beats, and
[`src/lib/zoom.ts`](src/lib/zoom.ts) turns those into a keyframe track — punch
in, hold, pan or trail out — which [`src/lib/camera.ts`](src/lib/camera.ts)
interpolates with a single measured easing curve.

### Reference rhythm

1. **Establish** ≥ 600 ms at scale 1, static
2. **Lead-in** (distance-aware) as the cursor departs
3. **Hold** ≥ 1.3 s still through the interaction
4. **Trail** (~1.25× the punch) only when the next beat needs space
5. **End** at base scale, always — then cut

### Sync: why the recorder flashes the screen

At the moment the demo clock starts, the recorder paints a full-screen magenta
frame for 160 ms and removes it. That flash is a clapperboard: the first frame
after it is the demo's first frame, so the trim point is *measured* rather than
guessed. It lands in the trimmed head and never reaches the final clip.

It exists because both ends of the recording are invisible to the driver.
Playwright will not say when the screencast actually started (it lags the context
opening) or when it stopped (it keeps capturing into browser teardown), and both
guesses shipped bugs:

| estimate | error | symptom |
| --- | --- | --- |
| `demoStart - recStart` | over-trims by capture-start lag (~0.83 s) | actions happen before their clicks |
| `videoDuration - duration` | over-trims by teardown tail (~0.46 s) | same, but intermittent |

Both put the footage ahead of the click log, so drawers opened before the pointer
arrived. **This needs a system ffmpeg** — Remotion's bundled build has no
`signalstats`. Without it the recorder falls back to the old estimate and prints
a loud warning.

## Layout

| Path | Role |
| --- | --- |
| `flows/` | One file per demo. Only the generic ones are committed — see below |
| `scripts/` | Recorders, converter, renderer, analyzer |
| `scripts/lib/` | Cursor, flow helpers, selector ladder, session, batch |
| `src/lib/click-log.ts` | Shared types + all camera timing constants |
| `src/lib/camera.ts` | Pose interpolator + distance-aware durations |
| `src/lib/zoom.ts` | Keyframe track + region framing |
| `src/DemoClip.tsx` | Studio frame, backdrop, shuttered motion blur |
| `public/backdrop.jpg` | The studio backdrop (a committed design asset) |
| `.agents/skills/` | Agent-readable pipeline docs |

**What is not committed.** `out/`, `recordings/`, `public/*.mp4`,
`public/*.clicks.json` and `tours/*.json` are all regenerated by the pipeline.
Demo flows written against a private workspace are ignored too — they hardcode
one account's URLs, agent names and data-specific selectors, so they would not
run for anyone else. The engine is the open-source part; your demos stay yours.
`flows/smoke.ts`, `flows/google-search.ts` and `flows/skillsmp-search.ts` are
committed because they are deliberately generic.

## Reference

Deeper pipeline notes, including the agent-readable version:
**[`.agents/skills/remotion-demo-pipeline/SKILL.md`](.agents/skills/remotion-demo-pipeline/SKILL.md)**

Most non-obvious constants carry their measurement in a comment beside them —
why the backdrop is a baked image rather than a CSS gradient, why a soft gradient
must not live inside `CameraMotionBlur`, why the output is 2560 and not 4K. If a
number looks arbitrary, the reason is usually one scroll away.

## License

MIT — see [LICENSE](LICENSE).
