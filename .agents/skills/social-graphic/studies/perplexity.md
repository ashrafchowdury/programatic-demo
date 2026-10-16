# @perplexity_ai: how the post graphics are built

59 images; manifest text is empty, so post types are INFERRED. Tools: probe.py `hist`/`grid`/`type` plus `work-perplexity/px.py` (box means, 5×5 high-pass grain σ, ink %, luma profiles). % = of canvas.

## 1. Archetypes (OBSERVED)

| # | Archetype | n | ids |
|---|---|---|---|
| A1 | Paper research chart | 30 | 002 003 005 006 008 009 010 013 016 019 021 022 023 025 028 029 030 031 032 033 037 039 040 042 043 046 051 052 054 055 |
| A2 | Paper systems diagram | 10 | 001 015 018 024 026 035 038 049 050 053 |
| A3 | Editorial stat sheet (serif numerals, no chart) | 1 | 047 |
| A4 | Hatched isometric line figure ("FIG.") | 1 | 017 |
| B | Partner lockup on a light-leak plate | 2 | 004 014 |
| C | Product UI floated on a photo or render | 8 | 007 012 020 027 034 036 041 058 |
| D | Dark diagram or table | 3 | 045 056 057 |
| E | Cinematic scene with no UI | 2 | 011 048 |
| F | Plain UI on paper | 1 | 044 |
| G | Code screenshot | 1 | 059 |

Aspect (MEASURED): 18 are 4:5 (all charts/diagrams), 16 about 16:9 (every B, D, E), 6 are 5:4, 3 square.

## 2. What makes the striking ones work

### B: light-leak lockup (004, 014)
- **Tonality (MEASURED):** 004 has a mean luma of 32.8, and 56.1 % of its pixels sit below 16. 014 has 90.1 % of pixels below 128. The blacks are crushed: the corner of 004 reads #010902.
- **Lockup (MEASURED):** centred at 50.0 %W and 50.0 %H on both images. It is 59.1 %W × 7.6 %H on 004 and 47.2 %W × 6.8 %H on 014. A 1 px vertical divider separates the marks, and they keep their own colours (white).
- **Light (MEASURED):** 004 has one defocused hotspot, a plateau at luma 178 about 165 × 130 px across (FWHM, about 8 %W). Its edge falls from 90 % to 10 % over about 50 px (2.4 %W). The rest of the plate is one diagonal streak at roughly −24° (OBSERVED, running from bottom-left to top-right) and two soft colour masses. Sampled colours: amber #9d531a, olive #242c12, blue #335d8c / #152a37, warm grey #b7b7b2.
- **Grain (MEASURED):** σ is 0.72 in the blacks, 4.1–8.4 in the midtones on 004 and 3.3 on 014. Grain scales with luminance, which is the signature of film or an overlay blend.
- **Absent (OBSERVED):** headline, CTA, UI, brand-colour ground. Near-white ink is 0.7 % of pixels.

### C: UI floated on a photo (027, 036, 058)
- **027 card (MEASURED):** x 96–1951, which is 4.7–95.3 %W (90.6 % wide). y 428–938, which is 31.4–68.7 %H. The vertical centre lands at 50.0 %. The header row is #f5f9f8 and the body is #ffffff. The corner radius is about 2.0 %W (OBSERVED). No drop shadow is visible (OBSERVED).
- **027 ground (MEASURED):** a film photo with grain σ 3.8 in the mids and 1.9 in the shadows. Samples: #947a63, #755127, #564922, #131d14. Desaturated warm earth tones.
- **036 (MEASURED):** a white serif headline with a cap height of 61 px (5.3 %H) on a 93 px pitch (1.52 × cap). Its line is 54.1 %W wide and centred at 49.95 %. The app window starts at about 26.4 %H, spans about 6.9–94.9 %W and bleeds off the bottom edge. The ground is a dark gradient from #040d1e to #444a66, with grain σ 2.2 at #040d1e and 4.4 at #444a66.
- **058 (MEASURED/OBSERVED):** the prompt text has a 32 px cap (3.0 %H). The panel is centred at about 48 %W (OBSERVED). App thumbnails are cropped by the panel's right edge (OBSERVED). The sky is flat (σ 0.78). The 3D dune stipple has σ 18.5.
- **Technique (INFERRED):** flat UI (σ ≈ 0) on a grainy organic ground (σ 2–8). Texture contrast does more than colour contrast.

### E: cinematic scene (048)
- **Composition (OBSERVED, ±1 %):** the figure sits at 75–86 %W and 47–80 %H, on the right third. The orb is at 42 %W, 22 %H. The glowing chart line runs from 13 % to 87 %W.
- **Glow (MEASURED):** peak #ffe4a4 (luma 229) against a sky of #041717. Across the line, the core is about 10 px FWHM (0.9 %H). The halo decays from 71 to 27 over about 64 px on the sky side and plateaus at 71 on the fill side. Contrast is 14.8:1.
- **Absent:** text. Sky grain σ 0.3 points to a digital render (INFERRED, generative).

### A1/A3: serif hero numeral on paper (002, 047)
- **Ground (MEASURED):** #f9f8f4 and #fbf8f1, with σ 0.0, so no texture at all. 002 is split into two panels: #f9f8f4 on the left and #fcfbf9 on the right, with a divider at x = 510 (24.9 %W).
- **Type, 002 (MEASURED):** the hero numeral is 165 px tall (14.3 %H) and 15.0 %W wide, in teal #06686e (6.15:1 contrast). The headline cap is 36 px (3.1 %H) on a 57 px pitch (1.58×), so the numeral is 4.6× the headline cap. Metadata is in monospace caps at a 20 px cap (1.7 %H). The left margin is 65 px (3.2 %W).
- **Type, 047 (MEASURED):** the headline cap is 76 px (3.7 %H) on a 112 px pitch (1.47×). The numerals are 146 px (7.1 %H), 1.9× the headline cap. Labels have a 16 px cap (0.8 %H) in #74716e (4.57:1). Tracking on the monospace labels is about +0.06 to +0.14 em (INFERRED, assuming a 0.6 em mono advance). The margin is 153 px (7.5 %W). Rules sit at about 23.5 %H and 90 %H, with a hairline grid split at 50 %W (OBSERVED).
- **Density (MEASURED):** ink covers 3.6 % (002) and 3.0 % (047) of the canvas. Ink is #1c1e1c to #20211f, never pure black on average.

## 3. The system

**Invariants:**
- Paper grounds sit at luma 247–251 and are always grain-free (σ 0.0). [MEASURED]
- Display type is a serif headline in sentence case. [OBSERVED]
- Metadata and footers are monospace caps. [OBSERVED]
- Paper posts use exactly one accent, teal, for "us". [OBSERVED]
- Photographic or rendered grounds always carry grain (σ 2–8 in the midtones) or a heavy texture. [MEASURED]

**What varies:**
- Ground: paper (42 images), photo or render (12), carbon (3, plus 1 code shot).
- Chart titles come in two treatments, serif or monospace caps. [OBSERVED]
- Aspect ratio follows the archetype, as listed in section 1.

**Post type → archetype (INFERRED):**

| Post type | Archetype |
|---|---|
| Benchmark or eval results | A1, sometimes A3 |
| Architecture or security explainer | A2, or D for security and infra |
| Feature launch | C |
| Partnership | B |
| Brand moment | E |

About 1 in 5 posts (B+C+E) is cinematic; the rest is restrained paper.

## 4. Three directions for Agenta (on a 2839×1596 canvas)

### 1. "Darkroom" (partner and integration announcements)
- **Ground and lockup:** carbon #1e1d1c. Agenta mark | partner mark centred at 50/50, 1340–1680 px wide (47–59 %W), with the tallest glyph 110–120 px (6.8–7.6 %H). The divider is 1 px #f1eeec at 70 % opacity. Partner logos stay in their own colours, or in white on dark.
- **Light build:**
  - Three layers with `filter: blur(140px)`:
    - a terracotta #d97757 mass at 70 %W, 85 %H, radius 22 %W
    - a #f1eeec hotspot about 8 %W across at 66 %W, 36 %H
    - one 3 %H streak at −24° in yellow #f2f25c at 60 % opacity. This is the single accent.
  - Crush the blacks: the plate's mean luma should land at 30–40.
- **Grain:** SVG `feTurbulence` (baseFrequency about 0.85, numOctaves 2) composited with `mix-blend-mode: overlay` at 0.10–0.14. Overlay keeps blacks near σ 1 and the mids near σ 4, matching the measured 0.7 / 4–8.
- **The technique:** grain whose strength scales with luminance over defocused light, with nothing else on the canvas.
- **Risk:** generic "AI wallpaper". Do not copy 004's blue/amber pairing or streak geometry; drive the streak path from an Agenta trace or eval curve.

### 2. "Window" (feature launches)
- **Layout:**
  - Option (a), card: a real Agenta capture from `shoot-still`, 2572 × 597 px (90.6 %W × 37.4 %H), centred at 50/50, radius 57 px (2 %W), no shadow. The header row is #f1eeec and the body is #ffffff.
  - Option (b), headline + window: a GT Alpina Light headline in #ffffff, cap 85 px (5.3 %H) on a 129 px pitch, centred, measure ≤ 54 %W. The window's top edge sits at 26 %H, it spans 7–95 %W, and it bleeds off the bottom.
- **Ground:** full-bleed desaturated photo or render, grain σ 3–4 in the mids. Licensed or generated; justified because the texture contrast is the whole effect.
- **Risk:** stock-photo feel; copied if dunes, hills, sky or grass. Use another motif family (macro paper fibre, ink in water).

### 3. "Ledger" (eval results and stat posts)
- **Ground and margins:** paper #f1eeec, flat (σ 0). Margin 213 px (7.5 %W).
- **Type:**
  - Headline in GT Alpina Light, cap 59 px (3.7 %H) on an 87 px pitch (1.47×).
  - A single hero numeral is 228 px (14.3 %H). In a 2×2 grid, each numeral is 113 px (7.1 %H).
  - Labels are GT Alpina caps with +0.10 em tracking, cap 13–27 px (0.8–1.7 %H), in #242424 at 60 % (INFERRED to reach about 4.5:1).
  - One PP Mondwest word as a tag.
- **Rules:** 1 px #242424 at 23.5 %H and 90 %H. Interior hairlines are #242424 at 20 %.
- **Colour:** keep ink density at or below 3.6 %. Yellow #f2f25c is the one accent, a flat block behind the key numeral. Terracotta is for chart marks only: it is 2.7:1 on paper, so never use it for text.
- **The technique:** scale contrast (numeral at 1.9–4.6× the headline cap) and lots of empty paper.
- **Risk:** closest to Perplexity's native look. Avoid teal, the 25/75 two-panel split and mono-caps footers (Agenta has no mono face, which helps).

## 5. Do not copy
- The Perplexity mark and the "computer face" glyph (monitor with two dots).
- Teal #06686e as an "us" colour.
- The `PERPLEXITY.COM` monospace-caps footer convention.
- The blue/amber light-leak plates of 004 and 014.
- The dune and green-hill renders (058) and the grass-and-flowers renders (056).
- The orb, armchair and glowing-chart scene (048), and the mirror sphere in a field (011).
- The "FIG. 00 · DERIVED FROM …" caption formula and the "X on WANDR" chart naming.
- The hatched isometric bar figure (017).

**UNKNOWN:** exact typefaces; film scan vs generated plates; post copy; pre-X source resolution (JPEG may add about 1 to measured σ).
