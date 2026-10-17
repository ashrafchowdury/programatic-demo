# Spec Delta

## Purpose

Turns a validated brief and its demo's click log into a reel, applying the
editing, audio and aspect rules once, in code, under a versioned house style.
The same post then produces the same film every time.

## ADDED Requirements

### Requirement: Compilation is deterministic
Compiling the same brief against the same click log under the same house
version SHALL produce the same reel, field for field. Compilation SHALL NOT
read the clock, the network, random sources or environment variables, except
the playback speed the render already uses.

#### Scenario: Repeat compile
- **WHEN** a brief is compiled twice with no change to the brief, the click log or the house
- **THEN** the two reels are identical

### Requirement: Versioned house style
A house style SHALL be a named preset with an integer version holding every
number and choice the composer and compiler use:
- base reel style;
- copy rules (word ranges, banned words);
- beat limit;
- shoot pacing (establish, gap between actions);
- clip lead, tail, typing tail, payoff tail, gap, and caps;
- card holds;
- tone plan;
- chip tone and `open` scale;
- drift;
- wordmark;
- audio;
- aspects;
- maximum reel length.

A published version SHALL NOT change; a change SHALL publish a new version. A
brief that pins a version SHALL compile under it. The default house SHALL be
`agenta@1`, on the `stage` style, rendering 16:9 and 9:16.

#### Scenario: Default house
- **WHEN** a brief names no house
- **THEN** it compiles under `agenta@1` with `style: "stage"`

#### Scenario: Pinned version
- **WHEN** a brief pins `agenta@1` and `agenta@2` exists
- **THEN** it compiles under `agenta@1`

#### Scenario: Unknown version
- **WHEN** a brief pins a version that does not exist
- **THEN** compilation fails, naming the versions that exist

### Requirement: Segment structure
A compiled reel SHALL have, in order:
1. a title card holding `title` and the house wordmark;
2. per beat, its card, then one clip of that beat;
3. if `payoff` is present, the payoff card with its chip, then one clip of the chip's action;
4. a sign-off card holding `signoff` and the wordmark.

It SHALL set `style` to the house base style explicitly.

#### Scenario: Two beats with a payoff
- **WHEN** a brief with two beats and a payoff compiles
- **THEN** the segments are title, card, clip, card, clip, payoff card, clip, sign-off

### Requirement: Clips anchor to beats
Each clip SHALL be written as beat anchors, never seconds:
- **Start:** the beat's `from` press, offset by the house lead.
- **End:** after the beat's last label. The end edge is the label's typing end
  for a typing beat and its press otherwise, plus the house tail. For the
  payoff clip, the house payoff tail applies.

A clip SHALL:
- be pulled in so it does not end within the house gap of the next clip's start;
- not show more typing than the house typing cap;
- not exceed the house clip cap.

Any clip shortened by a cap SHALL be reported. A re-shoot that keeps the labels
SHALL compile to clips at the new beat times without editing the brief.

#### Scenario: Typing beat
- **WHEN** a beat's last label types from 6.81s to 8.14s
- **THEN** the clip's end is anchored to that label's typing end plus the house tail

#### Scenario: Re-shoot moves a beat
- **WHEN** a re-shoot moves the "Create" press from 18.06s to 19.10s
- **THEN** the unchanged brief compiles the payoff clip 1.04s later

#### Scenario: Cap reached
- **WHEN** a beat types for longer than the house typing cap
- **THEN** the clip is cut at the cap, and the report names the beat and the seconds cut

### Requirement: Card tone plan
Card backgrounds SHALL come from the house tone plan, and a brief SHALL NOT set
them. Under `agenta@1`, every card is light except the sign-off, which is dark.

#### Scenario: Default tone plan
- **WHEN** a brief compiles under `agenta@1`
- **THEN** every card except the last is light, and the last is dark

### Requirement: Payoff cuts on a match
With a `payoff`, the payoff card SHALL carry the chip in the house chip tone,
and the clip after it SHALL open framed on the chip's control at the house
`open` scale. The pill SHALL read the control's text: the declared control
text of the chip's label (resolved with the footage's parameters), or the
brief's `payoff.text` for a `demo` brief. It SHALL never read the label.

#### Scenario: Chip match
- **WHEN** the payoff chip is "Create"
- **THEN** the payoff clip opens at the house `open` scale, framed on the "Create" beat

#### Scenario: Pill reads the control, not the label
- **WHEN** the payoff chip is "pick domain", declared with control `{ param: "domain" }`, and the footage passes `domain: "Development"`
- **THEN** the pill reads "Development"

### Requirement: House audio
A compiled reel SHALL carry the house audio and a brief SHALL NOT set audio.
The house audio is:
- a bed trimmed to the reel's length, with the house fades and gain;
- click, typing and pop SFX from the click log;
- a confirm SFX on the payoff chip's label, or on the last beat's last label
  when there is no payoff;
- ducking of the bed under SFX;
- loudness normalized to the house target (−14 LUFS for `agenta@1`).

#### Scenario: Bed fits the reel
- **WHEN** a brief compiles to a 16.2s reel
- **THEN** the bed spans 0–16.2s and fades out over the house fade-out ending at 16.2s

#### Scenario: Confirm lands on the payoff
- **WHEN** the payoff chip is "Create"
- **THEN** the confirm SFX is placed at the "Create" beat

### Requirement: House aspects
Rendering a brief SHALL produce one reel per house aspect:
`out/reel/<name>.mp4` for 16:9 and `out/reel/<name>.9x16.mp4` for 9:16. An
`--aspect=` option SHALL render only that aspect. Cards reflow and footage
follows the clicks, as the existing aspect support does.

#### Scenario: Default render
- **WHEN** `pnpm reel foo` renders a brief under `agenta@1`
- **THEN** both `out/reel/foo.mp4` and `out/reel/foo.9x16.mp4` are written

#### Scenario: Classic renders both aspects
- **WHEN** `pnpm reel foo` renders a brief that pins `agenta-classic@1`
- **THEN** both `out/reel/foo.mp4` and `out/reel/foo.9x16.mp4` are written, in the `classic` style

### Requirement: Compiled reels pass the existing reel checks
A compiled reel SHALL pass the reel validator and `--check` beat resolution in
every house aspect. Failures SHALL be reported against the brief field that
produced them.

#### Scenario: Overlapping clips
- **WHEN** two adjacent beats compile to overlapping ranges
- **THEN** compilation fails, naming both brief beats, before any rendering

### Requirement: Brief CLI and reel fallback
The brief CLI SHALL validate and compile a brief and print the `--check`
report, including reel length against the house maximum. Its emit option SHALL
write `reels/<name>.ts`:
- with a header naming the brief and house version it came from;
- refusing to overwrite an existing file unless forced.

`pnpm reel <name>` SHALL render from `reels/<name>.brief.json` when there is no
`reels/<name>.ts`. When both exist, the `.ts` SHALL win and a notice SHALL say so.

#### Scenario: Render from a brief
- **WHEN** only `reels/foo.brief.json` exists and its demo is recorded
- **THEN** `pnpm reel foo` validates, compiles and renders it

#### Scenario: Hand-written reel wins
- **WHEN** both `reels/foo.ts` and `reels/foo.brief.json` exist
- **THEN** `pnpm reel foo` renders the `.ts` and prints that the brief was ignored

#### Scenario: Emit refuses overwrite
- **WHEN** emit runs, `reels/foo.ts` exists, and the force option is not given
- **THEN** nothing is written and the command exits non-zero

### Requirement: Existing reels are unchanged
Briefs, house styles and the end-edge anchor SHALL NOT change how any existing
hand-written reel resolves or renders.

#### Scenario: Hand-written reel regression
- **WHEN** `pnpm reel <name> --check` runs on an existing reel before and after this change
- **THEN** the printed ranges and segments are identical

#### Scenario: Rendered reel regression
- **WHEN** `agent-skill` is re-rendered after this change and compared with a render from before it, using `analyze --compare`
- **THEN** segment count and length are identical, and no motion metric moves beyond run-to-run render noise
