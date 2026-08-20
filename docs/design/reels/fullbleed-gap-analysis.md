# Full-bleed: measured gap against the reference, and the fix plan

Side-by-side of our first real full-bleed reel (`out/reel/harness.mp4`) against
Cursor's "Agent UX improvements". Both films instrumented **identically**:
per-frame global dx/dy by 1-D profile SAD matching at 960x540, text bands by
raw grayscale decode, colours by 6x6 pixel samples. Ours is 2560x1440 and the
reference 1920x1080, so every figure below is normalised to **1920x1080 design
space**.

Companion to `fullbleed.md`, which holds the reference measurements themselves.

---

## 1. What already matches

**The push envelope is correct.** Per-frame displacement entering a footage
shot, in 960-wide analysis px:

```
reference  -16  -11   -7   -5   -4   -3   -3   -2   -2   -1   -1   -1   -1   -1    0
ours       -16   -9   -7   -5   -4   -3   -3   -2   -2   -1   -1   -1   -1   -1   -1    0
```

That is the same curve. `PUSH_BEZIER` and `settle()` do not need to change.

Also matching: ground `#08080a` vs `#090909`; centred horizontally and
vertically; max text column 78% of frame width; headline weight 400; hard cuts
with zero dissolves; cut luma deltas 147-206 against the reference's 180-205.

---

## 2. The gaps, measured

### 2.1 The opening is abrupt — this is the biggest one

Frames of continuous motion from frame 0:

| | motion frames | shape |
| --- | --- | --- |
| reference | **23** | dy -10, -12, -14, -8, -6, -6, -4, -4, -4, then a sustained **-2/frame for 14 more frames** |
| ours | **8** | dy -8, -4, -4, -2, -2, -2, -2, -2, then dead |

Two separate causes, and both matter:

1. **The reference opens on a LOGO card, we open on a sentence card.** Its shot 1
   is a layered animation — the mark scales 198->126px *and* rises cy 555->383
   while the cube spins in 3-D, with the title writing in over the top at f3, f7,
   f12. Ours is a single 56px block rise.
2. **The reference's opening never fully stops.** After the settle it keeps
   drifting at ~2px/frame for another half-second. Our `pushEnvelope` lands on
   exactly 0 and freezes. Note this is specific to the *logo* card — the
   reference's sentence cards (shot 2, f131-182) genuinely are dead still, so
   this is not a licence to add drift everywhere.

### 2.2 Typography is oversized and cramped

| property | reference | ours | delta |
| --- | ---: | ---: | --- |
| headline size | **~64px** | **96px** | **+50%** |
| line-height | 86-88px = **1.35** | **1.12** | **-17%** |
| letter-spacing | ~0 | **-0.022em** | tighter |
| ink on dark | **#E9EBE6** (warm off-white) | **#ffffff** | ours is the clipped extreme |
| glyph band (asc->desc) | 60-68px | — | consistent with ~64px |
| line pitch | 86-88px | 107px | — |

Measured from the source constants (`HEADLINE_SIZE`, `lineHeight: 1.12`,
`letterSpacing: "-0.022em"`, `DARK_LOOK.headline`) and confirmed against
rendered frames.

The size is why our cards feel shouty and hold so few words: at 96px a 78%-wide
column fits roughly 5 words per line, where the reference fits 7-8.

`DARK_GROUND` is deliberately `#08080a` rather than `#000` — the comment beside
it explains that one step off the extreme survives h264 better. The same
argument applies to the ink and was not carried through: `#fff` is the clipped
extreme the ground avoids.

### 2.3 The highlight is wrong for this look

**The reference uses no highlight anywhere.** Not a pill, not a colour, not a
weight change — across all five sentence cards every word is the same
`#E9EBE6` at the same weight. Emphasis comes from the sentence, not from
decoration.

Ours paints a saturated `#f4d35e` marker pill with `#101317` ink. On a near-black
ground that swatch is the highest-contrast object in the frame, so the eye lands
on the decoration before the words. It also renders **per word**, so a two-word
hero (`==API key==`) comes out as two pills with a gap.

The `==markup==` system is right for the *framed* look, where cards sit on a
photographic backdrop and need a hook. Under full-bleed it fights the language.

### 2.4 In-app motion collides with the settle

Our clip 1 settles at f112, then the app's own drawer slides in at f113-115 with
a **5% of frame width** jolt:

```
f110  -1    f113  -47
f111  -1    f114  +48   <- app drawer, not our camera
f112   0    f115  -32
```

The reference never does this. Its footage shots cut in on states that are
already settled, or time the cut so the app's own motion *is* the entrance. Ours
cuts in 0.45s before a click whose result animates.

### 2.5 No bookends

The reference opens and closes on the **same logo card asset** — frame-identical
for the first 34 frames, only the subhead differs ("Agent UX improvements" vs
"cursor.com/changelog"). It is the film's frame. We have neither end.

---

## 3. Fix plan

Ordered by ratio of perceived improvement to effort. Everything lands under
`look: "fullbleed"` only; the framed look must stay byte-identical.

**F1 — Full-bleed type scale.** New constants applied when `look` is
`"fullbleed"`: headline **72px** (was 64), line-height **1.194** (was 1.35 — see
the correction in fullbleed.md; same 86px pitch), letter-spacing **0**,
ink **#E9EBE6**. Framed keeps 96 / 1.12 / -0.022em / #fff.

**F2 — Drop the highlight under full-bleed.** `==word==` still parses (so copy is
portable between looks) but renders as plain ink — no pill, no colour shift.
Emphasis is the sentence's job. Add a `LOGO_CARD`/plain-text note to the skill so
authors stop reaching for it.

**F3 — Logo bookends.** A `logo: true` card at the head and tail, sharing one
asset and differing only in subhead, with the layered entrance the reference
uses: mark scales ~1.57 -> 1.0 and rises, title writes in word by word over it.
This is what actually fixes "their start is smoother".

**F4 — Residual drift on the opening card only.** After the settle, continue at
~2px/frame for ~14 frames. Scoped to the logo/opening card; sentence cards stay
dead still, which is what the reference measures.

**F5 — Cut clips on settled state.** Author clip `fromS` so the shot enters
*after* an in-app transition completes, or so the transition starts on frame 0
and reads as the entrance. Concretely for `harness`: move clip 1 from 1.70s to
~2.35s so the drawer slide is the entrance rather than a jolt 0.5s in.

**F6 — Card copy runs long under full-bleed.** A consequence of F1 found while
fixing it: at 64px a 4-word card fills ~41% of frame width against the
reference's 63-78%. Its cards are 7-15 words — full explanatory sentences, not
slogans. The skill's "4-6 words" rule was written for the framed look at 96px and
does not carry over.

**F7 — Component isolation (see section 4).**

---

## 4. Component isolation: why Storybook is not the answer

The reference frames one component at **84-93% of frame width**. We cap at
k≈1.28 before text softens. The reason is a capture-API asymmetry, measured:

- **`page.screenshot()` honours `deviceScaleFactor`** — a 1920x1080 viewport at
  DSF 2 really does produce a 3840x2160 PNG. This is why `pnpm shot` can crop a
  small region and still fill a 3840-wide still (`scripts/shoot-still.ts`).
- **`Page.startScreencast` ignores it** and emits CSS-viewport pixels
  (`DEVICE_SCALE_FACTOR` note in `src/lib/click-log.ts`, measured three times).

So video is capped at the CSS viewport, and **Storybook changes nothing** — the
bottleneck is how frames are captured, not what is on the page. Isolating the
component in Storybook would still be screencast-captured at CSS resolution.

Do the arithmetic before choosing. To fill 88% of a 2560-wide output sharply, a
component needs ~2250 native px. The harness drawer is ~480 CSS px:

| route | source px for the drawer | upscale to fill frame | verdict |
| --- | ---: | ---: | --- |
| today (1920 viewport, k=1.28) | 480 | — (we crop, not fill) | ships, but wide |
| `CAPTURE_SCALE=2` + vh counter-scale CSS | 960 | 2.35x | still soft |
| smaller CSS viewport (1000px) | 480 | 4.7x | worse — fewer pixels |
| **screenshot-sequence capture at DSF 4** | **1920** | **1.17x** | **sharp** |

`CAPTURE_SCALE=2` also currently fails on this app outright: the recorder
measured `overflow v=2`, the documented `vh`-shell failure. It would need
per-app counter-scaling CSS injected before it is even worth the 2x.

**Recommendation, in order:**

1. **Now:** ship wide. Frame at k≈1.0-1.3 and let the shot be "the app", which is
   what screencast supports. Apply F1-F5, which are free and fix more of the
   perceived gap than the crop does.
2. **Next, if close-ups are wanted:** add a **screenshot-sequence capture mode** —
   drive the flow as today, but capture `page.screenshot({ clip })` per frame at
   DSF 4 instead of recording a screencast, then assemble to mp4. It reuses the
   still pipeline's resolution advantage and its `locator.boundingBox()` region
   resolution, giving true component isolation at reference sharpness.
   **Cost, stated honestly:** capture is not realtime, so any app-driven
   animation (a drawer sliding, a spinner) will not render naturally — it suits
   flows whose beats are settled states, not flows whose story *is* the
   transition. Cursor's own shots are mostly settled states, which is part of why
   their crops work.
3. **Not worth it:** Storybook, and `CAPTURE_SCALE` on any `vh`-shelled app
   without counter-scaling CSS.
