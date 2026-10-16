---
name: social-graphic
description: Make a social post image (X, LinkedIn; 2839×1596 by default) for any brand — pick the format from the post type, fill a template, render, and pass an audit driven by a brand pack (palette, faces, logos, rules). Seventeen formats, from quiet title cards to light-led launch art, reverse-engineered from 504 post images by eight product companies. Not for a screenshot of an app (shoot-still) or video (demo, reel). For Agenta's own posts, use agenta-social-graphic.
metadata:
  tags: social, image, brand, launch, x, linkedin
---

# Social graphic

A designed image for a post: a title, a pair of logos, a floating card, a
chart, an arc of light. Brand-neutral: every colour, face, logo and limit comes
from a **brand pack**, and the same templates render for any company.

**This is not a still.** A still photographs the running app
(`.agents/skills/shoot-still/SKILL.md`). A proof graphic may *embed* a still's
PNG, but it is authored here. The output is a PNG; there is no video.

```
kit/base.css         layout and components, written against brand roles only
kit/templates/       seventeen formats as HTML fragments
brands/example/      a neutral brand pack (system faces) to copy from
render.mts           render + audit + 20 % feed preview
reference.md         the measured evidence; studies/ holds the eight full studies
```

Brand packs that live elsewhere: `.agents/skills/agenta-social-graphic/brand`.

## The system

The system has eight rules. Each is a measured invariant shared by the studied
accounts; the numbers are in [reference.md](./reference.md).

1. **Fixed furniture, changing message.** Every post sits on the same frame (a
   gutter, a raised panel, a hairline) with the logo fixed at the top-left of
   the safe area. In a feed, the repetition is the brand.
2. **One title, one size.** At most one title of at most 8 words, cap height 8 %H.
   There is no kicker, subhead, CTA, URL or price; the post text carries them.
3. **Quiet canvas.** 2–9 % of pixels differ from the ground on text posts, and
   under 14 % on UI posts. One thing is the strong mass.
4. **Readable or texture.** Text that must be read has a cap height of at least
   2.9 %H (about 9 px in the feed). Smaller UI text is texture: mark it
   `data-texture` and expect nobody to read it.
5. **Proof bleeds.** A screen starts at about 50 %W and runs off the right and
   bottom edges. A whole screenshot shrinks to mush.
6. **Logos carry partner posts.** Show the partner as a tile or a rebuilt mark
   in its own colours, with no words.
7. **One accent moment** per post, never behind the brand's logo.
8. **Light is the only colour on dark** (light-led formats only). Saturated
   colour arrives as emitted light on a near-black ground, with the canvas at
   most about 35 % lit.

## Pick the format from the post type

The format is the first thing a follower reads, so the mapping is fixed.

**The everyday set** works for any brand:

| Post type | Format |
| --- | --- |
| Feature, GA, capability, one-line claim | **statement** |
| Feature with a real screen | **proof** |
| Integration, partner, model | **pair** |
| Channel or integration, as a signature | **mosaic**: the partner's mark rebuilt from 40×40 rounded pixels |
| Approvals, human-in-the-loop | **exchange** |
| Feature whose value is the surrounding workflow | **context**: real UI faded to texture around one title (Cursor) |
| Eval, benchmark, metric | **figure** |
| Link card | **quiet** |
| Metrics, ranges, results; real numbers only | **ledger**: numerals 2–5× the title on flat paper, hairline rules, the accent behind one numeral (Perplexity) |
| Integration, channel, customer story | **field-report**: a hard paper/ink split, partner marks on paper, 3–4 labelled facts on ink (Linear) |
| Evals, rollouts, milestones | **woven**: a band of cells, one per real run/eval/agent, coloured by state, one accent cell (Granola) |
| A feature that deserves weight | **graphite**: one large title on dark over a dim field of the product's own forms (Resend, flat) |

**The light-led set** is for posts that should stop the scroll. These formats
need a brand that allows light (`"allowLight": true`):

| Post type | Format | The one technique |
| --- | --- | --- |
| Launch, milestone, countdown; 1–4 words | **lamplight** | An arc of light that the letters take where it crosses them, plus grain (Resend, Raycast) |
| Cost, latency or eval win | **live-line** | One emissive stroke drawn from the real series, with no axes (Raycast) |
| Concept with no screen | **construction** | The real structure as line art in three stroke weights, with one accent node (Linear) |
| Channel, integration, launch; a product window | **daylight** | A pale sky warming into tone-on-tone accent dunes with rim light; the window floats centred |
| Partner pair, milestone, one moment | **sunrise** | A white sun rising from the bottom of an accent ground, rays and rings; the subject sits in its glow |

The light-led formats are part of the collection, not the default. Most posts
stay in the everyday set; reach for light when one post in the series should
stop the scroll, and don't run two light-led posts in a row.

A launch usually needs two images: the post image and its link card (pair,
mosaic or quiet).

## Make it

1. **Choose the brand.** Put the brand pack's path, relative to the repo root,
   in `social/<name>/brand`. Without that file, `--brand <dir>`, or
   `$SOCIAL_BRAND`, the example brand is used.
2. **Write the title.** Sentence case, at most 8 words. If the claim doesn't
   fit, it belongs in the post text.
3. **Build the variants.** Copy the template(s) into `social/<name>/`.
   `{{brand}}` resolves to the brand pack, `{{kit}}` to `kit/`, and
   `{{inline:assets/x.svg}}` to a data URL, which a scripted format such as
   mosaic needs. Other relative paths resolve against the post's folder. Make
   three variants unless the brief says one.
4. **Add assets.** Put partner logos in `social/<name>/assets/` as official
   files only, and keep `data-third-party` on them. For proof, capture the real
   screen first.
5. **Render and audit.**

   ```bash
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>
   ```

   `--preset card` gives 2400×1260 (a 1.91:1 link card), `--preset square`
   gives 2160×2160, and `--preset all` renders every preset. The output goes to
   `out/social/<name>/`.

   The audit fails the run on:
   - an off-palette colour
   - a face the brand doesn't list
   - unreadable text
   - text or the logo outside the safe area
   - too many titles, title words or accent-face words
   - a missing logo, or one on the accent colour
   - too many accent moments
   - a blur over the brand's limit
   - light or grain in a brand that forbids them
   - a format or ground the brand doesn't allow
   - a font or image that failed to load

   Fix the post, never the audit.
6. **Look.** Open the PNG, then the `.feed.png`. At feed size, check that:
   - the title reads in one glance
   - the partner is identifiable
   - nothing meant to be read has turned to mush
   - the eye lands on one thing first

   If not, cut an element before you shrink anything.
7. **Deliver.** Send the PNGs with each one's format, ground and title. Flag any
   third-party mark you drew rather than downloaded.

### Grounds

`class="post paper"` (panel in a gutter), `post carbon` (dark), or
`post yellow` (the accent as the ground). On a yellow ground the ground is the
accent moment. A brand that never puts its logo on the accent adds class
`plate` to the lockup (`<div class="lockup plate">`), which gives it a panel
backing; set `logoNeverOnAccent` in `brand.json` and the audit enforces it. A brand can restrict grounds with `"grounds": ["paper", "yellow"]` in
`brand.json`; the audit refuses any other.

### Light, gradients, grain, scripts

- **Light.** Mark an element `data-light` when its gradient or blur *is* a
  light source. Only then does the audit allow it, and only for brands with
  `allowLight`.
- **Grain.** Add `<div class="grain"></div>` as the last child, for light-led
  posts only.
- **Scripts.** A post that draws with a script sets `window.__ready = false`,
  then `true` once it has drawn.

## Make a brand pack

Copy `brands/example/` and replace:

- **`brand.css`:**
  - Palette: every allowed colour, as `--c-*`. The audit's allow-list is
    exactly these.
  - Roles: `--ground --panel --panel-2 --tint --line --ink --ink-2 --ink-3
    --dark --dark-2 --dark-3 --dark-line --on-dark --on-dark-2 --accent
    --accent-ink --data --data-muted --ok --wait`.
  - Type: `--font-display --font-accent --display-weight --read-weight
    --cap-display --cap-accent`, and optionally `--font-ui --cap-ui` for card
    and UI text (`.read`, `[data-texture]`, `.btn`); without them UI text
    uses the display face.
  - Chips, radii and shadows.
  - Any `@font-face`. Font URLs resolve relative to the pack.
- **`brand.json`:**
  - Faces, each with its measured cap ratio and an optional word limit.
  - Required files.
  - The accent hexes, accent classes and accent limit.
  - Gradient classes.
  - `allowLight`.
  - Shadow blur limit and size floors.
  - Allowed archetypes: a list, or `"all"`.
  - Allowed grounds (optional): e.g. `["paper", "yellow"]`.
- **`logos/`:** `logo-light`, `logo-dark`, `logo-dark-accent`, `mark-light`,
  `mark-dark` and `mark-dark-accent` (`.svg`). The file name names the ground.

**Measure each face's cap ratio. Never guess it.** Render an "H" at 1000 px on
a canvas and read `actualBoundingBoxAscent / 1000`. Load the face first with
`document.fonts.load()`; a fallback face measures differently. Then check with
`--templates --brand <dir>`, which renders all seventeen formats in the new brand.

## Do not copy

We took the ideas, not the looks. Never reproduce any of the following:

- **Vercel:** the ▲, pyramids, light-sweep backdrops.
- **Cursor:** off-white with orange, the landscape painting, the cube, the
  CursorBench scatter.
- **Grok Bot:** blob mascots, the blue swoosh plate, the tile-orbit template.
- **Linear:** orbits, funnel-to-square art, scanlines.
- **Raycast:** red light on pure black, keycaps, smoked-glass documents.
- **Resend:** red/orange light with condensed capitals, silver-on-black serif.
- **Granola:** lime and pink, red-dot halftone, brush lettering.
- **Perplexity:** the teal accent, dune/hill/sky light-leak photos, mono-caps
  footers.
