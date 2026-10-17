# Design

## Context

See proposal.md for the motivation. Facts about the current code that shape this design:

**Styles**
- Styles are data. `src/lib/style/` holds a `BASE` grammar plus one override
  file per preset (`classic`, `proof`, `ledger`, `stage`), and no component may
  branch on a style's name (`src/lib/style.ts`, "THE ONE RULE").
- `classic` already has what one-take needs for footage: `shot.framing:
  "window"`, a click-log zoom camera, and the pointer.
  `DEFAULT_STYLE` is `proof`.
- A preset's `palette` (`PaletteStyle`, ground roles) and `type`
  (`TypeStyle.fontFamily`, `sizePx`) decide how cards look. Sizes were tuned
  against Inter's cap ratio (0.7275).
- `src/lib/font.ts` loads exactly one face, Inter, from `public/fonts/`. It uses
  `delayRender` so no frame renders before the face is ready. Remotion can only
  load files under `public/`.
- The sign-off lockup in `src/Intro.tsx` is `public/logo-mark.png` plus the
  wordmark set as text.

**Houses and the compiler**
- Houses (`src/lib/house.ts`) are frozen by hash. `HouseBrand` holds the
  wordmark, banned words, tone plan, chip tone and audio, but nothing visual.
- `compileBrief` has one shape: title, then a card and a clip per beat, then
  the payoff, then the sign-off. The beat caps (`typingCapS`, `clipCapS`) are
  meant to shorten clips. A one-take clip must not be cut by them.

**The brand assets**
- The graphics pack (`.agents/skills/agenta-social-graphic/brand/`) already
  holds the logo SVGs. Its licensed fonts (GT Alpina, PP Mondwest) are
  gitignored and fetched once per machine.
- That pack's colours come from the website tokens (ink `#242424`). The brand
  kit says text and logo are `#1E1C1D`; the user chose the brand kit for reels.

**Measured**
- The skills-launch take on demo-agent is about 21s at 1.25×. A one-take reel
  is therefore about 21s of footage plus about 6s of cards.

## Goals / Non-Goals

**Goals:**
- One-take is a preset plus a compiler shape. It adds no style-name branches.
- A brand pack changes only how a reel looks: palette, faces, logos. Motion,
  layout and timing stay with the style.
- `agenta@1`, `agenta-classic@1` and every hand-written reel render exactly as
  before.

**Non-Goals:**
- Auditing footage colours, because the product UI is not the brand palette.
- Re-styling the beats shape under the Agenta pack. It can opt in later with a
  new house version.
- A brand pack for any brand other than Agenta. The format is general, but only
  Agenta ships.
- Animated logo marks. The lockup keeps today's reveal.

## Decisions

### 1. One-take is a new preset over `classic`'s shot grammar
`src/lib/style/presets/one-take.ts` overrides `BASE` with:
- `look: "framed"`;
- `shot.framing: "window"`, with the click camera, `cursor: true` and `ripple: false`;
- `join: cut`;
- cards on a flat ground role, not the photographic `plate`, so the brand
  pack's ground fills them;
- the `classic` card cadence and holds;
- `source: null` and `targets: null`.

*Rejected:*
- Reusing `classic` with a different compiler shape. `classic` cards sit on
  the photographic plate and ramp out, and changing `classic` would change
  `agenta-classic@1`.
- A boolean "uncut" flag on any style. That is a branch dressed as data.

### 2. The shape lives on the house, not the style
`House.shape: "beats" | "one-take"`. The compiler dispatches on the house's
shape, which is data the brief resolves.

A style decides how a film moves. A shape decides what goes in it. The same
style could, in principle, cut a beats reel.

`agenta@1` and `agenta-classic@1` get `shape: "beats"` by default when the
field is read. Their hashed contents are unchanged, because the field is
defaulted at read time rather than added to the frozen object. The hash test
proves it.

### 3. One-take brief fields
A one-take brief has `title`, `footage | demo` and `outro: string[]`
(1..`house.outro.max`). It has no `beats`, `payoff` or `signoff`. The closed
schema is chosen by the resolved house's shape, and errors name the shape.

The clip anchors to:
- **start:** the first declared label, with `leadS`;
- **end:** the last declared label. It uses `toEdge: "typeEnd"` when that label
  types, and `house.cut.payoffTailS` either way, so the camera can trail back.

The beat caps are not applied. The whole take is the point. The guard is
`maxLengthS`, which is checked at compile time.

### 4. Brand packs are applied when a preset is resolved
`resolveStylePreset(style, brandId?)` returns the preset with:
- `palette` grounds and inks replaced by the pack's role mapping;
- `type.fontFamily` set to the pack's heading face;
- `type.sizePx` scaled by `styleCapRatio / packCapRatio`, so the cap height a
  style was tuned for is kept in the new face.

Components already read the resolved preset, so none of them learns about
brands.

The reel carries the brand id: a new optional `brand` field on `Reel`, set by
the compiler from the house and passed to compositions as a prop. A reel
without it resolves exactly as today.

*Rejected:* new preset files per brand (`one-take-agenta`). That multiplies
styles by brands.

### 5. Pack files: committed data, gitignored licensed fonts
`brands/agenta/brand.json` holds:
- the palette, with names, hexes and role mapping;
- the faces: family, file path, cap ratio, accent word limit;
- the logos: one SVG path per variant;
- the wordmark.

The logo SVGs are committed copies of the brand kit's traced vectors.

Font paths point at `.agents/skills/agenta-social-graphic/brand/fonts/`, so
there is one gitignored copy per machine, and the setup step stays the one the
graphics skill already documents.

Before bundling, `scripts/lib/brand-assets.ts` copies the pack's fonts and
logos into gitignored `public/brand/<id>/`, because Remotion can only load
files under `public/`. A missing file fails there, naming the setup step.

### 6. The font loader loads what the pack names
`loadFonts(faces)` registers each face with `delayRender`, the same mechanism
as Inter. Inter stays the default when there is no pack. Registration is
idempotent per family.

### 7. Accent-word markup
`^^word^^` marks one word for the pack's accent face (PP Mondwest). `==word==`
keeps its pill meaning, and `{chip}` keeps its token. The brief validator counts
accent marks against the pack's limit. A pack with no accent face rejects any
accent mark.

### 8. Logo lockup from the pack
The logo card renders the pack's full-logo SVG for its ground:
- light ground: black logo;
- dark ground: yellow mark with white wordmark;
- yellow ground: black logo.

It no longer draws `logo-mark.png` plus a text wordmark. The existing reveal
timing is kept. Reels without a pack keep `logo-mark.png`.

### 9. The brand audit has two halves, both in the gate
- **Static (pure, `brandProblems(resolvedReel, pack)`).** Every card's ground
  and ink role, face and logo variant must resolve to a pack value. This runs at
  compile time too, so `pnpm brief` shows the problem before anything renders.
- **Frames.** The gate takes the card segments from the compiled timeline and
  extracts 3 frames per card with system ffmpeg: the first frame after its
  reveal, mid-hold, and the last. Each pixel must lie within an RGB distance of
  a pack colour, or of the segment between two pack colours (anti-aliased edges
  blend two colours). The tolerance is a house gate field. It is set from the
  first render's measured compression noise and recorded with its measurement.

Footage segments are never sampled.

### 10. agenta@2 seeds
`agenta@2` starts with:
- `shape: "one-take"` and `style: "one-take"`;
- the Agenta pack;
- shoot speed 1.25, and `agenta@1`'s audio block;
- aspects 16:9 and 9:16;
- `outro.max: 3`;
- `maxLengthS: 40`, which leaves room for the skills take of about 27s;
- `cut.leadS: -0.2` and `payoffTailS: 1.2`, from `agenta@1`'s measured cut.

It is frozen by hash after the validation render (tasks group 6), and
`HOUSE_DEFAULT` moves to it.

### 11. The skill split mirrors graphics
- `agenta-reel/SKILL.md` is the Agenta procedure, with the brand rules the
  audit can't check.
- `intro-reel` loses its Agenta specifics and gains a pointer.

AGENTS.md gets the reel skill row, the same way it lists the two graphics skills.

## Risks / Trade-offs

- **Long takes can drag.** A take with slow loading would play every second of
  it. → `maxLengthS` fails the compile. The skill tells authors to keep
  actions short. The ready waits are off camera, before the clock starts.
- **GT Alpina Light is a trial cut.** → The setup docs flag it, as the graphics
  skill does. Swap in the licensed file before a paid campaign; nothing in
  code changes.
- **Compression noise can trip the frame audit.** → The tolerance comes from
  measurement, and the blend rule covers anti-aliasing. The audit samples card
  frames only, which are flat colour fields.
- **Scaling sizes by cap ratio can change line breaks.** → Line pitch scales by
  the same factor, and the card tests assert wrap at both aspects.
- **Two ink values exist across skills** (`#1E1C1D` for reels, `#242424` for
  graphics). → This is recorded in both skills. Aligning graphics is out of
  scope and is the user's call.

## Migration Plan

The change is additive. New briefs without a `house` move to `agenta@2` once
the default switches, which happens at the end of task group 6. Pinned briefs
and hand-written reels are unaffected. Rollback means pointing `HOUSE_DEFAULT`
back to `agenta@1`.

## Open Questions

- Final `agenta@2` seeds and the frame-audit tolerance. The first validation
  render sets them, then the house freezes. This changes numbers, not structure.
