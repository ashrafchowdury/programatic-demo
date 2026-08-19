# Reels — missing features & gaps

Backlog of what the reel pipeline does **not** do yet, with the reasoning kept
so it survives. Ranked by leverage. Update `Status` as items land; add a
one-line dated note under an item when it ships or the thinking changes.

| # | Feature | Priority | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | Audio — music bed + click-log-driven SFX | P0 | M | **DONE** (all phases) — see [audio.md](audio.md) |
| 2 | Aspect-ratio variants (9:16, 1:1) | P1 | M–L | proposed |
| 3 | End-card CTA | P1 | S | proposed |
| 4 | Multiple clips per reel (use existing support) | P1 | XS | proposed |
| 5 | In-clip callouts / annotations | P2 | M | proposed |
| 6 | Workflow: contact sheet + cut-point suggester | P2 | S–M | proposed |

---

## 1. Audio — music bed + click-log-driven SFX  · P0

> Full research + design: **[audio.md](audio.md)**. Phase 1 (author-declared
> audio tracks — supply, trim, place, layer, gain, fades) is being built; SFX,
> crossfade, loudness, ducking, and sync-to-beat are mapped there as later phases.

**What.** The reels are silent. Add a music bed under the whole reel, plus sound
design: a tick on each interaction, a whoosh on each camera zoom.

**Why.** Silence is the single biggest gap between "motion test" and "launch
film" — a reference launch ad is heavily carried by music and SFX. Highest
perceived-quality jump per unit effort.

**How (what we already have).** The click log carries `tDownMs` for every click
and the zoom keyframes for every camera move — so SFX can be **auto-placed** off
data we already compute, no manual sync. The reel concat is currently `-c copy`
(video only); adding audio is a mux step. Needs a licensed music bed + a small
SFX set (click, whoosh) as committed or configured assets.

**Open questions.** Music sourcing/licensing; per-reel vs. shared bed; whether
SFX are on by default or opt-in; ducking the bed under SFX.

## 2. Aspect-ratio variants (9:16, 1:1)  · P1

**What.** Output the reel in vertical (9:16) and square (1:1), not just 16:9.

**Why.** Distribution targets (X, LinkedIn, TikTok, Shorts) are not 16:9. Today
16:9 is a hard limit for anywhere social.

**How.** Cards reflow trivially (they are laid out, not fixed). The real work is
the clips: the footage is 16:9, so a vertical frame must **crop or reframe** it
(likely a per-clip focus point, or letterbox as a fallback). Card `columnFrac`
and margins may need per-ratio tuning.

**Open questions.** Reframe strategy for clips (crop-to-action vs. letterbox);
whether ratios are a render flag or separate reel specs.

## 3. End-card CTA  · P1

**What.** A closing card with a call to action — URL, "Try it", repo link —
after the logo sign-off.

**Why.** A launch film should drive an action, not just end on a mark. Cheap,
high-value for anything shipped publicly.

**How.** A card variant (or a field on the logo card) rendering a short CTA line
+ optional URL. No new pipeline — just a storyboard/`Intro.tsx` addition.

## 4. Multiple clips per reel  · P1

**What.** Interleave 2–3 short clips instead of one.

**Why.** More convincing than a single long take, and lets us **shorten** long
clips (e.g. the ~6.5s slash clip) rather than pad them.

**How.** The reel format **already supports N clips** — this is authoring, not a
feature build. Both existing reels use exactly one clip. Mostly a matter of
shooting/cutting more beats and validating pacing.

## 5. In-clip callouts / annotations  · P2

**What.** A small label over the footage pointing at the live action ("type /",
"Allow all") while a clip plays.

**Why.** Cards narrate *before* a clip; a callout reinforces *during* it, so the
viewer can't miss the moment. De-risks comprehension.

**How.** An overlay layer on the clip composition, positioned from the click log
(the target rect is already known). Keep it subtle so it doesn't fight the UI.

**Open questions.** Authored per-clip vs. derived from click labels; styling that
reads on a light app without clutter.

## 6. Workflow — contact sheet + cut-point suggester  · P2

**What.** (a) One command that dumps N frames across a reel as a contact sheet
for QA. (b) A helper that suggests clip in/out points from the motion trace.

**Why.** We currently verify by hand-extracting frames every iteration, and pick
clip ranges by manually reading a motion trace. Both are already-computed data —
tooling would cut the loop.

**How.** Reuse the per-frame motion trace (`% pixels changed`) already used in
audits: a contact sheet is an ffmpeg tile; the suggester ranks "cut on motion,
avoid frozen runs" candidates from that trace.

---

## Deliberate non-gaps (do not chase)

- **Hard cuts, not crossfades.** Matches the reference films, and the bundled
  ffmpeg cannot `xfade` anyway. A style choice, not a limitation.
- **~1.74× zoom ceiling.** Inherent to zooming a screen recording (the source is
  ~1920px); cropping tighter upscales and softens. Not a bug to fix.
