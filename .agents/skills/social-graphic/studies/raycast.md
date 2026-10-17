# @raycast: post graphics reverse-engineered

50 images. Scripts and numbers are in `work-raycast/` (`stats.txt`, `titles.txt`, `hero.txt`, `px.py`, `rows.py`, `hero.py`, `prof.py`, `vprof.py`, `lit.py`). A % value with no unit is a share of the canvas. The house size is 2048×1024 (2:1); 27 of the 50 images use it (MEASURED).

## 1. Archetypes

| Archetype | n | ids |
| --- | --- | --- |
| A1 Emissive object: one 3D object lit from within in red or orange on near-black | 7 | 001 006 010 015 016 032 034 (034 has no title) |
| A2 Smoked glass: monochrome glass or chrome 3D UI objects (keycaps, pills, panels) | 16 | 007 009 011 019 022 030 039 040 042 043 044 046 047 048 049 050 (043 has no title) |
| A3 Titled UI card on a blurred photo | 1 | 013 |
| B Hardware render (keyboard) | 4 | 012 017 018 020 |
| C Event poster: wire globe and extended-italic headline | 2 | 002 027 |
| D Documentary photo (events, office, staff) | 10 | 003 004 005 025 026 033 035 036 037 038 |
| E Creator thumbnail (face cutout with logos or a tweet) | 2 | 008 045 |
| F Raw app screenshot, no title | 5 | 021 023 024 029 041 |
| G Launch and partner (Product Hunt, mymind) | 3 | 014 028 031 |

## 2. What makes A1, A2 and C striking

### Shared title grid (A1, A2; 19 cards measured)

- **Left edge:** x = 109–120 px = 5.3–5.9 %W (MEASURED, 19/19).
- **Last baseline:** y = 906–908 of 1024 = 88.6 %H (MEASURED, 15/19). The title is bottom-anchored and grows upward.
- **Title cap height:** 129–134 px = 12.6–13.1 %H on 2068+ cards. It is 11.0–11.5 %H on the earlier 046–048 (MEASURED).
- **Line pitch:** 164–170 px = 16.0 %H, which is 1.27× the cap (MEASURED).
- **Title setting:** a regular-weight grotesque in title case, left-aligned (OBSERVED). Two lines, each ≤ 53.7 %W (MEASURED, 006). Tracking ≈ 0 (INFERRED).
- **Tag pill (2068+):** sits above the title as `PLATFORM | vX.Y`.
  - Caps are tracked about +0.1 em (INFERRED from a 184 px span for 7 caps at a 23 px cap).
  - Cap 23 px = 2.2 %H; cap top at 48.3 %H (MEASURED).
  - Gap from pill baseline to title cap top: 95 px = 9.3 %H (MEASURED).
  - Hairline outline in grey (OBSERVED).
- **Earlier template (046–048):** grey "Version 0.6x" eyebrow at cap 4.2 %H, an OS glyph top-left at y 10–16 %H, no pill (MEASURED/OBSERVED).
- **Hero placement:** the hero's p2–p98 box always starts at 51–53 %W and bleeds to 89–99 %W (MEASURED, 11/11). Its centroid sits at 67–80 %W, 33–66 %H. It crops off at least two edges (OBSERVED).
- **Density:** the left (text) half is only 4.8–17 % lit (L>30), against 7.7–45.6 % for the whole canvas (MEASURED, `lit.py`).

### A1 Emissive object

- **Ground:** pure `#000000` with sd 0.00 in 001, 006 and 010 (MEASURED). 010 tints it red, `#0a0000`–`#190000`.
- **Coverage:** 72–88 % of pixels are below L16 (MEASURED).
- **Crisp-tube variant (006):**
  - Stroke core `#cf662d` to `#c22f15`, about 16 px wide.
  - Falloff from L207 to L38 within 8 px, and to ground within 12 px (MEASURED). There is no bloom; the light reads as solid.
- **Bloom variant (010):**
  - Core `#d82b13`, with a white-hot specular `#fac3b1`.
  - Halo falls from L135 to L6 over 68 px, so τ ≈ 22 px = 1.07 %W (MEASURED, exponential fit).
- **Heat-ramp variant (032):** text lines glow through a frosted dark panel.
  - Bar core `#ffe7a2`, ramping through `#ff9c67` to the trough `#dc5c3e` (MEASURED).
  - Bar pitch 80 px = 7.8 %H.
  - The trough never drops below L~140, so neighbouring halos merge (MEASURED).
  - Glow spills about 100 px onto the panel (`#f39465` to `#593330`). The panel body is `#4a4b4e` (MEASURED).
- **Red share:** red or orange pixels make up 2.2–12.4 % of the canvas (MEASURED). Saturated colour appears only as emitted light.
- **Absent:** gradients in the ground, a second hue, UI chrome, a logo (OBSERVED).

### A2 Smoked glass

- **Ground:**
  - Later cards: `#070707`–`#222222`, with grain sd 0.8–2.8 L (MEASURED; 047, 039, 048).
  - 047: corners lift from L8 at the centre to L20 at bottom-left, an inverse vignette (MEASURED).
  - 001 and 006: grain sd 0 (MEASURED).
- **Glass material:** clear or smoked glass objects with 1–2 bright rim highlights (OBSERVED). Glyphs inside are near-white `#f0f0f0`, never 255 (MEASURED, 043).
- **Lens artefacts (043):**
  - Bar edges carry a warm `#e8cfbb` fringe on one side and a cool `#d7e8f0` fringe on the other, about 4 px wide. That is lateral chromatic aberration (MEASURED; the post effect is INFERRED).
  - Bloom fills the gaps between bars at 65 % of core luma (L163 vs L239; MEASURED).
- **Colour:** zero hue in 12 of the 16 images (`%sat` < 1; MEASURED). 050 carries colour only in the glass tint.
- **Toolchain:** UNKNOWN. A 3D renderer is INFERRED from the refraction and depth of field.

### C Event poster

- **027:**
  - Ground `#1500FF` with white ink (MEASURED).
  - Globe stroke 14 px = 0.68 %W (MEASURED).
  - Headline in heavy extended italic, kerned so letters collide, cap ≈ 9.6 %H at the top edge (OBSERVED/MEASURED).
  - Partner names in condensed caps, cap 114 px = 9.9 %H, centred inside the globe (MEASURED).
- **002:** square, grey `#c4c4c4` with coarse mono noise in about 4 px cells, sd 25 L (MEASURED). That reads as a photocopy.

## 3. The system

- **Invariants (MEASURED unless marked):**
  - 2:1 canvas.
  - Dark ground with L < 35 on 31 of 50.
  - Title bottom-left at 5.9 %W and 88.6 %H, cap 11–13 %H, two lines at most.
  - Hero in the right half, bleeding.
  - At most one hue per card: red on A1, none on A2.
  - No CTA, URL or date on product cards (OBSERVED).
- **What varies:** the hero material (emissive, glass, hardware); the tag text; the ground (pure black vs a lifted gray with grain).
- **Post type → archetype (OBSERVED from the manifest):**

| Post type | Archetype |
| --- | --- |
| Weekly update, performance | A1 (001 007 010 011 013) |
| Feature launch | A2, or A1 when the feature is "core" (006 016 032) |
| iOS release | A2 (009 040 044 049) |
| Merch | B |
| Event | C, and D afterwards |
| Culture, "who we are" | D |
| Video | E |
| Launch day | G |

## 4. Three directions for Agenta

The numbers below are mapped to 2839×1596 (1 %H = 15.96 px, 1 %W = 28.39 px).

### D1 "Lit from within"

**Use for:** a feature launch where the feature is a list of things, such as traces, eval rows or a prompt diff. It replaces *statement* when there is no screen to show.

**Layout:**
- Ground is carbon `#1e1d1c`.
- The panel spans x 50–94 %W (1420–2669 px) and y 9 %H to the bottom edge (bleeding).
- Panel styling: `rgba(241,238,236,.05)`, a 1 px border at `rgba(241,238,236,.12)`, `backdrop-filter: blur(24px)`, radius 3 %H.
- Behind the panel go 6–7 bars:
  - height 3.5 %H, pitch 7.8 %H (124 px), left inset 8 % of panel width;
  - the last bar is 60 % long.

**Type:**
- GT Alpina Light, paper `#f1eeec`.
- Cap 12 %H (191 px; font-size = 191 / face cap-ratio, ratio UNKNOWN, so measure after render).
- Pitch 1.27× the cap.
- Left edge 5.9 %W (167 px); last baseline 88.6 %H (1414 px); width ≤ 46 %W.
- An optional tag at cap 2.9 %H (Agenta's legibility floor) with 0.1 em tracking, top at 48 %H.

**Colour:** the bar cores are yellow `#f2f25c` (this is the one yellow moment). The halo is terracotta `#d97757`: `filter: blur(30px)` plus `box-shadow 0 0 60px #d97757`. Target a trough between bars at ≥ 55 % of core luma, so halos merge as in 032.

**The technique:** the yellow-to-terracotta heat ramp seen through frosted glass. Agenta's own two accents already form a blackbody ramp.

**Risk:**
- A document icon with a folded corner copies 032. Use Agenta objects instead: trace spans with varied widths, or eval rows.
- Neon on black reads generic. Keep the canvas ≤ 35 % lit.

### D2 "One live line"

**Use for:** an eval result, a latency or cost win, or a weekly changelog. It is an alternative to *figure*.

**Layout:**
- Ground is carbon `#1e1d1c`, flat, grain sd ≤ 1.
- One SVG path drawn from real data.
- Its bbox runs x 51 %W to past the right edge and y 15–100 %H, exiting at least two edges.
- No axes and no gridlines. Lit pixels stay ≤ 9 % of the canvas (006: 7.7 %, 010: 8.5 %).

**Type:** same grid as D1. Add one number in GT Alpina Light at cap 6 %H next to the line's end, inside the canvas.

**Colour:**
- The stroke is terracotta `#d97757` at 22 px.
- The inner highlight is 5 px of `#f6d2bf` (INFERRED lighter step), offset −4 px.
- Bloom: `drop-shadow(0 0 31px #d97757aa)`, which gives τ ≈ 31 px (1.07 %W, scaled from 010).
- The yellow moment is a 14 px dot at the line's latest point.

**The technique:** a single emissive stroke where light is the only colour. The canvas stays 90 % dark and the data gets 100 % of the attention.

**Risk:**
- Pure red `#e10300` on `#000000` is Raycast's signature, so stay on terracotta and carbon.
- A made-up curve is decoration; use the real series.

### D3 "Field poster"

**Use for:** events, meetups, a community milestone, or a partner announcement with no product claim.

**Layout:**
- Ground is paper `#f1eeec` with mono noise in 3–4 px cells at sd 10–14 L, from an SVG `feTurbulence` or a tiled PNG. 002 runs at sd 25; halve it for Agenta's quiet rule.
- One oversized line diagram:
  - Stroke 19 px (0.68 %W), ink `#242424`.
  - It spans 90 %W and bleeds off the top or bottom.
  - Draw an Agenta motif, such as a trace tree or concentric eval rings. Never a globe.

**Type:**
- A GT Alpina Light headline at cap 9.6 %H (153 px), top-aligned at 2 %H, in sentence case. Do not use italic extended.
- The city or date as the single PP Mondwest word, on a `#f2f25c` block (the one yellow moment).
- Partner logos in their own colours at 9.9 %H, centred inside the diagram.

**The technique:** monumental line work plus photocopy grain makes it read as print, not UI.

**Risk:** a grain filter applied to an ordinary layout reads as a Canva preset. The diagram has to dominate (≥ 60 % of the canvas area).

## 5. Do not copy

- Red emissive objects on pure black as the house look.
- Smoked-glass keycaps, glass app-icon tiles, and the waveform pill (043).
- The `PLATFORM | vX.Y` pill tag, and the "Version 0.6x" eyebrow with an OS glyph.
- The keyboard and hardware renders and any keycap motif; the folded-corner glowing document (032).
- The wire globe, "THE NEW STANDARD", extended-italic colliding headlines, and the `#1500FF` ground.
- The mymind fuzzy figure, the Product Hunt chrome swirl, and creator-thumbnail face cutouts.
- An Inter-like grotesque title: use GT Alpina. The 5.9 %W / 88.6 %H grid itself is generic and safe to adopt.
