# Loop note — Replit choreography

Running record of decisions I took on your behalf, and things you should check.
Newest section last. Started 2026-08-21.

## Standing constraints I am working under

- Must not affect the existing default reel pipeline (`classic` / `proof` are
  the shipped grammars; `DEFAULT_STYLE = "classic"`).
- Do not commit. Everything stays in the working tree.
- New script written by me, not adapted from an existing reel.
- I decide everything else and record it here.

## Decisions

### D1 — Reference is 24 fps, and our pipeline is 30

`Replit Replit X.mp4` MEASURES 1280x720, **24 fps**, 1008 frames, 42.048 s,
541 kbps, with an audio stream.

Every previous reference in this repo (both Cursor films, monid) is 30 fps, and
`FPS` in the render path is 30. Two things follow and I decided both:

1. **Every duration in the spec is quoted in SECONDS, not frames.** A frame
   count is meaningless across a frame-rate change, and silently reading 24 fps
   numbers as 30 fps would stretch the whole film by 25% — the same class of
   error that put every clip range 25% late earlier in this session.
2. **We do NOT move the pipeline to 24 fps.** That would touch every reel and
   every cached segment, which the "do not affect the default pipeline"
   constraint forbids. Motion specified in seconds re-samples to 30 fps
   cleanly; what does not survive is any deliberate 24 fps judder, and I will
   flag it in the spec if I find the film depends on it.

### D2 — Bitrate is low enough to bound what "no fade" can mean

541 kbps for 720p is thin. A sub-2% opacity ramp does not survive that encoder,
so anywhere I report "no fade" it means "no fade measurable at this bitrate",
and the spec says so rather than asserting the film has none.

### D3 — The new style is called `stage`

Named for the grammar, not the company, like every other style here. A fixed
ground that elements enter and leave is a stage. Checked it collides with
nothing: `BACKDROPS` contains `studio` (which is why an earlier style could not
take that name) but no `stage`, and `style.test.ts` enforces that a style name
appears nowhere outside `style.ts`.

### D4 — Most of this grammar already exists, so I did not build a new renderer

I started the plan assuming we needed a new easing function and a new panel
component. Both were wrong, and I corrected the plan rather than building them:

- `src/lib/push.ts` already implements "arrive decelerating, hold, accelerate
  away, leave mid-move" — its docstring describes Replit's envelope almost word
  for word, despite being reverse-engineered from a *Cursor* film.
- `src/WindowFrame.tsx:72-74` already casts a soft dark shadow specifically when
  the backdrop is light, which is exactly Replit's 3.5% lift on cream.
- The inline red pill is already expressible as `==built-in|#F03000==`.
- `LogoLockup` already reveals text one character at a time.

**Worth your attention:** two unrelated launch films (Cursor and Replit)
independently use the same motion envelope. That is stronger evidence it is a
house style of the genre than anything in either analysis on its own.

### D5 — Push length is 11 frames, not 9

Replit MEASURES `r = 0.6451`/frame at 24 fps, which resamples to **0.7042** at
our 30. Our `PUSH_BEZIER` gives 0.6940 over 9 frames and 0.7413 over 11 — their
number sits between ours.

I chose **11 frames** (0.367 s) because Replit's measured settle is 0.372 s: that
is a 1.4% miss on duration against a 5% miss on the decay ratio, and duration is
the one an eye can see. If the render reads sluggish, 10 is the other candidate.

### D6 — What I deliberately left out, and why

- **Floating annotation chips** over the panel (*Scanning 20%*, *Recon*,
  *Fuzzing*…). We have no per-beat overlay concept; the nearest thing is the
  step HUD, which is one centred derived line, not several positioned chips.
  This is a feature, not a preset value. **It is the most visible thing our cut
  will be missing** and I will say so in the comparison rather than let it read
  as a defect.
- **The isometric cubes and the code/website scene.** Almost certainly authored
  artwork. No screen-recording pipeline reaches them. Out of scope permanently.
- **24 fps.** Moving the pipeline off 30 would touch every reel and every cached
  segment, which the standing constraint forbids. The curve is specified in
  seconds and resamples cleanly.
- **Sound effects.** MEASURED: the reference marks none of its clicks with
  audio. `stage` reels get a bed and nothing else. Written down because the next
  author will otherwise add clicks back out of habit.

### D7 — I fixed a bug in the analysis harness

`probe.py audio` crashed with `ValueError: cannot convert float NaN to integer`
on this reference: its silent final window measures -inf dBFS, which poisoned
the envelope's min/max scaling. The skill's own instructions say to fix the
harness when a reference breaks it, so I did — silent windows now print as
`(silent)` and the bars scale against the finite windows only. This touches
`.agents/skills/reverse-engineer-reference/probe.py`.

### D8 — Five things the pipeline was missing, and what I added

Implementing `stage` needed more than a preset entry. Each of these is additive
and defaults to the old behaviour, so `classic`/`proof`/`narration` cannot move:

1. **`ShotStyle.ground`** — a flat colour behind a framed shot. `BACKDROPS` are
   image files and nothing could render a plain fill. `null` on every other
   style means "use the image, as before".
2. **`ShotStyle.zoom`** — whether the framed path runs the click-derived zoom
   camera. `classic` is built on it; the Replit grammar holds its panel
   perfectly still and moves only at section boundaries.
3. **`windowFit` actually wired.** The framed path had been reading the
   `WINDOW_FIT` constant and ignoring the preset field.
4. **`CardStyle.emphasis`** — inline `==markup==` was dropped on a hard branch
   `look === "fullbleed"`. That reasoning is about a grammar, not a look, and
   Replit disproves the coupling: it is flat-ground AND built around a pill.
5. **`FramedPush`** — `push` was full-bleed only. The stage seam needs a windowed
   panel to clear frame, so the framed path now carries the envelope too, with
   the GROUND deliberately outside it so only the panel moves.

### D9 — `dist` is not where the shot ends up, and that cost a render

`pushOut` is `dist * settle(1 - g/frames)`, and the last VISIBLE frame is
`g = frames - 1`. At `frames: 11` that is `settle(1/11) = 0.660` — **the exit
reaches only 66% of `dist` before the cut lands**, and the last third happens on
a frame nobody sees.

I found this by rendering with `dist: 1000` (arithmetic said that clears a
0.84-fit panel) and measuring a third of the panel still on screen at the cut.
Correct value is `994 / 0.660 = 1506`; the preset uses 1520.

Worth knowing generally: `PushMove.dist`'s docstring says it is "where the shot
has got to on the frame the cut lands", and that is not what the code computes.
I did not change the docstring, because the other styles' numbers were tuned
against the real behaviour and a "fix" would invite someone to re-tune them.

### D10 — The pill is Agenta's chartreuse, not Replit's red

The reference's #F03000 is a colour this product does not own. Borrowing it is
exactly the mistake the ledger cut made with monid's blue, which you rejected.
`wordCss` computes readable ink for any pill colour, so #f0f05a gets near-black
type and stays legible on the cream.

Also: the markup is `==text|#hex==`. I wrote `==text==|#hex==` first, which
parses as a palette-coloured pill followed by the literal characters "|#hex" —
visible in the first stage render.

### D11 — Footage is duplicated under `agent-schedule-stage`

`reels/agent-schedule.ts` is the ledger cut and is the only copy of that work
(reels/ is gitignored). Rather than overwrite it to test `stage`, I duplicated
the footage — `public/agent-schedule-stage.{mp4,clicks.json}` and
`out/demo/agent-schedule-stage.mp4` — so both cuts stay renderable. That is
~10 MB of duplication you may want to clean up later.

### D12 — The fresh script is `agent-tool`, and it was chosen for the grammar

`flows/agent-tool.ts` + `flows/agent-tool.selectors.ts`, written from scratch:
open the Tools picker, search 1,327 apps, open GitHub, search its actions.

I picked this flow because of a measurement, not a preference. The reference is
71.4% moving; the schedule demo is 37% because a form being filled in is a still
picture with a cursor on it. The two search fields in this picker are the only
controls in the app that keep a large region redrawing continuously. **The new
footage measures 50.8% moving.**

**It deliberately changes nothing.** Picking an action would be the stronger
payoff and the panel says "added instantly" — i.e. server-side, on your real
workspace. I could not verify a removal path, and a `prepare` that cannot undo
what the take does is how a demo starts shooting over its own leftovers. So the
flow browses and closes, and the payoff moved to the closing card. **If you want
the stronger version, the missing piece is a verified way to remove a tool.**

### D13 — A selector passed the check while clicking the wrong thing

`click: "GitHub"` reported a green tick via `control containing "GitHub"` — and
what it had found was **Star on GitHub** in the left sidebar, *behind* the
picker. Clicking it dismissed the panel and every later step ran against the
bare playground. Nothing in the check output said so; it took a screenshot.

Both the flow and `flows/agent-tool.selectors.ts` now scope panel targets to
`[role="dialog"]`, and the selectors file records the failure. Worth knowing
generally: a green selector check is not proof the right element was hit.

### D14 — Two bugs the frames showed and the numbers did not

Both in the payoff card, both found by opening frames after the score looked
fine:

1. `==1,327 apps|#f0f05a==` rendered as **two separate pills** with a gap.
   `parseHeadline` splits a marked run into word tokens and paints each. Fixed
   in the copy (one word per pill); the reference's pill also wraps one word.
2. A typed pill painted its **filled box before its letters**, so the card
   showed empty yellow rectangles for half a second. Fixed in `wordSchedule`: a
   highlighted unit no longer types, it arrives whole — which is what the
   reference does (at f867 its sentence reads "Your ______" and the pill expands
   into the gap already carrying its word).

A third bug was caught by a test I wrote while fixing those: the leading space
was charged to the previous token, so every unit after the first started one
character early.

### D15 — Structure: the reference has exactly ONE type card

Our first cut opened with a claim card and closed with a payoff. Measured: cards
were 53% of the film, the claim card alone ran 4.53s, and the whole reel scored
16.5% moving. The reference opens on its wordmark and goes straight to product;
its only type card is the last thing before the sign-off. Dropping our opening
card took moving frames to 20.9% and longest still run from 4.20s to 2.17s.

Related, and a real constraint of this grammar: **a typed cadence costs 83ms per
character, so copy length IS card length.** A 47-character line is 4.5 seconds.

### D16 — Default pipeline verified unaffected, three times

`harness` (classic) re-rendered after each stage of this work:
709/900 frames byte-identical, worst PSNR 64.46 dB — encoder noise, well above
the ~50 dB visible threshold. `agent-schedule` (ledger) 565/725 identical, worst
57.9 dB (it has dissolves, which force a re-encode).

382 → 386 tests pass; `pnpm lint` clean.

### Open items for you

1. **`reels/agent-schedule-stage.ts` and its duplicated footage** were a
   validation harness for the style. Delete them and the three
   `public/agent-schedule-stage.*` / `out/demo/agent-schedule-stage.mp4` files
   when you no longer want them (~10 MB).
2. **The `agent-tool` flow leaves no state behind**, but my early *probe* runs of
   it did create a schedule on the PR reviewer agent via repeated
   `agent-schedule --check` runs. The Tools section is clean; the Schedules
   section may hold one "Morning PR audit" row.
3. **Floating annotation chips** are the biggest missing piece of this grammar
   (D6) and are a feature, not a preset value.
4. Nothing is committed, per your instruction.

---

## Round 2 — "the clips are poor quality"

You picked three problems, and I treated them as three. Also: write the capture
ceiling up as an app-side issue → `docs/reels/chorography/capture-ceiling.md`.

### D17 — The softness is a hard ceiling, and I can prove it

`stage` frames footage in a window at `windowFit` and never crops, so the output
panel is always 2150px wide. That locks two things to the SAME ratio:

    upscale = 2150 / capture_width          UI text = 14px x (2150 / capture_width)

Sharper is therefore always smaller. 1280 → 1.68x and 17.6px text at 1080p;
1600 → 1.34x and 14.1px; 1920 → 1.12x and 11.8px. Cropping does not escape it —
any framing that makes text readable lands back on ~1.7x.

**The only real fix is more source pixels per CSS pixel**, i.e. `CAPTURE_SCALE`.
I tested it on this flow: every selector resolved, `prepare` completed, the
overflow probe reported `v=1 h=1 ✓ layout fits` — **and the "Add tool" dropdown
rendered against the right edge of the frame instead of under its button.**

That is the Radix portal bug, now measured on two separate flows, and it is
invisible to every automated check. Written up with the reproduction and the
measured numbers in `capture-ceiling.md`. **Fixing it in the Agenta app roughly
doubles the detail in every demo this repo shoots.**

What I did in the meantime, both free:
- Capture moved 1280 → **1600** (1.68x → 1.34x).
- **Motion blur is off when the camera is static.** `CameraMotionBlur` renders 8
  copies and composites them at fractional opacity, rounding to 8 bits each
  time. With `zoom: false` every sample is the same pose, so it could not smear
  anything — it was 8 rounds of quantisation over an already-upscaled picture.

### D18 — Four clips became one, which is a deliberate break from the grammar

The Replit reference is ~93% footage and two type cards. This reel is now the
inverse: three cards around a single 3.2s shot. **That is against the grammar and
I did it on purpose**, because all three of your complaints pointed at the
footage:

- **Soft** — see D17.
- **Cluttered** — the picker is a full-screen overlay with a connections
  sidebar, a category list and twelve cards. Every frame was a wall of small
  text with nothing for the eye to land on, where the reference always shows one
  thing large.
- **Repetitive cuts** — four shots in 17s, each popping in on a scale and
  sliding off the bottom, each yanking away before its action resolved.

Cards have none of those problems: they render natively at 2560 and are
pixel-sharp. So the cards carry the film and the footage appears once, for the
one beat only footage can tell — a twelve-card grid collapsing to three as the
query is typed, through to the app opening.

Runtime is now **12.5s** (was 17.7s). If that reads short, the honest way to
lengthen it is another card, not another clip.

### D19 — The payoff copy was making a claim the footage never showed

It read "Now it has 1,327 apps." The flow deliberately adds nothing (D12), so
that described something the demo never does. Now "One search. 1,327 apps." —
which is exactly what the footage shows.

I also corrected a comment in the reel that claimed the clip ended before GitHub
opened. It does not; it runs through it, and that is better — but the comment
was wrong for one render.

### Still true after all of this

- `harness` (classic): **709/900 frames byte-identical**, worst PSNR 64.54 dB.
- 386 tests pass, `pnpm lint` clean.
- Nothing committed.

---

## Round 3 — the 30-second cut

Read your brief as: many text cards, exactly two clips, 30 seconds. Built as
ten segments — 29.8s, six type cards, two clips, two logo bookends.

### D20 — The argument the cards make

Six cards, all under 27 characters because a typed cadence costs 83ms per
character and copy length IS card length:

    An agent needs tools.  /  Not ones you build.
    [CLIP 1 — the picker arrives, 1,327 apps]
    Ones you already use.  /  GitHub. Slack. Notion.
    [CLIP 2 — search, filter, down to the action list]
    Down to one action.  /  One search. [1,327] apps.

"GitHub. Slack. Notion." names three apps that are visibly in the grid of the
shot before it, so the claim is checkable against the frame the viewer just
watched. The payoff stays "One search", not "Now it has" — the flow adds
nothing, so a possessive claim would describe something the footage never shows.

### D21 — A metric I nearly misread, and the check that saved it

The whole-film scorecard flags **sharpness 0.98 against the reference's 1.88**,
with the harness's own note: "low = soft footage, usually an upscaled capture".
Taken at face value that says the footage got worse.

It did not. Scoring the two clips ON THEIR OWN, with the cards removed, gives
**3.56 — above the reference and inside tolerance**. The whole-film number is
diluted by six flat cream cards, which carry almost no edge energy by design.
The same metric read 3.05 on the *same capture* when the film had four clips.

So that row measures *how much detail is in frame*, not *how blurred the
footage is*, and on a card-heavy cut it cannot be read the way the label
suggests. Worth remembering the next time this scorecard is used on a film that
is mostly type.

### D22 — One judgement call you can flip in a line

Capture is at **1600** (1.34x upscale, ~14.1px UI text at 1080p). The
alternative is 1280 (1.68x, ~17.6px text). Both start from the SAME 14 CSS px
per glyph — 1600 shows glyphs nearer their native size, 1280 shows them bigger
but blown up more.

I chose 1600 because you said "blurry". If the text now reads too small, the
fix is one line in `flows/agent-tool.ts` plus a re-shoot; it is a legibility vs
crispness trade, not a bug either way. Both are inside `SHARPNESS_CEILING`.

### Still true

- `harness` (classic): 709/900 frames byte-identical, worst PSNR 64.54 dB.
- 386 tests pass, `pnpm lint` clean.
- 2/2 cuts invisible; longest still run 2.20s against the reference's 2.25s.
- Nothing committed.

---

## Round 4 — the logo choreography

You were right: there wasn't one. I had carried `bookend` values across from
another style — `tumbleS`, `turns`, `driftPxPerFrame` — which are the Cursor
grammar's tumble, and never measured the Replit sign-off at all.

### D23 — What the reference actually does with its logo

MEASURED at 24fps, and it does the same thing at BOTH ends (opening f0-f72,
closing f906-f1007 — I checked, rather than assuming the opening was simpler):

    f907-f916   the mark grows, span 79 -> 246px           9f  = 0.375s
    f916-f930   holds ALONE at 246px = 19.2% of frame      14f = 0.58s
    f931-f948   shrinks to ~67px and slides left           17f = 0.71s
    f939-f954   the wordmark writes in beside it           15f = 0.63s
    f954-f1007  settled lockup holds                       53f = 2.2s

The idea is that **the mark performs alone at ~3.7x lockup size, then demotes
itself as the wordmark arrives.** Ours just faded a finished lockup in.

Now a preset field, `BookendStyle.markSolo`, `null` on every other style.

### D24 — The half of it we cannot reproduce, stated as a limit

The reference's mark **assembles**: a dot appears, becomes two rounded shapes,
then four, which arrange into the logo. That needs the mark as separate vector
parts and ours is a single image file, so the build is out of reach. What is
reachable — and is the more transferable half — is the scale-and-position
story. Recorded as a ⧗ on the type rather than left as a silent gap.

### D25 — Two implementation notes worth knowing

- **The lockup re-centres with a percentage translate.** During the solo the
  mark must sit at frame centre, but it lives at the LEFT end of a flex row, so
  the row is slid right by 0.42 of its own width. A percentage translate
  resolves against the element's own width, so this needs no measurement at
  render time. MEASURED on the reference: its mark's centre sits 184px left of
  its 435px lockup's centre = 0.42. Our lockup is proportioned similarly, which
  is why the same fraction lands.
- **`minS` went 2.2 -> 3.0.** The solo needs 1.67s before the lockup even
  exists, so the old floor would have cut the mark off mid-performance. The
  reference's two bookends are NOT the same length — opening 3.0s, closing 4.2s
  — and `minS` is one number for both. 3.0 matches its opening exactly. Splitting
  it into two fields is machinery for a difference nobody will time.

### D26 — Runtime is 30.7s, not 30.0s

The solo added 2.6s across the two bookends. I took it back by trimming both
clips slightly (clip 1 0.3→0.4 and 5.4→5.3, clip 2 5.4→5.5 and 11.6→11.2) and
setting `minS` to 3.0 rather than the 3.6 the closing bookend would have liked.
Landing exactly on 30.0 would have cost a card or a beat of footage, which is a
worse trade than 0.7s of overrun.

### Still true

- `harness` (classic): **708/900 frames byte-identical**, worst PSNR 64.59 dB.
  `markSolo: null` collapses every value in the lockup back to its old one, and
  the transform property is omitted entirely rather than set to identity.
- 386 tests pass, `pnpm lint` clean. Nothing committed.

---

## Round 5 — frame-by-frame gap check

Full paired comparison written up in `docs/reels/chorography/replit.md` §9.
Short version:

**Matched:** ground colour EXACTLY (dE76 = 0.0), longest still run (2.20s vs
2.25s), 2/2 invisible cuts, loudness, bookend difference, the logo
choreography, and footage sharpness (3.56 measured on the clips alone, above
the reference's 1.88).

**Three real gaps, ranked:**

1. **UI text is 2.1x smaller.** MEASURED: their isolated popover carries 17px
   line bands in a 720-tall frame (2.36% of frame height); our picker carries
   12-16px in a 1440-tall frame (1.11%). They isolate ONE component and show it
   large; we show a whole application. Not fixable by shooting differently —
   text size and upscale are the same ratio, so it needs the app-side portal fix
   in `capture-ceiling.md`.
2. **The film is half as colourful.** MEASURED over every frame: mean saturation
   4.87 vs 2.50, p90 6.31 vs 3.59. Their red chips, blue buttons and orange
   imagery against our grey-on-cream. Most of this is the annotation chips,
   already scoped out in D6 as a feature rather than a preset value.
3. **Motion 21.3% vs 71.4%** — now by request rather than by accident. Six cards
   and two clips means footage is 34.5% of runtime, so the ceiling is ~48%.

**Flagged but not gaps:** fps (a decision), every pacing row (the reference is
one 42s take, so they compare against a single shot — the harness says so
itself), whole-film sharpness (diluted by six plain cards; clips alone score
3.56), and bookend difference (we are MORE consistent than the reference).

---

## Round 6 — closing the gaps

### D27 — Floating annotation chips are now built

The biggest gap in the frame-by-frame check, and previously scoped OUT as "a
feature, not a preset value" (D6). You said fix it, so I built it:

- `src/lib/chips.ts` — the model, pure, with validation.
- `src/ChipOverlay.tsx` — a transparent Remotion composition.
- `scripts/reel.ts` — `overlayChips`, a post-concat pass chained after the HUD.
- `StylePreset.annotation` — the look, `null` on every other style.
- `Reel.chips` — authored per reel.

**Authored, not derived, and that is the difference from the step HUD.**
`hudSteps` reads the click log because a step IS a press. A chip names something
the footage does not say out loud — "1,327 apps", "every action" — and no
recording carries that. The reference's own chips are motion graphics, not UI.

MEASURED off the reference at f645, which carries four at once: pills 50-55px
tall in a 720-tall frame = **7.3% of frame height**, five times the 17px UI text
in the same shot, sitting at the panel's EDGES and straddling its boundary.
Fill #EF3004 — the same brand red as its mark.

**Ours are chartreuse, not red.** #EF3004 belongs to Replit. #f0f05a is the
Agenta mark's own colour, and it keeps one accent language across the film — the
inline `==1,327|#f0f05a==` pill in the payoff card and a floating chip over
footage are visibly the same object.

Chips clear BEFORE each shot's exit begins, because the shot slides 1520px down
over its last 11 frames and the chips do not travel with it — one still on
screen would hang in the air over bare ground.

### D28 — What the chips fixed, and what they could not

| | before | after | reference |
| --- | --- | --- | --- |
| moving frames | 21.3% | **23.4%** | 71.4% |
| saturation (mean) | 2.50 | **2.66** | 4.87 |

Smaller than I wanted on colour, so I measured why rather than adding more
chips. **Footage-only saturation: ours 1.63, theirs 4.99.** It is not the cards
diluting the average — our clips are genuinely three times less colourful than
theirs. Their sections are an orange website mockup, syntax-highlighted code and
blue action buttons; our app's UI is grey and white.

So the colour gap is largely the two PRODUCTS' own palettes, not choreography.
The chips closed the part that was ours to close. Adding more would be decoration
rather than annotation, and you already told me the frames were too cluttered.

### D29 — The text-size gap is confirmed unfixable here

MEASURED: their isolated popover carries 17px line bands in a 720-tall frame
(2.36% of frame height); our picker carries 12-16px in a 1440-tall frame (1.11%).

I checked whether a tighter framing could close it and it cannot: to reach 2.36%
we would need to capture at ~884px wide, which is a 2.43x upscale — well past
`SHARPNESS_CEILING` of 1.74. Their popover shot is almost certainly a separately
composed asset rather than a crop of a screen recording, which is how it is both
large AND sharp. This stays blocked on `capture-ceiling.md`.

### Still true

- `harness` (classic): **713/900 frames byte-identical**, worst PSNR 64.35 dB.
  `annotation: null` and an empty `chips` list make `overlayChips` return its
  input untouched, so a reel without chips pays no extra encode at all.
- **395 tests** pass (9 new for the chip model), `pnpm lint` clean.
- Nothing committed.

---

## Round 7 — making the chips good

Re-scored (no change: same 4/13, the eight flags are the same structural ones),
then went back to the reference and studied the chips properly, because my first
implementation had them scale into place and it looked stuck on.

### D30 — Three measured findings that changed the chips

Written up in `docs/reels/chorography/replit.md` §10.

1. **They fly in from off-screen.** MEASURED on "Recon" (f626-f650): it travels
   ~385px inward while shrinking, entering from OUTSIDE the frame. All four
   arrive at once, each from its nearest edge — the frame goes from bare to
   annotated in one gesture.
2. **They settle on a much SLOWER curve than anything else in the film.**
   MEASURED r ~= 0.89/frame at 24fps: ~1.4s to settle, against 0.37s for every
   panel entrance. That difference is the craft — a chip is an annotation
   arriving *over* a scene, not part of the scene moving, and giving it the
   scene's snap makes it read as UI rather than commentary.
3. **They shrink as they arrive, and never fade.** 1.47x on entry settling to 1;
   fully opaque from the first frame, just outside the picture.

### D31 — The travel distance is derived, not authored

Recon's settled centre sits 0.284 from the left edge plus its own 63px
half-width = 426px, against ~385px measured travel — i.e. **it starts flush with
the frame edge**. So `ChipOverlay` computes the distance from each chip's own
placement rather than taking a number. A fixed distance would have worked for a
corner chip and left a centre-ish one sliding in from nowhere.

The half-width is cleared with a percentage translate, which resolves against
the element, so it needs no measurement and works for any label length.

### D32 — What it bought

**Moving frames 23.4% -> 34.0%** against the reference's 71.4%. The flight is
worth ten points on its own, because each chip crosses the frame for over a
second instead of popping in one. For the whole arc: 15.1% -> 21.3% -> 23.4% ->
34.0%.

Saturation moved 2.66 -> 2.73 (reference 4.87). As established in D28 that gap
is mostly the two products' own palettes, not something more chips would fix.

### Still true

- `harness` (classic): **714/900 frames byte-identical**, worst PSNR 64.55 dB.
- 395 tests pass, `pnpm lint` clean. Nothing committed.

---

## Round 8 — the flight was wrong, and the metric said it was right

You were right that the fly-in looked worse. Recording this one carefully
because the numbers pointed the other way.

### D33 — Measured +10 points of motion, and reverted it anyway

| | flown in | unrolled |
| --- | --- | --- |
| moving frames | **34.0%** | 24.1% |

The flight gained ten points on the film's single worst metric and it still had
to go. The reference's chips cross a website mockup of big flat shapes with wide
empty cream margins; ours cross a dense app picker — sidebar, category list,
twelve cards — and a pill sliding over that for 1.4s reads as noise rather than
annotation. **The slow settle that gives the reference its floating quality is
exactly what made ours distracting**, because it keeps the pill moving for a
third of a four-second shot.

So the 10 points were real motion that the eye reads as clutter. That is the
compare skill's ONE RULE in practice: measure to find the gap, do not measure to
choose the fix. **This is the third time in this repo a measured reference
number has had to be reverted on sight** — the first two are in
`docs/reel/07-gap-analysis.md` §12, and the shape is identical every time: a
number reproduced without the thing that made it work over there.

### D34 — What replaced it: the chip UNROLLS in place

From the edge nearest its own anchor, over 0.21s, on the film's own 0.645 curve.
A wipe, not a slide. Nothing crosses the picture, the gesture is a fifth of the
length, and it reads as a label being applied to the thing under it.

**Not invented — it is the reference's own vocabulary, borrowed from its card.**
Its inline `built-in` pill expands over 5 frames with ink deltas 5077, 3022,
2196, 1531, 877, ratios averaging 0.6447. The same curve, applied to a pill.

Two implementation notes:
- **`clip-path`, not `scaleX`.** A scale stretches the letterforms as the pill
  grows and squashes them on the way out; clipping reveals the text at its true
  width, so the type is correct on every frame.
- **Each pill grows AWAY from the frame edge it is pinned to**, so a chip on the
  right unrolls right-to-left and one on the left unrolls left-to-right.

The two chips over clip 1 are now staggered 0.17s rather than arriving together.
Together made sense for the flight — one big gesture — but a wipe is small, and
two at once reads as one event happening twice.

The flight is fully written up in `replit.md` §10 including why it was rejected,
so nobody re-derives it from the measurements and re-implements it.

### Still true

- `harness` (classic): **713/900 frames byte-identical**, worst PSNR 64.69 dB.
- 395 tests pass, `pnpm lint` clean. Nothing committed.

---

## Round 9 — DEFAULT_STYLE is now `proof`

You asked for it; here is exactly what it did.

### D35 — First, a correction to my own reporting

I had been calling `harness` "the classic pipeline" in every regression report
in this session. **It is not.** `reels/harness.ts:76` sets `look: "fullbleed"`,
which `resolveStyle` maps to **proof**. Every byte-identity check I ran was
proving `proof` unaffected, not `classic`. The checks were valid; my label was
wrong.

### D36 — The change restyles two reels, and that is the point

`DEFAULT_STYLE` moved `"classic"` → `"proof"`. Its old docstring said this was
load-bearing, and it was right:

- `reels/agent-skill.ts` and `reels/agent-slash-command.ts` name neither a
  `look` nor a `style`, so **both moved from the framed window to full-bleed.**
- `harness.ts` names `look: "fullbleed"` and is unaffected — verified,
  **712/900 frames byte-identical**, worst PSNR 64.82 dB.
- The three styled reels (`agent-schedule`, `agent-schedule-stage`,
  `agent-tool`) name a style and are unaffected.

Re-rendered `agent-skill` to see it rather than assert it: white cards on a dark
backdrop with a framed window became warm cream cards with full-bleed footage.
22.7s → 22.4s. Both are coherent films; the new one is arguably cleaner.

**`agent-slash-command` is also restyled but cannot be rendered to confirm** —
it still points at the deleted `slash-theme.mp3` (a pre-existing break, noted
earlier in this session, unrelated to this change).

**To pin a reel against this, give it `look: "framed"` explicitly.**

### D37 — The change forced a real correctness fix in `resolveStyle`

The shim was:

    if (style) return style;
    if (look === "fullbleed") return "proof";
    return DEFAULT_STYLE;

While the default was `"classic"`, `look: "framed"` could fall through and mean
the right thing. With `"proof"` as default, falling through would resolve a reel
that **explicitly asked for the framed window** to a full-bleed grammar. Both
looks are now mapped by name. A look that is named is an instruction, not an
absence.

### D38 — Four tests were asserting classic's arithmetic, not their own intent

All four went red, and three of them were badly written rather than newly wrong:

- **"no style is the same as the default style"** hardcoded `"classic"` instead
  of `DEFAULT_STYLE` — so the test named after the invariant stopped guarding it
  the moment the default moved. Now reads `DEFAULT_STYLE`.
- **"puts a word on the very first frame"** asserted `startS === 0`. The rule is
  *no empty first frame*; classic starts at 0 and proof at −0.17 because its
  grammar cuts INTO the reveal. Now asserts `<= 0`, over both styles.
- **"ignores a subhead that is not there"** compared `settledS` to the last
  word's `endS`. Under proof, a two-word card's whole reveal lands before frame
  0 (last word ends at −0.010s) and `settledS` clamps to 0 — a card cannot be
  settled before it starts. Now asserts against the clamp, over both styles.
- **"defaults to classic"** was genuinely about the old decision. Rewritten to
  state the new one, plus a new test that an explicit `look: "framed"` still
  resolves to classic.

396 tests pass, `pnpm lint` clean. Nothing committed.

---

## Round 10 — `narration` merged into `ledger`

Done. `STYLES` is now `classic, proof, ledger, stage`.

### D39 — Which values survived, and why

**`ledger`'s, unchanged.** `reels/agent-schedule.ts` names it, its output has
been byte-checked repeatedly this session, and `narration` had NO reel using it.
Verified after the merge: **565 frames identical, worst PSNR 57.03 dB** — the
same band as before (it has dissolves, which force a re-encode).

The two presets measured 79% identical across 85 comparable fields — same
motionLayer, look, isolate framing, still cards, no HUD, no chrome, and the SAME
card timing. Only two of the eighteen differences were mechanism:

    join        Film B CUTS       ledger dissolves over 6 frames
    shot.enter  Film B pushes     ledger holds still
                scale -0.106/23f

ledger kept its own on both.

### D40 — The cost, stated plainly: Film B is no longer reproducible

That is not a side effect, it is what merging two grammars into one means. I
preserved everything I could:

- `cursor_origin_intro.mp4` stays in `REFERENCE_FILMS` with **`style: null`** —
  the same honest value Uber's film carries: MEASURED, and nothing implements
  it. Its entry now records the dropped type scale, palette, bookend floor and
  targets, so re-adding the preset is a data change, not a re-measurement.
- The two docstrings were MERGED rather than one being deleted. Film B's
  measurements are what justify half of ledger's values — the zero-translation
  finding that makes the cards hold still, and the length-follows-copy model
  that ledger's 1.16s hold was carried from in the first place.

### D41 — Two tests were guarding behaviour that now exists nowhere

Rather than repoint them blindly, I said so in each:

- **"assigns narration's grounds by role"** asserted Film B's three-ground code
  (white narrates / warm grey is the workbench / black is third-party). ledger
  has two grounds. Rewritten to guard ledger's own scheme — one working ground
  plus a single accent — with a note that the role scheme is now recorded only.
- **"scales narration's shots in"** asserted Film B's 0.894-over-23-frames push.
  Rewritten to assert the opposite — that ledger holds its shots still — because
  that is one of the two mechanism differences the merge had to choose between.

Three others were repointed at `ledger`, which carries the same values. And
`isStyle` now asserts **`!isStyle("narration")`**, so a reel still naming it
fails validation loudly instead of silently falling back to the default.

One test also got better on the way through: the bookend-floor test hardcoded
Film B's 3.0s. It now asserts a floor EXISTS across ledger and stage, because
the number is per-style (2.2s and 3.0s) and pinning one made the test about that
style rather than about the rule.

396 tests pass, `pnpm lint` clean. Nothing committed.
