# Proposal

## Why

Every launch reel is hand-authored twice: once as a flow
(`flows/<name>.ts` with selectors, about 300 lines) and once as a reel
(`reels/<name>.ts`, 100–300 lines). The editing judgment behind both lives
only in comments:

- enter on the action, cut on motion;
- a light card for a light product, with one dark sign-off;
- `prepare` must reset and verify.

An agent works all of this out again for every launch, so two runs from the
same post give different films, and nothing runs without someone steering.
That blocks the goal: a social post goes in, a launch reel comes out, without
a big script, and the output stays consistent for as long as the system is in use.

The engine is already deterministic: recording, camera, styles, beat anchors,
`--check`, `analyze`. The variance lives in the two authoring steps, so this
change makes both small enough to validate and moves the judgment into code.

## What Changes

- **A reel brief.** This is a small, closed JSON document and the only creative
  output an agent writes. It holds:
  - a title;
  - the footage to shoot, as product actions from a library, with their parameters;
  - 2–5 beats (card copy, plus the action labels each clip must show);
  - an optional chip payoff;
  - a sign-off.

  Unknown fields are rejected.
- **A product action library.** An action is a verified, reusable piece of
  product interaction, such as `skills.add` or `tools.add-integration`. It
  declares its parameters, its labels in order (with the on-screen control
  text of any label a payoff chip can name), and a `prepare` step that
  resets and verifies its state. Actions run on surfaces: a start-URL env key,
  a ready check, a viewport (an action may keep its own), a backdrop. Because labels are declared, a brief
  can be fully validated before anything is recorded.
- **A flow composer.** It turns the brief's footage into a flow: surface,
  strict prepare, actions in order, house pacing between them. An agent no
  longer writes selectors or flow files for a launch made of actions that
  already exist.
- **Strict prepare for composed flows.** A composed flow aborts the shoot when
  any action's `prepare` fails. Existing hand-written flows keep today's
  best-effort behaviour.
- **A deterministic reel compiler.** `compileBrief(brief, clickLog, house) → Reel`
  is a pure function that applies the editing rules once, in code:
  - structure and card tone plan;
  - beat-anchored clip entry and exit;
  - the payoff match cut;
  - the audio bed, SFX, ducking and loudness.
- **A versioned house style.** This immutable, versioned preset holds every
  number the composer and compiler use: base style, pacing, offsets, caps,
  tone plan, audio, aspects, and copy rules. **The default is `agenta@1`, on
  the `stage` style, rendering 16:9 and 9:16, with a music bed and SFX.** A
  brief cannot override any of it.
- **Beat anchors gain an end edge.** A clip can end at a beat's typing end, so
  typing beats stay anchored across a re-shoot.
- **`pnpm launch <name>`.** One command goes from brief to finished reels:
  1. validate
  2. compose
  3. selector check
  4. record
  5. convert
  6. render the demo
  7. compile
  8. render each aspect
  9. quality gates

  Each stage records machine-readable status. The run stops at the first
  failure and can resume from any stage.
- **`pnpm actions:check`.** This command checks every action's selectors on
  its surface without recording. It catches UI drift before a launch day.
- **A golden validation harness.** The four existing reels in `classic` and
  `stage` are re-expressed as actions and briefs. Recorded and compiled, their
  footage, clip ranges and motion metrics must match the hand-made flows and
  reels within stated tolerances, and their length must stay under the house
  maximum. Card and segment-shape differences are reported, not failed: the
  compiler keeps one shape. Each launch's golden metadata sits in a sidecar
  next to its brief. The result is a committed report.
- **Post → brief procedure.** The intro-reel skill gets a section covering:
  - saving the pasted post text verbatim to `reels/<name>.post.md`;
  - listing the actions and labels available;
  - writing the brief;
  - validating it, with at most two retries;
  - handing off to a person when no action covers the feature.

  It also gets a section on writing a new action.

Out of scope, and planned as later changes:

- crop derivation for `proof` and `ledger`;
- 1:1 output;
- an unattended scheduler or trigger;
- automatic authoring of new actions.

## Capabilities

### New Capabilities
- `reel-brief`: the brief document, its closed schema, and validation against
  the house style, the action library, and the click log.
- `flow-actions`: product actions and surfaces, their declared-label contract,
  strict prepare, the flow composer, and `actions:check`.
- `reel-compiler`: compiling a brief and click log into a `Reel` under a
  versioned house style, including audio and aspects, plus the `brief` CLI and
  the `reel` fallback to a brief.
- `launch-pipeline`: the `launch` command's stages, quality gates, status
  record, and resume.
- `compiler-validation`: the golden harness that rebuilds existing hand-made
  flows and reels from actions and briefs, and measures them against the originals.

### Modified Capabilities
<!-- None: no specs exist yet in openspec/specs/. -->

## Impact

- **New code:**
  - `src/lib/brief.ts`, `src/lib/compile-brief.ts`, `src/lib/house.ts`
  - `scripts/lib/action.ts` (action and surface types, composer)
  - `scripts/brief.ts`, `scripts/launch.ts`, `scripts/actions-check.ts`, `scripts/brief-golden.ts`
  - `actions/` and `surfaces/` directories
  - tests, using synthetic click-log fixtures
- **Changed code:**
  - `src/lib/reel.ts`: end-edge anchor.
  - `scripts/lib/flow.ts`: `strictPrepare` on `Flow`.
  - `scripts/lib/record.ts`: aborts on a strict prepare failure; `loadFlow`
    falls back to composing from a brief.
  - `scripts/reel.ts`: falls back to a brief, and renders each house aspect.
  - `package.json`: adds scripts.
  - `.env.example`: adds surface URL keys.
- **Repository hygiene:** `actions/` and `surfaces/` are committed, so the
  library is shared and versioned. A hygiene test keeps URLs, hostnames and
  account ids out of them; those come from `.env`. Briefs and the pasted posts
  they came from live in gitignored `reels/`.
- **Docs:**
  - `AGENTS.md`: the reel row, Commands, Layout, Rules.
  - `.agents/skills/intro-reel/SKILL.md`: post → brief, and writing an action.
  - `.agents/skills/shoot-demo-video/SKILL.md`: a pointer to actions.
  - `docs/reel/design/compiler-validation.md`: the golden report.
- **Unchanged:** existing hand-written flows and reels record and render as
  before, and recorders, styles and the render pipeline are untouched beyond
  the fields above.
