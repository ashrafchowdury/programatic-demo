# Spec Delta

## Purpose

Gives Agenta its own reel skill, kept strictly inside the brand kit, next to a
brand-neutral reel skill. This is the same split the graphics skills already
use, so an Agenta launch post becomes an on-brand reel without anyone
re-stating the brand.

## ADDED Requirements

### Requirement: The Agenta reel brand pack
The repository SHALL ship an Agenta reel brand pack built from the Agenta brand
kit:

| | value |
| --- | --- |
| primary | Icetrine `#F2F25C` |
| text and logo | Black `#1E1C1D` |
| background | White smoke `#F6F5F3` |
| dark ground | `#181010` |
| accents | Uranian Blue `#B8E1FF`, Rosewood `#5E0908` |
| neutrals | `#F6F5F3` through `#181010` |
| headings | GT Alpina Light |
| accent word | PP Mondwest, at most one word per card |
| body | Inter |

Logos:
- black logo on light;
- yellow mark with white wordmark on dark;
- black logo on yellow;
- matching monograms.

Text and logo SHALL use `#1E1C1D`, and SHALL NOT use the graphics pack's
`#242424`.

#### Scenario: Pack resolves
- **WHEN** the Agenta reel pack loads with its font files present
- **THEN** it exposes those colours, faces and logos, and nothing else

### Requirement: The agenta-reel skill
`.agents/skills/agenta-reel/SKILL.md` SHALL take post text in and hand a person
only audited reels:
1. save the post verbatim;
2. write a brief under the default house (`agenta@2`, one-take) with a title,
   footage from existing actions, and 1–3 outro lines;
3. validate it, retrying at most twice;
4. run `pnpm launch`;
5. check that the brand audit and the gates pass;
6. hand over the reel paths, the copy and the gate summary.

It SHALL state the brand rules the audit cannot check: tone of the copy, which
word deserves the accent face, and that yellow leads. It SHALL point to the
brand-neutral `intro-reel` skill for any other brand.

#### Scenario: Post in, reel out
- **WHEN** an agent follows the skill with a pasted Skills launch post
- **THEN** it produces `out/reel/<name>.mp4` and `.9x16.mp4` under `agenta@2`, with the brand audit passing, without hand edits

#### Scenario: No action covers the feature
- **WHEN** the post's feature has no action in the library
- **THEN** the skill stops and names the missing action, as `intro-reel` does

### Requirement: intro-reel stays brand-neutral
`intro-reel` SHALL keep working for any brand without the Agenta pack. It SHALL
direct Agenta reels to `agenta-reel`, and SHALL NOT restate Agenta's colours or
fonts.

#### Scenario: Another brand
- **WHEN** an agent makes a reel for a non-Agenta product with `intro-reel`
- **THEN** nothing in its instructions requires or applies the Agenta pack
