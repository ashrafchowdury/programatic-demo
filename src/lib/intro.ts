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
import { type PushSpec } from "./push";
import {
  STYLE_PRESETS,
  resolveStylePreset,
  type CardLength,
  type MarkSolo,
  type PaletteStyle,
  type RecapStyle,
  type ReelStyle,
  type WordCadence,
} from "./style";
import { OUTPUT_WIDTH, type ClickLog, type CursorSample } from "./click-log";

export type IntroStoryboard = {
  /** Must match the demo name: it names out/reel/<name>.intro.mp4 and sizes the card from that demo's log. */
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
   * A ROLE, not a colour: the style's palette decides what each one looks like
   * (see PaletteStyle in src/lib/style/types.ts). Under `classic`, "plate" is
   * the studio backdrop — the same image DemoClip floats its window on, so a
   * card cutting straight into footage lands on an unchanged frame — "plain" is
   * flat near-black and "light" flat near-white. Absent = the style's
   * `card.background` — "plate" under classic, "plain" everywhere else.
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
   * Legacy spelling of `style`, read only when `style` is absent: "framed"
   * resolves to `classic`, "fullbleed" to `proof`. Absent too = DEFAULT_STYLE
   * (`proof`). See resolveStyle in src/lib/style/registry.ts.
   */
  look?: ReelLook;
  /**
   * The choreography grammar this card is cut in — motion AND look together.
   *
   * Absent falls back to `look`, and then to DEFAULT_STYLE (`proof`). See
   * src/lib/style.ts.
   *
   * Must live HERE and not only on the reel: `pnpm intro` (scripts/intro.ts)
   * cuts a card straight from intros/<name>.ts as a one-card reel with no reel
   * file around it, so a reel-level value could never reach it.
   */
  style?: ReelStyle;
  /**
   * Start the word clock this many seconds BEFORE the card's first visible
   * frame, so the cut lands mid-reveal.
   *
   * Measured: every card in the reference is already partly written on its
   * first frame — 4 words of 11 on one, 2 of 7 on another. The viewer arrives
   * to something already moving instead of to an empty field, which is what
   * ENTRY_FLOOR half-solves for the wordmark today. Honoured only by a grammar
   * that trims at all (`card.length.trimInS > 0`), whose value is the default.
   */
  trimInS?: number;
  /**
   * How the card arrives, overriding the style's `card.enter` (a missing
   * `dist`/`frames` falls back to it). Honoured in every style.
   *
   * Giving the card the direction the previous shot was travelling is what
   * makes a hard cut read as one continuous move interrupted by a content
   * change — the reference does it at four of its eleven cuts. A style with a
   * `sequence.continuity` assigns exactly that when this is left unset; see
   * planSequence in src/lib/style/sequence.ts.
   */
  enter?: CardExit;
  /**
   * How the card leaves, overriding the style's `card.exit` and its
   * `sequence.exitCycle`. Honoured in every style.
   */
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
 * A card's entrance or exit move.
 *
 * The reference varies the axis deliberately — measured across its five
 * sentence cards: slide left (56px, 83px), slide up (54px), scale down (-7%),
 * and twice no move at all. A style carries that rhythm as
 * `sequence.exitCycle`; set this on a card only to break from it.
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
  /**
   * The pill's colour, when it must match the control in the footage rather
   * than the card's ground. A chip card cuts into the clip that presses the
   * real button, so the pill IS that button: agent-skill's Create is a black
   * button, and the classic light ground's white outlined pill stopped matching
   * it (round-3 review) where the old black one had. Absent = the ground's own
   * chip look. Authored, not sampled from the footage: a sample at the rect
   * reads the hover or pressed state, the cursor or the ripple as often as the
   * button, and the two tones cover every control a flow has pressed.
   */
  tone?: ChipTone;
};

export const CHIP_TONES = ["dark", "light"] as const;
export type ChipTone = (typeof CHIP_TONES)[number];

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
 * The control and the `==highlight==` pill, for a ground that does not name
 * its own. A marker-style highlight reads as a solid warm swatch with dark ink
 * on any ground, so the default is shared; authors override the colour per word.
 */
const CHIP_DEFAULT = {
  fill: "#17191d",
  label: "#f2f3f5",
  rim: "rgba(255,255,255,0.16)",
} as const;
const HIGHLIGHT_DEFAULT = { fill: "#f4d35e", ink: "#101317" } as const;

/**
 * A chip's explicit tone. `dark` is CHIP_DEFAULT, the black pill every chip
 * card wore before the light ground got its own; `light` is the classic light
 * ground's white pill. See IntroChip.tone.
 */
const CHIP_TONE_LOOK: Record<ChipTone, { fill: string; label: string; rim: string }> = {
  dark: CHIP_DEFAULT,
  light: { fill: "#ffffff", label: "#101317", rim: "rgba(15,23,42,0.14)" },
};

/** The look with the chip's own tone, when it names one, over the ground's. */
export function withChipTone(look: IntroLook, tone?: ChipTone): IntroLook {
  if (!tone) return look;
  const t = CHIP_TONE_LOOK[tone];
  return { ...look, chipFill: t.fill, chipLabel: t.label, chipRim: t.rim };
}

/**
 * A card's colours, read from its style's palette and nothing else.
 *
 * There used to be a second source: a branch on `look` that carried the
 * full-bleed palette as constants here, beside the identical copy in the
 * preset, and a framed branch that ignored the classic preset's palette
 * entirely. Two records of one colour is how they drift; the preset is now the
 * only one. See PaletteStyle.
 */
export function introLook(
  background: IntroBackground,
  palette: PaletteStyle,
): IntroLook {
  const g = palette[background];
  const chip = g.chip ?? CHIP_DEFAULT;
  const highlight = g.highlight ?? HIGHLIGHT_DEFAULT;
  return {
    ground: g.ground,
    headline: g.ink,
    subhead: g.muted,
    wordmark: g.wordmark ?? g.muted,
    chipFill: chip.fill,
    chipLabel: chip.label,
    chipRim: chip.rim,
    highlightBg: highlight.fill,
    highlightInk: highlight.ink,
    flat: !g.backdrop,
    columnFrac: g.backdrop ? COLUMN_FRAC_PLATE : COLUMN_FRAC_FLAT,
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
 * The mark's turn, when the style's bookend has one (`bookend.tumbleS` and
 * `turns`; the measurement behind both is in src/lib/style/base.ts).
 *
 * AXIS. Not a cardinal one. A cube spun about x or y alone never shows the
 * corner-on hexagon that the reference's frames 6-9 clearly are; a tilted axis
 * does. (1, 1, 0) is the simplest tilt that reproduces the sequence.
 */
export const LOGO_TUMBLE_AXIS: readonly [number, number, number] = [1, 1, 0];
/**
 * Perspective distance in design px. Three times the mark's own height: enough
 * for the near edge to read as nearer without the barrelling that a short
 * perspective gives a plane at 45 degrees.
 */
export const LOGO_PERSPECTIVE = 276;

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

/**
 * When each element of a recap card lands, in seconds from its first frame.
 * The cadence is the style's `recap` group; see src/RecapCard.tsx for the
 * layout it is measured against.
 */
export function recapSchedule(
  n: number,
  recap: RecapStyle,
): { markS: number; wordmarkS: number; itemsS: number[] } {
  const markS = recap.leadS;
  const wordmarkS = markS + recap.lockupStaggerS;
  const first = wordmarkS + recap.itemsLeadS;
  return {
    markS,
    wordmarkS,
    itemsS: Array.from({ length: n }, (_, i) => first + i * recap.itemStaggerS),
  };
}

/** Seconds of card needed for `n` items, before any exit push. */
export function recapDurationS(
  n: number,
  recap: RecapStyle,
  holdS: number = 1.23,
): number {
  const { wordmarkS, itemsS } = recapSchedule(Math.max(1, n), recap);
  return (n > 0 ? itemsS[itemsS.length - 1] : wordmarkS + recap.itemsLeadS) + holdS;
}

/**
 * Stagger that lands the last word in time for the full hold.
 *
 * Returns the cadence's own stagger when the copy already fits, so short cards
 * keep the unhurried rhythm and only long ones tighten — and always when the
 * grammar sets no ceiling (`maxS: null`), since then nothing needs fitting.
 */
export function fittedStagger(
  wordCount: number,
  trimInS: number,
  cadence: WordCadence = STYLE_PRESETS.proof.card.cadence,
  length: CardLength = STYLE_PRESETS.proof.card.length,
): number {
  // The ceiling and floor come from the grammar being fitted — a second fitted
  // style must not silently inherit Film A's card band.
  // A typewriter has no word stagger to fit — it runs at a constant character
  // rate and its length falls out of the copy. Returning 0 keeps this callable
  // from a shared path without the caller having to know the kind.
  if (cadence.kind === "typed") return 0;
  const maxStaggerS = cadence.staggerS;
  const minStaggerS = cadence.kind === "fitted" ? cadence.minStaggerS : maxStaggerS;
  const beats = wordCount - 1;
  if (beats <= 0 || length.maxS == null) return maxStaggerS;
  const room = length.maxS - length.holdS + trimInS;
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

/**
 * The accelerating half of the move-rest-move ramp: the Film-A-era answer to a
 * card that must still be moving when the cut lands, without travelling.
 *
 * Only the EXIT ramps. With a written headline the card has to be genuinely
 * still BETWEEN word arrivals, or the words land on a drifting field and the
 * writing stops reading as writing. Measured, an in-ramp kept per-frame change
 * at 74-250 throughout; the reference sits at 2-12 between its arrivals and
 * spikes to 255 on each one. Putting the whole ramp on the exit gives both: a
 * still card while it writes, and a camera already moving when the cut lands.
 */
const easeIn = (x: number): number => x * x;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Scale of the card's content at `tS` under a `ramp` exit: 1 while the copy
 * writes and is read, then accelerating by `ramp.scale` into the cut over the
 * last `ramp.durationS` — still accelerating at the final frame, so the frame
 * the cut lands on has velocity. Same reasoning as punchEase.
 *
 * The rest runs from `settledS` — when the last word has landed — to the start
 * of the ramp. On a card too short to contain both, the ramp starts at
 * `settledS` and there is no rest; that is a signal the card needs a longer
 * hold, not a reason to shorten the ramp.
 */
export const pushAt = (
  tS: number,
  settledS: number,
  totalS: number,
  ramp: { scale: number; durationS: number },
): number => {
  if (!(totalS > 0)) return 1;
  const outStart = Math.max(settledS, totalS - ramp.durationS);
  const outP = easeIn(
    totalS > outStart ? clamp01((tS - outStart) / (totalS - outStart)) : 0,
  );
  return 1 + ramp.scale * outP;
};

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
  /**
   * This unit is TYPED — revealed one character at a time across its own
   * [startS, endS) — rather than arriving whole.
   *
   * A flag on the cue and not a style name, so the renderer dispatches on data.
   * Chip units never carry it: the reference expands its pill in the gap the
   * typing leaves rather than typing the pill's own letters.
   */
  typed?: boolean;
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
  /** Seconds per character. Set only by a `typed` cadence; see WordCue.typed. */
  perCharS?: number,
): WordCue[] {
  // parseHeadline already yields the units in order — including the {chip} as a
  // single unit in sentence position — each carrying its own inline style.
  //
  // A tight unit (trailing punctuation split off a marked word) shares the beat
  // of the word before it rather than taking its own: it appears WITH the word,
  // and it does not lengthen the card. `step` is the stagger index, advanced
  // once per visible beat, so `*Markdown*.` writes exactly like `Markdown.`.
  let step = -1;
  // Character clock for a typewriter. It advances over EVERY unit including the
  // chip, so the pill lands where its letters would have and the sentence does
  // not jump when it arrives.
  let chars = 0;
  return parseHeadline(headline).map((token, index) => {
    if (!(token.tight && index > 0)) step += 1;
    // A typed cue is placed by how many characters precede it, not by which
    // word it is: that is the whole difference between the two schedules.
    // The leading space costs a beat too, or "Your built-in" types faster than
    // it reads. It is charged BEFORE this unit's start, not after the previous
    // one: adding it to the previous token's own length puts the space inside
    // that token's typing window, and every unit after the first then starts
    // one character early.
    if (perCharS != null && !(index === 0 || token.tight)) chars += 1;
    const at =
      perCharS != null
        ? startS + chars * perCharS
        : startS + step * staggerS;
    const own = perCharS != null ? token.text.length * perCharS : 0;
    if (perCharS != null) chars += token.text.length;
    const cue: WordCue = {
      // The chip cue keeps CHIP_TOKEN as its word so existing callers and tests
      // that look for the token by value still find it, whatever punctuation was
      // welded to it in the copy.
      word: token.chip ? CHIP_TOKEN : token.text,
      index,
      startS: at,
      // A typed unit's window is its OWN typing time, so progressAt returns
      // linear progress through its characters. Everything else keeps the fade.
      endS: at + (perCharS != null && !token.chip ? own : fadeS),
    };
    if (token.style) cue.style = token.style;
    // A HIGHLIGHTED UNIT DOES NOT TYPE, for the same reason the {chip} unit
    // does not: its pill is a filled box, so typing inside it paints the box
    // first and the letters afterwards — measured on the first agent-tool cut,
    // where the payoff card showed two empty yellow rectangles for half a
    // second before any text arrived. The reference does the opposite: at f867
    // its sentence reads "Your ______" with a blank rule, and the pill expands
    // into that gap already carrying its word.
    //
    // So a pill arrives whole, on the beat the typewriter reaches it.
    if (perCharS != null && !token.chip && !token.style?.highlight)
      cue.typed = true;
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
  // Everything below reads FIELDS off the resolved choreography preset. There is
  // deliberately no `if (style === ...)` here — see src/lib/style.ts for why.
  const preset = resolveStylePreset(intro);

  // A recap card is a list on a timer, not a sentence: its length comes from
  // how many items it has to show, and it has no word schedule at all.
  if (intro.items?.length) {
    const totalS = recapDurationS(intro.items.length, preset.recap, intro.holdS);
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

  const { cadence, length } = preset.card;

  // A grammar that cuts INTO the reveal starts the word clock before frame 0, so
  // the first few words are already out. A negative start is the whole mechanism
  // — progressAt clamps, so words cued before 0 read as complete on the first
  // frame with no special case anywhere downstream.
  //
  // A grammar with no trim ignores an authored `trimInS` rather than honouring
  // it, which is what the framed look has always done; changing that would move
  // cards in the back catalogue.
  const authoredTrimS = length.trimInS > 0 ? (intro.trimInS ?? length.trimInS) : 0;

  // A wordmark already puts something on screen at frame 0, so the headline can
  // take its beat. Without one, waiting means opening on an empty field.
  const leadS = intro.wordmark ? HEADLINE_START_S : HEADLINE_LEAD_S;
  const schedule = (trimS: number): WordCue[] =>
    wordSchedule(
      intro.headline,
      leadS - trimS,
      cadence.kind === "fitted"
        ? fittedStagger(wordsOf(intro.headline).length, trimS, cadence, length)
        : cadence.kind === "typed"
          ? 0
          : cadence.staggerS,
      cadence.fadeS,
      cadence.kind === "typed" ? cadence.perCharS : undefined,
    );
  // `openOn` lengthens the trim until that many units are already complete on
  // the first frame — for a typewriter, where the time a word takes depends on
  // the word. Measured on the untrimmed schedule: trimming by a unit's end time
  // puts that end exactly on frame 0. A logo card's headline is its lockup,
  // which is not written from this schedule, so it is exempt.
  const units = wordsOf(intro.headline).length;
  const opening =
    length.openOn > 0 && !intro.logo
      ? schedule(0)[Math.min(length.openOn, units) - 1]
      : undefined;
  const trimInS = Math.max(authoredTrimS, opening?.endS ?? 0);
  const words = schedule(trimInS);
  const last = words[words.length - 1];
  // An empty headline still has to produce a coherent schedule, or Studio
  // cannot open a half-written storyboard.
  const lastStartS = last ? last.startS : leadS - trimInS;
  const lastEndS = last ? last.endS : leadS - trimInS;

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
        const punchStartS = travelStartS + preset.chip.leadS;
        const punchEndS = punchStartS + preset.chip.punchS;
        const pressS = punchEndS + preset.chip.settleS;
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
    totalS: chip ? chip.pressS + preset.chip.afterPressS : outStartS,
    chip,
  };
}

/**
 * Everything src/Intro.tsx and src/RecapCard.tsx take from the style, resolved
 * once and in one place.
 *
 * Pure, so the renderers read no preset fields of their own — which is what
 * lets style.test.ts check that every field a preset carries is read by
 * something, by running this rather than rendering a frame.
 */
export type CardRender = {
  /** Colours, from the style's palette. */
  look: IntroLook;
  /** Flat, full-bleed grammar: no backdrop, a larger logo settle, balanced wraps. */
  fullbleed: boolean;
  /** Whether inline `==markup==` renders; see CardStyle.emphasis. */
  emphasis: boolean;
  /** The card's travel, or undefined for a card that does not travel. */
  push: PushSpec | undefined;
  /**
   * The style's scale ramp into the cut, or null. Dropped when the card
   * travels out instead — an authored exit replaces the style's.
   */
  ramp: { scale: number; durationS: number } | null;
  /** Residual rise after a logo card's entrance; see BookendStyle. */
  drift: { pxPerFrame: number; frames: number };
  type: { sizePx: number; lineHeight: number; letterSpacing: string; fontFamily: string };
  lockup: {
    tumbleS: number;
    turns: number;
    letterSpacing: string;
    solo: MarkSolo | null;
  };
  punchScale: number;
  recap: RecapStyle;
};

export function resolveCard(intro: IntroStoryboard): CardRender {
  const preset = resolveStylePreset(intro);
  const { card, bookend } = preset;
  const pEnter = card.enter.kind === "push" ? card.enter : null;
  const pExit = card.exit.kind === "push" ? card.exit : null;
  // A card's own enter/exit override its style's, field by field — an authored
  // axis with no distance travels the style's distance. Honoured in EVERY
  // style: a card that authors a move on a grammar whose cards hold still has
  // said it wants to move, and ignoring that silently was the old behaviour.
  const travels = pEnter || pExit || intro.enter || intro.exit;
  const push: PushSpec | undefined = travels
    ? {
        in: {
          axis: intro.enter?.axis ?? pEnter?.axis ?? "none",
          dist: intro.enter?.dist ?? pEnter?.dist ?? 0,
          frames: intro.enter?.frames ?? pEnter?.frames ?? 0,
        },
        out: {
          axis: intro.exit?.axis ?? pExit?.axis ?? "none",
          dist: intro.exit?.dist ?? pExit?.dist ?? 0,
          frames: intro.exit?.frames ?? pExit?.frames ?? 0,
        },
      }
    : undefined;
  const ramp =
    card.exit.kind === "ramp" && !(push?.out && push.out.axis !== "none")
      ? { scale: card.exit.scale, durationS: card.exit.durationS }
      : null;
  return {
    look: introLook(intro.background ?? card.background, preset.palette),
    fullbleed: preset.look === "fullbleed",
    emphasis: card.emphasis,
    push,
    ramp,
    drift: { pxPerFrame: bookend.driftPxPerFrame, frames: bookend.driftFrames },
    type: {
      sizePx: preset.type.sizePx,
      lineHeight: preset.type.lineHeight,
      letterSpacing: preset.type.letterSpacing,
      fontFamily: preset.type.fontFamily,
    },
    lockup: {
      tumbleS: bookend.tumbleS,
      turns: bookend.turns,
      letterSpacing: bookend.letterSpacing,
      solo: bookend.markSolo,
    },
    punchScale: preset.chip.punchScale,
    recap: preset.recap,
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
 * Composition size for a card cut next to <name>'s demo footage.
 *
 * DUPLICATED from the DemoClip block in src/Root.tsx, on purpose: that block is
 * the demo's contract and is left byte-identical, so the two cannot share a
 * call without editing it. The duplication is pinned by a test.
 */
export function compositionSize(log: ClickLog): {
  width: number;
  height: number;
} {
  const aspect = log.viewport.height / log.viewport.width;
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(OUTPUT_WIDTH), height: even(OUTPUT_WIDTH * aspect) };
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
    if (intro.chip.tone !== undefined && !CHIP_TONES.includes(intro.chip.tone))
      return `\`chip.tone\` must be one of ${CHIP_TONES.map((t) => `"${t}"`).join(", ")}`;
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
