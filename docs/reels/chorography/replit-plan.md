# Bringing the Replit choreography into this repo

Plan for a new style, `stage`, implementing the grammar measured in
[`replit.md`](./replit.md). Written against the code as it stands, and
fact-checked in §5 — several assumptions I started with turned out to be wrong.

**Constraint that shapes everything: the default pipeline must not change.**
`DEFAULT_STYLE` stays `classic`; `classic`, `proof` and `narration` must render
identically after this lands.

---

## 1. The name

**`stage`.** The grammar is a fixed ground that elements enter and leave — a
stage, not a cut sequence. Checked free of collisions: it is not a backdrop name
(`BACKDROPS` has `studio`, which is why an earlier style could not be called
that), and `style.test.ts` asserts a style name appears nowhere but `style.ts`.

---

## 2. What we already have

This is most of it, and it is the reason this is a small change rather than a
new renderer.

| Replit needs | We have | Evidence |
| --- | --- | --- |
| Arrive decelerating → hold → accelerate away → leave frame mid-move | `src/lib/push.ts` — its docstring describes exactly this three-part envelope | `pushEnvelope`, `cutsMidMove` |
| One curve, entrance mirrored into exit | `PUSH_BEZIER`, and push.ts already documents "the same curve, time-reversed" | §5.1 — the numbers match |
| Panel floating on a ground with radius + soft shadow | `WindowFrame` with `chrome: false`; `WINDOW_RADIUS = 14`; `RimLight` **already casts a soft dark shadow on light backdrops** | `src/WindowFrame.tsx:72-74` |
| Inline coloured pill inside a sentence | `==built-in\|#F03000==` → `wordCss` renders a pill with auto-readable ink | `src/Intro.tsx:114-123` |
| Per-character reveal | `LogoLockup` already writes the wordmark one character at a time | `src/Intro.tsx:254` |
| Seams with no visible cut | `join: "cut"` landing on a frame where both sides show bare ground | no new mechanism |

## 3. What has to be built

Four things, ranked by risk.

### 3.1 A flat-colour ground (low risk, required)

`BACKDROPS` are **image files**. Replit's ground is one flat warm cream and
never changes. Add a preset field so a style can name a colour instead of an
image, defaulting to today's behaviour so no existing reel moves.

Shape: `ShotStyle.ground: string | null` — `null` (every existing style) means
"use the backdrop image"; a hex means fill flat. `DemoClip` reads the field.

### 3.2 Full-exit push distances (low risk, required)

`PushMove.dist` is in design pixels (1920 space) and existing values are small
(72–114). Replit's elements **leave the frame entirely** — MEASURED 391 px of
travel at 720p in 0.375 s, still accelerating on the last frame in shot.

No mechanism change; `stage` just carries a much larger `dist`. §5.3 confirms
nothing clamps it.

### 3.3 A `typed` word cadence (medium risk, required)

`WordCadence` is a discriminated union of `fixed` and `fitted`. Add a third:

```ts
| { kind: "typed"; perCharS: number }
```

MEASURED at 1 character per 2 frames = **83 ms** at 24 fps.

This is the one change inside the shared card path — `wordSchedule` emits one
cue per *token*, and a typewriter needs one per *character*. It is additive: no
existing preset names `typed`, so `fixed`/`fitted` behaviour is untouched. The
guard is `introDurationInFrames`, which feeds `Root.tsx`; §5.4.

### 3.4 Palette, type scale and face (low risk, required)

- Ground `#FAF6F1`, ink near-black, accent `#F03000`.
- Cap 58.5 px at 1080p → `sizePx ≈ 82` at a 0.715 cap ratio.
- **No line pitch is measured** — the reference's only type card is one line
  and never wraps. Carry a pitch and mark it as unmeasured, do not invent one
  and call it MEASURED.

---

## 4. What I am deliberately leaving out

Recorded so it is a decision rather than an omission.

**Floating annotation chips over the panel** (*Scanning 20%*, *Recon*, *Auth*,
*Fuzzing*, *Response Analysis*). These are authored overlay elements pinned to
panel edges with their own entrances. We have no per-beat overlay concept — the
nearest thing is the step HUD, which is one centred line derived from the click
log, not several positioned chips. Building this properly is its own feature.
**It is the single most visible thing `stage` will be missing**, and §7 of the
comparison should say so rather than let it read as a defect.

**The isometric cubes and the code/website composition.** Almost certainly
authored artwork, not screen recording. Nothing in a screen-recording pipeline
reaches them. Out of scope permanently, not just for v1.

**24 fps.** The pipeline is 30 fps and moving it touches every reel and every
cached segment. The curve is specified in seconds and resamples cleanly; §5.1
shows our existing bezier already lands on Replit's ratio at 30 fps.

**No SFX.** MEASURED: the reference marks none of its clicks with audio. `stage`
reels carry a bed and nothing else. This costs us nothing to implement — it is a
reel-level choice — but it must be written down or the next author will add
clicks back out of habit.

---

## 5. Fact-check

Each claim above, re-derived against the code rather than assumed.

### 5.1 Does our easing actually match theirs? — **YES**

Replit MEASURED `r = 0.6451`/frame at 24 fps. Resampled: `0.6451^(24/30) =`
**`0.7042`** per frame at 30 fps.

`PUSH_BEZIER = Easing.bezier(0.15, 0.9, 0.75, 0.95)`, evaluated numerically:

| push length | geometric-mean r |
| --- | --- |
| 9 frames | 0.6940 |
| 11 frames | 0.7413 |
| 15 frames | 0.8023 |

**Our curve at 9–11 frames straddles their 0.7042.** No new easing function.

**Decision: `frames: 11`.** Replit's settle MEASURES 0.372 s; 11 frames at
30 fps is 0.367 s, a 1.4% miss on duration, against a 5% miss on the decay
ratio. Duration is the visible one. Recorded in `note.md` as D5.

### 5.2 Does `WindowFrame` really shadow on a light ground? — **YES, and it was built for exactly this**

`src/WindowFrame.tsx:72-74`: *"On a LIGHT backdrop the white lift below has
nothing to be brighter than… Cast a soft dark shadow instead."* Replit's shadow
MEASURES 12 px wide peaking at 3.5% darkening — soft and barely-there, which is
what a rim-replacement shadow is.

Open question, to settle at render time: our light-backdrop shadow was tuned
against `chalk`/`mist` *images*, not a flat fill. If it reads too heavy on flat
cream I will expose its opacity as a preset field rather than editing the
constant, so `classic` cannot move.

### 5.3 Is `dist` clamped anywhere? — **NO**

`PushMove.dist` is documented as "travel, in DESIGN pixels for x/y … or a scale
delta". `pushToCss` multiplies by the design scale and emits a transform. There
is no ceiling. A `dist` large enough to clear the frame is legal.

### 5.4 What does a `typed` cadence put at risk? — `introDurationInFrames`

`introTiming` computes card length from where the copy lands, and
`introDurationInFrames` feeds `src/Root.tsx`. Get it wrong and Studio and the
renderer disagree about composition length, which **does not fail loudly** —
this is the documented blast radius from the original choreography plan.

Mitigation: the union makes `typed` unreachable from the other three presets, and
the existing `introTiming` equivalence tests already assert that `classic` and
`proof` timings are unchanged. Those tests are the acceptance gate.

### 5.5 Was `framing: "window"` the right call over `isolate`? — **YES**

`isolate` clips the footage to a rect and fills the rest with `pageBg`, giving a
component on a flat mat with **no radius and no shadow**. `crop.ts` also records
that the isolated cut of harness was measured and *rejected* on how it looked.
Replit's panel has a radius, a shadow and the app's own surrounding surface
inside it — that is a window, not an isolation.

### 5.6 Correction to my own first pass

I initially assumed we would need a new easing function and a new panel
component. Both were wrong: `push.ts` and `WindowFrame` already implement the
grammar, and `push.ts`'s docstring describes Replit's envelope almost word for
word despite having been reverse-engineered from a Cursor film. **That two
unrelated launch films share this envelope is the strongest evidence in either
analysis that it is a house style of the genre, not one company's signature.**

---

## 6. Order of work

1. `stage` preset + `STYLES` entry, with `ground`, `typed` and the full-exit
   pushes as new preset data.
2. `ShotStyle.ground` → `DemoClip`.
3. `WordCadence.typed` → `wordSchedule` / `introTiming` / `Intro.tsx`.
4. Guard tests: `classic`/`proof`/`narration` timings and cache keys unchanged.
5. Write a fresh script and shoot it.
6. Render, then `compare-to-reference` against the Replit file.
7. Close gaps, re-compare, run the quality tests.
