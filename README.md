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

> **Looking for a picture of what each option does?** [CATALOG.md](./CATALOG.md)
> shows every look, preset, knob, reel style and backdrop as a real output with
> the command under it.

## Three things this makes

| | **demo** | **reel** | **still** |
| --- | --- | --- | --- |
| What | one recorded flow, played through | a launch film cut from cards + demo footage | one region of the app, as an image |
| You write | `flows/<name>.ts` | `reels/<name>.ts` | `shots/<name>.ts` |
| You run | `pnpm record:live` → `convert` → `render` | `pnpm reel <name>` | `pnpm still <name>` |
| You get | `out/demo/<name>.mp4` | `out/reel/<name>.mp4` | `out/still/<name>-<preset>.png` |

A reel is cut **from** a demo, so render the demo first. A still stands alone —
it drives the app itself and never touches the video pipeline. It is also the
only one that renders at 4K (a demo captures at 4K but renders at 2560): see
[Stills](#stills-one-part-of-the-app-at-4k).

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
| ffmpeg | **system install required** (`brew install ffmpeg`) for `pnpm reel` and `pnpm analyze`, and for the sync cross-check — see [Sync](#sync-why-the-recorder-flashes-the-screen) |
| GPU | rendering rasterises on the GPU, worth **roughly 10×** on a real demo (a 23s clip: 24 min → 2-3 min). No usable GPU (CI, headless Linux)? Set `DEMO_GL=swiftshader` — see [Knobs](#knobs) |

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
`out/demo/smoke.mp4`. If it works, record → convert → render all work.

```bash
pnpm test     # unit tests: camera, zoom, cursor, styles, reel, stills, capture
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

Every recorder reads this the same way — `record:live`, `record:batch`,
`still` and `pnpm record <name>` alike: headless unless `HEADED=1` (or
`HEADLESS=0`). The one exception is a `DEMO_TOUR=capture` run, which is always
headed because a human drives it. A public site that challenges headless
browsers (Google, sometimes) is a reason to set `HEADED=1` for that take.

### Capture

The recorder films through Chrome's compositor (CDP `Page.startScreencast`):
lossless PNG frames, each placed on its own swap timestamp, muxed to
`recordings/<name>.mkv`. `DEMO_CAPTURE=playwright` falls back to Playwright's
`recordVideo` (25 fps, 1 Mbps VP8) — only for debugging the capture itself.

The screencast emits CSS-viewport pixels, so the footage is sharpened another
way: `CAPTURE_SCALE` (default **2**) doubles the CSS viewport under a root
`zoom`, so the app lays out at the flow's own size and the recorder films
3840×2160 frames of it. A capture narrower than the render needs at the
camera's deepest zoom (3831 px for the 2560 output) is **refused** before a
frame is shot; `DEMO_ALLOW_SOFT_CAPTURE=1` records it anyway, soft, and says so.
A flow the root zoom breaks can pin `captureScale: 1` in `defineFlow`, which
also allows the soft capture; `CAPTURE_SCALE` on the command line still wins.

**Agenta automation flows currently need `CAPTURE_SCALE=1`**: their popovers are
positioned from computed offsets and land off-screen under the root zoom, so
Playwright cannot click them. That is being fixed; until then shoot them with
`CAPTURE_SCALE=1 DEMO_ALLOW_SOFT_CAPTURE=1`. See
[`scripts/lib/capture-scale.ts`](scripts/lib/capture-scale.ts).

### Several at once

```bash
pnpm record:batch --all --concurrency 2
pnpm record:batch a b --check      # resolve selectors only, no video
```

`.session-profile/` can only be held by one browser at a time, which is why
shoots used to be serial. The batch does the one step that needs the profile —
proving the session is live and re-exporting `.sessions/<host>.json` — **serially up
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

## Intro title card

An optional card that plays before a demo: wordmark, headline assembling word by
word, then a still hold. It is cut as a one-card reel (`pnpm intro <name>`,
below), so nothing about the demo render changes.

Write the copy — that is the whole storyboard, there is no animation to author.
Author it as **JSON** (no code) or **TS** (`intros/<name>.json` is loaded before
`intros/<name>.ts`):

```json
// intros/agent-skill.json  — name must match the demo
{
  "name": "agent-skill",
  "headline": "Give your agent a *new skill*",
  "subhead": "In under a minute.",
  "wordmark": "Acme"
}
```

```ts
// intros/<name>.ts — same fields, if you prefer code
import { defineIntro } from "../src/lib/intro";

export default defineIntro({
  name: "agent-skill",              // must match the demo name
  headline: "Give your agent a *new skill*",
  subhead: "In under a minute.",    // optional
  wordmark: "Acme",                 // optional
});
```

**Emphasis is per-word and lives inside the headline string** — headlines are
normal weight by default, and any word can opt into a style with inline markup,
no code change:

| Markup | Effect |
| --- | --- |
| `*word*` | **bold** |
| `_word_` | _italic_ |
| `==word==` | highlight in the palette colour |
| `==word\|#ffd54a==` | highlight in a custom colour (ink auto-contrasts) |
| `{chip}` | the live control (chip cards) — styling composes around it |

A marked run may span words (`*two words*`); each word still appears on its own
beat. `introProblem` validates the markup (a malformed `#hex`, a chip line too
long once the markup is stripped) before a frame renders.

Then, after the demo itself has been rendered:

```bash
pnpm clip <name>     # record -> convert -> render   (unchanged)
pnpm intro <name>    # the card alone, as a one-card reel
```

| Command | Writes |
| --- | --- |
| `pnpm intro <name>` | `out/reel/<name>.intro.mp4` — the card, cut by the reel pipeline |

`render:intro` and `stitch` are retired. For the card followed by the demo, write
a reel whose segments are the card and one clip covering the demo.

Pacing comes from the word count, in
[`src/lib/intro.ts`](src/lib/intro.ts): words start 90 ms apart and overlap, so
a headline assembles as one phrase. Keep headlines to 4–7 words. Unlike the demo
body, the card does **not** speed up under `DEMO_SPEED` — the footage is a
recording being replayed faster, the card is authored motion, and copy at 2x is
copy nobody reads.

The card uses the same studio backdrop the demo floats its window on, so
the cut lands on an unchanged frame: the text leaves, the window arrives. That
is also why a card and the clips beside it must agree on geometry exactly — the
reel joins them with `-c copy` where it can, and
[`scripts/lib/ffmpeg.ts`](scripts/lib/ffmpeg.ts) probes every segment and
refuses rather than producing an mp4 that plays and then falls apart.

**`pnpm analyze` works on a reel file too, now.** It used to be
useless there — a title card was a long frozen run by design and tripped the
dead-air thresholds. Cards no longer freeze, and the reel passes all six checks
(0.7% frozen against a 15% ceiling). `out/demo/<name>.mp4` is still never touched, so
analyze also keeps measuring the demo alone.

## Reels: cards cut with the demo

A reel is the narrative cut — title cards interleaved with ranges of an
already-rendered demo, in the style of a product launch film. The cards narrate,
the clips prove.

```ts
// reels/<name>.ts
import { defineReel } from "../src/lib/reel";

export default defineReel({
  name: "agent-skill",
  segments: [
    { card: { name: "agent-skill", headline: "Introducing Skills",
              wordmark: "Acme", background: "plain" } },
    { clip: { fromS: 0, toS: 3.2, label: "open the drawer" } },
    { card: { name: "agent-skill", headline: "Name it. Say when to use it.",
              background: "plain", holdS: 0.5 } },
    { clip: { fromS: 3.2, toS: 7.9, label: "name and describe" } },
  ],
});
```

```bash
pnpm render <name>   # the demo itself, once
pnpm reel <name>     # -> out/reel/<name>.mp4
```

Clip ranges are **seconds of `out/demo/<name>.mp4`** — the numbers you read off a
scrubber. `toS` is exclusive, so `0 → 3.2` and `3.2 → 7.9` do not share a frame.
Cut on still beats, not mid-glide: the camera holds through every interaction,
and a cut during a pan reads as a mistake.

Or anchor a range to **beats**: name a click-log `label` and the range follows
it through a re-shoot that moves it. A beat sits on its press; `leadS`/`tailS`
are signed offsets from it; `"label#2"` picks the second beat with that label.
Plain `fromS`/`toS` win where both are given.

```ts
{ clip: { fromBeat: "Add provider", leadS: -0.4, toBeat: "Save", tailS: 0.3 } }
```

```bash
pnpm reel <name> --check          # resolve beats, print each range and the cut rate; render nothing
pnpm reel <name> --style=stage    # the same cut in another grammar -> out/reel/<name>.stage.mp4
pnpm reel <name> --aspect=9:16    # vertical (or 1:1): a crop that follows the clicks -> <name>.9x16.mp4
```

`--style=` also works on `pnpm render` (a demo in another grammar) and
`pnpm intro` (with `--check`, too). An unknown style name is an error, not a
silent default.

Clips are re-rendered from the `DemoClip` composition with `--frames` rather
than cut out of the mp4, so the footage never picks up a second h264 generation.
That would make every iteration cost a full render, so each segment is cached
under `.diag/reel/<name>/` keyed by a hash of its own spec — change one card's
copy and only that card re-renders.

**Match the card's ground to the product.** `background` takes `"light"` (flat
near-white), `"plain"` (flat near-black) or `"plate"` (the default —
the studio backdrop, the same image the demo floats its window on, so a card at
the very start or end joins the footage on an unchanged frame).

Pick it by measuring, not by taste. The app these numbers come from is
light-theme and its footage averages Y 181; against near-black cards every cut
was a ~157-level slam, where the reference ad we benchmark against averages 63.
Switching to `"light"` put every cut at 42. For a dark-theme product the answer
inverts.

**A cold open** is a short clip in first position followed immediately by a card
— a few frames of product before anything is claimed about it. That shape is
recognised, so it is exempt from the rule that clip ranges move forward, and it
can replay footage a later clip covers. Pick a range where something is already
moving; opening on a static establish shot reads as a stuck decoder.

**`drift: 1` on a clip** adds a slow push inside its long holds, so a multi-second
typing beat is not perfectly inert. Off by default and never applied to
`out/demo/<name>.mp4`, so `pnpm render` and `pnpm analyze` are unaffected.

**A chip card** puts a live-looking control inside the sentence, sends the cursor
to it, and punches the camera into it — the click becomes the cut. Write
`headline: "Hit {chip}. It's live."` with `chip: { label: "Create" }`. The
sentence must fit one line; the chip is centred by a `1fr auto 1fr` grid so the
camera never has to measure where it landed.

Writing the copy: one short line per card, 4–7 words, saying what the next clip
is about to show. Pacing is derived from the word count — there is nothing to
time by hand. Give interstitials a short `holdS` (~0.5s); the 1.2s default is a
title-card hold and reads as a stall mid-film.

## Stills: one part of the app, at 4K

Demos are video, and the screencast emits CSS-viewport pixels no matter what
`deviceScaleFactor` says. A demo gets its detail another way — `CAPTURE_SCALE`
(default 2) doubles the CSS viewport under a root `zoom`, so the recorder films
true 3840×2160 frames of the same layout — but it renders at 2560, where 4K
buys the film almost nothing (`OUTPUT_WIDTH` in `src/lib/click-log.ts`). A
**screenshot** reads the real compositor surface, so at a 1920×1080 viewport
with `deviceScaleFactor: 2` it really is 3840×2160, and a still renders there.

That is what a still is: a captured region of the app, framed on the same
backdrop and in the same window as the clips, sized for wherever you are posting
it.

```bash
pnpm still smoke                # capture + frame, 3840×2160
pnpm still smoke og             # a 1200×630-shaped link card, at 2×
pnpm still smoke --all          # every preset
```

A shot is authored like a flow, because the hard part is getting the app into
the state worth photographing — not the photograph:

```ts
// shots/agent-skill.ts
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

export default defineShot({
  name: "agent-skill",
  viewport: { width: 1920, height: 1080 },
  startUrl: process.env.DEMO_URL_AGENT_SKILL,
  steps: [
    { click: "Skills" },
    { click: "Add skill", after: 800 },
  ],
  region: css("[data-panel=skills]"),   // the part to keep
  padding: 24,
});
```

`region` takes three forms. A **visible name** goes through the same ladder
clicks use, so `region: "Save"` finds the Save button — but that ladder resolves
*controls*, and most interesting regions (a sidebar, a results panel) have no
accessible name, so **`css(...)`** is the usual answer. An explicit
**`{ x, y, w, h }`** covers the rest. To pick one by eye:

```bash
pnpm shot smoke --probe
```

which drives the steps and then writes `.diag/shots/<name>.probe.png` — the full
viewport under a 100px coordinate grid — plus a listing of what was on screen.
Read the numbers off it and paste them in as a rect.

### Looks

`look` names how the region is framed. Three, and `window` is what you get
when you say nothing:

| `look` | what it is | for |
| --- | --- | --- |
| `window` | the crop inside the floating window frame, exactly as the clips draw it | a panel, or the **whole app** — omit `region` and the full viewport is the shot |
| `cutout` | the element **alone**: its own shadow, its own corners, real alpha around it, straight on the ground | a popover, a menu, a composer — anything that *is already a card* |
| `bleed` | the window drawn larger than the canvas and pinned to a corner, running off the edges | a whole screen where the detail matters more than the edges |

```ts
export default defineShot({
  // ...steps as usual
  look: "cutout",
  region: css('[role="listbox"]'),   // the element that owns the shadow
  ground: "#f3f3f3",
  fit: 1.35, anchor: "left", inset: 0.08,   // crop into it, run off the right
});
```

**`cutout` is a capture decision.** It photographs differently: everything but
the element is hidden (layout untouched), the page background is cleared,
translucent fills are flattened over what was behind them, and the screenshot
keeps real alpha — the shadow and the anti-aliased corners are *in* the PNG.
The crop is then measured off the painted pixels, so nothing is guessed. It
needs a `region` that is one element (a name or `css()`); a rect is refused.
A cutout never upscales: if the element is too small to fill `fit` at the
scale the viewport allows, it is drawn at native pixels and you are told.

**`bleed` is a render decision** over an ordinary window capture, so any
window shot can be reframed as a bleed — and back — without re-shooting.

### Controls

Every knob lives in the shot spec. Most can also be overridden at render time
as a flag, which is the fast way to iterate on framing — the capture is the
slow half and it is already done.

| spec field | render flag | applies to | default | what it does |
| --- | --- | --- | --- | --- |
| `look` | `--look=` | — | `window` | `window`, `cutout` or `bleed`. The flag may switch window↔bleed only; a cutout is captured differently |
| `region` | — | all | whole viewport | a visible name, `css("…")`, or `{ x, y, w, h }` |
| `padding` | — | window, bleed | 16 | CSS px of breathing room around a resolved element — one number, or `{ top, right, bottom, left }` (a side left out takes the default). Not applied to a rect; irrelevant to a cutout, which measures its own extent |
| `backdrop` | `--backdrop=` | all | `glaze` | one of the sixteen images below, or a file in `public/backdrops/` |
| `ground` | `--ground=` | all | — | a flat `#rrggbb` instead of the backdrop image, or `transparent` for a PNG with alpha. Wins over `backdrop`. What cutouts and bleeds want |
| `fit` | `--fit=` | cutout | 0.8 | fraction of the canvas the element's body may fill, on whichever axis binds. Over 1 (up to 2) crops *into* it |
| `anchor` | `--anchor=` | cutout, bleed | `center` / `top-left` | `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right` |
| `inset` | `--inset=` | cutout, bleed | 0 / 0.06 | fraction of the canvas edge kept clear on the anchored side(s) |
| `zoom` | `--zoom=` | bleed | 1.3 | how much larger than the fitted window, or `fill` — grow until the window covers the frame on both axes (what a landscape screen needs in a portrait or story frame) |
| `shadow` | `--shadow` / `--shadow=false` | cutout | auto | cast a soft shadow under the element. Auto = only when the element painted none of its own |
| `upscale` | `--upscale=` | cutout | 1 | let a small element stretch past native by up to this factor (max 1.5) to reach `fit`. Off by default — a cutout never upscales unless asked; the capture names the viewport that would reach the size natively |
| — | `--out=` | all | — | name the output file yourself, in `out/still/` |
| `split` | `--split=` | all | — | cut the still into this many pieces side by side, each the preset's size, laid out as one picture (below). `--split=1` renders a splitting shot whole |
| `gutter` | `--gutter=` | all | 0 | output px of the composition left out between pieces — the platform's gap |
| `scale` | `--scale=` | all | measured | force the device scale factor and skip the measuring pass. Capped by the viewport's surface budget (below) |
| `mobile` | — | all | off | present as a mobile client (tablet UA + mobile hints) for apps that serve a mobile layout on its own route |
| `viewport`, `startUrl`, `ready`, `prepare`, `targets`, `steps` | — | all | — | exactly as in a flow — the recipe for reaching the state worth photographing |

```bash
pnpm still <name> [preset|--all]            # capture + frame
pnpm shot <name>                            # capture only  → public/shots/<name>.png + .json
pnpm shot <name> --probe                    # coordinate grid + element listing, no capture
pnpm render:still <name> [preset|--all]     # frame only    → out/still/<name>-<preset>[-<look>][-<backdrop>|-<ground>].png
pnpm render:still <name> --look=bleed --anchor=bottom-right --zoom=1.5 --ground=#f3f3f3
```

The output filename carries the look, the ground or backdrop, and every knob
set on the command line (`-fit1.35-left-zoom1.6-gutter8-noshadow`), so
rendering one capture several ways never overwrites itself; knobs from the
spec are the shot's own look and leave the plain name. `--out=` names it
yourself.

Elevation is decided for you. On a **light** ground or backdrop a cutout keeps
its own shadow, or gets a soft cast one if it painted none; a window gets the
dark rim shadow. On a **dark** one a dark shadow has nothing darker to be, so a
cutout gets a hairline lift that follows its alpha and a window gets the white
rim. `--ground=` a hex colour and the light/dark question is answered by its
luminance; an image answers it from the `LIGHT_BACKDROPS` list.

### Splits: one picture, posted as several

```bash
pnpm render:still sessions-filter-bleed portrait --split=3 --gutter=8
#  → out/still/sessions-filter-bleed-portrait-bleed-{1,2,3}of3.png
```

A split lays the still out **once** across a canvas `split` pieces wide, then
renders each piece as its own image — the same layout, translated. Posted in
order, they read as one picture: a window running across three portrait
frames, a component straddling two squares. The cut is exact by construction;
no image is ever sliced, and every look works inside a split unchanged.

`gutter` is the strip between pieces that no piece renders. Platforms draw
their own gap between images laid side by side; leaving that much of the
composition out is what makes a line continue straight across the gap
instead of jogging at it. Use 0 for a swipe carousel, where pieces butt
together, and a few px for a multi-image post. The capture side knows about
the split too — a window three pieces wide needs three times the pixels, and
the scale is measured against that.

Things a cutout will tell you about, rather than quietly ship:

- the element's shadow reaches the viewport edge (raise the viewport, or scroll);
- an ancestor with `overflow: hidden` cuts the shadow — named, so you can
  include that ancestor or use `window`;
- the element is too small to fill `fit` at the allowed scale — it sits native;
- the ground is dark, so the native shadow will not read.

### Backdrops

Sixteen ship with the repo. Pick one by name — no code change:

```ts
export default defineShot({ name: "triggers", backdrop: "cobalt", /* … */ });
export default defineFlow({ name: "agent-skill", backdrop: "prism", /* … */ });
```

| name | | | name | |
| --- | --- | --- | --- | --- |
| `glaze` | near-black, faint streaks — default | | `halo` | magenta ring on near-black |
| `ink` | the darkest — filaments on black | | `dusk` | a low sunset horizon |
| `cobalt` | blue and magenta folds | | `studio` | a studio-lit object |
| `graphite` | monochrome folds, most neutral | | `canyon` | **light** — cream and teal |
| `ember` | red folds, deep | | `mist` | **light** — pale teal and white |
| `flare` | red folds, brighter | | `chalk` | **light** — near-white, grey ring |
| `prism` | teal and coral split | | `aurora` | **light** — cyan to lavender |
| `bloom` | soft pink and white | | `moonrise` | deep purple, magenta glow |

`dusk` and `studio` have a recognisable subject rather than being abstract, so
check the window is not sitting on the horizon or the object.

Override at render time without re-recording:

```bash
pnpm render:still triggers wide --backdrop=ember
pnpm render agent-skill --backdrop=graphite
```

Add your own — any image, converted and prepared the same way:

```bash
pnpm backdrop ~/Pictures/wall.heic aurora
```

That scales, blurs, grains and reports the banding measurement. Grain is not
decoration: h264's deadzone quantiser turns a smooth ramp into rings unless the
grain is in the source at full amplitude, and weak grain measures *worse* than
none. All sixteen measure 4–12px as the longest identical-colour run on a
scanline; the CSS gradient they replaced measured 97, a flat colour 2560.

On a **light** backdrop the window's white rim has nothing to be brighter than,
so it switches to a soft dark shadow instead. `LIGHT_BACKDROPS` holds every
backdrop measuring YAVG > 110 — add yours there if it is bright.

### Presets

| Preset | Canvas | For |
| --- | --- | --- |
| `wide` | 3840×2160 | 16:9 — the default, matches the demo videos |
| `og` | 2400×1260 | X / LinkedIn / OpenGraph link cards (2× the canonical 1200×630) |
| `square` | 2160×2160 | 1:1 feed posts |
| `portrait` | 2160×2700 | 4:5 — the tallest an Instagram feed post may be |
| `story` | 2160×3840 | 9:16 — stories, Reels, Shorts |

Every preset holds its **short** edge at 2160, so the same capture carries the
same detail whichever frame it lands in. The window takes the region's own
shape and is fitted into the canvas on whichever axis binds first, so a wide
region in a 9:16 frame letterboxes rather than being cropped.

### Already have the screenshot?

```bash
pnpm render:still <name> --from screenshot.png --all
```

Skips the capture and frames an image you already have. The sidecar is written
from the file's real dimensions, so the upscale warning stays honest — a
2832px-wide screenshot in a 3840px canvas is stretched about 1.1x. Shoot it with
`pnpm shot` instead when you want native pixels.

### Resolution

`deviceScaleFactor` can only be set when the browser context is created, so the
capture runs once at 2×, measures what the region actually came out to, and
re-runs at a higher factor if it fell short of what the biggest preset — or the
look's `fit` — will ask for. Set `scale` in the spec once a shot is settled to
skip the second pass.

The ceiling is a **surface budget**, not a number: 1920×1080 at 4× (33
megapixels) is where Chromium was measured to still rasterise cleanly, and that
is the budget. A 1920×1080 viewport therefore stops at 4×; a tablet-shaped
820×1180 page reaches 5.8×, which is what lets a 260 CSS px popover fill a
frame at native pixels. Past the budget you get a warning, never a quiet
upscale — shoot a larger region, or a smaller viewport.

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
 Remotion    ──►  out/demo/<name>.mp4
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
arrived.

The default CDP capture no longer depends on the marker: every frame carries
its compositor swap time, so the head trim is exact, and the marker is read
only as a cross-check (a disagreement over 100 ms prints a warning and trusts
the marker). Reading the marker needs a **system ffmpeg** — Remotion's bundled
build has no `signalstats` — so without one a CDP shoot still syncs, just
unchecked. The `DEMO_CAPTURE=playwright` fallback has no timestamps; without
system ffmpeg it falls back to the old estimate and prints a loud warning.

### Knobs

All optional. Each one's reasoning and measurements live beside the constant it
controls, not here. `.env.example` lists them with a line each.

**Rendering**

| Var | Default | Does | Measured in |
| --- | --- | --- | --- |
| `DEMO_GL` | `angle` | Chromium's rasteriser, and the biggest lever here — `angle` is the real GPU, worth **roughly 10×** (a 23s demo renders in 2-3 min instead of 24). `swiftshader` is the no-GPU fallback — it works everywhere, but it is software too, so expect roughly the un-accelerated time | [`scripts/render.ts`](scripts/render.ts) |
| `DEMO_SPEED` | `1.25` | Playback rate vs the shoot. `1` is realtime | [`src/lib/click-log.ts`](src/lib/click-log.ts) |
| `DEMO_CONCURRENCY` | Remotion's own | Frames rendered in parallel. Leave it unset — 6 workers measured 33% *slower* than the default. `1` is useful for debugging a render | [`scripts/lib/remotion.ts`](scripts/lib/remotion.ts) |
| `DEMO_BACKDROP` | `glaze` | Backdrop for every render that does not name one — demos, and stills whose shot sets none. A render's own `--backdrop=`/`ground` still wins | [`src/lib/backdrop.ts`](src/lib/backdrop.ts) |
| `DEMO_PRESET` | `wide` | Default still preset, when none is given on the command line | [`src/lib/still.ts`](src/lib/still.ts) |

**Recording**

| Var | Default | Does | Measured in |
| --- | --- | --- | --- |
| `APP_BASE_URL` | — | The app to sign in to (`capture:session`, required) and the start URL for any flow or shot that names none | [`.env.example`](.env.example) |
| `DEMO_URL_<NAME>` | — | A flow's start URL, kept out of the repo because it embeds account ids | [`.env.example`](.env.example) |
| `HEADED` / `HEADLESS` | headless | `HEADED=1` (or `HEADLESS=0`) shows the browser, in every recorder — see [Recording your own app](#recording-your-own-app) | [`scripts/lib/session.ts`](scripts/lib/session.ts) |
| `CAPTURE_SCALE` | `2` (max 4) | Record at this multiple of the flow's viewport while the app lays out at its own size — sharper footage. A capture too narrow for full zoom is refused unless `DEMO_ALLOW_SOFT_CAPTURE=1`. Agenta automation flows need `1` for now — see [Capture](#capture) | [`scripts/lib/capture-scale.ts`](scripts/lib/capture-scale.ts) |
| `DEMO_CAPTURE` | `cdp` | Capture path: lossless compositor frames on their own timestamps. `playwright` falls back to Playwright's 25fps 1 Mbps VP8 | [`scripts/lib/screencast.ts`](scripts/lib/screencast.ts) |
| `DEMO_CAPTURE_FPS` | `60` | Frame rate of the CDP intermediate. `DEMO_KEEP_FRAMES=1` keeps its raw PNGs | [`scripts/lib/screencast.ts`](scripts/lib/screencast.ts) |
| `DEMO_BAKED_CURSOR` | off | `1` draws the legacy in-page pointer into the footage instead of Remotion's vector cursor — for debugging what the browser actually did | [`scripts/lib/recorder.ts`](scripts/lib/recorder.ts) |
| `DEMO_TOUR` | off | `capture` records your own clicks to `tours/<name>.json`; `replay` shoots them. `pnpm record` only; `DEMO_TOUR_URL` sets the start page | [`scripts/record-demo.ts`](scripts/record-demo.ts) |

`REQUIRE_BROWSER=1` makes the browser-backed unit tests fail instead of skip
when Chromium is missing — for CI.

## Layout

| Path | Role |
| --- | --- |
| `flows/` | One file per demo. Only the generic ones are committed — see below |
| `scripts/` | Recorders, converter, renderer, analyzer |
| `scripts/lib/` | Cursor, flow helpers, selector ladder, session, batch |
| `scripts/lib/motion-metrics.ts` | The pure measurements behind `pnpm analyze` (camera motion, jerk, sharpness) |
| `src/lib/click-log.ts` | Shared types + all camera timing constants |
| `src/lib/camera.ts` | Pose interpolator + distance-aware durations |
| `src/lib/zoom.ts` | Keyframe track + region framing |
| `src/lib/demo-duration.ts` | How many frames a demo runs, sized from the camera track |
| `src/DemoClip.tsx` | Studio frame, camera, shuttered motion blur |
| `src/Backdrop.tsx` · `src/lib/backdrop.ts` | The studio backdrop every composition draws on; `resolveGround` picks the ground (image, flat colour, transparent) |
| `src/ShutterBlur.tsx` | The motion blur: a shutter centred on the frame (`src/lib/shutter.ts`) |
| `src/Cursor.tsx` | The vector pointer, drawn from the click log's cursor track |
| `src/KeycapHUD.tsx` | On-screen keycap pill, the pointer's stand-in in full-bleed footage |
| `src/Intro.tsx` | Title-card composition (no motion blur) |
| `src/RecapCard.tsx` | The recap card: the feature list and logo lockup that close a reel |
| `src/HudOverlay.tsx` · `src/ChipOverlay.tsx` | Reel overlays on a transparent ground, composited over the whole film (`src/lib/hud.ts`, `src/lib/chips.ts`) |
| `src/StillShot.tsx` | Still composition: a captured region on a preset canvas |
| `src/WindowFrame.tsx` | The floating window and its rim light, shared by both |
| `src/lib/still.ts` | Social presets + window-fit geometry |
| `shots/` | One file per still (`defineShot`) — only the example is committed |
| `src/lib/intro.ts` | Storyboard type + card timing |
| `intros/` | One title card per demo (`defineIntro`) — only the example is committed |
| `reels/` | Narrative cuts: cards + clip ranges (`defineReel`) |
| `src/lib/reel.ts` | Reel segment types + clip-range arithmetic |
| `src/lib/style.ts` | Choreography styles — the named motion grammars a reel is cut in |
| `src/lib/look.ts` | `framed` vs `fullbleed`: how a reel treats footage and cards |
| `docs/reel/` | Reference films taken apart, and the design records behind each style |
| `public/backdrops/` | The studio backdrops (committed design assets) |
| `src/lib/backdrop.ts` | Backdrop names + light/dark elevation |
| `.agents/skills/` | Agent-readable pipeline docs |

**What is not committed.** `out/`, `recordings/`, `public/*.mp4`,
`public/*.clicks.json`, `public/shots/` and `tours/*.json` are all regenerated
by the pipeline.
Demo flows written against a private workspace are ignored too — they hardcode
one account's URLs, agent names and data-specific selectors, so they would not
run for anyone else. The engine is the open-source part; your demos stay yours.
`flows/smoke.ts`, `flows/google-search.ts` and `flows/skillsmp-search.ts` are
committed because they are deliberately generic. `intros/` follows the same
rule for the same reason — a title card names that account's product — with
`intros/smoke.ts` committed as the worked example, and `shots/` likewise.

## Reference

Deeper pipeline notes, in the agent-readable versions — one per feature:
**[`shoot-demo-video`](.agents/skills/shoot-demo-video/SKILL.md)** (footage),
**[`intro-reel`](.agents/skills/intro-reel/SKILL.md)** (the cut film),
**[`shoot-still`](.agents/skills/shoot-still/SKILL.md)** (a photograph of one panel).

Most non-obvious constants carry their measurement in a comment beside them —
why the backdrop is a baked image rather than a CSS gradient, why a soft gradient
must not live inside the motion blur (`ShutterBlur`), why the output is 2560 and not 4K. If a
number looks arbitrary, the reason is usually one scroll away.

## License

MIT — see [LICENSE](LICENSE).
