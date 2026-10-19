---
name: social-graphic
description: Make a social post image (X, LinkedIn; 2839×1596 by default) for any brand — pick the format from the post type, fill a template, render, and pass an audit driven by a brand pack (palette, faces, logos, rules). Thirty-four formats, from quiet title cards to light-led launch art, reverse-engineered from 504 post images by eight product companies. Not for a screenshot of an app (shoot-still) or video (demo, reel). For Agenta's own posts, use agenta-social-graphic.
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
kit/templates/       thirty-four formats as HTML fragments
review/catalog.py    every format a brand allows, on every ground it allows, into social/_catalog/
review/build.py      the review gallery: every poster with a Keep / Update / Drop mark and a note
review/ab.py         the internal A/B: score three candidates per post, compare them, promote the winner
review/regress.py    the audit's regression test: posters rebuilt from a real broken series must all fail
brands/example/      a neutral brand pack (system faces) to copy from
render.mts           render + audit + 20 % feed preview
reference.md         the measured evidence; studies/ holds the eight full studies, the user's
                     reference picks (picks-2026-10.md) and their study (keep-picks.md)
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

The format is the first thing a follower reads, so pick the one that fits the
message best: what must a follower see to believe the post? Repeating a format
across a series is fine; never take a weaker fit just to vary it.

**The premium set** is the first choice wherever it fits. These formats are
print and product-photography techniques that read as mature on any brand:

| Post type | Format | The one technique |
| --- | --- | --- |
| Several capabilities at once | **bento** | Product blocks of different sizes, the title inside the largest |
| What a product is made of | **bento-split** | The title on the left, a bento of its parts on the right |
| Partnership, integration, event | **lockup** | The two lockups side by side, split by a thin slash, nothing else |
| Integrations, many tools | **hub** | The brand tile at the centre of hairline rings, tool tiles orbiting |
| A launch told in parts | **modules** | A Swiss grid left visible; the title spans four modules, one idea per module |
| Flow through a product | **sankey** | Flat Sankey bands from sources through the brand to destinations |
| Customer story, case study | **plate** | A flat title column against a solid accent plate and a halftone plate, one card crossing the seam (Granola) |
| Versions, releases, registries | **isometric** | Three versions of one artefact stacked in CSS 3D, the latest on top (Resend's specimen object) |
| Milestone, eval result, event | **field** | Monumental eval rings in heavy ink over photocopy grain (Raycast's field poster; lit) |
| Feature whose value is one word | **annotated** | A proofreader's box on the key word and a pointer to a short note |
| Link card, quiet announcement | **press** | Crop marks, registration targets and a colour bar of the brand's own inks |
| Before/after, a timeline | **grid** | The editorial grid left visible, the title split across it, one accent block |
| A feature named by a verb | **emboss** | The verb blind-embossed into the ground, monumental and cropped |
| Launch with a real screen | **window** | The whole workspace rising from the bottom edge (Perplexity) |
| Integration, partner | **connect** | Two lockup cards on a blueprint grid joined by one connector with end nodes (Mistral) |
| Launch across partners or models | **spotlight** | Three tiles, the brand's raised and larger in the middle (Lovable) |
| Funding, usage, milestone; real numbers only | **milestone** | One monumental numeral in solid ink, a hairline frame of names under it (Clerk) |
| Model availability, composer features | **prompt** | A name above a large prompt box (Bolt) |
| Brand moment, announcement | **monogram** | A large title left, the brand mark monumental on the right, one colour (v0) |
| A new option among existing ones | **tiles** | A centred row of option tiles with line icons, the new one flagged (Bolt) |

**The everyday set** works for any brand:

| Post type | Format |
| --- | --- |
| Feature, GA, capability, one-line claim | **statement** |
| Feature with a real screen | **proof** |
| Integration, partner, model | **pair** |
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

The light-led formats are part of the collection, not the default. Most posts
stay in the everyday set; reach for light when the message is best told with
it.

A launch usually needs two images: the post image and its link card (pair or
quiet).

## Make it

**`render.mts` is the only way to make a post.** It loads the brand's fonts,
renders every size, audits every post and writes the contact sheet. If it
cannot run (missing fonts, no Chromium, a script error), stop and report what
is missing. Never render posters another way: no hand-built HTML pages, no
screenshots from another tool, no contact sheet of your own. A poster that
skipped the audit is not a draft; it is a defect nobody has caught yet.

1. **Choose the brand.** Put the brand pack's path, relative to the repo root,
   in `social/<name>/brand`. Without that file, `--brand <dir>`, or
   `$SOCIAL_BRAND`, the example brand is used.
2. **Write the title.** Sentence case, at most 8 words. If the claim doesn't
   fit, it belongs in the post text.
3. **Build the variants.** Copy the template(s) into `social/<name>/`.
   `{{brand}}` resolves to the brand pack, `{{kit}}` to `kit/`, and
   `{{inline:assets/x.svg}}` to a data URL, which a format that draws an
   image with a script needs. Other relative paths resolve against the post's folder. Make
   three variants unless the brief says one. Replace the template's text
   and icons; never add a chat, card, list or other UI of your own. The
   audit fails a post with classes its template lacks or more than a few
   added elements (composed UI).
4. **Add assets.** Put partner logos in `social/<name>/assets/` as official
   files only, and keep `data-third-party` on them. For proof, capture the real
   screen first.
5. **Render and audit.**

   ```bash
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>
   ```

   Pick the size from where the image is published, and pass it with
   `--preset`:

   | Published as | Preset | Size |
   | --- | --- | --- |
   | X or LinkedIn post (the default) | `x` | 2839×1596 |
   | Link card: Open Graph, X summary card | `card` | 2400×1260 (1.91:1) |
   | Square post: Instagram, a LinkedIn square | `square` | 2160×2160 |
   | Newsletter, blog or changelog header | `banner` | 2400×1060 (2.26:1) |

   `--preset all` renders x, card and square; `banner` is asked for by name.
   One post can go out at several sizes: render each one it needs. Most
   formats are laid out for `x`, so open every other size and check it before
   you deliver it. The output goes to `out/social/<name>/`, with the preset in
   the file name for any size but `x`.

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
   - composed UI: markup the format's template does not have
   - a font or image that failed to load
   - text or a card crowding the logo (2 %H clear space)
   - UI text or a button spilling out of its card, or cut off inside its box

   - a title in Title Case (brand.json `properNouns` keep their capitals)
   - a subject under 42 % of the width and height on a mostly bare canvas
   - a screenshot drawn so small its UI text falls under the texture floor
   - any box (a fill, ring or border) spilling out of its parent box; mark a
     deliberate overlap `data-overhang`
   - in a series, the accent face on more titles than `accentFaceShare`
     allows
   - any glyph the brand face lacks, which the browser silently draws in a
     system font (a curly quote, an arrow typed as text); draw icons as line
     SVGs, never as Unicode characters

   It warns when a post reads empty (over 86 % bare ground; the striking
   references leave 14–49 %) or lopsided (visual weight outside 0.34–0.66 W).
   A run of more than one post also writes `_sheet.png`, a contact sheet of
   every feed preview, and a numbered series prints its formats and grounds
   day by day for review.

   Fix the post, never the audit. After changing render.mts or the kit, run
   `python3 .agents/skills/social-graphic/review/regress.py`; it must pass.
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

### Internal A/B: three candidates, the user sees one

Make every post three ways, test them internally and deliver only the winner.

1. Write three candidates for the post into `social/<name>/_candidates/` as
   `<post>--a.html`, `--b.html` and `--c.html`. Use the three formats that
   best fit the message; when fewer fit, vary the one that does (ground,
   subject, composition). Never pad with a weak fit. All three keep the same
   title.
2. Render them:
   `pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --candidates`.
   Every run also writes `_report.json`, one row of measurements per poster.
3. Score them: `python3 .agents/skills/social-graphic/review/ab.py <name>`.
   - A candidate with an audit error is out. The rest lose points for
     warnings, a crowded or empty canvas, off-centre weight, and a title gap
     away from 6.5 %H, each measured against the format's own template, so
     an airy or asymmetric format is never marked down for its design. The
     baselines live in the brand pack's `baselines.json`; after changing a
     template, run `review/catalog.py`, render `_catalog`, then
     `ab.py --baselines`.
   - Each post gets a side-by-side sheet at feed size,
     `out/social/<name>/_candidates/<post>.ab.png`.
4. Judge every sheet yourself, in this order: the message (the subject shows
   what the title claims, at a glance), then cleanliness (one focal point,
   balance, even spacing, nothing cramped or cut), then the brand's taste
   rules. The score breaks ties. A lower score that tells the message better
   still wins; write down why.
5. Promote and render the winners:
   `python3 .agents/skills/social-graphic/review/ab.py <name> --promote <post>=b …`
   (or `--promote auto` to take the top score). Then render `<name>`.

Only the winners reach the user. `_candidates/` stays as the record.

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
    uses the display face. `--font-app --font-mono --cap-app` set the faces
    inside product UI (the kit's `.app` components); without them it uses
    `--font-ui`.
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
`--templates --brand <dir>`, which renders all thirty-four formats in the new brand.

## Removed

**Mosaic** (a partner's mark rebuilt from rounded pixels) was cut on
2026-10-16: the user did not like the dotted-logo look. Don't rebuild it.

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
