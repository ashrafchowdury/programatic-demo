---
name: social-graphic
description: Make an on-brand Agenta social post image (X, LinkedIn; 2839×1596 by default) from a brief — pick the archetype from the post type, fill a template, render, and pass the brand audit. Use for feature, integration, channel, approval, eval-result and link-card posts. Not for a screenshot of the app (shoot-still) or any video (demo, reel).
metadata:
  tags: social, image, brand, launch, x, linkedin
---

# Social graphic

A designed image for a post: a title, a pair of logos, a floating card, a
chart. **Not a still**: a still photographs the running app
(`.agents/skills/shoot-still/SKILL.md`). A proof graphic may *embed* a still,
but it is authored here. Output is a PNG; there is no video.

The system below was reverse-engineered from 289 post images by @vercel_dev,
@cursor_ai and @bot (Oct 2026). The numbers and the evidence are in
[reference.md](./reference.md). We took their principles, not their looks.

## Setup (once per machine)

GT Alpina and PP Mondwest are licensed and gitignored. Fetch them from the
design-system artifact into `kit/fonts/`:

```
Artifact read  url=https://claude.ai/code/artifact/58da9a6c-45d0-40ea-b04a-69a1d904b8ef
               paths=project/fonts/GT-Alpina-Standard-{Light,Light-Italic,Regular-Italic,Medium}.otf,
                     project/fonts/GT-Alpina-Standard-Regular.ttf, project/fonts/PPMondwest-Regular.otf
```

Copy the saved files into `.agents/skills/social-graphic/kit/fonts/`. The
renderer refuses to run without them.

## The system

Seven rules. Each one is a measured invariant that the three accounts share,
re-derived from Agenta's own tokens.

1. **Fixed furniture, changing message.** Every post sits on the same frame:
   a 24 px `paper-120` gutter around a `paper-0` panel bound by a 2 px
   `paper-line` hairline (the website's panel grid), or the carbon band. The
   Agenta lockup is fixed at the top-left of the safe area, 3.8 %H tall. In a
   feed the repetition is what makes the post recognisable as ours.
2. **One title, one size.** At most one title of at most 8 words, GT Alpina
   Light, cap height 8 %H (font-size 188 px at 1596). No kicker, subhead,
   tagline, CTA, URL, date or price. The post text carries the rest.
3. **Quiet canvas.** 2–9 % of pixels differ from the ground on text posts,
   under 14 % on UI posts. The title, or one card, is the only strong mass.
4. **Readable or texture, never in between.** Text that must be read has a cap
   of at least 2.9 %H (about 9 px in the feed). Smaller UI text is texture:
   mark it `data-texture`, keep it at 1.6–2.4 %H, and expect nobody to read it.
5. **Proof bleeds.** A screen that proves the claim starts at about 50 %W and
   runs off the right and bottom edges, fading over its last 28 %. A cropped
   screen reads as "real product, there's more"; a whole one shrinks to mush.
6. **Logos carry partner posts.** Agenta and the partner as app tiles 22 %H
   tall, centred, with a `+`, and no words at all. The partner's logo is its
   official file, unrecoloured, on a white tile.
7. **One yellow moment.** `yellow-400` appears once: the cover block, the
   primary button, the bitmap word on carbon, or the yellow mark. Never behind
   the Agenta logo. Charts use `terracotta-500` for "us" and `paper-200` for the
   rest.

## Pick the archetype from the post type

The format is the first thing a follower reads, so the mapping is fixed.

| Post type | Archetype | Template |
| --- | --- | --- |
| Feature, GA, new capability, one-line claim | **statement** | `statement.html` |
| Feature with a screen that proves it | **proof** | `proof.html` |
| Integration, channel, partner, new model | **pair** | `pair.html` |
| Approvals, human-in-the-loop, the agent acting in a channel | **exchange** | `exchange.html` |
| Eval result, benchmark, before/after metric | **figure** | `figure.html` |
| Link card for a post, guide or changelog | **quiet** | `quiet.html` |

A launch usually needs two images: the post image (statement, proof, exchange,
or figure) and its link card (pair or quiet).

## Make it

1. **Brief.** From the request, get the post type, the one claim, the partner
   (if any), and whether a real screen exists. If the claim does not fit in 8
   words, it belongs in the post text, not the image.
2. **Title.** Sentence case, at most 8 words, in Agenta's voice: agents are
   "coworkers", a trigger "runs", there are no exclamation points or emoji. A
   sentence ends with a period ("Every run, traced end to end."); a label does
   not ("Agents on WhatsApp"). At most one word goes in PP Mondwest, wrapped in
   `<span class="hchip">`.
3. **Variants.** Always make three in `social/<name>/`:
   - `01-<archetype>.html`, the primary archetype on paper.
   - `02-<archetype>-carbon.html`, the same post on carbon (`class="post carbon"`,
     the `-dark` logos, white type).
   - `03-<archetype>.html`, the second-best archetype for this post type.

   Copy each one from `kit/templates/`. Write `{{kit}}` for kit files. Other
   relative paths resolve against `social/<name>/`.
4. **Assets.** Put partner logos in `social/<name>/assets/`, using only
   official files from the partner's brand page, and keep `data-third-party`
   on their tile. For a proof, capture the real screen first (`pnpm still
   <shot>`) and use the PNG in place of the template's mock. Real UI beats a
   mock every time.
5. **Render and audit.**

   ```bash
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>
   ```

   `--preset card` gives 2400×1260 (1.91:1 link card), `--preset square` gives
   2160×2160, and `--preset all` gives every preset. The output goes to
   `out/social/<name>/`: the PNG, a `.feed.png` at 20 % and the built `.html`.

   The audit fails the run on:
   - any colour not in `tokens.json`
   - any font other than GT Alpina or PP Mondwest
   - text below the readable or texture floor
   - text or a logo outside the safe area (180 px × 150 px at 2839×1596)
   - more than one title, a title over 8 words, or more than one bitmap word
   - a missing Agenta logo, or one on yellow
   - more than one yellow moment
   - a shadow blur over 96 px
   - a font that did not load

   Fix the post; never loosen the audit.
6. **Look.** Open the PNG, then the `.feed.png`. At feed size, check that:
   - the title reads in one glance
   - the partner logo is identifiable
   - nothing that was meant to be read has turned to mush
   - the eye lands on exactly one thing first

   If it fails, cut an element before you shrink anything.
7. **Deliver.** Send the PNGs, and list for each one its archetype, its ground
   and its title. Flag any third-party logo you drew rather than took from an
   official file.

## Facts that are easy to get wrong

- **Tokens.** The tokens come from `tokens.json`, and `kit/brand.css` is the
  only source. Carbon is `#1e1d1c` or `#1e1c1d`; `#181010` appears in no token.
  Ink is `#242424`. The page ground is `#f1eeec` and the panel is `#ffffff`.
- **Type.** GT Alpina's cap is 0.680 em and PP Mondwest's is 0.640 em
  (measured). Set the bitmap word at 1.0625 em so the two caps match. Specify
  sizes by cap height, as `brand.css` does.
- **Fonts.** Every piece of set type in a social graphic, including the text
  inside mock UI cards, is GT Alpina (the user's decision, 2026-10-16). Inter
  and Geist belong to the website and the app, not to these graphics.
- **Logos.**
  - Logo files name the ground: `-light` goes on paper, `-dark` on carbon, and
    `-dark-accent` (the yellow mark) on carbon.
  - Never place a logo on yellow, recolour it, or stretch it. The `-dark` lockup
    is the accent file with its mark set to white, which is the README's
    defined `-dark` variant.
  - A pair-tile is carbon with the yellow mark. That tile is the post's yellow
    moment.
- **Shape and shadow.**
  - Only things you can press are rounded. Cards use `--r-xl` (32 px) and the
    frame uses `--r-lg` (24 px). App tiles round at 22 % of their side, because
    they are app icons.
  - Shadows come from the token set at 2× and never blur more than 96 px.
- **Partner marks need permission.** Treat a WhatsApp, Slack or Shopify logo
  as theirs to approve before a public post.

## Do not copy

- **Vercel:** the ▲ and the pyramid motif, the light-sweep backdrops, the
  pure-black and white palette, and its exact grid numbers.
- **Cursor:** the off-white and orange pairing, the landscape-painting
  backdrop, the cube mark, the CursorBench scatter form, and the generative
  line art.
- **Grok Bot:**
  - the blob mascots and the eye panels
  - the blue swoosh plate
  - the tile-orbit slot template
  - black user bubbles

We borrowed the ideas behind them: fixed furniture, one size, hierarchy by
colour, cropped proof, logos at tile size, and the post type deciding the
format.
