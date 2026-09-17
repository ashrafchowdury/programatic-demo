---
name: shoot-still
description: Capture one region of a running app as a 4K image on the demo backdrop, sized for social — framed in the window, cut out alone with its own shadow, or bleeding off the canvas. Use when asked for a screenshot, a still, a hero image, an OG/link-card image, a cutout of a popover or component, or a shareable picture of part of the UI.
metadata:
  tags: remotion, playwright, screenshot, still, image, social
---

# Shoot a still

**This is one of three features. A still is a PNG of one part of the screen. If
you actually want video, stop:** a recorded flow is a *demo*
(`.agents/skills/shoot-demo-video/SKILL.md`), a cut film is a *reel*
(`.agents/skills/intro-reel/SKILL.md`). See the table in `AGENTS.md`.

Driven by Playwright's Chromium, launched by these scripts — not your own
browser. First time on this machine: `pnpm exec playwright install --with-deps
chromium`.

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

## Choosing the look

A still has one of three named looks. Say which one you want; `window` is what
you get when you say nothing.

| `look` | what it is | for |
| --- | --- | --- |
| `window` | the crop inside the floating window frame, as the clips draw it | a panel, a screen, anything that is *part of a page* |
| `cutout` | the element **alone** — its own shadow, its own rounded corners, transparent around it, straight on the backdrop | a popover, a menu, a composer, a card: anything that *is already a card* |
| `bleed` | the window, drawn larger than the canvas and pinned to a corner so it runs off the edges | a whole app screen where the detail matters more than the edges |

```ts
export default defineShot({
  // ...steps as usual
  look: "cutout",
  region: css('[role="listbox"]'),   // the element that OWNS the shadow
  ground: "#f3f3f3",                 // a flat ground — see below
});
```

**Use a flat `ground` for cutouts and bleeds.** Every reference still sits on
one: the product is the picture and the ground is a margin, so a photograph
behind it competes for the eye. `ground: "#rrggbb"` (or `--ground=` at
render) replaces the backdrop image; a light one gets the cast-shadow
elevation, a dark one the hairline lift, decided by luminance. The image
backdrops remain the right choice for the window look next to the clips.

```ts
export default defineShot({
  // ...
  look: "bleed",
  region: css(".app"),
  padding: 0,
  anchor: "top-left",   // which corner stays on screen
});
```

**`cutout` is a capture decision.** It photographs differently: everything but
the element is hidden (layout untouched), the page background is cleared, and
the screenshot keeps real alpha — the shadow and the anti-aliased corners are
in the PNG, not drawn around it. The crop is then measured off the *painted*
pixels, so nothing is guessed: the whole shadow is in, and nothing else. The
sidecar records where the element's own box sits inside that, and the
composition centres the element, not the shadow. It needs a `region` that is
one element (a name or `css()`); a rect is refused.

**`bleed` is a render decision** over an ordinary window capture, so any
window shot can be reframed as a bleed — and back — without re-shooting:

```bash
pnpm render:still <name> --look=bleed --anchor=bottom-right --zoom=1.5
```

Framing knobs, in the spec or as `--flag=` on `render:still` (the flag wins):

| knob | applies to | default | meaning |
| --- | --- | --- | --- |
| `ground` | all | — | flat colour instead of the backdrop image, `#f3f3f3`, or `transparent` |
| `split` | all | — | cut into this many pieces side by side, laid out as one picture |
| `gutter` | all | 0 | output px left out between pieces — the platform's gap |
| `fit` | cutout | 0.8 | fraction of the canvas the element may fill — over 1 crops INTO it (up to 2) |
| `shadow` | cutout | auto | cast a soft shadow; default only when the element painted none |
| `anchor` | cutout, bleed | center / top-left | `top-left`, `top`, … `bottom-right`, `center` |
| `inset` | cutout, bleed | 0 / 0.06 | fraction of the canvas edge kept clear on the anchored side(s) |
| `zoom` | bleed | 1.3 | how much larger than the fitted window |

**Crop into the subject, don't present it whole.** The reference stills run a
composer off the right edge and a window off two sides; a component centred
with a margin on every side is a catalogue shot. `fit: 1.35, anchor: "left",
inset: 0.08` frames a cutout wider than the canvas and pins its left edge.
And give it something to show — an empty input with placeholder text is not
a picture of anything: type the task and attach the files in `steps` first.

**A split is one picture posted as several.** `split: 3` (or `--split=3`)
lays the still out across three pieces of the preset's size and renders each
as its own file, `-1of3` … `-3of3`; posted in order they read as one. `gutter`
leaves the platform's gap between images out of the composition so lines
continue straight across it — 0 for a swipe carousel, ~8 for a multi-image
post. Every look works inside a split; the cut is exact because nothing is
sliced — each piece is the same layout, translated.

A cutout **never upscales**. The capture shoots at the scale `fit` asks for;
if the element is still too small to fill it, it is drawn at native pixels and
you are told. That is the honest outcome — a stretched screenshot of a popover
is exactly what this look exists to avoid. The scale ceiling is a *surface*
budget, not a number: 1920×1080 stops at 4×, a tablet-shaped 820×1180 page
reaches 5.8× — so a small popover on a small viewport still fills the frame.

## Shoot it

```bash
pnpm shot <name>                 # capture only  → public/shots/<name>.png
pnpm render:still <name> [og]    # frame only    → out/still/<name>-og.png
pnpm still <name> [og|--all]     # both
```

Iterating on framing? Run `render:still` alone. The capture is the slow half and
it is already done.

## Framing an image you already have

If the screenshot exists — you took it by hand, someone sent it, a design tool
exported it — skip the capture entirely:

```bash
pnpm render:still <name> --from screenshot.png --all
```

That copies it to `public/shots/<name>.png`, writes the sidecar from the image's
real dimensions, and frames it. The two stages only ever meet at those two
files, so anything that can produce them can use the framing.

The upscale warning still applies and is still honest: a 2832px-wide screenshot
in a 3840px canvas gets stretched about 1.1x. For a hero image, prefer shooting
it with `pnpm shot` so the pixels are native.

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
  higher if it fell short — up to the viewport's surface budget (4× at
  1920×1080, more on a smaller viewport). Past that you get a warning, not a
  silent upscale. Shoot a larger region, or a smaller viewport.
- **It re-runs the whole step list** to raise the scale. Set `scale: 4` in the
  spec once a shot is settled and it only runs once.
- **Padding does not apply to an explicit rect.** A `css()` or name region gets
  `padding` (default 16px); a rect is taken literally, so bake the margin in.
- **A rect past the viewport is clamped**, with a warning. Watch the bottom edge
  — controls near the bottom of a 1080-tall viewport have little room below.
- **A popover in the window frame reads as a card inside a card.** That is
  what `look: "cutout"` is for. If you want the popover *and* the control it
  opened from, that is two elements — use `window` with a rect.
- **A cutout's shadow vanishes on a dark backdrop.** It is dark, and there is
  nothing darker than `glaze` to be. It gets a hairline lift instead (the same
  device the window's rim uses), which reads fine — but for the soft-shadow
  look of the references, use `chalk`, `mist`, `canyon` or `aurora`.
- **A cutout warns when the shadow is cut.** By the viewport edge (raise the
  viewport, or scroll), or by an ancestor with `overflow: hidden` — the
  warning names it. Neither is fixed automatically: forcing `overflow: visible`
  shifts layout, and a cut shadow is better reported than silently shipped.
- **Hover menus close during a cutout.** Isolation hides the trigger, and a
  menu that lives on `mouseleave` goes with it. Use `window`.
- **Translucent fills are flattened, frosted ones are not.** A `bg-muted/50`
  card or a bordered box with no fill only looks right over the page, so a
  cutout composites each such fill over the colour that was behind it and sets
  it opaque — the card comes out as you see it in the app, not as glass.
  `backdrop-filter` and gradients are left alone and will read differently. An
  ancestor's `opacity` is kept on purpose — it is what the user sees.
- **The composition adds a shadow only when the element brought none.** Read
  off the capture: painted extent vs border box. `shadow: true`/`false` forces it.
- **Rows without a surface float.** A list whose rows are text on the page has
  nothing to cut out; it comes back as floating text. That is a *part of a
  page* — use `window`.
- **A page that only exists for mobile needs `mobile: true`.** Some apps route
  a mobile layout (agenta's `/m/…`) by the client hint, not the viewport, and
  bounce a desktop Chromium to the desktop route. The flag presents a tablet
  UA with mobile emulation; pair it with a tablet-shaped viewport.
- **Per-browser state is not in the session.** Icons or themes a user picked
  live in *their* browser's localStorage; the Playwright profile shows the
  app's defaults until they are picked there too.
- **Do not reach for `CAPTURE_SCALE`.** It exists to work around a *video*
  limitation and it breaks `vh`/`vw` layouts. Screenshots do not need it.
- **Shot specs are gitignored** except `shots/smoke.ts`, exactly like flows —
  they name one account's screens.

## Where the reasoning lives

`src/lib/still.ts` (presets, looks, window-fit and anchor geometry),
`scripts/shoot-still.ts` (why the scale is chosen by re-running rather than by
a CDP override — it was measured), `scripts/lib/isolate.ts` (how a cutout
hides the page without moving it, and why the crop is measured off alpha),
`src/StillShot.tsx` (why there is no motion blur and no camera, and why a
cutout on a dark backdrop gets a hairline).
