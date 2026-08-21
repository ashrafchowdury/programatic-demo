# Replit — reverse-engineered choreography

Source: `Replit Replit X.mp4` (product intros library), analysed with
`.agents/skills/reverse-engineer-reference/probe.py`.

Every claim is tagged **OBSERVED** / **MEASURED** / **INFERRED** / **UNKNOWN**.
Durations are quoted in **seconds**, never frames — see §0.

---

## 0. The two facts that reframe everything else

**MEASURED — the reference is 24 fps.** 1280×720, 1008 frames, 42.048 s,
541 kbps, stereo AAC. Every other reference in this repo (both Cursor films,
monid) is 30 fps and our render path is `FPS = 30`. Reading these numbers as
30 fps stretches the film by 25%, which is the same class of error that put
every clip range 25% late earlier in the schedule reel. **All timings below are
seconds.**

**MEASURED — the film contains zero hard cuts.** The default detector reports
0 cuts. Dropping the gate to `--luma-delta 4` surfaces 5 candidates
(f296, f377, f689–691); every one was confirmed on a per-frame contact sheet as
a *continuous element move*, not a cut:

- f290–301: the popover translates down and out of frame, ~30 px/frame at the end.
- f372–383: the cubes translate right and out, span constant at 243–244 px.
- f684–695: the website panel shrinks and slides off the bottom to bare ground.

This is the single most important structural finding. **The film changes
subject by emptying the frame, not by cutting.** §2 covers what that means for
us.

**MEASURED — bitrate is 541 kbps at 720p.** That is thin. A sub-2% opacity ramp
does not survive this encoder, so every "no fade" below means *no fade
measurable at this bitrate*.

---

## 1. Genre

**OBSERVED — composited, not a card film.** Isolated UI panels float on a flat
ground with margins and a soft shadow. There is no full-bleed footage anywhere
in 42 seconds, and there are only two type cards (a closing statement and the
logo bookends).

`probe.py framing` reports FULL-BLEED at f84 with a corner-centre gap of 7. That
is the documented false positive: a near-white app page (#F2F2F2) on a warm
cream ground (#FAF6F1) genuinely differ by only 7 luma. The panel edge, shadow
and margins are all visible on `grid` and measured in §4.

---

## 2. Timeline

**MEASURED** boundaries, from `ink` troughs where the composition empties to
bare ground, cross-checked on contact sheets.

| # | seconds | dur | content |
| --- | --- | --- | --- |
| 1 | 0.0 – 3.0 | 3.0 s | empty ground → Replit wordmark writes in → holds → exits |
| 2 | 3.0 – 12.3 | 9.3 s | app window enters; moves to Run scan; **Select scan level** popover isolated and operated |
| 3 | 12.3 – 15.75 | 3.4 s | popover exits down; isometric cubes enter — *White Box Testing* / *Black Box Testing* |
| 4 | 15.75 – 21.4 | 5.6 s | code panel + website preview side by side; **Scanning 20/90/100%** chips |
| 5 | 21.4 – 24.5 | 3.1 s | cubes return |
| 6 | 24.5 – 28.8 | 4.3 s | website panel; **Recon / Auth / Fuzzing / Response Analysis** chips |
| 7 | 28.8 – 35.4 | 6.6 s | app window: issues list, *Fix all with Agent* |
| 8 | 35.4 – 37.5 | 2.1 s | type card — *Your `built-in` security team* |
| 9 | 37.7 – 42.0 | 4.3 s | logo mark builds, wordmark writes, holds |

**MEASURED** — the bare-ground seams sit at f378 (ink = 59), f513 (1047) and
f589 (3238) — 15.75 s, 21.4 s, 24.5 s. At those frames there is essentially
nothing on screen but the ground.

**MEASURED pacing.** 9 sections in 42.0 s → mean 4.7 s, and a *cut* rate of
**0.0/min**. Motion: **67.8% of frames are moving** (`YAVG > 0.2`), longest
still run **2.25 s**. For scale, our ledger cut of `agent-schedule` measures
18.2% moving. This film is almost never still.

---

## 3. Motion — one curve, used everywhere

This is the strongest finding in the analysis. Three independent elements were
fitted and **they agree to three decimal places**.

### The curve

**MEASURED — entrance, cubes growing from a fixed baseline** (f314–322, y-axis;
`hi` pinned at 493 while `lo` rises 337 → 180):

```
deltas   43, 36, 28, 20, 14, 9, 5, 2
r        0.6451 per frame (geometric mean)
tau      95 ms at 24 fps
settle   8.9 frames = 0.372 s to 2%
```

**MEASURED — chip expansion, the red `built-in` pill** (f868–872, by ink area):

```
deltas   5077, 3022, 2196, 1531, 877
r        0.6447 per frame
```

`0.6451` vs `0.6447`. A translate and an area expansion, in different sections,
on the same ease-out. **The film has exactly one entrance curve.**

**MEASURED — exit, black cube leaving frame** (f368–377, x-axis, span constant
243–244 px so this is *pure translate, no scale*):

```
deltas   6, 9, 15, 20, 28, 39, 55, 82, 137
r        1.478 per frame (accelerating)
travel   391 px in 0.375 s
```

`1 / 1.478 = 0.677` against the entrance's `0.645`. **INFERRED: the exit is the
entrance curve mirrored** — an ease-in of the same time constant. The series is
still accelerating on its last frame in shot, i.e. the element is *gone* before
it decelerates. Nothing eases out of frame.

### Two exit kinds

**MEASURED.** Not every exit is a pure translate:

- **Translate-only** — cubes, f368–377: span constant, moves right off frame.
- **Translate + shrink** — popover, f293–302: `lo` deltas 10, 37, 72, 82 while
  the span collapses 404 → 92. It falls *and* recedes.

**INFERRED** — the shrink reads as the element dropping away from camera rather
than sliding past it. Which one a section uses looks like a composition choice
(what is entering next and from where), not a rule I can pin down.

### Entrance direction

**MEASURED** — the entrance bursts at f314–319, f524–529 and f626–630 all show
the same 5–6 frame ease-out signature in `ink`. **OBSERVED** — elements arrive
by growing from their own baseline or sliding in from an edge; they do not fade.

**UNKNOWN** — whether there is also an opacity ramp under the move. At 541 kbps
a short fade would not survive the encoder, so I cannot rule one out.

---

## 4. Composition

### Ground

**MEASURED — `#FAF6F1`** rgb(250, 246, 241), sampled at three widely separated
flat points on f84 and re-confirmed on f963. It is a **warm** cream (R > G > B).
Note this is the opposite cast from our ledger cream `#F7FBF3`, which is green.

It never changes. There is no second ground, no dark register, no accent
ground anywhere in the film.

### The floating panel

**MEASURED** at f84, by scanning across the left edge at y = 400:

```
x=120   #FAF6F1   ground
x=128   #F5F1EC   shadow begins
x=134   #F1EEE8   shadow core, 9/255 = 3.5% darkening
x=138   #F3EFEA   lifting
x=142   #F6F6F4   panel surface
```

- **Panel edge at x = 140.** Box at f84 reads **x 140–1148, y 72–676** from
  `grid` → 1008 × 604 in a 1280 × 720 frame = **78.8% wide, 83.9% tall**.
- **Shadow ≈ 12 px wide, peak 3.5% darkening.** Extremely soft. At 1920 that is
  ~18 px of blur for a barely-there darkening — this is a *lift*, not a drop
  shadow.
- **Panel surface `#F6F6F4`** — near-neutral (R = G = 246, B = 244) against the
  warm ground. **INFERRED: the cool/warm split is what separates the two
  surfaces**, not luminance — they are only 7 luma apart and would otherwise be
  indistinguishable.
- **Corner radius: INFERRED ≤ 12 px at 720p (≈ 18 px at 1080p).** The
  panel/ground contrast is too low to measure a radius reliably; magnifying the
  corner 6× shows a small radius but I will not quote a number as measured.

Margins at f84 are **not symmetric**: left 140, right 132, top 72, bottom 44.
**INFERRED** — the panel is positioned per beat rather than centred once.

### Type

**MEASURED** on the closing card (f891, `type --pol light --thr 150`):

- Single line, **x 317 – 972**, width 656 px = **51.2% of frame width**.
- **Cap height 39 px** at 720p → **58.5 px at 1080p**.
- Centred both axes: line centre (646, 364) against frame centre (640, 360).
- **Line pitch: UNKNOWN / not applicable.** The card is one line and never
  wraps, so there is no pitch to measure. Do not carry a pitch from another
  film and call it measured.

For comparison at 1080p-equivalent cap heights: Cursor Film A = 52, our ledger =
70, Replit = 58.5.

**OBSERVED** — a light-to-regular weight geometric grotesque, low stroke
contrast, straight-tailed `y`. **UNKNOWN** — the actual face.

### The chip

**OBSERVED + MEASURED.** An inline red pill inside the sentence.

- Fill **`#F02A04` / `#F42900`** — call it **`#F03000`**; the same red as the
  logo mark (sampled `#F02A04` at f927).
- White text.
- Box at f891 ≈ **x 437–647, y 335–392** → 210 × 57 px.
- **Pill height 57 px against a 39 px cap = 1.46 × cap.**
- **INFERRED** — corner radius is a large fraction of the height but the pill is
  not a full stadium; it reads as ~10–12 px at 720p.

Red pills are also used as free-floating annotations over the UI in sections 4
and 6 (*Scanning 20%*, *Recon*, *Auth*, *Fuzzing*, *Response Analysis*).
**OBSERVED** — same fill, same white text, positioned at the panel's edges.

### Text reveal

**MEASURED** (`ink`, f854–888): letters arrive **one every 2 frames = 83 ms**,
steadily, with no fade — a **typewriter**, not our word-stagger.

The inline chip does not type. It **expands** over 5 frames (208 ms) on the
shared 0.645 curve, in a gap the typewriter leaves for it: at f867 the sentence
reads `Your ______` with a blank rule where the chip will land.

---

## 5. Audio

**MEASURED.**

- Integrated **−14.0 LUFS** — exactly the social norm, 0.0 LU off.
- **LRA 2.5 LU** — heavily compressed, very evenly mixed.
- **True peak −0.1 dBFS** — limited hot.
- `silencedetect` finds **no gaps**: continuous bed throughout.
- RMS envelope over 3 s windows sits between −15.2 and −18.2 dB for the whole
  body, then −20.9 and silent in the last window. **INFERRED: a tail fade of
  roughly 2–3 s.** No correlation between level and section, so **there is no
  ducking**.

**MEASURED — there are no discrete sound effects.** The film shows many clicks
and state changes and marks none of them with audio. That is a finding, not an
omission: this grammar carries its rhythm in the picture.

> Harness note: `probe.py audio` crashed with `ValueError: cannot convert float
> NaN to integer` on this file — the silent final window measures −inf dBFS and
> poisoned the envelope's min/max scaling. Fixed in the skill; silent windows
> now print as `(silent)` and the bars scale against the finite windows.

---

## 6. The system

What is invariant across all 42 seconds:

1. **One ground, always.** `#FAF6F1`, warm cream, never changes.
2. **Nothing bleeds.** Every UI element is a panel floating on that ground with
   margins and a 3.5% lift shadow.
3. **One easing curve.** `r = 0.645`/frame at 24 fps, τ = 95 ms, settle 0.37 s.
   Entrances decelerate onto it; exits are it mirrored and leave frame while
   still accelerating.
4. **No cuts.** Sections are separated by the frame emptying to bare ground.
5. **One accent.** `#F03000`, used for the logo mark, the inline chip and every
   floating annotation. There is no second accent and no dark register.
6. **Constant motion.** 67.8% of frames move; nothing holds longer than 2.25 s.
7. **Sound is a bed, not a score.** −14 LUFS, no ducking, no SFX.

What varies: which panel is on screen, where it sits, whether its exit shrinks
as well as translates, and how many annotation chips ride along.

---

## 7. What this is not

Worth stating, because the temptation is to map it onto grammars we already
have:

- **It is not a card film.** Two type cards in 42 seconds, both at the end.
  There is no card/footage alternation and therefore no card cadence to copy.
- **It is not `ledger`.** Ledger holds one long take and explains it with an
  overlay. This holds nothing, explains nothing in text, and never stops moving.
- **It has no recap, no keycap HUD, no cursor emphasis, and no window chrome
  in the browser sense** — the panel is the app's own surface, cropped, with a
  radius and a shadow applied to the crop.

**UNKNOWN — how the source material was produced.** The isometric cubes and the
side-by-side code/website composition are almost certainly authored artwork or
a designed scene rather than a screen recording, but nothing in the rendered
file proves that. If they are artwork, a meaningful part of this film is not
reachable by any screen-recording pipeline, ours included.

---

## 8. Comparison — the reference against our `stage` cut

Measured with `.agents/skills/compare-to-reference/gap.py` against
`out/reel/agent-tool.mp4`, the first reel written for this grammar.

| metric | REPLIT | OURS | read |
| --- | --- | --- | --- |
| **invisible cuts** | 0/0 | **3/3** | the defining property, reproduced |
| longest still run | 2.25s | **2.17s** | inside tolerance |
| sharpness | 1.88 | 3.58 | ours is sharper |
| loudness | −14.0 | −15.3 | 1.3 LU under |
| moving frames | 71.4% | 22.9% | **the one real gap** |
| fps | 24 | 30 | deliberate, see §0 |
| mean shot | 42.00s | 4.58s | meaningless — see below |
| bookend difference | 2.0% | 0.6% | ours ends closer to where it started |

**Seven of the eight flagged "gaps" are not gaps.** The reference is one
42-second take, so `shots`, `mean shot`, `median shot`, `shortest shot`,
`longest shot` and `cut rate` are all comparisons against a single shot and
carry no information — the harness prints this warning itself. `fps` is a
recorded decision. `bookend difference` flags us for being *more* consistent
than the reference.

### The one real gap: 22.9% moving against 71.4%

Traced rather than guessed, and the answer changed what we built twice:

1. **It is not the camera.** MEASURED on the reference at f146–f278: the panel's
   extent is `lo=400, hi=900` with **zero delta on both edges for 5.5 seconds**.
   Its panel holds perfectly still inside a section. An early `stage` build ran
   our click-derived zoom camera to add motion; that was wrong twice over — it
   is not what the reference does, and the camera exists to magnify the app to
   fill the frame, which is incompatible with a panel that floats with margins.
2. **It is not the cut.** Shot lengths are already close (4.58s against the
   reference's 4.67s mean section), and every seam is invisible.
3. **It is the content.** MEASURED: the schedule demo is 37% moving, because a
   form being filled in is a still picture with a cursor over it. The tool demo,
   built deliberately around two live-filtering search fields, is **50.8%**.
   The reference's sections are scanning animations, streaming code and progress
   chips — a continuously redrawing screen.

So the lever is the SCRIPT, and it moved the number from 16.5% to 22.9% across
three cuts of the same footage. Closing the rest needs product surfaces that
animate, or the floating annotation chips in §4 — not a choreography change.

### What we got right, and should not be "improved"

- **The seam.** 3/3 invisible. The panel clears frame on an accelerating exit
  and the cut lands on bare ground.
- **The envelope.** Our existing `PUSH_BEZIER` at 9–11 frames straddles the
  reference's measured `r = 0.704`/frame at 30fps. No new easing was written.
- **One ground, one accent, no dark register.**
- **The typewriter**, at the measured 83 ms/character.
- **No SFX**, matching the reference exactly.


---

## 9. Frame-by-frame gap check — final `agent-tool` cut

Paired measurement of `out/reel/agent-tool.mp4` (30.7s) against the reference,
via `gap.py score`, `gap.py sheet`, `gap.py color`, `signalstats` and
`probe.py type`.

### Matched

| | REPLIT | OURS |
| --- | --- | --- |
| ground colour | `#FAF6F1` | `#FAF6F1` — **dE76 = 0.0** |
| longest still run | 2.25s | 2.20s |
| invisible cuts | 0 cuts at all | **2/2 invisible** |
| loudness | −14.0 LUFS | −14.9 LUFS |
| bookend difference | 2.0% | 0.7% |
| logo choreography | mark solo → demote → wordmark writes | same, §4 timings |
| footage sharpness | 1.88 | 3.56 (clips measured alone) |

### The three real gaps, ranked by how much a viewer would notice

**1. UI TEXT IS 2.1× SMALLER THAN THE REFERENCE'S.** MEASURED with
`probe.py type`: the reference's isolated popover at f200 carries line bands of
**17px in a 720-tall frame = 2.36% of frame height**. Our picker at f600 carries
bands of 12–16px in a 1440-tall frame = **1.11%**.

This is the composition gap stated numerically. The reference **isolates one
component and shows it large**; we show a whole application at `windowFit`. It is
also why the film reads as cluttered — every frame is a wall of small type with
nothing for the eye to land on.

It is NOT fixable by shooting differently: §0 of
[capture-ceiling.md](./capture-ceiling.md) shows text size and upscale are the
same ratio, so the only way to double the text is to double the source pixels
per CSS pixel, which needs the app-side portal fix.

**2. THE FILM IS HALF AS COLOURFUL.** MEASURED with `signalstats` over every
frame:

```
REPLIT   mean saturation 4.87   median 3.60   p90 6.31
OURS     mean saturation 2.50   median 2.99   p90 3.59
```

The reference carries red annotation chips, blue action buttons, an orange
website, syntax-highlighted code. Ours is grey-on-cream with one chartreuse pill.
The p90 is the telling one: their brightest moments are **1.8×** ours, which is
the difference between a designed film and a screen recording.

Most of that gap is the annotation chips, already recorded in §4 as the single
biggest missing feature.

**3. MOTION, 21.3% AGAINST 71.4%** — and this one is now BY REQUEST, not by
accident. The cut is six type cards and two clips, so footage is only 34.5% of
runtime; even with perfectly busy footage the ceiling is ~48%. Earlier cuts of
the same material with four clips measured 22.9%. The lever is the script, and
it has been pulled about as far as this app allows.

### Not gaps, despite being flagged

- **`fps` 24 vs 30** — a recorded decision, §0.
- **`shots` / `mean shot` / `median` / `shortest` / `longest` / `cut rate`** —
  the reference is ONE 42-second take, so every pacing row compares against a
  single shot. The harness prints this warning itself.
- **`sharpness` 0.95 vs 1.88** — whole-film, and diluted by six flat cream cards
  that carry almost no edge energy by design. Scored on the two clips alone the
  same metric reads **3.56**, above the reference. See note.md D21.
- **`bookend difference` 0.7% vs 2.0%** — we end closer to where we started than
  the reference does. Being more consistent is not a defect.


---

## 10. Chip craft — what makes the reference's annotations read as designed

Measured after a first implementation that had the pills simply scale into place
and looked stuck on. Three findings, in order of how much each one changed it.

### They fly in from off-screen

**MEASURED**, "Recon" at f626–f650, x-axis: `lo` travels 178 → 319 while its
span shrinks 167 → 114. It enters from OUTSIDE the frame and settles at the
panel's edge.

The travel is not an authored distance — it is a consequence of where the chip
sits. Recon's settled centre is 0.284 from the left edge (363px in a 1280 frame)
and its own half-width is 63px; 363 + 63 = 426 against a measured ~385px of
travel. **The chip starts flush with the frame edge.** Deriving the distance that
way means a chip placed anywhere still enters from off-screen, where a fixed
distance would leave a centre-ish chip visibly sliding in from nowhere.

**All four arrive at once**, each from its nearest edge, so the frame goes from
bare to annotated in a single gesture.

### They settle on a much slower curve than anything else in the film

**MEASURED** decay of the travel deltas: `r ≈ 0.89 per frame at 24fps`
(17, 18, 14, 12, 11, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3 …). Settling to 2% takes ~34
frames = **1.4s**, against **0.37s** for every panel entrance in §3.

That difference is the craft. A chip is an annotation arriving *over* a scene,
not part of the scene moving, and giving it the scene's own snap makes it read
as UI rather than as commentary.

### They shrink as they arrive, and never fade

**MEASURED**: span 167 → 114, so a chip carries **1.47×** its final size on
entry and shrinks into place. That is what sells the travel as depth rather than
a slide.

**There is no opacity ramp.** At f624 the chips are fully opaque and simply
outside the frame. At 541 kbps a short fade would not survive the encoder
anyway, and a solid object arriving reads as more confident than one
materialising.

### What this bought

| | scale-in-place | flown in |
| --- | --- | --- |
| moving frames | 23.4% | **34.0%** |

The flight is worth ten points of motion on its own, because each chip now
crosses the frame for over a second instead of popping in one.


### The flight was built, measured, and rejected on how it looked

Everything above is what the reference does. **We do not use it**, and the
reason is worth recording because the numbers said the opposite.

Flown in, the cut measured **34.0% moving frames** against 24.1% for the
in-place version — a ten-point gain on the film's single worst metric. It looked
worse. The reference's chips cross a website mockup of big flat shapes with wide
empty cream margins; ours cross a dense app picker — a sidebar, a category list
and twelve cards — and a pill sliding over that for 1.4 seconds reads as noise,
not annotation. The slow settle that gives the reference its floating quality is
exactly what makes ours distracting, because it keeps the pill in motion for a
third of a four-second shot.

**What we use instead:** the chip UNROLLS in place, from the edge nearest its own
anchor, over 0.21s, on the film's own 0.645 curve. A wipe rather than a slide.
Nothing crosses the picture, the gesture is a fifth of the length, and it reads
as a label being applied to the thing under it.

That is not invented either — it is the reference's own vocabulary, borrowed
from the card: its inline `built-in` pill expands over 5 frames with ink deltas
5077, 3022, 2196, 1531, 877, ratios averaging **0.6447**. §3's curve, applied to
a pill.

Implemented with `clip-path`, not `scaleX`: a scale stretches the letterforms as
the pill grows and squashes them on the way out, where clipping reveals the text
at its true width so the type is correct on every frame.

**This is the third time in this repo a measured reference number has had to be
reverted on sight** — see `docs/reel/07-gap-analysis.md` §12 for the first two.
The pattern is identical each time: a number from the reference reproduced
without the thing that made that number work in the reference.
