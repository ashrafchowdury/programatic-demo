# Proposal

## Why

The compiled reel has one shape today: a card before every beat, cut into short
clips. For most Agenta launches, the clearer film is the simplest one:

- name the feature;
- show the whole interaction in one uncut take, with the camera following the
  clicks;
- sign off with a line and the logo.

That shape should be the default, because nobody has to judge where to cut the
demo, so it varies least from launch to launch.

Reels also don't carry Agenta's brand. Cards render in Inter on style-defined
greys, and the sign-off uses a generic `logo-mark.png`. Graphics already solved
this: a brand-neutral `social-graphic` skill plus an `agenta-social-graphic`
skill that locks every post to the brand kit and audits it. Reels need the
same split, so every Agenta reel has the brand's fonts, colours and logos,
whoever or whatever makes it.

## What Changes

- **A new `one-take` reel style.** It is a preset like the others: data only,
  with no code branching on its name. Its parts:
  - a title card;
  - the recorded demo as **one continuous clip**, inside the framed window, with
    the click-driven zoom camera moving in and out;
  - closing text;
  - the logo lockup.

  Footage plays at the house speed (1.25×).
- **A second reel shape in the compiler.** A house names its shape:
  - `beats`: today's shape, unchanged;
  - `one-take`.

  Under `one-take`, a brief holds a title, its footage, and 1–3 closing lines.
  It holds no beats and no payoff.

  The compiler builds:
  1. the title card;
  2. one clip, from just before the first action to after the last action, so
     the camera can pull back;
  3. one card per closing line;
  4. the logo card.
- **`agenta@2` becomes the default house.** It uses the `one-take` style, 16:9
  and 9:16, the same audio, and the Agenta brand pack. `agenta@1` and
  `agenta-classic@1` stay frozen and unchanged. A brief that pins them compiles
  exactly as before.
- **Reel brand packs.** A pack sets the card palette roles, the faces, and the
  logo files (full logo and monogram, on light, dark and yellow). It is applied
  on top of the style, so a style keeps its motion and layout numbers while the
  pack decides how the film looks.
  - The compiler and renderer read the pack named by the house.
  - Faces load through the existing font loader, which now loads any face the
    pack names rather than Inter only.
- **The Agenta reel brand pack**, from the Agenta brand kit:

  | role | value |
  | --- | --- |
  | primary | Icetrine `#F2F25C` |
  | text and logo | Black `#1E1C1D` |
  | background | White smoke `#F6F5F3` |
  | dark ground | `#181010` |
  | accents | Uranian Blue `#B8E1FF`, Rosewood `#5E0908` |
  | neutrals | the 100–900 ramp |
  | headings | GT Alpina Light |
  | accent word | PP Mondwest, at most one word |
  | body | Inter |

  Text and logo use `#1E1C1D`, the brand kit's value, where the graphics pack
  uses the website's `#242424`. The licensed font files are reused from the
  graphics skill's gitignored `brand/fonts/` and never committed.
- **A reel brand audit.** Any rendered reel under a branded house is checked:
  - **static check:** every colour, face and logo in the resolved reel comes
    from the pack;
  - **frame check:** a pixel check on card frames that their colours fall
    within the pack's palette.

  A failure fails the launch gate, like the graphics audit does.
- **A new `agenta-reel` skill**, next to the brand-neutral `intro-reel`, in the
  same split as the graphics skills. It covers:
  - post copy in, and a one-take brief out by default;
  - `pnpm launch`;
  - the brand audit;
  - only audited reels handed to a person.

  `intro-reel` stays brand-neutral and points Agenta work at `agenta-reel`.

This builds on the in-flight `post-to-reel-compiler` change, which provides
briefs, houses, the compiler, actions and `launch`. Those capabilities aren't
archived into `openspec/specs/` yet, so their new requirements are added here
as new capabilities rather than as deltas.

## Capabilities

### New Capabilities
- `one-take-reel`: the `one-take` style preset, the `one-take` compiler shape
  and brief fields, and `agenta@2` as the default house.
- `reel-brand-pack`: the brand pack format, how a house applies it to cards,
  type and logos, font loading, and the reel brand audit.
- `agenta-reel-skill`: the Agenta reel brand pack and the `agenta-reel` agent
  procedure, in the same split as `agenta-social-graphic` and `social-graphic`.

### Modified Capabilities
<!-- None in openspec/specs/: the brief, house and compiler capabilities this
     builds on are still in the unarchived post-to-reel-compiler change. -->

## Impact

- **New code:**
  - `src/lib/style/presets/one-take.ts`
  - `src/lib/brand.ts` (pack types, loading, application, static audit)
  - the frame audit, inside the launch gate
  - the `brands/agenta/` reel brand pack (palette, type, logo SVGs; font files
    gitignored)
  - tests
- **Changed code:**
  - `src/lib/house.ts`: `shape`, `brand.pack`, and `agenta@2` as the default.
  - `src/lib/brief.ts`: one-take fields.
  - `src/lib/compile-brief.ts`: the one-take shape.
  - `src/lib/font.ts`: loads the faces a pack names.
  - `src/Intro.tsx`: logo files from the pack.
  - `scripts/launch.ts`: the brand audit in the gate.
- **Skills:**
  - new `.agents/skills/agenta-reel/SKILL.md`;
  - `intro-reel` points at it for Agenta work.
- **Docs:** AGENTS.md (reel row, Layout) and CATALOG.md (the one-take style).
- **Unchanged:**
  - `agenta@1` and `agenta-classic@1` (frozen hashes);
  - the existing hand-written reels;
  - the other four styles.
- **Licensing:** GT Alpina and PP Mondwest are paid faces and stay gitignored. The
  GT Alpina Light file agenta.ai serves is a trial cut, as the graphics skill
  already notes. A paid campaign needs the licensed file.
