# Choreography styles

Feature spec for selecting a reel's **choreography style** — a named preset that
sets both the visual look and the motion grammar. Companion to
[fullbleed.md](fullbleed.md) and [audio.md](audio.md); the measurements it rests
on are in [`docs/reel/`](../../reel/).

**Nothing here is built.** Status: spec, open questions listed at the end.

---

## Why

We reverse-engineered two Cursor launch films into `docs/reel/`. They are not one
style with variation — they are **two grammars**.
[`04-design-system.md`](../../reel/04-design-system.md) §2 already names them:

- **Grammar A — Proof.** Full-bleed footage between black cards, cut
  metronomically. Shots are static, so the *cards* carry the motion.
- **Grammar B — Narration.** Sentences that *contain* live UI, punched into,
  with components isolated on a flat ground. Cards are static, so the *shots*
  carry the motion.

Today only Grammar A is buildable, and only because its numbers were hand-typed
into `src/lib/intro.ts` as the `look: "fullbleed"` branch. Cutting a reel in
Grammar B would mean editing those constants — i.e. changing every existing reel.

**The feature:** a reel picks a named style, and that one field decides both the
look and the motion. Same footage, same reel file, one field changed, two
measurably different films.

**More reference films are coming,** so the style set is an open registry. That
gives the single most important rule here:

> **A preset is data. No code branches on a style's name.**
> `introTiming`, `Intro.tsx`, `DemoClip.tsx` and `RecapCard.tsx` read *fields* off
> the resolved preset. Adding a film is one line in the enum plus a table entry —
> and if a component has to change to support a new film, the preset type is
> missing a field. That is the design signal to act on, not a reason to branch.

---

## Spec

### 1. Where it lives

New file **`src/lib/style.ts`**, under the constraint that produced
`src/lib/look.ts`: `reel.ts` imports `intro.ts`, so anything both must name sits
below both. `style.ts` may import only leaves — `./look` for `ReelLook`, `./push`
for the `PushMove` / `PushAxis` *types*. It must **never** import `intro.ts`: the
preset table owns the numbers, and `intro.ts` reads them.

```ts
export const STYLES = ["studio", "proof", "narration"] as const; // one line per film
export type ReelStyle = (typeof STYLES)[number];
export const DEFAULT_STYLE: ReelStyle = "studio";
export const STYLE_PRESETS: Record<ReelStyle, StylePreset>;
export function resolveStyle(input: { style?: ReelStyle; look?: ReelLook }): ReelStyle;
```

### 2. The preset type

Grouped by **which layer the motion acts on**, because that is the invariant that
makes a grammar a grammar rather than a bag of numbers.

```ts
type StylePreset = {
  look: ReelLook;                          // derived, still overridable (§4)
  motionLayer: "cards" | "shots" | "both";
  card:    { staggerS; staggerMinS; wordInS; holdS?; holdAfterTextS?;
             trimInS; minS?; maxS?; enter?: PushMove; exit: CardExit };
  shot:    { framing: "zoomCamera" | "crop" | "isolate";
             enter?: PushMove; exit?: PushMove;
             cursor: boolean; ripple: boolean; chrome: boolean; windowFit?: number };
  chip:    { punchScale; punchS; leadS; settleS; creep?; recover? };
  bookend: { tumbleS; turns; driftPxPerFrame?; driftFrames? };
  recap:   { leadS; lockupStaggerS; itemsLeadS; itemStaggerS; rise; riseS; ground };
  source:  { file: string; shots: number; durationS: number } | null;
  targets: GrammarTargets | null;
};

type GrammarTargets = {
  meanShotS: number; cutsPerMin: number;
  movingFrac: number; longestStillF: number; cutDelta: "slam" | "matched";
};
```

`shot.framing` turns three unrelated code paths into a data choice:
`"zoomCamera"` = today's click-derived camera (`src/lib/zoom.ts`), `"crop"` = the
static pan in `src/lib/crop.ts`, `"isolate"` = the `{rect, fill}` route **already
built and tested** in `crop.ts`.

`source` and `targets` are what make "measured, not invented" enforceable rather
than aspirational — see [Verification](#verification).

### 3. The preset table

| Field | `studio` | `proof` | `narration` | Lives today at |
| --- | --- | --- | --- | --- |
| `look` | framed | fullbleed | fullbleed | `look.ts:18-20` |
| `motionLayer` | **both** ⚠️ | cards | shots | *(new)* |
| `card.staggerS` | 0.16 | 0.16 (fitted) | ⧗ | `intro.ts:406` |
| `card.staggerMinS` | — | 0.1 | ⧗ | `intro.ts:661` |
| `card.wordInS` | 0 | 0 | 0 | `intro.ts:~418` |
| `card.holdS` | 1.2 | — | — | `intro.ts:425` |
| `card.holdAfterTextS` | — | 2.07 | variable ⧗ | `intro.ts:441` **and** `push.ts:68` |
| `card.trimInS` | 0 | 0.17 | ⧗ | `intro.ts:449` |
| `card.minS` / `maxS` | — | 3.2 / 3.3 | ~1.03 / ~2.97 | `intro.ts:664`, `:459` |
| `card.enter` | — | `{y, 56, 14f}` | `{none}` | `intro.ts:674-675` |
| `card.exit` | `{scale, 0.04, 0.35s}` | `{x, −72, 13f}` | `{none}` | `intro.ts:678-682`, `:740`, `:756` |
| `shot.framing` | `zoomCamera` | `crop` | `isolate` | `zoom.ts` / `crop.ts` |
| `shot.enter` / `exit` | — | 114/15f, 72/13f *(recorded, unapplied)* | ⧗ | `push.ts:55-58` |
| `shot.cursor` / `ripple` | true / true | false / false | true / false | `DemoClip.tsx:~95` |
| `shot.chrome` / `windowFit` | true / 0.86 | false / — | false / — | `window.ts` |
| `chip.punchScale` | 4 | 4 | **7.8** — but see Q4 | `intro.ts:~829` |
| `chip.punchS` | 0.45 | 0.45 | **0.1 (3 f)** | `intro.ts:~797` |
| `chip.creep` / `recover` | — | — | +5 %/10 f, −14 %/5 f | *(new)* |
| `bookend.tumbleS` / `turns` | — | 0.85 / 1 | 0.85 / 1 | `intro.ts:~613` |
| `recap.ground` | — | `#16120D` (measured) | ⧗ | currently `#08080a` |
| `source` | **null** | Film A, 12 shots, 43.87 s | Film B, 17 shots, 30.90 s | `docs/reel/README.md` |
| `targets` | **null** | 3.66 s · 15.0/min · 24.1 % · 110 f · slam | 1.82 s · 31.1/min · 36.8 % · 75 f · matched | `docs/reel/README.md` |

⧗ = fill from `docs/reel/` during implementation. Do not guess these.

**`studio` keeps `source: null` and `targets: null` deliberately.** It predates
both films and was tuned against our own backdrop. Recording "this one is not
measured" in the data is what stops a later pass backfilling Film A's numbers into
it — the exact category error [`06-comparison.md`](../../reel/06-comparison.md) §6
caught once, when a reference-derived rule (no click ripple) was applied to the
framed look and silently restyled the back catalogue with no way to switch back.

⚠️ **`studio.motionLayer = "both"` is a finding, not a target.** Its cards push 4 %
*and* a click-driven camera runs — it breaks the one-layer invariant that both
references obey. It predates them, so this is recorded rather than fixed.

**Audio is deliberately not in the preset.** Film A is a −31.3 LUFS bed, Film B
ships silent. A style that silently mutes or un-mutes a reel is a nasty surprise,
and `audio` / `sfx` / `loudnessLUFS` are already per-reel. At most, print the
style's reference loudness as an advisory line in `scripts/reel.ts`.

### 4. Deriving `look`, staying overridable

Precedence, narrowest first: **card `look` → reel `look` → `preset.look` →
`DEFAULT_LOOK`.** The card-level override already works via the spread order at
`scripts/reel.ts:254`.

Legacy shim — `resolveStyle({ style, look })`:

1. `style` set → use it
2. else `look === "fullbleed"` → `"proof"`
3. else → `"studio"`

**This is a shim, not a bijection, and the docstring must say so.** `narration` is
*also* `look: "fullbleed"`, so `fullbleed → proof` is only correct as an
interpretation of input written before `narration` existed. Every reel on disk
today predates it, so it is exact for all of them.

Validation in `reelProblem` (beside the existing `look` check): reject an unknown
`style`; **allow** `style` + `look` together (that is the override); reject the
one contradiction `style: "studio"` + `look: "fullbleed"`, which cannot mean
anything coherent.

### 5. Threading

Mirrors the seven hops `look` already takes. ▲ = new site.

| Hop | File | Change |
| --- | --- | --- |
| 0 ▲ | `src/lib/style.ts` *(new)* | enum, presets, `resolveStyle` |
| 1 | `src/lib/reel.ts:202` | `style?: ReelStyle` beside `look?` |
| 1b ▲ | `src/lib/intro.ts:59` | `style?` on `IntroStoryboard` — **required**, or `scripts/render-intro.ts:109` (passes only `{ intro }`) can never see a reel-level value |
| 2 | `src/lib/reel.ts:21` | re-export `STYLES`, `DEFAULT_STYLE`, `ReelStyle` |
| 3 | `src/lib/reel.ts:272-273` | validate (§4) |
| 3b ▲ | `intro.ts` `introProblem` | validate `style` |
| 4 ▲ | `scripts/reel.ts:236,239-240` | fold `style` into the cache key **only when set**, `look` key first, so a look-only reel serialises byte-identically to today |
| 5a | `scripts/reel.ts:254` | push `{ style, look, ...segment.card }` — reel first, card overrides |
| 5b | `scripts/reel.ts:278-293` | gate becomes `preset.look === "fullbleed"`; keep every key omitted-when-unset |
| 6a | `intro.ts:964` `introTiming` | read `preset.card.*` instead of branching on `look` |
| 6b | `intro.ts:333` `introLook` | palette becomes preset-driven |
| 6c | `src/Intro.tsx:439,457-476` | push spec reads `preset.card.enter/exit` |
| 6d | `src/RecapCard.tsx:89` | **easy to miss** — resolves the look independently of `Intro.tsx` |
| 7 | `src/DemoClip.tsx:437,326` | dispatch on `preset.shot.framing`; keep the bare `look` prop working |
| ▲ | `scripts/reel.ts:113-127` **and** `:131-144` | add `src/lib/style.ts` to **both** `SOURCES.card` and `SOURCES.clip` |

**Not threaded:** `scripts/render.ts`, `scripts/clip.ts`. A style is a *reel*
concept; `out/demo/<name>.mp4` is footage and stays untouched, keeping the
demo/reel boundary in `AGENTS.md` intact.

**Kill the `SOURCES` bug class while here.** Miss either list and editing a preset
serves stale cached segments. Move `SOURCES` to `scripts/lib/sources.ts` (it can't
be imported today — `scripts/reel.ts` runs `main()` at module scope) and add a test
walking the transitive relative-import closure of `Intro.tsx` / `DemoClip.tsx`,
asserting it is a subset of the declared lists.

### 6. Migration — no output change

**Phase 1 moves where numbers are typed, never what they are.**

1. `studio` and `proof` are populated by copying literals out of `intro.ts` — no
   arithmetic, no rounding, no "while we're here".
2. `intro.ts` keeps every exported name as an alias
   (`export const CARD_RISE = STYLE_PRESETS.proof.card.enter.dist`), so no call
   site in `Intro.tsx` or the tests changes.
3. A card with `look: "fullbleed"` and no `style` resolves to `proof`, whose
   values are byte-copies, so every branch takes the values it took before.
4. `scripts/reel.ts` emits **exactly the same prop objects**.

Constants to reconcile — two → one, not two → three:

| Constant | Today | Resolution |
| --- | --- | --- |
| `HOLD_AFTER_TEXT_S` | declared **twice** — `intro.ts:441` (read) and `push.ts:68` (read only by its own test) | preset owns it; `intro.ts` aliases; delete `push.ts:60-68` |
| `PUSH_IN_FRAMES` / `PUSH_OUT_FRAMES` / `PUSH_IN_DIST` / `PUSH_OUT_DIST` | `push.ts:55-58`, referenced by **nothing** | move into `proof.shot.enter/exit` as **recorded but unapplied**; delete from `push.ts` |
| `CARD_RISE` / `CARD_RISE_FRAMES` / `CARD_EXIT_DEFAULT` | `intro.ts:674-682` — the **live** card defaults | seed `proof.card.enter/exit` from *these*, not the `push.ts` quartet |

⚠️ **Do not wire `proof.shot.enter/exit` as live defaults.** A full-bleed clip with
no `push` currently does not move; defaulting them would silently animate every
clip in `reels/harness.ts` and destroy byte-identity. Record them; apply them
deliberately, later.

---

## Phases

**Phase 1 — mechanism + the two styles we already have.** `style.ts`, the
threading table, constant reconciliation, validation, the `SOURCES` closure test.
Deliverable: byte-identical renders of every reel in `reels/`, and `harness.ts`
able to say `style: "proof"` and produce the same file as `look: "fullbleed"`.
**No new behaviour ships.**

**Phase 2 — `narration`, the cheap two-thirds.** Mostly preset numbers plus one
real change in `introTiming`:

- *Static cards.* `card.enter/exit = {axis:"none"}`. The transform side already
  works — `pushEnvelope` honours `"none"`. The missing half is **length**:
  `introTiming` ignores `enter`/`exit` and clamps to `CARD_MIN_S`/`CARD_MAX_S`
  with a rigid 2.07 s tail, where Film B measures 31–89 f cards with a variable
  21–47 f tail. So `minS` / `maxS` / `holdAfterTextS` become preset-driven inside
  `introTiming` — which is exactly where card length must live, because
  `introDurationInFrames` (`intro.ts:1116`) feeds `src/Root.tsx:98,116` and Studio
  and the renderer disagree otherwise.
- *Chip punch retune* — see Q4.
- *Cut tonality.* `narration` assigns grounds by role, giving cut deltas mostly
  <30 against `proof`'s ~200 slams. `introLook` returning a preset palette; no new
  mechanism.

**Phase 3 — isolated component shots.** 5 of Film B's 17 shots. The mechanism
**already exists**: `crop.ts`'s `{rect, fill, isolate}` route, with
`COMPONENT_FILL 0.85` sitting mid-band of Film B's measured 79.9–89.9 %. It was
built, measured and reverted for `proof`
([`07-gap-analysis.md`](../../reel/07-gap-analysis.md) §12) because it floats the
component on a mat and turned a full-bleed film into a slide deck. **That
rejection was style-specific, and this is the style it was rejected in favour
of.** Cost is capture, not code — `crop.ts` is explicit that isolation must not be
used to buy text size out of a too-small capture. Budget a **re-shoot at a higher
`CAPTURE_SCALE`**, not a rendering change.

**Phase 4 — defer.** Chip morph (`[＋]` → `[＋ New]`, 9 f) and in-place chip swap:
content variations on an existing component, one shot in seventeen each, needing a
width they can't derive. Also promoting `motionLayer` from advisory to error.

---

## Verification

**Step 0 — settle the contract first.** On a clean tree, render one reel twice
with the segment cache cleared between runs and `shasum` both. If the toolchain is
not deterministic run-to-run, "byte-identical" is unprovable and the contract
becomes "zero per-pixel delta". This decides the shape of everything below.

**Step 1 — cheap proof (unit, seconds).** In `src/lib/intro.test.ts`, over
fixtures covering sentence / chip / recap / logo cards:

- `introTiming(card)` deep-equals `introTiming({...card, style: "studio"})`
- `introTiming({...card, look: "fullbleed"})` deep-equals `{...card, style: "proof"}`
- `introDurationInFrames` unchanged for every fixture — the one that protects
  `Root.tsx`

Plus a `reel.test.ts` case asserting a look-only reel's cache key serialises
exactly as today.

**Step 2 — render proof.** Adding `style.ts` to `SOURCES` invalidates every cached
segment by construction; that *is* the test. Render all reels before, keep
`.diag/reel/<name>/*.mp4`, apply phase 1, re-render, compare **per-segment** files
positionally — comparing only the concatenated output tells you nothing about
which hop broke.

**Step 3 — prove a style changed the grammar.** Four numbers, per
`.agents/skills/intro-reel/SKILL.md` §4, using the per-pixel-threshold metric
(>0.2 % of pixels changing by >8/255) — **not** YAVG, which the docs record as
having produced a phantom 52 % defect. `scripts/analyze.ts` measures the *old*
signals (`scdet`, frozen runs, sharpness); add a `grammar` mode and an
`--expect <style>` flag reading `STYLE_PRESETS[style].targets`. That closes the
loop: a preset cannot drift from its reference without a test going red.

**Acceptance for the whole feature:** a `narration` cut of `harness.ts` lands near
1.82 s mean shot / 31 cuts per min / 37 % moving / 75 f longest still / deltas
<30, and a `proof` cut of **the same footage** lands at 3.66 s / 15 / 24 % / 110 f
/ Δ≈200.

Carry the metric's known blind spot: a logo mark is ~0.4 % of frame, below the
0.2 % floor's design range, so it answers "is the film restless", not "is the
bookend alive".

---

## Open questions

Each is a decision, sized to one session. Q1–Q3 are takeable now.

**Q1 · What exactly does a preset own?** The table above is a proposal, not a
settled boundary. Which of the ~40 scattered constants are *grammar* (style),
*layout* (card), or *global* (nobody)? Hard cases: `CHIP_AT` / `CHIP_FROM_DEFAULT`
are layout that the pointer path reads as motion endpoints; `S_MAX_SOFT` is a
rhythm choice wearing a scale constant's clothes.

**Q2 · Is byte-identity provable on this machine?** Verification step 0. Cheap,
and it decides the migration contract.

**Q3 · Which films become styles?** See [Reference intake](#reference-intake).

**Q4 · Chip punch — is 7.8× a scale or a composition target?** Film B measures
7.8× over 3 frames where ours is 4× over 13. But `CHIP_PUNCH_SCALE`'s own
docstring says it is a **composition target** (chip ≈ 40 % of frame width), not a
raw zoom factor. Re-derive against our chip's rest width rather than pasting the
number; expect to land near it, not on it, and record the measured framing.

**Q5 · Does `narration` need a re-shoot?** Phase 3's real cost. Depends on Q3.

---

## Not yet specified

- **How aspect-ratio variants interact with styles.** `missing-feature.md` #2
  wants 9:16 and 1:1. A vertical film may *be* a style, or an orthogonal output
  setting every style must satisfy. Can't tell until a vertical reference exists.
- **Whether audio belongs in a preset.** Ruled out above. Revisit if a
  voiceover-paced reference arrives, because cutting to speech is a pacing rule,
  not a soundtrack.
- **Whether per-segment overrides still pull their weight** once presets sit
  underneath them. If authors keep reaching for `enter`/`exit`/`crop`, the preset
  is probably wrong.
- **What a style implies for stills.** `shoot-still` shares constants with reels;
  untouched by this spec.

## Out of scope

- **Shoot-time pointer choreography.** The repo's own use of the word (in
  `intro-reel/SKILL.md`) means the cursor's path — browse before you commit, slow
  the hops, dwell before clicking. That is almost entirely **baked into the
  recording**: glide speed, arc, overshoot, dwell and every authored beat are
  wall-clock events frozen into `cursorTrack` timestamps. It cannot be a per-reel
  switch, which is what this feature is. A flow-level preset over `recorder.ts`'s
  glide constants is a real idea and a **separate effort**.
- **`scripts/render.ts` / `scripts/clip.ts`** — see Threading.
- **Chip morph and in-place chip swap** — phase 4, and neither changes the
  grammar.

---

## Reference intake

Each new film should differ from the two we have on a **named axis**, or it
refines an existing preset rather than earning a new one.

| Axis | Why it earns a style |
| --- | --- |
| **Voiceover-paced** | Both current films are silent or a quiet bed. Cutting to speech is a different pacing rule, and the audio system is unused |
| **Long-take / camera-led** | Few cuts, motion carried by a moving camera — the opposite of metronomic. Exercises `drift` and the zoom track, which `proof` deliberately disables |
| **Annotated** | Callouts, arrows, highlight masks, zoom-to-detail. A presentation layer neither reference has; overlaps `missing-feature.md` #5 |
| **Vertical / social** | Different aspect, much faster cadence; would force framing assumptions into the preset. Overlaps `missing-feature.md` #2 |
| **Keynote / dramatic** | Big type, slow holds, heavy tonal contrast — tests the type and colour half of the grammar rather than the motion half |

Requirements, so measurement is trustworthy:

- The **delivered file**, not a screen-capture of a video player.
- Constant frame rate, and the **whole film** including bookends — shot-length and
  cut-rate statistics are meaningless on an excerpt.
- Roughly 15–60 s.
- Ideally real product-UI footage. A film that is pure motion graphics has no clip
  grammar to extract.

**Two to four films is the useful range.** Each is a real analysis pass; the value
is covering different axes, not accumulating samples of the same grammar.

Method for turning one into a preset: follow [`docs/reel/README.md`](../../reel/README.md),
producing a `docs/reel/<name>/` analysis, then fill a `STYLE_PRESETS` entry with
its `source` and `targets`.
