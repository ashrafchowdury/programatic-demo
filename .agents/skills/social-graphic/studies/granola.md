# @meetgranola: what makes the post graphics work

35 images from 24 posts. Tags: **O** observed, **M** measured (probe.py or a pixel script in `work-granola/`), **I** inferred, **U** unknown. Percentages refer to the source canvas.

## 1. Archetypes (35)

| Archetype | n | ids |
|---|---|---|
| A. Documentary photo, nothing laid over it (merch, clue hunt, café, billboard) | 16 | 006 016 017 018 019 020 022 023 024 025 026 027 028 029 030 031 |
| B. Collage poster: grain plate, cut-out or engraving, serif title, pill chips | 7 | 001 (4-up) 003 009 010 011 012 013 |
| C. Product UI shown on a flat field | 4 | 004 008 032 035 |
| D. 3D mascot render | 2 | 002 005 |
| E. Typographic or pattern poster | 2 | 015 021 |
| F. Partner lockup on a gradient | 2 | 014 033 |
| G. Plain speaker portrait | 1 | 034 |
| H. Device render | 1 | 007 |

O: 16 of 35 (46%) are photos with no added type or logo. The house graphic style lives only in B, C and E (13 images).

## 2. The striking archetypes, measured

### B1. Split plate, speakers (011, 012)
- **Grid (M, 011, 2048×1152):** the type column is flat paper `#F7F8F2` (luma σ 0.0) from x 0 to 31%W. The collage covers 31–100%W. A pink plate `#F0B5E3` (σ 4.4) runs x 56–83%W and y 0–50%H. A halftone strip (`#E18264` and `#D4405F` dots on a cream ground, σ 37.8) runs from 83%W to the right edge at full height.
- **Hero (M):** greyscale cut-outs make up 41% of the canvas (pixels with chroma under 18). The tallest head starts at 12%H. All three figures bleed off the bottom edge (leftmost ink at y 1150 is x 640). On 012 the portrait bleeds off the bottom and right edges (x 43–51%W to 100%), and the halftone band starts at y 67.4%H.
- **Type (M):** serif display, sentence case, ranged left. On 011 the cap is 60 px, 5.2%H, at x 3.3%W with cap top at 14.9%H. On 012 the cap is 106 px, 5.2%H, with a pitch of 159 px (1.50× cap). Chips are pastel tints (`#E5EACB`, `#E8E4F5`, `#D2E5F6`, plus `#D2E14B` on 012) with sans text at about 40% of the headline cap (O).
- **Contrast (M):** ink `#1E1E1E` (I) on paper is 15.6:1.
- **Absent (O):** colour in the photos, drop shadows, gradients, and grain on the type side.

### B2. Grain field with a UI slab (003, also 009 and 010)
- **Field (M, 003 at 1920×1080):** lime `#CBD946` / `#C8D643` with luma σ 3.5–4.4. The grain is a 1–2 px monochrome speckle (O, 4× zoom).
- **Slab (M):** `#F6F6F6` panel from x 65%W to the right edge (bleeds) and from y 9.3%H to the bottom edge (bleeds). Corner radius is about 9%H (I). The panel carries its own grain (σ 3.6).
- **Type (M):** two lines. Cap 96 px (8.9%H, measured on an "S", so it includes overshoot), pitch 145 px (1.51× cap), x 5.8%W, cap top 30%H. The text block spans 42%W. **One word is set in a handwritten script** ("TEAMS") next to the partner's app icon (O).
- **Collage (M):** an orange duotone mountain cut-out (`#BD7728` to `#CA8023`, σ 7–12) and dark brush strokes `#3E3E3C` (σ 5.5) are cropped by the bottom edge and fill the lower-left 0–60%W, 65–100%H (O). Collage elements stay behind the type and never touch it (O).
- **Contrast (M):** ink on lime is 10.8:1.

### B3. Dark engraving (013, 001 top-left quadrant)
- **Ground (M):** `#252525`, σ 3.0–7.4, with film-dust scratches (O).
- **Hero (O):** a bridge engraving tinted one flat blue (`#AAC3E7`/`#B6CFF4`), anchored bottom-right and bleeding off two edges. Cream circles `#EEEFEA` with small numbers are scattered across 0–85%W.
- **Strip (O):** a blue strip from about 87%W carries giant rotated serif type, cropped on both long edges.
- **Type (M):** white serif, cap 63 px (5.5%H), x 3.3%W, cap top 6.3%H, pitch 84 px (1.33× cap).
- **Density (M):** 70% of pixels have luma under 90.
- **Contrast (M):** 14.4:1.

### E. Pattern poster (015, 2048²)
- **Ground (M):** flat pink `#FFBCEF`, σ 0.0. The art is vector (I).
- **Title (M):** `#F15B40`, cap 249 px (12.2%H), line 51.6%W, centred.
- **Second line (O):** the next line is one hand-lettered word, ringed by a loose stroke at about 40% opacity.
- **Pattern (M):** a woven band from y 60.4%H to the bottom edge. Columns repeat every 102.9 px (5.0%W, 20 across). Six flat colours: `#F58B6D`, `#ABBF65`, `#FFBCEF`, `#F49AC1`, `#F15B40`, `#F5F4EC`.
- **Contrast (M):** title on ground is only 2.17:1. Size carries the title, not contrast.

**UNKNOWN:** typeface names, the exact halftone screen (from the zoom it looks like a pitch of about 10 px rotated about 15°, I), the grain generator, and whether the plates are scanned paper or synthetic.

## 3. The system

**Invariants (O):**
- One serif display face for all titles, in sentence case, ranged left (except E).
- The logo goes bottom-left on landscape layouts and top-right on squares.
- Metadata goes in pill chips, never in a second type size.
- The type field stays flat (σ 0). Grain appears only on collage plates (σ 3.5–7, M).
- Every cut-out is single-tone: greyscale, duotone or one-colour engraving. Full-colour photos appear only in archetype A.
- Hero art bleeds off at least one edge in all 7 B images.
- At most one handwritten word per image (003, 015, 001 basketball).

**Varies:**
- Ground: lime, black, blue, paper or pink.
- The cut-out subject: space shuttle, moon, chameleon, mountain, bridge, portraits.
- Aspect: 7 squares, 13 at about 16:9.

**Post type → archetype:**
- Event or speaker → B1/B3 (5 posts)
- Feature launch → B2 when the feature names a partner (003, 009, 010), C otherwise (004, 008, 032, 035)
- Partnership → F
- IRL or merch campaign → A
- Promo or culture → E

## 4. Three directions for Agenta (2839×1596)

### D1. "Plate split": events, speakers, customer stories
- **Layout:** paper `#f1eeec` type column x 0–900 px (31.7%W), flat with no grain.
- **Plates:** carbon `#1e1d1c` from x 900 to 1600, y 0–800. Terracotta halftone from x 2360 to the right edge at full height. Make the halftone with CSS `radial-gradient` dots at a 14 px pitch, rotated 15°, terracotta on paper.
- **Hero:** greyscale cut-out (`filter: grayscale(1) contrast(1.1)`) at 85–88%H, bleeding off the bottom edge.
- **Type:** GT Alpina Light 300. Cap 83 px (5.2%H). Font-size about 119 px (cap ratio U, check against the font). Line-height 125 px (1.5× cap), x 94 px, cap top 238 px (14.9%H).
- **Chips:** 34 px sans, paper/ink tints. The one yellow moment is the chip for the speaker's company.
- **The technique:** grain σ ≈ 4 luma, only on the plates (SVG `feTurbulence` baseFrequency about 0.9, monochrome, about 8% opacity, clipped to the plates). That flat-versus-textured contrast is what reads as printed.
- **Risk:** pink plus red-dot halftone is Granola's signature, so never use pink. If there is no real portrait, use a greyscale object or engraving, never stock faces.

### D2. "Field and slab": feature or integration launches
- **Field:** full-bleed carbon `#1e1d1c`, grain σ 4. Use the yellow field only for a launch big enough to spend the accent on.
- **Slab:** white `#ffffff` UI panel from x 1845 px (65%W) and y 148 px (9.3%H), bleeding right and bottom, radius about 140 px (I). Real product UI inside it, not a mock.
- **Headline:** GT Alpina Light, cap 142 px (8.9%H), two lines, pitch 214 px, x 165 px, cap top 479 px (30%H).
- **The one word:** the feature or partner name in PP Mondwest at cap height, coloured yellow `#f2f25c`. This is Agenta's equivalent of the handwritten word and the only accent. Partner logo tile (keeps its own colours) sits before it at 1.3× cap.
- **Lower-left:** one duotone cut-out in carbon and terracotta via SVG `feColorMatrix`, cropped by the bottom edge, filling 0–55%W and 68–100%H, never touching the type.
- **Risk:** without the cut-out this is a generic SaaS card. Brush scribbles and lime would read as copied, so leave out all hand strokes.

### D3. "Woven grid": milestones, eval results, culture posts
- **Ground:** flat paper `#f1eeec`, no grain.
- **Title:** centred, GT Alpina Light, cap 195 px (12.2%H), terracotta `#d97757`. Its contrast is 2.7:1, so the title has to stay above 150 px cap.
- **Band:** from y 964 px (60.4%H) to the bottom edge, 20 columns at a 142 px pitch (5%W). Build it with two `repeating-linear-gradient`s (vertical bars plus horizontal rows) in ink, terracotta, paper and white, with a single yellow cell.
- **The technique:** the weave encodes real data. Each cell is one eval or run, coloured by pass or fail, so the pattern carries information.
- **Risk:** a decorative gingham reads as a picnic or as Granola's promo. Without the data link, do not ship it.

## 5. Do not copy
- The spiral mark and the plush mascot (002, 005).
- Lime `#CBD946` as a ground, pink `#FFBCEF` as a ground or plate, red-dot halftone, and the pastel chip set (`#E5EACB` / `#E8E4F5` / `#D2E5F6`).
- Star-map cream circles with numbers, giant rotated serif strips, and handwritten brush lettering or loop scribbles.
- Their found imagery: shuttle, moon, chameleon, bridge, mountain.
- The gingham colourway, and the clue-hunt or merch photo campaign as a format.
