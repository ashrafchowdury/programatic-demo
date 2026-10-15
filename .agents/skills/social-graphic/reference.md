# Evidence: what three accounts' post images measure

Sources: 289 images pulled on 2026-10-16 with `reverse-engineer-reference`.

| Account | Images | Window |
| --- | --- | --- |
| @vercel_dev | 134 | Aug 13 – Oct 15 |
| @cursor_ai | 119 | Apr 8 – Oct 13 |
| @bot (Grok Bot) | 36 | Aug 18 – Oct 9 |

Tags:
- **M** = measured with `probe.py` or pixel scripts.
- **O** = observed.
- **I** = inferred.

Percentages are of canvas width (W) or height (H).

## Shared invariants (the system we kept)

| Finding | Vercel | Cursor | Grok Bot | Kept as |
| --- | --- | --- | --- | --- |
| Fixed furniture | ▲ at 5.4 %W / 9.6 %H, 98×85 px, on 100+ cards (M) | changelog card geometry identical in all 4 (M) | one gradient plate reused pixel-identically (M) | rule 1: gutter + panel + fixed lockup |
| Title size | one size, cap 7.6–8.4 %H, 2–3 lines (M) | title and subtitle same cap, 6.1 %H (M) | split titles cap 8.4–9.0 %H (M) | rule 2: cap 8 %H, one title |
| Hierarchy | none inside the card (O) | by colour: 14:1 vs 3.1:1 contrast at equal size (M) | n/a | one tone; post text carries the rest |
| Ink density | 2.2–4.0 % above luma 128 (M) | 0.7–4.7 % on text cards (M) | n/a | rule 3: 2–9 % text, < 14 % UI |
| Feed readability | panel text 2.5 %H, decorative (M) | chart labels 1.8 %H, unreadable by design (M) | UI text 1.3–1.65 %H is texture; cards 2.9–3.6 %H read (M) | rule 4: ≥ 2.9 %H or `data-texture` |
| Proof | starts at 52–60 %W, bleeds right/bottom, fades to ground (M) | faded corner cards at 1.1:1 fill, 2.6:1 text, one chroma detail (M) | phones bleed exactly one edge, opposite margin 5–6 %H (M) | rule 5: bleed + 28 % fade |
| Partner posts | logo pair, no text, 30/30 model launches (M) | lockup group 16.2 %H, centred (M) | partner tiles 25–28 %H ≈ 58 px in feed (M) | rule 6: tiles 22 %H, no words |
| Accent | none; colour only from content (M) | one orange on the number that matters (M) | black = the user's colour (O) | rule 7: one yellow moment |
| Post type → format | logo pair = model, ▲+logo = integration, headline = feature (O) | scatter = model, lockup = partner, line art = blog (O) | tiles = multi-partner, card stack = single partner, phone = capability (O) | archetype table in SKILL.md |
| Geometry | terminal corner ≈ 1.4 %W (M) | n/a | cards 41–55 px whatever height; tiles 21 % of side; shadow ≤ 13 % darkening, gone by 30–75 px (M) | brand radii at 2×; tiles 22 %; blur ≤ 96 px |

## Numbers per archetype we borrowed from

**Statement**
- Vercel A: text block centred at 46.3–46.5 %H, left edge at 5.4 %W.
- Measure 32–64 %W. Breaks fall at phrase boundaries (M).

**Proof**
- Vercel B1: panel fill luma 8–16, panel text a third of the headline cap (M).
- Cursor C: context cards 0.41× title cap (M).

**Pair**
- Vercel C/D: the two marks mirror about 50 %W; the partner is matched to the
  ▲'s optical height; `+` at 0.36× the mark (M).
- Cursor E: `+` at 8 %H, gaps 4.5 %W (M).

**Exchange**
- Grok C: a dark card holds the partner and the action, and a white card below
  holds the outcome.
- Gap 3.2–4.3 %H; one readable line, cap 2.9–3.6 %H (M).

**Figure**
- Cursor G: "us" in one accent, the rest in a 1.2:1 grey.
- Headline cap 2.3–2.9 %H, top-left at 4 %W (M).

**Quiet**
- Cursor A: centred title on an empty ground, 2–8 words, ink 0.7–4.7 % (M).

## Canvas

- **Link cards:** 1.905:1 on all three accounts (1200×630, 2048×1072/1075) (M).
- **Posted images:** 16:9 dominant (M).
- **Our default:** 2839×1596 (1.78:1).
- **Link-card preset:** `card` (2400×1260, 1.905:1).

## Harness traps found on this corpus

- **`probe.py framing` misreads a dark window on a black ground.** It calls the
  window "FULL-BLEED", because the corner-to-centre gap is only 8 (Vercel E).
  Read the box off `grid` instead.
- **X serves `format=png` URLs as JPEG.** Normalise with `sips -s format png`
  before any ffmpeg concat; mixed codecs break the image2 demuxer.
- **The typeface was UNKNOWN on all three accounts.** Spec type by cap height,
  never by font-size.
