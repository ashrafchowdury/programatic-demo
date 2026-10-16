---
name: agenta-social-graphic
description: Make an Agenta social post image (X, LinkedIn; 2839×1596) strictly inside Agenta's brand assets — Agenta's tokens, GT Alpina and PP Mondwest, the Agenta logos, and only the on-brand formats. Use for any Agenta launch, feature, channel, integration, approval, eval-result or link-card post. For another brand, or for the light-led formats, use the general social-graphic skill.
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
brand/brand.json   the strict audit: no light, no grain, only the formats below
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

## Make one

1. Pick the format from the table below, and copy its template from
   `.agents/skills/social-graphic/kit/templates/` into `social/<name>/`.
2. Add a file `social/<name>/brand` containing this one line:

   ```
   .agents/skills/agenta-social-graphic/brand
   ```

3. Write the title and fill the template, following the rules below.
4. Render and audit:

   ```bash
   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>
   ```

5. Look at the PNG and the `.feed.png`, then deliver. The general skill's
   "Look" step has the checklist.

## The on-brand formats

These are the only formats `brand.json` allows. Anything else fails the audit.

| Post type | Format | Agenta notes |
| --- | --- | --- |
| Feature, GA, capability, one-line claim | **statement** | Paper panel with the cover's yellow block top-right. One PP Mondwest word in the grey key-cap chip. |
| Feature with a real screen | **proof** | Capture the screen with `pnpm still <shot>`; real UI beats a mock. |
| Integration, partner, model | **pair** | The Agenta tile is carbon with the yellow mark, which is the post's yellow moment. The partner tile is white, with the partner's official file. |
| Channel (WhatsApp, Slack, Telegram…) | **mosaic** | The partner's mark rebuilt from rounded pixels on carbon, with "Agents on" and the channel name in PP Mondwest yellow. This is the channel series' signature. |
| Approvals, human-in-the-loop, agent in a channel | **exchange** | The primary keycap button is the yellow moment. |
| Feature whose value is the surrounding workflow | **context** | Faded paper-120 cards around one centred title. The one full-colour detail is a yellow chip. |
| Eval result, benchmark, metric | **figure** | "Us" in terracotta-500, the rest paper-200. Terracotta is for charts only. |
| Link card for a post, guide, changelog | **quiet** | Carbon band, centred title, the bitmap word yellow on carbon. |
| Metrics, ranges, results | **ledger** | Flat paper, ink hairlines, GT Alpina Light numerals; the yellow block sits behind one numeral. Real numbers only. |
| Integration, channel, customer story | **field-report** | paper-120 against carbon; the partner's official marks on paper; facts on carbon in Regular 400; the one Mondwest word in yellow. |
| Evals, rollouts, milestones | **woven** | Cells in ink, paper-200 and terracotta, one yellow cell; every cell is one real thing. |
| A feature that deserves weight | **graphite** | Carbon, a dim carbon-800 field of the product's own forms, one large title with the yellow bitmap word. |
| Channel, integration, launch: the scroll-stopper (optional, light-led) | **daylight** | Paper sky warming into tone-on-tone yellow dunes, white rim light on the crests, grain; the product window floats centred over it. |
| Partner pair, milestone, a single moment (optional, light-led) | **sunrise** | Yellow ground, a white sun rising from the bottom edge with rays and rings; the pair tiles or one card sit in its glow. |

**Grounds: white (`post paper`) or yellow (`post yellow`) only.** No dark
backgrounds (the user's decision, 2026-10-16); `brand.json` `grounds` enforces
it. On yellow, the ground is the post's one yellow moment, so nothing else may
be yellow (use the `dark` button, not `primary`). The black lockup sits
straight on the yellow.
The carbon notes in the table above (mosaic, quiet, field-report, graphite,
the pair tile) predate this rule; on those formats use paper or yellow
instead. Alternate grounds across a series.

**No format two days in a row** when posting a series: the format tells the
follower what kind of post it is, and repeating it makes a week read as one
post.

**Light is optional, not the default.** Daylight and sunrise are the only
formats that use gradients, glow and grain; every other format stays flat. Use
them for the posts in a series that should stop the scroll, never two in a
row. Their light uses Agenta tokens only (yellow, paper, white, any alpha),
never a new hue (the user's decision, 2026-10-16), and the audit checks every
gradient stop and SVG paint.

**Not for Agenta: lamplight, live-line and construction.** They need a dark
ground or abstract line art, and Agenta posts are white or yellow only.

## Agenta rules the audit cannot check

- **Voice.**
  - Sentence case, at most 8 words, no exclamation points, no emoji.
  - Agents are "coworkers", and a trigger "runs".
  - A sentence ends with a period; a label does not.
- **Words on the image.** At most one title. No taglines, subcopy, CTAs, URLs,
  dates or prices; the post text carries them (the user's decision,
  2026-10-16).
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
  - Use only official files.
  - Treat a WhatsApp, Slack or Telegram logo as the partner's to approve before
    a public post.
  - Flag any mark you drew rather than downloaded.
