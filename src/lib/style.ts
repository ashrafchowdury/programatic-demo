/**
 * Choreography styles — the registry of motion grammars a reel can be cut in.
 *
 * A style is a NAMED PRESET that decides both the look and the motion. One field
 * on a reel picks it; the same footage cut in two styles is two different films.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: A PRESET IS DATA. NO CODE BRANCHES ON A STYLE'S NAME.
 *
 * `introTiming`, `Intro.tsx`, `DemoClip.tsx` and `RecapCard.tsx` read FIELDS off
 * the resolved preset. Adding a film is one entry in STYLE_PRESETS plus one name
 * in STYLES — nothing else. If a component has to change to support a new film,
 * this type is missing a field, and adding the field is the fix. Writing
 * `if (style === "...")` anywhere is the failure mode this file exists to
 * prevent, because it is how the second grammar becomes unaddable.
 *
 * Where a grammar genuinely does something structurally different — framed cards
 * ramp a scale, full-bleed cards travel on a push envelope — the difference is
 * carried by a DISCRIMINATED UNION (`kind`), so the component still dispatches on
 * data. `kind` is a property of the motion, not of the style; two styles may
 * share one.
 * ---------------------------------------------------------------------------
 *
 * Sits below intro.ts and reel.ts, for the same reason src/lib/look.ts does:
 * reel.ts already imports intro.ts, so anything both must name has to live under
 * both. It may import only leaves — ./look and ./push for types. It must NEVER
 * import intro.ts: this file owns the numbers, and intro.ts reads them.
 *
 * See docs/design/reels/choreography-styles.md for the full spec, and
 * docs/reel/ for the measurements the `proof` preset is derived from.
 */
import type { ReelLook } from "./look";
import type { PushAxis } from "./push";

/**
 * Every style that can be named on a reel.
 *
 * TWO ENTRIES ON PURPOSE. These are the grammars we have actually measured or
 * built; a name here with invented numbers behind it is worse than no name,
 * because it looks addressable and renders a film nobody chose. New styles get
 * added when a reference film has been analysed into `docs/reel/<name>/` — see
 * "Adding a style" at the bottom of this file.
 */
export const STYLES = ["classic", "proof"] as const;
export type ReelStyle = (typeof STYLES)[number];

/**
 * What a reel gets when it says nothing.
 *
 * "classic", NOT "proof", and this is load-bearing: reels/agent-skill.ts and
 * reels/agent-slash-command.ts carry no `look` field, so they render framed
 * today. Defaulting to the Cursor grammar would silently restyle both. The
 * default is "whatever a silent reel already renders as", which is the only
 * default that cannot break the back catalogue.
 */
export const DEFAULT_STYLE: ReelStyle = "classic";

// ---------------------------------------------------------------------------
// The preset shape
// ---------------------------------------------------------------------------

/**
 * Which layer carries the motion. The invariant that makes a grammar a grammar
 * rather than a bag of numbers.
 *
 * Both reference films obey it strictly and OPPOSITELY: Film A's shots are
 * static so its cards move; Film B's cards are static so its shots move. A
 * grammar that moves both at once reads as busy.
 */
export type MotionLayer = "cards" | "shots" | "both";

/**
 * How words arrive on a card.
 *
 * `fixed` holds one cadence whatever the copy. `fitted` compresses the stagger
 * so the LAST word still lands in time for a constant hold — the reference's
 * hardest rule, and the reason a 15-word card and a 7-word card end on the same
 * beat.
 */
export type WordCadence =
  | { kind: "fixed"; staggerS: number }
  | { kind: "fitted"; staggerS: number; minStaggerS: number };

/**
 * How a shot arrives or leaves.
 *
 * `push` travels on an axis and is CUT MID-MOVE (src/lib/push.ts). `ramp` eases
 * a scale over a duration measured from where the copy settles, which is a
 * different mechanism, not a different number. `none` holds perfectly still —
 * Film B's cards do exactly this, measured at zero translation over 56 frames.
 */
export type ShotMove =
  | { kind: "push"; axis: PushAxis; dist: number; frames: number }
  | { kind: "ramp"; scale: number; durationS: number }
  | { kind: "none" };

/** How long a card may run, and how long it sits still once the copy lands. */
export type CardLength = {
  /** Still beat between the copy landing and the cut. */
  holdS: number;
  /**
   * What "the copy landing" means.
   *
   * `settled` waits for whatever finishes last — headline, wordmark or subhead.
   * `lastWord` measures from the final HEADLINE word only, which is what Film A
   * holds constant at 62 frames; there, a subhead fading in afterwards must not
   * push the cut out with it. A field rather than a branch, because it is a
   * property of the grammar and the next film will have an opinion on it too.
   */
  holdFrom: "settled" | "lastWord";
  /**
   * Floor and ceiling on total card length, or null for "no clamp".
   *
   * Film A slots every card into 3.2-3.3s. Film B refuses to: its cards run
   * 31-89f (1.03-2.97s) and length follows word count. A null here means the
   * copy decides, which is a real grammatical choice and not an absent value.
   */
  minS: number | null;
  maxS: number | null;
  /**
   * Seconds of the reveal already spent when the card's first frame lands, so
   * the cut arrives mid-writing rather than on an empty field.
   */
  trimInS: number;
};

export type CardStyle = {
  cadence: WordCadence;
  length: CardLength;
  enter: ShotMove;
  exit: ShotMove;
};

export type ShotStyle = {
  /**
   * How footage is framed.
   *
   * `window` floats it on a backdrop with chrome and a click-derived zoom
   * camera. `fullbleed` fills the frame and pans with a static crop.
   * `isolate` lifts one component onto a flat ground — built and tested in
   * src/lib/crop.ts, and deliberately unused by both presets here; see that
   * file for what it cost the full-bleed cut.
   */
  framing: "window" | "fullbleed" | "isolate";
  /** Window chrome and the fraction of frame the window fills. */
  chrome: boolean;
  windowFit: number | null;
  /** Whether the pointer and its click ripple are drawn. */
  cursor: boolean;
  ripple: boolean;
  /**
   * Default arrival/departure for a CLIP. Recorded from the reference but not
   * necessarily applied — see the note on `proof` below before wiring these in.
   */
  enter: ShotMove;
  exit: ShotMove;
};

export type ChipStyle = {
  /** Magnification of the punch, as a composition target (see CHIP_PUNCH_SCALE). */
  punchScale: number;
  punchS: number;
  leadS: number;
  settleS: number;
  afterPressS: number;
};

export type BookendStyle = {
  tumbleS: number;
  turns: number;
  driftPxPerFrame: number;
  driftFrames: number;
};

export type RecapStyle = {
  leadS: number;
  lockupStaggerS: number;
  itemsLeadS: number;
  itemStaggerS: number;
};

/** The film a preset was derived from. `null` means "not measured" — see below. */
export type StyleSource = {
  file: string;
  shots: number;
  durationS: number;
};

/**
 * What a cut in this style should measure. Lets a preset be checked against its
 * reference instead of drifting quietly. `null` alongside a null `source`.
 */
export type GrammarTargets = {
  meanShotS: number;
  cutsPerMin: number;
  movingFrac: number;
  longestStillF: number;
  cutDelta: "slam" | "matched";
};

export type StylePreset = {
  look: ReelLook;
  motionLayer: MotionLayer;
  card: CardStyle;
  shot: ShotStyle;
  chip: ChipStyle;
  bookend: BookendStyle;
  recap: RecapStyle;
  source: StyleSource | null;
  targets: GrammarTargets | null;
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const STYLE_PRESETS: Record<ReelStyle, StylePreset> = {
  /**
   * The original. Window on a classic backdrop, click-driven zoom camera, cards
   * that hold and leave on a 4% scale ramp.
   *
   * `source` and `targets` are null DELIBERATELY. This grammar predates both
   * reference films and was tuned against our own backdrop, so there is no film
   * to measure it against. Recording "not measured" in the data is what stops a
   * later pass backfilling Film A's numbers into it — the exact category error
   * docs/reel/06-comparison.md §6 caught once, when a reference-derived rule was
   * applied to the framed look and silently restyled the back catalogue.
   *
   * `motionLayer: "both"` is likewise a FINDING, not a target: its cards ramp
   * AND a zoom camera runs, which breaks the one-layer invariant both references
   * obey. It predates them, so this is recorded rather than fixed.
   */
  classic: {
    look: "framed",
    motionLayer: "both",
    card: {
      cadence: { kind: "fixed", staggerS: 0.16 },
      length: {
        holdS: 1.2,
        holdFrom: "settled",
        minS: null,
        maxS: null,
        trimInS: 0,
      },
      enter: { kind: "none" },
      exit: { kind: "ramp", scale: 0.04, durationS: 0.35 },
    },
    shot: {
      framing: "window",
      chrome: true,
      windowFit: 0.86,
      cursor: true,
      ripple: true,
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    chip: {
      punchScale: 4,
      punchS: 0.45,
      leadS: 0.18,
      settleS: 0.03,
      afterPressS: 0.3,
    },
    bookend: {
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
    },
    recap: {
      leadS: 0.17,
      lockupStaggerS: 0.27,
      itemsLeadS: 0.37,
      itemStaggerS: 0.533,
    },
    source: null,
    targets: null,
  },

  /**
   * Film A's grammar: full-bleed footage between cards, cut metronomically.
   * Shots are static, so the CARDS carry the motion.
   *
   * Every number here is measured — see docs/reel/. The 2.07s hold is the
   * hardest rule in the reference: 62-63 frames on every one of its five
   * sentence cards, whether the card carried 7 words or 15. The stagger is
   * compressed to make that landing hit rather than the hold stretched to
   * absorb it, which is why the cadence is `fitted`.
   *
   * ⚠️ `shot.enter`/`shot.exit` are RECORDED BUT NOT APPLIED. A full-bleed clip
   * with no explicit `push` does not move today, and defaulting these would
   * animate every clip in every existing reel. They are here so the measurement
   * is not lost; wiring them in is a deliberate, separate change.
   */
  proof: {
    look: "fullbleed",
    motionLayer: "cards",
    card: {
      cadence: { kind: "fitted", staggerS: 0.16, minStaggerS: 0.1 },
      length: {
        holdS: 2.07,
        holdFrom: "lastWord",
        minS: 3.2,
        maxS: 3.3,
        trimInS: 0.17,
      },
      enter: { kind: "push", axis: "y", dist: 56, frames: 14 },
      exit: { kind: "push", axis: "x", dist: -72, frames: 13 },
    },
    shot: {
      framing: "fullbleed",
      chrome: false,
      windowFit: null,
      cursor: true,
      ripple: false,
      // Measured on the reference; see the warning above.
      enter: { kind: "push", axis: "x", dist: 114, frames: 15 },
      exit: { kind: "push", axis: "x", dist: 72, frames: 13 },
    },
    chip: {
      punchScale: 4,
      punchS: 0.45,
      leadS: 0.18,
      settleS: 0.03,
      afterPressS: 0.3,
    },
    bookend: {
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
    },
    recap: {
      leadS: 0.17,
      lockupStaggerS: 0.27,
      itemsLeadS: 0.37,
      itemStaggerS: 0.533,
    },
    source: {
      file: "cursor-agent-ux-imrpovments-intro.mp4",
      shots: 12,
      durationS: 43.87,
    },
    targets: {
      meanShotS: 3.66,
      cutsPerMin: 15.0,
      movingFrac: 0.241,
      longestStillF: 110,
      cutDelta: "slam",
    },
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Is this a style we know? Narrows an unchecked string from a reel file. */
export function isStyle(value: unknown): value is ReelStyle {
  return typeof value === "string" && (STYLES as readonly string[]).includes(value);
}

/**
 * Pick the style for a reel or card.
 *
 * A SHIM, NOT A BIJECTION, and the distinction matters the moment a third style
 * exists. `look: "fullbleed"` maps to `proof` because proof is the only
 * full-bleed grammar we have — but a future full-bleed style would be equally
 * entitled to that look, and this mapping would then be an assumption rather
 * than a fact. It is exact for every reel on disk today, all of which predate
 * any second full-bleed grammar.
 *
 * Precedence: an explicit `style` always wins; otherwise the legacy `look` is
 * interpreted; otherwise the default.
 */
export function resolveStyle(input: {
  style?: ReelStyle;
  look?: ReelLook;
}): ReelStyle {
  if (input.style) return input.style;
  if (input.look === "fullbleed") return "proof";
  return DEFAULT_STYLE;
}

/** The preset itself, resolved the same way. */
export function resolvePreset(input: {
  style?: ReelStyle;
  look?: ReelLook;
}): StylePreset {
  return STYLE_PRESETS[resolveStyle(input)];
}

/**
 * Why a style/look pair cannot be honoured, or null when it can.
 *
 * Only ONE combination is rejected. A style and a look together is the
 * documented override — a proof reel with one framed card is legitimate — so
 * the check is deliberately narrow. `classic` + `fullbleed` is the exception
 * because classic's whole grammar is the window, its chrome and its zoom camera,
 * and there is no coherent film on the other side of that request.
 */
export function styleProblem(input: {
  style?: unknown;
  look?: ReelLook;
}): string | null {
  const { style, look } = input;
  if (style === undefined) return null;
  if (!isStyle(style))
    return `\`style\` must be one of ${STYLES.join(", ")} (got ${JSON.stringify(style)})`;
  if (style === "classic" && look === "fullbleed")
    return "`style: \"classic\"` cannot be combined with `look: \"fullbleed\"` — classic IS the framed grammar";
  return null;
}

// ---------------------------------------------------------------------------
// Adding a style
// ---------------------------------------------------------------------------
//
// 1. Analyse the film into docs/reel/<name>/ first. Every number in a preset
//    should be traceable to a measurement there; a field you cannot measure is
//    a field to leave at the value you can defend, not one to guess.
// 2. Add the name to STYLES.
// 3. Add one entry to STYLE_PRESETS, with `source` and `targets` filled from
//    the analysis. Leave them null ONLY if the style genuinely has no reference,
//    which for anything new should never be the case.
// 4. Do not touch any component. If you find yourself needing to, this file is
//    missing a field — add it here, give every existing preset a value for it,
//    and read it from the component. That is the whole contract.
// 5. src/lib/style.test.ts asserts every preset is complete and that no style
//    name is referenced outside this file. Both should stay green.
