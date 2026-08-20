---
name: reverse-engineer-reference
description: Take apart a reference video or image frame by frame and turn it into an implementation-ready spec — timing, cuts, easing, type metrics, colour, layout, camera. Use when given a reference to match, asked how something was made, or asked to reproduce a look in a demo, reel, still, or any other output.
metadata:
  tags: analysis, reference, measurement, ffmpeg, motion, spec
---

# Reverse-engineer a reference

Someone hands you a video or an image and says *make ours look like this*. This
is how you turn that into numbers another engineer can build from.

**This is an analysis skill, not a production one.** It does not shoot, render
or cut anything. It produces a spec. What you do with the spec belongs to
`shoot-demo-video`, `intro-reel` or `shoot-still` — see the table in
`AGENTS.md`.

Works on any reference: a launch film, a competitor's demo, a product
screenshot, a design export, one of our own renders.

```
reference  →  probe  →  measure  →  fit  →  spec + confidence labels
```

## The one rule

**Measure it. Do not describe it.**

"Smooth fade-in" is worthless. `translateY +52px → 0 over 13 frames, decay
ratio 0.79/frame, τ ≈ 140 ms` can be implemented. Every claim in the output
must be a number, or be labelled as a guess.

If you catch yourself writing *smooth*, *snappy*, *subtle*, *premium*, or
*dynamic* — stop and go measure the thing you are gesturing at.

## Label every claim

Four tags. Use them inline. Do not let them blur.

| Tag | Means |
| --- | --- |
| **OBSERVED** | Directly visible in a frame. Open the frame and you see it. |
| **MEASURED** | A number the harness produced, reproducible from the file. |
| **INFERRED** | A likely implementation consistent with the evidence, not proven by it. |
| **UNKNOWN** | Cannot be recovered from a rendered file. Say so and move on. |

This matters more than it sounds. The output gets used to change a pipeline. A
reader has to know which numbers they can trust and which are your taste. A
spec with no UNKNOWNs in it is a spec that is lying somewhere.

## The harness

`probe.py`, next to this file. Pure python3 + ffmpeg, no pip installs. Every
subcommand prints the trap that applies to it, so read its output, not just its
numbers.

```bash
P=.agents/skills/reverse-engineer-reference/probe.py

# start here
python3 $P report  ref.mp4 > analysis.md        # whole battery -> md skeleton

# orient
python3 $P info    ref.mp4                      # res, fps, duration, bitrate
python3 $P hist    ref.mp4 --frame 172          # pick thresholds from this
python3 $P grid    ref.mp4 --frame 172 --out /tmp/g.png   # read coordinates off this
python3 $P sheet   ref.mp4 --from 98 --to 140 --every 6 --cols 4 --out /tmp/s.png

# structure
python3 $P cuts    ref.mp4                      # shot table, pacing, motion %
python3 $P framing ref.mp4 --frame 742          # full-bleed or framed, window fit

# measure
python3 $P track   ref.mp4 --from 98 --to 112 --axis y --pol dark
python3 $P scale   ref.mp4 --from 186 --to 205 --band 222,238
python3 $P ink     ref.mp4 --from 98 --to 193 --pol dark
python3 $P type    ref.mp4 --frame 420 --pol dark --crop 1920:300:0:400
python3 $P color   ref.mp4 --frame 145 --at 100,100,ground --at 700,500,ink
python3 $P audio   ref.mp4 --window 2
python3 $P fit     --series 16,9,6,5,4,2,3,2,1,1,1,1,1

# close the loop
python3 $P compare ref.mp4 out/reel/ours.mp4 --label REF --other-label OURS
```

`report` runs `cuts`, `framing`, `hist` and `audio` and emits a markdown
skeleton with the measured numbers filled in and explicit TODOs for everything
that needs eyes. **It is a starting point, not an analysis** — never ship its
output as a spec.

`cuts` decodes the file twice and takes ~25s per minute of 1080p footage, so
`report` is not instant. Everything else is sub-second except `audio` (~4s).

`--pol dark` = bright ink on a dark ground. `--pol light` = the inverse. Getting
this backwards is the most common mistake and it fails loudly — you get one band
covering the whole frame.

**Run `hist` and `grid` before any threshold or coordinate.** The defaults
(90/128) assume a high-contrast card. `hist` shows you where the content
actually lives; `grid` gives you coordinates to sample instead of guessing. Both
cost one command and each saves a wasted pass.

Images work everywhere a video does; a still is just `--frame 0`.

Write scratch files (sheets, frame dumps) to the session scratchpad, never into
the repo.

## Order of operations

Do not skip ahead. Each step tells you where to point the next one.

### 1. Probe before you look

```bash
python3 $P info ref.mp4
python3 $P hist ref.mp4 --frame <a representative frame>
```

Resolution, **fps**, duration, frame count, audio, **bitrate**.

Check the fps. 60 is common for screen captures and social exports, and every
duration you quote depends on it. Check the histogram too: a dark screencast can
be 97 % pure black with all its content above 200, which makes every default
threshold in this harness wrong. Bitrate bounds every
claim you are about to make: under ~1 Mbps for 1080p, a 2 % opacity ramp does
not survive the encoder. "No fade" then means *no fade measurable at this
bitrate*, and you must write it that way.

Note whether there is an audio stream at all. Silence is a design decision.

### 2. Structure

```bash
python3 $P cuts    ref.mp4
python3 $P framing ref.mp4 --frame <mid-shot frame>
```

Gives the shot table, shot-length distribution, cut rate, and the motion
percentage. This is the film's skeleton and most of your pacing section.

`framing` answers the question that decides most of the UI-treatment section:
does the picture bleed to the edge, or float on a backdrop? It compares corner
colour to centre colour rather than measuring ink extent — a full-bleed shot of
a white app page has white corners *and* a white centre, and its inner
whitespace is the app's, not a frame inset. When part of the window matches the
backdrop it refuses to quote a box and tells you to read it off `grid` instead.

**If `cuts` reports zero cuts, do not believe it.** The default `--luma-delta 25`
gate is tuned to films that cut between a black card and white footage. A
reference that stays in one tonal register cuts with deltas of 4–20 and reads as
a single shot. The tool warns when this happens; re-run with `--luma-delta 4`
and confirm every candidate on a contact sheet.

**Read the second list it prints.** High-energy frames with a small luma delta
are word reveals, fast in-shot moves — *or* a cut between two shots on the same
ground, which no luma detector can see. Resolve each one with `ink` before you
publish a shot count. In the Cursor films this is exactly how a recap card
hiding at the end of a black text card was found.

### 3. Look

**This step decides what kind of reference you have**, and that changes what the
rest of the analysis is even for:

| Genre | Looks like | What to measure |
| --- | --- | --- |
| Card film | type cards alternating with footage | card duration, word cadence, exit push |
| Screencast | one continuous flow, no cards | shot segmentation, camera moves, cursor |
| Composited | isolated UI elements on flat ground | element geometry, chip behaviour |
| Still | one frame | layout grid, type metrics, colour, shadow |

Do not assume the card-film shape. A reference with no cards has no word
cadence to find, and hunting for one wastes the pass.

```bash
python3 $P sheet ref.mp4 --from 0 --to 927 --every 15 --cols 5 --out /tmp/all.png
```

One contact sheet of the whole thing, then tighter sheets on anything
interesting. Read them as images. You are looking for *what changes*, not
measuring yet.

Do this before measuring. Measuring the wrong element precisely is the most
expensive way to waste a pass.

### 4. Motion

```bash
python3 $P track ref.mp4 --from 98 --to 112 --axis y --pol dark   # position
python3 $P scale ref.mp4 --from 186 --to 205 --band 222,238       # size
python3 $P ink   ref.mp4 --from 98 --to 193 --pol dark            # reveals
```

- `track` — per-frame bounding box on one axis. Deltas are the motion.
- `scale` — isolates an element by its fill colour and measures it, so it
  survives motion blur. Use it for zooms, punches, window growth.
- `ink` — total ink per frame. Steps up are reveals; the gap between steps is
  the stagger. A collapse to near-zero on an unchanged ground is a hidden cut.

### 5. Fit the curve

Feed the deltas back in:

```bash
python3 $P fit --series 16,9,6,5,4,2,3,2,1,1,1,1,1
```

Returns the decay ratio, time constant, and total travel — and tells you whether
you are looking at an ease-out (entrance) or an ease-in (exit).

**A decaying series that is still accelerating on the last frame before a cut
means the shot was cut mid-move.** That is a deliberate technique, not an
accident, and it is usually what makes cuts feel invisible.

Fit two or three different elements. If they agree, the reference has *one*
curve and you have found it — that is a far stronger finding than any single
measurement.

### 6. Type, colour, audio

```bash
python3 $P type  ref.mp4 --frame 420 --pol dark --crop 1920:300:0:400
python3 $P color ref.mp4 --frame 145 --at 100,100,ground --at 700,500,ink
python3 $P audio ref.mp4 --window 2
```

Always pass `--crop` to `type` on a frame with more than one ground.

`audio` prints loudness, silence gaps, an RMS envelope and then a reading:
continuous bed vs discrete SFX, whether there is a head fade, and how far the
level sits from the −14 LUFS social norm. Cross-check the loudest and quietest
windows against the shot table — if quiet lands on cards and loud on footage,
the bed is ducking or the arrangement is cut to the edit.

No audio stream at all is a finding. Write it down as one: it means the film
must read with the sound off.

**Spec type by cap height and line pitch, never by nominal font-size.**
`font-size` only means something once you know the face's cap ratio, and a
reader with a different face cannot reproduce your film from it. Quote both:
*cap 52 px on an 86 px pitch*.

### 7. Measure our own output through the same chain

Non-negotiable.

```bash
python3 $P compare ref.mp4 out/reel/ours.mp4 --label REF --other-label OURS
```

A comparison of *their measured numbers* against *our source constants* is not a
comparison — constants lie about what actually renders, and in a repo where
several agents are working the constants move under you. Measure both outputs,
through the same code path, or do not claim a gap.

## Traps

Each of these cost real time. They are why the harness exists.

- **`grep -o 'KEY=[0-9.]*'` truncates scientific notation.** ffmpeg emits
  `YAVG=7.37847e-05`; that grep yields `7.37847`, and a still frame gets counted
  as moving. It silently inflated a motion figure from 24 % to 28 % and produced
  a phantom conflict with an earlier, correct analysis. **Parse with `float()`,
  never with a character-class grep.**
- **`showinfo` logs to stderr at INFO level**, so `-loglevel error` silences it.
  `metadata=print:file=-` writes to **stdout**. Two different streams.
- **Averaging an axis destroys thin strokes.** `scale=1920:1` collapses 1080
  rows; a one-pixel antialiased stem averages to zero and vanishes. Frame-to-frame
  *deltas* stay valid because the same glyphs are compared against themselves, but
  **absolute extents under-read**. For a true box use `type`, which reads real 2D
  pixels.
- **Threshold polarity.** Dark ink on a light ground needs `--pol light`. Get it
  wrong and the whole frame reads as ink.
- **Antialiasing defeats colour-band isolation.** A glyph edge passes through
  every luma on its way from ink to ground, so it lands inside any band you pick.
  `scale` erodes 3× then dilates 2× to kill thin strokes and restore the edge.
- **A luma ramp over 8–24 frames is usually not a dissolve.** Check whether its
  first frame is also a shot's first frame. If so it is a hard cut into a shot
  that starts already moving — a completely different technique with a completely
  different implementation.
- **Frames during a very fast move are motion-blurred and unreliable.** Trust the
  endpoints and the settle tail, not the two smeared frames between them.
- **Sample colour on flat areas.** A 6×6 average on an edge or a gradient is a
  blend of two things and belongs to neither.
- **Never assume 30 fps.** 60 fps sources are common; at the wrong fps every
  duration and the cut rate are out by 2× and nothing looks obviously broken.
  `info` and `cuts` read it from the file — do not override unless you know why.
- **Guessed coordinates read as background.** On a dark reference nearly every
  guess returns `#000000` and looks like a broken tool. Use `grid` first, or
  take coordinates from `type`'s output.
- **`track` needs an element that dominates its axis.** It collapses a whole
  row or column, so on a busy screencast it locks onto scattered specular
  highlights and returns 2–7px spans. Crop to the element first, or use `scale`
  with the element's fill band.
- **Not every ffmpeg has `drawtext`** (it needs libfreetype). `grid` falls back
  to unlabelled major/minor lines and tells you the spacing. Check that a
  written file actually exists — ffmpeg can fail a filter and still exit 0 in a
  pipeline.
- **Do not assume one reference is one style.** Two films from the same company
  can share a curve and a type scale while disagreeing on everything else. Check
  before you generalise; a second reference is the cheapest way to find out which
  numbers are the system and which are the film.

## What to write

Length follows the job. A single still needs a section; a 44-second film with a
pipeline riding on it earns a directory. Keep whatever you write in this order —
each part is what the next one is built from.

1. **Executive summary** — the handful of findings that change what we build.
2. **Timeline** — frame-exact shot table, durations, pacing stats. Videos only.
3. **Motion** — transitions, the curve and its fit, entrances, exits,
   micro-interactions.
4. **Composition** — type metrics, colour, layout, framing, cursor.
5. **The system** — invariants, what varies, and the recipe. This is the part
   with a shelf life; the rest is evidence for it.
6. **Implementation mapping** — how each finding becomes code here, and which
   side of the Playwright/Remotion line it falls on.
7. **Comparison** — reference vs. our measured output, and a ranked change list.

Rank the change list by (how much a viewer would notice) ÷ (effort). Say
plainly which items are craft and which are visible. Include a section on **what
we already got right**, so it does not get "improved" by the next person.

## Things that will bite you

- **The repo may move under you.** These analyses get implemented while they are
  being written. Before recommending a change, re-read the constant you are
  about to recommend changing — a subagent's report of the source goes stale
  within minutes. Do not tell someone to redo finished work.
- **Check for prior analysis before starting.** `docs/design/reels/` may already
  hold a measurement record for your reference. Extend it and reconcile with it;
  do not silently produce a second set of numbers.
- **When your number disagrees with an existing one, suspect yourself first.**
  Re-derive with a different method before writing "both cannot be right". The
  scientific-notation trap above was found exactly this way, and the earlier
  document had been right all along.
- **Do not invent components the reference does not have.** If it contains no
  dissolve, do not spec a `<SceneTransition>`. Absence is a finding — write it
  down as one.
- **Two references beat one.** Everything they share is the system. Everything
  they disagree on is a choice, and naming the choice is more useful than
  either film.

## Worked example

`docs/reel/` is a full application of this skill to two Cursor launch films —
2243 frames, both grammars, compared against our own reel. Use it as the shape
to copy, including how the confidence labels and the traps section read in
practice.

Both of those are card films at 30 fps. The harness has also been run against a
60 fps dark screencast with no cards at all, which is what produced `hist`,
`grid`, the fps auto-detection and the low-contrast cut guidance above. If your
reference breaks something here, fix the harness and add the trap — that is how
this skill is supposed to grow.
