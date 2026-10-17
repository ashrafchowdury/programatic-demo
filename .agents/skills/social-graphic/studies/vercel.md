# @vercel_dev social graphics: reverse-engineered

134 images (111 link cards, 13 posted, 10 video posters), 2026-08-13 to 10-15. Measured with `probe.py` (hist, grid, type, framing) and `vmeas/m.py` (bands, ramps, RGB). px values are at 2048×1072 unless stated.

## 1. Executive summary

- **There is one template, and it never moves.** 93 of 134 images are 2048×1072 (1.91:1, the 1200×628 OG ratio). On every headline card I measured, the ▲ mark sits at x110 y103, 98×85 px (5.4%W, 9.6%H). The headline's left edge is x107–118 (5.2–5.8%W), flush with the mark. MEASURED.
- **Black and white, and very little bright ink.** The top-left corner is #000000 on 104 of 134 images. Every templated archetype has only 2.2–4.0% of its pixels above luma 128, with mean luma 5–15/255. MEASURED. The headline is the only bright mass on the card.
- **The type is one size and one weight.** Cap height is 82–90 px (7.6–8.4%H). Line pitch is 108–138 px (10.1–12.9%H, about 1.4× cap). x-height/cap is 0.76. Text is sentence case, white, regular weight with tight tracking, on 2–3 lines of 5–10 words. MEASURED / OBSERVED.
- **Model launches never get a headline.** 30 of 30 logo-pair cards are the ▲ and the partner mark only. They sit on one of 2 fixed photographic "light sweep" backdrops, which are pixel-identical from card to card. Only the partner logo changes. MEASURED.
- **The proof bleeds off the edge and fades.** On split cards, the UI, code or diagram starts at 52–60%W and runs off the right and/or bottom edge. A bottom fade pulls it into the black. MEASURED.

## 2. Archetypes (134 images)

| # | Archetype | n | IDs |
|---|---|---|---|
| A | Headline only (▲ top-left + headline) | 34 | 001 010 016 020 022 026 039 040 044 050 053 056 057 060 063 064 066 072 074 079 082 089 094 099 106 108 109 111 112 114 115 131 133 134 |
| B1 | Headline + UI/code/terminal crop | 14 | 003 023 033 037 046 059 081 091 095 102 105 117 121 122 |
| B2 | Headline + motif (line illustration, globe, metric bar, icons) | 11 | 004 043 061 067 069 071 093 098 100 113 123 |
| B3 | Headline + stacked partner lockup panel | 7 | 052 068 090 097 119 120 129 |
| C | Logo pair on light-sweep backdrop | 30 | 005 006 008 012 013 018 021 029 030 031 036 038 045 047 048 049 054 058 065 070 073 083 084 085 086 096 103 104 125 128 |
| D | "▲ + logo" on flat black | 7 | 080 087 110 118 124 126 130 |
| E | Full-canvas terminal/code | 9 | 014 019 024 025 032 042 062 075 127 |
| F | Generated-media showcase (model output) | 10 | 009 011 015 017 027 028 076 077 092 101 |
| G | Chart/benchmark | 5 | 041 055 078 088 132 |
| H | Event/campaign (Luma cards, gradient) | 3 | 034 035 107 |
| I | Raw UI screenshot (video poster) | 2 | 051 116 |
| — | Other (3D illustration, abstract video frame) | 2 | 002 007 |

B as a whole (B1+B2+B3) is 32.

## 3. Composition per archetype

**A — Headline only** (044, 001, 112, 131, 010 measured)
- Ground is #000000; ink is #ffffff. MEASURED.
- Mark 98×85 at (110,103): 4.8%W × 7.9%H, margins 5.4%W / 9.6%H (nearly equal in px). Same percentages at 1200×630 (010). MEASURED.
- The headline is left-aligned at 5.4%W. Its first line starts at 30.7%H (3-line cards) or 36.4%H (2-line cards). In both cases the block's centre (ascender to last baseline) lands at 46.3–46.5%H, so it is vertically centred about 4% above the middle. MEASURED. INFERRED: the block is centred and the mark is fixed independently of it.
- Cap 87 px (8.1%H); x-height 66 px (6.2%H); pitch 123 px (11.5%H) on 044/001/131. Ascenders reach cap height. MEASURED.
- Measure (line length): 32–64%W. Breaks fall at phrase boundaries ("OpenAI Decisions API / is now available / on AI Gateway"), and the rag is not balanced. OBSERVED.
- Line count: about 24 cards use 3 lines and 10 use 2. OBSERVED.
- Density: 3.76% bright ink on average (range 2.38–4.73). MEASURED.

**B — Headline + proof** (003, 071, 068, 046, 122, 004, 023)
- The mark and left margin are identical to A. The text column ends at 33–56%W. MEASURED.
- The headline block's centre sits at 46–53%H. MEASURED.
- The type scale flexes per card: cap 82–90 px (7.6–8.4%H), pitch 108–138 px. MEASURED. INFERRED: the type is fitted to the copy rather than fixed.
- The proof element starts at x1080–1230 (52.7–60%W) and runs to x2047 on 3 of 5 cards, so it bleeds right. MEASURED.
- UI panel (003): fill #0a0a0a–#101010 on #000. MEASURED. The panel's own text is about 25–30 px tall (2.5%H), a third of the headline cap. OBSERVED.
- Bottom fade (003): table-row text reaches luma >220 in rows 1–2. Row 4 is only partly above 220. Row 5 (y 910) exists only above luma 60–100. MEASURED. INFERRED: a gradient mask to black over roughly the bottom 25%.
- B3 lockup (068): a full-height hairline divider at x1206, about 6 px wide with peak luma 27 (#1b1b1b). The two partner logos are stacked at x≈1627, the centre of the right panel (79%W), with a "+" between them. The logos are 81–88 px tall, the same as the headline cap. MEASURED.
- Density: 3.7–4.0%. MEASURED.

**C — Logo pair on sweep** (006, 058, 125, 086, 048)
- The backdrop is a photographic fold of light. It is black in the outer thirds, peaks at luma 173–255 on the streak, and has a cool cast (#43464d: B > R by 10). MEASURED.
- It is pixel-identical across cards: the same 4 RGB samples match exactly on 20 cards (backdrop 1, "thin streak") and on 10 cards (backdrop 2, "soft fold"). MEASURED.
- Backdrop 1: ▲ 188×165 (9.2%W, 15.4%H), centred at 37.6%W, 49.8%H. The partner mark is centred at 62.5%W, mirroring the ▲ about the 50% axis. The partner is optically matched to the ▲'s height: 162 px for square marks, 90 px for wide wordmarks. The light streak passes between the two marks, so it reads as the "×". MEASURED / INFERRED.
- Backdrop 2: ▲ 216×187 (10.5%W, 17.4%H), centred at 48%H. MEASURED.
- These 10 images have rounded corners (r ≈ 22–34 px, 1.7–2.0%W) with a light (#e8e8e8 or #ffffff) outside. MEASURED. INFERRED: an export artefact rather than a design choice.
- Backdrop 2 is used only for Anthropic, OpenAI, Google, DeepSeek and Qwen. Both backdrops appear on the same dates. OBSERVED. INFERRED: a tier for frontier labs.
- There is no text on the card. Density is 3.26%. MEASURED.

**D — "▲ + logo" on black** (080, 124, 126)
- ▲ 191×167 at 33.0–42.3%W, "+" 68 px (0.36× the mark's height) at exactly 50%W, partner at 57–67%W. The group spans 33.0–67.0%W at every size. MEASURED.
- This is the same grid as C without the backdrop. It is used for tool and partner integrations (Cursor, Bun, Exa, Celery). Density is 2.2%. MEASURED / OBSERVED.

**E — Terminal** (024, 062, 075, 042)
- Window (024): x109–1938 (5.3%–94.6%W), top edge y91 (8.5%H). It bleeds and fades off the bottom: fill luma goes from 3 at y900 to 1 at y1071. MEASURED.
- Corner radius ≈ 30 px (1.4%W). Border luma 29–33. Fill luma 8–10. A faint outer halo (luma 1–2) extends about 45 px. MEASURED.
- Trap: `framing` calls this window "FULL-BLEED" (corner-to-centre gap 8 < 18). It is wrong for dark-on-black windows. MEASURED.
- Mono text is 24–30 px (2.2–2.8%H) on a 58 px pitch. MEASURED. At feed scale it reads as texture, not words. INFERRED.
- One-line CLI card (062): `▲ ~/ npx …` centred at 49.5%W and 44–52%H, glyph height 84 px. The ▲ doubles as the shell prompt. MEASURED / OBSERVED.
- Density: 0.6–3.3%. MEASURED.

**F — Generated media**: the canvas follows the model's output (1:1, 2:3, 3:2, 16:9). The ▲ or a pyramid is planted in the scene in ≥5 of 10 (flag, car hood, CRT, pyramid). A rabbit recurs 4 times. OBSERVED. There is no type overlay. OBSERVED.

**G — Chart** (078): ground #000. Title is top-left, cap 82 px at 1229 H (6.7%H), x98 (4.8%W). Labels are uppercase mono, cap 23 px (1.9%H), #878787. There is one accent, #05aa3b, for the winning series only. A product sub-brand sits bottom-left, and a small ▲ (60×53, 2.9%W) bottom-right with margins of 90 px. Corners are rounded at r≈22. MEASURED.

**H — Event**: 034 and 035 are third-party Luma templates (#f3f3f3 or #000, with a pill RSVP button). 107 is the only saturated ground in the set: a teal-green gradient from #018a60 to #66d3a9 to #3dafd3, with one centred bold line. MEASURED.

## 4. The system

**Invariants** (MEASURED unless marked)
- Pure black ground (#000) and white ink. There is no second brand colour; colour enters only through content (partner logos, chart accent, model images).
- A fixed ▲ at (5.4%W, 9.6%H), 4.8%W wide, on every card that carries text. It moves to the centre-left at 2× size only when it is half of a logo pair.
- One left text edge at 5.4%W.
- One headline size class (cap ≈ 8%H). There is no hierarchy inside the card: no kicker, no subhead, no CTA, no URL.
- The card adds nothing to the copy: the headline restates the post text, usually as a fuller sentence ("now available on AI Gateway"). OBSERVED.
- Bright ink at 2–4% of the canvas; everything else is black or near-black (luma ≤ 16).
- Proof elements are dim (fill luma 8–16, hairlines luma 27–33) and are cropped by the canvas edge, never framed whole.

**What varies**: the right half (empty, UI, motif, lockup), the type size within ±5%, line count (2–3), and backdrop 1 vs 2.

**Post-type → archetype** (OBSERVED from manifest + sheets)
- **Model live on AI Gateway**:
  - Logo available → C (30).
  - Stealth or no logo → A (001, 016, 020, 022, 039).
  - Image or video model → F (10).
  - Price promos ("50% off", "free") stay in C or A. The discount appears only in the post text, never on the card.
- **Platform feature or GA** → A when the claim stands alone (34); B1 or B2 when a screen or diagram can prove it.
- **Partner or integration** → B3 for "X in AI SDK harness" or Marketplace (7); D for "Vercel + X" (7).
- **Performance metric** → A with the number in the sentence ("64% faster", 064). The one exception is B2 071, which gives the before/after bar 215.8 → 19.1 ms. There are no hero numerals.
- **Benchmark** → G (5).
- **CLI feature** → E or B1 terminal.
- **Event** → H (3), built on outside templates.
- **Launch video** → the poster is a UI screenshot or terminal (I, E).

## 5. Transferable principles (why they survive ~20% feed scale)

1. **One sentence, one size, 8% cap.** At 20% scale an 87 px cap becomes about 17 px, the same size as the post text, so the card reads as a headline in one fixation. A single size means no tier ever falls below legibility. Panel text (2.5%H, about 5 px in the feed) is deliberately decorative.
2. **Lock the furniture and change only the message.** The mark, margins and text edge are identical on 100+ cards, so recognition comes from position rather than colour or logo size. In a feed, the repetition is the brand.
3. **2–4% bright ink on true black.** The headline is the only high-contrast mass, so the eye lands on it first. The proof element sits at luma 8–30 and cannot compete.
4. **Crop the proof and let it bleed and fade.** A UI cut off at the right and bottom edges reads as "real product, there's more". A complete, framed screenshot shrinks to an unreadable thumbnail.
5. **Make announcement types recognisable by their shape.** Logo-pair means a new model, logo + "+" means an integration, a headline means a feature. Followers know what kind of post it is before they read it, which keeps high-volume posting (~1.6 per day) from becoming noise.

## 6. Brand-specific: do not copy

- The ▲ itself, and any use of a triangle or pyramid as a planted motif in generated images.
- The two light-sweep backdrops. Agenta needs its own signature ground.
- Pure #000 + #fff as the whole palette. That is Vercel's identity, not a principle. Agenta should keep the restraint but use its own ground and ink tokens.
- Geist-like type (x/cap 0.76, tight tracking) and the `▲ ~/` prompt.
- The rabbit mascot and the engraved / San Francisco landmark illustration styles.
- The exact grid numbers (5.4%W / 9.6%H, 37.6%/62.5% logo axes). Derive Agenta's own grid; borrow only the idea of fixing one.
- Partner-tier distinctions (backdrop 2 for frontier labs) and Luma event templates.

UNKNOWN: the exact typeface, the font size (only cap height is measurable), whether the light sweep is a photo or a 3D render, and whether the rounded corners are intended.
