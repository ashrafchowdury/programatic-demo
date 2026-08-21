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
 * FOUR ENTRIES, and each has a film or a history behind it. A name here with
 * invented numbers behind it is worse than no name, because it looks
 * addressable and renders a film nobody chose. New styles get added when a
 * reference film has been analysed into `docs/reel/<name>/` — see "Adding a
 * style" at the bottom of this file.
 *
 * THERE WAS A FIFTH, `narration`, MERGED INTO `ledger`. The two measured 79%
 * identical across 85 comparable fields and only two of the differences were
 * mechanism. Its film is still recorded in REFERENCE_FILMS with the values the
 * merge dropped, so re-adding it is a data change rather than a re-measurement.
 */
export const STYLES = ["classic", "proof", "ledger", "stage"] as const;
export type ReelStyle = (typeof STYLES)[number];

/**
 * What a reel gets when it says nothing.
 *
 * "proof" — the Cursor full-bleed grammar — because that is the house style
 * now, and a new reel written without thinking about it should land there
 * rather than on the older framed window.
 *
 * ⚠️ THIS USED TO BE "classic", AND THE REASON IT DID IS STILL TRUE: a silent
 * reel is RESTYLED by changing this. reels/agent-skill.ts and
 * reels/agent-slash-command.ts name neither a `look` nor a `style`, so both
 * moved from the framed window to full-bleed the moment this changed. That was
 * a deliberate call, not an oversight — but it is exactly the kind of change
 * that is invisible until someone re-renders an old reel and finds a different
 * film. Pin `look: "framed"` on any reel that must not move.
 *
 * `harness.ts` is unaffected: it names `look: "fullbleed"`, which resolved to
 * "proof" before and after.
 */
export const DEFAULT_STYLE: ReelStyle = "proof";

// ---------------------------------------------------------------------------
// The preset shape
// ---------------------------------------------------------------------------

/**
 * Which layer carries the motion. The invariant that makes a grammar a grammar
 * rather than a bag of numbers.
 *
 * Film A's shots are static so its cards move; Film B's cards are static so its
 * shots move. A grammar that moves both at once reads as busy.
 *
 * `"type"` is OBSERVED BUT NOT IMPLEMENTED. Uber's film puts the motion on
 * neither layer — the glyphs themselves transform, along curved baselines, as
 * outlines, as ghost stacks, which is why it moves 81.2% of its frames against
 * Film A's 24.1%. No preset can express that; it is a component library. The
 * value exists so the axis is recorded rather than quietly missing.
 */
export type MotionLayer = "cards" | "shots" | "both" | "type";

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
  /**
   * A TYPEWRITER: one CHARACTER at a time, at a constant rate.
   *
   * MEASURED on the Replit film at one character per 2 frames = 83 ms at its
   * 24 fps. This is a different unit from the other two, not a smaller number:
   * `fixed` and `fitted` schedule word tokens, and no stagger small enough
   * turns a word reveal into a typewriter.
   *
   * A chip token does NOT type — it expands in the gap the typing leaves for
   * it, which is what the reference does at f867: the sentence reads
   * "Your ______" with a blank rule where the pill lands.
   */
  | { kind: "typed"; perCharS: number }
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
  /**
   * Whether inline `==markup==` renders as emphasis, or as plain ink.
   *
   * Was a branch on `look === "fullbleed"`: the Cursor reference uses NO
   * emphasis on any of its five cards, and on a near-black ground a marker
   * swatch is the highest-contrast object in frame, so the eye lands on the
   * decoration before the words. That reasoning is about a GRAMMAR, not about
   * a look, and the Replit grammar disproves the coupling — it is flat-ground
   * like full-bleed and its closing card is built around a red pill.
   *
   * The values below preserve the old branch exactly: framed keeps emphasis,
   * the three full-bleed styles drop it.
   */
  emphasis: boolean;
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
  /**
   * A FLAT ground behind a framed shot, or null to use the backdrop image.
   *
   * `BACKDROPS` are image files, and every style before this one wanted one.
   * The Replit grammar wants a single flat colour that never changes for 42
   * seconds — MEASURED #FAF6F1, a warm cream — and a photograph cannot be that
   * however neutral it is.
   *
   * NULL IS LOAD-BEARING: it means "behave exactly as before", so no existing
   * reel moves. Only a style that sets a colour renders flat.
   */
  ground: string | null;
  /**
   * Whether a framed shot runs the CLICK-DERIVED ZOOM CAMERA.
   *
   * `classic` is built on it: the camera follows the pointer, magnifying
   * whatever is being pressed. The Replit grammar does the opposite — MEASURED,
   * its popover holds perfectly still for the seven frames before it leaves
   * (f286-292, zero delta on both edges). All of that film's motion is at the
   * SECTION boundary, none of it inside a shot.
   *
   * With this off the panel sits at `windowFit` and moves only on its own
   * enter/exit envelope, which is what keeps a flat-ground composition stable
   * enough to read as a floating object rather than as a camera hunting.
   */
  zoom: boolean;
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

/**
 * The mark's SOLO PERFORMANCE before the wordmark arrives, or null for none.
 *
 * MEASURED on the Replit reference (24fps, f906-f954). Its sign-off is not a
 * lockup that fades in — the mark arrives ALONE and large, holds the centre of
 * the frame by itself, and only then demotes itself to lockup size as the
 * wordmark writes in beside it:
 *
 *   f907-f916   the mark grows, span 79 -> 246px          (9f  = 0.375s)
 *   f916-f930   holds alone at 246px = 19.2% of frame     (14f = 0.58s)
 *   f931-f948   shrinks to ~67px and slides left          (17f = 0.71s)
 *   f939-f954   the wordmark writes in beside it          (15f = 0.63s)
 *   f954-f1007  settled lockup holds                      (53f = 2.2s)
 *
 * ⧗ WHAT WE CANNOT REPRODUCE. The reference's mark ASSEMBLES: a dot appears,
 * becomes two rounded shapes, then four, which arrange into the logo. That
 * needs the mark as separate vector parts and ours is a single image file, so
 * the build is out of reach. What is reachable — and is the more transferable
 * half — is the SCALE AND POSITION story: alone and large, then demoted.
 *
 * `null` on every style that predates this field, so no existing bookend moves.
 */
export type MarkSolo = {
  /** Mark magnification while it is alone. MEASURED 246/67 = 3.7x. */
  scale: number;
  /** Seconds the mark takes to grow in. */
  growS: number;
  /** Seconds it holds alone at full size before the wordmark is due. */
  holdS: number;
  /** Seconds to shrink to lockup size while the lockup re-centres. */
  settleS: number;
  /**
   * How far to slide the lockup right, as a fraction of its own width, so the
   * MARK sits at frame centre during the solo.
   *
   * MEASURED on the reference: its final lockup spans 423..857 with the mark's
   * centre at 456, so the mark sits 184px left of the lockup centre = 0.42 of
   * the lockup's width. Our own lockup is proportioned similarly (a small mark
   * beside a wordmark), which is why the same fraction lands.
   */
  shiftFrac: number;
};

export type BookendStyle = {
  /** See MarkSolo. `null` means the lockup simply fades in, as before. */
  markSolo: MarkSolo | null;
  tumbleS: number;
  turns: number;
  driftPxPerFrame: number;
  driftFrames: number;
  /**
   * Floor on a LOGO card's length, or null to let the copy decide.
   *
   * A bookend is one or two words, so a grammar with no card floor renders it
   * as hold-only and cuts before the mark has arrived — the first Film B cut
   * of harness gave 35 frames, and its opening frame was a fragment of the logo
   * on an empty field. Every reference holds its sign-off far longer than any
   * sentence: Film B's logo card is 90f where its sentences run 31-89f.
   *
   * Separate from `card.length.minS` because they answer different questions.
   * A grammar can refuse to slot its sentences and still insist its bookends
   * breathe, which is exactly what Film B does.
   */
  minS: number | null;
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
 * encoded for the `narration` preset, which has since been MERGED INTO
 * `ledger` — see the cursor_origin_intro entry in REFERENCE_FILMS. In that film
 * white is the narration voice (a sentence stating a capability), warm grey is
 * the workbench (a component doing something), black is the third-party
 * register (CI and deploy vendors). A viewer learns the code
 * in the first triplet and it holds for the rest of the film.
 *
 * That directly contradicts the intro-reel skill's "pick a tonal strategy and
 * hold it — mixing them does not work". Film B mixes four grounds and works,
 * because they are assigned rather than chosen. Both rules are right for their
 * own grammar, which is exactly why this belongs in a preset.
 */
export type PaletteStyle = Record<GroundKey, Ground>;

/**
 * The headline type scale.
 *
 * SPECIFIED BY RENDERED METRICS, not by nominal font-size: `font-size` only
 * means something once you know the face's cap ratio, and a reader with a
 * different face cannot reproduce a film from it. `sizePx` is what CSS gets;
 * the cap height and pitch it produces are recorded beside it so a face change
 * is checkable.
 *
 * Worth knowing where the references sit, because our full-bleed is the
 * smallest of the four: Film A caps at 52px, monid at ~70px on a 181px pitch,
 * Uber at ~75px. Type scale is the single most visible difference between them
 * and it was hard-coded until now.
 */
export type TypeStyle = {
  sizePx: number;
  lineHeight: number;
  letterSpacing: string;
  /** MEASURED cap height and line pitch at 1920 wide, for cross-checking. */
  capPx: number;
  pitchPx: number;
  /**
   * The face, as a CSS font-family list.
   *
   * A STYLE FIELD RATHER THAN ONE SHARED CONSTANT, because the face is part of
   * a grammar the way the palette is: a preset measured off a film set in a
   * specific grotesque cannot be reproduced by whatever `system-ui` happens to
   * resolve to on the render host. Every style that has not been given a face
   * of its own carries intro.ts's FONT_STACK verbatim, so nothing that shipped
   * before this field existed renders differently.
   *
   * A face named here must be one src/lib/font.ts actually loads, or the
   * browser silently falls back and the measured metrics stop meaning anything.
   */
  fontFamily: string;
};

/**
 * FLOATING ANNOTATION CHIPS — the pills a film drops over its footage to name
 * what is happening, or null for a grammar that does not use them.
 *
 * MEASURED on the Replit reference at f645, which carries four at once:
 *
 *   "Recon"              126 x 50 px      "Auth Check"         224 x 52
 *   "Input Fuzzing"      268 x 55         "Response Analysis"  344 x 53
 *
 * So the pill height is 50-55px in a 720-tall frame = **7.3% of frame height**,
 * which is DISPLAY scale, not UI scale — five times the 17px UI text in the
 * same shot. That is the whole point of them: they are the only thing in the
 * frame a viewer is meant to read at a glance.
 *
 * They sit at the panel's EDGES, straddling its boundary rather than floating
 * free on the ground or sitting safely inside the picture.
 *
 * Fill MEASURED #EF3004 — the same brand red as the mark. Ours is not red; see
 * the note on `fill` below.
 */
export type AnnotationStyle = {
  /**
   * Pill fill.
   *
   * ⚠️ NOT THE REFERENCE'S #EF3004. That red belongs to Replit, and borrowing
   * it is the mistake the ledger cut made with monid's blue. Ours is the Agenta
   * mark's own chartreuse, which also keeps ONE accent language across the film
   * — the inline `==word|#f0f05a==` pill in a card and a floating chip over
   * footage are then visibly the same object.
   */
  fill: string;
  /** Text colour on the pill. */
  ink: string;
  /** Pill height as a fraction of frame height. MEASURED 0.073. */
  heightFrac: number;
  /** Text cap height as a fraction of the pill's height. */
  capRatio: number;
  /** Corner radius as a fraction of the pill's height. Not a full stadium. */
  radiusFrac: number;
  /**
   * How the chip arrives.
   *
   * ⚠️ THE REFERENCE'S MECHANISM IS MEASURED HERE AND DELIBERATELY NOT USED.
   * Its chips FLY IN from off-screen — "Recon" travels ~385px inward over
   * f626-f650 while shrinking 1.47x, all four arriving at once from their
   * nearest edges, settling on a slow r≈0.89/frame curve (~1.4s). That is
   * written up in §10 of docs/reels/chorography/replit.md and it is genuinely
   * what makes its frames read as designed.
   *
   * IT WAS BUILT, RENDERED AND REJECTED ON HOW IT LOOKED. It works there
   * because its chips cross a website mockup of big flat shapes with wide empty
   * cream margins. Ours cross a dense app picker — a sidebar, a category list
   * and twelve cards — and a pill sliding over that for 1.4 seconds reads as
   * noise rather than as annotation. Measured, it also put the chip in motion
   * for over a second at a time, which is a long distraction on a 4-second shot.
   *
   * So a chip does not travel. It UNROLLS in place, from the edge nearest its
   * own anchor, on the film's own 0.645 entrance curve — a wipe rather than a
   * slide. Nothing crosses the picture, the gesture is a quarter of the length,
   * and it reads as a label being applied to the thing under it.
   *
   * The reference does have a pill that does exactly this: its inline `built-in`
   * chip expands over 5 frames at 24fps with ink deltas 5077, 3022, 2196, 1531,
   * 877 — ratios averaging 0.6447. So this is its own vocabulary, borrowed from
   * the card and used on the footage.
   */
  /** Seconds the pill takes to unroll. MEASURED 0.208 on the inline chip. */
  wipeS: number;
  /**
   * Scale the pill carries as it unrolls, settling to 1.
   *
   * A small echo of the reference's 1.47x arrival shrink, which cannot survive
   * without the travel that carried it. Kept subtle — at this size anything
   * larger reads as a bounce.
   */
  oversize: number;
  /** Seconds a chip takes to roll back up and leave. */
  exitS: number;
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
  /**
   * The reference's own integrated loudness, or null if it ships silent.
   *
   * ADVISORY ONLY — nothing reads this to set a level. Audio stays per-reel
   * because a style that silently mutes or un-mutes a film is a nasty surprise.
   * But the four references span 23 LU, from Film B's silence to Uber's
   * brick-walled -8.2, and that spread is a grammar decision worth surfacing:
   * scripts/reel.ts prints how far a cut sits from its own reference.
   */
  loudnessLUFS: number | null;
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

/**
 * ⚠️ KNOWN OVER-APPLICATION. A dissolving style currently dissolves EVERY join,
 * where the reference dissolves selectively: monid has ~4 boundaries and blends
 * only 2 of them, both between SECTIONS. Cut on every join, a card cross-fading
 * into live UI reads as muddy rather than smooth — visible in the first ledger
 * cut of harness. The fix is a per-segment `join` override, the way `push` and
 * `crop` already override their style; the field belongs on ReelSegment, not
 * here.
 */

/**
 * The persistent overlay, if the grammar has one.
 *
 * `steps` derives a numbered line from the demo's own click-log labels — the
 * timing already exists and cannot drift out of sync with a re-shoot, which is
 * the same argument that makes the SFX derived rather than authored.
 *
 * ⚠️ A HUD spans segments, so it cannot be baked into any of them. It is a
 * post-concat overlay pass, and it RE-ENCODES the picture the way a dissolve
 * does. See src/lib/hud.ts.
 */
export type HudStyle = { kind: "none" } | { kind: "steps" };

export type StylePreset = {
  look: ReelLook;
  motionLayer: MotionLayer;
  card: CardStyle;
  shot: ShotStyle;
  join: ShotJoin;
  hud: HudStyle;
  chip: ChipStyle;
  palette: PaletteStyle;
  type: TypeStyle;
  /** Floating annotation chips, or null for a grammar without them. */
  annotation: AnnotationStyle | null;
  bookend: BookendStyle;
  recap: RecapStyle;
  source: StyleSource | null;
  targets: GrammarTargets | null;
};

/**
 * The face every style used before `TypeStyle.fontFamily` existed.
 *
 * Declared here rather than in intro.ts because the preset table owns the
 * numbers and intro.ts reads them — intro.ts imports this module, so the
 * dependency cannot run the other way. `FONT_STACK` there is now an alias of
 * this, which is what keeps every existing call site untouched.
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
export const INTER_STACK =
  `"Inter", ${FONT_STACK_LEGACY}`;

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
    hud: { kind: "none" },
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
      // Preserves the old `look === "fullbleed"` branch exactly.
      emphasis: true,
    },
    shot: {
      framing: "window",
      chrome: true,
      windowFit: 0.86,
      // Backdrop image, as before this field existed.
      ground: null,
      // The click-derived camera, as before this field existed.
      zoom: true,
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
    // Tuned against a photographic backdrop, not measured off a film.
    type: {
      sizePx: 96,
      lineHeight: 1.12,
      letterSpacing: "-0.022em",
      capPx: 69,
      pitchPx: 108,
      // Carried verbatim: this style predates the field and must not move.
      fontFamily: FONT_STACK_LEGACY,
    },
    // One voice: the framed look has always had a dark plate and a light
    // alternative, chosen per card rather than assigned by role.
    palette: {
      plate: { ground: "#08080a", ink: "#ffffff", muted: "rgba(255,255,255,0.62)" },
      plain: { ground: "#08080a", ink: "#ffffff", muted: "rgba(255,255,255,0.62)" },
      light: { ground: "#f4f2ec", ink: "#101317", muted: "rgba(16,19,23,0.58)" },
    },
    // No floating chips — this grammar does not use them.
    annotation: null,
    bookend: {
      // No solo phase — the lockup arrives whole, as before this field.
      markSolo: null,
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
      // No floor: the framed look has never had one and its cards are not
      // clamped either.
      minS: null,
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
    hud: { kind: "none" },
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
      // Preserves the old `look === "fullbleed"` branch exactly.
      emphasis: false,
    },
    shot: {
      framing: "fullbleed",
      chrome: false,
      windowFit: null,
      // Backdrop image, as before this field existed.
      ground: null,
      // The click-derived camera, as before this field existed.
      zoom: true,
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
    // MEASURED off Film A: 72px on a 1.194 pitch with no tracking, giving a
    // 52px cap on an 86px line pitch.
    type: {
      sizePx: 72,
      lineHeight: 1.194,
      letterSpacing: "0em",
      capPx: 52,
      pitchPx: 86,
      // Carried verbatim: this style predates the field and must not move.
      fontFamily: FONT_STACK_LEGACY,
    },
    // Film A runs two grounds and alternates them on every cut, which is what
    // makes its ~200-level slams. MEASURED off the reference.
    palette: {
      plate: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
      plain: { ground: "#08080a", ink: "#e9ebe6", muted: "#8a8a86" },
      light: { ground: "#edece5", ink: "#0a0a0a", muted: "#86857e" },
    },
    // No floating chips — this grammar does not use them.
    annotation: null,
    bookend: {
      // No solo phase — the lockup arrives whole, as before this field.
      markSolo: null,
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
      // Redundant here — card.length.minS already floors every card at 3.2s —
      // but stated so the two do not silently disagree if that clamp moves.
      minS: 3.2,
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
      loudnessLUFS: -31.3,
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
   * LEDGER — monid's grammar, WITH FILM B's MERGED INTO IT.
   *
   * ---------------------------------------------------------------------------
   * TWO REFERENCE FILMS, ONE PRESET, and that is a deliberate consolidation.
   *
   * This was two styles: `narration` (Cursor's origin film) and `ledger`
   * (monid). They measured **79% identical across 85 comparable fields** — the
   * next-closest pair in the registry is 18 points behind — because they share
   * a grammar: composited components on a flat ground, cards pixel-locked, the
   * SHOTS carrying the motion, no HUD, no chrome, and the same card timing.
   *
   * Only TWO of the eighteen differences were mechanism, and this preset keeps
   * monid's on both:
   *
   *   join        Film B CUTS;    here a 6-frame dissolve
   *   shot.enter  Film B pushes;  here the shot holds still
   *               scale -0.106 over 23f
   *
   * The rest were surface — type scale, face, palette, bookend floor. All of it
   * is recorded on the cursor_origin_intro entry in REFERENCE_FILMS, so
   * re-separating them is a data change rather than a re-measurement.
   *
   * ⚠️ THE COST IS REAL: Film B is no longer reproducible from this file. It is
   * MEASURED and unimplemented, which is why its REFERENCE_FILMS entry now
   * carries `style: null` alongside Uber's.
   * ---------------------------------------------------------------------------
   *
   * THE FILM THAT DOES NOT CUT. Named for its signature — a running cost counter
   * that survives every change of content. Two thirds of monid is ONE
   * 22.73-second take in which components swap in place; its only transitions
   * are two 6-frame dissolves. 6.9 cuts/min against Film B's 31.1, from the
   * same composited-component framing. Same vocabulary, opposite pacing — which
   * is exactly the pair of numbers the two styles disagreed on.
   *
   * WHY THE CARDS HOLD PERFECTLY STILL, which is the inherited half. The
   * defining measurement is an absence: docs/reel/02-motion.md §"cards do not
   * move at all" tracks Film B's shot 10 text box across 56 frames and finds
   * ZERO translation. Words appear in place; the box grows and never moves.
   * That is why `card.enter` and `card.exit` are `none` rather than a small
   * push, and it is monid's behaviour too.
   *
   * LENGTH FOLLOWS THE COPY, also inherited. Film A slots every card into
   * 3.2-3.3s and compresses its stagger to fit; Film B refuses, running 31-89f
   * as the words require. So the cadence is `fixed` and the clamps are null —
   * the observed 1.03-2.97s band is the CONSEQUENCE of this model, not an input
   * to it: one beat plus the hold is ~41f, ten beats plus the hold is ~83f,
   * against a measured 31-89f. monid gave no card tail to measure (it never cuts
   * between cards), so this is where its 1.16s hold came from in the first
   * place — and it is the reason the two presets were mergeable at all.
   *
   * Measured in docs/design/reels/choreography-references.md §3 and docs/reel/.
   */
  ledger: {
    look: "fullbleed",
    motionLayer: "shots",
    // MEASURED: luma walks 228 -> 98 across six frames with no single-frame
    // jump. The only reference of the four that does not hard-cut.
    join: { kind: "dissolve", frames: 6 },
    // THE REFERENCE'S SIGNATURE, DELIBERATELY NOT TAKEN. monid's running
    // counter and step line are what buy it 22 seconds without a cut: the
    // overlay carries the continuity that cutting would otherwise supply, and
    // hudSteps/HudOverlay still implement exactly that, derived from the click
    // log rather than authored.
    //
    // It is off because it did not survive review on our footage. Numbered
    // steps imply a sequence with a knowable total, and ours are pruned from
    // nine presses down to five, so the line read as a debug counter over the
    // picture rather than as a summary of it. Turning it off is a grammar
    // decision with a cost, and the cost is paid in the cut: without the
    // overlay carrying continuity, a ledger film has to cut more often than
    // the reference does. reels/agent-schedule.ts is cut on that assumption.
    //
    // Set this back to `{ kind: "steps" }` to get the reference behaviour.
    hud: { kind: "none" },
    card: {
      // MEASURED on the reference as a 6-frame ink ramp, and NOT USED. A word
      // at half opacity over cream is a grey word, so with a 0.2s ramp on a
      // 0.2s stagger there was always exactly one half-drawn word on screen:
      // every card spent its whole reveal looking half-loaded rather than
      // deliberate. Words now arrive at full ink, one per stagger.
      //
      // The measurement stays in the docstring on purpose — this is an
      // authored departure from the reference, not a failure to measure it.
      cadence: { kind: "fixed", staggerS: 0.2, fadeS: 0 },
      length: {
        // ⧗ STRUCTURALLY UNMEASURABLE on this reference. A card tail is the gap
        // between the last word and the CUT — and monid does not cut between
        // its cards. Its copy is replaced within one continuous 22.7s take, so
        // there is no boundary to measure to. Carried from Film B
        // (cursor_origin_intro) as the nearest measured grammar — which is also
        // why the two presets were 79% identical and could be merged at all.
        // Closing this needs a reference that cuts BETWEEN CARDS.
        holdS: 1.16,
        holdFrom: "lastWord",
        minS: null,
        maxS: null,
        trimInS: 0,
      },
      enter: { kind: "none" },
      exit: { kind: "none" },
      // Preserves the old `look === "fullbleed"` branch exactly.
      emphasis: false,
    },
    shot: {
      framing: "isolate",
      chrome: false,
      windowFit: null,
      // Backdrop image, as before this field existed.
      ground: null,
      // The click-derived camera, as before this field existed.
      zoom: true,
      cursor: true,
      ripple: false,
      enter: { kind: "none" },
      exit: { kind: "none" },
    },
    // ⧗ UNMEASURABLE — monid has no chip punch at all. Carried from Film B for
    // structural completeness; a ledger reel using a chip is off-reference.
    chip: {
      punchScale: 4,
      punchS: 0.1,
      leadS: 0.03,
      settleS: 0.03,
      afterPressS: 0.03,
    },
    // MEASURED on monid's opening card: cap ~70px on a 181px line pitch — a
    // pitch 2.6x the cap, against Film A's 1.65x. That openness is what makes
    // one of its cards read as two separate statements.
    //
    // WE DO NOT USE 1.85, AND THIS IS THE ONE PLACE THE REFERENCE LOST. Our
    // copy is a single sentence that WRAPS, not two statements, so an open
    // pitch put a hole through the middle of a sentence and pushed the second
    // line so far down that the block stopped reading as one object. 1.24 is
    // close on the two-line cards this film actually has. The measured pair is
    // kept below so the reference is still recoverable.
    type: {
      sizePx: 98,
      lineHeight: 1.24,
      letterSpacing: "-0.01em",
      capPx: 70,
      // Cap unchanged; the pitch follows the leading actually in use
      // (98 * 1.24 = 121.5). monid's own pair was cap 70 on pitch 181.
      pitchPx: 122,
      // THE ONE STYLE WITH A FACE OF ITS OWN. Inter, vendored at
      // public/fonts/ and loaded by src/lib/font.ts. The metrics above were
      // measured off a film set in a grotesque of this class; reproducing
      // them in whatever system-ui resolves to is why an earlier cut read as
      // a default slide deck rather than as a designed frame.
      fontFamily: INTER_STACK,
    },
    // MEASURED. Cream with a green cast, NOT white — rgb(247,251,243) — and one
    // saturated accent ground carrying the payoff. There is no third register:
    // monid says everything in two grounds, and so does this.
    //
    // THE ACCENT IS OURS, NOT THE REFERENCE'S. monid's payoff ground measures
    // #3255f6, and a blue borrowed from another company's film is a colour
    // this product does not own — on screen it read as a stock slide. The
    // accent is now near-black carrying the Agenta mark's own chartreuse,
    // sampled off the rendered wordmark at #f0f05a. Same structural job as
    // monid's blue: one saturated register change after the work is done.
    palette: {
      plate: { ground: "#0a0a0a", ink: "#f0f05a", muted: "rgba(240,240,90,0.62)" },
      plain: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
      light: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    },
    // ⧗ monid's sign-off is a static wordmark, not a tumble; tumble values
    // carried. Its LENGTH is MEASURED: f960-1038 = 79f = 2.63s.
    // No floating chips — this grammar does not use them.
    annotation: null,
    bookend: {
      // No solo phase — the lockup arrives whole, as before this field.
      markSolo: null,
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
      minS: 2.63,
    },
    // ⧗ UNMEASURABLE — monid has no recap card. Carried from Film B, same as
    // the chip block above.
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
      loudnessLUFS: -14.5,
    },
    targets: {
      meanShotS: 6.93,
      cutsPerMin: 6.9,
      movingFrac: 0.261,
      longestStillF: 77,
      cutDelta: "matched",
    },
  },
  /**
   * STAGE — Replit's launch grammar. One flat ground, and nothing ever cuts.
   *
   * Measured in docs/reels/chorography/replit.md. It is the first style here
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
   * reproduces the reference's seam exactly. That is why the exit distances
   * here are an order of magnitude larger than any other style's.
   *
   * THE ENVELOPE IS ALREADY OURS. push.ts was reverse-engineered from a CURSOR
   * film and its docstring — arrive decelerating, hold, accelerate away, cut
   * mid-move — describes this reference almost word for word. MEASURED:
   * Replit's entrance decays at r = 0.6451/frame at 24 fps, which resamples to
   * 0.7042 at our 30; PUSH_BEZIER gives 0.694 over 9 frames and 0.741 over 11.
   * Two unrelated launch films share one curve. That is a house style of the
   * genre, not a company's signature.
   *
   * ⚠️ WHAT IS NOT HERE. The reference floats annotation chips over the panel
   * (`Scanning 20%`, `Recon`, `Auth`, `Fuzzing`, `Response Analysis`), pinned
   * to its edges with their own entrances. We have no per-beat overlay concept;
   * the nearest thing is the step HUD, which is one centred derived line rather
   * than several positioned chips. It is the most visible thing a `stage` cut
   * is missing and it is a feature, not a preset value.
   */
  stage: {
    // Cards are FLAT — no backdrop plate — which is what `fullbleed` means on
    // the card side. The shots are still windowed; see `shot.framing`. This is
    // the first preset to want that pair, and it is why `emphasis` had to stop
    // being a branch on `look`.
    look: "fullbleed",
    motionLayer: "shots",
    // The seam is a cut onto bare ground. See the note above.
    join: { kind: "cut" },
    hud: { kind: "none" },
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
      },
      // MEASURED: the type card does not move. All of this film's motion is on
      // the panel layer, which is what `motionLayer: "shots"` records.
      enter: { kind: "none" },
      exit: { kind: "none" },
      // ON, against every other flat-ground style. The reference's closing card
      // is BUILT around an inline red pill, so dropping emphasis would delete
      // the point of the card.
      emphasis: true,
    },
    shot: {
      // A window, NOT `isolate`: the reference's panel has a corner radius, a
      // soft shadow and the app's own surrounding surface inside it. `isolate`
      // clips to a rect and fills the rest with pageBg, giving a component on a
      // flat mat with no radius and no shadow — and crop.ts records that cut
      // being measured and rejected on how it looked.
      framing: "window",
      // No browser chrome. The reference shows the app's surface, not a
      // simulated browser around it.
      chrome: false,
      // MEASURED at f84: panel box x 140-1148, y 72-676 of 1280x720 = 78.8%
      // wide, 83.9% tall. 0.84 takes the taller of the two, which is what
      // windowFit fits against.
      windowFit: 0.84,
      // MEASURED #FAF6F1 — a WARM cream (R > G > B), sampled at three widely
      // separated flat points and re-confirmed 900 frames later. Note the cast
      // is the opposite of ledger's #f7fbf3, which is green.
      ground: "#faf6f1",
      // OFF, and this is the difference between a floating panel and a camera
      // hunting a cursor. See ShotStyle.zoom.
      zoom: false,
      cursor: true,
      ripple: false,
      // MEASURED entrance (f314-322): the element grows from a fixed baseline
      // — `hi` pinned at 493 while `lo` rises 337 -> 180 — so this is a SCALE,
      // not a translate. 11 frames per the curve fit above.
      enter: { kind: "push", axis: "scale", dist: -0.2, frames: 11 },
      // MEASURED exit (f368-377): pure translate, span constant at 243-244px,
      // still accelerating on the last frame in shot.
      //
      // THE DISTANCE IS OURS, NOT THE REFERENCE'S, AND THE REASON IS GEOMETRY.
      // The measured cube travels 391px at 720p = 587 design px, but that cube
      // is 243px wide in a 1280 frame — 19% of it. Our panel is `windowFit`,
      // 84%, so the same distance leaves two thirds of it still on screen when
      // the cut lands and the seam reads as an ordinary cut. Measured on the
      // first stage render at 620: the panel top was still mid-frame.
      //
      // ⚠️ `dist` IS NOT WHERE THE SHOT ENDS UP. pushOut is
      // `dist * settle(1 - g/frames)` and the last VISIBLE frame is g = frames-1,
      // so at frames=11 the exit reaches settle(1/11) = 0.660 of `dist` before
      // the cut lands — the remaining third happens on a frame nobody sees.
      // Measured, after a render at 1000 left a third of the panel on screen.
      //
      // A 0.84-fit panel spans y 86..993 of a 1080-tall design frame, so
      // clearing it downward needs 994px of actual travel: 994 / 0.660 = 1506.
      // 1520 gives a little margin.
      //
      // For scale, the reference's own large-panel exit (the popover, f293-302)
      // travels ~807 design px in 0.375s. This is the same gesture sized for a
      // subject that fills 84% of frame instead of 56%.
      exit: { kind: "push", axis: "y", dist: 1520, frames: 11 },
    },
    // The reference's inline pill EXPANDS over 5 frames (208ms) on the shared
    // 0.645 curve rather than punching. ChipStyle describes a punch zoom, which
    // is a different mechanism; carried from Film B so the shape is complete.
    // ⧗ A stage reel using a chip CARD is off-reference.
    chip: {
      punchScale: 4,
      punchS: 0.1,
      leadS: 0.03,
      settleS: 0.03,
      afterPressS: 0.03,
    },
    // MEASURED on the closing card (f891): cap 39px at 720p = 58.5px at 1080p,
    // line width 51.2% of frame, centred on both axes.
    //
    // ⧗ LINE PITCH IS UNMEASURABLE HERE. The reference's only type card is one
    // line and never wraps, so there is no pitch to read. 1.2 is authored, and
    // pitchPx below follows it rather than a measurement.
    type: {
      sizePx: 82,
      lineHeight: 1.2,
      letterSpacing: "-0.01em",
      capPx: 59,
      pitchPx: 98,
      fontFamily: INTER_STACK,
    },
    // ONE GROUND, and that is the finding. The reference has no dark register
    // and no accent GROUND anywhere in 42 seconds — #F03000 appears only as the
    // logo mark, the inline pill and the floating annotations, never as a field.
    // So all three keys are the same cream on purpose: a `background: "plate"`
    // card renders identically, because the grammar has nowhere else to go.
    palette: {
      plate: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
      plain: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
      light: { ground: "#faf6f1", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    },
    // MEASURED: the closing lockup runs 37.7s -> 42.0s = 4.3s, the longest hold
    // in the film by a wide margin.
    //
    // WE DO NOT TAKE 4.3, AND 3.0 WAS ALSO WRONG. The reference's bookend is
    // 4.3 seconds of continuous ANIMATION — the mark assembles from two squares
    // and a circle, then the wordmark writes beside it — so it costs nothing in
    // stillness. Ours writes its wordmark and then holds, so every extra tenth
    // is a dead frame. Measured on the first stage cut: two 3.0s bookends were
    // 30% of a 20s film and the single largest static block in it.
    //
    // 2.2 is long enough for the lockup to land and read, and no longer.
    // THE REFERENCE'S SIGNATURE OVERLAY. See AnnotationStyle for the four
    // chips it was measured from and for why ours is not red.
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
      // MEASURED off the reference's sign-off — see MarkSolo for the frame
      // table and for the part of it we cannot reproduce.
      markSolo: {
        scale: 3.7,
        growS: 0.375,
        holdS: 0.58,
        settleS: 0.71,
        shiftFrac: 0.42,
      },
      tumbleS: 0.85,
      turns: 1,
      driftPxPerFrame: 2,
      driftFrames: 14,
      // The solo needs room: grow 0.375 + hold 0.58 + settle 0.71 is 1.67s
      // before the lockup even exists, so a floor tuned for a lockup that
      // simply fades in would cut the mark off mid-performance.
      //
      // MEASURED, the reference's two bookends are NOT the same length —
      // opening f0-f72 = 3.0s, closing f906-f1007 = 4.2s — and `minS` is one
      // number for both. 3.0 matches its opening exactly and gives the closing
      // ~1.3s of settled hold against the reference's 2.2s. The alternative was
      // splitting this into two fields, which is machinery for a difference no
      // viewer is going to time.
      minS: 3.0,
    },
    // ⧗ UNMEASURABLE — the reference has no recap card. Carried.
    recap: {
      leadS: 0.17,
      lockupStaggerS: 0.27,
      itemsLeadS: 0.37,
      itemStaggerS: 0.533,
    },
    source: {
      file: "Replit Replit X.mp4",
      shots: 9,
      durationS: 42.048,
      loudnessLUFS: -14.0,
    },
    targets: {
      // 9 sections in 42.048s. "Shot" means section here: there are no cuts to
      // bound one.
      meanShotS: 4.67,
      // THE DEFINING NUMBER. Zero. Our own cut cannot hit it — we concatenate
      // segments — so this target is the one place a stage reel is expected to
      // miss, and the comparison should read it as "how invisible are the
      // seams", not as a defect.
      cutsPerMin: 0,
      // MEASURED 683/1007 frames. Nearly four times ledger's 0.261: this film
      // is almost never still.
      movingFrac: 0.678,
      // MEASURED 54 frames at 24fps = 2.25s, converted to our 30fps.
      longestStillF: 68,
      // No cuts, so no cut delta. "matched" is the honest of the two options —
      // nothing here slams.
      cutDelta: "matched",
    },
  },
};

/**
 * Every reference film we have measured, including the ones no style implements.
 *
 * Separate from STYLE_PRESETS on purpose. A film here is a MEASUREMENT; a style
 * is something we can build. Uber sits in this table and nowhere else, because
 * its grammar is a typography engine rather than a set of numbers — see
 * docs/design/reels/choreography-references.md §4. Recording it keeps the
 * measurements addressable without implying a preset that would render a film
 * nobody chose.
 */
export const REFERENCE_FILMS: {
  file: string;
  label: string;
  style: ReelStyle | null;
  durationS: number;
  shots: number;
  movingFrac: number;
  cutsPerMin: number;
  loudnessLUFS: number | null;
  note?: string;
}[] = [
  {
    file: "cursor-agent-ux-imrpovments-intro.mp4",
    label: "Cursor — Agent UX improvements",
    style: "proof",
    durationS: 43.87,
    shots: 12,
    movingFrac: 0.241,
    cutsPerMin: 15.0,
    loudnessLUFS: -31.3,
  },
  {
    file: "cursor_origin_intro.mp4",
    label: "Cursor — origin (Film B)",
    // WAS "narration", UNTIL THAT PRESET WAS MERGED INTO `ledger`.
    //
    // The two were 79% identical across 85 comparable fields — same
    // motionLayer, same look, same isolate framing, same still cards, and the
    // SAME card timing, because ledger's tail was carried from this film in the
    // first place (monid never cuts between cards, so there was no boundary to
    // measure one against). Only two of the eighteen differences were
    // mechanism, and `ledger` kept its own on both:
    //
    //   join        this film CUTS;    ledger dissolves over 6 frames
    //   shot.enter  this film pushes   ledger holds still
    //               scale -0.106 / 23f
    //
    // The rest were surface, and are recorded here rather than lost:
    //
    //   type      72px / 1.194 line-height / 0em tracking, cap 52 on pitch 86
    //   palette   plate #0a0a0a on #ffffff · plain #e6e4e0 · light #ffffff
    //   bookend   minS 3.0
    //   targets   mean shot 1.817s · 31.1 cuts/min · 36.8% moving · still 75f
    //
    // `style: null` is the honest value now: this film is MEASURED, and nothing
    // in STYLE_PRESETS reproduces it. Re-adding it means re-adding a preset,
    // and the numbers above are what it would need.
    style: null,
    durationS: 30.9,
    shots: 17,
    movingFrac: 0.368,
    cutsPerMin: 31.1,
    loudnessLUFS: null,
  },
  {
    file: "monid-claude-for-prospecting.mp4",
    label: "monid — Claude for prospecting",
    style: "ledger",
    durationS: 34.633,
    shots: 5,
    movingFrac: 0.261,
    cutsPerMin: 6.9,
    loudnessLUFS: -14.5,
    note: "Delivered mislabelled as a Replit film. Its persistent HUD is unbuilt.",
  },
  {
    file: "uber-base-icon-system.mp4",
    label: "Uber — A new icon system",
    style: null,
    durationS: 40.768,
    shots: 11,
    movingFrac: 0.812,
    cutsPerMin: 14.7,
    loudnessLUFS: -8.2,
    note:
      "NOT IMPLEMENTABLE as a preset. Kinetic typography — glyphs transform " +
      "continuously along curved baselines, as outlines, as ghost stacks. " +
      "Its transferable findings (75px cap, exact #000/#FFF grounds, the " +
      'motionLayer "type" axis) are taken without it.',
  },
];

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
  // BOTH looks map EXPLICITLY, and that became load-bearing when DEFAULT_STYLE
  // moved to "proof". While the default was "classic", `framed` could fall
  // through to it and mean the right thing; now falling through would resolve a
  // reel that explicitly asked for the framed window to a full-bleed grammar.
  // A look that is named is an instruction, not an absence.
  if (input.look === "fullbleed") return "proof";
  if (input.look === "framed") return "classic";
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
