# Catalog

Everything this repo can make, shown rather than described. Each picture is a
real output with the command that made it underneath, so you can find the look
you want here and copy the line. The flags are explained in
[README.md](./README.md); this file is for choosing.

Three things come out of the pipeline:

| | **demo** | **reel** | **still** |
| --- | --- | --- | --- |
| | a recorded flow, framed and filmed | title cards cut with demo footage | one picture of one part of the screen |
| <img src="docs/catalog/demo-framed-zoom.jpg" width="260"> | <img src="docs/catalog/reel-proof-card.jpg" width="260"> | <img src="docs/catalog/still-look-cutout-keep.jpg" width="260"> |
| `pnpm record:live <name>` → `pnpm render <name>` | `pnpm reel <name>` | `pnpm still <name>` |

Images live in `docs/catalog/`. They are downscaled previews; the real outputs
are 1080p video and 4K stills.

---

## Stills

A still is authored in `shots/<name>.ts` (steps to reach the state, then the
region to keep) and framed by a **look**, on a **ground**, into a **preset**
canvas. Any framing knob can be changed at render time with a flag, without
re-driving the browser.

### I want… → use

| I want | look / knobs |
| --- | --- |
| a whole screen, in a window | `look: "window"`, no `region` |
| a panel or region, in a window | `look: "window"`, `region: css("…")`, `padding` |
| a popover / menu / composer alone, with its own shadow | `look: "cutout"`, `region: css("…")` |
| a popover **and** its submenu, or a menu and the chip it opened from | `look: "cutout"` + `keep: [css("…")]` |
| a component cropped into, running off an edge | `look: "cutout"`, `fit: 1.35`, `anchor: "left"` |
| a screen running off the canvas edges | `look: "bleed"`, `zoom`, `anchor` |
| a landscape screen filling a portrait / story frame | `look: "bleed"`, `zoom: "fill"` |
| one picture posted as 2–3 images (carousel, multi-image post) | `split: 3`, `gutter: 8` |
| a flat ground like the reference stills | `ground: "#f3f3f3"` |
| a PNG with transparency | `ground: "transparent"` |
| the app's mobile layout (`/m/…` routes) | `mobile: true` |

### Looks

| window | cutout | bleed |
| --- | --- | --- |
| <img src="docs/catalog/still-look-window-desktop.jpg" width="300"> | <img src="docs/catalog/still-look-cutout-keep.jpg" width="300"> | <img src="docs/catalog/still-bleed-zoom-1.6.jpg" width="300"> |
| the crop inside the floating window frame — the original | the element alone: its own shadow, transparent edges, on the ground | the window larger than the canvas, pinned to a corner, running off |
| `agents-page wide --look=window` | `sessions-filter-menu square` (with `keep`) | `agents-page wide --zoom=1.6` |

A window shot can be reframed as a bleed at render time (`--look=bleed`); a
cutout is captured differently and is set in the shot.

| window, image backdrop | window, region + padding | window reframed as bleed | whole mobile page |
| --- | --- | --- | --- |
| <img src="docs/catalog/still-look-window-cobalt.jpg" width="220"> | <img src="docs/catalog/still-window-region-padding-fixed.jpg" width="220"> | <img src="docs/catalog/still-window-reframed-bleed.jpg" width="220"> | <img src="docs/catalog/still-window-fullpage-mobile.jpg" width="220"> |
| `--backdrop=cobalt` | `region: css(…)`, `padding: { top: 0, bottom: 28, … }` | `agents-home-list og --look=bleed --anchor=top-left --zoom=1.3` | `viewport: 820×1180`, `mobile: true` |

### Presets

The same cutout on every canvas. Short edge is 2160 everywhere. Match the
canvas to the subject: a tall popover wants `square` or `portrait`.

| wide 3840×2160 | og 2400×1260 | square 2160² | portrait 2160×2700 | story 2160×3840 |
| --- | --- | --- | --- | --- |
| <img src="docs/catalog/still-preset-wide.jpg" width="180"> | <img src="docs/catalog/still-preset-og.jpg" width="180"> | <img src="docs/catalog/still-preset-square.jpg" width="180"> | <img src="docs/catalog/still-preset-portrait.jpg" width="180"> | <img src="docs/catalog/still-preset-story.jpg" width="180"> |
| 16:9, the default | X / LinkedIn link card | 1:1 feed | 4:5, Instagram feed | 9:16, stories / Reels |

### Grounds

Elevation follows the ground: on a light ground a cutout keeps its own shadow
(or gets a soft cast one if it painted none); on a dark one it gets a hairline
lift instead, because a dark shadow has nothing darker to be.

| flat `#f3f3f3` | transparent | chalk (light image) | glaze (dark image) | window on glaze |
| --- | --- | --- | --- | --- |
| <img src="docs/catalog/still-ground-flat.jpg" width="180"> | <img src="docs/catalog/still-ground-transparent.png" width="180"> | <img src="docs/catalog/still-backdrop-chalk-light.jpg" width="180"> | <img src="docs/catalog/still-backdrop-glaze-dark.jpg" width="180"> | <img src="docs/catalog/still-backdrop-window-glaze-safe.jpg" width="180"> |
| `ground: "#f3f3f3"` | `ground: "transparent"` | `backdrop: "chalk"` | `backdrop: "glaze"` | `--backdrop=glaze` |

### Cutout: fit, anchor, inset

`fit` is the fraction of the canvas the element may fill; over 1 crops into
it. `anchor` pins it; `inset` keeps that much of the edge clear.

| fit 0.5 | fit 0.8 (default) | fit 1.35, anchor left |
| --- | --- | --- |
| <img src="docs/catalog/still-fit-0.5.jpg" width="300"> | <img src="docs/catalog/still-fit-0.8.jpg" width="300"> | <img src="docs/catalog/still-fit-1.35-left.jpg" width="300"> |
| `--fit=0.5` | `--fit=0.8` | `--fit=1.35 --anchor=left --inset=0.08` |

| top-left, inset 0.08 | bottom-right, inset 0.08 | right, inset 0 |
| --- | --- | --- |
| <img src="docs/catalog/still-anchor-top-left.jpg" width="300"> | <img src="docs/catalog/still-anchor-bottom-right.jpg" width="300"> | <img src="docs/catalog/still-anchor-right-inset0.jpg" width="300"> |
| `--anchor=top-left --inset=0.08` | `--anchor=bottom-right --inset=0.08` | `--anchor=right --inset=0` — the shadow runs off, and the render says so |

### Cutout: shadow and upscale

| shadow auto | shadow off | native (45%) | upscale 1.5 (68%) |
| --- | --- | --- | --- |
| <img src="docs/catalog/still-shadow-auto.jpg" width="220"> | <img src="docs/catalog/still-shadow-off.jpg" width="220"> | <img src="docs/catalog/still-ground-flat.jpg" width="220"> | <img src="docs/catalog/still-ground-flat-upscale.jpg" width="220"> |
| the element's own shadow, kept | `--shadow=false` | a 188px element at the 4× ceiling: never stretched | `--upscale=1.5` — opt-in, capped, reads softer |

A cutout never upscales unless asked. When an element comes up short, the
capture log names the viewport that would reach it natively (a smaller viewport
allows a higher scale) and the `upscale` that would stretch it.

### Bleed: zoom and anchor

| zoom 1.3 | zoom 1.6 | zoom 2.4 | anchor bottom-right |
| --- | --- | --- | --- |
| <img src="docs/catalog/still-bleed-zoom-1.3.jpg" width="220"> | <img src="docs/catalog/still-bleed-zoom-1.6.jpg" width="220"> | <img src="docs/catalog/still-bleed-zoom-2.4.jpg" width="220"> | <img src="docs/catalog/still-bleed-bottom-right.jpg" width="220"> |
| `--zoom=1.3` | `--zoom=1.6` | `--zoom=2.4` | `--anchor=bottom-right` — frames whatever is in that corner |

| story, zoom 1.4 | story, zoom fill | portrait, zoom fill |
| --- | --- | --- |
| <img src="docs/catalog/still-bleed-story.jpg" width="200"> | <img src="docs/catalog/still-bleed-story-fill.jpg" width="200"> | <img src="docs/catalog/still-bleed-portrait-fill.jpg" width="200"> |
| a landscape screen floats at any fixed zoom | `--zoom=fill` grows it until it covers the frame | `--zoom=fill` |

### Splits

One layout across N pieces, each rendered as its own file; posted in order they
read as one picture. `gutter` is the platform's gap between images, left out of
the composition so lines continue straight across it.

| split 3, gutter 8 — 1 of 3 | 2 of 3 | 3 of 3 |
| --- | --- | --- |
| <img src="docs/catalog/still-split3-gutter8-portrait-1of3.jpg" width="240"> | <img src="docs/catalog/still-split3-gutter8-portrait-2of3.jpg" width="240"> | <img src="docs/catalog/still-split3-gutter8-portrait-3of3.jpg" width="240"> |
| `agents-page portrait --split=3 --gutter=8` | | |

| cutout across 2 squares — 1 of 2 | 2 of 2 |
| --- | --- |
| <img src="docs/catalog/still-split2-cutout-square-1of2.jpg" width="240"> | <img src="docs/catalog/still-split2-cutout-square-2of2.jpg" width="240"> |
| `agents-home-composer square --split=2 --gutter=12 --fit=0.7` | |

`--split=1` renders a splitting shot whole. Use `gutter: 0` for a swipe
carousel, a few px for a multi-image post.

### Capture

Not visible in a picture, but part of every shot:

| knob | what it does |
| --- | --- |
| `region` | a visible name, `css("…")`, or `{ x, y, w, h }`; `pnpm shot <name> --probe` draws a grid to read a rect off |
| `padding` | one number or `{ top, right, bottom, left }` around a window region |
| `scale` | force the device scale factor; otherwise measured, up to the viewport's surface budget (4× at 1920×1080, 5.8× at 820×1180) |
| `mobile` | present as a mobile client for apps that route a mobile layout by client hint |
| `keep` | extra elements isolated with a cutout's region |
| `--out=` | name the output file; otherwise every render-time flag goes in the name |

---

## Demos

A demo is a recorded flow: Playwright drives the app, a synthetic cursor
glides between targets, every click is logged, and Remotion frames the footage
in the window with a click-driven zoom camera. `flows/<name>.ts` is the script.

| establish | zoom in on the action | trail out |
| --- | --- | --- |
| <img src="docs/catalog/demo-framed-establish.jpg" width="300"> | <img src="docs/catalog/demo-framed-zoom.jpg" width="300"> | <img src="docs/catalog/demo-framed-zoom-2.jpg" width="300"> |
| window on the backdrop at base scale | the camera punches in on the cluster of clicks and pans between them | back to base before the next beat |

What a flow controls, per step: the target (`click`, `type`, `focus`,
`moveTo`, `key`), the pacing (`after`, `pause`, `hoverMs`, `travelMs`) and the
camera (`cluster`, `zoomScale`, `frame`, `zoom: false`). Choreography — browse
before you commit, slow the hops, keep one interaction in one zoom cluster — is
in [`.agents/skills/intro-reel/SKILL.md`](./.agents/skills/intro-reel/SKILL.md#choreography--the-cursors-path-is-the-clip).

Optional on a demo: an **intro title card** (`intros/<name>.json` — wordmark,
headline assembling word by word, a hold) concatenated in front, and a
**keycap HUD** for keyboard beats.

---

## Reels

A reel is title cards cut with ranges of a rendered demo. Its **style** names
the whole grammar — how cards enter and leave, how footage is framed, whether
there is a window, a cursor, a ripple — each measured off a reference launch
film (see [`docs/reel/`](./docs/reel/)). `style:` in `reels/<name>.ts`;
`proof` when nothing is said.

### classic — framed window, click-driven camera

The original. Window on a backdrop with chrome, cursor and ripple; cards hold
and leave on a 4% scale push.

| card | footage | sign-off |
| --- | --- | --- |
| <img src="docs/catalog/reel-classic-card.jpg" width="300"> | <img src="docs/catalog/reel-classic-footage.jpg" width="300"> | <img src="docs/catalog/reel-classic-signoff.jpg" width="300"> |

`reels/agent-slash-command.ts`, `reels/agent-skill.ts`

### proof — full-bleed, metronomic (the default)

Cursor's "Agent UX improvements" grammar. Footage fills the frame edge to
edge, no window, no zoom camera; cards cut in mid-reveal and hold 2.07s after
their last word; every shot arrives and leaves on a push envelope. Per clip
you author the framing (`crop: { k, cx, cy, dx }` — pan, barely magnify).

| card | footage | footage |
| --- | --- | --- |
| <img src="docs/catalog/reel-proof-card.jpg" width="300"> | <img src="docs/catalog/reel-proof-footage.jpg" width="300"> | <img src="docs/catalog/reel-proof-footage-2.jpg" width="300"> |

`reels/harness.ts`

### ledger — isolated components, length follows the copy

Full-bleed with `framing: "isolate"`: a component's box fills the frame with
nothing else in shot. Cards run as long as their words need, no fixed slot.

| card | footage | card, mid-reveal |
| --- | --- | --- |
| <img src="docs/catalog/reel-ledger-card.jpg" width="300"> | <img src="docs/catalog/reel-ledger-footage.jpg" width="300"> | <img src="docs/catalog/reel-ledger-signoff.jpg" width="300"> |

`reels/agent-schedule.ts`

### stage — flat cards over a windowed stage

Full-bleed cards on a flat cream ground over windowed footage; arrive
decelerating, hold, accelerate away, cut mid-move. The mark opens it.

| mark | footage | highlight, mid-reveal |
| --- | --- | --- |
| <img src="docs/catalog/reel-stage-mark.jpg" width="300"> | <img src="docs/catalog/reel-stage-footage.jpg" width="300"> | <img src="docs/catalog/reel-stage-chip.jpg" width="300"> |

`reels/agent-schedule-stage.ts`, `reels/agent-tool.ts`

### Card copy

Emphasis lives in the headline string, per word, no code:

| markup | effect |
| --- | --- |
| `*word*` | bold |
| `_word_` | italic |
| `==word==` | highlight in the palette colour (the stage frame above) |
| `==word\|#ffd54a==` | highlight in a custom colour |
| `{chip}` | a live-looking control inside the sentence, with `chip: { label }` |

---

## Backdrops

Sixteen ship with the repo, prepared with grain so they survive h264 without
banding. `backdrop: "<name>"` on a flow, shot or reel; `--backdrop=` at render.
Add your own with `pnpm backdrop <image> <name>`.

**Dark** — the window gets a white rim.

| glaze (default) | ink | cobalt | graphite |
| --- | --- | --- | --- |
| <img src="docs/catalog/backdrop-glaze.jpg" width="220"> | <img src="docs/catalog/backdrop-ink.jpg" width="220"> | <img src="docs/catalog/backdrop-cobalt.jpg" width="220"> | <img src="docs/catalog/backdrop-graphite.jpg" width="220"> |
| near-black, faint streaks | the darkest — filaments on black | blue and magenta folds | monochrome folds, most neutral |

| ember | flare | prism | bloom |
| --- | --- | --- | --- |
| <img src="docs/catalog/backdrop-ember.jpg" width="220"> | <img src="docs/catalog/backdrop-flare.jpg" width="220"> | <img src="docs/catalog/backdrop-prism.jpg" width="220"> | <img src="docs/catalog/backdrop-bloom.jpg" width="220"> |
| red folds, deep | red folds, brighter | teal and coral split | soft pink and white |

| halo | dusk | studio | moonrise |
| --- | --- | --- | --- |
| <img src="docs/catalog/backdrop-halo.jpg" width="220"> | <img src="docs/catalog/backdrop-dusk.jpg" width="220"> | <img src="docs/catalog/backdrop-studio.jpg" width="220"> | <img src="docs/catalog/backdrop-moonrise.jpg" width="220"> |
| magenta ring on near-black | a low sunset horizon — has a subject | a studio-lit object — has a subject | deep purple, magenta glow |

**Light** — the window gets a soft dark shadow instead; a cutout keeps its own.

| canyon | mist | chalk | aurora |
| --- | --- | --- | --- |
| <img src="docs/catalog/backdrop-canyon.jpg" width="220"> | <img src="docs/catalog/backdrop-mist.jpg" width="220"> | <img src="docs/catalog/backdrop-chalk.jpg" width="220"> | <img src="docs/catalog/backdrop-aurora.jpg" width="220"> |
| cream and teal wash | pale teal and white streaks | near-white, grey ring | cyan-to-lavender wash |

For stills that should look like the reference product shots, a flat
`ground: "#f3f3f3"` beats any of these — the product is the picture and the
ground is a margin.

---

## Regenerating this file's images

The stills are the commands under each picture, rendered from the shots named
in them; the demo and reel frames are pulled from `out/demo/` and `out/reel/`
with `ffmpeg -ss <t> -i <file> -frames:v 1`; the backdrops are
`public/backdrops/` at 480px. Everything is downscaled to 800px and saved as
JPEG in `docs/catalog/` (the transparent example stays PNG).
