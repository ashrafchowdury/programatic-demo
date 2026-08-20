# Typography, colour, UI treatment and framing

---

## Typography

### What was measured

All figures are true 2D bounding boxes at full resolution (no axis averaging),
so they are absolute, not relative. MEASURED.

| Quantity | Film A | Film B |
| --- | --- | --- |
| Cap height (single capital) | 52–54 px | 51 px |
| Ascender→descender (whole line) | 66 px | 65–66 px |
| Line pitch (baseline to baseline) | **86 px** | n/a (all cards are 1 line) |
| Widest line | 1492 px = **77.7 %** of frame | 1326 px = 69.1 % |
| Alignment | centred, both axes | centred, both axes |
| Weight | regular (400–450) | regular (400–450) |
| Case | sentence case | sentence case |
| Lines per card | 1–3 | 1 |
| Words per card | 6–14 | 2–7 |

**Both films use the same type size.** Cap height 51–54 px and
ascender-to-descender 66 px are identical across a black card in Film A, a
white card in Film B, and Film A's logo card. One scale, three grounds.

### The size question — a correction worth making

`src/lib/intro.ts:455` sets `FULLBLEED_HEADLINE_SIZE = 64` with
`FULLBLEED_LINE_HEIGHT = 1.35`. That product is `86.4 px`, which reproduces
the measured 86 px pitch **exactly**.

But 64 px in a typical neo-grotesque (cap ratio ≈ 0.72) renders a cap height of
**46 px**, and the reference measures **52–54 px**. Reproducing the pitch does
not mean reproducing the size.

The reference is better described as **≈ 72 px at a 1.20 line-height**
(72 × 0.72 = 52 px cap; 72 × 1.20 = 86 px pitch). INFERRED — the exact split
depends on the typeface's cap ratio, which is UNKNOWN.

**The robust spec is metric, not nominal:**

```
cap height        52 px   (at 1920×1080)
line pitch        86 px
asc→desc          66 px
max column width  78 % of frame width
```

Set `font-size` so that *your* face renders a 52 px cap, then set
`line-height` so the pitch lands at 86 px. Two different faces will need two
different `font-size` values to hit the same film.

This does not invalidate the current constants — 64/1.35 gives the right
rhythm and the right column. It means our type currently renders **~12 %
smaller** than the reference at the same line spacing.

### Typeface

OBSERVED: a neo-grotesque sans — closed apertures, horizontal terminals on
`C`/`S`, straight-legged `R`, double-storey `a` and `g`, near-circular `o`.
Consistent with Helvetica Now / Inter / Söhne. The exact family is **UNKNOWN**
and cannot be recovered from a 736 kbps raster with confidence.

Letter-spacing is visually neutral — no tracking on either film's cards.
Our `FULLBLEED_LETTER_SPACING = "0em"` is right.

### Line breaking is BALANCED, not greedy

MEASURED, per-line x extents on Film A's multi-line cards, against the 78 %
column (1498 px at 1920):

| Card | line 1 | line 2 | line 3 |
| --- | --- | --- | --- |
| card 2 (2 lines) | 1026 px · 68.5 % of column | **1216 px · 81.2 %** | — |
| card 4 (3 lines) | 813 px · 54.3 % | 777 px · 51.9 % | 703 px · 46.9 % |
| card 10 (3 lines) | 785 px · 52.4 % | 910 px · 60.8 % | 923 px · 61.6 % |

Two things follow, and the second is conclusive:

1. **No line fills its column.** Card 4 breaks at 54 % of the available width
   when it could run to 100 %. Greedy wrapping never does that.
2. **Card 2's line 2 is wider than its line 1.** Greedy filling is
   *mathematically incapable* of producing that — it always makes earlier lines
   the longest. So the reference is either hand-breaking its copy or balancing
   it.

For implementation the two are equivalent, and balancing is the one that
survives a copy edit. INFERRED: `text-wrap: balance`, or an authored break.

This matters more than it looks. Greedy wrapping at the corrected 72 px type
size left `feeds.` alone on its own line in our own reel — the one break the
reference never makes. `text-wrap: balance` on the full-bleed headline fixes
that class of break for all copy instead of for one sentence.

### Column and centring

Film A's longest single line occupies **77.7 %** of frame width, matching
`COLUMN_FRAC_FLAT = 0.78` (`src/lib/intro.ts:294`). MEASURED, and an exact
confirmation of an existing constant.

Multi-line blocks are centred on the frame's vertical midpoint: Film A's
3-line cards put the middle line's band at y 520–559 and y 521–559, i.e.
centred on **y = 540**, dead centre. MEASURED. 2-line and 1-line cards are
centred the same way, so a card's block always straddles the midline
regardless of line count.

---

## Colour

MEASURED, 6×6 pixel averages.

### Film A

| Element | Hex | Note |
| --- | --- | --- |
| Title / outro card ground | `#EDECE5` | warm off-white, not `#FFF` |
| Title card headline ink | near-black | |
| Title card subhead ink | mid grey ≈ `#8A8A85` | ~55 % of headline contrast |
| Text card ground | `#0A0A0A` | one step off black |
| Text card ink | `#EBECE9` | warm off-white, **not** `#FFF` |
| Recap card ground | **`#16120D`** | distinctly **warmer** than the text cards |
| Footage page background | `#F8F8FA` | the product's own, untouched |

The recap ground being `#16120D` rather than `#0A0A0A` answers an open question
left in `docs/design/reels/fullbleed.md` ("recap ground warmth"): **yes, the
recap card is warmer**, by roughly +12 R / +8 G / +3 B. It reads as a
deliberate shift into a closing, softer register.

Our `DARK_GROUND = "#08080a"` is very slightly *cooler* than the measured
`#0A0A0A`; `FULLBLEED_INK = "#e9ebe6"` versus measured `#EBECE9` is two levels
off. Both are within encoder noise — no change needed.

### Film B

| Element | Hex | Note |
| --- | --- | --- |
| White card ground | `#FFFFFF` | **pure white**, unlike Film A |
| Warm-grey card / component ground | `#E6E4E0` | the "stage" for isolated components |
| Black card ground | `#0A0A0A` | same as Film A |
| Backdrop, app shot | gradient `#A06EEE` → `#6B38BB` | vivid purple, diagonal |
| Backdrop, outro | `#C39DF9` | lighter purple, same family |
| Chip (neutral) | fill `#E5E5E5` | e.g. `＋ New` |
| Chip (accent) | fill ≈ `#F0E8FD`, ink ≈ `#9B4DFF` | e.g. `⑂ Merge` |

**Film B runs four grounds** — white, warm grey, black, purple — where Film A
runs three (warm off-white, black, warm black). The
`.agents/skills/intro-reel/SKILL.md` rule *"pick a tonal strategy and hold it…
mixing them does not work"* is contradicted by Film B, which mixes freely and
works. The reconciliation: Film B's grounds are **assigned by role**, not
chosen per card —

| Ground | Role |
| --- | --- |
| white | the narration voice — every sentence that states a capability |
| warm grey | the workbench — every isolated component performing an action |
| black | the third-party register — CI and deploy vendors |
| purple | brand — the framed app shot and the logo |

A viewer learns the mapping in the first 20 seconds. That is a system, not
mixing. See [04-design-system.md](./04-design-system.md#3-ground-as-role).

---

## UI treatment

### Two completely different strategies

**Film A — one large recording, transformed.**

Evidence:

- The footage reaches x = 0 and x = 1916 with the product's own page colour
  `#F8F8FA` at both edges (MEASURED, shot 7). No letterbox, no margin, no
  rounded corner, no shadow, no backdrop.
- Different shots sit at visibly different zoom levels but each shot's framing
  is **static for its whole duration**.
- Real browser chrome artifacts survive: a text caret blinks during typing
  (shot 9), and shot 5 opens on 2 frames of unpainted `#FAFAFA`.

Conclusion: **A. One large screen recording being cropped and scaled**, one
fixed framing per shot. This is exactly what `look: "fullbleed"` implements.

**Film B — individual components, composited.**

Evidence:

- Shots 6, 8, 11, 12 and 13 show a *single* UI element — a text input, one
  button, a diff hunk, a context menu, a "Ready to Merge" card — floating on
  flat `#E6E4E0` with **nothing else on screen**. No page, no nav, no
  scrollbar, no window edge. A real screen recording cannot produce this by
  cropping, because cropping would bring neighbouring pixels with it.
- Shot 4's chip `[＋ New]` is **inside a sentence**, sharing a baseline with
  the type, and it **morphs** from `[＋]` to `[＋ New]` over ~9 frames.
- Shot 14's chip **swaps** `[Buildkite]` → `[Depot]` in place with no cut.
- Yet shot 9 is unmistakably a real app screenshot in a window on a backdrop.

Conclusion: **B for most shots, A for one.** Film B composites isolated
components and animates them as first-class layers, and drops in exactly one
whole-app shot (shot 9) to establish that the components belong to a real
product. INFERRED, but the isolated-component shots have no alternative
explanation.

This is the same conclusion `docs/design/reels/fullbleed-gap-analysis.md`
reached as fix **F6 (component isolation)** — Film B is what F6 looks like when
it is the whole design language rather than a fix.

### Framed window geometry (Film B, shot 9)

MEASURED at f400 (settled):

| Property | Value |
| --- | --- |
| Window width | 1651 px = **86.0 %** of frame |
| Window height | 941 px = **87.1 %** of frame |
| Left / right margin | 145 / 125 px |
| Top / bottom margin | 63 / 77 px |
| Centre | (970, 533) — within ~10 px of frame centre |
| Corner radius | ≈ 20–24 px (OBSERVED, not precisely measurable) |
| Shadow | soft, large-radius, low-opacity, no visible offset |
| Chrome | **none** — no titlebar, no traffic lights |
| Backdrop | purple gradient, diagonal |

86 % is `WINDOW_FIT = 0.86` (`src/lib/window.ts:26`) to three significant
figures. Our framed look already has the right proportion.

The one difference: the reference window carries **no macOS chrome**. Our
`WindowFrame` renders a 38 px titlebar (`CHROME_H`). The reference gets the
"this is an app" read purely from the radius, the shadow and the backdrop.

### Zoom range

| Film | Shot | Effective zoom |
| --- | --- | --- |
| A | footage shots | ~1.0–1.6× (component fills 84–93 % of frame width) |
| B | shots 1, 3 | ~4–5× (a single nav item fills the frame) |
| B | shot 5 (chip punch) | **7.8×** |
| B | shot 9 | 1.0× (whole app, no zoom) |

Film B's extremes are far beyond the ~1.74× sharpness ceiling noted in
`.agents/skills/intro-reel/SKILL.md`. That ceiling is a property of capturing
at 1× and scaling up. Film B's close-ups are sharp at 5–8×, which is only
possible if those elements were **rendered at that size**, not scaled from a
1920-wide capture. Further evidence for the composited-component reading.

---

## Cursor

| Property | Film A | Film B |
| --- | --- | --- |
| Present | **no visible pointer** in any shot | yes, in every component shot |
| Shape | — | **hand / pointing finger**, black outline, white fill |
| Scale under zoom | — | scales with the shot, but sub-linearly |
| Click indicator | — | no ripple; the *button* responds (press state) |
| Typing indicator | text caret only (shot 9) | text caret + character-by-character entry |
| Keyboard indicator | **keycap HUD `⌥⏎`**, black pill, bottom-centre | none |

Film A is **keyboard-first**: it shows a keycap HUD and never a pointer. Film B
is **pointer-first**: a hand cursor drives every interaction and there is no
keycap.

Neither film uses a click ripple. The feedback is always the real UI's own
press/hover state. Our `src/Cursor.tsx` draws a ripple
(`RIPPLE_D = 22`, `RIPPLE_S = 0.35`) that neither reference has. It is a
synthetic tell.

Film B's cursor also **leads the beat**: it begins travelling toward the chip
at f180 and the click lands at f186–189. Six frames of anticipation.
MEASURED.

---

## Composition and visual hierarchy

### Cards

```
┌──────────────────────────────────────────────┐
│                                              │  ~40 % negative space above
│                                              │
│        ████████ ███████ ██ ████ ████         │  ← block straddles y=540
│        ██████ ███████ ██ ████████            │     max 78 % of width
│                                              │
│                                              │  ~40 % negative space below
└──────────────────────────────────────────────┘
```

- **Primary focal point:** the sentence. There is nothing else.
- **Secondary:** on chip cards, the chip — carried by fill and, when accented,
  by hue.
- **Negative space:** ~40 % of the frame height above and below the block.
  This is the whole reason the cards read as calm at a 3.2 s beat.
- **Alignment:** optical centre, both axes.
- **Why it works:** with one object in the frame, the eye has no scan path to
  execute. Reading time is the only time. That is what buys a 96-frame card
  the right to exist.

### Footage — Film A

- **Primary:** the one component the card just named. It occupies 84–93 % of
  frame width.
- **Supporting:** whatever page context happens to be around it, deliberately
  *not* cropped away — the Slack composer, the repo picker.
- **Negative space:** the product's own whitespace, unmodified.
- **Why it works:** the frame is filled by real product at real proportions.
  Nothing is staged, so nothing reads as staged.

### Footage — Film B

- **Primary:** a single isolated component, centred, on flat ground.
- **Negative space:** everything else — often 80 % of the frame.
- **Why it works:** the component is the *only* thing that exists, so a
  0.4-second shot is legible. This is what lets Film B run at 31 cuts/min
  without becoming soup.

### Alternation

Film A alternates **dark card ↔ light footage** on every cut, giving a mean
luma delta of ~200 levels at 9 of 11 cuts. The film flashes. That is the
"slam" strategy already named in our SKILL.md.

Film B's cut deltas are far smaller — white card (235) to warm grey (210) is
25 levels, grey to purple is ~20. Only the two black cards (f625, f759)
produce a slam. Film B keeps tonal continuity and lets **motion** carry the
cut instead of contrast.

Two valid strategies. Film A: contrast carries the cut, motion is minimal
(24 % moving). Film B: motion carries the cut, contrast is minimal (37 %
moving). **Neither film uses both at once.**
