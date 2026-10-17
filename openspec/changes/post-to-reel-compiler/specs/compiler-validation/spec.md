# Spec Delta

## Purpose

Shows that actions, the composer and the compiler make footage and films as
good as the hand-made flows and reels they replace, by rebuilding existing
launches from briefs and measuring them against the originals. It is then
re-run whenever any of them, or the house style, changes, so the output stays
consistent over time.

## ADDED Requirements

### Requirement: Golden set
The golden set SHALL be one brief per existing hand-made launch whose base
style the compiler supports. Each brief is written by hand to express that
launch's actions, cards and beats. It SHALL include at least:
- `agent-skill` and `agent-slash-command` (`classic`);
- `agent-tool` and `agent-schedule-stage` (`stage`).

Golden briefs SHALL pin a house on the same base style as their hand reel.
Each brief's golden metadata (its hand flow, hand reel, and deliberate edits
with reasons) SHALL live in a sidecar, `reels/golden/<launch>.golden.json`,
next to the brief, so the brief itself stays inside the closed brief schema.
Reels in unsupported styles (`harness`, `agent-schedule`) SHALL be listed in
the report as unsupported, with the reason.

#### Scenario: Unsupported reel
- **WHEN** the golden run meets `harness` (proof)
- **THEN** the report lists it as unsupported in this version

#### Scenario: Metadata beside the brief
- **WHEN** `reels/golden/agent-tool.golden.json` names hand flow `agent-tool`, hand reel `agent-tool`, and a deliberate edit on clip 1
- **THEN** the harness compares against that flow and reel, excludes clip 1 from the range check, and `pnpm brief` still validates the brief

### Requirement: Footage parity
For each golden brief with `footage`, the composed flow's recorded click log
SHALL be compared with the hand flow's click log:
- the label sequence SHALL be equal;
- each beat's press time SHALL be within ±0.3s of the hand log's, after
  aligning the first beat.

#### Scenario: Label parity
- **WHEN** `skills.add` records for the `agent-skill` golden brief
- **THEN** its labels equal the hand log's: "Add skill", "name the skill", "describe the skill", "write SKILL.md", "Create"

### Requirement: Cut parity
The compiler keeps its one segment shape, and the hand reels each have their
own, so cut parity SHALL compare the footage, not the shape. For each golden
brief, the harness SHALL compile against the click log and compare with the
hand reel:
1. **Clip ranges, in order, by the beats they show.** Each compiled clip is
   paired with the hand clip that shows its first beat. Compiled starts SHALL
   be within ±0.35s and ends within ±0.75s of the paired hand range. Where one
   hand clip shows the beats of several compiled clips, only its outer edges
   are compared: the first compiled clip's start and the last one's end. A
   compiled clip whose beats no hand clip shows, or a hand clip no compiled
   clip shows, fails. A clip marked a deliberate edit is excluded from the
   range check only.
2. **Length:** at most the house maximum.
3. **Motion metrics:** after rendering both, no `analyze` metric worse than the
   hand cut by more than that metric's stated tolerance.

Card and segment-shape differences (the order of cards and clips, card
counts, logo bookends) SHALL be written to the report as information, and
SHALL NOT fail a launch.

The cut comparison SHALL use the hand flow's click log, so cut parity is
measured apart from footage parity.

#### Scenario: Within tolerance
- **WHEN** every compared clip edge and metric of `agent-slash-command` is within tolerance and the reel is under the house maximum
- **THEN** it is marked passed

#### Scenario: Shape differs
- **WHEN** the hand `agent-schedule-stage` cuts five clips with no cards between them and the compiled reel puts a card before each
- **THEN** the report lists both shapes as information, and the launch passes or fails on its clip ranges, length and metrics alone

#### Scenario: One hand clip, two beats
- **WHEN** the hand `agent-slash-command` shows "type slash" through "click /permissions" in one clip, and the brief splits them into two beats
- **THEN** the first compiled clip's start and the second's end are compared with the hand clip's edges, and the cut between them is not

#### Scenario: Metric regression
- **WHEN** compiled `agent-tool` has a blank share worse than the hand cut by more than its tolerance
- **THEN** it is marked failed, naming the metric, both values and the tolerance

### Requirement: Golden report
The harness SHALL write per-launch footage parity, cut parity (clip edges and
their deltas, length against the house maximum, metrics), the compiled and
hand segment shapes as information, deliberate edits, pass/fail status and the
house versions to `docs/reel/design/compiler-validation.md`. It SHALL exit
non-zero if any supported launch fails. It SHALL offer two faster modes:
- a check-only mode: clip ranges and length, with no record or render;
- a cut-only mode: no record.

#### Scenario: Check-only run
- **WHEN** the harness runs in check-only mode
- **THEN** clip ranges and length are compared and reported, the shapes are listed, and nothing is recorded or rendered

### Requirement: Re-run on change
Any change to an action, the composer, the compiler or a house version SHALL
come with a golden run. Its report SHALL be updated in the same change.

#### Scenario: House style bumped
- **WHEN** `agenta@2` is added with a different clip lead
- **THEN** a golden run under it is recorded next to the `agenta@1` result
