# Spec Delta

## Purpose

A single command takes a launch brief to finished, quality-checked reels.
Every stage is recorded, so an agent or a person knows exactly where a run
stopped, why, and where to resume.

## ADDED Requirements

### Requirement: Stages in order
`pnpm launch <name>` SHALL run these stages in order, stopping at the first failure:
1. **validate** the brief;
2. **compose** the flow (skipped for a `demo` brief);
3. **check** the selectors (skipped for a `demo` brief);
4. **record**: prepare runs again, then strict record and the label match;
5. **convert**;
6. **render-demo**;
7. **compile**;
8. **render-reel**, once per house aspect;
9. **gate**.

#### Scenario: Footage brief end to end
- **WHEN** `pnpm launch foo` runs on a valid brief with footage, and every stage passes
- **THEN** `out/demo/foo.mp4`, `out/reel/foo.mp4` and `out/reel/foo.9x16.mp4` exist, and the run exits zero

#### Scenario: Demo brief
- **WHEN** the brief names an existing `demo` instead of `footage`
- **THEN** compose, check, record, convert and render-demo are skipped as satisfied, and the run starts cutting from that demo

### Requirement: Status record
Each run SHALL write `out/launch/<name>/status.json`. For each stage, it records:
- its state (passed, failed, skipped);
- start and end times;
- its outputs;
- for a failed stage, the problems, in the same field-path-and-sentence form
  the brief validator uses.

It SHALL also record the house version and brief version. The command SHALL
exit non-zero on any failure.

#### Scenario: Failure at check
- **WHEN** the check stage cannot resolve a target
- **THEN** `status.json` marks check failed with the unresolved target, later stages are not run, and the exit code is non-zero

### Requirement: Resume
`--from <stage>` SHALL start at the named stage, using the outputs earlier
stages already wrote. It SHALL refuse when an output it needs is missing,
naming the stage that makes it.

#### Scenario: Copy fix after a render
- **WHEN** card copy changes after a full run, and `pnpm launch foo --from compile` runs
- **THEN** the demo is reused, the reels are re-cut, and nothing is re-recorded

#### Scenario: Missing input
- **WHEN** `--from compile` runs and no click log exists for the demo
- **THEN** the command refuses, naming record as the stage to run

### Requirement: Quality gates
The gate stage SHALL run `analyze` on every rendered reel and fail when:
- any metric is outside the base style's `targets` by more than the house
  gate tolerance;
- the reel is longer than the house maximum;
- a clip was capped by more than the house's reportable amount.

Gate results SHALL be written to `status.json`, with each metric's value,
target and tolerance.

#### Scenario: Blank share too high
- **WHEN** the 9:16 reel's blank share exceeds its target by more than the tolerance
- **THEN** the gate fails for that aspect, naming the metric and the values

### Requirement: No approval mid-run, and no publishing
`launch` SHALL run from validate to gate without pausing for approval. A
person reviews only the finished reels. `launch` SHALL NOT post, upload or
send anything anywhere. When gates pass, it SHALL end by printing:
- the path of each rendered reel;
- the brief's copy;
- the gate summary.

A person can then approve or reject the reels from that output alone.

#### Scenario: Run passes
- **WHEN** every stage passes
- **THEN** the command prints both reel paths, the title, beat cards, payoff and sign-off copy, and the gate results, and makes no network request outside recording the app

### Requirement: Reproducible run
Two runs of `pnpm launch` on the same brief, house version and recorded demo
SHALL produce reels whose segment ranges are identical. This holds for a
`demo` brief, or a run from compile onwards.

#### Scenario: Re-run from compile
- **WHEN** `pnpm launch foo --from compile` runs twice with nothing changed
- **THEN** the compiled reels' `--check` reports are identical
