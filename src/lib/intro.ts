/**
 * Title-card storyboard + timing.
 *
 * The card is AUTHORED motion, not recorded motion. Everything in DemoClip is
 * derived from a click log and replayed at `speed`; nothing here is. That
 * asymmetry is deliberate: the demo body can be shown faster because the viewer
 * is watching a pointer, but a headline read at 2x is a headline nobody reads.
 * So no function in this file takes a playback rate.
 *
 * Pure by design — no React, no Remotion — so the schedule is unit-testable
 * without rendering a frame. src/Intro.tsx is the only consumer that eases it.
 */
import { cameraEase } from "./camera";
import { type ReelLook } from "./look";
import {
  FONT_STACK_LEGACY,
  STYLE_PRESETS,
  resolvePreset,
  type CardLength,
  type PaletteStyle,
  type ReelStyle,
  type WordCadence,
} from "./style";
import { OUTPUT_WIDTH, type ClickLog, type CursorSample } from "./click-log";

export type IntroStoryboard = {
  /** Must match the demo name: it drives out/<name>.intro.mp4 and the stitch. */
  name: string;
  /** Split on whitespace and staggered word by word. CSS does the wrapping. */
  headline: string;
  /** Optional second line. Fades in as one unit, not word by word. */
  subhead?: string;
  /** Small brand lockup. Lands first so frame 0 is never an empty backdrop. */
  wordmark?: string;
  /** Still hold after everything has landed, seconds. Defaults to HOLD_S. */
  holdS?: number;
  /**
   * What sits behind the text.
   *
   * "plate" is the studio backdrop — the same image DemoClip floats its window
   * on, so a card cutting straight into footage lands on an unchanged frame.
   * "plain" is flat near-black. "light" is flat near-white and is the right
   * default for a light-theme product: measured, our footage averages Y 181, so
   * a near-black card makes every cut a ~157-level slam where the reference ad
   * we benchmark against averages 63. See introLook.
   */
  background?: IntroBackground;
  /**
   * A live-looking control set into the headline, which the camera punches into.
   *
   * When present, `headline` MUST contain CHIP_TOKEN. The card then ends ON the
   * punch rather than fading out — the click is the cut.
   */
  chip?: IntroChip;
  /**
   * Show your brand mark (public/logo-mark.png) above the text, for a logo
   * sign-off card. Drop your own file in at that path. If it is a light glyph
   * on a dark ground, pair it with `background: "plain"` — on a light card it
   * will have little contrast.
   */
  logo?: boolean;
  /** Studio backdrop name, so a card matches the demo it introduces. */
  backdrop?: string;
  /**
   * Timing and exit treatment. Absent = "framed", i.e. every constant below
   * keeps the value it has always had. See src/lib/look.ts.
   *
   * Legacy: `style` supersedes it. Kept because every reel on disk uses it, and
   * because a card may still override one field of its reel's style.
   */
  look?: ReelLook;
  /**
   * The choreography grammar this card is cut in — motion AND look together.
   *
   * Absent falls back to `look`, and then to the default, so a storyboard that
   * says nothing renders exactly as it always has. See src/lib/style.ts.
   *
   * Must live HERE and not only on the reel: scripts/render-intro.ts renders a
   * card straight from intros/<name>.ts with no reel around it, so a reel-level
   * value could never reach it.
   */
  style?: ReelStyle;
  /**
   * Start the word clock this many seconds BEFORE the card's first visible
   * frame, so the cut lands mid-reveal.
   *
   * Measured: every card in the reference is already partly written on its
   * first frame — 4 words of 11 on one, 2 of 7 on another. The viewer arrives
   * to something already moving instead of to an empty field, which is what
   * ENTRY_FLOOR half-solves for the wordmark today. Full-bleed only; defaults
   * to TRIM_IN_S.
   */
  trimInS?: number;
  /**
   * How the card arrives. Full-bleed only; defaults to the measured y-rise.
   *
   * Worth setting whenever the shot before it left on a different axis: giving
   * the card the direction the previous shot was travelling is what makes a
   * hard cut read as one continuous move interrupted by a content change. The
   * reference does this at four of its eleven cuts.
   */
  enter?: CardExit;
  /** How the card leaves. Full-bleed only; defaults to CARD_EXIT_DEFAULT. */
  exit?: CardExit;
  /**
   * Turns the card into a RECAP: a top-left lockup over this list.
   *
   * `headline` becomes the wordmark beside the mark, and these are the feature
   * names revealed one at a time beneath it. See src/RecapCard.tsx.
   */
  items?: string[];
};

/**
 * A card's exit move.
 *
 * The reference varies the axis deliberately — measured across its five
 * sentence cards: slide left (56px, 83px), slide up (54px), scale down (-7%),
 * and twice no move at all. Alternating the axis is what stops six cards in a
 * row reading as a slideshow, so this is authored per card rather than fixed.
 */
export type CardExit = {
  axis: "x" | "y" | "scale" | "none";
  /** Design px for x/y, or a scale delta for "scale". */
  dist?: number;
  frames?: number;
};

/** The brand mark asset, rendered above a logo card's text. Supply your own. */
export const LOGO_FILE = "logo-mark.png";

export const BACKGROUNDS = ["plate", "plain", "light"] as const;
export type IntroBackground = (typeof BACKGROUNDS)[number];

export const CHIP_TOKEN = "{chip}";

export type IntroChip = {
  label: string;
  /** Where the pointer starts, in frame fractions. */
  from?: { x: number; y: number };
};

/**
 * Inline per-word styling, so a storyboard can emphasise words without any code
 * change — the whole point of the feature. A word carries at most a combination
 * of these; the default (no markers) is plain normal-weight text.
 */
export type WordStyle = {
  bold?: boolean;
  italic?: boolean;
  /** `true` uses the palette's highlight; a `#hex` string is a custom pill. */
  highlight?: boolean | string;
};

/** One whitespace-delimited stagger unit, markers stripped, style resolved. */
export type StyledToken = {
  text: string;
  style?: WordStyle;
  /** The {chip} placeholder (text may carry welded punctuation, e.g. "{chip}."). */
  chip?: boolean;
  /**
   * No space before this unit. Set on a pure-punctuation token so `*live*.`
   * renders as "live." not "live ." — the closing marker would otherwise act as
   * a word boundary and open a 0.26em gap in front of the period. Spacing is
   * drawn as a LEADING margin per unit, so one flag suppresses it everywhere.
   */
  tight?: boolean;
};

/** A unit that is only trailing punctuation never takes a leading space. */
const GLUE_RE = /^[.,;:!?%)\]}"'’”…]+$/;

/**
 * Inline markup vocabulary. Chosen to sit alongside the existing {chip} token
 * and to survive JSON round-tripping untouched, so an author (or an agent
 * writing JSON) expresses everything in the one `headline` string:
 *
 *   *word*            bold
 *   _word_            italic
 *   ==word==          highlight, palette colour
 *   ==word|#ffd54a==  highlight, custom colour
 *   {chip}            live control (unchanged)
 *
 * A marked run may span several words — `*two words*` bolds both — but each
 * whitespace unit stays its own stagger token, so the writing rhythm is
 * per-word regardless of how the emphasis was grouped. Markers are matched
 * greedily-innermost by a single alternation; an unbalanced marker simply does
 * not match and is rendered literally, so a lone `*` in copy is not an error.
 */
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const MARK_RE = /\*([^*]+)\*|_([^_]+)_|==([^=]+)==/g;

function styleOfHighlight(inner: string): { text: string; style: WordStyle } {
  // A `|` always introduces a colour: "word|#ffd54a" -> custom pill. The colour
  // is kept verbatim, valid or not, so introProblem can flag a malformed one
  // (e.g. a forgotten `#`) rather than the parser swallowing the intent and
  // rendering "word|red" as literal text. Bare "word" -> palette default.
  const bar = inner.lastIndexOf("|");
  if (bar !== -1)
    return {
      text: inner.slice(0, bar),
      style: { highlight: inner.slice(bar + 1).trim() },
    };
  return { text: inner, style: { highlight: true } };
}

/**
 * The single source of truth for turning a headline into stagger units.
 *
 * wordsOf, headlineParts and wordSchedule are all thin wrappers over this, so
 * the markup is parsed in exactly one place and the timing, the chip split and
 * the render can never disagree about where a word starts or what it wears.
 */
export function parseHeadline(headline: string): StyledToken[] {
  const tokens: StyledToken[] = [];
  const pushRun = (run: string, style?: WordStyle) => {
    for (const word of run.trim().split(/\s+/).filter(Boolean)) {
      const token: StyledToken = { text: word };
      if (style) token.style = style;
      if (word.startsWith(CHIP_TOKEN)) token.chip = true;
      // A pure-punctuation unit hugs the word before it (never the first unit).
      if (tokens.length > 0 && GLUE_RE.test(word)) token.tight = true;
      tokens.push(token);
    }
  };

  let last = 0;
  MARK_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = MARK_RE.exec(headline)); ) {
    if (m.index > last) pushRun(headline.slice(last, m.index));
    if (m[1] !== undefined) pushRun(m[1], { bold: true });
    else if (m[2] !== undefined) pushRun(m[2], { italic: true });
    else if (m[3] !== undefined) {
      const { text, style } = styleOfHighlight(m[3]);
      pushRun(text, style);
    }
    last = MARK_RE.lastIndex;
  }
  if (last < headline.length) pushRun(headline.slice(last));
  return tokens;
}

/** The headline as plain text, markers stripped — for length checks and logs. */
export function plainHeadline(headline: string): string {
  return parseHeadline(headline)
    .map((t) => t.text)
    .join(" ");
}

/**
 * Readable ink for an arbitrary pill colour, so a custom highlight is never
 * text-on-text. Rec. 601 luma with a mid threshold; the palette defaults carry
 * their own ink and never reach here.
 */
export function readableInk(bg: string): string {
  const hex = bg.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#101317" : "#ffffff";
}

/**
 * Where the chip sits, and therefore what the camera punches into.
 *
 * A constant rather than an author knob: src/Intro.tsx centres the chip with a
 * `1fr auto 1fr` grid, so the centre is guaranteed by the layout and needs no
 * measurement. Letting an author move it would mean measuring where it landed.
 */
export const CHIP_AT = { x: 0.5, y: 0.5 };
export const CHIP_FROM_DEFAULT = { x: 0.16, y: 0.84 };

/**
 * Every colour a card can use, derived from its background in one place.
 *
 * `flat` and `columnFrac` travel with the palette on purpose. The narrow column
 * exists ONLY to keep white text off the plate's specular band; a flat field has
 * no band. When that was keyed off `background === "plain"` instead, adding a
 * third flat mode would have silently inherited the narrow plate column and
 * broken interstitial line breaks in the wrong place again.
 */
export type IntroLook = {
  ground: string;
  headline: string;
  subhead: string;
  wordmark: string;
  chipFill: string;
  chipLabel: string;
  chipRim: string;
  /** Default pill background for a {h:...} word with no colour of its own. */
  highlightBg: string;
  /** Ink on that default pill. Custom-coloured highlights compute their own. */
  highlightInk: string;
  flat: boolean;
  columnFrac: number;
};

/**
 * Text column width as a fraction of the frame.
 *
 * Cards are centred, so this is a measure width, not a dodge: 0.78 keeps a
 * five-word interstitial on one line, where below it the line wraps and breaks
 * in the wrong place ("Say when to / use it."). The plate keeps a narrower 0.52
 * because its specular streaks run lower-left to upper-right and peak near
 * Y 186 against a Y 19 average — a narrower measure keeps more of the line off
 * the brightest part of the band.
 */
const COLUMN_FRAC_PLATE = 0.52;
const COLUMN_FRAC_FLAT = 0.78;

/**
 * Flat dark field. Not pure black: the plate's own darkest regions sit near
 * Y 8, so matching that keeps a dark card from stepping against the plate.
 */
const DARK_GROUND = "#08080a";
/**
 * Flat light field, Y 230.8 in limited range.
 *
 * Not #ffffff, for the same reason DARK_GROUND is not #000: one step off the
 * clip point leaves the encoder headroom and stops the ground reading as a
 * blown window. Against Y 181 footage this puts every cut at a ~50-level step,
 * down from ~157 — and 235 is the limited-range ceiling, so ~54 is the most any
 * light card could ever differ. This is near the floor, not a compromise.
 */
const LIGHT_GROUND = "#fafafb";
const LIGHT_INK = "#101317";

const DARK_LOOK = {
  ground: DARK_GROUND,
  headline: "#fff",
  subhead: "rgba(255,255,255,0.62)",
  wordmark: "rgba(255,255,255,0.52)",
  chipFill: "#17191d",
  chipLabel: "#f2f3f5",
  chipRim: "rgba(255,255,255,0.16)",
  // A marker-style highlight reads as a solid warm swatch with dark ink on any
  // ground, so the default is shared. Authors override the colour per word.
  highlightBg: "#f4d35e",
  highlightInk: "#101317",
} as const;

/**
 * `look` is optional and only changes the FULL-BLEED palette, which is measured
 * off the reference film rather than tuned against our backdrop: near-black
 * with #e9ebe6 ink for narration, warm off-white with black ink for bookends.
 * Called without it (every framed call site) nothing below changes.
 */
export function introLook(
  background?: IntroBackground,
  look?: ReelLook,
  palette?: PaletteStyle,
): IntroLook {
  // A style's own grounds win. This is what lets a grammar assign grounds by
  // ROLE — one for the narrating voice, one for the workbench a component
  // stands on, one for third-party vendors — where the looks below only ever
  // had a single voice with a light alternative. See PaletteStyle in
  // src/lib/style.ts for which film that comes from.
  if (palette && look === "fullbleed") {
    const g = palette[background ?? "plain"];
    return {
      ...DARK_LOOK,
      ground: g.ground,
      headline: g.ink,
      subhead: g.muted,
      wordmark: g.muted,
      flat: true,
      columnFrac: COLUMN_FRAC_FLAT,
    };
  }
  if (look === "fullbleed")
    return background === "light"
      ? {
          ...DARK_LOOK,
          ground: FULLBLEED_LIGHT_GROUND,
          headline: FULLBLEED_LIGHT_INK,
          subhead: FULLBLEED_LIGHT_MUTED,
          wordmark: FULLBLEED_LIGHT_MUTED,
          flat: true,
          columnFrac: COLUMN_FRAC_FLAT,
        }
      : {
          ...DARK_LOOK,
          ground: DARK_GROUND,
          headline: FULLBLEED_INK,
          subhead: FULLBLEED_MUTED,
          wordmark: FULLBLEED_MUTED,
          flat: true,
          columnFrac: COLUMN_FRAC_FLAT,
        };
  if (background === "light")
    return {
      ground: LIGHT_GROUND,
      headline: LIGHT_INK,
      // Lower alphas than the dark modes: dark-on-light reads heavier at
      // matched alpha, because there is no halation eating the stroke.
      subhead: "rgba(16,19,23,0.58)",
      wordmark: "rgba(16,19,23,0.45)",
      // A light control, deliberately. The card's final frame is the chip
      // filling the screen, so a dark chip would put the ~157 cut delta back
      // at that one boundary.
      chipFill: "#ffffff",
      chipLabel: LIGHT_INK,
      chipRim: "rgba(15,23,42,0.14)",
      highlightBg: "#ffe08a",
      highlightInk: LIGHT_INK,
      flat: true,
      columnFrac: COLUMN_FRAC_FLAT,
    };
  const flat = background === "plain";
  return {
    ...DARK_LOOK,
    flat,
    columnFrac: flat ? COLUMN_FRAC_FLAT : COLUMN_FRAC_PLATE,
  };
}

/** Mirrors defineFlow in scripts/lib/flow.ts: identity, but it types the file. */
export const defineIntro = (intro: IntroStoryboard): IntroStoryboard => intro;

/** Wordmark rise. Starts at 0 so the first frame already has something on it. */
export const WORDMARK_IN_S = 0.45;
/**
 * Beat before the headline starts, so it does not move with the wordmark.
 *
 * Zero, and that is the point. It used to be 0.35s, which meant the first frame
 * of a card carried nothing but a wordmark at zero opacity — a blank field. On
 * an interstitial that is a dead frame handed to a cut; on the card that OPENS
 * the film it is the first thing anyone sees. Both elements now start together
 * and separate by their own durations instead of by a delay.
 */
export const HEADLINE_START_S = 0;
/**
 * Gap between one word appearing and the next — the card's writing rhythm.
 *
 * Counted off the reference: its words land 3 to 8 frames apart, averaging ~5
 * at 30fps. 0.16s sits in that band. This is now a true gap rather than a
 * stagger offset, because a word takes no time to appear (see WORD_IN_S).
 */
export const WORD_STAGGER_S = 0.16;
/**
 * How long a word takes to appear. Zero — it is WRITTEN, not faded up.
 *
 * Measured on the reference frame by frame: each word arrives complete in a
 * single frame, at full opacity and in its final position, with near-zero
 * change between arrivals (per-frame deltas of 2-12 punctuated by spikes of
 * 255). Ours used to fade and rise each word over 0.62s with seven in flight at
 * once, which reads as text floating into place rather than being typed.
 *
 * Kept as a named constant rather than inlined because progressAt on a
 * zero-length cue returns exactly the binary reveal this wants: 0 before the
 * cue, 1 from it onward.
 */
export const WORD_IN_S = 0;
/** Subhead lag, measured from the LAST word's start rather than its end. */
export const SUBHEAD_LAG_S = 0.18;
export const SUBHEAD_IN_S = 0.6;
/** Still hold once everything has landed. */
export const HOLD_S = 1.2;

/**
 * FULL-BLEED TIMING. Measured off the Cursor "Agent UX improvements" film; each
 * of these replaces a "framed" constant above only when look is "fullbleed".
 */

/**
 * Still hold between the last word landing and the cut, in seconds.
 *
 * The hardest rule in the reference: 62-63 frames at 30fps on every one of its
 * five sentence cards, whether the card carried 7 words or 15. The stagger is
 * compressed to make that landing hit; the tail is never shortened to absorb
 * long copy. HOLD_S is 1.2 by comparison, which is why our cards read as
 * hurried next to it.
 */
export const HOLD_AFTER_TEXT_S = 2.07;

/**
 * How far into its own reveal a card already is on its first visible frame.
 *
 * ~5 frames at 30fps. Measured: shot 2 opens with 4 of 11 words out, shot 8
 * with 2 of 7.
 */
export const TRIM_IN_S = 0.17;

/**
 * Longest a sentence card may run before the stagger is compressed to fit.
 *
 * The reference's cards are 95-97 frames — effectively a fixed 96. Rather than
 * pin the length and let copy overflow, we cap it and tighten the stagger,
 * which is what the reference itself does: 6 frames per word on a 9-word card,
 * 3 on a 15-word one.
 */
export const CARD_MAX_S = 3.3;

/**
 * One type stack for every card variant.
 *
 * In lib rather than in a component because both Intro.tsx and RecapCard.tsx
 * need it, and RecapCard is rendered BY Intro — importing it back the other way
 * would close a cycle.
 */
export const FONT_STACK = FONT_STACK_LEGACY;

/**
 * FULL-BLEED TYPE. Measured off the reference; replaces the framed values only
 * when look is "fullbleed".
 *
 * The framed look was tuned at 96px/1.12/-0.022em against a photographic
 * backdrop, where a big tight headline holds its own. The reference is smaller
 * and looser, which is why it fits 7-8 words to a line where framed fits 5.
 *
 * SPECIFY THIS PAIR BY RENDERED METRICS, NOT BY NOMINAL SIZE. The two numbers
 * the reference actually holds are:
 *
 *     cap height  52px      line pitch  86px      (at 1920x1080)
 *
 * Pitch is exact — 86px on every multi-line card in both reference films
 * (docs/reel/03-composition.md). Cap height is 51-52 measured on FLAT capitals
 * (N, I, R); round capitals (G, S, C) read 54 because they overshoot the cap
 * line, which is what an earlier pass mistook for the true height.
 *
 * The nominal size that produces those metrics depends on the face's cap ratio.
 * FONT_STACK resolves to a Helvetica-class grotesque at ~0.715, so:
 *
 *     size  = 52 / 0.715 = 72        cap  72 * 0.715 = 51.5   ✓
 *     pitch = 86 / 72    = 1.194     pitch 72 * 1.194 = 86.0   ✓
 *
 * The previous 64/1.35 reproduced the pitch exactly and the cap height not at
 * all: 64 * 0.715 = 45.75px, ~12% under the reference. Cards read as caption
 * rather than statement. If FONT_STACK is ever pinned to a face with a
 * different cap ratio, re-derive SIZE from cap 52 and LINE_HEIGHT from 86/size
 * — do not carry these two numbers across.
 *
 * FULLBLEED_INK is #E9EBE6, not #fff. DARK_GROUND is already one step off #000
 * because the extreme does not survive h264; the same argument applies to the
 * ink and had not been carried through.
 */
export const FULLBLEED_HEADLINE_SIZE = 72;
export const FULLBLEED_LINE_HEIGHT = 1.194;
export const FULLBLEED_LETTER_SPACING = "0em";
export const FULLBLEED_INK = "#e9ebe6";

/**
 * THE BOOKEND GROUND IS LIGHT, AND THAT IS STRUCTURE, NOT TASTE.
 *
 * Measured off the reference: #edece5, a warm off-white, on both its opening
 * and closing cards — against #0a0a0a on all five of its sentence cards. For a
 * long time that read as a styling choice. It is not.
 *
 * A full-bleed film alternates dark cards with light footage, so its cut
 * contrast is the whole grammar: all ten of the reference's cuts measure a
 * 209-240 level step in mean luma, without exception. Put the bookends on the
 * DARK ground and two cuts vanish — logo->card and recap->logo become steps of
 * 2 and 1 levels, which ffmpeg's own scene detector does not register as cuts
 * at all. That is exactly what our first cut did.
 *
 * Light bookends are the only arrangement in which
 * `logo, card, clip, card, clip, card, still, recap, logo` alternates on every
 * single boundary. The colour is load-bearing.
 *
 * The ink pair is measured the same way: the wordmark's glyph cores read #000,
 * and the third line reads Y 132-140 — a warm grey a little under halfway from
 * ink to ground.
 */
export const FULLBLEED_LIGHT_GROUND = "#edece5";
export const FULLBLEED_LIGHT_INK = "#0a0a0a";
export const FULLBLEED_LIGHT_MUTED = "#86857e";
/** Muted ink on the dark full-bleed ground, at the same contrast ratio. */
export const FULLBLEED_MUTED = "#8a8a86";

/**
 * FULL-BLEED LOGO CARD. The film's bookend, and the fix for an abrupt opening.
 *
 * Measured on the reference's shot 1: the mark scales 198 -> 126px (a factor of
 * 1.57) and rises cy 555 -> 383 over ~19 frames while the title writes in over
 * the top, and the whole card then keeps drifting at ~2px/frame for another 14
 * frames. Total 23 frames of continuous motion against the 8 our sentence card
 * manages — which is the whole of "their start is smoother".
 *
 * The drift is scoped to THIS card on purpose. The reference's sentence cards
 * (shot 2, f131-182) are genuinely dead still, so this is not licence to add
 * residual motion everywhere.
 */
export const LOGO_IN_SCALE = 1.57;
export const LOGO_IN_S = 0.63;
export const LOGO_RISE = 96;

/**
 * THE MARK TURNS ONCE, FULLY, AS IT SETTLES.
 *
 * Measured on the reference's opening and closing cards, which get identical
 * treatment (docs/reel/02-motion.md). Sampling the mark's silhouette every two
 * frames from f0 walks through: upright cube -> tilted -> near edge-on ->
 * hexagon (corner-on) -> hexagon -> rotated square -> small quadrilateral ->
 * pentagon -> chevron -> chevron -> diamond with a facet returning -> near-cube
 * -> upright cube. Starting and ending on the SAME orientation across a
 * continuous turn is what identifies it as exactly one revolution rather than a
 * wobble. Silhouette width/height corroborates: W/H swings 2.13 -> 0.87 -> 1.55
 * over the same span, and the outline is stable from f26 on.
 *
 * ~27 frames at 30fps. Longer than the mark's scale-and-rise (LOGO_IN_S, 19
 * frames) on purpose: the size lands first and the turn keeps going, so the
 * card is still resolving after it has stopped travelling. That overlap is why
 * the reference's opening reads as one continuous move instead of two.
 *
 * AXIS. Not a cardinal one. A cube spun about x or y alone never shows the
 * corner-on hexagon that frames 6-9 clearly are; a tilted axis does. (1, 1, 0)
 * is the simplest tilt that reproduces the sequence.
 *
 * A NOTE ON FLAT MARKS, AND WHY THIS IS 0.85 AND NOT 0.90.
 *
 * The reference mark is a cube: a solid, so its silhouette is a filled polygon
 * at every angle. Ours is a flat image, which is exactly zero px wide at 90 and
 * 270 degrees. Those two crossings are unavoidable — any axis that lets a plane
 * show its back must pass through edge-on — so the only thing to control is
 * whether a crossing lands ON a frame or BETWEEN two.
 *
 * Apparent width is |cos(spin)|. Sampling that on the 30fps grid for candidate
 * durations, worst frame in the whole turn:
 *
 *     0.90s (27f)   0.030   <- 270deg lands on f10. Rendered, that frame is a
 *                              hairline: 220 lit px against 7100 settled. It
 *                              reads as a blink, not a flip.
 *     0.87s (26f)   0.061
 *     0.75s (22f)   0.141
 *     0.85s (25f)   0.119   <- both crossings straddled (f3 0.119, f10 0.122)
 *
 * 0.85 keeps every frame at or above 12% width while staying closest to the
 * ~26 frames measured off the reference. This is a constraint of rendering a
 * flat mark at 30fps, not something the reference had to solve — if the mark is
 * ever replaced with real 3D geometry, this can go back to the measured 0.90.
 */
export const LOGO_TUMBLE_S = 0.85;
export const LOGO_TUMBLE_TURNS = 1;
/** Tilted rotation axis, as an (x, y, z) triple for rotate3d. */
export const LOGO_TUMBLE_AXIS: readonly [number, number, number] = [1, 1, 0];
/**
 * Perspective distance in design px. Three times the mark's own height: enough
 * for the near edge to read as nearer without the barrelling that a short
 * perspective gives a plane at 45 degrees.
 */
export const LOGO_PERSPECTIVE = 276;
/** Residual drift after the settle: px/frame at 30fps, and how long it runs. */
export const LOGO_DRIFT_PX_PER_FRAME = 2;
export const LOGO_DRIFT_FRAMES = 14;

/**
 * A VERTICAL LOCKUP WAS TRIED HERE AND REJECTED — recorded so it is not
 * re-derived from the same measurements next time.
 *
 * The reference's bookend is a poster: mark above the name above a third line,
 * measured at 1920x1080 as mark 114x130 (12.0% of frame height), wordmark cap
 * 54px, third line 794px wide, whole stack 41.4% W x 33.0% H. Built, it
 * reproduced those numbers to within half a point (41.9% x 33.5%) and still
 * looked worse than the one-row lockup it replaced. Two reasons, both specific
 * to this brand rather than to the grammar:
 *
 *   - the reference's mark is a black cube, ours is a light-yellow blob, and a
 *     130px mark stranded above the name has nothing holding it there;
 *   - the third line was a URL, which reads as a slide footer rather than as
 *     part of the sign-off.
 *
 * Matching a measurement is not the same as matching the film. One row, one
 * size, no third line.
 */

/** Recap card geometry and cadence live with the other card timing. */
export const RECAP_LEAD_S = 0.17;
export const RECAP_LOCKUP_STAGGER_S = 0.27;
export const RECAP_ITEMS_LEAD_S = 0.37;
/** One list item every 16 frames at 30fps — labels to read, not prose to scan. */
export const RECAP_ITEM_STAGGER_S = 0.533;

/** Seconds of card needed for `n` items, before any exit push. */
export function recapDurationS(n: number, holdS: number = 1.23): number {
  const lastItemS =
    RECAP_LEAD_S +
    RECAP_LOCKUP_STAGGER_S +
    RECAP_ITEMS_LEAD_S +
    Math.max(0, n - 1) * RECAP_ITEM_STAGGER_S;
  return lastItemS + holdS;
}


/** Tightest measured word cadence — 3 frames at 30fps. The compression floor. */
export const WORD_STAGGER_MIN_S = 0.1;

/**
 * Shortest a sentence card may run.
 *
 * With CARD_MAX_S this brackets the reference's measured 95-97 frames from both
 * sides. Without the floor a short card collapses to its own reveal plus the
 * hold — a 7-word card came out 10 frames under the reference, which breaks the
 * metronomic 15-cuts-per-minute the film runs on. An explicit `holdS` still
 * wins, so an author can deliberately sit longer.
 */
export const CARD_MIN_S = 3.2;

/**
 * Card entrance: the text block rises into place.
 *
 * 56 design px over ~14 frames, measured identically on both reference cards
 * whose entrance was a rise (shot 2: y 526->470; shot 6: y 528->474). It is the
 * one entrance shape the reference's cards share; the varied moves are all on
 * the way OUT.
 */
export const CARD_RISE = 56;
export const CARD_RISE_FRAMES = 14;

/** Default exit: a short leftward slide, the reference's most common. */
export const CARD_EXIT_DEFAULT = {
  axis: "x" as const,
  dist: -72,
  frames: 13,
};

/**
 * Stagger that lands the last word in time for the full hold.
 *
 * Returns WORD_STAGGER_S when the copy already fits, so short cards keep the
 * unhurried cadence and only long ones tighten.
 */
export function fittedStagger(
  wordCount: number,
  trimInS: number,
  cadence: WordCadence = STYLE_PRESETS.proof.card.cadence,
  length: CardLength = STYLE_PRESETS.proof.card.length,
): number {
  // The ceiling and floor come from the grammar being fitted, not from the
  // full-bleed constants — a second fitted style would otherwise silently
  // inherit Film A's card band.
  const maxStaggerS = cadence.staggerS;
  const minStaggerS = cadence.kind === "fitted" ? cadence.minStaggerS : maxStaggerS;
  const beats = wordCount - 1;
  if (beats <= 0) return maxStaggerS;
  const room = (length.maxS ?? CARD_MAX_S) - length.holdS + trimInS;
  const fitted = room / beats;
  return Math.max(minStaggerS, Math.min(maxStaggerS, fitted));
}
/**
 * Lead-in before the first word on a card with no wordmark.
 *
 * Was 0.35s, which put an EMPTY FIELD on screen for ten frames at the head of
 * every interstitial. Measured against the reference: a cut landing on that
 * stretch reads as the film stopping, because nothing is on screen to move.
 * Two frames is enough to separate the cut from the first word.
 */
export const HEADLINE_LEAD_S = 0;

/**
 * Slow push across the card, as a fraction of scale.
 *
 * MOVE, REST, MOVE — not a constant rate, and the difference matters.
 *
 * A linear push does keep the cut alive, but it also means the card never rests,
 * and a first attempt at this shipped exactly that: measured against the
 * reference, our film sat still for 11% of its runtime where the reference sits
 * still for 34%. Rest is not dead air, it is what makes the movement legible —
 * the reference alternates hard between still and strongly moving, spending only
 * 11% of its frames in between.
 *
 * So the card arrives, holds genuinely still through the beat where the copy is
 * read, then accelerates into its own cut. The two ramps have deliberately
 * different curves: the first decelerates to zero so it settles without a kick,
 * the second is accelerating at u=1 so the frame the cut lands on still has
 * velocity. Same reasoning as punchEase.
 */
/**
 * Opacity the first element starts at, rather than zero.
 *
 * A card is cut to, not faded up, so frame 0 has to already carry something.
 * Applied only to the wordmark and the first word: everything after them still
 * rises from nothing, so the sentence still assembles left to right.
 */
export const ENTRY_FLOOR = 0.3;

/** Lifts an entry so it starts visible. */
export const flooredEntry = (p: number): number =>
  ENTRY_FLOOR + (1 - ENTRY_FLOOR) * p;

export const CARD_PUSH = 0.04;
/**
 * Length of the exit ramp, in seconds.
 *
 * Absolute, not a fraction of the card. A first attempt used fractions and the
 * rest landed at 32-68% of the duration — which on a 1.5s interstitial is
 * exactly when the last words are still arriving, so those cards measured 0%
 * still. Keying the rest to `settledS` instead puts it where the copy is
 * actually being read, whatever the card's length.
 */
export const PUSH_OUT_S = 0.35;
/**
 * Share of the push spent on the way in. Zero — it all goes to the exit.
 *
 * With a written headline the card has to be genuinely still BETWEEN word
 * arrivals, or the words land on a drifting field and the writing stops reading
 * as writing. Measured, an in-ramp kept per-frame change at 74-250 throughout;
 * the reference sits at 2-12 between its arrivals and spikes to 255 on each one.
 * Moving the whole push to the exit gives both: a still card while it writes,
 * and a camera already moving when the cut lands.
 */
const PUSH_IN_SHARE = 0;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Decelerates to zero — settles into the rest without a kick. */
const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);
/** Still accelerating at x=1 — the cut lands on a moving frame. */
const easeIn = (x: number): number => x * x;

/**
 * Scale of the card's content at `tS`. Moves in, rests while the copy is read,
 * then accelerates into its own cut.
 *
 * The rest runs from `settledS` — when the last word has landed — to the start
 * of the exit ramp. On a card too short to contain both, the ramps simply meet
 * and there is no rest; that is a signal the card needs a longer hold, not a
 * reason to shorten the ramps.
 */
export const pushAt = (
  tS: number,
  settledS: number,
  totalS: number,
): number => {
  if (!(totalS > 0)) return 1;
  const outStart = Math.max(settledS, totalS - PUSH_OUT_S);
  const inP = easeOut(settledS > 0 ? clamp01(tS / settledS) : 1);
  const outP = easeIn(
    totalS > outStart ? clamp01((tS - outStart) / (totalS - outStart)) : 0,
  );
  return 1 + CARD_PUSH * (PUSH_IN_SHARE * inP + (1 - PUSH_IN_SHARE) * outP);
};

/** Pointer glide to the chip. It lands as the punch settles. */
export const CHIP_TRAVEL_S = 0.62;
/** Beat between the sentence settling and the camera starting to move. */
export const CHIP_PUNCH_LEAD_S = 0.18;
/**
 * The punch. Measured off the reference: ~13 frames of movement at 30fps.
 */
export const CHIP_PUNCH_S = 0.45;
/**
 * Gap between the camera stopping and the press. One frame, not four.
 *
 * At 0.12s the card had three dead-still frames between the punch ending and
 * the press starting — measured at 7-14 per-frame change, a visible hitch. In
 * the reference the press is already underway as the punch decays (255 -> 107
 * -> 61 into the cut), with no still gap at all.
 */
export const CHIP_SETTLE_S = 0.03;
/**
 * Held after the press, before the cut.
 *
 * The camera is STOPPED through this beat; the only thing moving is the click
 * ripple, which is still expanding when the cut lands. Counted off the
 * reference: its punch finishes and then it sits at that framing for ~17 frames
 * while the press plays out, with per-frame change decaying 255 -> 107 -> 61
 * into the cut rather than accelerating.
 */
export const CHIP_AFTER_PRESS_S = 0.3;
/**
 * How far the camera pushes into the chip.
 *
 * Four, and the number is a COMPOSITION target, not a zoom factor.
 *
 * The reference stops where its chip takes roughly 40% of the frame width and
 * the neighbouring words are still legible at both edges — the control is the
 * subject, but it is visibly still IN a sentence. Copying its ~6x directly
 * overshot, because our chip is more than twice as wide at rest, so the same
 * factor put it at 60% of frame with the sentence gone. Match the framing, not
 * the multiplier: if the chip type size changes, this has to be re-checked.
 */
export const CHIP_PUNCH_SCALE = 4;
/**
 * Character budget for a chip headline.
 *
 * The chip card lays its sentence out on ONE line (whiteSpace: nowrap) so the
 * chip's centre can be an authored input rather than a measured output. That
 * makes overflow the one thing here that cannot be computed: a count is a proxy
 * for a width, and the real check is looking at the card in Studio.
 */
export const CHIP_MAX_CHARS = 40;

/**
 * The punch decelerates into a stop, like every other camera move here.
 *
 * An earlier version mirrored cameraEase so the punch was still accelerating
 * when the cut landed, on the theory that a click reads as the cause of the cut
 * only if the picture is speeding up into it. Measuring the reference frame by
 * frame overturned that: it punches for ~13 frames, STOPS, and then holds the
 * framing for ~17 more while the press plays out. Continuing to accelerate into
 * the cut is what makes ours read as falling into the screen.
 */
export const punchEase = cameraEase;

export type WordCue = {
  word: string;
  index: number;
  startS: number;
  endS: number;
  /** Inline styling for this word, if any — carried through to the render. */
  style?: WordStyle;
  /** True for the {chip} unit, so the chip render knows which cue is the control. */
  chip?: boolean;
  /** No leading space before this unit — see StyledToken.tight. */
  tight?: boolean;
};

export type IntroTiming = {
  words: WordCue[];
  wordmarkEndS: number;
  subheadStartS: number;
  subheadEndS: number;
  /** Everything has landed; the still hold begins. */
  settledS: number;
  /** Text starts leaving. */
  outStartS: number;
  totalS: number;
  /** Present only on a chip card; the card then ends on the punch. */
  chip: ChipTiming | null;
};

export type ChipTiming = {
  travelStartS: number;
  travelEndS: number;
  /** The camera starts moving. */
  punchStartS: number;
  /** The camera has stopped. Everything after this is held at one framing. */
  punchEndS: number;
  /** Mousedown, after the camera has settled. */
  pressS: number;
};

/**
 * The headline split around CHIP_TOKEN, or null when there is no chip.
 *
 * `tail` is the punctuation welded to the token — "{chip}." yields ".", which
 * is rendered flush against the chip's right edge. Without this, wordsOf would
 * produce the unit "{chip}." which matches no token and gets rendered on screen
 * as literal text; and a detached "." would stagger in as its own word with a
 * 0.26em gap in front of it.
 */
export function headlineParts(
  headline: string,
): { before: StyledToken[]; tail: string; after: StyledToken[] } | null {
  const units = parseHeadline(headline);
  const i = units.findIndex((u) => u.chip);
  if (i === -1) return null;
  return {
    before: units.slice(0, i),
    tail: units[i].text.slice(CHIP_TOKEN.length),
    after: units.slice(i + 1),
  };
}

/**
 * Stagger units as plain text. Markers are stripped, so a caller that only
 * needs the words (length checks, tests, the plain-text log) sees the sentence
 * a viewer reads, not the markup it was authored with.
 */
export function wordsOf(headline: string): string[] {
  return parseHeadline(headline).map((t) => t.text);
}

export function wordSchedule(
  headline: string,
  startS: number = HEADLINE_START_S,
  staggerS: number = WORD_STAGGER_S,
  fadeS: number = WORD_IN_S,
): WordCue[] {
  // parseHeadline already yields the units in order — including the {chip} as a
  // single unit in sentence position — each carrying its own inline style.
  //
  // A tight unit (trailing punctuation split off a marked word) shares the beat
  // of the word before it rather than taking its own: it appears WITH the word,
  // and it does not lengthen the card. `step` is the stagger index, advanced
  // once per visible beat, so `*Markdown*.` writes exactly like `Markdown.`.
  let step = -1;
  return parseHeadline(headline).map((token, index) => {
    if (!(token.tight && index > 0)) step += 1;
    const at = startS + step * staggerS;
    const cue: WordCue = {
      // The chip cue keeps CHIP_TOKEN as its word so existing callers and tests
      // that look for the token by value still find it, whatever punctuation was
      // welded to it in the copy.
      word: token.chip ? CHIP_TOKEN : token.text,
      index,
      startS: at,
      endS: at + fadeS,
    };
    if (token.style) cue.style = token.style;
    if (token.chip) cue.chip = true;
    if (token.tight) cue.tight = true;
    return cue;
  });
}

/** Clamped 0..1 progress. Easing is applied by the caller, via cameraEase. */
export function progressAt(
  cue: { startS: number; endS: number },
  tS: number,
): number {
  const span = cue.endS - cue.startS;
  if (span <= 0) return tS >= cue.endS ? 1 : 0;
  const t = (tS - cue.startS) / span;
  return Math.min(1, Math.max(0, t));
}

export function introTiming(intro: IntroStoryboard): IntroTiming {
  // A recap card is a list on a timer, not a sentence: its length comes from
  // how many items it has to show, and it has no word schedule at all.
  if (intro.items?.length) {
    const totalS = recapDurationS(intro.items.length, intro.holdS);
    return {
      words: [],
      wordmarkEndS: 0,
      subheadStartS: 0,
      subheadEndS: 0,
      settledS: totalS,
      outStartS: totalS,
      totalS,
      chip: null,
    };
  }

  // Everything below reads FIELDS off the resolved choreography preset. There is
  // deliberately no `if (style === ...)` here — see src/lib/style.ts for why.
  const preset = resolvePreset(intro);
  const { cadence, length } = preset.card;

  // A grammar that cuts INTO the reveal starts the word clock before frame 0, so
  // the first few words are already out. A negative start is the whole mechanism
  // — progressAt clamps, so words cued before 0 read as complete on the first
  // frame with no special case anywhere downstream.
  //
  // A grammar with no trim ignores an authored `trimInS` rather than honouring
  // it, which is what the framed look has always done; changing that would move
  // cards in the back catalogue.
  const trimInS = length.trimInS > 0 ? (intro.trimInS ?? length.trimInS) : 0;

  // A wordmark already puts something on screen at frame 0, so the headline can
  // take its beat. Without one, waiting means opening on an empty field.
  const headlineStartS =
    (intro.wordmark ? HEADLINE_START_S : HEADLINE_LEAD_S) - trimInS;
  const staggerS =
    cadence.kind === "fitted"
      ? fittedStagger(wordsOf(intro.headline).length, trimInS, cadence, length)
      : cadence.staggerS;
  const words = wordSchedule(
    intro.headline,
    headlineStartS,
    staggerS,
    cadence.fadeS,
  );
  const last = words[words.length - 1];
  // An empty headline still has to produce a coherent schedule, or Studio
  // cannot open a half-written storyboard.
  const lastStartS = last ? last.startS : headlineStartS;
  const lastEndS = last ? last.endS : headlineStartS;

  const wordmarkEndS = intro.wordmark ? WORDMARK_IN_S : 0;
  const subheadStartS = lastStartS + SUBHEAD_LAG_S;
  const subheadEndS = intro.subhead ? subheadStartS + SUBHEAD_IN_S : 0;

  const settledS = Math.max(wordmarkEndS, lastEndS, subheadEndS);
  // Where the hold is measured from is a grammar choice, not a look: see
  // CardLength.holdFrom.
  const holdFrom = length.holdFrom === "lastWord" ? lastEndS : settledS;
  const heldS = holdFrom + (intro.holdS ?? length.holdS);
  // A floor only applies to a grammar that HAS one. An authored `holdS` opts out
  // of it either way — the author has said how long the beat is.
  // A bookend gets its own floor. One or two words under a grammar with no card
  // clamp would otherwise cut before the mark has finished arriving — see
  // BookendStyle.minS. An authored `holdS` opts out of both floors.
  const floorS =
    intro.logo && preset.bookend.minS != null
      ? Math.max(length.minS ?? 0, preset.bookend.minS)
      : length.minS;
  const outStartS =
    floorS != null && intro.holdS == null ? Math.max(heldS, floorS) : heldS;

  // A chip card does not fade. `holdS` keeps its meaning — the still beat after
  // the sentence lands — and the pointer leaves at the end of it. The card then
  // ends ON the punch peak, because the cut is what the click causes.
  // Order matters and is measured, not assumed: the camera moves and STOPS, the
  // pointer lands as it stops, and only then does the press happen. Pressing
  // first and zooming afterwards reads as the frame falling into the control.
  const chip: ChipTiming | null = intro.chip
    ? (() => {
        const travelStartS = outStartS;
        const punchStartS = travelStartS + CHIP_PUNCH_LEAD_S;
        const punchEndS = punchStartS + CHIP_PUNCH_S;
        const pressS = punchEndS + CHIP_SETTLE_S;
        return {
          travelStartS,
          // The pointer arrives exactly as the camera settles.
          travelEndS: punchEndS,
          punchStartS,
          punchEndS,
          pressS,
        };
      })()
    : null;

  // NO FADE-OUT. The card ends while it is still fully on screen and still
  // being pushed, so the cut is made on a moving picture — which is what the
  // reference does at 8 of its 10 cuts. Fading first spends the last half-second
  // arriving at a static, near-empty frame and hands that to the next shot.
  return {
    words,
    wordmarkEndS,
    subheadStartS,
    subheadEndS,
    settledS,
    outStartS,
    totalS: chip ? chip.pressS + CHIP_AFTER_PRESS_S : outStartS,
    chip,
  };
}

/**
 * Pointer path for a chip card, as a ClickLog src/Cursor.tsx can draw.
 *
 * Reusing the demo's cursor rather than drawing a second one buys the mousedown
 * squash, the ripple, and the sub-linear growth under zoom — all three already
 * tuned in src/lib/cursor.ts — and keeps one pointer in the product.
 *
 * The path is sampled densely because samplePath interpolates LINEARLY between
 * samples: a two-point track would glide at constant velocity with a hard start
 * and a hard stop, which is exactly what the easing exists to avoid.
 */
export function cardPointerTrack(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startS: number,
  endS: number,
  vp: { width: number; height: number },
  samples = 24,
): CursorSample[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const u = i / samples;
    const e = cameraEase(u);
    return {
      t: (startS + (endS - startS) * u) * 1000,
      x: (from.x + (to.x - from.x) * e) * vp.width,
      y: (from.y + (to.y - from.y) * e) * vp.height,
    };
  });
}

export function cardPointerLog(
  chip: IntroChip,
  timing: ChipTiming,
  vp: { width: number; height: number },
): ClickLog {
  const at = CHIP_AT;
  const from = chip.from ?? CHIP_FROM_DEFAULT;
  return {
    name: "card-pointer",
    viewport: vp,
    durationMs: timing.punchEndS * 1000,
    cursorTrack: cardPointerTrack(
      from,
      at,
      timing.travelStartS,
      timing.travelEndS,
      vp,
    ),
    clicks: [
      {
        tMs: timing.pressS * 1000,
        tDownMs: timing.pressS * 1000,
        x: at.x * vp.width,
        y: at.y * vp.height,
        zoom: false,
      },
    ],
  };
}

export function introDurationInFrames(
  intro: IntroStoryboard,
  fps: number,
): number {
  return Math.max(1, Math.ceil(introTiming(intro).totalS * fps));
}

/**
 * Composition size for a card that will be concatenated onto <name>.mp4.
 *
 * DUPLICATED from the DemoClip block in src/Root.tsx, on purpose: that block is
 * the demo's contract and is left byte-identical, so the two cannot share a
 * call without editing it. The duplication is pinned by a test, and
 * scripts/stitch.ts re-checks the real files with ffprobe before concatenating
 * — if these ever drift, the stitch refuses rather than producing a broken mp4.
 */
export function compositionSize(log: ClickLog): {
  width: number;
  height: number;
} {
  const aspect = log.viewport.height / log.viewport.width;
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(OUTPUT_WIDTH), height: even(OUTPUT_WIDTH * aspect) };
}

/** Stand-in card for a demo with no storyboard yet, so a render still runs. */
export function fallbackIntro(name: string): IntroStoryboard {
  return { name, headline: name.replace(/-/g, " ") };
}

/**
 * Runtime shape check for storyboards loaded by dynamic import.
 *
 * intros/*.ts sit outside the tsc program (they are gitignored per-account
 * files, so a static import would break a fresh clone). That trade means the
 * compiler never sees them, and the failure it would have caught — a typo'd
 * key, a missing headline — would otherwise surface as a blank card several
 * minutes into a render. Returns the reason, or null when the object is usable.
 */
export function introProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const intro = value as Partial<IntroStoryboard>;
  if (typeof intro.name !== "string" || intro.name === "")
    return "missing a `name`";
  if (typeof intro.headline !== "string" || intro.headline.trim() === "")
    return "missing a `headline`";
  if (
    intro.background !== undefined &&
    !BACKGROUNDS.includes(intro.background as IntroBackground)
  )
    return `\`background\` must be one of ${BACKGROUNDS.join(", ")}`;
  // A custom highlight colour must be a real hex, or the pill renders as an
  // invalid CSS value and the word silently loses its background. The wordmark
  // carries the same inline markup as the headline, so it is checked too.
  for (const field of ["headline", "wordmark"] as const) {
    const text = intro[field];
    if (typeof text !== "string") continue;
    for (const token of parseHeadline(text)) {
      const hl = token.style?.highlight;
      if (typeof hl === "string" && !HEX.test(hl))
        return `highlight colour "${hl}" on "${token.text}" (${field}) is not a #hex value`;
    }
  }
  if (intro.chip !== undefined) {
    if (typeof intro.chip !== "object" || intro.chip === null)
      return "`chip` must be an object";
    if (typeof intro.chip.label !== "string" || intro.chip.label === "")
      return "`chip` needs a `label`";
    if (headlineParts(intro.headline as string) === null)
      return `a chip card's headline must contain ${CHIP_TOKEN}`;
    // Length is checked on the VISIBLE text: markup adds characters that never
    // reach the screen, so counting the raw string would reject sentences that
    // fit fine.
    if (plainHeadline(intro.headline as string).length > CHIP_MAX_CHARS)
      return `a chip headline must fit one line (over ${CHIP_MAX_CHARS} characters)`;
  }
  for (const key of ["subhead", "wordmark"] as const) {
    if (intro[key] !== undefined && typeof intro[key] !== "string")
      return `\`${key}\` must be a string`;
  }
  if (
    intro.holdS !== undefined &&
    !(typeof intro.holdS === "number" && intro.holdS >= 0)
  )
    return "`holdS` must be a non-negative number";
  if (intro.logo !== undefined && typeof intro.logo !== "boolean")
    return "`logo` must be a boolean";
  return null;
}
