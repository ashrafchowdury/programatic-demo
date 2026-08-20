# The full-bleed look — measurements & design

Persistent record of the reverse-engineering behind `look: "fullbleed"`, and why
each constant is the number it is. Companion to `audio.md`.

The reference is Cursor's **"Agent UX improvements"** film: 1920×1080, 30 fps,
43.87 s, 1316 frames. Every figure below was measured off that file, not
estimated. Method: `ffprobe` for container facts; per-frame `signalstats` for
luma; `tblend=all_mode=difference` for motion; raw grayscale frame decode for
per-line text bounding boxes; 1-D column/row profile SAD matching for global
per-frame dx/dy.

> The copy analysed was a social re-encode (`Twitter-vork muxer`, ~600 kbps).
> Geometry and timing survive that intact; sub-100 ms opacity ramps and fine
> gradient shading may not, so "no fade" below means "no fade measurable at
> 600 kbps", not "provably zero".

---

## Why this exists as a second look, not a replacement

The framed look — window on a studio backdrop, rim light, synthetic cursor,
click-driven zoom — is a coherent system with its own measurement record, and
several committed reels depend on it. The reference is a *different* coherent
system. Shipping it as a preset means both survive, and `pnpm reel` on an
unopted reel still produces byte-identical output. That invariant is tested
directly: render any card or clip with and without the flag and compare hashes.

---

## What the reference does that we did not

| | framed (ours) | fullbleed (reference) |
| --- | --- | --- |
| Footage treatment | window, radius 14, rim light, backdrop plate | **full-bleed, zero chrome** — all four frame corners sample the app's own page background |
| Camera | derived from the click log, S 1.18–1.74 | **none.** One static crop per shot; edge gaps identical on a shot's first and last frame |
| Pointer | synthetic arrow, ripple, squash | **none in any frame.** Keyboard-driven; a keycap pill instead |
| Transitions | hard cut | hard cut — **11 of 11**, no dissolve anywhere |
| Card push | scale ×1.04 | **directional translate**, axis varied per card |
| Card entry | from empty | **cut lands mid-reveal**, 2–4 words already out |
| Hold after text | `HOLD_S` 1.2 s | **2.07 s**, on every card regardless of length |

---

## The one curve

Every decelerating entrance is a decaying exponential. Remaining distance of
shot 3's 114 px slide-in, per frame:

```
114  82  62  48  38  30  22  18  14  10   8   4   2   2   0
    .72 .76 .77 .79 .79 .73 .82 .78 .71 .80 .50 .50
```

Mean retention **0.743**; the card-rise sample gives **0.819**. So r ≈ **0.78 per
frame at 30 fps**, τ ≈ 134 ms. A constant ratio over 10+ frames is exponential
decay, not a bezier — a bezier reaches its endpoint exactly at T.

Fitted numerically against those samples (RMS):

| curve | RMS |
| --- | --- |
| `cubic-bezier(0.15, 0.90, 0.75, 0.95)` ← `PUSH_BEZIER` | **0.0054** |
| `cubic-bezier(0.2, 0.2, 0.15, 1)` ← our `CAMERA_BEZIER` | 0.0660 |
| `easeOutQuint` | 0.0889 |
| `easeOutExpo` | 0.1188 |
| `easeOutCubic` | 0.1506 |

Worth noting: **`CAMERA_BEZIER` was already the closest of the standard named
curves.** It is in the right family and only slightly too slow off the mark —
the reference covers 28 % of the distance in frame one. `PUSH_BEZIER` is kept
separate rather than replacing it, because `CAMERA_BEZIER` drives the demo zoom
track and every existing reel's camera.

**The exit is the entrance time-reversed.** Not assumed — measured: shot 6's exit
is at 13/83 = 15.7 % of its travel at the halfway frame, and
`1 - PUSH_BEZIER(0.5)` = 0.158. One `settle()` in `src/lib/push.ts` drives both
ends, so tuning either cannot desync them.

---

## Move–rest–move

Every shot arrives already moving, decelerates over 14–18 f, sits **dead still**,
then accelerates away over 8–18 f and is **cut mid-move**. The film is **79 %
still** (21 % of frames carry any motion at all; 10 % carry strong motion).

Cutting mid-move is the mechanism, not sloppiness: the eye reads "still
travelling" on the last frame and accepts the next shot's momentum. At four of
the eleven cuts the velocity is genuinely continuous across the cut — measured
−84 px/f out and −68 px/f back in at the 3→4 cut, and −20 → −20 at 6→7.

Exit treatments are **varied on purpose**: slide left (56 px, 83 px), slide up
(54 px), scale down (−7 %), and twice no move at all. Alternating the axis is
what stops six cards reading as a slideshow. Hence `CardExit` is authored per
card rather than fixed.

---

## Cards

- Ground `#090909`; ink `#E9EBE6` (warm off-white, **not** `#FFFFFF`).
- Centred horizontally (line centres 955–961 against frame centre 960) **and**
  vertically (block centres 533–545 against 540).
- Line pitch **86 px** (exact, every multi-line card), weight 400–450.
  **Cap height 52 px** — superseded reading, see below.

  > **Correction (docs/reel/03-composition.md).** This line originally read
  > "font-size ≈ 64 px, line-height ≈ 1.35". The *pitch* is right; the size was
  > not. Measuring flat capitals (N, I, R) rather than whole-line ink extent
  > gives a cap height of **52 px**, which at FONT_STACK's ~0.715 cap ratio is a
  > **72 px** nominal size on a **1.194** line-height — same 86 px pitch, ~12 %
  > larger glyphs. Round capitals (G, S, C) read 54 px because they overshoot
  > the cap line, which is what the original whole-line measurement folded in.
  > Specify this pair by cap height and pitch, never by nominal size.
- Widest measured line 1492 px = **78 %** of frame width.
- Words reveal **in their final laid-out position**: line 1's left edge is pinned
  at x448 from f99 to f182 while its right edge grows 1314→1472. **No reflow, no
  re-centring.**
- Reveal is **binary** — a word appears complete in one frame. (This is what our
  `WORD_IN_S = 0` already does; confirmed correct.)
- Word cadence **3–6 f**, nominally 5 f, **compressed on longer copy** so the last
  word still lands on time: 6 f/word on a 9-word card, 3 f/word on a 15-word one.

**The hardest rule in the film:** the last word lands **62–63 frames (2.07 s)**
before the cut, on every card, whether it carried 7 words or 15. The stagger is
compressed to hit that; the tail is never shortened.

Our model reproduces the five reference cards to within 0–4 frames:

| card | words | our stagger | last word → cut | our frames | reference |
| --- | --- | --- | --- | --- | --- |
| Subscribe @Cursor… | 11 | 4.2 f | 62 f | 99 | 96 |
| Use any skill… | 15 | 3.0 f | 62 f | 99 | 95 |
| Run subagents… | 9 | 4.8 f | 63 f | 96 | 96 |
| Give agents… | 7 | 4.8 f | 72 f | 96 | 96 |
| Steering messages… | 14 | 3.2 f | 62 f | 99 | 97 |

`CARD_MAX_S` caps the length and `CARD_MIN_S` floors it, bracketing the
reference's measured 95–97 frames from both sides. Without the floor the 7-word
card came out 10 frames short, which breaks the metronomic 15 cuts/min the film
runs on.

---

## Footage

- **Full-bleed**, cropped at all four edges. Corners sample `#FCFCFC` (Slack shot)
  and `#F4F4F6` (Cursor shot) — the apps' own page backgrounds.
- The component that matters spans **1618–1780 px, i.e. 84–93 % of frame width**,
  in every one of the four footage shots. Everything else is cropped away.
- That is ≈ **2.1–2.5× CSS pixels**, so ≈ 1:1 against a 2× Retina capture — which
  is why the text stays crisp at 600 kbps. **Shoot at `deviceScaleFactor: 2`.**
- Nothing about the click log predicts which component to frame, so `crop` is
  authored per clip.
- **No motion blur.** The fastest measured move is ~34 px/frame, well below where
  a shutter earns its render cost, and the blur is destructive to flat UI colour
  (see the banding note in `WindowFrame.tsx`).

---

## Keycap, not cursor

No pointer appears in any sampled frame of any footage shot. Interaction is
announced by a black pill measured at **x 852–1068, y 924–1027** (216 × 103,
horizontally centred, 53 px clear of the bottom). It holds a **fixed frame
position while the footage slides under it**, so it is composited as a sibling of
the plate, not a child.

Flows drive it with `pressKey("Alt+Enter")` or a `{ key: "Alt+Enter" }` step; the
recorder logs a `KeyEvent`, and `chordGlyphs` turns the chord into `⌥⏎` at render
time. Key events live in their own array, **not** in `clicks`: a chord is not a
pointer target and would otherwise place a zoom keyframe with no rect and trip
the click SFX detector.

The pill's own in/out ramp is **not measured** — the sampled frames show it fully
present or fully absent. Kept short and understated.

---

## Recap card

The one composition that is **not centred**, which is what makes it read as a
list. Measured off its final frame:

```
lockup   x124, band y136–218   (mark + wordmark on one line)
items    x124, first band y308, pitch 120px
cadence  one item every 16 frames (0.53s) — 3× slower than card words,
         because these are labels to read, not prose to scan
lead     5 completely empty frames before anything appears
```

That blank lead is worth keeping: the cut into it is dark-to-dark (measured luma
delta **3.1**, against ~200 at every other cut), so it does not read as a cut at
all — it reads as the film catching its breath before the summary.

---

## Pacing

| metric | value |
| --- | --- |
| shots / cuts | 12 / 11 |
| mean shot | 3.66 s |
| median shot | 3.25 s |
| shortest / longest | 3.17 s / 5.07 s |
| cut frequency | **15.0 / min**, metronomic |
| frames with any motion | **21 %** |
| longest frozen run | **111 f (3.70 s)** |

Structure is a strict alternation with no dramatic arc:

```
Logo → [ CARD(3.2s) → PROOF(3.2–5.1s) ] × 4 → CARD → RECAP → Logo
         claim          evidence
```

Cuts land on **semantic** beats (claim ends, proof begins), never on visual beats
inside the footage.

---

## The luma-slam question

`SKILL.md` previously stated the ~157-level slam of a dark card over light
footage as a fault to avoid. This reference runs **~200-level slams nine times in
44 s** and is the better film for it.

Both readings are defensible; they are different films. The slam is a **choice
with a rhythm cost**, not a defect — and it only works when applied
*consistently*, at a metronomic cut rate, with the tonal ping-pong carrying the
structure. One dark card dropped into an otherwise light reel still reads as an
accident. Measured cut deltas here: 180–205 at ten of eleven cuts, and a
deliberate 3.1 at the one that is meant to feel like a pause.

---

## Open questions

- Whether `crop {k, cx, cy}` should stay hand-authored or be derived from the
  first click's bounding rect. The reference is hand-authored; deriving it is a
  possible improvement but nothing in this film settles it.
- The keycap's own entrance/exit, which the source bitrate cannot resolve.
- Whether the recap ground is genuinely warmer (`#14110B` measured) than the
  sentence cards' `#090909`, or whether that 3-level difference is encoder drift.
