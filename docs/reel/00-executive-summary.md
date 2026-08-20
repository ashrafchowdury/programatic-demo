# Executive summary

Two Cursor feature films were taken apart frame by frame — 2243 frames, 74.8
seconds — and measured against our own `out/reel/harness.mp4` through an
identical pipeline. This is what matters.

---

## 1. They are two grammars, not one style

| | **Film A** "Agent UX improvements" | **Film B** "Origin / Code Hosting" |
| --- | --- | --- |
| Job | prove shipped features work | introduce a product |
| Length | 43.87 s · 12 shots | 30.90 s · 17 shots |
| Cut rate | 15 /min | 31 /min |
| Motion | 24 % of frames | 37 % of frames |
| Footage | one recording, full-bleed, static crop | isolated components on flat ground |
| Motion lives on | the **cards** | the **shots** |
| Cut carried by | **contrast** (~200-level luma slam) | **motion** (shots start moving) |
| Audio | quiet bed, −31.3 LUFS | **silent** |

They share one easing curve, one word cadence, one type size, and zero
dissolves. Everything else is an opposed pair of choices.

**The load-bearing rule: motion lives on exactly one layer.** Film A's shots
never move, so its cards must. Film B's cards never move, so its shots must.
Animating both reads as busy; animating neither reads as a slideshow.

---

## 2. The five findings that change what we build

### There is not one dissolve in 74.8 seconds

All 27 shot boundaries across both films are **single-frame hard cuts** —
verified frame by frame. What replaces the dissolve is that **a shot may start
already in motion**: three places show an 8–24 frame eased luma ramp whose
first frame is also the first frame of a new shot. The camera is mid-move when
the cut lands. That is the entire transition system.

Our pipeline already concatenates with `-c copy` and has no `xfade`. Confirmed
correct against a second film.

### Opacity is not an animation channel

Nothing fades. Word reveals are **binary** — ink appears in a single frame.
Cards appear at full opacity. The only measured fade in either film is the
audio bed's 1.8 s head. Anything we build that ramps opacity is an invention.

### One curve, r ≈ 0.78 per frame

An exponential settle, τ ≈ 135–140 ms, drives every moving thing in both
films — card rises, window scale-ups, chip pull-backs. Three independent fits
in two films land within 0.03 of each other. This is already
`PUSH_BEZIER = Easing.bezier(0.15, 0.9, 0.75, 0.95)` in `src/lib/camera.ts:25`,
fitted at RMS 0.0054 during earlier work. **It is settled. Stop re-deriving it.**

Exits are the same curve time-reversed, still accelerating when the cut lands
— Film A's cards leave at 15 px on their final frame.

### Our stillness is already right — and the metric that said otherwise was broken

| | Film A | Film B | **Ours** |
| --- | --- | --- | --- |
| Moving frames (excl. cuts) | 24.1 % | 36.8 % | **19.8 %** |
| Longest still run | 110 f | 75 f | **86 f** |

Structurally we are dead on: mean shot 3.49 s vs 3.66 s, cut rate 14.3 vs 15.0,
cards at 96/96/94 frames against a 96 ± 1 reference — **and** we sit inside the
`≤ 25 %` motion target with room to spare.

An earlier pass of this analysis reported 52 % against the reference's 28 % and
called it our biggest defect. That was wrong, and instructively so: the
prescribed metric (`signalstats` YAVG, a *mean absolute difference*) is
amplitude-based, so it integrates encoder noise along with motion. Our 1440p
CRF-16 encode is noisier per pixel than the references' 1080p ones; on the
worst-scoring card **no pixel changed by more than 6 levels between adjacent
frames**. The card was static and the metric was measuring the compressor.

Counting thresholded pixels instead (> 0.2 % of pixels changing by > 8/255)
reproduces `fullbleed.md`'s independently-recorded 111-frame still run to within
one frame, and puts all three films on a comparable footing. `SKILL.md` §4 has
been corrected; see [02-motion.md](./02-motion.md#discrepancy--resolved-and-the-metric-was-the-bug).

### Our type was 12 % too small — fixed

We reproduced the reference's 86 px line pitch exactly, but not its size: 64 px
at a 1.35 line-height renders a **45.8 px** cap height where the reference
measures **51–52 px** on flat capitals. Held the pitch, grew the type:

```
FULLBLEED_HEADLINE_SIZE  64   →  72        // cap  72 × 0.715 = 51.5 px
FULLBLEED_LINE_HEIGHT    1.35 →  1.194     // pitch 72 × 1.194 = 86.0 px
```

Re-rendered and re-measured: **cap 51.0 px**, pitch unchanged. Side-effect: the
bigger glyphs re-wrap the harness copy and leave `feeds.` alone on a line — a
copy fix, not a code one.

Spec type by **cap height (52 px) and pitch (86 px)**, not by nominal
font-size — the nominal value depends on the face's cap ratio, and our
`FONT_STACK` resolves differently on different machines.

---

## 3. What we already have right

Recorded so it does not get "improved":

- The push envelope, card duration, word stagger, and the rigid 62-frame tail
  after the last word.
- The recap card — matches the reference's schedule to **1–3 frames on every
  interval**, and its item pitch to 1 px.
- `WINDOW_FIT 0.86` vs Film B's measured 86.0 %.
- `COLUMN_FRAC_FLAT 0.78` vs Film A's measured 77.7 %.
- No `spring()` anywhere — correct, the reference has no overshoot to model.
- ffmpeg concat rather than Remotion `<Series>`, for time-base reasons.
- 16 backdrops and a full audio system — **more** than either reference uses.

And our clapperboard trim means we would never ship Film A's own defect: two
frames of unpainted `#FAFAFA` at f431.

---

## 4. What we are missing

| Missing | Where it appears | Cost |
| --- | --- | --- |
| ~~Logo bookend cards with a 360° mark tumble~~ — **done** | both films | — |
| **Isolated component shots** — one UI element on flat ground | 5 of Film B's 17 shots | medium (`clipPath` route) |
| **Chip punch at reference values** — 7.8× in 3 f, not 4× in 13 f | Film B's spine | 3 constants |
| **Static-card mode** — cards that do not move at all | Film B's whole grammar | small |
| **Chip morph and in-place swap** | Film B | small |

The logo bookends are the largest gap by impact. They are what make a reel read
as a film rather than a sequence of clips, and the reference detail that makes
them work is the ground, not the motion: **bookends are LIGHT** (`#EDECE5`),
which is what keeps a film of the form `logo · card · clip · … · recap · logo`
alternating light/dark on every cut. All ten of Film A's cuts are a 209-240
level step; dark bookends make two of them vanish.

(An earlier version of this paragraph said the counter-intuitive detail was that
logo cards do not push out. That was a mis-measurement — see
[02-motion.md](./02-motion.md). The opening bookend rises 25 px into its cut like
every other shot.)

---

## 5. Two things to correct in existing docs

- **`docs/design/reels/fullbleed.md` open question "recap ground warmth"** —
  answered: `#16120D`, measurably warmer than the `#0A0A0A` sentence cards.
- **A measurement conflict — resolved in `fullbleed.md`'s favour.** That
  document's 21 % moving / 111 f still run was correct. The YAVG-based metric
  that `.agents/skills/intro-reel/SKILL.md` prescribed is not bitrate-invariant
  and inflated both the reference and our own reel. SKILL.md §4 now prescribes
  a per-pixel counting metric and records the calibration for all three films.

---

## 6. Reading order

- [01-timeline.md](./01-timeline.md) — frame-exact shot lists, pacing patterns
- [02-motion.md](./02-motion.md) — the curve, transitions, chip punch, audio
- [03-composition.md](./03-composition.md) — type metrics, colour, UI, cursor
- [04-design-system.md](./04-design-system.md) — invariants, scene graph, recipe
- [05-remotion-playwright.md](./05-remotion-playwright.md) — implementation mapping
- [06-comparison.md](./06-comparison.md) — full axis-by-axis comparison and a ranked change list
