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
 * THREE ENTRIES, and each has a film or a history behind it. A name here with
 * invented numbers behind it is worse than no name,
 * because it looks addressable and renders a film nobody chose. New styles get
 * added when a reference film has been analysed into `docs/reel/<name>/` — see
 * "Adding a style" at the bottom of this file.
 */
export const STYLES = ["classic", "proof", "narration", "ledger"] as const;
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
export type WordCadence = {
  /**
   * How long each word takes to arrive, in seconds. ZERO IS THE COMMON CASE and
   * is not an omission: both Cursor films snap each word on in a single frame,
   * because a word fading in over a card that is also moving reads as mush.
   * A grammar whose cards hold perfectly still can afford a fade — monid ramps
   * its type over 6 frames — which is why this is a field and not a constant.
   */
  fadeS: number;
} & (
  | { kind: "fixed"; staggerS: number }
  | { kind: "fitted"; staggerS: number; minStaggerS: number }
);

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

/**
 * A card ground and the ink that sits on it.
 *
 * Keys mirror `BACKGROUNDS` in intro.ts. They are re-declared rather than
 * imported because this file must never import intro.ts — style.test.ts asserts
 * the two lists stay in step.
 */
export type GroundKey = "plate" | "plain" | "light";
export type Ground = { ground: string; ink: string; muted: string };

/**
 * The style's grounds, keyed by the card's `background`.
 *
 * FILM B ASSIGNS GROUNDS BY ROLE, not by taste, and that is what this map
 * encodes for `narration`: white is the narration voice (a sentence stating a
 * capability), warm grey is the workbench (a component doing something), black
 * is the third-party register (CI and deploy vendors). A viewer learns the code
 * in the first triplet and it holds for the rest of the film.
 *
 * That directly contradicts the intro-reel skill's "pick a tonal strategy and
 * hold it — mixing them does not work". Film B mixes four grounds and works,
 * because they are assigned rather than chosen. Both rules are right for their
 * own grammar, which is exactly why this belongs in a preset.
 */
export type PaletteStyle = Record<GroundKey, Ground>;

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

/**
 * How one shot joins the next.
 *
 * Named `join`, not `transition`: in a Remotion codebase `transition` reads as
 * a CSS transition — which flickers, because it does not run off
 * useCurrentFrame — and the lint rule for that fires on the word alone. This is
 * an edit decision about two shots, not a property of an element.
 *
 * `cut` is a hard boundary and is what both Cursor films use exclusively.
 * `dissolve` ramps between them over `frames` — monid's only transition,
 * MEASURED at 6 frames (its luma walks 228 -> 216 -> 198 -> 165 -> 132 -> 114
 * -> 98 with no single-frame jump anywhere in it).
 *
 * ⚠️ A dissolve cannot be stream-copied. The two segments it joins have to be
 * re-encoded, so a reel using one is NOT byte-comparable against a cut reel —
 * see scripts/reel.ts.
 */
export type ShotJoin =
  | { kind: "cut" }
  | { kind: "dissolve"; frames: number };

export type StylePreset = {
  look: ReelLook;
  motionLayer: MotionLayer;
  card: CardStyle;
  shot: ShotStyle;
  join: ShotJoin;
  chip: ChipStyle;
  palette: PaletteStyle;
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
    join: { kind: "cut" },
    card: {
      cadence: { kind: "fixed", staggerS: 0.16, fadeS: 0 },
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
    // One voice: the framed look has always had a dark plate and a light
    // alternative, chosen per card rather than assigned by role.
    palette: {
      plate: { ground: "#08080a", ink: "#ffffff", muted: "rgba(255,255,255,0.62)" },
      plain: { ground: "#08080a", ink: "#ffffff", muted: "rgba(255,255,255,0.62)" },
      light: { ground: "#f4f2ec", ink: "#101317", muted: "rgba(16,19,23,0.58)" },
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
    join: { kind: "cut" },
    card: {
      cadence: { kind: "fitted", staggerS: 0.16, minStaggerS: 0.1, fadeS: 0 },
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
    // Film A runs two grounds and alternates them on every cut, which is what
    // makes its ~200-level slams. MEASURED off the reference.
    palette: {
      plate: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
      plain: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
      light: { ground: "#edece5", ink: "#0a0a0a", muted: "#86857e" },
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

  /**
   * Film B's grammar: sentences that CONTAIN live UI, with isolated components
   * doing the work. Cards are pixel-locked, so the SHOTS carry the motion —
   * the exact inverse of `proof`, and the reason both exist.
   *
   * The defining measurement is an absence: docs/reel/02-motion.md §"cards do
   * not move at all" tracks shot 10's text box across 56 frames and finds ZERO
   * translation. Words appear in place; the box grows and never moves. That is
   * why enter and exit are `none` rather than a small push.
   *
   * LENGTH FOLLOWS THE COPY. Film A slots every card into 3.2-3.3s and
   * compresses its stagger to fit; Film B refuses, running 31-89f as the words
   * require. So the cadence is `fixed` and the clamps are null — the observed
   * 1.03-2.97s band is the CONSEQUENCE of this model, not an input to it, and
   * it falls out: one beat plus the hold is ~41f, ten beats plus the hold is
   * ~83f, against a measured 31-89f.
   */
  narration: {
    look: "fullbleed",
    motionLayer: "shots",
    join: { kind: "cut" },
    card: {
      // 6f binary reveal — no fade, the word is simply there. Per shot 4 in
      // docs/reel/04-design-system.md.
      cadence: { kind: "fixed", staggerS: 0.2, fadeS: 0 },
      length: {
        // MEASURED here, over three cards, because the reference does NOT hold
        // this constant the way Film A does: shot 2 runs 39f of tail, shot 10
        // 18f, shot 16 47f. 34.7f is their mean. A single number is what the
        // engine needs; the spread is the honest caveat, and a card that wants
        // a specific beat should set `holdS` itself.
        holdS: 1.16,
        holdFrom: "lastWord",
        // No slot. See the note above.
        minS: null,
        maxS: null,
        // Film B cuts to an EMPTY card and reveals from there — shot 10's first
        // frame measures ink=0. It does not cut into its own reveal, which is
        // Film A's move, not this one.
        trimInS: 0,
      },
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    shot: {
      // Components lifted onto a flat ground — the {rect, fill, isolate} route
      // in src/lib/crop.ts, which was built for this grammar and reverted for
      // proof. 5 of Film B's 17 shots. One shot (9) is a framed app window at
      // 86%; that is an exception inside the film, not the grammar.
      framing: "isolate",
      chrome: false,
      windowFit: null,
      // Film B is pointer-first where Film A is keyboard-first, and its cursor
      // LEADS the beat — it starts travelling before the shot needs it.
      cursor: true,
      // UNKNOWN, not measured. Left off to match proof rather than invented.
      ripple: false,
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    chip: {
      // ⧗ NOT Film B's 7.82x. That figure is a raw pill-height ratio, while
      // CHIP_PUNCH_SCALE is a COMPOSITION TARGET (chip as a fraction of frame
      // width). Pasting it would over-zoom our chip, whose rest width differs.
      // Re-derive against a real render before changing this — open question Q4
      // in choreography-styles.md.
      punchScale: 4,
      // MEASURED and directly transferable: 1.0x -> 7.82x in THREE frames
      // (f186->f189), against our 13. This is the number that makes the punch
      // read as a snap rather than a zoom.
      punchS: 0.1,
      // The punch starts as the cursor arrives (enters f180, hovers f186,
      // punch f187), so there is almost no lead.
      leadS: 0.03,
      settleS: 0.03,
      afterPressS: 0.03,
    },
    // GROUNDS BY ROLE — the whole point, see PaletteStyle. Hexes MEASURED in
    // docs/reel/03-composition.md: pure white (unlike Film A's warm off-white),
    // the #E6E4E0 warm grey that every isolated component stands on, and the
    // same #0A0A0A black Film A uses. Film B's fourth ground, the purple, is an
    // app-shot BACKDROP rather than a card ground, so it is not here.
    palette: {
      // the third-party register — CI and deploy vendors
      plate: { ground: "#0a0a0a", ink: "#ffffff", muted: "rgba(255,255,255,0.62)" },
      // the workbench — every isolated component performing an action
      plain: { ground: "#e6e4e0", ink: "#0a0a0a", muted: "rgba(10,10,10,0.58)" },
      // the narration voice — every sentence that states a capability
      light: { ground: "#ffffff", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    },
    // ⧗ Film B's outro is a cube tumble over 90f, but its tumble duration and
    // turn count were never measured. Carried from proof rather than guessed.
    bookend: {
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
    },
    // ⧗ Film B has no recap card. These are proof's, kept so the preset is
    // structurally complete; a narration reel with a recap is off-reference.
    recap: {
      leadS: 0.17,
      lockupStaggerS: 0.27,
      itemsLeadS: 0.37,
      itemStaggerS: 0.533,
    },
    source: {
      file: "cursor_origin_intro.mp4",
      shots: 17,
      durationS: 30.9,
    },
    targets: {
      meanShotS: 1.817,
      cutsPerMin: 31.1,
      movingFrac: 0.368,
      longestStillF: 75,
      // Film B keeps tonal continuity and lets MOTION carry the cut: white card
      // (235) to warm grey (210) is a delta of 25, where Film A slams ~200.
      cutDelta: "matched",
    },
  },

  /**
   * monid's grammar: THE FILM THAT DOES NOT CUT.
   *
   * Named for its signature — a running cost counter that survives every change
   * of content. Two thirds of the reference is ONE 22.73-second take in which
   * components swap in place; its only transitions are two 6-frame dissolves.
   * 6.9 cuts/min against Film B's 31.1, from the same composited-component
   * framing. Same vocabulary, opposite pacing.
   *
   * Measured in docs/design/reels/choreography-references.md §3.
   *
   * ⚠️ WHAT IS NOT HERE YET. The persistent HUD — the `SPENT $0.00 -> $0.07`
   * counter and the monospace step line — is what buys those 22 seconds: it
   * carries the continuity that cutting would otherwise supply. It cannot be a
   * preset field, because it spans segments and every segment renders
   * independently. It needs a post-concat overlay pass, the way audio already
   * works. Until then a `ledger` cut has this grammar's pacing and palette but
   * not the thing that makes it hold together.
   */
  ledger: {
    look: "fullbleed",
    motionLayer: "shots",
    // MEASURED: luma walks 228 -> 98 across six frames with no single-frame
    // jump. The only reference of the four that does not hard-cut.
    join: { kind: "dissolve", frames: 6 },
    card: {
      // Type FADES here rather than snapping — a 6-frame ink ramp, MEASURED on
      // the opening card. A grammar whose cards hold still can afford it.
      cadence: { kind: "fixed", staggerS: 0.2, fadeS: 0.2 },
      length: {
        // ⧗ Not separately measured. monid's cards hold far longer than either
        // Cursor film (mean shot 6.93s), but its card tails were not isolated
        // from its component beats. Carried from narration as the nearest
        // measured grammar; re-measure before treating this as monid's.
        holdS: 1.16,
        holdFrom: "lastWord",
        minS: null,
        maxS: null,
        trimInS: 0,
      },
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    shot: {
      framing: "isolate",
      chrome: false,
      windowFit: null,
      cursor: true,
      ripple: false,
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    // ⧗ monid has no chip punch. Carried from narration for structural
    // completeness; a ledger reel using a chip is off-reference.
    chip: {
      punchScale: 4,
      punchS: 0.1,
      leadS: 0.03,
      settleS: 0.03,
      afterPressS: 0.03,
    },
    // MEASURED. Cream with a green cast, NOT white — rgb(247,251,243) — and one
    // saturated accent ground carrying the price payoff. There is no third
    // register: monid says everything in two grounds.
    palette: {
      plate: { ground: "#3255f6", ink: "#ffffff", muted: "rgba(255,255,255,0.72)" },
      plain: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
      light: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    },
    // ⧗ monid's sign-off is a static wordmark, not a tumble. Carried.
    bookend: {
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
    },
    // ⧗ monid has no recap card. Carried.
    recap: {
      leadS: 0.17,
      lockupStaggerS: 0.27,
      itemsLeadS: 0.37,
      itemStaggerS: 0.533,
    },
    source: {
      file: "monid-claude-for-prospecting.mp4",
      shots: 5,
      durationS: 34.633,
    },
    targets: {
      meanShotS: 6.93,
      cutsPerMin: 6.9,
      movingFrac: 0.261,
      longestStillF: 77,
      cutDelta: "matched",
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
