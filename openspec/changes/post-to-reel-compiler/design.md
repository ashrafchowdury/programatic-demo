# Design

## Context

See proposal.md for the motivation. Facts about the current code that shape this design:

**Flows**
- **Two ways to write a flow.** `defineFlow` (`scripts/lib/flow.ts`) takes
  either a `steps` list or a `run` function. Steps log a `label` (the
  target's name by default) and carry pacing (`after`, `travelMs`, `hoverMs`,
  `cluster`, `zoomScale`). Pacing constants are per flow (`P` in
  `flows/agent-skill.ts`).
- **`prepare` is best-effort.** `scripts/lib/record.ts:158` logs "prepare ->
  FAILED … shooting from the current state" and carries on. The agent-skill
  flow documents a `prepare` that silently matched nothing and shipped a
  polluted reel.
- **`--check` writes to the app.** It drives the flow for real, so it creates
  state. `flows/automation-cleanup.ts` notes a check-created subscription
  causing a 409 in the filmed take.
- **Start URLs come from `DEMO_URL_<FLOW>`.** `flows/`, `reels/` and
  `public/*.clicks.json` are gitignored because they name one account's product.

**Reels**
- **Beat anchors exist but nothing uses them.** Anchors
  (`fromBeat`/`leadS`/`toBeat`/`tailS`) resolve on a beat's press. None of the
  six existing reels uses them.
- **Hand cuts follow measurable patterns.** Measured hand offsets (clip start
  minus the first beat's press, in demo seconds):

  | reel | style | start offsets |
  | --- | --- | --- |
  | agent-skill | classic | −0.04, −0.04, −0.68, −0.01 |
  | agent-slash-command | classic | −0.13 |
  | agent-tool | stage | −1.07, +0.06 |
  | agent-schedule-stage | stage | −0.34, −0.20, −0.12, −0.37, −0.38 |

  Ends sit about 0.76s after a typing end, and the last clip runs about 2.7s
  past its press so the camera can pull back. Typing on screen is cut after
  about 2.7s.
- **Audio has a house pattern already.** Stage reels use
  `audio/intro.mp3` as a bed (fade 0.2/2.5, −14 LUFS). `harness` uses
  `audio/sfx/*.wav` (click 0.35, confirm 2.5 on the payoff label). The SFX
  stock is `click`, `confirm`, `error`, `key`, `pop`, `typing`.
- **Aspects exist.** `--aspect=9:16` is a moving crop that follows the
  clicks, written to `out/reel/<name>.9x16.mp4`.
- **Copy limits live only in prose.** Word ranges are in the intro-reel
  skill, not in `STYLE_PRESETS`.
- **No validation library.** Validators are hand-written functions that
  return sentences.

## Goals / Non-Goals

**Goals:**
- Keep the agent-written surface small and closed: one JSON brief per launch,
  with no code, for any launch made of existing actions.
- Keep every editing, pacing, audio and aspect number in one versioned place.
- Make each pipeline stage fail loudly at its own boundary, never silently
  further down.
- Leave existing hand-written flows and reels behaving exactly as they do today.

**Non-Goals:**
- No LLM call in the repo. The agent running the skill is the model.
- No automatic authoring of new actions. That remains agent or human work,
  guarded by the contract and `actions:check`.
- No crop or push derivation (`proof`/`ledger`), and no 1:1 output.
- No scheduler, trigger or notification. `launch` is what one will call.

## Decisions

### 1. The brief is JSON, not TypeScript
A JSON brief can be validated against a closed schema, carries no logic, and
diffs cleanly. A TS brief would let an agent add expressions, imports or
fields. *Rejected:* TS and YAML.

### 2. Actions are TypeScript and own their pacing; the house owns the rhythm between them
An action is code. It needs selectors, `prepare` and verification, and those
are the parts that need a person's care. Each action reads like today's flows:
- `defineAction({ id, surface, params, labels, prepare, steps: (p) => Step[], mutates, example })`;
- `steps` returns the existing `Step` type, so `runSteps` drives it unchanged;
- the action's internal pacing (its `P` table) stays inside the action,
  because it is tuned to that UI.

The house owns pacing between actions: establish, the gap between actions,
and `DEMO_SPEED`. Those are what make every film breathe the same.
*Rejected:* a data-only action format (it can't express prepare or
verification), and house-wide per-beat pacing (it breaks UI-specific timing
measured in today's flows).

### 3. Declared labels are the contract between footage and cut
Each action lists its labels. The composer concatenates them. The brief
validates against that list before recording, and the recorder checks the
click log against it afterwards. This makes a brief checkable with no app
running, and catches a skipped or renamed step at record time instead of as
a wrong cut. Labels follow today's flows ("name the skill"), so the golden
briefs can reuse them.
*Rejected:* deriving labels by running the flow (needs the app, and needs
check mode, which writes state).

A label that can be a payoff chip also declares its **control**: the text the
control shows on screen, a literal or the value of one of the action's
parameters (`{ label: "pick domain", control: { param: "domain" } }`). Labels
are written as story beats, so the pill on the payoff card renders the control
text, never the label. A `demo` brief has no declarations, so its payoff
carries the text itself (`payoff.text`).
*Rejected:* rendering the label (a story label reads as such on the pill), and
sampling the text from the footage (needs the app).

### 4. Strict prepare is opt-in per flow, and on for composed flows
`Flow` gains `strictPrepare?: boolean`. `record.ts` aborts before the clock
starts when it is set, and keeps today's behaviour when it is not. The
composer always sets it. An action's `prepare` must end with a verification
that throws. The contract test runs `prepare` twice and expects the second run
to be a no-op that passes.
*Rejected:* making every flow strict (changes hand-written flows, against the
proposal's no-change guarantee).

Prepares share account state with real work, so what they may delete is
scoped: everything an action creates carries the `demo-` prefix (examples are
checked statically), a prepare deletes only prefixed items and refuses by name
otherwise, and an action whose change has no verified reset says so and is
skipped by `actions:check` unless asked.

### 5. Composition, and where composed flows live
`composeFlow(brief, actions, surfaces, house) → Flow` runs in memory. `loadFlow`
falls back to it when there is no `flows/<name>.ts` but the brief has
`footage`, so `record:live`, `--check` and `record:batch` work unchanged.
Surfaces are files in `surfaces/<id>.ts`. Actions are `actions/<surface>/<id>.ts`,
registered by a directory scan. Both are **committed**, because the library is
the asset that builds up across launches.

Account specifics stay out, by the same rule the repo already uses for URLs:
- start URLs are read from `DEMO_URL_<SURFACE>`;
- a hygiene test fails on any URL, hostname or id-shaped literal in these files.

Example demo data in `example` params (a skill named "pr-review-security") is
product copy, not account data, so it is allowed.

`surfaces/example-*` and `actions/example-*` target the public site the
committed `skillsmp-search` flow uses, so composition and recording tests need
no account. (`google-search`'s DuckDuckGo page serves a bot wall to headless
Chromium, so neither the examples nor the flow regressions use it.)

An action films at its surface's viewport unless it declares its own: a UI
tuned at another size (agent-tool at 1600x900, agent-schedule at 1280x720)
keeps it. One composed flow films at one size, so every action in a footage
must resolve to the same viewport, or composition fails naming each action's
size.

AGENTS.md gains a rule: `flows/` stays gitignored, while `actions/` and
`surfaces/` are committed and must pass the hygiene test.
*Rejected:*
- Gitignoring actions: the library would live on one machine.
- Generating `flows/<name>.ts` files: they drift from the brief.

### 6. Compile in memory; the brief is the source of truth
`pnpm reel` compiles on every run. `--emit` writes `reels/<name>.ts` only to
eject a reel for hand-tuning. *Rejected:* committing generated `.ts`.

### 7. A hand-written validator that collects every problem
`briefProblems(value, ctx) → { path, message }[]` reports everything in one
pass. `ctx` holds the house, actions, surfaces, and the click log when there
is one. The schema stays closed for every brief, golden ones included: a
golden launch's metadata (hand flow, hand reel, deliberate edits) lives in a
sidecar, `reels/golden/<launch>.golden.json`, next to its brief. *Rejected:* zod (a new dependency), and first-problem-only reporting
(forces N retries).

### 8. Typing beats get an end edge on anchors
`ClipAnchors` gains `toEdge?: "press" | "typeEnd"`, defaulting to `"press"`,
so existing reels are unchanged. The compiler never emits seconds.

### 9. House styles are a frozen, versioned registry
`src/lib/house.ts` exports `HOUSES` and `HOUSE_DEFAULT = "agenta@1"`. A `House`
holds a shared brand block plus cut, pacing, audio and aspect numbers:
- **Brand block:** wordmark, banned words, tone plan, chip tone, bed source,
  SFX samples, loudness.
- **Cut, pacing, audio and aspect numbers:** everything else, per base style.

A unit test hashes each published version and fails on any edit.

v1 ships:
- **`agenta@1`**: `stage`, aspects `["16:9", "9:16"]`, the default.
- **`agenta-classic@1`**: `classic`, aspects `["16:9", "9:16"]`, used by the
  classic golden reels and available to briefs.

Seeds come from the measurements above, and the golden run fixes them before
the hashes freeze.

House audio:
- bed `audio/intro.mp3`, trimmed to the reel's length, fade in 0.2s, fade out
  2.5s, gain 1, role `bed`;
- SFX: click 0.35, typing, pop;
- `confirm` 2.5 on the payoff label;
- `duck: true`;
- `loudnessLUFS: -14`.

*Rejected:* letting a brief choose a style or audio (reintroduces a creative
choice per reel).

### 10. Compiler rules, in order
1. Title card.
2. Per beat: a card, then a clip anchored on `from` with the house lead,
   ending at `to ?? from` with `toEdge` set by whether that label types.
   Tails, caps and the gap pull-in apply. Drift comes from the house.
3. Payoff card with its chip (the pill reads the label's declared control
   text, or `payoff.text` for a demo brief), then a clip with the payoff tail
   and `open: { scale, at: chip }`.
4. Sign-off card.

Then `style`, audio and `aspect` are set from the house. Validation runs through
`resolveReel` and `reelProblem`, with errors mapped to brief paths through a
segment → brief-path table. The renderer loops over the house aspects; the
first aspect is the reel's own and the rest pass `--aspect`.

### 11. `launch` is a thin orchestrator over existing commands
`scripts/launch.ts` calls the same library functions the existing commands
use. It does not re-implement them. Each stage is a function
`(ctx) → { outputs } | { problems }`, and `status.json` is written after every
stage. Before record, the `prepare` that record runs anyway cleans up after
check. The gate stage calls `analyze`'s pure half (`scripts/lib/motion-metrics`)
against the style's `targets`, with house tolerances.
*Rejected:* a shell script chaining pnpm commands (no structured status, and
parsing stdout).

### 12. Golden validation, measured in two halves
Footage parity compares the recorded click log with the hand flow's log.
Cut parity compiles against the hand flow's log, so a pacing difference in
an action can't hide a compiler regression, or the other way round.

The compiler keeps its one segment shape; the hand reels each have their own
(cards between some clips and not others, logo bookends, two cards to a beat).
So cut parity compares what the shape does not decide: the footage. Clips are
compared in order, by the beats they show. Each compiled clip is paired with
the hand clip that shows its first beat; where one hand clip runs through
several compiled clips, only the outer edges are compared, since the hand
reel made no cut inside it. Card and segment-shape differences are written to
the report as information, never as a failure. Length is held to the house
maximum, since cards make up most of any difference from the hand length.

| Measure | Tolerance | Basis |
| --- | --- | --- |
| beat press time | ±0.3s | about 10× the measured re-shoot spread |
| clip start | ±0.35s | stage lead spread |
| clip end | ±0.75s | ends follow camera settle |
| reel length | ≤ house maximum | |
| motion metrics | per metric | stated in the report |

A golden run is valid only against hand click logs recorded on the same
product version as the composed take. When the product changes (Agenta
v0.122.8 turned "Add skill" into a menu and renamed Tools to Integrations),
the hand flow is re-recorded on the new version first and its hand reel is
re-cut against the new take with beat anchors (`fromBeat`/`toBeat`, `toEdge`
on typing beats), so a later re-record keeps its cuts on the same beats; or
that golden launch is retired. Footage parity across versions measures the
product, not the composer, and second-based hand ranges on a new take cut
moments nobody chose.

*Rejected:* frame-diffing, and structure equality (the brief would have to
grow per-launch shape fields to match four different hand shapes).

### 13. Post → brief is a documented agent procedure
The intro-reel skill gets a section with these steps:
1. Save the post text the user pasted (or the file they point to) verbatim
   to `reels/<name>.post.md`, and set it as the brief's `source`. Keeping the
   post next to its brief makes every reel traceable, and lets a later house
   version re-derive the brief from the same input.
2. Run `pnpm brief --actions <surface>`.
3. Pick actions and parameters, then write the copy.
4. Run `pnpm brief <name> --json`, retrying at most twice.
5. Run `pnpm launch <name>`.
6. Hand off with `status.json` on any failure.

When no action covers the feature, it stops and says which action is
missing. A second section covers writing an action: contract, verified
prepare, `actions:check`, and a golden comparison when it replaces a hand flow.

## Risks / Trade-offs

- **Coverage.** A new feature with no action can't launch without someone
  writing the action. → The pipeline names the gap precisely. Authoring
  actions is the one place human care is spent, and every action written is
  reused.
- **Check writes state.** → Check is always followed by the composed
  `prepare` before recording, and each `prepare` is idempotent and verified
  (the contract test runs it twice).
- **UI drift breaks actions between launches.** → `actions:check` is a cheap
  per-action probe meant to run regularly. Scheduling it is a later change.
- **Labels are written for the recorder, not the story.** → Action labels
  are written as story beats from the start, and the skill says so.
- **House rules flatten deliberate hand craft.** → Deliberate edits are
  recorded in golden metadata, and `--emit` ejects a reel for hand work.
- **9:16 is a crop, not a re-layout.** A wide UI may lose context. → Gates
  measure each aspect separately, and a failing 9:16 doesn't hide behind a
  passing 16:9.
- **The golden set can't run in CI.** Its data is gitignored. → Contract,
  composer and compiler logic is unit-tested on committed examples and
  synthetic fixtures. The golden run is a local gate, and its report is committed.
- **Scope is larger than a single change usually is.** → The tasks are
  ordered so each group stands alone. Brief, house and compiler on
  hand-recorded demos (`demo` briefs) work before any action exists.

## Migration Plan

The change is additive. Hand-written flows and reels are untouched, and the
`--check` regression and the non-strict default prove it. Rollback means
removing the brief fallbacks in `loadFlow` and `scripts/reel.ts`. Nothing
else reads briefs, actions or houses.

## Open Questions

- Final house seeds and per-metric tolerances. The first golden run sets them,
  then v1 freezes. This changes numbers, not structure.
- Whether `agent-tool`'s 1.07s early start is a deliberate edit. The golden
  run decides.
