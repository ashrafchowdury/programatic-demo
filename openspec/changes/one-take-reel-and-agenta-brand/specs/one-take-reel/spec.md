# Spec Delta

## Purpose

A reel shape that shows a feature as one uncut take: a title card, then the
whole recorded interaction with the camera following the clicks, then closing
text and the logo. It is the default for new Agenta reels, because nobody has
to judge where to cut the demo.

## ADDED Requirements

### Requirement: The one-take style
The style registry SHALL include a `one-take` style. Like every other preset,
it SHALL be data only, and no code SHALL branch on its name. The style SHALL:
- frame footage in the floating window;
- drive a zoom camera from the click log, moving in on each action and back out;
- draw the pointer;
- cut between card and footage, with no dissolve.

Its `source` and `targets` SHALL be null, because it was not measured off a
reference film.

#### Scenario: A reel names the style
- **WHEN** a hand-written reel sets `style: "one-take"` and has one clip
- **THEN** `pnpm reel --check` resolves it, and the clip renders in the window with the click-log zoom camera

#### Scenario: Other styles unchanged
- **WHEN** the six existing hand-written reels run `pnpm reel --check` after this change
- **THEN** their output is identical to before

### Requirement: A house names its shape
A house SHALL declare a `shape` of either `beats` or `one-take`:
- `beats` SHALL compile exactly as the beats compiler does today.
- `agenta@1` and `agenta-classic@1` SHALL be `beats`, and their frozen
  contents and hashes SHALL NOT change.

#### Scenario: Frozen houses untouched
- **WHEN** the house tests run after this change
- **THEN** the recorded hashes of `agenta@1` and `agenta-classic@1` still match

### Requirement: One-take brief fields
Under a `one-take` house, a brief SHALL hold:
- `title`;
- exactly one of `footage` or `demo`;
- `outro`: 1 to the house's maximum number of closing lines (at most 3).

It SHALL NOT hold `beats` or `payoff`. Each `outro` line SHALL follow the
house's copy rules: word range, emphasis, banned words. Every other rule of the
closed brief schema still applies.

#### Scenario: Minimal one-take brief
- **WHEN** a brief under `agenta@2` has `title`, `footage` with one action, and `outro: ["Agents that learn on the job."]`
- **THEN** validation passes

#### Scenario: Beats under a one-take house
- **WHEN** a brief under `agenta@2` contains `beats`
- **THEN** validation fails, saying this house's shape takes `outro` and no beats

#### Scenario: Too many closing lines
- **WHEN** a brief has more `outro` lines than the house allows
- **THEN** validation fails, stating the count and the limit

### Requirement: One-take compilation
Compiling a one-take brief SHALL produce, in order:
1. a title card holding `title`;
2. exactly one clip;
3. one card per `outro` line;
4. a logo card holding the brand lockup.

The clip SHALL:
- start at the first label's press plus the house lead;
- end at the last label's press, or its typing end if it types, plus the house
  payoff tail, so the camera can pull back.

It SHALL be written as beat anchors and SHALL NOT be cut by the beat caps. If
the reel is longer than the house maximum, compilation SHALL fail, naming the
clip's length and the limit. Compilation SHALL be deterministic.

#### Scenario: Whole interaction in one clip
- **WHEN** a one-take brief with `skills.add` footage compiles
- **THEN** the reel is title card, one clip from "Add skill" to after "Create", one outro card, then the logo card

#### Scenario: Re-shoot keeps the take whole
- **WHEN** a re-shoot moves every press by +1.04s
- **THEN** the clip's start and end move by +1.04s, and nothing else changes

#### Scenario: Too long
- **WHEN** the take plus cards runs past the house maximum
- **THEN** compilation fails before rendering, naming the take's length and the limit

### Requirement: agenta@2 is the default house
`agenta@2` SHALL exist and SHALL be the default house. It SHALL have:
- shape `one-take` and style `one-take`;
- aspects 16:9 and 9:16;
- shoot speed 1.25;
- the Agenta reel brand pack;
- the same audio rules as `agenta@1`.

Once its seeds are set by the first validated render, it SHALL be frozen with a
recorded hash.

#### Scenario: A brief names no house
- **WHEN** a brief has no `house`
- **THEN** it compiles under `agenta@2` as a one-take reel

#### Scenario: A pinned brief keeps its shape
- **WHEN** a brief pins `agenta@1`
- **THEN** it compiles in the beats shape exactly as before
