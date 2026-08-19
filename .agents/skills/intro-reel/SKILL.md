---
name: intro-reel
description: Make a ~15s launch-film intro for a product feature on any platform — title cards that narrate, real product clips that prove, a logo sign-off. Use when asked to create an intro, reel, or launch video for a feature.
metadata:
  tags: remotion, playwright, video, intro, reel
---

# Make an intro reel

**This is one of three features. A reel is cut FROM a demo, so the demo must be
rendered first** (`.agents/skills/shoot-demo-video/SKILL.md`). A still image of
part of the screen is a *still* (`.agents/skills/shoot-still/SKILL.md`). See the
table in `AGENTS.md`.

A reel is **cards + clips**: title cards narrate in a few words what the next
clip is about to show, the clip proves it, a logo signs off. ~15s, 6-ish beats.

```
card → card → card → CLIP → card(dark) → logo      reels/<name>.ts
light narration        proof   payoff     sign-off
```

Build it in this order. Do not skip the script.

## 1. Script first

Write every card before shooting anything. Per card:

- **One claim.** Active verb, concrete noun. Specific beats adjectives. No hype
  ("revolutionary", "game-changer", "seamless").
- **Match the footage.** Never claim what the clip contradicts — copy that says
  "no mouse" over a clip that clicks a menu reads as a lie. Write the card to
  what the pointer actually does.
- **4–6 words.** Cards are read in ~1.5s. Highlight the hero word/glyph with
  `==markup==`; headlines are normal weight, so emphasis has to be marked.
- Card before a clip = what it shows. Card after = the payoff it earned.

## 2. Shoot the clips

A clip is a **flow** driving the real product on the live platform — camera is
derived from the clicks, never hand-authored.

- `flows/<name>.ts` + `<name>.selectors.ts`. Target by role/text/placeholder,
  never generated ids. Verify with `record:live <name> --check` before shooting.
- **`prepare` must reset to a clean pre-demo state AND verify it — then fail
  loud.** Leftover state (an old row, stale text) silently wrecks the story. A
  `prepare` that reports success over a dirty state is worse than a crash.
- Enter the clip **on the action**; end it **before the camera pulls back**.
- Shoot beats are deterministic — a re-shoot lands within ~0.03s, so tuned clip
  ranges survive re-shooting.

Camera controls (opt-in, per beat), only when the default auto-zoom is wrong:

| Need | Control |
| --- | --- |
| Crop tight on a WIDE target (auto-zoom pulls back from it) | `zoomScale` |
| A slow, felt pointer move | `travelMs` |
| Dwell on a row before clicking | `hoverMs` |
| Hover a row without clicking (browse) | `focus` step |
| Frame X while the click hits Y | `frame` |
| Life inside a long static hold | `drift` |

### Choreography — the cursor's path is the clip

The life of a clip is where the pointer goes, not just the zoom. Compose the
path like a person deciding, not a script hitting one target:

- **Browse before you commit.** Visit a row, hover it, then move to the one you
  act on — `focus` hovers without clicking, `hoverMs` dwells before a real
  click. A pointer that darts straight to the answer reads as automated.
- **Slow the hops.** `travelMs` draws each short move out so the motion is felt;
  the default dart is too fast to read as intent.
- **Keep the whole interaction in ONE zoom cluster.** Same `cluster` id, and
  `zoomScale` on EVERY beat in it — miss one and the camera relaxes back out
  between rows. The zoom arrives WITH the first move (a `focus` places the
  keyframe as the pointer climbs), so it reads "act, then zoom in on the cursor"
  rather than a cut to a pre-zoomed frame.
- A menu interaction is a chain: open → hover A → move to B and click → (submenu
  opens) → move to C and click. Each hop is a slow move plus a dwell, and the
  chain ends on the last click, before the camera trails back.

## 3. Cut the reel

- **Backgrounds match the product.** `light` for a light-theme app, `plain`
  (dark) for the sign-off. This is measured, not taste: a dark card over light
  footage makes every cut a ~157-level luma slam; a light card lands it at ~50.
  Keep one dark passage before the close for punctuation.
- **Cut on motion**, not stillness — the picture should be moving on both sides
  of a cut. A cut onto a frozen card reads as the film stalling.
- Cards: `background`, `headline` (with markup), `wordmark`, `holdS`, optional
  `chip` (a live control the camera punches into) or `logo` (brand sign-off).
- Logo sign-off: extract the brand mark to a **transparent** PNG (colour-key the
  dark bg), `logo: true`, horizontal lockup, wordmark writes in.

## 4. Verify against a reference

Measure, don't eyeball. Against a reference launch film, compare: **% moving
frames**, **cut luma delta**, **mean shot length**, **longest frozen run**. Pull
frames with ffprobe and look. Fix the gap, re-measure.

## Commands

```
pnpm capture:session          # once — auth the live platform (headed)
pnpm record:live <flow>       # shoot   → recordings + clicks.json
pnpm convert <flow>           # webm → public/<flow>.mp4
pnpm render <flow>            # → out/demo/<flow>.mp4
pnpm reel <flow>              # cut cards+clips → out/reel/<flow>.mp4
```

Cards author as JSON or TS (`intros/<name>.json` | reel cards). Markup:
`*bold*` `_italic_` `==highlight==` `==word|#hex==` `{chip}`.

## Gotchas

- **Sharpness ceiling.** The recording is ~1920px; cropping tighter than ~1.74×
  upscales and softens text. "As tight as stays sharp", not tighter.
- **Cache invalidation.** A re-shoot must re-hash the footage into the clip
  cache, or you cut the old footage under the new spec.
- **Clip length.** A clip earns its seconds with action. Trim menu-read holds
  and post-click dead air; keep the beats that move.
