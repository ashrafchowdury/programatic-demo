# Gap analysis — the shipped reel vs. the references

Re-measured **2026-08-20** against `out/reel/harness.mp4` as rendered *after*
the full-bleed, HD-capture and logo-bookend work landed. **§12 records what
changed when items 1-4 were then implemented** — read §0-§11 as the diagnosis
and §12 as the result. This supersedes the
figures in [06-comparison.md](./06-comparison.md), which were taken on the
628-frame cut before the sign-off card and the re-tuned clip ranges existed.

| | Film A | Film B | **Ours (now)** |
| --- | --- | --- | --- |
| File | `cursor-agent-ux-imrpovments-intro.mp4` | `cursor_origin_intro.mp4` | `out/reel/harness.mp4` |
| Frame | 1920×1080 · 30 fps | 1920×1080 · 30 fps | 2560×1440 · 30 fps |
| Length | 1316 f · 43.87 s | 926 f · 30.87 s | **729 f · 24.30 s** |
| Shots | 11 | 11 (17 incl. sub-cuts) | **7** |

All three films went through the **identical** chain: `tblend` difference,
per-pixel threshold at 8/255, count, `scale=…:flags=area` to 128×72; a frame
"moves" when > 0.2 % of its pixels changed. Ink geometry comes from a full-
resolution 2D pixel reader against the modal border luma, not from a reduction.

Labels: **MEASURED** = read off the delivered files · **OBSERVED** = visible and
unambiguous · **INFERRED** = reasoned from measurement · **UNKNOWN** = not
determinable from the artefacts.

---

## 0. Headline

**The pacing is solved. The picture is not.**

Every timing axis is now inside the reference's band — card slots, shot lengths,
cut rate, motion budget, the 62-frame tail, the recap schedule. Four separate
gaps remain, and all four are about what is *in the frame* rather than *when*
it changes:

1. UI text in our clips renders at **13 px** where the reference's renders at
   **30 px** (both normalised to 1920).
2. **Two of our six cuts are luma-invisible.** All ten of Film A's are ~230.
3. Our two bookends are the **same frame twice**, and both are nearly frozen.
4. We use **one ground colour** where the reference uses **three, by role**.

---

## 1. Timing — closed

**MEASURED.** Boundaries taken at f97 / 194 / 347 / 443 / 540 / 633.

| | Film A | **Ours** | |
| --- | --- | --- | --- |
| Mean shot | 3.99 s | **3.47 s** | ✅ |
| Median shot | 3.27 s | **3.23 s** | ✅ |
| Shortest shot | 3.17 s | **3.10 s** | ✅ |
| Cut rate | 13.7 /min | **14.8 /min** | ✅ |
| Card slot | 95–96 f | **96–97 f** | ✅ |
| Shortest clip | 95 f | **97 f** | ✅ was 27 f |
| Longest clip | 152 f | **153 f** | ✅ |
| Moving frames (excl. cuts) | 23.2 % | **16.6 %** | ✅ inside budget |
| Longest still run | 110 f | **92 f** | ✅ |

`06-comparison.md` item 7 (clip-length floor) is **closed by construction** —
the re-tuned ranges put both clips above the reference's 95-frame floor. The
27-frame clip no longer exists.

---

## 2. The motion arc — **GAP**

**MEASURED.** Per-shot moving-frame percentage, in order:

```
Film A   42.1  35.5  23.0  29.3  22.8  31.2  11.3   5.4   0.0  24.5  29.4
Ours      8.5  24.5  23.3  23.7  23.4   4.4   2.2
```

**OBSERVED.** Film A opens at its most kinetic shot, decays across the film to a
**completely frozen** shot (0.0 % — 95 frames, not one pixel over threshold),
then revives for the recap and closes moving at 29.4 %. The stillness is placed
in the *middle*, as a held breath before the payoff.

Ours does the opposite: it **opens nearly dead (8.5 %), holds a flat 23–24 %
middle, and dies at the end** (4.4 %, then 2.2 %). The last 189 frames — 26 % of
the runtime — average 3 % motion. The film runs out of energy exactly where the
reference re-accelerates.

**INFERRED.** This is not a motion-budget problem; our total (16.6 %) is *under*
the reference's (23.2 %). It is a *distribution* problem. The budget is spent
evenly instead of shaped.

---

## 3. Cut contrast — **GAP**

**MEASURED.** Shot mean luma in order, and the delta at each cut:

```
Film A  233 → 13 → 250 → 13 → 246 → 13 → 244 → 12 → 247 → 19 → 233
        cut deltas: 223 237 238 240 237 231 234 235 235 209   (all ten)

Ours      9 → 11 → 198 → 10 → 186 → 10 → 9
        cut deltas:   2  188  188  176  176   1
```

**OBSERVED.** Film A alternates light/dark on **every** cut, without exception,
across 11 shots. Ours breaks the alternation **twice**, at both ends:
`logo → claim card` (Δ2) and `recap → logo` (Δ1). ffmpeg's own scene detector
does not register either one as a cut.

**INFERRED — and this is the finding that ties §3, §4 and §5 together.** Film A's
bookends are `#EDECE5` **light**. That is not a taste decision. Light bookends
are the only arrangement in which a film of the form
`logo · card · clip · card · clip · … · recap · logo` alternates on every cut,
because cards and recap are dark and clips are light. Making the bookends dark —
what we did — is what forces the two dead cuts. The reference's colour choice is
load-bearing structure.

---

## 4. Ground colour — **GAP**

**MEASURED**, sampled from the delivered files:

| Role | Film A | **Ours** |
| --- | --- | --- |
| Bookend (logo) | `#edece5` — warm off-white | `#08080a` |
| Narration card | `#0a0a0a` — neutral near-black | `#08080a` |
| Recap card | `#16120d` — **warm** near-black | `#08080a` |

Film A uses **three grounds to mark three roles**. We use one, and ours is
*cool* (B > R) where both of the reference's darks are neutral-to-warm. This is
`04-design-system.md`'s "ground-as-role" principle, still unimplemented, plus
`06-comparison.md` item 6 (recap warmth) still open.

---

## 5. The logo lockup — **GAP**

**MEASURED**, ink geometry as a fraction of frame:

| | Film A f40 | **Ours f40** |
| --- | --- | --- |
| Structure | **vertical stack, 3 elements** | horizontal lockup, 2 elements |
| Mark | 114 × 130 px = **12.0 % of frame height** | inside a single 117 px band = 8.1 % H |
| Wordmark | 452 px wide = 23.5 % W | — |
| Second line | 794 px wide = **41.4 % W** | **none** |
| Lockup bbox | **41.4 % W × 33.0 % H** | **19.4 % W × 8.1 % H** |
| Centre | (0.498, 0.460) | (0.500, 0.477) |

**OBSERVED.** Film A's bookend is a poster: mark on top, `New in Cursor` under
it, then a grey third line. That third line is what makes the bookends *rhyme
rather than repeat* — it reads `Agent UX improvements` on the way in and
`cursor.com/changelog` on the way out. The closing card carries the CTA.

**MEASURED.** Our opening and closing cards are the same render:

```
ours   f40 vs f700 :  pixels differing by >8 = 0.0160 %   (encoder noise)
Film A f40 vs f1280:  pixels differing by >8 = 1.0249 %   (a whole line of type)
```

**MEASURED — the tumble works, and is invisible anyway.** Tracking the mark's
bounding box across f4–f19 gives width `67 → 115 → 101 → 71 → 57 → 67 → 88 →
153 → 170`, i.e. a clean pass through the 90° crossing with a minimum ink area
of 999 px and **no blank frame**. The duration fix held. But the mark is
0.27 % of the frame, so a full 360° turn moves too few pixels to register:
the closing shot scores **2.2 % moving**. The reference's mark is 2.6× taller
and sits above two lines of type that write on underneath it — which is where
its 42 % comes from, not from the tumble alone.

**MEASURED — dead frames at the head.** Frames 0–3 contain no mark at all. The
film opens on four blank frames of `#08080a`. Film A's f0 already has ink.

---

## 6. Footage legibility — **GAP, and the largest one**

**MEASURED.** Median height of a text line's ink, inside the component, at
1920-normalised scale:

| Shot | Panel | Median line height |
| --- | --- | --- |
| Film A f260 — settings row | 1640 × 470 | **30 px** |
| Film A f500 — composer | 1760 × 850 | **40 px** |
| Film A f740 — composer + agent list | 1680 × 800 | **30 px** |
| **Ours f300 — Anthropic drawer** | 810 × 680 | **12.8 px** |
| **Ours f500 — harness list** | 810 × 1380 | **13.5 px** |

**Our product UI renders at 43 % of the reference's text size.** At 13 px per
line at 1920, labels like `Active models — 5 of 19` and the 19 model rows are
below comfortable reading size on a phone, which is where a launch reel is
watched.

**MEASURED.** Component fill across the frame:

| | Film A | **Ours** |
| --- | --- | --- |
| Component span | 79.9 %, 84.2 %, 89.9 %, 81.1 % of frame width | **32 %** (drawer x 1740–2560) |
| Rest of frame | nothing — the component *is* the shot | scrimmed page, 68 % of width |

**OBSERVED.** In our clip 2 the left 68 % of the frame holds two table rows, a
clipped `2026` at the crop edge, and a line of small print, all under a scrim.
Film A never shows a frame with a dead region; `06-comparison.md` recorded the
component-fill target as 84–93 % and we are at a third of it.

**INFERRED.** These two numbers are the same defect. `FRAME.k = 1.28` with
`dx: -0.14` pans the drawer into view rather than magnifying it, so the drawer
keeps its native on-screen size. The `reels/harness.ts` header already notes
`k: 1.5` is available with zero upscale at `CAPTURE_SCALE=2`; even that only
takes the drawer to ~37 % of frame width. Reaching the reference's 84 % needs
the drawer isolated — clipped out of the page and scaled to fill — not panned to.

---

## 7. Card copy fill — minor

**MEASURED**, widest ink band per card:

```
Film A   63.4 %   42.4 %   48.4 %   77.8 %       (4 sentence cards)
Ours     47.7 %   44.3 %                          (2 sentence cards)
```

Line pitch is exact — ours 116 px at 2560 = **87.0 px at 1920** against the
reference's 86 px, and band heights 87 px → 65 px at 1920 against 66 px. The
type size fix from `06-comparison.md` item 2 **holds**.

What we do not have is the reference's **77.8 % single-line card** — a one-line
sentence set nearly edge to edge, which lands as a punch between two-line cards.
Both our cards are two-line at 44–48 %. `text-wrap: balance` fixed the orphan
but also guarantees no card is ever wide.

---

## 8. Recap card — closed

**MEASURED**, normalised to 1920:

| | Film A | **Ours** |
| --- | --- | --- |
| Left margin | 122 px = 6.4 % W | 166 px @2560 = **6.5 % W** |
| Header → first item | 173 px | 232 px @2560 = **174 px** |
| Item pitch | 119, 120, 121 px | 159/161 px @2560 = **119, 121 px** |
| Items | 4 | 3 |

Matches on every axis to ±2 px. Nothing to do.

---

## 9. Audio — unchanged, and now a divergence

**MEASURED.** `out/reel/harness.mp4` has **no audio stream**. Film A carries a
continuous bed at −31.3 LUFS; Film B ships silent.

Silence is defensible — Film B does it — but it is worth being deliberate about,
because the repo has a working audio system (bed + fades + a six-sound SFX
palette) that this reel does not use at all.

---

## 10. Runtime allocation

**MEASURED**, share of total runtime:

| | Film A | **Ours** |
| --- | --- | --- |
| Bookends | 210 f = **16.0 %** | 193 f = **26.5 %** |
| Sentence cards | 383 f = 29.1 % | 193 f = 26.5 % |
| Recap | 207 f = 15.7 % | 93 f = 12.8 % |
| Clips (proof) | 516 f = **39.2 %** | 250 f = **34.3 %** |

We spend a quarter of the film on two copies of one static image, and the
reference spends a sixth on two different animated ones. **The bookends are our
most expensive shots and our least informative.**

---

## 11. What to change, in order

Ranked by (how much a viewer would notice) ÷ (effort). Items 1–4 are the film;
5–8 are craft.

| # | Change | Closes | Effort |
| --- | --- | --- | --- |
| **1** | **Isolate the drawer instead of panning to it** — clip the component out of the page and scale it to ~85 % of frame width, so UI text lands near 30 px @1920 | §6 — the largest gap; also `06-comparison.md` items 8 and 9 | medium — needs the `<ComponentShot>` `clipPath` route, `k` alone cannot get there |
| **2** | **Make the bookend ground light** (`#edece5`) | §3 — restores alternation on all 6 cuts; §4 in part | 1 constant + a light-ground logo variant |
| **3** | **Give the lockup a second line, and change it between the bookends** — `New in Agenta` / `agenta.ai` — and grow the mark to ~12 % of frame height | §5 — stops the film opening and closing on the same frame; adds the missing CTA | new field on the logo card |
| **4** | **Shape the motion arc**: hold one clip dead-still mid-film, and give the closing bookend real movement | §2 — total budget is already right, only the distribution is wrong | scheduling, no new components |
| **5** | Three grounds by role: `#edece5` bookend / `#0a0a0a` card / `#16120d` recap | §4 fully | 3 constants |
| **6** | Trim the 4 blank frames at the head, or start the mark's rise at f0 | §5 | clip range |
| **7** | Write one **single-line** card and let it run to ~78 % width (exempt it from `text-wrap: balance`) | §7 | copy + one flag |
| **8** | Decide the audio question deliberately — bed at ≈ −31 LUFS, or documented silence | §9 | config |

**Not on this list, because they are done:** clip-length floor, card slot, word
stagger, the 62-frame tail, the push curve, recap schedule, cap height, line
pitch, click ripple, and the mark tumble (which works — it is just too small to
see, which item 3 fixes).

---

## 12. Implemented — what shipped, and what was built and taken back out

Items 1-4 were all built and measured. **Two of the four were then reverted on
review**, and that is the more useful half of this section: both reverts are
cases where a change moved every number in the right direction and made the film
worse. The reel is **9 shots / 923 f / 30.77 s**.

### Item 2 — light bookends ✅ shipped

| | before | after | Film A |
| --- | --- | --- | --- |
| Cut deltas | 2, 188, 188, 176, 176, 1 | **175-241, all eight** | 209-240, all ten |
| Invisible cuts | **2 of 6** | **0 of 8** | 0 of 10 |

The one unambiguous win. `logo → card` and `recap → logo` were luma steps of 2
and 1 — ffmpeg's scene detector did not see them as cuts. Both are now ~225.

Adding a third sentence card was part of it: the still (below) had to be
separated from the clip before it by a dark card, or the alternation collided
again.

### Item 4 — the motion arc ⚠️ half shipped

```
Film A   42  36  23  29  23  31  11   5   0  25  29
before    9  25  23  24  23   4   2
now       1  26  23  24  23  21   0   4   0
```

**The still landed exactly.** 95 frames at **0.0 % moving**, immediately before
the recap — same length, same score, same position as Film A's. It is a new
`freeze` on a clip: the shot holds its range's last frame with no pointer, and
it is exempt from the ranges-move-forward rule because a still cannot read as a
jump cut backwards.

**The bookends did not, and the cause is measured and singular.** Our mark is
light yellow (`#f1f174`, Y 226) and the bookend ground is `#edece5` (Y 235):
**nine levels of luminance contrast, where Film A's black mark on the same
ground has 227.** The 360° tumble runs correctly and moves almost no measurable
pixels because in luma there is almost nothing there to move. Colour-aware
differencing agrees (3.2 % / 0.0 %), so it is not a metric artifact. **The fix is
a mono/dark variant of the mark for light grounds** — a brand decision, not a
render one.

Two claims were corrected on the way, both by re-measurement:

- **The opening bookend DOES push out**, 25 px on Y over 13 frames
  (`f80 319 → f97 294`). The old reading was taken on the x bbox and the move is
  vertical.
- **Recap items rise 8 px after they land.** Appearance is binary; the settle
  after it is not. `RECAP_RISE` already held the right number and only the mark
  was using it.

### Item 1 — isolate the component ❌ built, measured, REVERTED

The mechanism exists ([src/lib/crop.ts](../../src/lib/crop.ts)): `crop` accepts
`{ rect, fill }`, deriving magnification, pan and a clip-path so a named
component box fills the frame alone. Cut that way, it won every number in §6:

| Shot | before | isolated | Film A |
| --- | --- | --- | --- |
| clip: connect | 12.8 px | **30.8 px** | 30 px |
| clip: enable | 13.5 px | **26.2 px** | 30 px |
| Component fill | 32 % | **65 %** | 80-90 % |

And it was rejected on sight, correctly. What the numbers did not capture:

- **It stopped being full-bleed.** The drawer came out of its page and floated
  on a flat `#9c9c9c` mat covering half the frame. That is Film B's
  isolated-component grammar imported into a Film A cut — a slide, not a film.
- **Half the frame became dead.** 68 % of scrimmed page showing the real app was
  traded for 50 % of flat nothing.
- **The clip edge sliced content.** `claude-opus-4-1-20250805` cut mid-glyph at
  the top of the rect, with a ghost half-row beneath it.
- **Context went with it.** Nothing left in frame said "settings page".
- **It cost 1.73x of upscale** — edge energy 11.4-12.2 against Film A's
  17.8-20.5.

Reverted to `crop: { k: 1.28, cx: 0.5, cy: 0.5, dx: -0.14 }`, which pans rather
than magnifies and reports **0.85x source→output — a downscale, nothing blown
up**.

**§6's finding still stands and its fix is upstream.** Our UI text is ~13 px
against the reference's 30 px because the drawer is 960 source pixels wide, and
the answer is `CAPTURE_SCALE=3`, not a tighter crop. Do not buy text size with
the frame.

### Item 3 — the lockup as a poster ❌ built, measured, REVERTED

Rebuilt as Film A's vertical stack — mark over name over a third line — and it
reproduced the reference's geometry to within half a point:

| | one row | vertical stack | Film A |
| --- | --- | --- | --- |
| Lockup bbox | 19.4 % W x 8.1 % H | **41.9 % x 33.5 %** | 41.4 % x 33.0 % |
| Wordmark cap | — | **54 px @1920** | 54 px |
| Third line | none | present, different at each end | same |

Reverted anyway, to **one row, one size, no third line**. Two reasons, both
specific to this brand rather than to the grammar: a light-yellow mark stranded
above the name has nothing holding it there where Film A's black cube does, and
a URL under a wordmark reads as a slide footer rather than as a sign-off.

The consequence is accepted: our two bookends are the same render again
(0.016 % of pixels apart), where Film A's differ by 1.02 %.

### The pattern worth keeping

Two of four changes matched a measurement precisely and had to be undone. Both
had the same shape — **a number from the reference was reproduced without the
thing that made that number work in the reference.** 84 % component fill works
for Film A because its components were captured at that size; a 33 %-tall
lockup works because its mark is a black cube. Copying the number without the
precondition produces something that measures right and looks wrong.

Measure to find the gap. Do not measure to choose the fix.

### Still open

Item 5 (three grounds by role — the bookend is light now, the recap ground is
still cool `#08080a` against the measured `#16120d`), item 6 (four blank frames
at the head), item 7 (a single-line card at ~78 % width), item 8 (audio), the
capture-scale ceiling under item 1, and a dark mark variant under item 4.
