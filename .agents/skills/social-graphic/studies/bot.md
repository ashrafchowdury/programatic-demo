# @bot (Grok Bot): how the social graphics are built

36 images (23 posted `i`, 7 link cards `c`, 9 video posters `v`). Tags: **O** = OBSERVED, **M** = MEASURED, **I** = INFERRED, **U** = UNKNOWN.
Scripts used: `scratchpad/social-study/bot-work/{px,runs,bbox,radius,shadow,grain,grounds}.py` (pure python + ffmpeg) plus `probe.py` `framing`, `type`, `hist` and `grid`.

## 1. Executive summary

- **One reusable ground plate.** A soft blurred "swoosh" gradient, used pixel-identically across posts: the left strip of 016 matches 035 with a mean |Δlum| of 0.0 (**M**). The same plate is recoloured blue, green, purple and peach (**I**). Grain is negligible, with a 30 px patch σ of 0.7–1.0 lum (**M**).
- **The hero sits dead centre at 53–67 % of the width, with symmetric margins.** L=R to within 1 px on 015, 016, 030, 007, 011, 002 and 004 (**M**). Nothing is placed off-centre except tiles and things that bleed off the edge.
- **Logos carry the message and UI text is texture.** Partner tiles run 25–28 % of canvas height, about 58 px at feed size. Text inside a window has a cap height of only 1.3 % of the canvas, about 3 px at feed size (**M**).
- **Multi-partner posts get tiles; single-partner posts put the partner icon inside a UI card**, sometimes with a logo × logo link card (**O**).
- **One corner and shadow family.** Cards have about 41–55 px corners (2.4–2.6 % of W) whatever their height. Tiles have squircle corners at about 21 % of their side, and pills are fully round. Shadows darken by at most 13 % and fade out within 30–75 px (**M**).

## 2. Archetypes (all 36)

| # | Archetype | n | Ids |
|---|---|---|---|
| A | Phone frame bleeding off one edge (or a screen-only crop) | 10 | 006 013 014 021 022 025 027 028 035 036 |
| B | Desktop app window on the plate (± flanking tiles) | 5 | 007 011 (tiles) · 010 026 031 (bleed, no tiles) |
| C | Floating card stack / single component | 3 | 015 016 030 |
| D | Chat thread with app tiles orbiting it | 2 | 009 018 |
| E | Bare chat with no chrome, on a flat ground | 3 | 005 020 034 |
| F | Wordmark on the plate | 3 | 002 008 019 (one image used 3×, identical md5 at 64×36) |
| G | Logo × logo / wordmark + partner tile | 2 | 004 017 |
| H | Split panel: giant mascot eyes + title | 2 | 012 024 |
| I | Mascot alone (video poster) | 2 | 029 032 |
| — | Singletons | 4 | 001 mascot cluster + email pill · 003 card collage on a grainy rectangle · 023 website bleed · 033 raw third-party app screenshot |

**Canvas** (**M**): 25/36 are about 16:9 (2048×1152/1153, 1920×1080, 1200×675, 1800×1012). Link cards are 1.91:1 (1200×630, 1024×537, 2048×1075). Outliers are 2048×1373 (003, 007), 1080² (004) and two raw screenshots. 028 is 027 cropped to the card ratio (**O**).

## 3. Composition per archetype

### A. Phone frame (10)
- Phone width (**M**): 021 66.8 %, 035 45.9 %, 036 36.5 %, 027 ≈41.5 %, 006 43 %, 025 43.4 % of W. All centred horizontally (offset ≤ 1 %).
- Bleed (**M**): always exactly one edge. When the phone bleeds the bottom, the top margin is 5.2 % (021), 5.6 % (036) or 5.9 % (027). When it bleeds the top, the bottom margin is 8.3 % (035) or 12 % (006). The visible part of the phone is about 39–71 % of its full height (**I**, from the 19.5:9 phone aspect). 013 and 022 drop the bezel and bleed the screen top and bottom, at 63 % and 59 % of W.
- Grounds (**M**): blue plate (#E9F3FE sweep → #80BDFC), green (#B1EDD3 → #D3F5E5), dark purple (#C4A6FC streak on #301E52), flat orange (#FD7612–#FE861E, σ 3.0 grain) and white #FFFFFF (006, 025).
- Type (**M**, cap ÷ canvas H): 035 3.9 %, 021 ≈3.1 % (lowercase ascender 3.3 %), 027 2.2 %, 036 1.9 %.
- Words (**O**): 15–40. The hero is a single interaction: one notification, one sheet, or one ask with its reply.

### B. App window (5)
- With tiles (**M**): 007 window 1226×1145 = 60 % W × 83 % H, margins L411 R412 T114 B115. 011 window 1181×909 = 58 % × 79 %, margins L432 R435 T121 B123. Both are fully contained and dead centre.
- Without tiles (**M**): the window bleeds. 010 bleeds right and bottom with equal 101 px left and top margins. 026 bleeds the bottom (66 % W, top 7.1 %). 031 bleeds left and bottom.
- Window corner (**M**): first-row inset 25–29 px, which is 2.2 % of window height.
- Tiles (**M**). On 007 there are four at 255, 195, 175 and 136 px (18.6 / 14.2 / 12.7 / 9.9 % H, a 1.9× spread, read as depth). On 011 there are three at 289, 307 and 326 px (25–28 % H, 32–36 % of window height). Tiles straddle the window edge: Docs on 011 is 67 % inside the window, Datadog on 007 overlaps by about 4 px. Every tile sits at a different y, and the left-mid / right-top / bottom-right slots repeat (**O**).
- Type (**M**): bubble cap 18 px on 1373 = 1.3 % H, pitch 2.7 %. Not readable at feed size; the bubbles read only as shapes.
- Words (**O**): 70–80.

### C. Card stack (3)
- Box (**M**). 015: stack 1000×456 = 53 % W × 46 % H, margins L440 R440 T272 B272. 016: one card 1335×213 = 65 % × 18.5 %, L357 R356 T470 B469. 030: stack 1207×886 = 59 % × 77 %, L421 R420 T135 B131.
- Composition (**O**). Top card is dark #1C1C1C/#3D3D3D and holds the partner's icon, name and a one-line description (the integration "connector row"). Below it sits a white card with the outcome: "Autofill password ✓", or an approval with Allow/Deny. Gap (**M**) 32 px (3.2 % H) on 015, 49 px (4.3 % H) on 030.
- Corners (**M**). Dark cards 41–45 px; white cards 50–54 px (016, 030); 015's white card is a pill at 104 px, 48 % of its 215 px height. The radius stays in absolute px whatever the card height (a 203 px card and a 646 px card both sit at about 41–54 px).
- Shadow (**M**, darkening below the card versus clean ground). 015: −10.7 lum at 7 px, −3.5 at 25, under 1 by 45 px. 016: −24 at 7 px, gone by about 75 px. 030: about −31 at 6 px, about −2 at 61. Above-edge darkening is only −2.7, so the light comes from above with a downward offset (**I**).
- Type (**M**): cap 3.4 % (015), 2.9 % (016), 3.6 % (030). These are the only UI-text archetypes that read at feed size.
- Words (**O**): 10 (016), 14 (015), 29 (030).

### D. Chat + tile orbit (2)
- 009 and 018 are one template (**M**). The user bubble sits at exactly x 855–1623, y 289–428 in both. The bubble block spans x 425–1623 and y 289–863, centred at (50 %, 50 %).
- Bubbles (**M**). User bubble is black, right-aligned, 37.5 % W, corner ≈30–35 px (22 % of 140 px). Replies are grey #EDEDED and left-aligned. Cap 25 px = 2.2 % H on a 51 px pitch.
- Tiles (**M**). 6–7 tiles, base size 289–292 px (25 % H). Scale varies 216–362 px, 0.75–1.25× the base. 3–4 tiles bleed off the left, right, top and bottom edges by 5–28 % of their size (Amex about 73 px, Salesforce 57 px, the spiral tile 82 px). Slot centres in 009 and 018 agree within ±6 % (**M**). Ground is flat #FCFCFC with σ 0 (**M**).
- Logos (**O**): full-colour brand tiles (Amex, Schwab, Wells Fargo) or white tiles with a coloured mark.
- Words (**O**): about 50.

### E. Bare chat (3)
- 020 (**M**): hero x 462–1602 and y 121–990, 56 % W × 75 % H, centred within 0.4 %. Ground is #FCFCFC. An orange pointer sits on the primary button (**O**). Cap 1.65 % H.
- 005: a navy #074181 bubble on #FFFFFF (**M**). 034: dark-mode chat screenshot (**O**). Words: 20–60.

### F/G. Wordmark and logo pairs (5)
- 002 (**M**): lockup 786 px = 40.9 % W, margins L567 R568, centred at y 540. Mark 148 px (13.7 % H). Cap "B" 110 px = 10.2 % H, so mark ÷ cap = 1.35. Plate stops: #E9F3FE sweep, #D4E8FE, #80BDFC base, #47A0FE streak edge.
- 004 (**M**): two 200 px tiles (18.5 %) with a × between them (stroke about 10 px = 0.9 % H). Lockup 53 % W, margins L252 R254, on #000000. Tile corner 43 px first-row inset = 21.6 % of the side. The partner logo sits on a dark tile, not a white one (**O**).
- 017 (**M**): wordmark left at a 10 % margin, Teams tile right with a 10.1 % margin. Tile 232 px = 37 % H, 2.4× the mark. Dark charcoal plate #131313–#535353.

### H. Split panel (2)
- (**M**) Split at x = 42.0 % in both. Left is #FF5766 or #161616, right is #520D14 or #000000: two tints of one hue. Eyes are 25–28 % H. Title starts about 6.6 % W after the split. Cap ≈8.4–9.0 % H on a 12.4–13.4 % pitch, two to three lines. 4–5 words. Used for enterprise and vertical launches.

## 4. Feed-size check

At 20 %, a 2048×1152 canvas shows at about 410×230. Cap height at that size (**M** × 0.2):

| Element | Cap % H | Cap px at 20 % | Reads? (**I**, ≥5 px) |
|---|---|---|---|
| Wordmark / split title | 9–10.2 | 21–24 | yes |
| Card-stack headline | 2.9–3.6 | 6.7–8.3 | yes |
| Phone UI | 1.9–3.9 | 4.4–9 | mixed |
| Orbit bubbles | 2.2 | 5.0 | borderline |
| Bare chat / window | 1.3–1.65 | 3–3.8 | no, reads as texture |
| Partner tile (side) | 25 | 58 | logo is fully legible |

## 5. The system

**Invariants** (**M** unless tagged)
1. The hero is horizontally centred (≤1 % offset) and occupies 53–67 % W.
2. Elements either have symmetric margins or bleed off exactly one or two edges. Nothing floats off-centre except tiles.
3. There are three grounds: the swoosh plate (σ ≤ 1), flat near-white #FCFCFC/#FFFFFF, or flat black. No photography.
4. Black is the user's colour: the user bubble and primary buttons are #000 or #060606. Bot replies are light grey (**O**).
5. Tile corners about 21 % of the side; card corners about 2.5 % of W; pills fully round.
6. Shadows: max −11 to −31 lum, gone by 30 px (tiles) and 45–75 px (cards).

**Varies:** plate hue (blue, green, purple, peach, orange), device type (phone, desktop, none), tile count (0–7), and canvas ratio (16:9 posts, 1.91:1 cards).

**Post type → archetype** (**O**, from the manifest text)

| Post type | Archetype |
|---|---|
| Multi-partner integration (finance, sales, Google, dev tools) | D tile orbit, or B window + flanking tiles |
| Single-partner integration (1Password, Teams, Stripe, Shopify) | C card stack with the partner icon in the dark card; link card G (logo × logo) |
| Capability ("can now talk / voice notes / switch accounts") | A phone, or E bare chat |
| Enterprise / segment launch | H split panel; F wordmark card for "templates" |
| QoL / UI refresh | B window bleeding off the edge, or A phone |
| Availability / platform | F wordmark, A Android phone, I mascot |

**UNKNOWN:** the typeface (glyphs look like a neo-grotesque UI face, so specify by cap height), whether the plate is rendered or blurred art, the source resolution before X capped it at 2048 wide, and how the videos move after their first frame.

## 6. Five transferable principles

1. **Own one ground.** A single plate reused pixel-for-pixel makes the account recognisable in the feed before any logo resolves. Recolour it per post; don't redesign it.
2. **Centre the hero at about 55–65 % width with mirrored margins.** That removes per-post layout decisions, and the 20–23 % margins survive both the 16:9 post crop and the 1.91:1 card crop.
3. **Let logos and shapes carry the message at feed size.** Partner tiles at about 25 % H are 58 px when shrunk. UI copy at 1.3–2 % H is texture that rewards a tap, not text that has to be read. Keep the one readable line (cap ≥ 2.9 % H) in a floating card.
4. **Bleed to say "there's more."** Phones and windows run off one edge with a 5–6 % margin on the opposite edge. Edge tiles bleed 5–28 %. Bleeding enlarges the hero without shrinking the margins on the other sides.
5. **One geometry family: radius, shadow, tile size.** Fixed card corners, about 21 % squircle tiles, and short soft shadows (≤13 % darkening, ≤6.5 % H falloff). Those three settings keep 36 different compositions looking like one brand.

## 7. Do NOT copy (brand-specific)

- The blob mascots: coloured blobs with two slanted white oval "eyes", the giant-eyes split panel (H), and the 10-blob cluster (001).
- The Grok Bot mark (a ball with eye slits) and the wordmark lockup ratio of mark 1.35× cap.
- The blue swoosh plate (#E9F3FE / #80BDFC / #47A0FE) and its exact sweep shape. Agenta needs its own plate and hue set.
- The 009/018 tile-slot template and the specific bank and sales logo sets. Third-party logos need each partner's permission (**I**).
- Black user bubbles on #EDEDED replies, as a literal chat style. Use Agenta's real UI instead.
- The X/xAI marks and the orange pointer motif.
