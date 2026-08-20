---
name: compare-to-reference
description: Measure a finished reel, demo or still against the reference it was meant to match, and turn the distance into a ranked change list. Use after rendering, when asked how close we got, where the gaps are, whether a change actually helped, or to compare our quality against a reference.
metadata:
  tags: analysis, comparison, gap, regression, ffmpeg, quality
---

# Compare our output to the reference

We shot the thing. Now: how close is it, what is missing, and did the last
change help or hurt?

This is the second half of a pair.
[`reverse-engineer-reference`](../reverse-engineer-reference/SKILL.md) takes a
reference apart and produces a spec. **This one takes two files — the reference
and ours — and produces a distance and a ranked change list.** Neither shoots
or renders anything; production belongs to `shoot-demo-video`, `intro-reel` and
`shoot-still`.

```
reference + our render  →  paired measurement  →  look  →  ranked gaps
                                    ↑                            │
                                    └──── re-score after ────────┘
```

## The one rule

**Measure to find the gap. Do not measure to choose the fix.**

This repo has run the loop for real and it produced four changes. Two matched a
reference number precisely and had to be reverted on sight, both with the same
shape: *a number from the reference was reproduced without the thing that made
that number work in the reference.*

- Component fill was pushed 32 % → 65 % and UI text 13 px → 31 px by clipping
  the component out of its page. Every number won. It stopped being a film —
  the component floated on a flat mat over half the frame, the clip edge sliced
  a glyph in half, and nothing left in frame said what screen you were on. The
  real fix was upstream, at capture scale.
- The sign-off lockup was rebuilt to the reference's geometry within half a
  point (41.9 % × 33.5 % against 41.4 % × 33.0 %). Reverted: a 33 %-tall lockup
  works in the reference because its mark is a black cube, and ours is not.

The full write-up is [`docs/reel/07-gap-analysis.md`](../../../docs/reel/07-gap-analysis.md)
§12. Read it before you rank anything.

So: the table tells you **where** to look. Your eyes and the design intent tell
you **what to do**. A change that moves a number and looks worse is a failed
change, and the only way to know is to open the frames.

## The harness

`gap.py`, next to this file. python3 + ffmpeg, no pip installs.

```bash
G=.agents/skills/compare-to-reference/gap.py
P=.agents/skills/reverse-engineer-reference/probe.py

# the table
python3 $G score ref.mp4 out/reel/ours.mp4 --ref-label "FILM A" --our-label OURS

# keep a scorecard, then prove the next change helped
python3 $G score ref.mp4 out/reel/ours.mp4 --json .diag/gap/before.json
#   ... make one change, re-render ...
python3 $G score ref.mp4 out/reel/ours.mp4 --json .diag/gap/after.json
python3 $G delta .diag/gap/before.json .diag/gap/after.json

# look
python3 $G sheet ref.mp4 ours.mp4 --out /tmp/pairs.png --every 30 --cols 6
python3 $G shots ref.mp4 ours.mp4

# the two things the table cannot see
python3 $G ink   ref.mp4 ours.mp4 --ref-frame 742 --our-frame 300 --pol dark \
                 --ref-crop 1920:120:0:820 --our-crop 2560:160:0:1093
python3 $G color ref.mp4 ours.mp4 --ref-frame 40 --our-frame 40 \
                 --at 100,100,ground --at 960,540,centre
```

`score` decodes both files twice and takes roughly **25 s per minute of 1080p
footage per file**. Everything else is seconds. Stills work everywhere video
does — a still is `--frame 0`.

Write scratch output (sheets, frame dumps, scorecards) to `.diag/` or the
session scratchpad, never into the repo tree.

### Why not `probe.py compare`

`probe.py compare` exists and scores motion with **YAVG**, the mean absolute
frame difference. YAVG is amplitude-based and therefore **not bitrate-
invariant**: a noisier encode scores as moving on provably static content.
Measured here, a 2560×1440 CRF-16 render read **52 % moving** against a
1920×1080 reference's 28 % on comparable content, and on the worst card no
pixel changed by more than 6 levels — the whole signal was encoder noise. It
sent a real investigation chasing a defect that did not exist.

`gap.py` thresholds **each pixel first and then counts**: a frame moves when
more than 0.2 % of its pixels changed by more than 8/255. That discards the
noise floor instead of integrating it. Our render and someone else's delivered
film are never encoded the same way, so this is the only honest comparison.

Use `probe.py compare` for a quick two-file sanity check on files you encoded
yourself. Use `gap.py score` for anything you are going to act on.

## Order of operations

### 1. Get both files, and check they are comparable

Both must be the **delivered artefacts** — our final render, not a segment out
of `.diag/`; their delivered file, not a screen-capture of a video player.

`score`'s first rows are the comparability check. Aspect ratio must match;
pixel count need not, and everything below is normalised. If **fps** differs,
stop and think — the pacing rows are still valid in seconds, but "frames" in
any recommendation you write now means two different things.

Bitrate is printed for one reason: it bounds what you are allowed to conclude.
Under ~1 Mbps at 1080p a 2 % opacity ramp does not survive the encoder, so
"no fade" means *no fade measurable at this bitrate*.

### 2. Score

```bash
python3 $G score ref.mp4 ours.mp4 --json .diag/gap/$(date +%s).json
```

Read the rows. There is deliberately **no composite score** — a single number
invites tuning the film until the number moves, which is exactly how the two
reverted changes above got made.

If either film reports **zero cuts**, the tool says so loudly and every pacing
row below it is meaningless. Either it is genuinely one take, or `--cut-frac
0.25` was too coarse; re-run at `0.08` and confirm the boundaries on a `sheet`
before believing either answer.

### 3. Look before you rank

Non-negotiable, and the step everyone skips.

```bash
python3 $G sheet ref.mp4 ours.mp4 --out /tmp/pairs.png --every 30 --cols 6
```

Reference on top, ours below, same cadence. Open it. You are reading **what
changes between panels**, not what is in them.

Then `shots` for the two shot tables. Line them up **by role** — bookend, card,
shot, card, shot, bookend — not by index. A film that matches on mean shot
length while spending its long shots in the wrong places has the same
statistics and a different shape.

### 4. Measure what the table cannot see

The table is blind to five things, and one of them was the largest gap this
repo has ever found.

| Blind spot | Tool |
| --- | --- |
| Type size and UI legibility | `gap.py ink`, `probe.py type` |
| Colour, by role | `gap.py color` |
| Framing — full-bleed vs floating | `probe.py framing` |
| One small element animating | `gap.py ink` across the frames, by hand |
| Whether the copy is any good | you |

**`ink` normalises both boxes to a common width** (1920 by default). Absolute
pixel sizes across a 1080p reference and a 1440p render are not comparable, and
comparing them anyway tells you everything is fine. Ours read 13 px against the
reference's 30 px at 1920 — that gap was invisible in raw pixels.

**The moving-frames row cannot see a bookend.** A logo mark is ~0.4 % of frame,
under the 0.2 % floor, so a mark that turns, scales and rises can score as
still. Measured on our own sign-off card: real change on every frame from 0 to
27, falling to exactly zero at f28 where the animation ends — and the card
scores 3 % moving. The row answers *is the film restless*, not *is this element
alive*. Use `bookend difference` and your eyes for that.

### 5. Rank

One table, ordered by **(how much a viewer would notice) ÷ (effort)**. Say
plainly which items are craft and which are visible. Every row needs:

| # | Change | Closes | Effort |

And two sections that are as important as the list:

- **What we already got right** — so it does not get "improved" by the next
  person. Name the metrics that are inside tolerance and say they are closed.
- **Not on this list, because they are done** — the specific things a reader
  would otherwise re-litigate.

### 6. Change one thing, then re-score

```bash
python3 $G score ref.mp4 ours.mp4 --json .diag/gap/after.json
python3 $G delta .diag/gap/before.json .diag/gap/after.json
```

`delta` prints reference / before / after / direction for every tracked metric,
and names the ones that regressed. **A row moving the wrong way is not
automatically a bug** — a change that fixes the picture may cost a pacing
metric and that trade can be right. It is a bug when nobody noticed it
happened.

Both scorecards must have used the same thresholds and the same reference;
`delta` warns when they did not, and the numbers are not comparable when it
does.

### 7. Record what got reverted, and why

The reverted changes are the most valuable output of this whole loop, because
they are the only part that stops the next person redoing them. Write down what
was built, which numbers it won, and what it cost on screen.

## Traps

- **A number matched is not a gap closed.** Two of four changes here matched
  their target exactly and were reverted. See "the one rule".
- **Do not compare our measured output against our source constants.**
  Constants lie about what actually renders, and in a repo where several agents
  are working they move under you. Measure both files, through the same code
  path, or do not claim a gap.
- **Do not mix numbers from different tools.** `gap.py` reports Film A at 27.8 %
  moving where [`intro-reel/SKILL.md`](../intro-reel/SKILL.md) records 24.1 %
  for the same film. Both threshold per pixel; the definitions differ somewhere
  that was not isolated before the reference file was deleted from the machine.
  Quote which tool produced a number, and never mix the two in one table.
- **A cut ends a still run.** Letting a cut fall through the counter merges two
  calm shots into one implausibly long rest and over-reports the film's
  stillest moment by ~50 %. `gap.py` breaks the run; if you hand-roll this,
  break it too.
- **Cut detection is pixel-based here, not luma-based**, which is why it finds
  cuts a luma detector cannot: in Film A it caught the recap card hiding at the
  end of a black text card, luma delta 4.5. The cost is that a cut between two
  shots of the same near-static screen is genuinely undetectable. Confirm the
  count on a `sheet`.
- **`ink` fill above 80 % or below 0.05 % means the polarity or threshold is
  wrong**, not that the frame is full or empty. The tool warns; believe it, run
  `probe.py hist` on that frame, and pick a threshold from the histogram.
- **Sample colour on flat areas.** A 6×6 average on an edge or a gradient is a
  blend of two things and belongs to neither. Take coordinates from
  `probe.py grid`; on a dark reference almost every guess returns `#000000` and
  looks like a broken tool.
- **`color` does not scale coordinates for you.** Same X,Y in both files. If the
  two are different sizes, do the arithmetic yourself.
- **Never assume 30 fps.** 60 fps sources are common; at the wrong fps every
  duration and the cut rate are out by 2× and nothing looks obviously broken.
- **The reference can vanish.** Downloads folders get cleaned. Copy any
  reference you are working from somewhere durable before you start, and record
  its filename, size and measured duration in the writeup so a later reader can
  tell whether they have the same file.

## Calibration

Measured by `gap.py score` on the delivered files. Use these to sanity-check the
harness on a machine, not as targets.

| | Film A (reference) |
| --- | --- |
| File | `cursor-agent-ux-imrpovments-intro.mp4`, 1920×1080, 30 fps, 736 kbps |
| Length | 1316 f · 43.87 s |
| Shots / cuts | 12 / 11 — cuts at 98, 194, 336, 431, 583, 679, 806, 902, 997, 1094, 1204 |
| Mean / median shot | 3.66 s / 3.27 s |
| Shortest / longest | 3.17 s / 5.07 s |
| Cut rate | 15.0 /min |
| Moving frames | 27.8 % |
| Median cut delta | 235 · one invisible cut (Δ 4.5, f1094) |
| Bookend difference | 2.3 % |
| Sharpness | 2.22 |
| Audio | present, −31.3 LUFS |

**MEASURED**, one run, on a file that no longer exists on this machine. The
longest-still-run figure from that run is not quoted here because it predates
the cut-breaks-the-run fix and was not re-measured.

Tolerances in `score` are set so the two Cursor reference films pass against
each other on the pacing rows. A tolerance that flags one reference against
another is measuring the film rather than the grammar.

## What to write

For a quick check: the table, the ranked list, and the "already right" section.
Nothing else.

For a full pass, the shape that worked is
[`docs/reel/07-gap-analysis.md`](../../../docs/reel/07-gap-analysis.md):

1. **Headline** — one sentence naming which axis is solved and which is not.
   ("The pacing is solved. The picture is not.")
2. **One section per dimension**, each titled `— closed` or `— GAP`, with the
   paired numbers and a verdict.
3. **What to change, in order** — the ranked table.
4. **Not on this list, because they are done.**
5. **Implemented** — what shipped, what was built and taken back out, and what
   the reverted attempts cost on screen.

Label every claim **OBSERVED / MEASURED / INFERRED / UNKNOWN**, the same four
tags `reverse-engineer-reference` uses. A gap report with no UNKNOWNs in it is
lying somewhere.

## Worked example

[`docs/reel/07-gap-analysis.md`](../../../docs/reel/07-gap-analysis.md) — the
shipped reel against two Cursor launch films, through diagnosis, ranking,
implementation and two reverts. §12 is the part to read twice.
