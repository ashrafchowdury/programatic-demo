# @cursor_ai post graphics — reverse-engineered (stills)

Corpus: 119 images (manifest rows 1–120; row 29 failed, so NNN = manifest row). 34 posted images (i), 33 link cards (c), 52 video poster frames (v). Tools: `probe.py hist/grid/framing/type` plus helpers in `social-study/cw/` (`m.py` bands/ink, `s.py` colour, `cols.py` columns). Tags: **O**BSERVED, **M**EASURED, **I**NFERRED, **U**NKNOWN.

## 1. Executive summary

1. **One light ground, one ink, one accent.** 61 of the 72 designed graphics (A–H, K) sit on a warm off-white between `#EDECE8` and `#F7F8F3`, or on pure `#FFFFFF` for charts and video openers (M). 12/119 images overall are dark. Title ink is warm near-black `#11120D`–`#282720` (M). The only accent is one orange, `#ED4C00`–`#F54E00`, used once per image on the number that matters (M, 113/042/050/062/040/061).
2. **Hierarchy comes from colour, not size.** Title and subtitle are set at the **same cap height** (6.1 %H vs 6.1 %H on changelog cards; 5.0 vs 4.9 %H on video openers) and split only by ink: `#282720` (14.0:1) vs `#8E8D88` (3.1:1) (M). This matches the films' title-card subhead `#8A8A85` (docs/reel/cursor/03-composition.md).
3. **Type is small and the canvas is mostly empty.** Text-card ink density is 0.7–4.7 % (M). Titles take 31–48 %W on centred cards (M). Margin is about 82 px on 2048-wide canvases (4.0–4.2 %W) across changelog, headline-chart and lockup cards (M).
4. **The image only proves; the post text tells.** Benchmark charts carry no headline, only axis labels at a 1.8 %H cap (M). The claim ("57.8 % on CursorBench") lives in the tweet (O). Research charts are the exception: they carry a 2.8 %H headline (M).
5. **The archetype follows the post type almost exactly** (§3). Model launch → CursorBench scatter (10/10). Partner → logo lockup. Blog link → abstract line art (12/12 text-free). Feature → video whose first frame is a centred title or the product UI.

## 2. Composition per archetype

| Id | Archetype | n | Members (NNN) |
|---|---|---|---|
| A | Centred title card (video opener) | 7 | 003 004 007 008 025 040 061 |
| B | Left-aligned changelog card, mark bottom-right | 4 | 023 034 068 070 |
| C | Title amid peripheral faded context | 4 | 010 112 039 062 |
| D | Dark marketplace/docs card | 3 | 074 094 116 |
| E | Logo card (partner lockup, grid, wordmark) | 9 | 033 046 053 078 084 104 002 058 109 |
| F | CursorBench cost×score scatter | 10 | 001 005 006 011 016 019 022 047 063 080 |
| G | Headline data figure (bar/line/table/diagram) | 20 | 014 031 032 036 041 042 050 086 105 110 113 114 119 · tables 045 059 079 · diagrams 069 090 099 · 071 |
| H | Abstract generative line art, no text | 12 | 015 027 037 043 051 060 067 072 091 097 102 106 |
| I | Product window on landscape painting | 22 | 035 044 052 056 064 075 076 082 083 087 088 092 093 098 100 101 103 107 108 115 117 118 |
| I′ | Product UI/device on colour gradient | 4 | 020 024 028 038 |
| J | Product UI full-bleed / on flat warm ground | 17 | 013 018 021 026 030 049 054 057 065 066 077 081 085 089 096 111 120 |
| K | Code card | 3 | 009 073 095 |
| L | Photo (customer, keynote, lifestyle) | 4 | 012 017 048 055 |

**Canvas (M).** Link cards are 1.905:1 (1200×630 / 2048×1075) in all 33 cases. Video posters are 16:9 (1200×675) in 33 of 52; the rest run 1.23–1.70 for tall UI flows. Posted images are not standardised: the aspect runs 1.10–2.02, and the 10 benchmark charts alone span 1.46–1.78.

**A — centred title (rep. 004, 040, 061).** Ground is `#FFFFFF` (003/007/040/061), `#F5F6F0` (004/008) or `#EBEAE5` (025) (M). The ink bbox centre is at x 50.0 %, y 46–50 %; side margins are 26–33 %W (M). Cap is 4.9–5.2 %H on 2-line titles, with pitch 53 px = 7.9 %H, about 1.6× cap (M). 003 is a 1-line title at a 6.2 %H cap (M). When the mark is used (004/008) it is 72×82 px = 6 %W / 12 %H, centred, with its top 40 px above the title. Title→subtitle pitch is 61 px = 9 %H (M). Subtitle `#8C8D87` vs title `#20201A`, size ratio 1.0 (M). Words: 2–8. In 040/061 one figure ("60%", "3x") is set in orange; the band mean is `#401C0C`, a black + orange mix (M, O).

**B — changelog card (rep. 023, 068, 070).** Identical geometry in all 4. Ground `#F7F7F4`. Text block anchored top-left at x 85 px (4.2 %W), first ascender at y 99 (9.2 %H). Title and subtitle cap 65–67 px = 6.1 %H, pitch 142–145 px = 13.4 %H (2.2× cap), the same pitch for every list line in 068. Title `#282720`, all other lines `#8E8D88`. Mark 76×87 px (3.7 %W × 8.1 %H), bottom-right, inset 85 px R / 76 px B. Ink 2.1–4.7 % (all M). Words: 6–18.

**C — title amid faded context (rep. 010, 112).** Centred title on `#F7F8F3`: cap 7.8 %H (010), "Canvas" wordmark cap 8.6 %H with a 11 %H icon (112) (M). Peripheral UI cards bleed off 2–4 edges. 010 card1 is cut at top-left and runs to x 482 / y 148; card2 runs off right and bottom from x 505 / y 490 (M). Cards use a fill only 1.08–1.11:1 from the ground (`#EDECE8`/`#F0EFEB` on `#F7F8F3`), and their text is `#999892`–`#9A9B96` at 2.5–2.6:1 against 17.6:1 for the title (M). The card fills are 100 % flat, so they look like opaque tints rather than alpha (I). One accent survives at full chroma, e.g. the orange dot `#FF7417` in 010 and green code `#358D34` in 112 (M). Context text is set at a 3.1–3.3 %H cap, 0.41× the title (M). Size and fade together carry the hierarchy.

**D — dark marketplace card (rep. 094, 116).** Ground `#191919`, margin 81 px = 6.8 %W / 12.9 %H (M). Title `#FCFCFC` cap 60 px = 9.5 %H, pitch about 90 px. The category word ("Automation") is the same size in `#797875`, contrast 17.1 vs 4.0:1 (M). The footer lockup is bottom-left with a 40 px cap. A pastel letter tile (`#DDD6BC`, `#CFDBCF`, ≈100×90 px) sits top-right (M).

**E — logo lockup (rep. 053, 033, 084).** Ground `#F7F8F3`/`#F7F7F4`. The group is centred at x 47–53 %, y 49–52 % (M). Group height is 16.2 %H (174 px of 1075) in 4 of 6 cases (M). Cursor mark 14–18 %H, "+" 8 %H, gaps 85–100 px ≈ 4.5 %W (M). 046 uses a 3 px vertical rule instead of "+" (M). The partner logo keeps its own brand colour (Jira `#1D4D8F`) (M). Ink 1.6–3.0 % (M).

**F — CursorBench scatter (rep. 016, 047, 011).** Ground `#FFFFFF`, with one inverted variant on `#000000` (011) (M). Margins 4–14 %W (M). No headline. Axis title and tick labels are `#606060` (6.3:1) at a 1.8–2.0 %H cap (M). Gridlines are about 2 px `#E7E7E7` (M). Series lines are about 4 px (0.35 %H) in a light tint (opus `#9CD0E5`), and the named point is a full-chroma dot (`#02A8EA`) with a coloured label (M). There are 6–8 series, each with its own hue, and the featured model is not otherwise emphasised (O). Ink 1.4–2.8 % (M).

**G — headline data figure (rep. 113, 050, 105).** White ground. A left-aligned headline at x 80–84 px (4 %W), y 96–98, with a 2.3–2.9 %H cap, 65 px pitch, weight bold (O) and ink `#292821` (M). Subhead/axis `#767571` (4.6:1) (M). The "us" series is solid orange `#F54E00` and every comparison is `#E9E9E8` grey (1.2:1) (M, 113). The highlighted category label switches to `#26251E` bold (M). Gridlines are hairline `#E9E9E8`, and the baseline is a dashed reference rule (O). Ink 2.6–11 % (34 % for the bar-heavy 050) (M).

**H — abstract line art (rep. 060, 097, 106).** Zero text, no logo (O). 8/12 on `#ECEDE8`–`#F0EFEA`. 4/12 on deep tinted darks: `#03322C`, `#2F1826`, `#2E2400` and `#161614` (M). There is one hue per card, and ink is 2.4–6.4 % (M). Strokes are 1–2 px hairlines in fields, grids or contours (O).

**I — window on landscape (rep. 098, 044).** A product window fills a median of about 91 % of width (probe `framing`; IQR 87.9–94.5 %, n = 19 after dropping 3 weak-edge reads) (M). It bleeds off top/left and leaves a 4.8 %W right / 7.5 %H bottom strip of painted landscape (098, M). The painting is always the same family: blue sky `#4A84AA`, green/olive hills, orange glow (M, corner samples). UI text stays at native scale, with a cap of 1.2–1.9 %H (M), so it is unreadable at feed size by design (I). 21 of the 52 video posters (40 %) fall here (O).

**J — flat UI (rep. 021, 120).** Components are enlarged to a 3.2–3.4 %H cap (021) and floated on `#EEEBE4`. The panel is `#F7F8F3` with a soft shadow about 60 px deep (`#E9E6DF` under the panel) (M).

**K — code (009, 073, 095).** Monospace (O), syntax-coloured: teal `#1C616C` on `#F5F6F0` (095) and violet/green on `#15120B` (009). Cap 2.7–5.2 %H. 073 bleeds off the right edge (M).

## 3. The system

**Invariants (n = 119).**
- The ground is one warm neutral per image. There are no gradients except the landscape painting (I) and 4 product gradients (I′) (O).
- Ink is warm near-black, never `#000` on light grounds. The secondary ink sits at about 3:1 and the tertiary ("faded") at about 2.5:1 (M).
- There is at most one chromatic accent per image (O).
- Margins are about 4 %W on 2048 canvases (M).
- No drop shadows on type, no outlines, no emoji, no stickers (O).
- The Cursor mark or wordmark appears in only 19 of 119 images: 4 B, 7 E, 3 D, 3 A, 1 C, 1 K (O). The mark is never used as a watermark on charts or UI.

**Varies.** Ground temperature (`#FFFFFF` ↔ `#EDECE8`). Light/dark: 12/119 dark (M). Canvas aspect for posted images.

**Post type → archetype (O, from manifest text).**

| Post type | Archetype | Evidence |
|---|---|---|
| "X available in Cursor" (model) | F | 10/10 availability posts; own/partner-trained models get a benchmark table (045, 079) |
| Research / engineering result | G image, plus an H link card to the blog | i+c pairs 014/015, 036/037, 042/043, 050/051, 090/091, 105/106 |
| Feature launch | Video; poster is A (opener) or I/J (UI) | most v posts |
| Changelog link | B | 023, 034, 068, 070 |
| Partner / integration | E (mostly c) | 033, 046, 053, 078, 084, 104 |
| Marketplace template / docs | D | 074, 094, 116 |
| Customer story, event, lifestyle | L | 012, 017, 048, 055 |

**UNKNOWN:** the typeface (a neo-grotesque by eye; cap ratio not recoverable), the source resolution of video posters (X serves 1200 px), and whether C-card fades are alpha over the ground or pre-mixed fills (they are indistinguishable on a flat ground).

## 4. Five transferable principles (at feed scale ≈ 0.25×)

1. **A title-only frame survives shrinking because it has nothing to compete with.** A 6.1 %H cap on 2048×1075 is 66 px, which renders at about 16 px in the feed (I, 0.247×). At 1–5 % ink the eye has a single target.
2. **Use colour, not size, for title vs subtitle.** Same cap, about 14:1 vs 3:1 contrast. The block stays one size, so at 20 % scale it reads as one unit with one line louder. Two sizes would read as two objects.
3. **Fade the context to about 2.5:1 and keep one full-chroma detail.** Real product UI becomes texture that says "this is a real product" without competing with the title. The single saturated dot or code line gives the eye a second stop.
4. **Highlight one series, grey the rest.** Orange vs `#E9E9E8` reads as "ours vs everyone" from the thumbnail alone. Benchmarks can then drop the headline, because the post text carries the number.
5. **Pick the archetype by post type.** Followers learn lockup = partner, scatter = model, line art = blog. The format becomes the headline, and production becomes a template fill.

## 5. Brand-specific: do not copy

- The **warm off-white `#F7F8F3`/`#EDECE8` + orange `#F54E00`** pairing. Agenta must derive its own ground and accent from its palette (shoot-still backdrops and the agenta-social-graphics skill).
- The **landscape-painting backdrop** (blue sky, green hills, orange glow) behind product windows. It is Cursor's single most recognisable asset.
- The **cube mark**, the "CURSOR Marketplace" footer and the pastel letter tiles on D cards.
- **CursorBench** naming and the cost-vs-score chart *form* as a recurring model-launch asset. Agenta can own an eval chart, but not this exact layout of downward-sloping coloured frontiers with labelled points.
- The specific **generative line-art** motifs (contour fields, radial bursts, wave bundles) on H cards. Borrow "text-free art card for blog links", not the motif.
- The **dark `#191919` marketplace card** layout with a top-right letter tile.
