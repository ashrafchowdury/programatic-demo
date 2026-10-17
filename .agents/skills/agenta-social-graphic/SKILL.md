---
name: agenta-social-graphic
description: Make Agenta social post images (X, LinkedIn; 2839×1596) strictly inside Agenta's brand assets, from a single post to a month-long series, without asking the user — post copy in; three candidates per post A/B-tested internally; only the winners, audited, and a review gallery out. 17 on-brand formats, premium first. Use for any Agenta launch, feature, channel, integration, approval, eval-result or link-card post. For another brand, use the general social-graphic skill.
metadata:
  tags: social, image, brand, agenta, launch, x, linkedin
---

# Agenta social graphic

Agenta's brand pack for the general [`social-graphic`](../social-graphic/SKILL.md)
skill. That skill holds the system, the process, the renderer, the templates
and the research. Read it once. This one adds what is specific to Agenta, and
its audit refuses anything outside the brand.

```
brand/brand.css    tokens.json palette (--c-*), roles, GT Alpina + PP Mondwest, Agenta keycaps
brand/brand.json   the strict audit: brand colours only, white or yellow grounds, only the formats below
taste.md           every look the user approved or rejected; read it before every run
brand/logos/       logo-{light,dark,dark-accent}.svg, mark-{light,dark,dark-accent}.svg
brand/fonts/       licensed, gitignored (see Setup)
```

## Setup (once per machine)

GT Alpina and PP Mondwest are licensed and gitignored. Use the files agenta.ai
itself serves, so posts match the site exactly:

```bash
cd .agents/skills/agenta-social-graphic/brand/fonts
for f in GT-Alpina-Light GT-Alpina-Light-Italic GT-Alpina-Regular GT-Alpina-Regular-Italic GT-Alpina-Medium; do
  curl -sfLO "https://agenta.ai/fonts/$f.woff2"
done
```

PP Mondwest comes from the design-system artifact
(`https://claude.ai/code/artifact/58da9a6c-45d0-40ea-b04a-69a1d904b8ef`,
`project/fonts/PPMondwest-Regular.otf`). Inter loads from Google Fonts. The
renderer refuses to run without the GT Alpina and Mondwest files.

The Light cut is a trial file (`GTAlpinaTrial-Light`) both on agenta.ai and in
the artifact; only Regular is the full face. Flag this before a paid
campaign.

## Autopilot: post copy in, reviewed series out

Run this end to end without asking the user anything. They review the result
in the gallery, not the process.

1. **Read the brief.** Put the post copy in `social/<name>/brief.md`, one
   `## <date>` section per post, with where each post is published. Add the
   `brand` file (one line: `.agents/skills/agenta-social-graphic/brand`).
   - **Size follows the destination,** never the format: an X or LinkedIn
     post is `x`, a link card `card`, a square post `square`, a newsletter or
     blog header `banner`. The size guide is in the general skill's "Render
     and audit" step. Pass `--preset` to every render below, and render each
     size a post is published at.
2. **Read the taste ledger.** [taste.md](./taste.md) lists every look the user
   approved or rejected. A rejected look is never used again, in any form.
3. **Plan the series** in `social/<name>/plan.md`, one row per post:
   date, title, and three candidates (a, b, c), each a format and ground,
   with one line on why each could fit the message.
   - **Choose by fit, not by variety.** Read the message and ask what a
     follower must see to believe it, then take the formats whose subject
     shows exactly that:

     | The message is about… | Best fit |
     | --- | --- |
     | a person and an agent talking, or an approval in a channel | context (the kit's `.chat` among faded cards) |
     | a partner, channel or model joining | lockup, pair, spotlight |
     | everything an agent works with, many tools or integrations | hub |
     | how messages flow through an agent to tools | sankey |
     | several product capabilities at once | bento, bento-split, modules |
     | one feature with a hero card | prompt, window |
     | a feature with a real screen | window (real capture) |
     | a real number | milestone |
     | a new option among existing ones | tiles |
     | a short claim with no screen | statement, monogram |
     | a story with results | plate |
     | the workflow around a feature | context |
     | a link card or quiet announcement | quiet |

   - The three candidates are the three best fits. When fewer than three
     formats fit, vary the one that fits instead: its ground, its subject
     (a different card, a different moment of the same flow) or its
     composition. Never pad with a format that does not fit.
   - Repeating a format across days is fine (the user's decision,
     2026-10-16). Never take a weaker fit just to vary the series.
   - The title is the claim in at most 8 words (rules below). If the claim
     needs more, it belongs in the post text. All three candidates carry the
     same title, so the test is about the picture.
   - A title line holds about 30 characters at title size. Break a longer
     claim at the phrase with a `<br>`, at most two lines. The audit fails
     a title that runs past the safe area.
4. **Build the candidates** from the templates, never from scratch. A
   free-form layout of small cards and arrows is not a format; it was the
   commonest way a series went wrong. Then:
   - **Sentence case** titles, a claim not a label ("Your agent posts on its
     own.", not "Agents That Post on Their Own"). The audit fails Title Case.
   - **The bitmap word (PP Mondwest chip) is rare:** only when one word is the
     point, at most one post in four. On every title it means nothing, and
     the series check fails it.
   - **Big subject:** the card, chat or screen takes at least 42 % of the
     width or height. A small card on an empty canvas fails.
   - **Crop screenshots** to the part that proves the claim. A whole app
     shrunk to fit turns to mush, and the audit fails any capture whose UI
     text lands under the texture floor.
   - Icons are line SVGs (1.5 px at 1×), never Unicode characters (✓ ↵ ⇧ →):
     Inter and GT Alpina lack them, and the audit fails any glyph that falls
     back to a system font. GT Alpina Light is a trial cut; brand.css fills
     its missing punctuation from the full Regular.
   - Channel posts use the kit's `.chat` component as it is; don't rebuild
     bubbles by hand. Every box stays inside its parent box; mark a
     deliberate overlap (a badge on a corner) `data-overhang`.

   Write them in `social/<name>/_candidates/`, named
   `<nn>-<date>-<slug>--a.html`, `--b.html` and `--c.html`. Copy each
   template from `.agents/skills/social-graphic/kit/templates/` and replace
   the sample content with the post's own: its title, its channel, its UI.
   - Put the title and its subject (the card, chat, tiles or object) in one
     `.stack`, with the subject marked `data-subject`. They centre as one
     group with a fixed gap, and the audit fails a gap outside 4.5–9 %H.
   - A product post shows the real product screen of whoever the post is for
     (`pnpm still <shot>`), not a composed mock. Where no screen exists,
     compose UI from the brand's components and record it as illustrative in
     plan.md.
5. **Render the candidates.**

   ```bash
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --candidates
   ```

   A candidate with a ✗ is out of the test. Fix it only if it was the best
   idea, and never loosen the audit.
6. **A/B test them, internally.** The user never sees the candidates.

   ```bash
   python3 .agents/skills/social-graphic/review/ab.py <name>
   ```

   This scores every candidate and writes one sheet per post,
   `out/social/<name>/_candidates/<post>.ab.png`, with a, b and c side by
   side at feed size. The score ranks only what can be measured: audit
   errors, warnings, empty or crowded canvases, off-centre weight, and the
   title gap. Open every sheet and pick the winner in this order:
   1. **Message.** The subject shows exactly what the title claims, for the
      person the post is for, and reads in one glance at feed size.
   2. **Clean.** One focal point, balanced, with even spacing. Nothing is
      cramped, cut off or competing.
   3. **Taste.** Nothing in it is on the taste ledger's Rejected list.

   Take the top score when two candidates tie on all three. Take a
   lower-scoring candidate when it tells the message better. Write the winner
   and one line of why in plan.md.
7. **Promote the winners and render the series.**

   ```bash
   python3 .agents/skills/social-graphic/review/ab.py <name> --promote 01-…=b 02-…=a …
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>
   ```

   Fix every ✗. Treat each ! as a design problem: fix it, or say in plan.md
   why the format wants it (quiet formats are meant to be sparse). A numbered
   series prints one line per day (format and ground); repeats are allowed.
8. **Look.** Open `out/social/<name>/_sheet.png`; it must show every post.
   A blank or broken sheet is a failed run, not a pass. Then open any post
   that looks off at full size. Check the general skill's "Look" list and the taste
   ledger. Make at most two passes, then stop.
9. **Publish the winners for review.** Only the final posts go to the user;
   the candidates stay in `_candidates/` as the record. Build the gallery and
   publish it as an Artifact with `capabilities: {"db": {}}`:

   ```bash
   python3 .agents/skills/social-graphic/review/build.py <scratch dir> "<Series title>=out/social/<name>"
   ```

   Pass `<scratch dir>/index.html` as `file_path`, the printed `files.json`
   as `files`, and the scratch dir as `root`. Give the user the link.
10. **Act on notes.** When the user says they're done, read
    `ArtifactData list collection "notes"`. Each document has `status`
    (keep, update or drop) and `note`. Rebuild each update and drop post
    through the same A/B (three new candidates), and add each lasting
    preference to taste.md with its date.
11. **Release notes.** Write `out/social/<name>/RELEASE.md`. For each post,
    give the date, file, format, ground and alt text. Add the checks a
    person must make before publishing: drawn partner marks, illustrative
    UI, capture dates.

To see the whole collection in this brand, run `python3
.agents/skills/social-graphic/review/catalog.py`, then render `_catalog`.

## Make one

The same A/B for a single post: three candidates, render with
`--candidates`, run `ab.py`, pick, promote, render, look (steps 3–8). The user
gets only the winner.

## The on-brand formats

These are the only formats `brand.json` allows. Anything else fails the audit.
Premium formats come first: they're the default pick for their post type.

**Premium (first choice).** The spotlight, milestone, prompt, monogram and
tiles formats come from the user's own reference picks (see
`../social-graphic/studies/keep-picks.md`).

| Post type | Format | What it is | Lit |
| --- | --- | --- | --- |
| Several capabilities in one launch | **bento** | The title in the largest block, product blocks around it (an approval, a trace, one yellow block) | flat |
| What a product is made of | **bento-split** | The title on the left, a bento of parts on the right, one part in yellow | flat |
| Partnership, integration, event | **lockup** | The Agenta lockup and the partner's, side by side, split by a thin slash; no title | flat |
| Integrations, many tools | **hub** | The Agenta tile in yellow at the centre of hairline rings, tool tiles orbiting, the rings bleeding off the bottom | flat |
| A launch told in parts | **modules** | A Swiss grid left visible: the title across four modules, one idea per module, one module in yellow | flat |
| Channels in, work out | **sankey** | Channel tiles flowing through the agent to tool tiles, the busiest band in yellow | flat |
| Customer story, case study, results | **plate** | Print plates: a paper title column, a solid yellow plate and a halftone plate, one card crossing the seam | flat |
| Launch with a real screen | **window** | The whole workspace rising from the bottom edge | flat |
| Launch across partners or models | **spotlight** | The Agenta tile raised between partner tiles on yellow | flat |
| Funding, usage, milestone (real numbers) | **milestone** | A solid GT Alpina numeral, a hairline frame of teams under it | flat |
| Model availability, composer features | **prompt** | A model name above the composer, with the model chip and the yellow Run key | flat |
| Brand moment, announcement | **monogram** | A large title left, the black Agenta mark at 60 %H right | flat |
| A new channel or option | **tiles** | Four option tiles with line icons, the new one with the yellow "New" badge | flat |

**Everyday (second choice)**

| Post type | Format | Agenta notes |
| --- | --- | --- |
| Feature, GA, capability, one-line claim | **statement** | The title centred and set large, a yellow block in the top-right corner, one PP Mondwest word in the grey key-cap chip. |
| Integration, partner, model | **pair** | The Agenta tile and the partner tile, no words. White ground only. |
| Feature whose value is the surrounding workflow | **context** | Faded cards around one centred title; the one full-colour detail is a yellow chip. |
| Link card for a post, guide, changelog | **quiet** | A centred title on an empty ground. |

**Grounds: white (`post paper`) or yellow (`post yellow`) only.** No dark
backgrounds (the user's decision, 2026-10-16); `brand.json` `grounds` enforces
it. Templates written on carbon are re-roled onto paper or yellow (see
`review/catalog.py`). On yellow, the ground is the post's one yellow moment,
so nothing else may be yellow: use the `dark` button, not `primary`. The black
lockup sits straight on the yellow.

**Flat only.** Agenta posts use no gradients, glow or grain. The light-led
formats (daylight, sunrise, haze, aurora) were removed, and prompt,
window, spotlight, plate and milestone were flattened: "those look like low
quality graphics" (the user's decision, 2026-10-16). `brand.json` sets
`allowLight: false`, so the audit refuses any light layer. Depth comes from
real UI, scale, and an honest drop shadow.

**Not for Agenta:** lamplight, live-line and construction need a dark ground.
Mosaic, proof, woven, ledger, graphite, field, annotated, emboss, figure,
field-report, isometric, exchange, press, grid, connect, daylight, sunrise, haze, aurora, studio and depth were dropped in review (see taste.md). Daylight,
sunrise, haze, aurora, studio and depth are deleted from the kit; the rest stay there for other brands.

## Agenta rules the audit cannot check

- **Voice.**
  - Sentence case, at most 8 words, no exclamation points, no emoji.
  - "Agent" is the product's word and fine in titles; "coworker" is for the
    brand line ("AI coworkers that learn how you work"). Never "bot". A
    trigger "runs".
  - A sentence ends with a period; a label does not.
- **Words on the image.** At most one title. No taglines, subcopy, CTAs, URLs,
  dates or prices; the post text carries them (the user's decision,
  2026-10-16).
- **Illustrative UI.** Composed screens may hold plausible names, times and
  small counts, and nothing that reads as a claim: no currency, no
  percentages, no totals. Milestone takes only real numbers. Record every
  composed screen as illustrative in plan.md and RELEASE.md.
- **Type.**
  - Titles are GT Alpina Light 300. Text inside product cards and UI (chat
    bubbles, labels, buttons) is Inter 400, per the README's type roles (the
    user's decision, 2026-10-16). `.read`, `[data-texture]` and `.btn` pick it
    up through `--font-ui`.
  - PP Mondwest sets exactly one word.
  - Cap heights, measured: GT Alpina 0.680 em, Mondwest 0.640 em, Inter
    0.7275 em. The chip scales Mondwest to match GT Alpina.
- **Colour.**
  - Every value comes from `tokens.json`. Carbon is `#1e1d1c` or `#1e1c1d`;
    `#181010` is not a token.
  - Ink is `#242424`, the page ground `#f1eeec` and the panel `#ffffff`.
- **Logos.**
  - File names name the ground: `-light` on paper, `-dark` on carbon,
    `-dark-accent` (the yellow mark) on carbon.
  - On a yellow post the black `-light` lockup sits straight on the yellow, with
    no plate. This overrides the README's never-on-yellow rule for social posts
    only (the user's decision, 2026-10-16).
  - Never recolour or stretch a logo. The `-dark` lockup is the README's
    white-mark variant.
- **Shape.**
  - Only pressable things are rounded. App tiles round at 22 % because they are
    app icons.
  - No blur over 96 px, the website's `th-menu-shadow` at 2×.
- **Partner marks.**
  - Use only official files, kept in the post folder's `assets/`. Where only a
    drawn mark exists (the WhatsApp glyph in earlier series), use it and flag
    it in RELEASE.md for replacement before posting.
  - Treat a WhatsApp, Slack or Telegram logo as the partner's to approve before
    a public post.
  - Flag any mark you drew rather than downloaded.
