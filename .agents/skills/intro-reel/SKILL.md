---
name: intro-reel
description: Make a ~15s launch-film intro for a product feature on any platform — title cards that narrate, real product clips that prove, a logo sign-off. Use when asked to create an intro, reel, or launch video for a feature.
metadata:
  tags: remotion, playwright, video, intro, reel
---

# Make an intro reel

**This is one of three features. A reel is cut FROM a demo, so the demo must be
rendered first** (`.agents/skills/shoot-demo-video/SKILL.md`). A still image of
part of the screen is a *still* (`.agents/skills/shoot-still/SKILL.md`). See the
table in `AGENTS.md`.

Driven by Playwright's Chromium, launched by these scripts — not your own
browser. First time on this machine: `pnpm exec playwright install --with-deps
chromium`.

A reel is **cards + clips**: title cards narrate in a few words what the next
clip is about to show, the clip proves it, a logo signs off. ~15s, 6-ish beats.

```
card → card → card → CLIP → card(dark) → logo      reels/<name>.ts
light narration        proof   payoff     sign-off
```

Build it in this order. Do not skip the script.

## 1. Script first

Write every card before shooting anything. Per card:

- **One claim.** Active verb, concrete noun. Specific beats adjectives. No hype
  ("revolutionary", "game-changer", "seamless").
- **Match the footage.** Never claim what the clip contradicts — copy that says
  "no mouse" over a clip that clicks a menu reads as a lie. Write the card to
  what the pointer actually does.
- **Length depends on the style** (§3 — pick it before you write). *classic*
  runs 96px type: **4–6 words**, read in ~1.5s, with the hero word marked
  `==like this==` because headlines are normal weight. *proof* runs 72px (cap
  height 52px on an 86px line pitch): **7–15 words**, full explanatory
  sentences, and **no emphasis markup at all** — measured, the reference's five
  cards use one ink at one weight throughout, and a 4-word card fills only ~41%
  of frame width where its cards fill 63–78%. *ledger* (98px) also drops
  emphasis but lets card length follow the copy; *stage* (82px, typed a
  character at a time) keeps emphasis — its closing card is built around a pill.
- Card before a clip = what it shows. Card after = the payoff it earned.

## 2. Shoot the clips

A clip is a **flow** driving the real product on the live platform — camera is
derived from the clicks, never hand-authored.

- `flows/<name>.ts` + `<name>.selectors.ts`. Target by role/text/placeholder,
  never generated ids. Verify with `record:live <name> --check` before shooting.
- **`prepare` must reset to a clean pre-demo state AND verify it — then fail
  loud.** Leftover state (an old row, stale text) silently wrecks the story. A
  `prepare` that reports success over a dirty state is worse than a crash.
- Enter the clip **on the action**; end it **before the camera pulls back**.
- Shoot beats are deterministic — a re-shoot lands within ~0.03s, so tuned clip
  ranges survive re-shooting.

Camera controls (opt-in, per beat), only when the default auto-zoom is wrong:

| Need | Control |
| --- | --- |
| Crop tight on a WIDE target (auto-zoom pulls back from it) | `zoomScale` |
| A slow, felt pointer move | `travelMs` |
| Dwell on a row before clicking | `hoverMs` |
| Hover a row without clicking (browse) | `focus` step |
| Frame X while the click hits Y | `frame` |
| Life inside a long static hold | `drift` |

### Choreography — the cursor's path is the clip

The life of a clip is where the pointer goes, not just the zoom. Compose the
path like a person deciding, not a script hitting one target:

- **Browse before you commit.** Visit a row, hover it, then move to the one you
  act on — `focus` hovers without clicking, `hoverMs` dwells before a real
  click. A pointer that darts straight to the answer reads as automated.
- **Slow the hops.** `travelMs` draws each short move out so the motion is felt;
  the default dart is too fast to read as intent.
- **Keep the whole interaction in ONE zoom cluster.** Same `cluster` id, and
  `zoomScale` on EVERY beat in it — miss one and the camera relaxes back out
  between rows. The zoom arrives WITH the first move (a `focus` places the
  keyframe as the pointer climbs), so it reads "act, then zoom in on the cursor"
  rather than a cut to a pre-zoomed frame.
- A menu interaction is a chain: open → hover A → move to B and click → (submenu
  opens) → move to C and click. Each hop is a slow move plus a dwell, and the
  chain ends on the last click, before the camera trails back.

## 3. Cut the reel

### Pick a style

`style` on the reel names the whole grammar — how cards write on and leave, how
footage is framed, whether there is a window, a camera, a cursor ripple, a
dissolve. Every number in a preset is measured off a reference film
(`src/lib/style.ts`, `docs/reel/`); CATALOG.md shows each one as pictures.
**Absent, a reel is cut in `proof`.**

| style | footage | cards | pick it when |
| --- | --- | --- | --- |
| `classic` | window on a backdrop, chrome, click-driven zoom camera | hold 1.2s, leave on a 4% scale ramp | the old framed film; the product needs its window |
| `proof` (default) | full-bleed, no window, no camera; you author `crop` + `push` per clip | cut in mid-reveal, 2.07s hold after the last word, 3.2–3.3s each | a metronomic launch film (Cursor "Agent UX improvements") |
| `ledger` | full-bleed (`isolate` framing), static crop, 6-frame dissolves | still, length follows the copy | calmer, longer shots of one panel (monid) |
| `stage` | windowed panel on flat cream, no zoom, scale-in / cut mid-exit | flat ground, typed per character, 0.6s hold | a panel that floats and leaves on motion (Replit) |

A card may set its own `style` to differ from the reel's.

**`look` is legacy.** It predates styles and is only read when `style` is
absent: `look: "framed"` resolves to `classic`, `look: "fullbleed"` to `proof`.
Write `style` in new reels. The one rejected pair is `style: "classic"` with
`look: "fullbleed"`. The default used to be `classic`; a reel that names neither
field changed film when it moved, so pin `style` on any reel that must not.

### Cut

- **Pick a tonal strategy and hold it.** Two work, measured; mixing them does not.
  - *Matched*: `light` for a light-theme app, `plain` (dark) for the
    sign-off, keeping one dark passage before the close for punctuation. A dark
    card over light footage makes that cut a ~157-level luma slam; a light card
    lands it at ~50.
  - *Slam* (`proof`'s grammar): dark cards against light footage at **every**
    cut. The reference film for this grammar runs ~200-level deltas nine times in
    44s and is the better film for it — the tonal ping-pong IS the structure.
    It only works at a metronomic cut rate; one dark card dropped into an
    otherwise light reel still reads as an accident. See
    `docs/reel/design/fullbleed.md`.
- **Cut on motion**, not stillness — the picture should be moving on both sides
  of a cut. A cut onto a frozen card reads as the film stalling.
- Cards: `background`, `headline` (with markup), `wordmark`, `holdS`, optional
  `chip` (a live control the camera punches into) or `logo` (brand sign-off).
- Logo sign-off: extract the brand mark to a **transparent** PNG (colour-key the
  dark bg), `logo: true`, horizontal lockup, wordmark writes in.
- Recap card: `items: ["Feature A", "Feature B"]` turns the card into a
  left-aligned summary — `headline` becomes the wordmark beside the mark, and
  the items reveal one every 16 frames.

### Framing full-bleed clips (`proof`, `ledger`)

Under the full-bleed styles you author each clip's framing yourself, because
nothing in the click log predicts which component matters. `crop` is ignored
by the windowed styles (`classic`, `stage`). `ledger` and `stage` carry their
motion on the shots and supply every clip's arrival themselves; an authored
`push` overrides it, so leave `push` off there unless you mean to:

```ts
{ clip: { fromS: 1.8, toS: 6.2,
          crop: { k: 1.28, cx: 0.5, cy: 0.5, dx: -0.14 },   // pan, barely magnify
          push: { in:  { axis: "x", dist: 114,  frames: 15 },
                  out: { axis: "x", dist: -208, frames: 13 } } } }
```

**Frame by PANNING, not by magnifying, and never let the footage stop filling
the frame.** `dx`/`dy` drop the parts of the page that are not the story off the
edges while `k` stays near 1. Full-bleed means edge to edge — the moment a shot
becomes a component floating on a mat, it is a slide, not a film.

There is a second spelling, `crop: { rect, fill }`, that names a component's box
and derives the scale so it fills the frame with nothing else in shot. **It is
Film B's grammar and it is not the default.** Cut both ways and measured, it won
every number on this repo's harness reel — drawer 32% → 65% of frame width, UI
text 12.8px → 30.8px against the reference's 30px — and lost badly on the
picture: the component came out of its page onto a flat grey mat covering half
the frame, the clip edge sliced the model list mid-glyph, and the magnification
cost 1.73x of upscale. Use it only when the component genuinely is the shot AND
was captured at a size that supports it.

**Small UI text is a CAPTURE problem, not a framing problem.** If the product's
text is rendering too small in frame, the answer is a bigger `CAPTURE_SCALE`,
not a tighter crop. `pnpm reel` prints what each framing asks for
(`framing -> 0.85x source->output`); past `SHARPNESS_CEILING` (1.74) you are
blowing pixels up. A component that is 25% of the viewport needs
`CAPTURE_SCALE=3` before it can fill 85% of frame at 1:1.

**Hold one shot dead still, before the recap.** `freeze: true` on a clip holds
its range's LAST frame for the range's length, with no pointer. The reference
gives exactly one shot in eleven this treatment, at 95 frames, and it is what
stops a metronomic cut rate reading as a conveyor belt. A frozen shot may
overlap the range of the clip before it — it does not play, so it cannot read as
a jump cut backwards — but it may not hold a state that clip had already passed.

**Bookends run LIGHT.** `background: "light"` on the logo cards, which under
`proof` is the reference's warm `#edece5`. This is structure, not taste: a
reel goes `logo · card · clip · card · … · recap · logo`, cards and recap are
dark and clips are light, so dark bookends make the logo->card and recap->logo
cuts vanish — measured at 2 and 1 levels of luma step where every other cut is
~190.

**The lockup is ONE ROW** — mark and wordmark side by side, one size. The
reference stacks its bookend vertically (mark over name over a third line
carrying a URL) and that was reproduced here to within half a point of its
measurements: 41.9% of frame width by 33.5% of height against 41.4% x 33.0%. It
was still worse, and got taken back out. Matching a measurement is not the same
as matching the film — a light-coloured mark stranded above the name has nothing
holding it there, and a URL under a wordmark reads as a slide footer.

One thing to check if your mark is light-coloured: it will have almost no
luminance contrast on a light ground. Ours measures nine levels against the
reference's 227, which costs the mark's tumble most of its read. A mono/dark
variant for light grounds is the fix.

- **Keep the pointer unless the feature really is keyboard-driven.** The
  reference has no cursor because *its* feature is keyboard-first; a mouse-driven
  flow rendered with the pointer hidden reads as the UI reacting to nothing. Set
  `cursor: true` on the clip. "Match the footage" applies to the chrome too.

## 4. Verify against a reference

Measure, don't eyeball. Against a reference launch film, compare: **% moving
frames**, **cut luma delta**, **mean shot length**, **longest frozen run**. Pull
frames with ffprobe and look. Fix the gap, re-measure.

**Measure stillness by COUNTING CHANGED PIXELS, not by averaging the
difference.** Three metrics are wrong, all measured:

- *Differencing after a downscale* amplifies dither. It reported 86% moving on a
  card that is provably still.
- *YMAX* (peak per-frame change) is dominated by outliers. One stray pixel marks
  a whole frame as moving, so the reference film itself scores 90% "moving".
- *YAVG* (mean absolute difference) — **what this section used to prescribe** —
  is amplitude-based and therefore NOT bitrate-invariant. It scores a noisier
  encode as "moving" on content that is provably static. Measured: our 2560x1440
  CRF-16 reel read **52%** moving against the 1920x1080 reference's **28%** on
  comparable content, and on the worst card no pixel changed by more than 6
  levels between adjacent frames — the entire signal was diffuse encoder noise.
  It sent a real investigation chasing a defect that did not exist.

What works: threshold EACH PIXEL first, then count. A frame is moving when more
than **0.2% of its pixels** change by more than **8/255**. Per-pixel thresholding
discards the low-amplitude noise floor that YAVG integrates, so the score
depends on the picture and not on the encoder.

```
ffmpeg -i reel.mp4 -vf "tblend=all_mode=difference,format=gray,\
  geq=lum='if(gt(lum(X\,Y)\,8)\,255\,0)',scale=128:72:flags=area" \
  -f rawvideo -pix_fmt gray - | \
# then: per 128x72 block, frac = sum(bytes)/(255*128*72); moving when frac > 0.002
# and: % of frames (excluding cut frames) with frac > 0.002
```

Calibration, all three films through the identical chain:

| film | encode | moving (excl. cuts) | longest still run |
| --- | --- | --- | --- |
| reference "Agent UX improvements" | 1080p 736k | **24.1%** | 110 f |
| reference "Origin / Code Hosting" | 1080p 838k | 36.8% | 75 f |
| our `harness.mp4` | 1440p 502k | 19.8% | 86 f |

The first row independently reproduces the 111-frame still run recorded in
`docs/reel/design/fullbleed.md`, which is what tells you the metric is sound.

**Its blind spot: one small element animating on an otherwise empty card.** The
0.2% floor is set for full-frame motion — footage, and cards that push. A logo
mark is ~0.4% of the frame, so a mark that turns, scales and rises can score
*below* the floor and read as "still". Measured on our own sign-off card: every
frame from 0 to 27 carries real change (0.0006–0.0029) and it falls to exactly
zero at frame 28 where the animation ends, yet the card scores 3% moving. Do not
use this number to decide whether a **bookend** is alive; look at the frames, or
measure the element's own bounding box. It answers "is the film restless", not
"is this element animating".

Targets from the full-bleed reference, if you are cutting `proof`:
mean shot **3.2-4.0s**, cut rate **~15/min**, moving frames **<= 25%**, last word
at cut **-62 frames**, dissolves **zero**.

## Commands

```
pnpm capture:session          # once — auth the live platform (headed)
pnpm record:live <flow>       # shoot   → recordings + clicks.json
pnpm convert <flow>           # webm → public/<flow>.mp4
pnpm render <flow>            # → out/demo/<flow>.mp4
pnpm reel <name>              # cut cards+clips → out/reel/<name>.mp4
pnpm reel <name> --check      # resolve + report, render nothing (seconds)
pnpm reel <name> --style=X    # same cut in another grammar → out/reel/<name>.X.mp4
pnpm intro <name>             # one title card → out/reel/<name>.intro.mp4
```

`--check` prints every segment's reel and demo range, its length and moves,
then runtime, mean shot and cut rate against the style's `targets`, clip/card
share and every SFX hit. Run it before every render. Under `--style=`, clip
fields the new framing ignores are warnings, not errors.

Reel-level: `style` ("classic" | "proof" | "ledger" | "stage"; default
`proof`), `demo` (the demo the clips come from; default the reel's `name` — so
one demo can be cut into several reels without copying footage), `audio`,
`sfx`, `duck`, `loudnessLUFS`, `hud`, `chips`. `look` ("framed" | "fullbleed")
is legacy — read only when `style` is absent.

Clip ranges: plain seconds (`fromS`/`toS`, demo time) or BEAT ANCHORS into the
demo's click log, which survive a re-shoot:

```ts
{ clip: { fromBeat: "Add provider", leadS: -0.4, toBeat: "Save", tailS: 0.3 } }
```

A beat sits on its press, on the demo clock (playback speed applied).
`leadS`/`tailS` are signed offsets; without `toBeat` the end is `fromBeat` +
`tailS`. Labels match exactly, ignoring case; a repeated label is ambiguous —
name one with `"open cadence#2"`. A clip field the style's framing ignores
(`crop`/`pageBg`/`freeze` under a windowed style, `drift` without the zoom
camera) is an error that names the field and the style.

Card exits and entrances are sequenced by the style (`sequence` in the preset:
an exit cycle and direction continuity); an authored `enter`/`exit`/`push`
always wins.

Cards author as JSON or TS (`intros/<name>.json` | reel cards). Markup:
`*bold*` `_italic_` `==highlight==` `==word|#hex==` `{chip}`.

## Gotchas

- **Sharpness ceiling — set by the CAPTURE, not by the crop.** At a 1x shoot the
  recording is ~1920px, output is 2560, and any crop multiplies that 1.33x: past
  ~1.74× total, text softens. Shoot `CAPTURE_SCALE=2` and the ceiling moves to
  k≈1.5 with nothing upscaled at all. Measured on the same text region of the
  same clip, 1x shoot vs 2x: **+40% edge energy**. "As tight as stays sharp" —
  and shoot HD so that is tighter.
- **Cache invalidation.** A re-shoot must re-hash the footage into the clip
  cache, or you cut the old footage under the new spec.
- **Clip length.** A clip earns its seconds with action. Trim menu-read holds
  and post-click dead air; keep the beats that move.
