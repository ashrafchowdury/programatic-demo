# Motion, transitions and easing

---

## Every boundary is a hard cut

MEASURED, both films, all 27 boundaries.

For each boundary the mean luma of the outgoing and incoming frames were read
frame by frame. A dissolve of length *n* produces *n* intermediate values. Every
boundary produced **zero** intermediates:

```
Film B, cut @ f118 (footage → white card), luma f114..f122:
  209  210  211  212 │ 235  235  235  235  235
                     └── one frame

Film B, cut @ f625 (component → black card), luma f621..f629:
  208  208  208  208 │  25   25   25   25   25

Film A, cut @ f194 (black card → footage), luma f190..f198:
   28   28   28   28 │ 231  231  231  231  231
```

**There is not one fade, dissolve, wipe, or crossfade in 74.8 seconds of
film.** Transitions are carried entirely by motion inside the shots.

Bitrate caveat: at 736–838 kbps a 1–2 % opacity ramp would be crushed by the
encoder. The honest statement is *no dissolve longer than one frame and deeper
than roughly 2 % is present*. For implementation purposes: cut.

### What looks like a fade but isn't

Three places show a smooth luma ramp lasting 8–24 frames:

| Where | Luma | What it actually is |
| --- | --- | --- |
| Film B f61–70 | 192 → 208 | Camera **zooming out** inside the shot after a hard cut |
| Film B f343–366 | 190 → 204 | The framed window **scaling up** into place |
| Film B f504–512 | 191 → 154 | Camera **pushing in** to the diff, starting on the cut |

In all three the first frame of the ramp is also the first frame of a new
shot. The shot **starts already in motion**. That is the mechanism that makes
these films feel continuous without dissolves, and it is the single most
transferable idea in this analysis.

---

## The one curve

Both films move everything with the same shape: an **exponential settle** —
large first step, each subsequent step a constant fraction of the last.

### Fit A — Film A, card text rise (shot 2, f99–f112)

Tracked the bottom edge of line 1. MEASURED.

| f | 99 | 100 | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | 111 | 112 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| y | 579 | 563 | 554 | 548 | 543 | 539 | 537 | 534 | 532 | 531 | 530 | 529 | 528 | 527 |
| Δ | . | −16 | −9 | −6 | −5 | −4 | −2 | −3 | −2 | −1 | −1 | −1 | −1 | −1 |

Travel **52 px over 13 frames**. Decay ratio from first to last step:
`(1/16)^(1/12) = 0.794`.

### Fit B — Film B, framed window scale-up (shot 9, f343–366)

Tracked window height at x = 960. MEASURED.

| f | 343 | 344 | 345 | 346 | 347 | 348 | 349 | 350 | 352 | 355 | 360 | 366 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h | 841 | 863 | 881 | 894 | 902 | 908 | 913 | 917 | 923 | 930 | 937 | 941 |
| Δ | . | +22 | +18 | +13 | +8 | +6 | +5 | +4 | +2 | +1 | ~0 | 0 |

Travel **841 → 941 px (×1.119) over 23 frames**; ratio over the first
9 steps `(2/22)^(1/9) = 0.766`.

### Fit C — Film B, chip punch pull-back (shot 5, f199–204)

| f | 199 | 200 | 201 | 202 | 203 | 204 |
| --- | --- | --- | --- | --- | --- | --- |
| Δh | . | −31 | −20 | −12 | −7 | −2 |

Ratio ≈ 0.62.

### Conclusion

**r ≈ 0.78 per frame at 30 fps, i.e. τ ≈ 135–140 ms.** Two independent
elements in two different films land within 0.03 of each other. Everything
that moves in these films moves on this curve. INFERRED as a single shared
implementation.

This is already `PUSH_BEZIER = Easing.bezier(0.15, 0.9, 0.75, 0.95)` in
`src/lib/camera.ts:25`, fitted at RMS 0.0054 during the full-bleed work. This
pass reproduces it from a second film. **The curve is settled — do not
re-derive it.**

Practical Remotion form:

```ts
// settle(u): 1 at u=0, 0 at u=1, exponential decay
const settle = (u: number) => 1 - PUSH_BEZIER(clamp01(u));
const y = distance * settle(framesElapsed / durationFrames);
```

Exits are the **same curve time-reversed**, which is why one function drives
both ends (`src/lib/push.ts:78`).

---

## Card entrance and exit

The two films disagree here, and the disagreement is the point.

### Film A — cards move

**Entrance** (MEASURED, shot 2):

```
opacity:   the card ground is present from frame 0; the text is not
translateY: +52 px → 0
duration:  13 frames (433 ms)
easing:    settle, r ≈ 0.79
```

The first frame of a card is **flat ground with stdev 0.0** — completely
empty. Text begins on the *second* frame. MEASURED at f98 and f583; cards at
f336 and f806 already carry ink on their first frame (stdev 14.5 and 10.5),
meaning those cards were cut into **mid-reveal** rather than at their head.
That is `TRIM_IN_S` (`src/lib/intro.ts:420`) and it is used inconsistently in
the reference too — 2 of 5 cards are trimmed.

**Exit** (MEASURED, shot 2, tracking a stable left stem):

| f | 179 | 180 | 182 | 184 | 186 | 188 | 189 | 190 | 191 | 192 | 193 | *cut* |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| x | 498 | 497 | 496 | 493 | 488 | 480 | 475 | 468 | 460 | 450 | 435 | — |
| Δ | . | −1 | −1 | −2 | −3 | −4 | −5 | −7 | −8 | −10 | **−15** | — |

Travel ≈ **63 px left over ~14 frames, still accelerating at the cut**. The
last frame before the cut is moving at 15 px/frame — the fastest frame of the
move is the frame you never fully see. That is what "cut on motion" means
mechanically, and it is why the cut doesn't register as a cut.

Ratio ≈ 1.35 per frame — the time-reverse of the 0.78 entrance. Current
`CARD_EXIT_DEFAULT = { axis: "x", dist: -72, frames: 13 }`
(`src/lib/intro.ts:524`) is a good match for the measured −63 px / 14 f.

### Film B — cards do not move at all

MEASURED, shot 10 (f407–462), text bounding box per frame:

```
f408..f417   lo=543  (locked)
f418         lo=527  ← a word appeared; box grew, did not move
f419..f444   lo=527  (locked)
f445         lo=519  ← a word appeared
f446..f462   lo=519  (locked)
```

**Zero translation across 56 frames.** Same for shot 16. Film B's cards hard-cut
in, reveal words in place, and hard-cut out. All of Film B's motion lives in
its *shots* (window scale-up, camera push, chip punch), never in its type.

This is a real fork in the design system, not sloppiness:

| | Film A | Film B |
| --- | --- | --- |
| Card motion | rise in, push out | **none** |
| Shot motion | none (static crop per shot) | scale-up entrance, in-shot pushes |
| Where continuity comes from | the card's exit velocity | the shot's entrance velocity |

Each film puts the motion on exactly **one** of the two layers. Neither puts it
on both. That is the rule worth stealing.

---

## The chip punch (Film B, shot 4 → 5)

The most reusable component in either film. MEASURED by thresholding the chip's
`#E5E5E5` fill, eroding 3× to kill antialiasing, and taking the longest
vertical run.

| f | pill height (px) | scale | Δ |
| --- | --- | --- | --- |
| 186 | 62 | 1.00× | rest |
| 187 | 133 | 2.15× | +71 |
| 188 | 139 | 2.24× | +6 |
| 189 | 485 | **7.82×** | +346 |
| 192 | 498 | 8.03× | +2 |
| 195 | 504 | 8.13× | +1 |
| 199 | 508 | **8.19×** peak | +1 |
| 200 | 477 | 7.69× | −31 |
| 202 | 445 | 7.18× | −12 |
| 204 | 436 | 7.03× | −2 |
| 206 | 437 | 7.05× | 0 |
| 207 | 468 | 7.55× | +31 |
| 208 | — | — | **cut** |

Three phases:

1. **Snap** — 1.0× → 7.8× in **3 frames (100 ms)**. f187/f188 are heavily
   motion-blurred; the punch reads as a cut with smear, not as a zoom.
2. **Creep** — 7.82× → 8.19× over 10 frames (+4.7 %), decaying.
3. **Recover** — 8.19× → 7.03× over 5 frames (−14 %), r ≈ 0.62; then two
   frames of rest; then f207 starts moving again and the cut lands at f208 —
   **mid-move**, same rule as Film A's card exits.

Geometry: the chip sits at (1209, 508) at rest, 113 × 62 px; after the punch it
is centred at (965, 529). So the transform is *scale about the chip's own
centre, plus a translate that brings the chip to frame centre*. INFERRED
implementation:

```ts
transform: `translate(${cx - chipX}px, ${cy - chipY}px) scale(${s})`
transformOrigin: `${chipX}px ${chipY}px`
```

Our `CHIP_PUNCH_SCALE = 4` (`src/lib/intro.ts:675`) is **half** the reference's
7.8×, and our `CHIP_PUNCH_S = 0.45` (13 f) is **4× slower** than the measured
3 f. See [06-comparison.md](./06-comparison.md).

---

## The logo mark tumble

OBSERVED, both films (Film A f0–26, Film B f855–890).

The Cursor cube performs a **full ~360° rotation about a tilted axis** over
~28 frames (0.93 s), decelerating, while simultaneously scaling down and
rising. Silhouette sequence, Film A, every 2 frames from f0:

```
f0  upright cube (final pose, large, low)
f2  tilted ~30°
f4  near edge-on quadrilateral
f6  hexagon (corner-on)
f8  hexagon
f10 rotated square
f12 small quadrilateral
f14 irregular pentagon
f16 chevron
f18 chevron
f20 diamond, first white facet reappears
f22 near-final cube
f24 cube
f26 upright cube (final pose, settled)
```

Starting and ending at the same orientation across a continuous rotation is
what identifies it as one full revolution. INFERRED: a CSS/WebGL 3D
`rotate3d` on a real cube, not a sprite sequence — the facet shading changes
consistently with the silhouette.

**Reproducing this with a flat mark.** The reference's mark is a solid, so its
silhouette is a filled polygon at every angle. A flat image is exactly zero px
wide at 90° and 270°, and no choice of axis avoids that — any rotation that
lets a plane show its back must pass through edge-on. The only free variable is
whether a crossing lands *on* a frame or *between* two. Apparent width is
`|cos(spin)|`; sampled on the 30 fps grid the worst frame of the whole turn is
0.030 at the measured 0.90 s (a 220-lit-pixel hairline — it reads as a blink)
but 0.119 at 0.85 s, where both crossings straddle frames. Our implementation
uses 0.85 s for that reason; see `LOGO_TUMBLE_S` in `src/lib/intro.ts`.

Underneath it, the headline writes on **word by word at 4-frame intervals**
(`New` f4, `in` f8, `Cursor` f12) and the subhead follows at ~f14–16.
MEASURED. In Film B the same lockup writes the wordmark **character by
character** (`O` → `ORIGIN`), which is what
`WRITE_CHAR_STAGGER = 0.06` (`src/Intro.tsx:72`) already does.

~~The logo cards are the only shots in Film A that **do not push out** — the
last 14 frames of shot 1 are pixel-locked (x bbox 905…1014, zero delta).~~

**CORRECTED — the opening bookend does push out, on Y.** The reading above was
taken on the **x** bounding box, and the move is vertical, so it measured a
constant. Tracking the ink block's TOP edge over the same frames:

| f80 | f84 | f88 | f92 | f95 | f97 |
| --- | --- | --- | --- | --- | --- |
| 319 | 319 | 317 | 312 | 304 | 294 |

A **25 px accelerating rise over the last 13 frames**, cut mid-move like every
other shot in the film — and the per-frame change metric agrees, ramping
0.03 % → 1.12 % across f85–97 after 47 frames of genuine stillness (f38–84).
The CLOSING bookend does hold still, but only because nothing follows it: its
motion decays to zero at f1242 and stays there to the end of the film.

The rule is therefore the ordinary one. Every shot is cut mid-move; the only
exception is the last.

---

## The recap card (Film A, shot 11)

MEASURED by ink-mass steps on a 96×54 reduction.

| Frame | Δ ink | Event | Offset from card start |
| --- | --: | --- | --- |
| 1094 | −27 658 | card starts, **completely empty** | 0 f |
| 1098 | +769 | cube mark appears | 4 f · 0.133 s |
| 1106 | +3 426 | `New in Cursor` wordmark appears | 12 f · 0.400 s |
| 1116 | +3 835 | item 1 `Subscriptions` | 22 f · 0.733 s |
| 1132 | +3 956 | item 2 `Custom modes` | 38 f |
| 1148 | +5 283 | item 3 `Subagent isolation` | 54 f |
| 1164 | +1 463 | item 4 `/goal` | 70 f |
| 1204 | — | cut | 110 f |

Derived schedule:

| Interval | Measured | Our constant | Match |
| --- | --- | --- | --- |
| card start → mark | 4 f (0.133 s) | `RECAP_LEAD_S = 0.17` (5 f) | 1 f |
| mark → wordmark | 8 f (0.267 s) | `RECAP_LOCKUP_STAGGER_S = 0.27` | **exact** |
| wordmark → first item | 10 f (0.333 s) | `RECAP_ITEMS_LEAD_S = 0.37` (11 f) | 1 f |
| item → item | **16 f (0.533 s)** | `RECAP_ITEM_STAGGER_S = 0.533` | **exact** |
| last item → cut | 40 f (1.333 s) | `holdS = 1.23` (37 f) | 3 f |

`src/RecapCard.tsx` is already calibrated to this reference to within
1–3 frames. Nothing to change.

Item reveals are **binary in appearance and then settle**. MEASURED, tracking
the first item's ink band top across its reveal:

| f1114 | f1115 | f1116 | f1117 | f1118 | f1119 | f1122 |
| --- | --- | --- | --- | --- | --- | --- |
| — | 317 | 314 | 312 | 311 | 310 | 309 |

Ink goes 0 → 14 749 between f1114 and f1115, so there is no fade — but the item
then **rises 8 px, decelerating, over six frames**, which is `RECAP_RISE` on
`RECAP_RISE_S`, the same move the mark makes. The sentence above was right that
no rise exceeds 8 px and wrong that there is none; `RecapCard` had the constant
and applied it only to the mark. Fixed.

---

## Micro-interactions

| Detail | Film | Evidence | Frames |
| --- | --- | --- | --- |
| Chip morph `[＋]` → `[＋ New]` | B | ink climbs f179–188 before the punch | ~9 f |
| Chip swap `[Buildkite]` → `[Depot]` in place, no cut | B f671 | ink step −2 835 | 1 f |
| Hover state on the chip before the punch | B f186 | pill lightens | 1–3 f |
| Cursor travels *before* the beat it serves | B f180→186 | cursor crosses frame ahead of the click | 6 f |
| Text caret blinking during typing | A shot 9 | `/goal build a software factor‸` | — |
| Typing rendered character-by-character | B shot 6 | `ever` → `everysphere-` → `everysphere-test` | ~55 f total |
| 2-frame white flash at a clip head | A f431–432 | stdev 0.0, luma 233 | 2 f |
| Keycap HUD `⌥⏎` bottom-centre | A shot 5 | black pill, white glyphs | — |
| Logo card exits with **zero** motion | A f84–97 | x bbox delta 0 | 14 f |

The cursor-leads-the-beat detail is worth naming: in Film B the pointer is
already travelling toward the chip **6 frames before** the punch. The viewer's
eye is delivered to the target before the target does anything. Our recorder
already does this (`glideTo`, `scripts/lib/recorder.ts:225`), but our *cards*
have no pointer at all.

---

## Audio (Film A only)

Film B has **no audio stream at all**. OBSERVED.

Film A, MEASURED:

| Metric | Value |
| --- | --- |
| Integrated loudness | **−31.3 LUFS** |
| Loudness range (LRA) | 3.7 LU |
| True peak | −16.2 dBFS |
| Per-second peak, f3 s → end | steady −18 to −19 dBFS |
| Silence (< −50 dB, > 0.3 s) | only at 0.37–1.79 s |

A signal that is present every single second at a near-constant peak, with a
3.7 LU range, is a **continuous music/ambient bed** — not isolated UI sound
effects. It **fades in over the first ~1.8 s** and runs unbroken to the end.

−31.3 LUFS is ~17 LU below the −14 LUFS social-platform norm. This is
deliberately, almost subliminally quiet: a texture that stops the film feeling
dead, mixed low enough that muted playback loses nothing. INFERRED intent.

RMS by 2-second window varies −56 to −30 dBFS, and the louder passages
coincide with the footage shots rather than the cards — INFERRED as either
arrangement changes timed to the edit, or light ducking under the cards.
**UNKNOWN** whether any per-click SFX exist; at −31 LUFS under a bed they are
not separable.

---

## Discrepancy — resolved, and the metric was the bug

`docs/design/reels/fullbleed.md` records Film A at **21 %** moving frames with a
longest frozen run of **111 f**. An earlier pass of this analysis, using the
chain that `.agents/skills/intro-reel/SKILL.md` then prescribed
(`tblend=all_mode=difference,signalstats`, YAVG > 0.2, full resolution),
measured 28.4 % and 92 f — and scored our own `harness.mp4` at **52 %**, which
read as a serious defect.

**It was not a defect. The metric was wrong.**

YAVG is the *mean absolute difference* over the frame: an amplitude measure, so
it integrates the encoder's low-amplitude noise floor along with real motion.
That makes it sensitive to bitrate and resolution rather than to picture
content. On our worst-scoring card, a direct check found that **no pixel changed
by more than 6 levels between adjacent frames** — the entire 2.7-per-frame
"motion" signal was diffuse compression noise on a card that is provably static.
Our 2560×1440 CRF-16 encode carries more of that noise per pixel than the
references' 1920×1080 736/838 kbps encodes, so identical stillness scored
twice as high.

The fix is to **threshold each pixel first, then count**: a frame is moving when
more than 0.2 % of its pixels change by more than 8/255. Per-pixel thresholding
discards the noise floor instead of integrating it.

Re-measured, all three films through the identical corrected chain, cut frames
excluded:

| Film | Encode | Moving | Longest still run |
| --- | --- | --- | --- |
| A "Agent UX improvements" | 1080p · 736 kbps | **24.1 %** | 110 f |
| B "Origin / Code Hosting" | 1080p · 838 kbps | 36.8 % | 75 f |
| **Ours** `harness.mp4` | 1440p · 502 kbps | **19.8 %** | 86 f |

Film A's 110 frames independently reproduces the 111 f in `fullbleed.md`, which
is what confirms the corrected metric is sound. That document's 21 % was right
all along; the 28.4 %/52 % pass was the artifact.

**Our reel is already stiller than the reference**, and comfortably inside the
`≤ 25 %` target. Per segment:

| | ours | Film A |
| --- | --- | --- |
| cards | 7–26 % | 6–38 % |
| clips | 24–26 % | 1–25 % |
| logo card | 10 % | 44 % (the mark tumbles) |

The one place we are *less* kinetic than the reference is the logo card — and
that gap is the missing 360° mark tumble, not an excess of stillness.

The lesson generalises beyond this repo: **any motion metric that averages an
amplitude will rank encoders, not films.** `SKILL.md` §4 now prescribes the
counting metric and records this calibration.
