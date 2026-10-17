# Spec Delta

## Purpose

A brand pack decides how a reel looks for one brand: its card colours, its
typefaces and its logos. Any style can then be cut in any brand, and an audit
proves that nothing off-brand reached the film.

## ADDED Requirements

### Requirement: Brand pack contents
A reel brand pack SHALL declare:
- **an id;**
- **a palette:** the brand's allowed colours by name, and which of them fill
  each card ground role and each ink role;
- **faces:** a heading face, an optional accent face with a word limit, and a
  body face. Each SHALL have a family name, the font file path, and its cap
  ratio.
- **logos:** a full logo and a monogram, each as an SVG file for light, dark
  and accent grounds, plus the wordmark text.

A pack whose font or logo file is missing SHALL fail to load, naming the file.

#### Scenario: Missing font file
- **WHEN** a house uses the Agenta pack and `GT-Alpina-Light.woff2` is not present
- **THEN** compilation fails, naming the file and the setup step that provides it

### Requirement: A house applies its pack
A house MAY name a brand pack. When it does, the compiled reel SHALL render
with:
- card grounds and inks from the pack's role mapping;
- headings in the pack's heading face, and body text in its body face;
- the sign-off lockup built from the pack's logo for that card's ground.

The style's motion, layout and timing numbers SHALL NOT change. A house with no
pack SHALL render exactly as today.

#### Scenario: Agenta pack on the one-take style
- **WHEN** a brief compiles under `agenta@2`
- **THEN** the title and outro cards use White smoke `#F6F5F3` with ink `#1E1C1D`, headings render in GT Alpina Light, and the logo card shows the black Agenta logo

#### Scenario: No pack
- **WHEN** a hand-written reel with no house renders
- **THEN** its cards, faces and logo are exactly as before this change

### Requirement: Accent word
Copy MAY mark one word with the accent face. A brief SHALL be rejected when it
marks more words than the pack allows (one for Agenta), or when the pack has no
accent face.

#### Scenario: Two accent words
- **WHEN** a title marks two words for the accent face under the Agenta pack
- **THEN** validation fails, naming the title and the one-word limit

### Requirement: Faces load before the first frame
Every face the pack names SHALL be registered and loaded before Remotion draws
the first frame, the way Inter is loaded today. Font files SHALL load from
local disk, never from a network font service.

#### Scenario: Deterministic type
- **WHEN** the same card is rendered twice
- **THEN** both renders use GT Alpina on every frame, with no fallback-face frames

### Requirement: Reel brand audit
Every reel rendered under a house with a pack SHALL pass a brand audit in the
launch gate:
- **Static:** every colour, face and logo file in the resolved reel's cards SHALL
  come from the pack. Footage is the product's own pixels and is excluded.
- **Frames:** on sampled card frames, every pixel colour SHALL lie within a
  stated anti-aliasing distance of a pack colour, or of a blend of two of them.

A failure SHALL fail the gate, naming the card, the off-brand colour or face,
and where it came from.

#### Scenario: Off-brand colour
- **WHEN** a card renders a grey not in the pack
- **THEN** the gate fails, naming the card and the colour

#### Scenario: Footage excluded
- **WHEN** the product UI in the clip shows colours outside the pack
- **THEN** the brand audit passes, because footage is not audited

### Requirement: Licensed files stay out of git
Font files a pack names under a paid licence SHALL be gitignored. The pack SHALL
document where each file comes from, and SHALL flag that the GT Alpina Light
cut agenta.ai serves is a trial file.

#### Scenario: Fresh clone
- **WHEN** the repository is cloned without the licensed font files
- **THEN** `pnpm test` still passes, and only rendering under the Agenta pack asks for the files
