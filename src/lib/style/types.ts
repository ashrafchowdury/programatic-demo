/**
 * The shape of a choreography style — every field a preset carries.
 *
 * Types only, plus the list of names. The numbers live in ./base.ts and
 * ./presets/*; how a name becomes a preset lives in ./registry.ts. See
 * src/lib/style.ts for the rule this whole directory exists to enforce.
 *
 * EVERY FIELD HERE HAS A READER. style.test.ts fails when one does not — a
 * field that nothing reads is documentation that looks like configuration:
 * tuning it changes nothing and the suite still passes. A measurement worth
 * keeping but not worth rendering belongs in a comment beside the number it
 * justifies, or in ./reference-films.ts.
 */
import type { ReelLook } from "../look";
import type { PushAxis, PushMove } from "../push";

/**
 * Every style that can be named on a reel.
 *
 * FOUR ENTRIES, and each has a film or a history behind it. A name here with
 * invented numbers behind it is worse than no name, because it looks
 * addressable and renders a film nobody chose. New styles get added when a
 * reference film has been analysed into `docs/reel/<name>/` — see "Adding a
 * style" in ./registry.ts.
 *
 * THERE WAS A FIFTH, `narration`, MERGED INTO `ledger`. The two measured 79%
 * identical across 85 comparable fields and only two of the differences were
 * mechanism. Its film is still recorded in REFERENCE_FILMS with the values the
 * merge dropped, so re-adding it is a data change rather than a re-measurement.
 */
export const STYLES = ["classic", "proof", "ledger", "stage"] as const;
export type ReelStyle = (typeof STYLES)[number];

/**
 * Which layer carries the motion. The invariant that makes a grammar a grammar
 * rather than a bag of numbers.
 *
 * Film A's shots are static so its cards move; Film B's cards are static so its
 * shots move. A grammar that moves both at once reads as busy. Read by
 * scripts/reel.ts: a `shots` grammar supplies every clip's arrival from
 * `shot.enter`/`shot.exit`.
 *
 * A FOURTH LAYER WAS OBSERVED AND IS NOT A VALUE. Uber's film puts the motion
 * on neither layer — the glyphs themselves transform, along curved baselines,
 * as outlines, as ghost stacks, which is why it moves 81.2% of its frames
 * against Film A's 24.1%. No preset can express that; it is a component
 * library. It is recorded on Uber's REFERENCE_FILMS entry instead of as a
 * union member nothing could select.
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
   * A null ceiling also means a `fitted` cadence never compresses.
   */
  minS: number | null;
  maxS: number | null;
  /**
   * Seconds of the reveal already spent when the card's first frame lands, so
   * the cut arrives mid-writing rather than on an empty field.
   */
  trimInS: number;
  /**
   * Headline units that must already be COMPLETE on the card's first frame.
   * The trim is lengthened, never shortened, until they are.
   *
   * A second spelling of `trimInS` in the unit that matters when the reveal
   * rate depends on the copy. A typewriter spends 7 characters' worth of time
   * on "Connect" and 2 on "Go", so no constant trim can promise the cut lands
   * on a word — measured on the stage cuts, where every typed card opened on
   * bare cream and the cut into it read as a drop-out (audit R10). 0 keeps the
   * trim exactly as `trimInS` states it. Logo cards are exempt: their headline
   * is the lockup, which is not scheduled as words.
   */
  openOn: number;
};

export type CardStyle = {
  /**
   * The ground a card gets when it names no `background`.
   *
   * "plate" under classic, where that is the studio backdrop a card has always
   * opened on; "plain" in every flat grammar, where the plate is either the
   * same colour (proof) or an ACCENT reserved for the payoff (ledger), and
   * defaulting to it would put the accent on every unmarked card.
   */
  background: GroundKey;
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
   */
  emphasis: boolean;
};

export type ShotStyle = {
  /**
   * How footage is framed.
   *
   * `window` floats it on a backdrop with a click-derived zoom camera.
   * `fullbleed` fills the frame and pans with a static crop. `isolate` lifts
   * one component onto a flat ground — built and tested in src/lib/crop.ts;
   * see that file for what it cost the full-bleed cut.
   *
   * There is no chrome field. Browser chrome is a per-render prop that no
   * pipeline passes (scripts/render.ts and scripts/reel.ts both leave it off),
   * so a preset value for it was read by nothing — `classic` claimed chrome
   * while every classic film rendered without it.
   */
  framing: "window" | "fullbleed" | "isolate";
  /** Fraction of frame the window fills, or null for DemoClip's own default. */
  windowFit: number | null;
  /**
   * A FLAT ground behind a framed shot, or null to use the backdrop image.
   *
   * `BACKDROPS` are image files, and every style before this one wanted one.
   * The Replit grammar wants a single flat colour that never changes for 42
   * seconds — MEASURED #FAF6F1, a warm cream — and a photograph cannot be that
   * however neutral it is.
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
   */
  zoom: boolean;
  /**
   * Whether the pointer and its click ripple are drawn, on a WINDOWED shot.
   *
   * Read by src/DemoClip.tsx's framed path only. A full-bleed clip draws the
   * pointer only when the clip asks (`cursor: true`), because the reference
   * films draw none — so on a full-bleed style these state that default rather
   * than override it, and are `false`.
   */
  cursor: boolean;
  ripple: boolean;
  /**
   * Default arrival/departure for a CLIP. Applied by scripts/reel.ts only to a
   * `shots`-layer grammar, and only where the clip authors no `push`.
   */
  enter: ShotMove;
  exit: ShotMove;
};

/**
 * The chip card's punch: how the camera pushes into the control set in a
 * sentence, and when the press lands. Read by introTiming and src/Intro.tsx.
 */
export type ChipStyle = {
  /** Magnification of the punch, as a composition target. */
  punchScale: number;
  /** Seconds of camera movement. */
  punchS: number;
  /** Beat between the sentence settling and the camera starting to move. */
  leadS: number;
  /** Gap between the camera stopping and the press. */
  settleS: number;
  /** Held after the press, before the cut. */
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
  /** See MarkSolo. `null` means the lockup simply fades in. */
  markSolo: MarkSolo | null;
  /** Seconds the mark takes to make its turn. */
  tumbleS: number;
  /** Full revolutions the mark makes as it settles. 0 = no turn at all. */
  turns: number;
  /**
   * Residual rise after a logo card's entrance settles: px/frame at 30fps,
   * and how many frames it runs. Applies only to a card that travels on the
   * push envelope — a grammar whose cards do not travel has no settle for a
   * drift to trail out of.
   */
  driftPxPerFrame: number;
  driftFrames: number;
  /** Tracking of the lockup's wordmark. */
  letterSpacing: string;
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
 * imported because this directory must never import intro.ts — style.test.ts
 * asserts the two lists stay in step.
 */
export type GroundKey = "plate" | "plain" | "light";
export type Ground = {
  ground: string;
  /** Headline ink. */
  ink: string;
  /** Subhead ink, and the wordmark's unless `wordmark` says otherwise. */
  muted: string;
  /** Wordmark ink, when it is lighter than the subhead's. */
  wordmark?: string;
  /**
   * Draw the studio backdrop IMAGE over `ground`. Only the framed plate does:
   * every other ground is flat, which also widens the text column (see
   * COLUMN_FRAC_PLATE in intro.ts for why the plate needs a narrow one).
   */
  backdrop?: boolean;
  /** The chip card's control, when this ground needs its own. */
  chip?: { fill: string; label: string; rim: string };
  /** The default `==highlight==` pill, when this ground needs its own. */
  highlight?: { fill: string; ink: string };
};

/**
 * The style's grounds, keyed by the card's `background`. The ONLY source of a
 * card's colours: introLook reads this and nothing else.
 *
 * FILM B ASSIGNS GROUNDS BY ROLE, not by taste, and that is what this map
 * encoded for the `narration` preset, which has since been MERGED INTO
 * `ledger` — see the cursor_origin_intro entry in REFERENCE_FILMS. In that film
 * white is the narration voice (a sentence stating a capability), warm grey is
 * the workbench (a component doing something), black is the third-party
 * register (CI and deploy vendors). A viewer learns the code in the first
 * triplet and it holds for the rest of the film.
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
 * Tuned by RENDERED METRICS, not by nominal font-size: `font-size` only means
 * something once you know the face's cap ratio, and a reader with a different
 * face cannot reproduce a film from it. The cap height and line pitch each
 * size produces are recorded in the comment beside it — as comments, because
 * nothing renders from them, and a field nothing renders from is the failure
 * style.test.ts guards against.
 *
 * Worth knowing where the references sit, because our full-bleed is the
 * smallest of the four: Film A caps at 52px, monid at ~70px on a 181px pitch,
 * Uber at ~75px.
 */
export type TypeStyle = {
  sizePx: number;
  lineHeight: number;
  letterSpacing: string;
  /**
   * The face, as a CSS font-family list.
   *
   * A STYLE FIELD RATHER THAN ONE SHARED CONSTANT, because the face is part of
   * a grammar the way the palette is: a preset measured off a film set in a
   * specific grotesque cannot be reproduced by whatever `system-ui` happens to
   * resolve to on the render host.
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
   * written up in §10 of docs/reel/replit/reference.md and it is genuinely
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

/** The recap card's reveal schedule, in seconds. Read by recapSchedule. */
export type RecapStyle = {
  /** Blank lead before the mark appears. */
  leadS: number;
  /** Mark to wordmark. */
  lockupStaggerS: number;
  /** Wordmark to the first item. */
  itemsLeadS: number;
  /** One item to the next. */
  itemStaggerS: number;
};

/**
 * The film a preset was derived from, as far as rendering is concerned.
 *
 * Only the loudness survives here, because it is the only part of the source
 * a pipeline reads (scripts/reel.ts prints how far a cut sits from it). The
 * film's name, length and shot count are MEASUREMENTS, not settings, and live
 * in ./reference-films.ts, where style.test.ts keeps the two in agreement.
 */
export type StyleSource = {
  /**
   * The reference's own integrated loudness, or null if it ships silent.
   *
   * ADVISORY ONLY — nothing reads this to set a level. Audio stays per-reel
   * because a style that silently mutes or un-mutes a film is a nasty surprise.
   * But the four references span 23 LU, from Film B's silence to Uber's
   * brick-walled -8.2, and that spread is a grammar decision worth surfacing.
   */
  loudnessLUFS: number | null;
};

/**
 * What a cut in this style should MEASURE — the reference's own numbers.
 *
 * Nothing renders from these. They are read by `pnpm analyze`
 * (scripts/analyze.ts), which prints a cut's totals against them, so a preset
 * can be checked against its reference instead of drifting quietly. `null`
 * alongside a null `source`.
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
 *
 * A dissolving style dissolves every join by default; a segment's own `join`
 * overrides it, which is how the reference's section-only blends are cut.
 */
export type ShotJoin = { kind: "cut" } | { kind: "dissolve"; frames: number };

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

/**
 * SEQUENCE-LEVEL CHOREOGRAPHY — the rhythm of a whole film, not of one card.
 *
 * A card's own `card.exit` gives every card the same move, so six cards in a
 * row leave the same way and the rhythm has to be rebuilt by hand in each reel
 * (reels/harness.ts authored enter/exit on every card to get it). These two
 * fields let the style own it instead. Applied by `planSequence` in
 * ./sequence.ts; a segment that sets its own move always wins.
 */
export type SequenceStyle = {
  /**
   * Card exits, in order, cycling: the n-th card of a film leaves by
   * `exitCycle[n % length]`. Empty = every card keeps `card.exit`.
   */
  exitCycle: PushMove[];
  /**
   * DIRECTION CONTINUITY: a segment that follows a directional exit ENTERS
   * TRAVELLING THE SAME WAY — a card that leaves left hands the frame to a
   * shot arriving from the right. Per axis, the entrance's travel and length.
   * `null` = entrances stay the style's own.
   */
  continuity: Record<
    "x" | "y" | "scale",
    { dist: number; frames: number }
  > | null;
};

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
  sequence: SequenceStyle;
  source: StyleSource | null;
  targets: GrammarTargets | null;
};

/**
 * A style, written as its DEPARTURES from BASE.
 *
 * Groups (`card`, `shot`, `bookend`, …) merge key by key, so an override names
 * only what differs. Anything with a `kind` — a cadence, a move, a join — and
 * any array REPLACES wholesale: merging a `ramp` over a `push` would leave a
 * hybrid carrying the push's stale axis, which is worse than either.
 */
export type StyleOverride = Override<StylePreset>;
type Override<T> = T extends { kind: string }
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: Override<T[K]> }
      : T;
