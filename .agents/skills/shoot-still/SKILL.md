---
name: shoot-still
description: Capture one region of a running app as a 4K image, framed on the demo backdrop, sized for social. Use when asked for a screenshot, a still, a hero image, an OG/link-card image, or a shareable picture of part of the UI.
metadata:
  tags: remotion, playwright, screenshot, still, image, social
---

# Shoot a still

**This is one of three features. A still is a PNG of one part of the screen. If
you actually want video, stop:** a recorded flow is a *demo*
(`.agents/skills/shoot-demo-video/SKILL.md`), a cut film is a *reel*
(`.agents/skills/intro-reel/SKILL.md`). See the table in `AGENTS.md`.

A still never touches the video pipeline. It drives the app itself, crops a
region, and frames it. There is no recording and no click log.

```
shots/<name>.ts  →  shoot  →  frame  →  out/still/<name>-<preset>.png
```

## Prerequisites

Same as a demo, minus ffmpeg:

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
```

For a logged-in app, capture a session once — this one is headed and needs a
human at the keyboard:

```bash
pnpm capture:session
```

Sessions expire. If a shoot reports "Not signed in — the stored session has
expired", run that again. Do **not** try to log in from a script.

## Write the shot

`shots/<name>.ts`. It has a flow's shape on purpose — the hard part is getting
the app into the state worth photographing, not the photograph.

```ts
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

export default defineShot({
  name: "agent-skill",
  viewport: { width: 1920, height: 1080 },
  startUrl: process.env.DEMO_URL_AGENT_SKILL,   // never hardcode a URL
  steps: [
    { click: "Skills" },
    { click: "Add skill", after: 800 },
  ],
  region: css("[data-panel=skills]"),
  padding: 24,
});
```

If a flow already reaches that state, **reuse it** rather than rewriting the
steps — `ready`, `prepare` and `targets` all transfer:

```ts
import flow from "../flows/agent-skill";
export default defineShot({
  name: "agent-skill",
  viewport: flow.viewport,
  startUrl: flow.startUrl,
  ready: flow.ready,
  prepare: flow.prepare,
  targets: flow.targets,
  steps: [ /* just enough to open the thing */ ],
  region: { x: 856, y: 738, w: 904, h: 342 },
});
```

## Choosing the region

Three forms, in the order you should reach for them:

| Form | Use it when |
| --- | --- |
| `css("...")` | usual case. Structural regions (a panel, a sidebar, a card) have no accessible name |
| `{ x, y, w, h }` | the region is not one element — e.g. a popover *and* the input it opened from |
| `"Visible name"` | the region really is one named control. Goes through the same ladder clicks use |

A bare name resolves *controls*. It will not find "the sidebar". Do not fight it
— use `css()`.

To pick a rect, do not guess:

```bash
pnpm shot <name> --probe
```

That drives the steps, then writes `.diag/shots/<name>.probe.png` — the full
viewport under a 100px coordinate grid — plus a listing of what was on screen.
Read the numbers off the image.

## Shoot it

```bash
pnpm shot <name>                 # capture only  → public/shots/<name>.png
pnpm render:still <name> [og]    # frame only    → out/still/<name>-og.png
pnpm still <name> [og|--all]     # both
```

Iterating on framing? Run `render:still` alone. The capture is the slow half and
it is already done.

## Presets

| id | canvas | for |
| --- | --- | --- |
| `wide` | 3840×2160 | 16:9, the default |
| `og` | 2400×1260 | X / LinkedIn / OpenGraph link cards |
| `square` | 2160×2160 | 1:1 feed posts |
| `portrait` | 2160×2700 | 4:5, Instagram feed |
| `story` | 2160×3840 | 9:16, stories / Reels / Shorts |

The window takes the region's own shape and is fitted into the canvas on
whichever axis binds first, so a wide region in a 9:16 frame letterboxes rather
than being cropped. Short edge is 2160 everywhere, so one capture carries the
same detail in any frame.

## Things that will bite you

- **The region is small and the image looks soft.** `deviceScaleFactor` can only
  be set at context creation, so the capture shoots at 2×, measures, and re-runs
  at up to 4× if it fell short. A region under ~960 CSS px cannot reach 4K even
  at 4× — you get a warning, not a silent upscale. Shoot a larger region.
- **It re-runs the whole step list** to raise the scale. Set `scale: 4` in the
  spec once a shot is settled and it only runs once.
- **Padding does not apply to an explicit rect.** A `css()` or name region gets
  `padding` (default 16px); a rect is taken literally, so bake the margin in.
- **A rect past the viewport is clamped**, with a warning. Watch the bottom edge
  — controls near the bottom of a 1080-tall viewport have little room below.
- **Framing a popover alone often reads badly.** Popovers are already rounded
  cards with their own shadow, so the window frame makes it a card inside a
  card. Include the control it belongs to.
- **Do not reach for `CAPTURE_SCALE`.** It exists to work around a *video*
  limitation and it breaks `vh`/`vw` layouts. Screenshots do not need it.
- **Shot specs are gitignored** except `shots/smoke.ts`, exactly like flows —
  they name one account's screens.

## Where the reasoning lives

`src/lib/still.ts` (presets, window-fit geometry), `scripts/shoot-still.ts` (why
the scale is chosen by re-running rather than by a CDP override — it was
measured), `src/StillShot.tsx` (why there is no motion blur and no camera).
