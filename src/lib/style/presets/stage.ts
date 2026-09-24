/**
 * STAGE — Replit's launch grammar. One flat ground, and nothing ever cuts.
 *
 * Measured in docs/reel/replit/reference.md. It is the first style here
 * whose defining property is a NEGATIVE: in 42.048 seconds the reference
 * contains ZERO hard cuts. The default detector finds none; dropping the gate
 * to |dLuma| >= 4 surfaces five candidates and every one turns out on a
 * per-frame contact sheet to be a continuous element move. Sections change by
 * the frame EMPTYING to bare ground — measured at f378 (ink 59), f513 (1047)
 * and f589 (3238) — and the next element arriving into the vacancy.
 *
 * We still cut, because segments render independently and are concatenated.
 * The trick is WHERE: a cut that lands on a frame showing nothing but ground
 * is invisible, so `join: "cut"` plus a shot exit big enough to clear frame
 * reproduces the reference's seam. That is why the exit distance here is an
 * order of magnitude larger than any other style's.
 *
 * THE ENVELOPE IS ALREADY OURS. push.ts was reverse-engineered from a CURSOR
 * film and its docstring — arrive decelerating, hold, accelerate away, cut
 * mid-move — describes this reference almost word for word. MEASURED:
 * Replit's entrance decays at r = 0.6451/frame at 24 fps, which resamples to
 * 0.7042 at our 30; PUSH_BEZIER gives 0.694 over 9 frames and 0.741 over 11.
 * Two unrelated launch films share one curve.
 *
 * NO CHIP OR RECAP OF ITS OWN. The reference's inline pill EXPANDS over 5
 * frames (208ms) on the shared 0.645 curve rather than punching, and it has no
 * recap card, so both are the base's. A stage reel using a chip CARD is
 * off-reference.
 */
import { INTER_STACK } from "../base";
import type { StyleOverride } from "../types";

export const stage: StyleOverride = {
  // Cards are FLAT — no backdrop plate — which is what `fullbleed` means on the
  // card side. The shots are still windowed; see `shot.framing`.
  motionLayer: "shots",
  card: {
    // MEASURED: one character every 2 frames at 24 fps. `ink` steps at f854,
    // f856, f858 and again f880-f888, evenly spaced, with no fade between.
    cadence: { kind: "typed", perCharS: 0.0833, fadeS: 0 },
    length: {
      // MEASURED: last character lands at f888 (37.0s), the copy is gone by
      // f903 (37.6s). 0.6s of hold, which is short because the reference's
      // type card is a punctuation mark between two moving sections rather
      // than a beat to read.
      holdS: 0.6,
      holdFrom: "lastWord",
      minS: null,
      maxS: null,
      trimInS: 0,
      // THE FIRST WORD IS ALREADY TYPED WHEN THE CUT LANDS. The reference
      // types into a frame the previous section has already emptied, with no
      // cut in between; we have a cut there, and a typewriter starting from
      // zero put it on bare cream — measured, every stage card's first frame
      // carried no ink at all. Cutting in one word late keeps the typing rate
      // and the hold, and lands the cut on content (audit R10).
      openOn: 1,
    },
    // MEASURED: the type card does not move. All of this film's motion is on
    // the panel layer, which is what `motionLayer: "shots"` records.
    enter: { kind: "none" },
    exit: { kind: "none" },
    // ON, against the other flat-ground styles. The reference's closing card is
    // BUILT around an inline red pill, so dropping emphasis would delete the
    // point of the card.
    emphasis: true,
  },
  shot: {
    // A window, NOT `isolate`: the reference's panel has a corner radius, a
    // soft shadow and the app's own surrounding surface inside it. `isolate`
    // clips to a rect and fills the rest with pageBg, giving a component on a
    // flat mat with no radius and no shadow — measured and rejected, crop.ts.
    // No browser chrome either: the reference shows the app's surface.
    framing: "window",
    // MEASURED at f84: panel box x 140-1148, y 72-676 of 1280x720 = 78.8%
    // wide, 83.9% tall. 0.84 takes the taller of the two, which is what
    // windowFit fits against.
    windowFit: 0.84,
    // MEASURED #FAF6F1 — a WARM cream (R > G > B), sampled at three widely
    // separated flat points and re-confirmed 900 frames later. The cast is the
    // opposite of ledger's #f7fbf3, which is green.
    ground: "#faf6f1",
    // OFF, and this is the difference between a floating panel and a camera
    // hunting a cursor. See ShotStyle.zoom.
    zoom: false,
    cursor: true,
    ripple: false,
    // MEASURED entrance (f314-322): the element grows from a fixed baseline —
    // `hi` pinned at 493 while `lo` rises 337 -> 180 — so this is a SCALE, not
    // a translate. 11 frames per the curve fit above.
    enter: { kind: "push", axis: "scale", dist: -0.2, frames: 11 },
    // MEASURED exit (f368-377): pure translate, span constant at 243-244px,
    // still accelerating on the last frame in shot.
    //
    // THE DISTANCE IS OURS, NOT THE REFERENCE'S, AND THE REASON IS GEOMETRY.
    // The measured cube travels 391px at 720p = 587 design px, but that cube is
    // 243px wide in a 1280 frame — 19% of it. Our panel is `windowFit`, 84%, so
    // the same distance leaves two thirds of it on screen when the cut lands
    // and the seam reads as an ordinary cut. Measured on the first stage render
    // at 620: the panel top was still mid-frame.
    //
    // ⚠️ `dist` IS NOT WHERE THE SHOT ENDS UP. pushOut is
    // `dist * settle(1 - g/frames)` and the last VISIBLE frame is g = frames-1,
    // so at frames=11 the exit reaches settle(1/11) = 0.660 of `dist` before
    // the cut lands. Measured, after a render at 1000 left a third of the panel
    // on screen. A 0.84-fit panel spans y 86..993 of a 1080-tall design frame,
    // so clearing it downward needs 994px of actual travel: 994 / 0.660 = 1506.
    // 1520 gives a little margin.
    //
    // For scale, the reference's own large-panel exit (the popover, f293-302)
    // travels ~807 design px in 0.375s. This is the same gesture sized for a
    // subject that fills 84% of frame instead of 56%.
    exit: { kind: "push", axis: "y", dist: 1520, frames: 11 },
  },
  // MEASURED on the closing card (f891): cap 39px at 720p = 58.5px at 1080p,
  // line width 51.2% of frame, centred on both axes.
  //
  // ⧗ LINE PITCH IS UNMEASURABLE HERE. The reference's only type card is one
  // line and never wraps, so there is no pitch to read. 1.2 is authored.
  type: {
    sizePx: 82,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    fontFamily: INTER_STACK,
  },
  // ONE GROUND, and that is the finding. The reference has no dark register and
  // no accent GROUND anywhere in 42 seconds — #F03000 appears only as the logo
  // mark, the inline pill and the floating annotations, never as a field. So
  // all three keys are the same cream on purpose: a `background: "plate"` card
  // renders identically, because the grammar has nowhere else to go.
  palette: {
    plate: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    plain: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    light: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
  },
  // THE REFERENCE'S SIGNATURE OVERLAY. See AnnotationStyle for the four chips
  // it was measured from and for why ours is not red.
  annotation: {
    fill: "#f0f05a",
    ink: "#0a0a0a",
    heightFrac: 0.073,
    capRatio: 0.58,
    radiusFrac: 0.18,
    wipeS: 0.208,
    oversize: 1.06,
    exitS: 0.16,
  },
  bookend: {
    // MEASURED off the reference's sign-off — see MarkSolo for the frame table
    // and for the part of it we cannot reproduce.
    markSolo: {
      scale: 3.7,
      growS: 0.375,
      holdS: 0.58,
      settleS: 0.71,
      shiftFrac: 0.42,
    },
    // MEASURED: the closing lockup runs 37.7s -> 42.0s = 4.3s, the longest hold
    // in the film, and the two bookends are NOT the same length — opening
    // f0-f72 = 3.0s, closing f906-f1007 = 4.2s.
    //
    // WE DO NOT TAKE 4.3. The reference's bookend is 4.3 seconds of continuous
    // ANIMATION — the mark assembles, then the wordmark writes — so it costs
    // nothing in stillness. Ours writes and then holds, so every extra tenth is
    // a dead frame: two 3.0s bookends were 30% of a 20s film on the first stage
    // cut. But the solo needs room — grow 0.375 + hold 0.58 + settle 0.71 is
    // 1.67s before the lockup even exists. 3.0 matches the opening exactly and
    // gives the closing ~1.3s of settled hold against the reference's 2.2s.
    minS: 3.0,
  },
  // ⧗ The reference has no cuts to vary and its cards do not travel: a section
  // ends by the frame emptying, not by a directional exit. Nothing to carry.
  sequence: {
    exitCycle: [],
    continuity: null,
    // THE SEAM, OVERLAPPED. Cut after it, the 1520px exit above ends on bare
    // cream: at frames=11 the panel still shows 51% of its height three frames
    // from the end, 30% two from the end, and 0% on the last (pushOut over the
    // 0.84-fit panel) — so every clip -> card cut landed on an empty frame
    // before the next card's first word. Overlapping the last 3 exit frames
    // with the next segment's first 3 puts the typing on screen while the
    // panel clears, as the reference's next element arrives into the vacancy.
    // Measured before/after on a smoke reel: see the note on overlapJoins.
    overlapExitF: 3,
  },
  // "Replit Replit X.mp4" — see REFERENCE_FILMS.
  source: { loudnessLUFS: -14.0 },
  targets: {
    // 9 sections in 42.048s. "Shot" means section here: there are no cuts to
    // bound one.
    meanShotS: 4.67,
    // THE DEFINING NUMBER. Zero. Our own cut cannot hit it — we concatenate
    // segments — so read the comparison as "how invisible are the seams".
    cutsPerMin: 0,
    // MEASURED 683/1007 frames. Nearly four times ledger's 0.261: this film is
    // almost never still.
    movingFrac: 0.678,
    // MEASURED 54 frames at 24fps = 2.25s, converted to our 30fps.
    longestStillF: 68,
    // No cuts, so no cut delta. "matched" is the honest of the two options.
    cutDelta: "matched",
  },
};
