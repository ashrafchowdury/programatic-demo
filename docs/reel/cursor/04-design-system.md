# The extracted motion-design system

What both films agree on, where they deliberately diverge, and the recipe.

---

## 1. Invariants — true in both films

These are the rules to encode once and never re-derive.

### Timing

| Rule | Value | Confidence |
| --- | --- | --- |
| Frame rate | 30 fps, constant | MEASURED |
| Word reveal stagger | **5–6 f (167–200 ms)** | MEASURED, both films |
| Word reveal itself | **binary** — one frame, no fade, no blur | MEASURED |
| Entrance duration | 13–23 f (430–770 ms) | MEASURED |
| Exit duration | 13–14 f (430–470 ms) | MEASURED |
| Settle time constant | **τ ≈ 135–140 ms** (r ≈ 0.78 / frame) | MEASURED |
| Transition duration | **0 f — everything is a hard cut** | MEASURED |

### Motion

| Rule | Value |
| --- | --- |
| Easing | one exponential settle, everywhere. `1 - PUSH_BEZIER(u)` |
| Exits | the entrance curve, time-reversed |
| Overshoot | **none** on translation; ~16 % on the chip punch scale only |
| Rotation | only on the logo mark (~360°, ~28 f, decelerating) |
| Blur | motion blur on fast moves only; **never** on type |
| Opacity | used for nothing except the audio bed's fade-in |

**Opacity is not an animation channel in either film.** Nothing fades. Elements
are present or absent; motion is positional and scalar. This is the single
most counter-intuitive finding and the easiest one to get wrong.

### Composition

| Rule | Value |
| --- | --- |
| Card type: cap height | 52 px at 1920×1080 |
| Card type: line pitch | 86 px |
| Card type: max column | 78 % of frame width |
| Card type: alignment | centred both axes, block straddles y = 540 |
| Card type: line breaking | **balanced, never greedy** — no line fills its column, and a later line may be wider than an earlier one |
| Card type: weight | regular (400–450), sentence case, no tracking |
| Ink on dark | `#EBECE9` on `#0A0A0A` — never pure white on pure black |
| Negative space | ~40 % of frame height above and below a card's block |

### Editing

| Rule | Value |
| --- | --- |
| Dissolves | zero |
| A shot may start already in motion | yes — this replaces the dissolve |
| A shot may be cut while still moving | yes — Film A's card exits accelerate into the cut |
| Logo bookends | do not move; they hold still and hard-cut |

---

## 2. The fork — where the films deliberately differ

Everything above is shared. Everything below is a **choice**, and the two films
choose oppositely on every line. Picking a column and holding it is what makes
either read as authored.

| Axis | **Grammar A — "Proof"** | **Grammar B — "Narration"** |
| --- | --- | --- |
| Job | show that a shipped feature works | introduce a product and its shape |
| Mean shot | 3.66 s | 1.82 s |
| Cut rate | 15 /min | 31 /min |
| Moving frames | 28 % | 55 % |
| **Where motion lives** | on the **cards** (rise in, push out) | on the **shots** (scale-up, push, punch) |
| Cards | rigid 96 f (3.2 s), 1–3 lines | 31–89 f, always 1 line |
| Tail after last word | rigid **62–63 f** | variable 21–47 f |
| Footage | one recording, full-bleed, static crop per shot | isolated components on flat ground + one framed app shot |
| Zoom range | 1.0–1.6× | 1.0–7.8× |
| Input shown | keycap HUD, no pointer | hand cursor, no keycap |
| Cut carried by | **contrast** (~200-level luma slam) | **motion** (shot enters moving) |
| Grounds | 3 (warm off-white, black, warm black) | 4 (white, warm grey, black, purple) |
| Audio | quiet music bed, −31.3 LUFS | none |

**The load-bearing rule: motion lives on exactly one layer.** Film A's shots
never move, so its cards must. Film B's cards never move, so its shots must. A
film that animates both reads as busy; a film that animates neither reads as a
slideshow.

---

## 3. Ground as role

Film B's four grounds are assigned by **function**, learned by the viewer in
the first 20 seconds and never violated:

| Ground | Role | Shots |
| --- | --- | --- |
| `#FFFFFF` | narration — a sentence stating a capability | 2, 4, 10, 16 |
| `#E6E4E0` | workbench — an isolated component performing an action | 6, 7, 8, 11, 12, 13 |
| `#0A0A0A` | third-party register — CI and deploy vendors | 14, 15 |
| purple gradient | brand — the whole app, and the logo | 9, 17 |

This is the generalisation of the "pick a tonal strategy" rule in
`.agents/skills/intro-reel/SKILL.md`. The rule should be **"a ground means
something; never use one for two roles"**, not "use one ground".

---

## 4. Scene graph

### Film A

```
Film A (1920×1080 · 30 fps · 1316 f)
├── Shot 1 · LogoCard "New in Cursor / Agent UX improvements"   f0–97
│   ├── Ground  #EDECE5
│   ├── Mark    cube · 110 px · 360° tumble over 28 f, decelerating
│   ├── Headline  3 words, write-on @ 4 f stagger
│   └── Subhead   fades in ~f14  (no exit motion — holds still to the cut)
│
├── Shot 2 · SentenceCard (dark)                                f98–193
│   ├── Ground  #0A0A0A
│   ├── Block   2 lines · rise +52→0 px over 13 f · settle
│   ├── Words   binary reveal @ 5–6 f stagger
│   └── Exit    translateX 0→−63 px over 14 f · accelerating · CUT MID-MOVE
│
├── Shot 3 · FullBleedClip "Slack subscribe"                    f194–335
│   ├── Video   static crop, no camera move
│   └── (no cursor, no keycap)
│
├── Shots 4–9 · alternating SentenceCard / FullBleedClip        f336–996
│   └── Shot 5 adds KeycapHUD ⌥⏎ (black pill, bottom-centre)
│
├── Shot 10 · SentenceCard (dark, 3 lines)                      f997–1093
│
├── Shot 11 · RecapCard                                         f1094–1203
│   ├── Ground  #16120D  (warmer than the sentence cards)
│   ├── Lockup  mark @ +4 f · wordmark @ +12 f · top-left, x=122 y=136
│   └── Items   4 × binary reveal @ 16 f stagger · hold 40 f
│
└── Shot 12 · LogoCard "New in Cursor / cursor.com/changelog"   f1204–1315
```

### Film B

```
Film B (1920×1080 · 30 fps · 927 f)
├── Shot 1  · ZoomTease  (5× crop of a nav item)                f0–11
├── Shot 2  · SentenceCard (white) "Introducing Code Hosting"   f12–60
├── Shot 3  · ZoomTease  (zooms OUT over first 9 f)             f61–117
│
├── ── Triplet 1 ──────────────────────────────────────────────
│   ├── Shot 4 · ChipSentence "…start a {＋ New} project"       f118–188
│   │   ├── Text   binary reveal @ 6 f stagger
│   │   ├── Chip   morphs [＋] → [＋ New] over ~9 f
│   │   └── Cursor enters at f180, hovers chip at f186
│   ├── Shot 5 · ChipPunch  1.0× → 7.8× in 3 f, hold, pull back f189–207
│   └── Shot 6 · ComponentShot  input + Create Repo, typing     f208–263
│
├── Shot 7  · BeatCard (warm grey) "Or"                         f264–294
├── Shot 8  · ComponentShot  Sync from GitHub button            f295–342
├── Shot 9  · FramedAppShot  window 86 % on purple, scale-up    f343–406
│
├── ── Triplet 2 ──────────────────────────────────────────────
│   ├── Shot 10 · ChipSentence "Review and {⑂ Merge} PRs"       f407–462
│   ├── Shots 11–12 · ComponentShot  diff + context menu        f463–559
│   └── Shot 13 · ComponentShot  Ready to Merge → click         f560–624
│
├── ── Triplet 3 ──────────────────────────────────────────────
│   ├── Shot 14 · ChipSentence (black) "Run CI from {Buildkite→Depot}"  f625–713
│   └── Shot 15 · ChipSentence (black) "Push to deploy with {Vercel}"   f714–758
│
├── Shot 16 · SentenceCard (white) "Git hosting, at agent scale" f759–836
└── Shot 17 · LogoCard  cube tumble + ORIGIN write-on, purple    f837–926
```

---

## 5. Video recipe

Everything needed to reproduce either grammar, in one place.

### Canvas

```
resolution   1920 × 1080  (deliver); render at 2560 × 1440 and downscale
aspect       16:9
fps          30, constant
codec        H.264, high profile
```

### Global motion

```
easing            settle(u) = 1 - cubic-bezier(0.15, 0.9, 0.75, 0.95)(u)
                  → exponential decay, r ≈ 0.78/frame, τ ≈ 137 ms
entrance          13–23 frames
exit              13–14 frames, entrance curve reversed
transition        0 frames — hard cut, always
opacity           not used as an animation channel
overshoot         none, except chip punch scale (~16 %)
motion blur       shutter 180°, on fast moves only; never on type
```

### Typography

```
cap height        52 px      ← set font-size from this, not the other way round
line pitch        86 px
asc→desc          66 px
max column        78 % of frame width  (1498 px)
weight            400–450
case              sentence
tracking          0
alignment         centred both axes; block straddles y = 540
face              neo-grotesque (Helvetica Now / Inter / Söhne class)
```

### Scene system

| Scene type | Duration | Ground | Motion | Exit |
| --- | --- | --- | --- | --- |
| LogoCard | 98–112 f | brand | mark tumbles 360° / 28 f; text writes on @ 4 f | **none** — holds, hard cut |
| SentenceCard (A) | **96 f ± 1** | `#0A0A0A` | rise +52 px / 13 f | translateX −63 px / 14 f, cut mid-move |
| SentenceCard (B) | 31–89 f | white / black | **none** | none |
| ChipSentence | 56–89 f | white / black | chip morph ~9 f | none |
| ChipPunch | 19 f | inherits | 1→7.8× in 3 f, creep +5 % / 10 f, recover −14 % / 5 f | cut mid-move |
| ComponentShot | 41–65 f | `#E6E4E0` | cursor travels, element responds | none |
| FullBleedClip | 95–152 f | product's own | **none** (static crop) | none |
| FramedAppShot | 64 f | backdrop | scale 0.89→1.0 over 23 f | freezes 41 f |
| BeatCard | 31 f | warm grey | none | none |
| RecapCard | 110 f | `#16120D` | lockup +4/+12 f, items @ 16 f | none |

### UI treatment

```
full-bleed   crop + scale one recording; edge to edge; no radius, no shadow
             one framing per shot, never animated
             component fills 84–93 % of frame width

framed       window 86 % × 87 % of frame, centred
             radius ≈ 22 px, soft large-radius shadow, no offset
             NO titlebar / traffic lights
             backdrop: saturated gradient

isolated     single component, centred, on flat #E6E4E0
             nothing else in frame; 80 % negative space
             rendered at final size (not scaled up from a 1× capture)
```

### Cursor

```
shape        hand / pointing finger, black outline, white fill
size         ~90 px tall at 1× (Film B, shot 8)
scale        sub-linear under zoom
travel       arrives 6 frames before the beat it serves
click        NO ripple — the real UI's press state is the feedback
typing       real caret, character-by-character
keyboard     keycap HUD: black pill, white glyphs, bottom-centre
             (use keycap OR cursor, never both in one film)
```

### Camera

```
zoom range        1.0–1.6× for proof footage
                  4–8× for punches and teases (render at size, don't upscale)
pan               not used — the reference never pans a static crop
easing            the settle curve
in-shot moves     allowed at the head of a shot (this is the dissolve replacement)
                  and must finish before the shot's held section
```

### Audio

```
bed          continuous, quiet, −31 LUFS integrated, LRA < 4 LU
fade-in      ~1.8 s from silence at the head
fade-out     none measured
SFX          none separable at this level
             (Film B ships with no audio at all — silence is a valid choice)
```
