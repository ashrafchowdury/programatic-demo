# Remotion + Playwright implementation mapping

How each finding becomes code in this repo, and which side of the
Playwright/Remotion line it belongs on.

---

## 1. Responsibility split

The reference films imply a sharper division than we currently draw.

### Playwright should produce

| Output | Why Playwright |
| --- | --- |
| Raw footage of real flows | Only a real browser produces real product pixels |
| Click / type / key event log with timestamps | The camera and cursor tracks are derived from it |
| Element bounding rects at interaction time | Framing must be derived from geometry, not guessed |
| Deterministic app state (seeded data, settled async) | A re-shoot must land in the same place |
| **Isolated component captures** *(new)* | Film B's grammar needs a single element, alone |

### Remotion should produce

| Output | Why Remotion |
| --- | --- |
| Every card, every word reveal | Type must be vector-sharp and frame-exact |
| All camera movement, zoom, crop | Deterministic, re-renderable, no re-shoot |
| The cursor | Drawn at 30 fps from a 25 fps log; scales independently |
| The keycap HUD | Not a real UI element |
| Chip punch | It transforms a card, not footage |
| Scene assembly and timing | Cache-keyed, reproducible |
| Logo lockup and mark tumble | Vector, 3D transform |
| Audio bed and mix | — |

### The line the reference forces us to move

Film B's isolated-component shots (5 of its 17 shots) are neither "footage" nor
"card". They are a **real DOM element, captured alone, then composited by
Remotion as a first-class layer**. Today we have no way to make one: our
recorder always films the whole viewport.

Two candidate mechanisms, in order of cost:

1. **Clip-path in Remotion over full-viewport footage.** Cheap: no capture
   change. Gives a rectangular cut-out of a component on a flat ground. Fails
   as soon as the component has a shadow or a non-rectangular edge, and cannot
   exceed the ~1.74× sharpness ceiling because the pixels are still from a
   1× capture.
2. **A Playwright capture mode that films one element.** `elementHandle` +
   `page.setViewportSize` around the element's rect, or a screenshot sequence
   at high `deviceScaleFactor`. Gives true 5–8× sharpness. Costs a new capture
   path, and (as `fullbleed-gap-analysis.md` §4 already argues) a screenshot
   sequence is not real-time, so app-driven animation will not render
   naturally.

**Recommendation:** build (1) first — it unlocks the composition language at
zero capture cost, and most of Film B's components are rectangular cards and
buttons. Reach for (2) only when a specific shot needs the 5× close-up.

---

## 2. Scene-by-scene Remotion mapping

### LogoCard

```tsx
<AbsoluteFill style={{ background: look.ground }}>
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <LogoMark rotation={tumble(frame)} />        {/* 3D, see below */}
    <Line>{headlineWords.map(w => <Word cue={w} />)}</Line>
    <Line style={{ opacity: shown(subheadStart) ? 1 : 0 }}>{subhead}</Line>
  </AbsoluteFill>
</AbsoluteFill>
```

- Mark tumble: **not** `spring()`. A single decelerating rotation:
  `rotate3d(1, 1, 0, ${360 * cameraEase(t / 0.93)}deg)` over 28 frames, with
  `transformStyle: "preserve-3d"` on a real cube, or a pre-rendered rotation
  if the mark is an SVG. INFERRED from silhouettes.
- Headline words: `interpolate` is wrong here — the reveal is binary. Keep the
  existing `progressAt` + zero-span cue pattern (`src/lib/intro.ts:391`).
- **No exit push.** Logo cards hold still. This is a behavioural difference
  from `SentenceCard` and needs a branch, not a shared default.

### SentenceCard — Film A grammar (`look: "fullbleed"`)

```tsx
<AbsoluteFill style={{ background: DARK_GROUND }}>
  <AbsoluteFill style={{ transform: pushToCss(pushEnvelope(frame, total, spec)) }}>
    <Column maxWidth={width * 0.78}>{words.map(w => <Word cue={w} />)}</Column>
  </AbsoluteFill>
</AbsoluteFill>
```

Already implemented. `pushEnvelope` + `settle` is the correct primitive; the
measured −63 px / 14 f exit is within tolerance of
`CARD_EXIT_DEFAULT = { axis: "x", dist: -72, frames: 13 }`.

Do **not** reach for `spring()`. A Remotion spring overshoots by default and
the reference has zero translational overshoot; `settle` is both cheaper and
correct.

### SentenceCard — Film B grammar (new)

Same tree with `push` omitted entirely. `PushSpec` already supports
`{ axis: "none" }`, so this is a config, not new code — but the *scheduler*
must also drop the mid-reveal trim, because a card that does not move has no
motion to be cut into.

### ChipSentence + ChipPunch

The existing `ChipPunch` (`src/Intro.tsx:589`) has the right structure —
a `1fr auto 1fr` grid so the chip's centre is guaranteed by layout rather than
DOM measurement. Three values need to change to match the reference
(see [06-comparison.md](./06-comparison.md)):

```ts
CHIP_PUNCH_SCALE  4    →  7.8
CHIP_PUNCH_S      0.45 →  0.10   (3 frames)
// and add:
CHIP_CREEP        +5 % over 10 f after arrival
CHIP_RECOVER      −14 % over 5 f, r ≈ 0.62, then cut mid-move
```

At 3 frames the punch **must** run inside `<CameraMotionBlur>` — the reference's
f187/f188 are heavily smeared, and without blur a 1→7.8× jump in 100 ms will
strobe. The existing `samples={4}` is likely too low for a move this fast;
`samples={8–12}` INFERRED.

The chip **morph** (`[＋]` → `[＋ New]`, ~9 f) is a width animation on the pill
with the label's opacity switching binary. New component behaviour.

### ComponentShot (new)

```tsx
<AbsoluteFill style={{ background: "#E6E4E0" }}>
  <div style={{ /* centred, sized to the component's rect */ }}>
    <Video src={footage} style={{ clipPath: `inset(...)`, transform: `scale(k) translate(...)` }} />
  </div>
  <Cursor track={log.cursorTrack} timeS={timeS} />
</AbsoluteFill>
```

Clip-path route. The inset comes from the click log's `rect`, which we already
capture (`ClickEvent.rect`, `src/lib/click-log.ts:6`). **This is the key
insight: we already record everything needed to isolate a component and have
never used it for that.**

### FullBleedClip

Unchanged. `src/DemoClip.tsx:263` already does static crop + push envelope +
optional cursor + keycap. Correct.

### FramedAppShot

Currently static. The reference **scales up 0.894 → 1.0 over 23 frames** on
entry, then freezes for 41. That is the same `settle` curve applied to
`scale` instead of `translate` — `PushMove` already has `axis: "scale"`, so:

```ts
push: { in: { axis: "scale", dist: -0.106, frames: 23 } }
```

Also: drop the titlebar. `WindowFrame`'s `CHROME_H = 38` has no counterpart in
the reference.

### RecapCard

No changes. Measured schedule matches our constants to 1–3 frames.

### Transitions

There is nothing to build. `scripts/reel.ts` concatenating with `-c copy` and
no `xfade` is already exactly right — and now confirmed against a second film.

---

## 3. Which Remotion API for which job

| Job | Use | Not |
| --- | --- | --- |
| Card / clip sequencing | ffmpeg concat of separately-rendered compositions | `<Series>` — would desync the camera and cursor time base (`src/Intro.tsx:373`) |
| Word reveal | `progressAt` on a zero-span cue → boolean | `interpolate()` — there is no ramp to interpolate |
| Entrance / exit | `settle(u)` + `translate3d` | `spring()` — overshoots; reference does not |
| Chip punch | `scale` + `transformOrigin` at the chip, inside `CameraMotionBlur` | `spring()` |
| Camera on footage | static `transform` per shot | any per-frame camera track, for Film A grammar |
| Framed window entrance | `settle` on `scale` | `interpolate` with `Easing.out` — wrong shape |
| Component isolation | `clipPath: inset()` + `transform` | cropping the `<Video>` element |
| Logo mark | `rotate3d` on `preserve-3d` | frame-by-frame sprite |
| Footage | `<Video>` from `@remotion/media` | `<Img>` sequences unless doing high-DSF capture |
| Layer order | cursor and keycap as **siblings outside** the push wrapper | children of it — they'd inherit the card's motion |

---

## 4. Reusable component architecture

Existing components are marked; new ones are proposed.

| Component | Status | Inputs | Behaviour | Defaults |
| --- | --- | --- | --- | --- |
| `<SentenceCard>` | exists (`Intro.tsx`) | `headline`, `subhead?`, `look`, `push?`, `trimInS?` | words binary-reveal @ stagger; optional rise/push | stagger 0.167 s, rise 52 px/13 f, exit −72 px/13 f |
| `<LogoCard>` | partial | `mark`, `wordmark`, `subhead?`, `ground` | mark tumbles 360°/28 f; wordmark writes per char; **no exit motion** | tumble 0.93 s, char stagger 0.06 s |
| `<RecapCard>` | exists | `items[]`, `lockup` | binary reveals @ 16 f | lead 0.17 s, item stagger 0.533 s, hold 1.23 s |
| `<ChipSentence>` | exists (`ChipPunch`) | `text` with `{chip}`, `chip`, `accent?` | grid-centred chip; optional morph | morph 9 f |
| `<ChipPunch>` | exists, needs retune | `from`, `to`, `scale`, `frames` | snap → creep → recover, cut mid-move | **7.8×, 3 f, +5 %/10 f, −14 %/5 f** |
| `<FullBleedClip>` | exists (`DemoClip`) | `clip`, `crop`, `push?`, `cursor?` | static crop; push envelope | crop static, push per shot |
| `<FramedAppShot>` | exists, needs entrance | `clip`, `backdrop`, `fit` | window at 86 %; scale-up entrance; freeze | fit 0.86, entrance 0.894→1.0 / 23 f, **no chrome** |
| `<ComponentShot>` | **new** | `clip`, `rect`, `ground`, `cursor?` | isolate one element on flat ground, centred | ground `#E6E4E0`, pad 80 px |
| `<ZoomTease>` | **new** | `clip`, `rect`, `scale`, `settle?` | extreme crop; may start moving | 4–5×, 12–57 f |
| `<BeatCard>` | **new** | `word`, `ground` | one word, centred, no motion | 31 f |
| `<KeycapHUD>` | exists | `keys[]`, `timeS` | pill in/out on settle | in 0.13 s, out 0.17 s, hold 1.1 s |
| `<Cursor>` | exists, needs variant | `track`, `timeS`, `shape` | follows log; **add `shape: "hand"`; make ripple opt-in** | ripple **off** by default |
| `<SceneTransition>` | **do not build** | — | there are no transitions | — |

`<SceneTransition>`, `<ZoomTransition>`, `<UIReveal>`, `<TextReveal>` from a
generic motion-library checklist are **deliberately absent**. The reference has
no transitions, no reveals with ramps, and no fades. Building them would be
building against the evidence.

---

## 5. Playwright changes implied

| Change | Why | Effort |
| --- | --- | --- |
| Record the element rect for **non-click** beats too | `ComponentShot` needs a rect for elements that are only *shown*, not clicked | small — `boxOf` already exists |
| Emit a `hover` event kind | Film B hovers a chip for 3 f before clicking; we have `hoverMs` but log no event | small |
| Trim leading unpainted frames | Film A's 2-frame `#FAFAFA` flash is a defect we should not reproduce | small — extend clapperboard trim |
| Optional per-element capture at high DSF | true 5–8× close-ups | **large** — new capture path, non-realtime |
| Keep `pressKey` out of the zoom track | already correct (`recorder.ts:199`) | done |

Everything else in `scripts/lib/` is already producing what the reference
grammar needs. The gap is in Remotion and in authoring, not in capture.
