/**
 * BASE — the house grammar, and what every style is written against.
 *
 * It is Film A's grammar (Cursor, "Agent UX improvements"), because that is
 * DEFAULT_STYLE: a reel that names nothing is cut in it, so a new style that
 * names nothing should land there too. Every number below is measured off that
 * film unless its comment says otherwise — see docs/reel/cursor/.
 *
 * Two things deliberately do NOT come from Film A:
 *
 *   `source` and `targets` are null. A style that inherited Film A's targets
 *   would claim a measurement it never took — the category error
 *   docs/reel/cursor/06-comparison.md §6 caught once, when a reference-derived rule
 *   was applied to the framed look and silently restyled the back catalogue.
 *   `proof` states its own.
 *
 *   `chip` and `recap` are shared by every style because no other reference
 *   has a chip punch or a recap card to measure (see each preset's note).
 */
import type { StylePreset } from "./types";

/**
 * The face every style used before `TypeStyle.fontFamily` existed.
 *
 * Note what it does NOT name: a specific face. It asks the render host for its
 * UI font and takes what it gets, which is Helvetica in this repo's headless
 * Chromium. That is fine for styles whose type was tuned against it and wrong
 * for one whose metrics were measured off a real grotesque.
 */
export const FONT_STACK_LEGACY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Inter, with the legacy stack behind it as a fallback.
 *
 * Shared by `ledger` and `stage`. Named for the face rather than for a style
 * because a second grammar wanted it: monid's grotesque and Replit's are
 * different faces, and Inter is a defensible stand-in for both at the metrics
 * each preset records. If a style ever needs a face Inter cannot stand in for,
 * vendor that one and give it its own constant rather than widening this.
 *
 * The fallback is deliberate and load-bearing: if src/lib/font.ts fails to
 * register the file, the cards still render readable type instead of blank
 * boxes. It also means a missing font shows up as "the metrics look wrong"
 * rather than as a crash, so check font.ts before re-tuning any number here.
 */
export const INTER_STACK = `"Inter", ${FONT_STACK_LEGACY}`;

export const BASE: StylePreset = {
  look: "fullbleed",
  // Film A's shots are static, so its CARDS carry the motion.
  motionLayer: "cards",
  join: { kind: "cut" },
  hud: { kind: "none" },
  card: {
    background: "plain",
    // Counted off the reference: its words land 3 to 8 frames apart, averaging
    // ~5 at 30fps, and 0.16s sits in that band. The floor is the tightest
    // measured cadence — 3 frames. Words snap on in a single frame (fadeS 0):
    // measured frame by frame, each word arrives complete, at full opacity and
    // in its final position.
    //
    // `fitted` because the 2.07s hold below is constant and the STAGGER gives
    // way to meet it — 6 frames per word on a 9-word card, 3 on a 15-word one.
    cadence: { kind: "fitted", staggerS: 0.16, minStaggerS: 0.1, fadeS: 0 },
    length: {
      // THE HARDEST RULE IN THE REFERENCE: 62-63 frames at 30fps between the
      // last word landing and the cut, on every one of its five sentence
      // cards, whether the card carried 7 words or 15. The tail is never
      // shortened to absorb long copy. classic's 1.2 is why our cards read as
      // hurried next to it.
      holdS: 2.07,
      holdFrom: "lastWord",
      // The reference's cards are 95-97 frames — effectively a fixed 96. The
      // floor stops a short card collapsing to its own reveal plus the hold: a
      // 7-word card came out 10 frames under the reference, which breaks the
      // metronomic 15 cuts per minute the film runs on. The ceiling is where
      // the stagger starts compressing instead of the card growing. An
      // explicit `holdS` still wins over both, so an author can sit longer.
      minS: 3.2,
      maxS: 3.3,
      // ~5 frames at 30fps. Measured: shot 2 opens with 4 of 11 words out,
      // shot 8 with 2 of 7 — the cut lands mid-reveal, never on an empty field.
      trimInS: 0.17,
      openOn: 0,
    },
    // 56 design px over ~14 frames, measured identically on both reference
    // cards whose entrance was a rise (shot 2: y 526->470; shot 6: y
    // 528->474). It is the one entrance shape the reference's cards share; the
    // varied moves are all on the way OUT — see `sequence`.
    enter: { kind: "push", axis: "y", dist: 56, frames: 14 },
    // A short leftward slide, the reference's most common exit.
    exit: { kind: "push", axis: "x", dist: -72, frames: 13 },
    // No emphasis on any of the reference's five cards: one ink, one weight.
    emphasis: false,
  },
  shot: {
    framing: "fullbleed",
    windowFit: null,
    // Backdrop image, as before this field existed.
    ground: null,
    // Read only on a windowed shot; a full-bleed clip has no camera to run.
    zoom: true,
    // The reference films draw no pointer and no ripple. A full-bleed clip
    // opts in per clip (`cursor: true`), which is what src/DemoClip.tsx reads.
    cursor: false,
    ripple: false,
    // A full-bleed clip holds still unless it authors a `push`. Film A's shot
    // envelope (in x 114 over 15 frames) is MEASURED and lives in
    // `sequence.continuity`, where it is applied only after a directional exit
    // — defaulting it onto every clip would animate every existing reel.
    enter: { kind: "none" },
    exit: { kind: "none" },
  },
  chip: {
    // A COMPOSITION target, not a zoom factor. The reference stops where its
    // chip takes roughly 40% of the frame width and the neighbouring words are
    // still legible at both edges. Copying its ~6x directly overshot, because
    // our chip is more than twice as wide at rest, so the same factor put it at
    // 60% of frame with the sentence gone. Match the framing, not the
    // multiplier: if the chip type size changes, this has to be re-checked.
    punchScale: 4,
    // Measured: ~13 frames of movement at 30fps.
    punchS: 0.45,
    leadS: 0.18,
    // One frame, not four. At 0.12s the card had three dead-still frames
    // between the punch ending and the press starting — measured at 7-14
    // per-frame change, a visible hitch. In the reference the press is already
    // underway as the punch decays (255 -> 107 -> 61 into the cut).
    settleS: 0.03,
    // The camera is STOPPED through this beat; the only thing moving is the
    // click ripple, still expanding when the cut lands. Counted off the
    // reference: its punch finishes and then it sits at that framing for ~17
    // frames while the press plays out.
    afterPressS: 0.3,
  },
  // MEASURED off Film A: 72px on a 1.194 pitch with no tracking.
  //
  // SPECIFIED BY RENDERED METRICS. The two numbers the reference holds are
  // cap height 52px and line pitch 86px at 1920x1080. Pitch is exact — 86px on
  // every multi-line card in both Cursor films (docs/reel/cursor/03-composition.md).
  // Cap height is 51-52 measured on FLAT capitals (N, I, R); round capitals
  // (G, S, C) read 54 because they overshoot the cap line, which is what an
  // earlier pass mistook for the true height. FONT_STACK_LEGACY resolves to a
  // Helvetica-class grotesque at a ~0.715 cap ratio, so:
  //
  //     size  = 52 / 0.715 = 72        cap  72 * 0.715 = 51.5   ✓
  //     pitch = 86 / 72    = 1.194     pitch 72 * 1.194 = 86.0   ✓
  //
  // The previous 64/1.35 reproduced the pitch exactly and the cap height not at
  // all: 64 * 0.715 = 45.75px, ~12% under. Cards read as caption rather than
  // statement. On a face with a different cap ratio, re-derive the size from
  // cap 52 and the line height from 86/size — do not carry these two across.
  type: {
    sizePx: 72,
    lineHeight: 1.194,
    letterSpacing: "0em",
    fontFamily: FONT_STACK_LEGACY,
  },
  // Film A runs two grounds and alternates them on every cut, which is what
  // makes its ~200-level slams. MEASURED off the reference.
  //
  // The dark ink is #E9EBE6, not #fff: #08080a is already one step off #000
  // because the extreme does not survive h264, and the same argument applies
  // to the ink.
  //
  // THE LIGHT GROUND IS STRUCTURE, NOT TASTE. #edece5 is the reference's
  // bookend ground, on both its opening and closing cards, against #0a0a0a on
  // all five sentence cards. A full-bleed film alternates dark cards with light
  // footage, so all ten of its cuts measure a 209-240 level step in mean luma.
  // Put the bookends on the DARK ground and two cuts vanish — logo->card and
  // recap->logo become steps of 2 and 1 levels, which ffmpeg's scene detector
  // does not register as cuts at all. That is exactly what our first cut did.
  // Its ink pair is measured the same way: glyph cores read #000, and the third
  // line reads Y 132-140 — a warm grey a little under halfway from ink to ground.
  palette: {
    plate: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
    plain: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
    light: { ground: "#edece5", ink: "#0a0a0a", muted: "#86857e" },
  },
  annotation: null,
  bookend: {
    markSolo: null,
    // THE MARK TURNS ONCE, FULLY, AS IT SETTLES. Measured on the reference's
    // opening and closing cards, which get identical treatment
    // (docs/reel/cursor/02-motion.md). Sampling the mark's silhouette every two frames
    // from f0 walks through: upright cube -> tilted -> near edge-on -> hexagon
    // (corner-on) -> rotated square -> pentagon -> chevron -> diamond -> near-
    // cube -> upright cube. Starting and ending on the SAME orientation across
    // a continuous turn is what identifies it as exactly one revolution rather
    // than a wobble; W/H swings 2.13 -> 0.87 -> 1.55 over the same span.
    //
    // WHY 0.85 AND NOT THE MEASURED 0.90. The reference mark is a cube, ours a
    // flat image, which is exactly zero px wide at 90 and 270 degrees. The only
    // thing to control is whether a crossing lands ON a frame or BETWEEN two.
    // Apparent width is |cos(spin)|; worst frame in the turn on the 30fps grid:
    //
    //     0.90s (27f)   0.030   <- 270deg lands on f10: a hairline, 220 lit px
    //                              against 7100 settled. Reads as a blink.
    //     0.87s (26f)   0.061
    //     0.75s (22f)   0.141
    //     0.85s (25f)   0.119   <- both crossings straddled (f3 0.119, f10 0.122)
    //
    // 0.85 keeps every frame at or above 12% width while staying closest to the
    // ~26 frames measured. If the mark is ever real 3D geometry, go back to 0.90.
    tumbleS: 0.85,
    turns: 1,
    // Measured on the reference's shot 1: after the settle the whole card keeps
    // drifting at ~2px/frame for another 14 frames — 23 frames of continuous
    // motion against the 8 our sentence card manages, which is the whole of
    // "their start is smoother". Scoped to the LOGO card on purpose: the
    // reference's sentence cards (shot 2, f131-182) are genuinely dead still.
    driftPxPerFrame: 2,
    driftFrames: 14,
    letterSpacing: "0em",
    // Redundant here — card.length.minS already floors every card at 3.2s —
    // but stated so the two do not silently disagree if that clamp moves.
    minS: 3.2,
  },
  // Measured off the reference's recap (f1094-1203), the one composition in it
  // that is NOT centred. A 4-frame blank lead, then the mark, the wordmark, and
  // one item every 16 frames — three times slower than the sentence cards'
  // words, because these are labels to be read, not prose to be scanned.
  recap: {
    // 0.12, not 0.17: the mark appears on the first frame at or after leadS, so
    // 0.17 (5.1f) put it on frame 6 — two late. 0.12 lands the mark on frame 4
    // and the wordmark on 12, matching the film frame for frame (re-rendered).
    leadS: 0.12,
    lockupStaggerS: 0.27,
    itemsLeadS: 0.37,
    itemStaggerS: 0.533,
  },
  sequence: {
    // THE REFERENCE VARIES ITS CARD EXITS, and that is what stops six cards in a
    // row reading as a slideshow. Measured across its five sentence cards:
    // slide left (56px, 83px), slide up (54px), scale down (-7%), and twice no
    // move at all. The cycle keeps the three moves in the order the film first
    // uses them. Left is 72/13, the reference's most common exit and
    // `card.exit` above; the up and scale frame counts are the ones
    // reels/harness.ts cut by hand against the reference (9 and 12).
    exitCycle: [
      { axis: "x", dist: -72, frames: 13 },
      { axis: "y", dist: -54, frames: 9 },
      { axis: "scale", dist: -0.07, frames: 12 },
    ],
    // DIRECTION CONTINUITY: giving a shot the direction the previous one was
    // travelling is what makes a hard cut read as one continuous move
    // interrupted by a content change. The reference does it at four of its
    // eleven cuts, which is why a cut there never lands on a standing start.
    //
    // x is Film A's measured SHOT entrance — 114 design px over 15 frames;
    // ordinary entrances run 54-114px (3-6% of frame width), the 208-416px
    // outliers are whip cuts and are authored per segment rather than
    // defaulted. y is the card rise above (56/14). scale mirrors the film's one
    // scale exit (-0.07/12), so a shot that shrank away hands over to one
    // settling from 7% large.
    continuity: {
      x: { dist: 114, frames: 15 },
      y: { dist: 56, frames: 14 },
      scale: { dist: 0.07, frames: 12 },
    },
  },
  source: null,
  targets: null,
};
