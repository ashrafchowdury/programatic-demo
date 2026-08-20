# Two more grammars — Uber "Base" and monid "Claude for prospecting"

Measurement record for the third and fourth reference films, and what each one
means for [choreography-styles.md](./choreography-styles.md). Method and
confidence labels follow `.agents/skills/reverse-engineer-reference/`.

Companion to [`docs/reel/`](../../reel/), which holds the two Cursor films. This
doc does not restate those; it compares against them.

> **Filename warning.** The file delivered as
> `Replit on X If everyones building the same thing…` is **not a Replit film**.
> It is a *monid* product film ("Introducing Claude for prospecting", signing off
> on the monid wordmark). Named "monid" throughout. OBSERVED.

---

## 1. Executive summary

**Neither film is a variation on what we have. They are opposite extremes**, and
they bracket both Cursor films rather than sitting between them.

| | Film A *Cursor* | Film B *Cursor* | **Uber** | **monid** |
| --- | --: | --: | --: | --: |
| fps | 30 | 30 | **29.97** | 30 |
| Duration | 43.87 s | 30.90 s | 40.77 s | 34.63 s |
| Shots | 12 | 17 | 11 | ~5 |
| Cut rate /min | 15.0 | 31.1 | 14.7 | **6.9** |
| Mean shot | 3.66 s | 1.82 s | 3.70 s | **6.93 s** |
| **Moving** | 24.1 % | 36.8 % | **81.2 %** | 26.1 % |
| Longest still | 110 f | 75 f | **48 f** | 77 f |
| Transitions | hard cut | hard cut | hard cut | **6 f dissolve** |
| Ground | black/white | white/warm/black | `#000000`/`#FFFFFF` | `#F7FBF3`/`#3255F6` |
| Cap height | 52 px | — | ~75 px | ~70 px |
| Audio | −31.3 LUFS bed | **none** | **−8.2 LUFS, LRA 1.1** | −14.5 LUFS bed |

All MEASURED via `probe.py` except cap heights (MEASURED, single frame each).

The four findings that decide what we build:

1. **Uber moves 81.2 % of its frames.** Film A moves 24.1 %. Uber's longest
   still run in a 40-second film is 48 frames — 1.6 s. It is never at rest.
2. **Uber's motion is continuous, not staged.** Its ink count changes almost
   every frame in smooth ramps (58411 → 69732 → 57267 → 45798 → 39787 → 36190 →
   33898 → 32375), where Film A steps once per word and holds. MEASURED.
3. **monid never cuts for 22.7 seconds.** Two thirds of the film is one
   continuous take in which components swap in place. Its only transitions are
   two 6-frame dissolves. MEASURED.
4. **Audio spans 23 LU across the four films** — from Film B's silence to Uber's
   brick-walled −8.2 LUFS. Loudness is a grammar decision, not a global default.

---

## 2. Uber — "A new icon system"

### Structure

MEASURED, `cuts`, 29.97 fps. 11 shots, 10 cuts, mean 3.70 s, median 3.17 s.

Cut luma deltas: 140, 209, 207, 200, 150, 207, 195, 73, 31, 151 — near-maximum
slams, alternating pure black and pure white. Same tonal strategy as Film A, at
higher contrast: `#000000` and `#FFFFFF` exactly, no tint. MEASURED.

Shot 9 is **1 frame** (f990). A single-frame shot between two 100-frame shots is
a flash transition, not a beat. OBSERVED.

### The genre — kinetic typography

**Type is the subject, not a caption.** OBSERVED across the whole contact sheet.
The film's content *is* words being transformed:

- `LIGHTER` drawn in hairline outline rather than filled
- `FRIENDLIER` set on a curved baseline with visible Bézier control points
- `SCALABLE` stacked with ghost repeats above and below
- `ACCESSIBLE` carrying a left-to-right tonal gradient
- `OPEN` with construction grid and node handles overlaid
- Icons inlined *into* the sentence: "A NEW ICON ⚭ SYSTEM", "Designed ⚭ to work
  ◉ seamlessly"

Product footage exists (a phone tab bar, an app-icon grid) but is the minority of
the runtime. INFERRED from shot midluma plus the sheet: roughly 3 of 11 shots.

### Why 81.2 % moving

MEASURED via `ink` over f160–250. The trace shows continuous ramps in both
directions, with per-frame deltas of every magnitude — +26826 in one frame at
f173 (a snap), then a smooth rise and decay f185–193, then a 6-frame ramp to near
zero f199–204. That is **per-glyph continuous transformation**, not a staged
reveal.

The distinction is the whole finding. Film A's cards are still between word
arrivals — measured at 2–12 per-frame change. Uber's are never still.

### Type and audio

Cap height 75 px at 1920 on the "A NEW / ICON SYSTEM" card, first line 36.3 % of
frame width. MEASURED, f120. Against our full-bleed's 52 px cap, Uber runs
**1.44× larger**.

Audio: **−8.2 LUFS integrated, LRA 1.1 LU, true peak +1.0 dBFS** — clipping, and
5.8 LU above the −14 social norm. LRA 1.1 means brick-walled with essentially no
dynamic range. MEASURED. Digital silence from 39.373 s to the end.

> **Harness bug found.** `probe.py audio` crashes with
> `ValueError: cannot convert float NaN to integer` on this file. Cause: the
> silent tail yields an `-inf` RMS window, and `int(28 * (v - lo) / span)` is NaN
> when `lo` is `-inf`. `probe.py:615`. Worth fixing per the skill's own
> instruction to grow the harness.

---

## 3. monid — "Claude for prospecting"

### Structure — the film that does not cut

MEASURED, `cuts`, 30 fps. At the default `--luma-delta 25` gate it reports 4
cuts; at `--luma-delta 4` it reports 13. **Both are wrong**, and the reason is
the finding:

```
f682  f683  f684  f685  f686  f687
 216   198   165   132   114    98      monotonic luma ramp = DISSOLVE
```

Two 6-frame dissolves, at f682–687 and f873–878 (the second in reverse). No
luma detector can call these, and there are no other transitions in the film.
MEASURED.

Real structure, OBSERVED from the contact sheet:

| Section | Frames | Dur | Ground | Content |
| --- | --- | --: | --- | --- |
| 1 | f0–681 | **22.73 s** | `#F7FBF3` cream | One continuous take |
| — | f682–687 | 0.20 s | — | Dissolve |
| 2 | f688–872 | 6.17 s | `#3255F6` blue | Price payoff |
| — | f873–878 | 0.20 s | — | Dissolve |
| 3 | f879–1038 | 5.33 s | cream | Terminal + logo |

**22.73 seconds without a cut.** Section 1 is not one shot in the Cursor sense —
its content changes constantly — but it changes by *substitution within a frame*,
never by cutting.

### The mechanism — composited components with a persistent HUD

OBSERVED. Section 1 shows one UI component at a time, centred on the flat cream
ground: a search input, then a result card, then a stacked pair, then a verify
panel. Components swap in place.

Two layers persist *across* those swaps and are the film's signature:

- a **running cost counter** top-right — `SPENT $0.00` → `$0.05` → `$0.07`
- a **monospace step line** — `1 · SEARCH · free`, `2 · REVEAL · $0.05`,
  `3 · VERIFY · $0.02`

Neither Cursor film has anything like this. A persistent overlay that survives
content changes is what lets the film go 22 seconds without needing a cut: the
HUD carries continuity that cutting would otherwise have to supply.

This is Film B's *framing* (isolated components on a flat ground — the `isolate`
route already built in `src/lib/crop.ts`) with Film B's *pacing inverted*: 6.9
cuts/min against 31.1.

Ground `#F7FBF3` is cream with a green cast, not white. Accent `#3255F6`.
MEASURED. Headline cap ~70 px on a 181 px line pitch. MEASURED, f70.

Audio: continuous bed, **−14.5 LUFS**, 0.5 LU below the social norm. MEASURED.

> **Bitrate caveat.** 946 kbps for 1080p is under the ~1 Mbps floor. Any claim
> here about a *sub-2 % opacity ramp* would not survive this encoder. The
> dissolves are far above that threshold and are safe; a fine fade would not be.

---

## 4. What is actually addable to our choreography room

The room built in `src/lib/style.ts` takes a preset as **data**. The honest
question for each film is whether its grammar is a set of numbers or a set of
components.

### monid — YES, mostly a preset

| Needs | Status |
| --- | --- |
| Isolated components on flat ground | **Built** — `crop.ts` `{rect, fill, isolate}` |
| Cream/blue palette | Preset field, `introLook` already palette-driven |
| Long shots, low cut rate | Authoring, not code |
| Card length band | `CardLength.minS/maxS` — already a preset field |
| **6-frame dissolve** | **New mechanism.** We only hard-cut |
| **Persistent HUD across shots** | **New component.** Nothing spans segments today |

Two genuinely new things, both well-scoped. The dissolve is a compositing change
in `scripts/reel.ts` (a crossfade at the concat, not a per-segment property). The
HUD is a new overlay layer that renders *above* the segment sequence — which our
architecture has no concept of, since every segment renders independently and is
concatenated with `-c copy`.

⚠️ **The HUD breaks the segment cache model.** A layer that spans segments cannot
be baked into any one of them. It has to be a second pass over the concatenated
film, the way audio already is. That is the right shape, and `muxAudio` is the
precedent.

### Uber — NO, and a preset would be a lie

Our `Intro.tsx` reveals words by opacity on a schedule and moves the whole card
on a push envelope. Uber transforms **individual glyphs continuously**: along
curved baselines, as outlines, as ghost stacks, under gradients.

There is no number in a preset table that turns the first into the second.
Adding `uber` to `STYLE_PRESETS` would render a film that shares its palette and
its cut rate and nothing else that matters — which is exactly the failure
`style.ts` documents: *a name with invented numbers behind it is worse than no
name, because it looks addressable and renders a film nobody chose.*

**What Uber is genuinely worth taking** — three things, each independent of its
typography engine:

1. **Type scale.** 75 px cap against our 52 px. That is one preset field and it
   is the single most visible difference. MEASURED.
2. **Maximum-contrast grounds.** Exact `#000000`/`#FFFFFF` rather than our
   `#08080a`/`#edece5`. One preset field.
3. **The motion-layer question it raises.** Uber's `motionLayer` would be
   `"type"` — a third value neither Cursor film needs. Recording that the axis
   exists is worth more than a fake preset.

---

## 5. Plan

Ordered by (what a viewer notices) ÷ (effort), per the skill.

### Phase A — finish the plumbing *(prerequisite, no new styles)*

`introTiming` reads preset fields today, but `Intro.tsx`, `DemoClip.tsx` and
`RecapCard.tsx` still branch on `look === "fullbleed"`. Until they read
`preset.shot.framing` and `preset.card.enter/exit`, **any new style controls
timing but not appearance** — so every phase below is blocked on this.

Verification harness is already proven: per-segment byte-comparison, with PSNR
for the two logo bookends (Chromium's image decode is non-deterministic at
~68.5 dB, measured before any change).

### Phase B — add `narration` from Film B *(cheapest real style)*

Already specced in [choreography-styles.md](./choreography-styles.md) and every
number is in `docs/reel/`. Do this before either new film: it is the one style
whose measurements are complete, and it proves the room works end to end on a
grammar we have fully analysed.

### Phase C — add `ledger` from monid

Named for its signature, the running cost counter. Split in three so the
mechanism lands before the film does:

- **C1 · preset only.** Palette (`#F7FBF3`/`#3255F6`), cap ~70 px on 181 px
  pitch, long card band, `framing: "isolate"`, `motionLayer: "shots"`. Ships a
  usable style with hard cuts. Needs a re-shoot at higher `CAPTURE_SCALE` —
  `crop.ts` is explicit that isolation must not buy text size out of a small
  capture.
- **C2 · dissolves.** A `transition` field on the preset (`{kind: "cut"}` /
  `{kind: "dissolve", frames: 6}`), applied at the concat. Changes
  `scripts/reel.ts` from `-c copy` to a filter graph for dissolving pairs only —
  note this **re-encodes** those segments, so the byte-identity contract has to
  carve out an exception and say so.
- **C3 · persistent HUD.** A post-concat overlay pass, modelled on `muxAudio`.
  The biggest piece; defer until C1/C2 are cut and judged.

### Phase D — take Uber's three transferable numbers, not its grammar

Add to whichever style wants them; do **not** create an `uber` preset:

- a `type` group on `StylePreset` (`capPx`, `linePitchPx`) so scale stops being
  hard-coded in `intro.ts`
- extend `MotionLayer` with `"type"`, documented as observed-not-implemented
- record Uber in a references table with `source` set and `targets: null`,
  since we can measure it but cannot reproduce it

### Phase E — audio per style *(revisit a ruled-out decision)*

`choreography-styles.md` ruled audio out of presets because Film A had a bed and
Film B was silent, so a style that silently mutes a reel is a nasty surprise.
**Four films now span 23 LU** — −8.2, −14.5, −31.3, silent — and that is no
longer noise. Reopen it as an *advisory*: the preset carries its reference
loudness and `scripts/reel.ts` prints how far the reel sits from it, without
changing any level. Cheap, and it makes the spread visible.

### Not doing

- **Uber's typography engine.** Curved baselines, outline draw-on, ghost stacks
  and per-glyph gradients are a component library, not a preset. If it is ever
  wanted it is its own project.
- **Rewriting `docs/reel/`.** Those two analyses stand. This doc extends them.

---

## 6. What we already got right

Per the skill's instruction to name this so it does not get "improved" away:

- **The preset-is-data rule holds under pressure.** Both new films were testable
  against it, and it correctly *rejected* one of them. A registry that accepts
  everything would have hidden that Uber is out of reach.
- **`crop.ts`'s isolate route was built and reverted for the right reason.** It
  was wrong for `proof` and it is exactly right for `ledger`. The rejection note
  in that file is what made this call fast.
- **`DEFAULT_STYLE = "classic"`.** Two reels carry no `look` field; any other
  default would have restyled them.
- **Measuring before naming.** `cuts` was wrong about monid twice — 4 cuts at the
  default gate, 13 at the low gate, ~5 in reality. Reading the tool's own warning
  rather than its number is what caught the dissolves.
