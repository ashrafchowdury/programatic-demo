/**
 * CLASSIC — the original. Window on a studio backdrop, click-driven zoom
 * camera, cards that hold and leave on a 4% scale ramp.
 *
 * `source` and `targets` stay null DELIBERATELY. This grammar predates both
 * reference films and was tuned against our own backdrop, so there is no film
 * to measure it against. Recording "not measured" in the data is what stops a
 * later pass backfilling Film A's numbers into it.
 *
 * `motionLayer: "both"` is likewise a FINDING, not a target: its cards ramp
 * AND a zoom camera runs, which breaks the one-layer invariant both references
 * obey. It predates them, so this is recorded rather than fixed.
 */
import type { StyleOverride } from "../types";

export const classic: StyleOverride = {
  look: "framed",
  motionLayer: "both",
  card: {
    // The studio backdrop, as every framed card has always opened on.
    background: "plate",
    // WORD_STAGGER_S in intro.ts — the same count off Film A, held fixed.
    cadence: { kind: "fixed", staggerS: 0.16, fadeS: 0 },
    length: {
      holdS: 1.2,
      holdFrom: "settled",
      minS: null,
      maxS: null,
      trimInS: 0,
    },
    enter: { kind: "none" },
    // MOVE, REST, MOVE. The card holds genuinely still while the copy is read,
    // then accelerates 4% into its own cut, so the frame the cut lands on still
    // has velocity (see pushAt in intro.ts).
    //
    // The ramp is ABSOLUTE, not a fraction of the card. A first attempt used
    // fractions and the rest landed at 32-68% of the duration — which on a
    // 1.5s interstitial is exactly when the last words are still arriving, so
    // those cards measured 0% still.
    exit: { kind: "ramp", scale: 0.04, durationS: 0.35 },
    emphasis: true,
  },
  shot: {
    framing: "window",
    windowFit: 0.86,
    cursor: true,
    ripple: true,
  },
  // Tuned against a photographic backdrop, not measured off a film: cap 69 on
  // a 108 pitch. A big tight headline holds its own there; 4-6 words to a line.
  type: {
    sizePx: 96,
    lineHeight: 1.12,
    letterSpacing: "-0.022em",
  },
  // One voice with a light alternative, chosen per card rather than assigned
  // by role.
  //
  // The DARK ground is not pure black: the plate's own darkest regions sit near
  // Y 8, so matching that keeps a dark card from stepping against the plate.
  //
  // The LIGHT ground is Y 230.8 in limited range, and is the right default for
  // a light-theme product: our footage averages Y 181, so a near-black card
  // makes every cut a ~157-level slam where this puts it at ~50 — and 235 is
  // the limited-range ceiling, so ~54 is the most any light card could differ.
  // Not #ffffff for the same reason the dark one is not #000: one step off the
  // clip point leaves the encoder headroom. Its alphas run lower than the dark
  // ones because dark-on-light reads heavier at matched alpha — there is no
  // halation eating the stroke. Its chip is light too: a chip card's final
  // frame is the chip filling the screen, so a dark chip would put the ~157
  // cut delta back at that one boundary.
  palette: {
    plate: {
      ground: "#08080a",
      ink: "#ffffff",
      muted: "rgba(255,255,255,0.62)",
      wordmark: "rgba(255,255,255,0.52)",
      backdrop: true,
    },
    plain: {
      ground: "#08080a",
      ink: "#ffffff",
      muted: "rgba(255,255,255,0.62)",
      wordmark: "rgba(255,255,255,0.52)",
    },
    light: {
      ground: "#fafafb",
      ink: "#101317",
      muted: "rgba(16,19,23,0.58)",
      wordmark: "rgba(16,19,23,0.45)",
      chip: { fill: "#ffffff", label: "#101317", rim: "rgba(15,23,42,0.14)" },
      highlight: { fill: "#ffe08a", ink: "#101317" },
    },
  },
  bookend: {
    // No turn: the framed lockup's 0.92 -> 1.0 nudge is a different, quieter
    // idea than Film A's tumble.
    turns: 0,
    letterSpacing: "-0.022em",
    // No floor: the framed look has never had one and its cards are not
    // clamped either.
    minS: null,
  },
  // Every card leaves on the same ramp, and every entrance is the cut itself.
  sequence: { exitCycle: [], continuity: null },
};
