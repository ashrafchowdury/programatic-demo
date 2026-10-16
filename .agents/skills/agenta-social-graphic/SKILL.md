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

GT Alpina and PP Mondwest are licensed and gitignored. Fetch them from the
design-system artifact:

```
Artifact read  url=https://claude.ai/code/artifact/58da9a6c-45d0-40ea-b04a-69a1d904b8ef
               paths=project/fonts/GT-Alpina-Standard-{Light,Light-Italic,Regular-Italic,Medium}.otf,
                     project/fonts/GT-Alpina-Standard-Regular.ttf, project/fonts/PPMondwest-Regular.otf
```

Copy the saved files into `.agents/skills/agenta-social-graphic/brand/fonts/`.
The renderer refuses to run without them.

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

**Not for Agenta: lamplight, live-line and construction.** They depend on
light, gradients, grain or abstract line art. Agenta's brand rules out all
four: there are no gradients, no large blurs and no abstract illustration. The
audit refuses them. Use them only through the general skill, for other brands.

## Agenta rules the audit cannot check

- **Voice.**
  - Sentence case, at most 8 words, no exclamation points, no emoji.
  - Agents are "coworkers", and a trigger "runs".
  - A sentence ends with a period; a label does not.
- **Words on the image.** At most one title. No taglines, subcopy, CTAs, URLs,
  dates or prices; the post text carries them (the user's decision,
  2026-10-16).
- **Type.**
  - All set type is GT Alpina, including the text in mock UI cards. Light 300
    goes on titles and Regular 400 on readable UI lines.
  - PP Mondwest sets exactly one word.
  - GT Alpina's cap height is 0.680 em and Mondwest's 0.640 em (measured), so
    the chip scales Mondwest to match.
- **Colour.**
  - Every value comes from `tokens.json`. Carbon is `#1e1d1c` or `#1e1c1d`;
    `#181010` is not a token.
  - Ink is `#242424`, the page ground `#f1eeec` and the panel `#ffffff`.
- **Logos.**
  - File names name the ground: `-light` on paper, `-dark` on carbon,
    `-dark-accent` (the yellow mark) on carbon.
  - Never put a logo on yellow, recolour it or stretch it. The `-dark` lockup is
    the README's white-mark variant.
- **Shape.**
  - Only pressable things are rounded. App tiles round at 22 % because they are
    app icons.
  - No blur over 96 px, the website's `th-menu-shadow` at 2×.
- **Partner marks.**
  - Use only official files.
  - Treat a WhatsApp, Slack or Telegram logo as the partner's to approve before
    a public post.
  - Flag any mark you drew rather than downloaded.
