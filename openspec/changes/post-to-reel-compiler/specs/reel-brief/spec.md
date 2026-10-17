# Spec Delta

## Purpose

A reel brief is the only creative output an agent writes for a launch reel: a
small, closed document naming the footage to shoot, the card copy, and the
beats each card must show. It is checked before anything is recorded or
rendered, so any error is caught at the brief, where it is cheap to fix.

## ADDED Requirements

### Requirement: Brief document shape
A brief SHALL be a JSON document at `reels/<name>.brief.json`, with fields:
- `version`: the brief schema version.
- `name`.
- `house` (optional): a house-style id and version. Default: the current default house.
- `source`: the path of the post the brief was written from, normally
  `reels/<name>.post.md`. That file holds the pasted post text verbatim, so
  every brief can be traced to its post and re-derived from it.
- Exactly one of `footage` or `demo`:
  - `footage`: shoot new footage from actions. It holds `surface` and
    `actions`, each `{ use, with }`.
  - `demo`: the name of an already-recorded demo to cut from.
- `title`.
- `beats`: each beat holds `card` (copy) and `show` (`from`, a label, plus an
  optional `to`, a later label).
- `payoff` (optional): `card` (copy containing the chip token), `chip` (a
  label), and, for a `demo` brief only, `text` (the control's on-screen text).
- `signoff`.

Any field not listed here SHALL be rejected.

#### Scenario: Minimal valid brief with footage
- **WHEN** a brief has `version`, `name`, a `source` naming its saved post, `footage` with one known action and valid params, `title`, two beats whose labels that action declares, and `signoff`
- **THEN** validation passes without anything being recorded

#### Scenario: Both footage and demo
- **WHEN** a brief sets both `footage` and `demo`, or neither
- **THEN** validation fails, saying exactly one is required

#### Scenario: Unknown field
- **WHEN** a brief contains a field not in the schema, such as `holdS` on a beat
- **THEN** validation fails with an error naming the field's path (`beats[1].holdS`) and listing the allowed fields at that level

### Requirement: The source post is kept
`source` SHALL name an existing, non-empty file. Validation SHALL fail when it
is missing or empty.

#### Scenario: Missing post
- **WHEN** `source` names `reels/foo.post.md` and that file does not exist
- **THEN** validation fails, naming the path

### Requirement: Footage resolves against the action library
With `footage`:
- `surface` SHALL name a known surface;
- each action's `use` SHALL name a known action on that surface;
- each action's `with` SHALL satisfy that action's closed parameter schema
  (required fields, types, length limits).

#### Scenario: Unknown action
- **WHEN** `footage.actions[0].use` names an action not in the library
- **THEN** validation fails, listing the actions available on the surface

#### Scenario: Action on the wrong surface
- **WHEN** an action belongs to a different surface than `footage.surface`
- **THEN** validation fails, naming the action's surface

#### Scenario: Bad parameter
- **WHEN** a `with` value is missing, has the wrong type, exceeds its length limit, or is not declared by the action
- **THEN** validation fails with the parameter's path and the rule it broke

### Requirement: Beat count
A brief SHALL have at least 2 beats and no more than the house style's beat
limit, which is at most 5.

#### Scenario: Too many beats
- **WHEN** a brief has more beats than the house style allows
- **THEN** validation fails, stating the count and the limit

### Requirement: Copy rules follow the house style
Every piece of copy (`title`, each beat `card`, `payoff.card`, `signoff`) SHALL
be checked against the house style:
- word count within the house range for that kind of copy;
- `==emphasis==` markup only where the house's base style allows it;
- none of the house's banned words, matched case-insensitively as whole words.

#### Scenario: Card too long
- **WHEN** a beat card has more words than the house allows for a beat card
- **THEN** validation fails, naming the beat, its word count and the allowed range

#### Scenario: Emphasis where the style forbids it
- **WHEN** a card contains `==word==` and the base style renders no emphasis
- **THEN** validation fails, naming the card

#### Scenario: Banned word
- **WHEN** any copy contains a banned word, such as "seamless"
- **THEN** validation fails, quoting the word and naming where it appears

### Requirement: Beats resolve against labels
Each `show.from`, `show.to` and `payoff.chip` SHALL match a label exactly,
ignoring case. The labels come from:
- with `footage`: the ordered labels declared by its actions, before recording;
- with `demo`: the demo's click log.

A label that appears more than once SHALL be written as `label#n`. Beats SHALL
be in label order: each beat's `from` SHALL come after the previous beat's last
label, and `to` SHALL come after `from`.

#### Scenario: Unknown label
- **WHEN** `show.from` names a label that the footage's actions do not declare
- **THEN** validation fails, listing near misses, or every available label if there are none

#### Scenario: Ambiguous label
- **WHEN** a label appears more than once and the brief omits `#n`
- **THEN** validation fails, listing each occurrence

#### Scenario: Out of order
- **WHEN** a beat's `from` comes earlier than the previous beat's last label
- **THEN** validation fails, naming both beats

### Requirement: Payoff matches its footage
When a brief has a `payoff`:
- its `card` SHALL contain the chip token exactly once;
- its `chip` SHALL be a label after the last beat's labels.

#### Scenario: Chip names an earlier action
- **WHEN** `payoff.chip` is at or before the last beat's last label
- **THEN** validation fails, because the payoff clip would replay earlier footage

#### Scenario: Chip token missing
- **WHEN** `payoff.card` lacks the chip token
- **THEN** validation fails, naming the expected token

### Requirement: The payoff chip names a control
The pill on the payoff card SHALL show the text of the control the payoff
clip presses, never the label. So:
- with `footage`, `payoff.chip` SHALL name a label whose declaring action
  declares its control text, and `payoff.text` SHALL NOT be set;
- with `demo`, there are no declarations, so `payoff.text` SHALL be present:
  a non-empty string of at most 40 characters.

#### Scenario: Chip without a control
- **WHEN** `payoff.chip` names "describe the skill", which `skills.add` declares without a control
- **THEN** validation fails at `payoff.chip`, listing the labels that declare a control

#### Scenario: Demo payoff without text
- **WHEN** a `demo` brief has a `payoff` with no `text`
- **THEN** validation fails at `payoff.text`, saying a demo brief must give the control's text

#### Scenario: Text on a footage brief
- **WHEN** a `footage` brief sets `payoff.text`
- **THEN** validation fails at `payoff.text`, saying the text comes from the action's declaration

### Requirement: Validation reports every problem at once
Validation SHALL:
- return every problem found in one pass, each with a field path and a
  sentence an agent can act on;
- support a machine-readable output;
- exit non-zero when any problem is found;
- record and render nothing.

#### Scenario: Several problems
- **WHEN** a brief has an unknown label and a card that is too long
- **THEN** both are reported in the same run

### Requirement: Listing what a brief can use
The brief CLI SHALL list:
- the surfaces;
- the actions on each surface, with their parameter schema and declared labels;
- for a recorded demo, its click-log labels, with press times and typing end times.

#### Scenario: Listing actions
- **WHEN** an agent asks the brief CLI for the actions on a surface
- **THEN** each action prints its id, parameters with types and limits, and its labels in order
