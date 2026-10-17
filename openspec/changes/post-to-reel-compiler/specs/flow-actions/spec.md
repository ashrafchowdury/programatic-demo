# Spec Delta

## Purpose

Product actions are verified, reusable pieces of interaction with the product,
each with a declared label contract and a verified reset. A launch's footage is
then composed from known parts instead of a hand-written flow, and it records
the same way every time.

## ADDED Requirements

### Requirement: Surfaces
A surface SHALL declare:
- an id;
- the environment key that holds its start URL (`DEMO_URL_<SURFACE>`);
- a ready check;
- a viewport;
- a backdrop;
- an optional capture-scale pin.

Start URLs SHALL come only from the environment, never from source. A surface
whose environment key is unset SHALL fail with a message naming the key.

#### Scenario: Missing start URL
- **WHEN** a composed flow uses a surface whose environment key is unset
- **THEN** composition fails, naming the key and pointing at `.env.example`

### Requirement: Action contract
An action SHALL declare:
- an id;
- its surface;
- a closed parameter schema (names, types, required fields, length limits);
- its labels, in the order it logs them, and for each label a payoff chip
  may name, the control's on-screen text: a literal, or the value of one of
  its parameters;
- optionally, its own viewport, overriding its surface's;
- a `prepare` that resets the state the action writes and then verifies it;
- its steps, as a function of its parameters;
- the app state it mutates.

Every label an action logs SHALL be one of its declared labels, in declared order.

#### Scenario: Undeclared label
- **WHEN** an action's steps log a label it did not declare
- **THEN** the action's contract test fails, naming the label

#### Scenario: Parameters drive steps
- **WHEN** `skills.add` runs with `{ name: "pr-review-security" }`
- **THEN** the typed name is that value, and the declared labels are unchanged

#### Scenario: Control text from a parameter
- **WHEN** `search.filter-domain` declares `{ label: "pick domain", control: { param: "domain" } }` and runs with `{ domain: "Development" }`
- **THEN** the control text for "pick domain" is "Development"

#### Scenario: Control names an unknown parameter
- **WHEN** an action declares a control from a parameter its schema does not have
- **THEN** the action's contract test fails, naming the label and the parameter

### Requirement: Prepare verifies or fails
An action's `prepare` SHALL check that it reached the clean state, and SHALL
throw when it did not. A `prepare` that does nothing and reports success on a
dirty state is a contract violation.

#### Scenario: Leftover state survives
- **WHEN** `prepare` runs and a row from a previous take is still present afterwards
- **THEN** `prepare` throws, naming what survived

### Requirement: Demo data only
Everything an action creates for a demo SHALL carry the demo prefix
(`demo-`), so a prepare can tell a leftover take from real data:
- a parameter that names an item the action creates SHALL be marked so, and
  its `example` value SHALL start with the prefix; the contract test SHALL
  fail otherwise, naming the parameter;
- a `prepare` SHALL delete only items carrying the prefix, and SHALL refuse,
  with an error naming the item, rather than delete anything else.

#### Scenario: Example names real-looking data
- **WHEN** `schedules.add`'s example names its schedule "Morning PR audit"
- **THEN** the contract test fails, saying the example must start with "demo-"

#### Scenario: Leftover without the prefix
- **WHEN** a skill named "pr-review-security" (no prefix) matches the name `prepare` would clear
- **THEN** `prepare` throws, naming the skill and refusing to delete it

### Requirement: Every change is restored
An action's `prepare` SHALL restore, and verify, every app state its steps
change, including account-level copies the product makes as a side effect
(for example, a skill created on an agent is also saved to the account's
skills library). A restore SHALL be verified after a reload, since an
in-page value can show a change the server never kept. An action whose
change has no verified reset SHALL declare what it leaves changed, and
`actions:check` SHALL skip it unless explicitly asked to include it.

#### Scenario: Account-level copy declared
- **WHEN** `skills.add` adds a skill and the product also saves a copy to the skills library, which no measured path deletes
- **THEN** `skills.add` declares that it leaves the library copy, and `actions:check` skips it unless asked to include it

#### Scenario: Unrestorable action skipped
- **WHEN** an action declares it leaves app state changed, and `pnpm actions:check` runs without the include flag
- **THEN** it is reported as skipped, with that sentence, and is not driven

### Requirement: Flow composition
Composing a brief's `footage` SHALL produce a flow with:
- the brief's name;
- the surface's start URL, ready check, viewport, backdrop and capture scale;
- a `prepare` that runs each action's `prepare` in order;
- steps made of the house establish beat, then each action's steps in order,
  separated by the house gap between actions;
- the union of the actions' mutated state.

Composition SHALL be deterministic. The composed flow's declared labels are
the actions' labels joined in order.

#### Scenario: Two actions
- **WHEN** footage lists `skills.add` then `tools.add-integration`
- **THEN** the flow runs both prepares in that order, establishes once, runs `skills.add`'s steps, waits the house gap, then runs `tools.add-integration`'s steps

### Requirement: One viewport per composed flow
An action that declares a viewport SHALL film at it; others film at their
surface's. Every action in one footage SHALL resolve to the same viewport,
and composition SHALL fail otherwise, naming each action and its size.

#### Scenario: Two sizes in one footage
- **WHEN** footage lists `skills.add` (the surface's 1920x1080) then `tools.add-integration` (its own 1600x900)
- **THEN** composition fails, naming both actions and both sizes

#### Scenario: Action keeps its size
- **WHEN** footage lists only `tools.add-integration`, which declares 1600x900
- **THEN** the composed flow's viewport is 1600x900

### Requirement: Strict prepare for composed flows
A composed flow SHALL abort the recording when any `prepare` throws, and no
footage SHALL be written. Hand-written flows that do not opt in SHALL keep
today's behaviour: log the failure and shoot from the current state.

#### Scenario: Composed prepare fails
- **WHEN** a composed flow's second action `prepare` throws
- **THEN** recording stops before the clock starts, the error names the action, and nothing is written under `recordings/` or `public/`

#### Scenario: Hand-written flow unchanged
- **WHEN** a hand-written flow's `prepare` throws and the flow did not opt in
- **THEN** the recorder logs the failure and records, as it does today

### Requirement: Existing flows are unchanged
Actions, composition, strict prepare and the brief fallback in flow loading
SHALL NOT change how any existing hand-written flow loads, resolves its
selectors, or records. The brief fallback SHALL apply only when
`flows/<name>.ts` does not exist.

#### Scenario: Selector-check regression
- **WHEN** `pnpm record:live <flow> --check` runs on `smoke`, `skillsmp-search` and `agent-skill` before and after this change
- **THEN** each target resolves through the same rung, and no "composed from brief" notice is printed

### Requirement: Recorded labels match the declaration
After recording a composed flow, the click log's labels SHALL equal the
composed flow's declared labels, in order. A mismatch SHALL fail the recording
step and name the first differing label.

#### Scenario: A step was skipped
- **WHEN** a recorded composed flow's click log is missing a declared label
- **THEN** the record step fails, naming the missing label and the action that declares it

### Requirement: Composed flows work with the existing recorder commands
`pnpm record:live <name>` and its `--check` mode SHALL accept a name with no
`flows/<name>.ts` that does have a brief with `footage`, and SHALL compose the
flow from it. When both exist, the hand-written flow SHALL win and a notice
SHALL say so.

#### Scenario: Check from a brief
- **WHEN** only `reels/foo.brief.json` (with footage) exists and `pnpm record:live foo --check` runs
- **THEN** the flow is composed and its selectors are resolved through Playwright, with no video written

### Requirement: Action drift check
`pnpm actions:check` SHALL check every action on its surface, or only those
named:
1. compose a one-action flow with the action's example parameters;
2. run it in selector-check mode;
3. run the action's `prepare` again, to clean up after the check.

It SHALL report pass or fail per action and exit non-zero on any failure.

#### Scenario: UI renamed a button
- **WHEN** the product renames "Add skill" and `actions:check` runs
- **THEN** `skills.add` fails, naming the unresolved target, and the other actions still report

### Requirement: Actions and surfaces are committed, without account data
Action and surface definitions SHALL be committed, so the library is shared and
versioned. They SHALL NOT contain any of these:
- URLs, hostnames;
- workspace, project, app or other account ids;
- credentials, tokens.

Anything account-specific SHALL come from the environment. A test SHALL scan
every action and surface file and fail on a URL, a hostname, or an id-shaped
literal (a UUID, or a long hex or base62 token), naming the file and line.

A public example surface and action (against the public site the committed
`skillsmp-search` flow already uses) SHALL also be committed, so composition and
recording tests run without an account.

#### Scenario: Hardcoded URL
- **WHEN** an action file contains `https://eu.cloud.agenta.ai/...`
- **THEN** the hygiene test fails, naming the file and line

#### Scenario: Fresh clone
- **WHEN** the repository is cloned with no `.env` and no session
- **THEN** `pnpm test` runs the contract checks on every committed action, and the composition tests on the example set, and passes
