# Complete timeline

Frame-exact shot lists for both films. Frame numbers are 0-indexed; times are
`frame / 30`. Ranges are **inclusive**. "Cut at fN" means fN is the first frame
of the new shot.

All boundaries below are **single-frame hard cuts** — MEASURED, see
[02-motion.md](./02-motion.md#every-boundary-is-a-hard-cut).

---

## Film A — "Agent UX improvements" · 1316 f · 43.867 s

12 shots, 11 cuts. Structure:
`logo → [card → footage] × 4 → card → recap → logo`

| # | Frames | Dur (f) | Dur (s) | Type | Content | Attention on |
| --: | --- | --: | --: | --- | --- | --- |
| 1 | 0–97 | 98 | 3.267 | Logo title card | Cursor cube tumbles in; `New in Cursor` / `Agent UX improvements` | The mark, then the claim |
| 2 | 98–193 | 96 | 3.200 | Black text card | "Subscribe @Cursor to your PRs, / Slack threads, or run scheduled tasks" (2 lines) | Reading |
| 3 | 194–335 | 142 | 4.733 | Footage | Slack thread, `@Cursor subscribe to this thread` | The bot's reply line |
| 4 | 336–430 | 95 | 3.167 | Black text card | "Use any skill as a Custom Mode. It stays in context for the whole session." (3 lines) | Reading |
| 5 | 431–582 | 152 | 5.067 | Footage | Cursor composer, `Lauren Mode` chip, keycap HUD `⌥⏎` | The mode chip, then the keycap |
| 6 | 583–678 | 96 | 3.200 | Black text card | "Run subagents on their own machines with clean context" (2 lines) | Reading |
| 7 | 679–805 | 127 | 4.233 | Footage | Four cloud agents listed, each "Planning next moves" | The four parallel rows |
| 8 | 806–901 | 96 | 3.200 | Black text card | "Give agents a concrete objective across turns" (1 line) | Reading |
| 9 | 902–996 | 95 | 3.167 | Footage | Typing `/goal build a software factor…` | The slash-command token |
| 10 | 997–1093 | 97 | 3.233 | Black text card | "Steering messages now wait for the agent's next tool call instead of interrupting it." (3 lines) | Reading |
| 11 | 1094–1203 | 110 | 3.667 | **Recap card** | Lockup top-left + 4 items staggered | The list accumulating |
| 12 | 1204–1315 | 112 | 3.733 | Logo outro card | `New in Cursor` / `cursor.com/changelog` | The URL |

**Cuts:** 98, 194, 336, 431, 583, 679, 806, 902, 997, 1094, 1204.

Notes:

- Shot 5 opens on **2 frames of flat `#FAFAFA`** (f431–432, stdev 0.0) before
  the UI paints. MEASURED. This is a capture artifact left in the cut — the
  first two frames of the source clip. It is 67 ms and reads as a blink.
  See [06-comparison.md](./06-comparison.md) — we should trim this, not copy it.
- Shots 10 and 11 share the same black ground, so a luma-only detector merges
  them. The boundary was found by ink mass collapsing to zero at f1094. MEASURED.
- Shots 1 and 12 are the same card design with different sub-copy.

### Film A shot-length distribution

Sorted (frames): 95, 95, 96, 96, 96, 97, 98, 110, 112, 127, 142, 152

| Stat | Value |
| --- | --- |
| Mean | 109.7 f · **3.656 s** |
| Median | 97.5 f · **3.250 s** |
| Shortest | 95 f · 3.167 s (both a card and a clip) |
| Longest | 152 f · 5.067 s (shot 5) |
| Cut rate | **15.05 /min** |

The five black text cards are 95, 96, 96, 96, 97 frames — a **±1-frame band
around 96 f (3.20 s)**. MEASURED. This is the single hardest timing rule in
either film.

---

## Film B — "Origin / Code Hosting" · 927 f · 30.900 s

17 shots, 16 cuts. Structure:
`teaser → title → teaser → [sentence-with-chip → punch → isolated component] × 3 → framed app → sentence → components → black cards → payoff → logo`

| # | Frames | Dur (f) | Dur (s) | Type | Content | Attention on |
| --: | --- | --: | --: | --- | --- | --- |
| 1 | 0–11 | 12 | 0.400 | Footage (extreme zoom) | `Codebase` nav item, ~5× | Cold open — a flash of product |
| 2 | 12–60 | 49 | 1.633 | White card | "Introducing Code Hosting" | The claim |
| 3 | 61–117 | 57 | 1.900 | Footage (extreme zoom) | Same nav, **zooming out** over first 9 f | Widening context |
| 4 | 118–188 | 71 | 2.367 | White card **with live chip** | "Create a repo and start a `[＋ New]` project" | The chip |
| 5 | 189–207 | 19 | 0.633 | **Chip punch** | ~7.8× zoom onto `＋ New`, hand cursor clicks | The click |
| 6 | 208–263 | 56 | 1.867 | Isolated component | Repo-name input + `Create Repo`; types `everysphere-test`, clicks | Typing then the button |
| 7 | 264–294 | 31 | 1.033 | Warm-grey card | "Or" | A beat |
| 8 | 295–342 | 48 | 1.600 | Isolated component | `Sync from GitHub` button, cursor arrives and clicks | The button |
| 9 | 343–406 | 64 | 2.133 | **Framed** footage | Full Cursor web app, window on purple gradient | The repo list |
| 10 | 407–462 | 56 | 1.867 | White card with chip | "Review and `[⑂ Merge]` PRs" | The purple chip |
| 11 | 463–503 | 41 | 1.367 | Isolated component | Code diff, `Files Changed` | The changed line |
| 12 | 504–559 | 56 | 1.867 | Isolated component | Diff + context menu `Ask Cursor / Copy permalink / Copy code` | The menu |
| 13 | 560–624 | 65 | 2.167 | Isolated component | `Ready to Merge` card, cursor clicks `Squash & Merge` | The green button |
| 14 | 625–713 | 89 | 2.967 | **Black** card with chip | "Run CI from `[Buildkite]`" → chip **swaps** to `[Depot]` at f671 | The vendor swap |
| 15 | 714–758 | 45 | 1.500 | Black card with chip | "Push to deploy with `[Vercel]`" | The vendor |
| 16 | 759–836 | 78 | 2.600 | White card | "Git hosting, at agent scale" | The payoff line |
| 17 | 837–926 | 90 | 3.000 | Logo outro | Cube tumbles + `ORIGIN` writes on, purple gradient | The brand |

**Cuts:** 12, 61, 118, 189, 208, 264, 295, 343, 407, 463, 504, 560, 625, 714, 759, 837.

Notes:

- Shots 7 and 8 share the warm-grey ground; boundary found by ink mass
  (846 → 24 414 at f295). MEASURED.
- Shots 14 and 15 share the black ground; boundary found by ink collapse at
  f714. MEASURED.
- Shot 14 contains an **in-card chip swap** at f671 (`Buildkite` → `Depot`)
  with no cut. OBSERVED. One card, two vendors — a genuinely distinct beat type.
- Shot 12's first frame drops luma 222 → 191 and then keeps falling
  (−14, −9, −5, −4, −3…). That is a hard cut **into a shot already moving**,
  not a dissolve. MEASURED.

### Film B shot-length distribution

Sorted (frames): 12, 19, 31, 41, 45, 48, 49, 56, 56, 56, 57, 64, 65, 71, 78, 89, 90

| Stat | Value |
| --- | --- |
| Mean | 54.5 f · **1.817 s** |
| Median | 56 f · **1.867 s** |
| Shortest | 12 f · 0.400 s (cold open) |
| Longest | 90 f · 3.000 s (logo outro) |
| Cut rate | **31.1 /min** |

Film B has **no 3-second band**. Its cards run 31–89 f and its clips 12–65 f.
Length follows word count and interaction length, not a fixed slot.

---

## Pacing pattern

### Film A — metronome

```
LOGO ─ card ─ CLIP ─ card ─ CLIP ─ card ─ CLIP ─ card ─ CLIP ─ card ─ RECAP ─ LOGO
3.27  3.20   4.73   3.17   5.07   3.20   4.23   3.20   3.17   3.23   3.67   3.73
```

Strict alternation. Cards are locked at 3.2 s; clips float 3.2–5.1 s. The
viewer's rhythm is **read → watch → read → watch**, and the read beat never
changes length. There is no acceleration and no ritardando; the recap and the
outro land on the same beat as everything else. It is a metronome, and the
regularity is what makes it feel authored rather than assembled.

Cuts land on **semantic** beats — a card ends when its sentence has been
readable for 62–63 frames, a clip ends when its interaction resolves. They do
not land on visual accents inside the footage.

### Film B — accelerating triplets

```
tease  TITLE   tease   sentence PUNCH component   beat   component   APP
0.40   1.63    1.90    2.37     0.63  1.87        1.03   1.60        2.13

sentence  component component component   BLACK  BLACK  PAYOFF  LOGO
1.87      1.37      1.87      2.17        2.97   1.50   2.60    3.00
```

The unit is a **triplet**: a sentence that names the thing, a punch that
enters it, a component shot that performs it. It runs three times. Between
triplets sit one-word beats ("Or", 1.03 s) that reset the ear.

Film B *does* modulate: shots 1–8 average 1.43 s, shots 9–17 average 2.11 s.
It opens fast and lands slow, giving the last third room for the payoff line
and the logo. MEASURED.

Cuts land on **visual** beats — the frame after a click, the frame a chip
finishes morphing.

### Reading time

| | Film A | Film B |
| --- | --- | --- |
| Last word appears → cut | **62–63 f (2.07–2.10 s)**, every card | 21–47 f (0.70–1.57 s), varies |
| Word stagger | 5–6 f (0.167–0.200 s) | 5–6 f (0.167–0.200 s) |
| Longest card copy | 12 words / 3 lines | 6 words / 1 line |

MEASURED both. The word cadence is identical between the films; the **tail** is
not. Film A holds a rigid 2.07 s of silence after the last word so the sentence
can be re-read. Film B cuts as soon as the phrase completes, because its
sentences are short enough to take in at once and the punch is coming.

That 2.07 s tail is already `HOLD_AFTER_TEXT_S` in `src/lib/intro.ts:412`.
