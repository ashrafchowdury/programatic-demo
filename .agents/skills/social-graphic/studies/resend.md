# @resend — post graphics, reverse-engineered

41 images. Harness: `probe.py` (hist, grid, type, fit) and `work-resend/px.py` (patch hex, luma sd, row/column profiles). Template canvas is **1920×1008** (16 of 41, MEASURED); the other 25 are screenshots or photos at their native sizes. Below, %H/%W is relative to the image measured.

## 1. Archetypes (all 41 classified, OBSERVED)

| Archetype | n | ids |
|---|---|---|
| A. Monochrome serif card (pill + headline, hire, role, quote) | 13 | 001 014 022 024 026 034 · role 009 021 · new hire 018 020 031 036 · quote 013 |
| B. Gradient-light condensed (event register) | 6 | 007 015 025 032 · speakers 023 039 |
| C. Lit 3D object hero | 3 | 004 038 040 |
| D1. Code panel on grey chrome-ribbon backdrop | 4 | 011 027 033 035 |
| D2. Dark UI crop | 5 | 002 006 017 029 041 |
| E. Light UI or chart screenshot | 5 | 003 005 008 012 028 |
| F. Event or behind-the-scenes photo | 5 | 010 016 019 030 037 |

The account splits into two registers, MEASURED by mean saturation: A/D1/C-040 sit at **0.00–0.02**; B sits at **0.63–0.82**. Every B post is about the event or a livestream (manifest). Mean luma is under 35 on 25/41 images. Only E (5/41) uses a light ground.

## 2. What makes the striking ones work

### B. Gradient light with the type caught in it (007 015 032 025 023 039)
- **Grid and focal point (MEASURED).** On 007/015 the headline box is x 605–1314, y 394–610, centred at **(50.0%, 49.8%)**. 015 matches 007 to within 3 px, so it is a template. Mono meta labels sit in 4 columns at x 70 / ~450–615 / ~1140–1314 / 1725, with the top line at y 73. That is a 3.6%W margin and a 7.2%H top inset.
- **Type (MEASURED).** Condensed grotesque, all caps, tight tracking (OBSERVED).
  - 007/015: cap 215 px = **21.3%H** on a 37%W line.
  - 032: cap 213 (21.1%H), with a line pitch of 240 measured bottom to bottom, which is 1.13×cap.
  - 023: name cap 177 = 16.4%H, pitch 1.18×cap, left edge at 50.5%W.
  - 039: title cap 133 (13.2%H); names cap 45 (4.5%H), pitch 1.13×.
  - Labels: mono caps, cap 11 px = **1.1%H**, pitch 16.
  - Ink is **#fdfdfd**, not #fff.
- **Colour.** Ground cores are pure **#000000** (MEASURED). 007 column, top to bottom: #dc5702 → #b46a01 (11%H) → #3f2502 (22%H) → #010101 (39%H), black through the type, then petals in #dd1e04 / #a32d01. 015 is the same build in blue: #462ede → #2006c9 → #060129 by 25%H. 025 uses red #c80306 + violet #b74fb8. 032 uses red #c30c00.
- **The technique (MEASURED, implementation INFERRED).** Where the light crosses a letter, the *glyph fill* takes the light's colour while the counters stay ground. Down one stem of 032 the fill runs #fdfdfd → #f4d0b8 → #e58f70 → **#c30c00** at y 500 (49.6%H), then back to #fbf1f0 by y 600. The fade length is about 140 px each way. At row 650 the line ends are #c10d07 and the centre is #fdfdfd. On 007 the feet of the W are #e62522 exactly where a petal passes. The counters measure #1f0101, the same as the ground. INFERRED: a second copy of the light gradient, clipped to the text (`background-clip:text`), mixed over white.
- **Texture.** Monochrome grain, patch sd **≈4–5 luma at midtones (L≈100)** and ≈1.4 in blacks (MEASURED). INFERRED: an overlay-blend noise layer.
- **Density.** White ink is 4.1% (007/015) and 8.7% (032) of the canvas.
- **Speakers (039).** Six B&W portraits (R=G=B), each **286 px = 14.9%W** wide with a 16 px gutter, y 316–752 (43%H, aspect 0.66). Margins are 60 px = 3.1%W. The red light passes *behind* the photos.
- **Absent:** serif type, rounded UI, drop shadows, the product.

### C. Lit 3D object (040, 038)
- **Layout.** 040 is one isometric slab, about x 562–1356 (41%W) by y 263–776 (51%H), centred (OBSERVED from grid). The image has **no text**: ink ≥100 is only 1.53%, all of it the logo (MEASURED).
- **Light.** The logo face reads #e2e2e2 and glows onto the slab. The excess over ground runs 38→31→20→15→7→2 per 12 px. `fit` gives r = 0.555 per 12 px, a **1/e distance of ≈20 px = 2.0%H** (MEASURED).
- **Ground.** #0a0a0a–#101010 with grain sd ≈3. Four blurred copies of the object sit in the corners at L 30–44 (MEASURED), giving depth.
- **038.** Rays fan from a box, warm on the left (#3a4014 → #916b24) and magenta on the right (#a82859 → #4b0c38), spanning 300–1700 px (73%W). The box interior is cream #ded2b4. Partner logos are flat white.
- **Absent:** headline, colour on the object itself (040 saturation 0.00).

### A. Monochrome serif card (024, 020/031/036, 009)
- **Type.** Serif display cap is **112–115 px = 11.2%H on every A card measured** (009, 020, 024, 031, 036; MEASURED invariant). The 024 three-line block runs y 324–764, centred, with **pitch 163.5 = 1.45×cap**. New-hire names sit on a fixed band at y 690–819 in all three (MEASURED). The role card (009) is left-aligned at x 105 (5.5%W).
- **Fill (MEASURED).** One vertical gradient across the whole block, not per line: **#fafafa (top) → #e9e9e9 → #dcdcdc → #cbcbcb → #aeaeae (bottom)**, falling about 0.19 L/px. 020 does the same at line scale (#fcfcfc → #dedede).
- **Ground.** #050505–#191919, with dim ribbed 3D forms peaking at L 44 and grain sd 3–6.
- **Pill.** #1d1d1d, label cap 22 px = 2.2%H, sitting above the headline.
- **Density.** Bright ink ≥128 is 3.3%; 85.8% of pixels are below L 16.
- **Absent:** colour, a wordmark on most cards (024, 020, 031, 036, 034; OBSERVED), and any rule lines.

D1 (011): a code panel #040404 with radius ≈2%W on ground #1e1e1e, set against grey chrome ribbons at #666–#676767. It spans 83%W. It works because there is one bright diagonal and nothing else.

## 3. The system

- **Invariants (MEASURED).** Near-black ground (L<20 at the core). Off-white ink (#fdfdfd, or a gradient down to #aeaeae). Grain on every designed card. Either one centred focal block or one object. A fixed cap scale: 21%H for the countdown, 16%H for a name, 13%H for a title, 11.2%H for serif display, 2.2%H for the pill and 1.1%H for meta.
- **What varies.** Register: monochrome serif for product and company posts, saturated gradient light with condensed caps for the event. Each event card changes hue (orange, blue, red/violet) while the build stays the same.
- **Post type to archetype.** Feature/API/changelog → A1 or D1 (pairs 026→027 and 034→035 are a title card followed by a code card, OBSERVED). Hire/role → A2/A3. Event, ticket, speaker → B. Partner or announcement teaser → C. Proof (charts, customers) → E or A4. Culture → F.

## 4. Three directions for Agenta (2839×1596)

**D1 "Lamplight" (launch, countdown, event, big number)**
- **Ground.** Carbon #1e1d1c, with the core taken down to #121110 by a radial vignette. Justify the gradient: it *is* the light.
- **Light.** One blurred elliptical arc, about 120%W wide with its crown at 50%H, blur 6%H, running terracotta #d97757 → yellow #f2f25c at its brightest 15% of length. This is the single yellow moment.
- **Type.** GT Alpina Light, 1–3 words, centred at (50%, 50%). Cap **16–18%H (255–287 px)**, pitch 1.15×cap, tracking −1%. Ink #f1eeec.
- **Technique.** Clip the same arc gradient to the glyphs (`background-clip:text`, mixed over #f1eeec). Letters then take the light where it crosses them and the counters stay carbon. Add a grain overlay with sd ≈4/255 at midtones (feTurbulence, opacity ≈0.07).
- **Meta row.** 4 columns at margin 3.6%W, top 7.2%H, cap 1.1%H (18 px). Use PP Mondwest for one word only, e.g. the date.
- **Speaker variant.** N portraits at 14.9%W, gutter 0.8%W, desaturated, with the arc passing behind them.
- **Risk.** Red/orange and condensed caps would read as Resend. The serif Light and the terracotta→yellow pair keep it ours.

**D2 "Specimen" (integration, partner, a single capability)**
- **Layout.** One object centred, 40%W × 50%H, on carbon. No headline, so the post text carries the words.
- **Object.** Built in HTML with CSS 3D (`rotateX(55deg) rotateZ(-45deg)`). Use an Agenta artefact (a prompt-version tile in paper #f1eeec, or the partner's logo in its own colours) on a slab in #242424. Justify 3D because it is the object.
- **Glow.** The face glows onto the slab with a 1/e falloff of **2.0%H (32 px)**, e.g. `box-shadow: 0 0 0 0, 0 0 64px rgba(241,238,236,.35)`. Place 3–4 blurred echoes (blur 1.5%H, L 30–44) in the corners. Grain sd 3.
- **Risk.** The "glowing keycap" is a common motif. Never use a keycap or slab with screws; use our own artefact.

**D3 "Graphite" (feature, API, changelog, hire)**
- **Ground.** #121110 → carbon, with a dim field of drawn forms (canvas line-art, never above 17% luma).
- **Type.** GT Alpina Light, centred, cap **11.2%H (179 px)**, pitch 1.45×cap, at most 3 lines.
- **Technique.** One vertical gradient over the whole text block: #ffffff → #f1eeec → **#a9a6a4** at the bottom. That is a 33% luma drop, matching the measured #fafafa→#aeaeae.
- **Pill.** #2a2928, label cap 2.2%H.
- **Pairing.** Pair the card with a second image: a code or UI panel at 83%W.
- **Hire variant.** A circular portrait above the name, with the name band fixed at 68–81%H.
- **Risk.** Silver serif on black is now generic across dev-tools. Keep the warm carbon and the paper-tinted gradient rather than neutral grey.

## 5. Do not copy

- Resend's "R" mark or the "Forward" wordmark.
- The stamp/perforated ticket frame (025).
- The isometric keycap with screw heads (040).
- The glowing gift box with logos flying out (038).
- Chrome ribbon backdrops (011/027/035).
- Ribbed 3D blobs (024).
- The orange/red/blue/violet event palettes.
- Their condensed display face and mono label face.
- The "LIVE" red-dot speaker layout (023).
- The exact 4-column "SAVE THE DATE" meta row text.

UNKNOWN: the font families, whether the glow and grain are rendered or composited, and the original export size before X recompression.
