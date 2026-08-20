# Reference vs. our pipeline

Every axis, measured. Our side is `out/reel/harness.mp4` (2560×1440, 628 f,
20.93 s) plus the working-tree source, put through the **identical** measurement
chain as the two references.

> **Status:** the top three items in §10 have been implemented and re-measured,
> plus two follow-ups. Figures below are **after** those changes. What moved:
> cap height 45.8 → **51.0 px** (reference 51–52); click ripple **removed**;
> the stillness metric in `SKILL.md` §4 **replaced**; full-bleed cards now
> **balance their line breaks**; the reel closes on a **logo sign-off**.

Legend: **✅** matches · **⚠️** close, needs a tune · **❌** materially different
· **➖** we have no equivalent

---

## 0. Headline

We have built Film A's grammar and got the **structure** right and the
**motion budget** wrong.

| | Film A | Film B | **Ours** | |
| --- | --- | --- | --- | --- |
| Mean shot | 3.66 s | 1.82 s | **3.49 s** | ✅ |
| Median shot | 3.25 s | 1.87 s | **3.20 s** | ✅ |
| Cut rate | 15.0 /min | 31.1 /min | **14.3 /min** | ✅ |
| Card duration | 96 f ± 1 | 31–89 f | **96, 96, 94 f** | ✅ |
| Dissolves | 0 | 0 | **0** | ✅ |
| Moving frames (excl. cuts) | 24.1 % | 36.8 % | **19.8 %** | ✅ |
| Longest still run | 110 f | 75 f | **86 f** | ✅ |
| Cut luma deltas | ~200 × 9 | mostly < 30 | 208, **38**, 157, 150, 156 | ⚠️ |
| Cap height @1920 | 51–52 px | 51 px | **51.0 px** | ✅ |
| Line pitch @1920 | 86 px | — | **86 px** | ✅ |
| Max column | 78 % | 69 % | **75 %** | ✅ |

**We are already inside the reference's motion budget** — 19.8 % against 24.1 %,
with an 86-frame dead-still hold. An earlier pass of this comparison reported
52 % vs 28 % and ranked it our biggest defect; that was an artifact of an
amplitude-based metric reading our noisier encode. See
[02-motion.md](./02-motion.md#discrepancy--resolved-and-the-metric-was-the-bug).
The genuinely valuable finding is the one underneath it: **the verification
metric this repo prescribed could not tell motion from compression noise.**

---

## 1. Timing and pacing

| Axis | Reference (A) | Ours | Verdict |
| --- | --- | --- | --- |
| fps | 30 | 30 (`Root.tsx:24`) | ✅ |
| Card slot | 96 f ± 1 | 96, 96, 94 f | ✅ `CARD_MIN_S 3.2` / `CARD_MAX_S 3.3` bracket it correctly |
| Word stagger | 5–6 f | `WORD_STAGGER_S 0.16` = 4.8 f | ✅ |
| Last word → cut | 62–63 f, **rigid** | `HOLD_AFTER_TEXT_S 2.07` = 62 f | ✅ exact |
| Clip length | 95–152 f | 27, 120, 96 f | ⚠️ the 27 f clip is far below the reference's 95 f floor |
| Shot count | 12 | 6 | ➖ ours is a 21 s reel, not a 44 s one — fine |
| Overall arc | metronome, no acceleration | metronome | ✅ |

The 27-frame (0.9 s) clip is the one real pacing defect. The reference never
cuts a clip shorter than 95 f, because a clip has to establish, act and
resolve. A 0.9 s clip can only do one of the three.

**`HOLD_AFTER_TEXT_S` is defined twice** — `src/lib/intro.ts:412` and
`src/lib/push.ts:68` — with no import between them. Both currently read 2.07.
The reference's rigidity makes this the single most load-bearing constant in
the system; two copies of it is a latent bug.

---

## 2. Motion and easing

| Axis | Reference | Ours | Verdict |
| --- | --- | --- | --- |
| The curve | exponential settle, r ≈ 0.78, τ ≈ 137 ms | `PUSH_BEZIER(0.15, 0.9, 0.75, 0.95)`, fitted RMS 0.0054 | ✅ confirmed twice now — **settled, stop re-deriving** |
| Exit = reversed entrance | yes | `settle` drives both (`push.ts:78`) | ✅ |
| Card rise | +52 px / 13 f | `CARD_RISE 56` / `CARD_RISE_FRAMES 14` | ✅ within 4 px, 1 f |
| Card exit | −63 px / 14 f, accelerating into the cut | `CARD_EXIT_DEFAULT −72 px / 13 f` | ✅ |
| Cut mid-move | yes | `cutsMidMove` guard exists | ✅ |
| Overshoot on translation | **none** | none | ✅ |
| Opacity as a channel | **never used** | `ENTRY_FLOOR 0.3` + opacity on `Line` | ⚠️ we fade where the reference does not |
| `spring()` usage | n/a | **zero call sites** | ✅ correct — springs overshoot |
| Motion blur | on fast moves | `shutterAngle 180`, off for full-bleed | ✅ |

### Motion budget, per segment

Measured with the corrected metric (pixels changing > 8/255, > 0.2 % of frame):

| Segment kind | Ours | Film A |
| --- | --- | --- |
| cards | 7–26 % | 6–38 % |
| clips | 24–26 % | 1–25 % |
| logo card | **10 %** | **44 %** |
| whole film | **19.8 %** | 24.1 % |

Our clips sit exactly in the reference's band, and our cards are *stiller* than
its cards. Nothing here needs trimming.

The one real gap is the logo card: the reference spends 44 % of its opening
shot in motion because the mark tumbles a full 360°, and ours spends 10 %
because it does not. **We are not too kinetic; our bookend is too inert.**
That is item 4 below, not a motion-budget problem.

---

## 3. Typography

| Axis | Reference | Ours | Verdict |
| --- | --- | --- | --- |
| Line pitch @1920 | 86 px | 86 px (`64 × 1.35`) | ✅ |
| **Cap height @1920** | **51–52 px** (flat capitals) | **51.0 px** | ✅ was 45.8 |
| Max column | 78 % | 75 % measured; `COLUMN_FRAC_FLAT 0.78` | ✅ |
| Weight | 400–450 | `HEADLINE_WEIGHT 400` | ✅ |
| Letter-spacing | 0 | `FULLBLEED_LETTER_SPACING "0em"` | ✅ |
| Alignment | centred both axes | centred | ✅ |
| Highlight pills | **none in either film** | dropped for full-bleed (`Intro.tsx:510`) | ✅ |
| Face | neo-grotesque | `ui-sans-serif, system-ui, …` | ⚠️ renders differently per machine |

**The fix — applied.** We reproduced the *pitch* correctly but not the *size*:
64 px at a 1.35 line-height gives an 86 px pitch with a 45.8 px cap. The
reference has an 86 px pitch with a **51–52 px** cap (measured on FLAT capitals
N/I/R; round capitals G/S/C read 54 because they overshoot the cap line, which
an earlier pass mistook for the true height). Hold the pitch, grow the type:

```ts
FULLBLEED_HEADLINE_SIZE  64   →  72        // 72 × 0.715 = 51.5 px cap
FULLBLEED_LINE_HEIGHT    1.35 →  1.194     // 72 × 1.194 = 86.0 px pitch, preserved
```

Re-rendered and re-measured: cap height **51.0 px**, pitch unchanged.

**Two side-effects to know about.** Bigger glyphs re-wrap the copy:

- `"Then choose which harness the connection feeds."` briefly broke with
  `feeds.` alone on line 2. **Fixed at the layout level, not in the copy:** the
  reference does not greedy-wrap (see
  [03-composition.md](./03-composition.md#line-breaking-is-balanced-not-greedy)),
  so full-bleed headlines now carry `text-wrap: balance`. Our lines went from
  1965/400 px to **1212/1253 px** — line 2 wider than line 1, the same
  signature the reference shows.
- The `"Connect Anthropic…"` card grew 96 → **99 f**, hitting `CARD_MAX_S`.
  Duration follows word count, not line count, so balancing does not shrink it.
  Still inside the reference's 95–97 f band by 2 frames, but there is now no
  headroom on that card.

Related: `FONT_STACK` is `ui-sans-serif, system-ui, -apple-system, …`
(`intro.ts:439`). Because cap height must now hit an absolute 52 px, a stack
that resolves to a different face on a render worker than on a laptop will
render a different film. **Pin a real webfont** or accept that the type size is
only nominally controlled.

---

## 4. Colour

| Element | Reference | Ours | Verdict |
| --- | --- | --- | --- |
| Card ground | `#0A0A0A` | `DARK_GROUND #08080a` | ✅ within encoder noise |
| Card ink | `#EBECE9` | `FULLBLEED_INK #e9ebe6` | ✅ 2 levels |
| **Recap ground** | **`#16120D`** (warm) | `#08080a` (cool) | ❌ answers the open question in `fullbleed.md` |
| Title card ground | `#EDECE5` warm off-white | `LIGHT_GROUND #fafafb` cool | ⚠️ |
| Footage background | product's own, untouched | ours | ✅ |
| Backdrops | A: none. B: purple gradient | 16 baked JPEGs | ✅ ahead of the reference here |

`docs/design/reels/fullbleed.md` lists "recap ground warmth" as an open
question. **Measured: `#16120D`.** The reference deliberately warms the recap
ground relative to its sentence cards.

---

## 5. Footage and framing

| Axis | Reference (A) | Ours | Verdict |
| --- | --- | --- | --- |
| Full-bleed, edge to edge | yes (`#F8F8FA` at x=0 and x=1916) | yes | ✅ |
| One static framing per shot | yes | yes (`crop` not animated, `DemoClip.tsx:52`) | ✅ |
| Component fills | 84–93 % of frame width | authored per shot (`FRAME.k 1.28`) | ⚠️ hand-tuned, not derived |
| Clip cut on settled state | yes | no | ❌ |
| Leading blank frames | Film A ships 2 (a defect) | clapperboard trim | ✅ we're better |
| Window fit (framed look) | 86 % (Film B) | `WINDOW_FIT 0.86` | ✅ exact |
| Window chrome | **none** in Film B | `CHROME_H 38` titlebar | ⚠️ |
| Zoom ceiling | B reaches 7.8× sharp | **k≈1.5 with zero upscale** at `CAPTURE_SCALE=2` (was ~1.74× total, upscaling) | ⚠️ improved; still short of B, which renders components at size |

`FRAME = { k: 1.28, cx: 0.5, cy: 0.5, dx: -0.14 }` in `reels/harness.ts:30` is
authored by hand per shot. We already record `ClickEvent.rect`
(`src/lib/click-log.ts:6`), so the crop that puts a component at 84–93 % of
frame width is **derivable**. This is listed as an open question in
`fullbleed.md`; the reference's consistency across 4 shots says it should be
derived, not typed.

---

## 6. Cursor and input affordances

| Axis | Film A | Film B | Ours | Verdict |
| --- | --- | --- | --- | --- |
| Pointer visible | no | yes, hand | arrow, opt-in | ⚠️ shape |
| Click ripple | **none** | **none** | `RIPPLE_D 22`, `RIPPLE_S 0.35`, always on | ❌ |
| Click feedback | the real UI's press state | same | ripple | ❌ |
| Cursor scale under zoom | — | sub-linear | `CURSOR_SCALE_EXP 0.58` | ✅ |
| Cursor leads the beat | — | 6 f of anticipation | `glideTo` eased travel | ✅ |
| Keycap HUD | yes, `⌥⏎` | no | `KeycapHUD` | ✅ |
| Keycap + cursor together | never | never | possible | ⚠️ |

**Neither reference draws a click ripple.** Ours always did. It was the most
visible synthetic tell in our output — a viewer who has seen a real product demo
knows that circle is not part of the app.

**Applied, scoped to full-bleed.** `ripple` is a prop on `<Cursor>` and
`DemoClip` and a field on `ReelClip`, defaulting **off for "fullbleed"** and
**on for "framed"**. Verified frame by frame: the grey ring present at the
cursor tip for ~8 frames after every mousedown is gone from the reel, and the
app's own button press state carries the click.

An earlier pass defaulted it off in **both** looks. That was wrong, and worth
recording as a category error: full-bleed exists to reproduce the reference
films, so a reference-derived rule applies to it; the framed look predates the
reference and has a backdrop, window chrome and a zoom camera that the
reference has none of. Applying the rule there would have silently restyled
every framed demo ever cut, and — because neither `scripts/render.ts` nor
`scripts/clip.ts` threads the prop — with no way to switch it back. Set
`ripple: true` on a clip to opt in under full-bleed.

---

## 7. Cards: motion, and the missing grammar

| Axis | Film A | Film B | Ours |
| --- | --- | --- | --- |
| Card motion | rise + push | **none** | rise + push |
| Chip in sentence | no | **yes, central** | `ChipPunch` exists |
| Chip punch scale | — | **7.8×** | `CHIP_PUNCH_SCALE 4` ❌ |
| Chip punch duration | — | **3 f (100 ms)** | `CHIP_PUNCH_S 0.45` = 13 f ❌ |
| Chip punch after-motion | — | creep +5 %/10 f, recover −14 %/5 f, cut mid-move | none ❌ |
| Chip morph | — | `[＋]` → `[＋ New]` over 9 f | none ➖ |
| Chip swap in place | — | `[Buildkite]` → `[Depot]`, no cut | none ➖ |
| Isolated component shots | — | 5 of 17 shots | none ➖ |
| Logo bookends | **both ends** | **outro** | none ➖ |
| Mark tumble | 360° / 28 f | 360° / 28 f | none ➖ |
| Recap card | yes | no | ✅ matches to 1–3 f |

Our `ChipPunch` is structurally right (the `1fr auto 1fr` grid trick is exactly
how you guarantee the chip's centre without DOM measurement) but tuned to
**half the scale and four times the duration** of the reference. At 4× over
13 frames it reads as a zoom; at 7.8× over 3 frames it reads as a *punch*.
That is the whole point of the name.

**Logo bookends are the largest missing piece.** Both films open and/or close
on a logo card with a tumbling mark, and it is what makes them read as films
rather than as clips. It is already fix **F3** in
`fullbleed-gap-analysis.md`, still unimplemented. Note the reference detail
that makes it work: **logo cards do not push out.** They hold perfectly still
for their last 14 frames and hard-cut. Bookends are the stillness that frames
the motion.

---

## 8. Audio

| Axis | Film A | Film B | Ours |
| --- | --- | --- | --- |
| Bed | continuous music, **−31.3 LUFS**, LRA 3.7 | **none** | `loudnessLUFS` per reel |
| Head fade | ~1.8 s | — | `fadeInS` authored |
| Per-click SFX | not separable | none | 6-sound palette, auto-placed |
| Silence a valid choice | — | **yes, ships silent** | — |

We have a **more capable** audio system than either reference uses. Film A is
one quiet bed; Film B is silent. Two cautions:

- −31.3 LUFS is ~17 LU below the social norm. If we are targeting a similar
  register, our `loudnessLUFS` default should be checked against it — a bed
  mixed at −14 will feel loud and cheap next to these.
- Our SFX palette (click/typing/pop/key/confirm/error) has **no counterpart in
  either reference**. That does not make it wrong, but it is an invention, not
  a reproduction. It should be justified on its own merits.

---

## 9. Architecture

| Axis | Reference implies | Ours | Verdict |
| --- | --- | --- | --- |
| Cards rendered as vector | yes | Remotion compositions | ✅ |
| Scenes concatenated, not sequenced | (unknowable, but ours is right) | ffmpeg concat `-c copy` | ✅ correct — `<Series>` would desync the camera/cursor time base |
| No transition filter needed | confirmed | no `xfade` anywhere | ✅ |
| One shared easing module | strongly implied | split across `camera.ts` / `push.ts` / `intro.ts` / `zoom.ts` | ⚠️ |
| Timing constants centralised | — | **scattered across 4 files + inline** | ⚠️ |

There is no central timing module. `HOLD_AFTER_TEXT_S` exists in two files;
`zoom.ts`'s framing constants are module-private while their conceptual peers
in `click-log.ts` are exported. Given that this analysis has now confirmed the
same constants twice from two different films, they are stable enough to be
worth consolidating.

---

## 10. What to change, in order

Ranked by (impact on how the output reads) ÷ (effort).

| # | Change | Why | Effort |
| --- | --- | --- | --- |
| **1** | **Replace the stillness metric in `SKILL.md` §4** (done) | the prescribed YAVG metric could not distinguish motion from encoder noise, and produced a false 52 % reading that ranked a non-existent defect first | 1 doc section |
| **2** | ✅ **done** — type 64/1.35 → **72/1.194** | cap height 45.8 → **51.0 px**, matching the reference. Pitch unchanged at 86 px. | 2 constants |
| **3** | ✅ **done** — click ripple defaults **off** | neither reference has one; it was our most visible synthetic tell | 1 flag |
| **4** | ✅ **done** — logo bookends open **and** close the reel, and the mark turns a full **360°** as it settles | bookends are what make a reel read as a film (F3). The turn runs 25 f on `cameraEase`, overlapping the mark's 19-frame scale-and-rise so the card is still resolving after it has stopped travelling | new behaviour on `LogoLockup` |
| **5** | Retune `ChipPunch`: 4× → 7.8×, 13 f → 3 f, add creep + recover | it currently zooms; it should punch | 3 constants + blur samples |
| **6** | Warm the recap ground to `#16120D` | closes an open question in `fullbleed.md` with a measured answer | 1 constant |
| **7** | Enforce a clip-length floor (~95 f) | our 27 f clip has no room to establish → act → resolve | validation in `reelProblem` |
| **8** | Derive `crop` from the first click `rect` | reference holds 84–93 % across every shot; we hand-tune | small |
| **9** | Add `<ComponentShot>` via `clipPath` over full-viewport footage | unlocks Film B's grammar at zero capture cost | medium |
| **10** | Add a `no-motion` card mode + `axis: "none"` default for it | Film B's grammar needs static cards; the flag exists, the scheduler doesn't honour it | small |
| **11** | ~~Reconcile the 21 % vs 28.4 % measurement~~ — **resolved**, see item 1 | `fullbleed.md`'s 21 %/111 f was correct | done |
| **12** | Pin a webfont | absolute cap-height targets need a deterministic face | medium |
| **13** | De-duplicate `HOLD_AFTER_TEXT_S`; centralise timing | the most load-bearing constant exists twice | small |
| **14** | Drop `CHROME_H` titlebar for the framed look | Film B's window has no chrome | 1 flag |

Items 2–4 are the ones a viewer would notice; item 1 is the one that stops the
next investigation being sent after a phantom. Everything else is craft.

---

## 11. Where we are already correct

Worth recording so it does not get "improved":

- The push envelope curve, **confirmed against a second, independent film**.
- Card duration, word stagger, and the 62-frame tail.
- Recap card schedule — matches to 1–3 frames on every interval.
- Recap item pitch (120 px vs measured 119–120 px).
- `WINDOW_FIT 0.86` vs Film B's measured 86.0 %.
- `COLUMN_FRAC_FLAT 0.78` vs Film A's measured 77.7 %.
- Zero dissolves; ffmpeg concat rather than Remotion `<Series>`.
- No `spring()` anywhere — the reference has no overshoot to model.
- Cursor sub-linear scaling and eased travel.
- 16 backdrops and a real audio system: **more** than either reference uses.

And one thing we do **better** than Film A: the clapperboard trim means we
would never ship its 2-frame `#FAFAFA` flash at f431.
