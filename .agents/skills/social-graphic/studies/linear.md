# @linear — post graphics, reverse-engineered

30 images / 27 posts. Every number comes from `probe.py` (hist, grid, type) or `work-linear/img.py` (pixel sampling). Coordinates are % of each image's own canvas. Scratch files are in `work-linear/`.

## 1. Archetypes (30)

| # | Archetype | n | ids |
|---|---|---|---|
| A | Dark product-UI crop on a flat near-black ground | 10 | 001 012 015 019 020 021 024 025 026 028 |
| A2 | UI window on a grey, top-lit gradient with grain | 2 | 014 022 |
| B | Mono schematic: uppercase mono cards, bezier connectors, code | 5 | 002 004 005 006 011 |
| C | Generative line or particle art, no words | 4 | 017 018 023 029 |
| D | Printed posters photographed in one wall scene | 4 | 007–010 |
| E | CRT "report" card for customer stories | 2 | 027 030 |
| F | Partner-supplied art (3D mascot, sky photo) | 2 | 003 013 |
| G | Line chart on white | 1 | 016 |

## 2. What makes the striking ones work

### C. Line art (017 018 023 029)
- **Luma ladder:** each image uses 3 or 4 stroke brightness steps on a ground of luma 9. MEASURED values:
  - 017: solid ellipses 142–164, dashed ellipses 53–66, construction rectangle and diagonals 35–42.
  - 018: check #f7f8f8 (≈245), badge outline 102, construction lines 21–29.
  - 023: one square 217 (#d9d9d9), endpoint dots 103 (#62666c), curves 44–49.
  - 029: three highlighted squares 248, square outlines 58, centre dots 144.
- **Ink:** pixels above luma 128 cover 0.10–0.48% of the canvas. MEASURED. The bright part is a single object or a group of three.
- **Stroke width:** 2–5 px on a 2048 canvas. 017 solid strokes are 3–5 px, 023 curves 2–3 px. MEASURED.
- **Focal point:** dead centre. 017 sits at 50/50, 023 at 49.8/50.6, 018 at 50/50. MEASURED.
- **Hero extent:** 017 spans x 21.8–78.1% and y 11.9–88.2%. 023 spans x 6.6–93.4%. The 018 badge is only 32% W. MEASURED.
- **Construction lines stay in.** 017 keeps a 175–1870 px rectangle, a square split and a diagonal at about 6% contrast. 018 keeps an 8-way guide grid. OBSERVED. This is what makes the pieces look drafted rather than illustrated (INFERRED).
- **Rhythm:** 023 has 17 input lines on a 41.3 px pitch (5.0% H) with ~12 px dots, and a dotted rule at a 21 px pitch. 029 squares measure 33–34 px (1.9% W). MEASURED.
- **Absent:** words, colour, gradients, glow and grain. The ground is flat with σ = 0.0 (029). MEASURED.

### A. Focus ladder in UI crops (015 021 022 024)
Each image keeps one element sharp and pushes the rest back with blur, opacity and a fade.
- **015, three settings rows** (MEASURED unless marked):

  | Row | Text peak luma | Edge gradient p99.9 |
  |---|---|---|
  | Focus | 255 | 183 |
  | Next | 106 | 25 |
  | Furthest | 40 | 4 |

  If the blur is Gaussian, that gradient fall means σ ≈ 4 px on the next row and ≈ 12 px on the furthest row, on a 2048 canvas (INFERRED). The panel fill also ramps from luma 27 at the bottom to 9 at the top, so the far edge melts into the ground.
- **021, the same idea without blur.** The focus row peaks at 238. Neighbouring rows run 107–218. Rows four or more away drop to 55, and the bottom 20% fades out. Status colour (green, yellow) appears only on rows near the focus. MEASURED.
- **Text size is small.** Cap height is 1.6–2.6% H everywhere (004 2.1%, 006 1.6%, 024 2.6%, 027 2.0%). MEASURED. 26 of 30 images carry no display type; the headline lives in the post text. OBSERVED.
- **A2 ground (014, 022).**
  - 014 is a vertical linear gradient from #797d86 to #242328 with grain σ 2.3 luma. The window is inset 12.3% W and 10.9% H. MEASURED.
  - 022 has a top highlight centred at x 49% that falls to #08090b by 88% H. The window bleeds off the right and bottom edges. MEASURED.

### E. Customer-story card (027 030)
- **One template.** The two images match pixel for pixel outside the logo and the table text. MEASURED.
- **Card:** x 4.5–95.5%, top 5.7%. The upper half is cool grey #c2c9d3 with the partner wordmark at about 17% H. The lower half is a dark table (#0f100b) with 4 rows on a ~148 px pitch, a label column split at 28.5% W, and uppercase mono at cap 2.0% H on a 57 px line pitch (1.78× cap). MEASURED.
- **Signature texture:**
  - Horizontal scanlines on a 6.8 px period at 23% modulation (215 → 165). MEASURED.
  - An outer glow falling from luma 57 to 14 over 90 px (4.4% W). MEASURED.
  - Noise σ 19 on the light area, which includes the scanlines. MEASURED.

### D. Poster wall (007–010)
- **One reused scene.** The #e0e0e0 wall, frame and shadow pixels are identical across all four images; only the poster changes. The frame sits at x 30.1–71.1% and y 10.8–88.0%. Poster linen σ is 6.9 against wall σ 2.65. MEASURED.
- **The posters are other companies' art.** OBSERVED.

## 3. The system

**Invariants**
- **Ground:** #08090b in 16 of 21 dark images, #0f1012 in 4. MEASURED.
- **Ink:** pixels above luma 128 cover ≤ 1.7% in all 21 dark images. MEASURED.
- **Colour:** saturated colour only at icon scale (16–24 px): yellow #edc007, green #2a953a, indigo #6170cf. The chart purple is #7070f8. MEASURED.
- **No logo lockup** on Linear's own images. OBSERVED.

**What varies**
- **Aspect ratio:** 1.0 to 2.5, so there is no fixed canvas. MEASURED.
- **Ground:** flat for A, B and C; gradient with grain for A2; photographic for D and F.

**Post type → archetype** (OBSERVED from the manifest)

| Post type | Archetype |
|---|---|
| Single feature ship | A |
| MCP, agents or integration architecture | B |
| Essay, umbrella launch or abstract capability | C (017 essay, 023 Diffs, 029 Code Intelligence, 018 signed commits) |
| Customer story | E |
| Data | G |
| Partner model | F or A (019) |
| Community | D |

## 4. Three directions for Agenta (canvas 2839×1596)

### 4.1 "Construction drawing"
**When:** concept or launch posts with no UI to show, for example evaluations, tracing, or "prompts → judge → scores".

**Layout**
- Ground is carbon #1e1d1c, flat, with no grain.
- The hero drawing is centred, about 55–70% W × 70–78% H.
- Draw one construction rectangle inset 8.5% W / 19% H.
- Draw 2–3 guide lines (a diagonal and the centre axes) that run past the hero to the rectangle edges.

**Ladder** (alpha of #f1eeec)

| Element | Alpha | Stroke |
|---|---|---|
| Hero | 0.62 | 5 px |
| Secondary, dashed 14/10 | 0.24 | 3 px |
| Construction | 0.10 | 2 px |

**Type:** optional. One GT Alpina Light 300 caption, bottom left at 6% inset, cap 2.2% H (≈35 px), #f1eeec at 0.62.

**Colour:** a single yellow #f2f25c node, about 2% W (57 px). This is the image's one accent moment and should be the only thing above 0.9 luminance. MEASURED analogue: 023's square.

**Stunning because:** about 0.3% of the canvas is bright, so the eye lands on the yellow node immediately.

**Risk:**
- With orbits or a funnel-to-a-square, it reads as Linear.
- With no real data structure behind it, it reads as generic "tech line art".
- Fix: derive the geometry from the product. For an eval post, draw N real test cases → one evaluator → a score distribution in terracotta #d97757, and skip the yellow there.

**Build:** inline SVG in HTML. No canvas needed.

### 4.2 "Depth-of-field focus"
**When:** a single-feature post about a setting, field, row or toggle.

**Layout**
- Render the real Agenta UI at 2× and crop so the panel spans x 10–90% W.
- Put the focus element at y 55–65% H.
- The panel may bleed off one edge, as 022 does.

**Ladder** (scaled to 2839 px)

| Row | Opacity | Blur |
|---|---|---|
| Focus | 1.0 | 0 |
| ±1 | 0.42 | 5.5 px |
| ±2 or more | 0.16 | 16 px |

Mask the far edge of the panel with a linear gradient from 100% to 0% over 22% of the panel height. The luma ratio between the focus row and the far rows must be at least 6:1 (Linear: 255:40).

**Type:** UI type stays native, cap 2.0–2.6% H (32–41 px). No headline on canvas.

**Colour:**
- Ground is ink #242424, or carbon. An optional A2-style top-lit gradient runs from #3a3836 at the top to #1e1d1c at 70% H, with grain σ ≈ 2.3/255. Justify the gradient only when the panel is inset.
- Yellow appears only on the focus control's active state.

**Stunning because:** blur plus opacity plus fade gives depth with no 3D.

**Risk:** a timid ladder (for example 0.7 opacity and 2 px blur) just looks like a dim screenshot.

### 4.3 "Field report"
**When:** customer stories and partner switches.

**Layout**
- Card inset 4.5% W / 6% H.
- Left paper block #f1eeec, x 4.5–46%, holds the partner logo in its own colours, 14–18% H tall, centred.
- Right ink block #242424, x 46–95.5%, holds 4 rows (Report / Switched / From / Outcome). Each row is 22% of the card height, with 1 px rules at #f1eeec 0.18.
- The label column is 28% of the block width.

**Type**
- Labels: GT Alpina Light, uppercase, tracking +0.08em, cap 1.9% H (30 px), #f1eeec at 0.55.
- Values: GT Alpina Light at cap 2.3% H, with a line pitch of 1.75× cap.
- Exactly one word in PP Mondwest, for example the outcome metric "3×", in yellow #f2f25c.

**Texture:** paper grain σ 2–3/255 on the paper block only. No scanlines and no glow (both are Linear's signature).

**Stunning because:** the hard split of paper against ink, with the partner's colour landing on calm paper.

**Risk:** a table on a card reads as a slide. Keep text to four rows and at most 12 words per value.

## 5. Do not copy
- The #08090b ground with icon accents in indigo #6170cf or purple #7070f8.
- Uppercase mono node cards with bezier connectors and dotted endpoints (B).
- Agent names and badges such as LUNA/SOL and the dot-matrix agent glyphs.
- The motifs from 017 (orbit ellipses with a construction rectangle), 023 (lines converging on a white square), 029 (square-particle field) and 018 (octagram check badge).
- The CRT report card: 6.8 px scanlines, 90 px glow, and the #c2c9d3 / #0f100b split.
- The poster-wall scene with its #e0e0e0 wall and black frame, and the third-party posters in it.
- Partner art: the Muse plush in 003 and the Fable sky in 013.

UNKNOWN: fonts beyond their category, the exact blur kernel, whether D is a photo or a render, and the source canvas sizes before X recompressed the images.
