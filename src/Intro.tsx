import React from "react";
import { loadFonts } from "./lib/font";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "./Backdrop";
import { Cursor } from "./Cursor";
import { ShutterBlur } from "./ShutterBlur";
import { cameraEase, poseToCss } from "./lib/camera";
import { DESIGN_WIDTH } from "./lib/click-log";
import { cornerTravelPx, groupsFor, shutterFraction, type GroupPose } from "./lib/shutter";
import {
  cardPointerLog,
  CHIP_AT,
  flooredEntry,
  headlineParts,
  introTiming,
  LOGO_FILE,
  LOGO_IN_S,
  LOGO_IN_SCALE,
  LOGO_PERSPECTIVE,
  LOGO_RISE,
  LOGO_TUMBLE_AXIS,
  parseHeadline,
  progressAt,
  punchEase,
  pushAt,
  readableInk,
  resolveCard,
  WORDMARK_IN_S,
  type CardRender,
  type ChipTiming,
  type IntroChip,
  withChipTone,
  type IntroLook,
  type IntroStoryboard,
  type StyledToken,
  type WordStyle,
} from "./lib/intro";
import { pushEnvelope, pushToCss } from "./lib/push";
import { isNativeAspect, type Aspect } from "./lib/aspect";
import { OUTPUT_WIDTH } from "./lib/click-log";
import { RecapCard } from "./RecapCard";
import { DesignWidthContext } from "./WindowFrame";

export type IntroProps = {
  intro: IntroStoryboard;
  /**
   * Output aspect of the reel this card is cut into. Absent = 16:9. The
   * composition takes its size from it (src/Root.tsx); the card lays out
   * against the 16:9 width, so type is the same pixel size in every aspect and
   * the lines rewrap to the narrower column. See src/lib/aspect.ts.
   */
  aspect?: Aspect;
};

/**
 * Same convention as DemoClip: every px below is written at DESIGN_WIDTH — of
 * the 16:9 frame, which DesignWidthContext names at any other aspect.
 */
const useDesignScale = (): number => {
  const override = React.useContext(DesignWidthContext);
  const { width } = useVideoConfig();
  return (override ?? width) / DESIGN_WIDTH;
};

/** Left inset of the text column. */
const MARGIN_X = 168;
/**
 * Logo sign-off lockup: mark and wordmark on ONE line. The mark height is set
 * a touch above the wordmark's cap so the two read as a pair rather than the
 * mark towering over the text.
 */
const LOGO_TEXT_SIZE = 84;
const LOGO_MARK_SIZE = 92;
const LOGO_GAP = 22;
/** Per-character writing reveal of the wordmark, in seconds. */
const WRITE_CHAR_STAGGER = 0.06;
const WRITE_CHAR_IN = 0.09;
/**
 * Smaller on a chip card, because that sentence has to fit one line — see
 * CHIP_MAX_CHARS. The chip is sized from this, so both scale together.
 */
const CHIP_HEADLINE_SIZE = 88;
const SUBHEAD_SIZE = 34;
const WORDMARK_SIZE = 21;
/**
 * Backdrop drift, landing at exactly 1.0 on the final frame.
 *
 * The end value is the point: DemoClip draws this same plate at rest, so a card
 * that arrives at 1.0 cuts into the demo with the backdrop already matching
 * pixel for pixel. Starting slightly wide gives the still hold some life
 * without ever moving the frame the cut lands on.
 */
const DRIFT_FROM = 1.04;

/**
 * Rise distance for a line coming in, in ems of its own size.
 *
 * Used by the wordmark and subhead, which still fade up as labels. The headline
 * does NOT rise — its words are written, appearing complete in one frame. See
 * WORD_IN_S.
 */
const RISE_EM = 0.35;

/** Default headline weight — normal, not bold. Words opt into bold per-word. */
const HEADLINE_WEIGHT = 400;

/**
 * The CSS a single word wears from its inline markup.
 *
 * Sizes are in em so they ride the headline's own scale — no `k` needed. A
 * highlight is a solid pill drawn on the word itself: `box-decoration-break:
 * clone` keeps the rounded ends and padding if the word ever wraps a line.
 */
function wordCss(
  style: WordStyle | undefined,
  look: IntroLook,
): React.CSSProperties {
  if (!style) return {};
  const css: React.CSSProperties = {};
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = "italic";
  if (style.highlight) {
    const custom = typeof style.highlight === "string";
    css.background = custom ? (style.highlight as string) : look.highlightBg;
    css.color = custom
      ? readableInk(style.highlight as string)
      : look.highlightInk;
    css.padding = "0.02em 0.2em";
    css.borderRadius = "0.14em";
    (css as { boxDecorationBreak?: string }).boxDecorationBreak = "clone";
  }
  return css;
}

type LineProps = {
  progress: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const Line: React.FC<LineProps> = ({ progress, children, style }) => (
  <div
    style={{
      opacity: progress,
      transform: `translateY(${(1 - progress) * RISE_EM}em)`,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * A short label rendered with the same inline markup as a headline, but as ONE
 * unit — no per-word timing. Used for the wordmark, so `==Acme==` (or a bold /
 * italic brand lockup) works with exactly the vocabulary the headline uses.
 * Spacing is a leading margin, matching the headline, so tight punctuation hugs.
 */
/**
 * One unit revealed a CHARACTER at a time across its own cue window.
 *
 * Untyped characters keep their box (`visibility`, not `display`), so the line
 * is laid out at its FINAL width from the first frame and the sentence grows
 * rightward into a block that never reflows. The reference does exactly this —
 * its first letter sits at x=331 and the finished line starts at x=317, i.e.
 * the copy was already holding its place.
 *
 * `p` is linear over the unit's typing window, so `floor(p * length)` is the
 * character count with no easing: a typewriter runs at a constant rate.
 */
const Typed: React.FC<{ text: string; p: number }> = ({ text, p }) => {
  const shown = Math.floor(Math.max(0, Math.min(1, p)) * text.length);
  return (
    <>
      {[...text].map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          style={{ visibility: i < shown ? "visible" : "hidden" }}
        >
          {ch}
        </span>
      ))}
    </>
  );
};

const StyledInline: React.FC<{ text: string; look: IntroLook }> = ({
  text,
  look,
}) => (
  <>
    {parseHeadline(text).map((token, i) => (
      <span
        key={`${i}-${token.text}`}
        style={{
          display: "inline-block",
          marginLeft: i === 0 || token.tight ? 0 : "0.26em",
          ...wordCss(token.style, look),
        }}
      >
        {token.text}
      </span>
    ))}
  </>
);

/**
 * Brand sign-off: the mark and the wordmark on ONE line, at one size.
 *
 * The mark fades and scales in first (floored, so frame 0 already carries it),
 * then the wordmark WRITES in a character at a time — a short per-letter reveal
 * that reads as the name being drawn next to the mark. Sized so the mark sits
 * just above the wordmark's cap height rather than dwarfing it.
 *
 * A vertical mark-over-name-over-tagline stack was tried here, measured against
 * the reference's own bookend (41.4% of frame width, 33.0% of height, a third
 * line carrying the URL) and REJECTED on how it looked. One row is the lockup.
 */
const LogoLockup: React.FC<{
  text: string;
  look: IntroLook;
  k: number;
  tS: number;
  fullbleed: boolean;
  /** The style's bookend: the mark's turn, its solo phase, the tracking. */
  lockup: CardRender["lockup"];
}> = ({ text, look, k, tS, fullbleed, lockup }) => {
  const { solo } = lockup;
  // Full-bleed runs a longer, larger settle. The framed 0.92 -> 1.0 nudge over
  // 0.45s reads as a fade with a hint of scale; the reference's mark travels a
  // factor of 1.57 over ~0.63s, which is what gives the opening something to
  // watch instead of something to land on.
  const inS = solo ? solo.growS : fullbleed ? LOGO_IN_S : WORDMARK_IN_S;
  const markP = flooredEntry(
    cameraEase(progressAt({ startS: 0, endS: inS }, tS)),
  );
  const markScale = fullbleed
    ? LOGO_IN_SCALE + (1 - LOGO_IN_SCALE) * markP
    : 0.92 + 0.08 * markP;
  // Rises as it shrinks, so the two read as one move rather than two.
  const markRise = fullbleed ? (1 - markP) * LOGO_RISE * k : 0;
  // The style's turn, on its own longer clock than the scale so the mark is
  // still resolving after it has finished travelling. A style with no turn
  // (`turns: 0`, the framed lockup's quieter 0.92 -> 1.0 nudge) gets no
  // rotate3d at all rather than a zero one.
  const tumbleP = cameraEase(
    progressAt({ startS: 0, endS: lockup.tumbleS }, tS),
  );
  const spin = lockup.turns * 360 * (1 - tumbleP);
  const [ax, ay, az] = LOGO_TUMBLE_AXIS;
  // perspective() must lead the function list, and rotate3d has to sit INSIDE
  // scale so the mark turns about its own centre rather than about the point it
  // is scaling toward.
  const markSpin =
    lockup.turns > 0
      ? ` perspective(${LOGO_PERSPECTIVE * k}px) rotate3d(${ax}, ${ay}, ${az}, ${spin}deg)`
      : "";
  // THE SOLO PHASE. Off unless the style asks for it, and when it is off every
  // value below collapses to what this component did before it existed.
  //
  // `soloP` is the DEMOTION's progress: 0 while the mark is growing and holding
  // alone, then 0 -> 1 as it shrinks to lockup size. Eased on the same curve
  // the rest of the film uses, so the mark does not arrive on a different
  // clock from everything around it.
  const soloP = solo
    ? cameraEase(
        progressAt(
          { startS: solo.growS + solo.holdS, endS: solo.growS + solo.holdS + solo.settleS },
          tS,
        ),
      )
    : 1;
  // Magnification on TOP of the normal entry scale, so the mark still arrives
  // the way it always did — it just arrives much bigger and then shrinks.
  const soloScale = solo ? 1 + (solo.scale - 1) * (1 - soloP) : 1;
  // Slide the whole lockup right by a fraction of its OWN width, which is what
  // puts the mark — sitting at the lockup's left end — in the centre of frame
  // while it is alone. A percentage translate resolves against the element's
  // own width, so this needs no measurement at render time.
  const soloShift = solo ? solo.shiftFrac * (1 - soloP) * 100 : 0;

  // The wordmark starts once the mark is mostly in — or, with a solo phase,
  // not until the mark has finished holding the frame by itself.
  const writeStart = solo ? solo.growS + solo.holdS : inS * 0.6;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: LOGO_GAP * k,
        transform: soloShift ? `translateX(${soloShift}%)` : undefined,
      }}
    >
      <Img
        src={staticFile(LOGO_FILE)}
        style={{
          height: LOGO_MARK_SIZE * k,
          width: "auto",
          opacity: markP,
          transform: `translateY(${markRise}px) scale(${markScale * soloScale})${markSpin}`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: LOGO_TEXT_SIZE * k,
          fontWeight: HEADLINE_WEIGHT,
          letterSpacing: lockup.letterSpacing,
          // Comes from the palette in both looks now, so a light full-bleed
          // bookend gets dark ink without a second branch. See introLook.
          color: look.headline,
        }}
      >
        {[...text].map((ch, i) => {
          const startS = writeStart + i * WRITE_CHAR_STAGGER;
          const p = cameraEase(
            progressAt({ startS, endS: startS + WRITE_CHAR_IN }, tS),
          );
          return (
            <span key={`${i}-${ch}`} style={{ opacity: p, whiteSpace: "pre" }}>
              {ch}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/**
 * The control set into a chip card's sentence.
 *
 * HARD-EDGED ELEVATION ONLY — flat fill and a 1px rim, never a blurred shadow.
 * The punch runs inside ShutterBlur, and the banding rule in WindowFrame.tsx
 * is absolute: N composited copies of a soft gradient each round to 8 bits and
 * stairstep it. A `box-shadow: 0 2px 8px` here would band on exactly the frames
 * the whole move exists for.
 */
const Chip: React.FC<{ label: string; look: IntroLook; k: number }> = ({
  label,
  look,
  k,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      background: look.chipFill,
      color: look.chipLabel,
      borderRadius: 10 * k,
      padding: `${8 * k}px ${20 * k}px`,
      boxShadow: `0 0 0 ${k}px ${look.chipRim}`,
      // Close to the sentence size, a touch under. A control set into a line of
      // type reads as part of the sentence only if it shares its weight; much
      // smaller and it reads as a footnote sitting in a box.
      fontSize: CHIP_HEADLINE_SIZE * 0.86 * k,
      fontWeight: 550,
      letterSpacing: "-0.01em",
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </span>
);

/**
 * A sentence with a live control in the middle of it.
 *
 * WHY A THREE-COLUMN GRID. The camera has to punch about the chip's centre, so
 * that centre must be known without measuring the DOM — a measured value would
 * be re-read per frame in every render worker and would depend on the system
 * font stack above, whose glyph advances differ between machines, while the reel
 * cache hashes source contents precisely so a cached segment can never disagree
 * with the code that drew it.
 *
 * `1fr auto 1fr` solves it outright: the outer columns are equal by definition,
 * so the middle column is centred whatever the words either side weigh. The chip
 * sits at the frame's centre by construction, which is why CHIP_AT is a constant
 * and not an author knob. An earlier version anchored the sentence to an
 * authored point and offset each side by 0.5em — which collides, because a chip
 * is ~200px wide and half of it lands on top of the text.
 */
const ChipSentence: React.FC<{
  intro: IntroStoryboard;
  chip: IntroChip;
  look: IntroLook;
  k: number;
  tS: number;
  words: { word: string; index: number; startS: number; endS: number }[];
}> = ({ intro, chip, look, k, tS, words }) => {
  // Hooks before the early return.
  const reflowing = React.useContext(DesignWidthContext) != null;
  const { width } = useVideoConfig();
  const parts = headlineParts(intro.headline);
  if (!parts) return null;
  // At another aspect the row can be wider than the frame: `1fr auto 1fr`
  // needs each side as wide as the WIDER one, and "Hit [Create]. It's live."
  // at 117px measures ~1800px against a 1440 frame's 992px column. Then the
  // sentence stacks (below). Estimated, not measured, for the reason the grid
  // exists: see above. Native keeps its row whatever the copy.
  const em = CHIP_HEADLINE_SIZE * k * 0.52;
  const sideW = (toks: StyledToken[], extra = "") =>
    (toks.map((t) => t.text).join(" ").length + extra.length) * em;
  const rowW =
    2 * Math.max(sideW(parts.before), sideW(parts.after, parts.tail ?? "")) +
    (chip.label.length * 0.86 * em + 40 * k);
  const stack = reflowing && rowW > width - 2 * MARGIN_X * k;

  const cueFor = (index: number) => {
    const cue = words[index];
    return cue ? progressAt(cue, tS) : 1;
  };
  const unit = (
    token: StyledToken,
    index: number,
    key: string,
    groupIndex: number,
  ) => {
    const p = cueFor(index);
    return (
      <span
        key={key}
        style={{
          display: "inline-block",
          // Leading margin, matching the plain headline: the first word of the
          // group and any tight punctuation get none. The gap between a group
          // and the chip is the column padding / the tail's &nbsp;.
          marginLeft: groupIndex === 0 || token.tight ? 0 : "0.26em",
          visibility: p > 0 ? "visible" : "hidden",
          ...wordCss(token.style, look),
        }}
      >
        {token.text}
      </span>
    );
  };

  const chipIndex = parts.before.length;
  const chipP = cueFor(chipIndex);
  const type: React.CSSProperties = {
    fontSize: CHIP_HEADLINE_SIZE * k,
    fontWeight: HEADLINE_WEIGHT,
    letterSpacing: "-0.022em",
    color: look.headline,
    whiteSpace: "nowrap",
  };

  if (stack) {
    // The same sentence as three ROWS — "Hit" / [Create]. / "It's live." —
    // on `1fr auto 1fr`, which centres the chip vertically by the argument
    // that centres it horizontally in the row form. The punctuation straight
    // after the control hangs off its right edge, out of flow, so it cannot
    // pull the chip off CHIP_AT.
    return (
      <AbsoluteFill
        style={{
          display: "grid",
          gridTemplateRows: "1fr auto 1fr",
          justifyItems: "center",
          padding: `0 ${MARGIN_X * k}px`,
        }}
      >
        <div
          style={{ ...type, whiteSpace: "normal", textAlign: "center", alignSelf: "end", paddingBottom: "0.2em" }}
        >
          {parts.before.map((tok, i) => unit(tok, i, `b${i}`, i))}
        </div>
        <div style={{ position: "relative", visibility: chipP > 0 ? "visible" : "hidden" }}>
          <Chip label={chip.label} look={withChipTone(look, chip.tone)} k={k} />
          {parts.tail ? (
            <span
              style={{ ...type, position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)" }}
            >
              {parts.tail}
            </span>
          ) : null}
        </div>
        <div
          style={{ ...type, whiteSpace: "normal", textAlign: "center", alignSelf: "start", paddingTop: "0.2em" }}
        >
          {parts.after.map((tok, i) => unit(tok, chipIndex + 1 + i, `a${i}`, i))}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        padding: `0 ${MARGIN_X * k}px`,
      }}
    >
      <div style={{ ...type, textAlign: "right", paddingRight: 0.3 + "em" }}>
        {parts.before.map((tok, i) => unit(tok, i, `b${i}`, i))}
      </div>
      <div
        style={{
          // The control is written into the sentence like every other unit —
          // it appears complete, in place, in one frame.
          visibility: chipP > 0 ? "visible" : "hidden",
        }}
      >
        <Chip label={chip.label} look={withChipTone(look, chip.tone)} k={k} />
      </div>
      <div
        style={{
          ...type,
          textAlign: "left",
          // No gap when the sentence punctuates straight after the control —
          // "Hit [Create] ." reads as a typo. The space then comes after the
          // period, where it belongs.
          paddingLeft: parts.tail ? 0 : 0.3 + "em",
        }}
      >
        {parts.tail ? <span>{parts.tail}&nbsp;</span> : null}
        {parts.after.map((tok, i) => unit(tok, chipIndex + 1 + i, `a${i}`, i))}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Title card played before or between demo clips.
 *
 * Rendered as its own composition and concatenated by scripts/stitch.ts rather
 * than sequenced inside DemoClip: the camera track and the drawn cursor both
 * map frame -> time as (frame/fps)*speed with t=0 at the first demo frame, so
 * prepending frames inside that composition would desync both.
 *
 * ShutterBlur is mounted ONLY for a chip card. An 8x push in 0.42s strobes
 * without a shutter, but the blur is the dominant cost of a render and every
 * other card has no fast move to blur — so plain cards keep their zero-blur
 * path and render in seconds.
 */
export const Intro: React.FC<IntroProps> = ({ intro, aspect }) => {
  // Registered here, at the one entrance both card kinds pass through, so no
  // card can render before the face it names is usable. Idempotent.
  loadFonts();
  // A recap card shares nothing with a sentence card but its palette — it is
  // left-aligned, top-anchored, and reveals whole labels rather than words — so
  // it gets its own component rather than a branch through this one.
  const card = intro.items?.length ? (
    <RecapCard intro={intro} />
  ) : (
    <SentenceCard intro={intro} />
  );
  // Native renders exactly as before: no provider, the frame's own width.
  if (isNativeAspect(aspect)) return card;
  return (
    <DesignWidthContext.Provider value={OUTPUT_WIDTH}>{card}</DesignWidthContext.Provider>
  );
};

const SentenceCard: React.FC<IntroProps> = ({ intro }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = useDesignScale();
  const tS = frame / fps;
  const t = introTiming(intro);
  const style = resolveCard(intro);
  const { look, fullbleed, emphasis } = style;

  // Floored: the film's first frame is a card, and it must not be an empty field.
  const wordmarkP = flooredEntry(
    cameraEase(progressAt({ startS: 0, endS: WORDMARK_IN_S }, tS)),
  );
  const subheadP = cameraEase(
    progressAt({ startS: t.subheadStartS, endS: t.subheadEndS }, tS),
  );
  // No fade. The card is cut while fully on screen and still moving — see
  // introTiming. What keeps it moving is the style's: a travel on the push
  // envelope (the reference's five sentence cards leave by slide left, slide
  // up and scale down, never all by the same move — see `sequence` in the
  // style), a scale ramp into the cut (classic), or nothing at all (a grammar
  // whose cards are pixel-locked). resolveCard dispatches on `kind`, never on
  // the style.
  const totalFrames = Math.max(1, Math.ceil(t.totalS * fps));
  const spec = style.push;
  const envelope = pushEnvelope(frame, totalFrames, spec);
  // F4: residual drift, LOGO CARD ONLY. The reference's opening keeps creeping
  // at ~2px/frame for half a second after it settles, so the frame never goes
  // dead on the shot the viewer arrives on. Its sentence cards do go dead, so
  // this is deliberately not applied to them.
  // Gated on the ENVELOPE, not the look: a grammar whose cards do not travel
  // has no settle for a drift to trail out of.
  if (spec && intro.logo) {
    const after = frame - (spec.in?.frames ?? 0);
    if (after > 0)
      envelope.y -= Math.min(after, style.drift.frames) * style.drift.pxPerFrame;
  }
  const ramp = style.ramp ? pushAt(tS, t.settledS, t.totalS, style.ramp) : 1;
  const transform = spec
    ? pushToCss({ ...envelope, scale: envelope.scale * ramp }, k)
    : `scale(${ramp})`;
  // Full-bleed has no backdrop plate to drift, by design.
  const drift = DRIFT_FROM + (1 - DRIFT_FROM) * cameraEase(tS / t.totalS);

  const body = (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${MARGIN_X * k}px`,
        transform,
        fontFamily: style.type.fontFamily,
      }}
    >
      <div style={{ maxWidth: width * look.columnFrac, textAlign: "center" }}>
        {intro.logo ? (
          // A logo card IS the lockup — mark + wordmark on one line, the wordmark
          // written in. It replaces the normal wordmark/headline/subhead stack,
          // so the headline copy ("Acme") becomes the lockup's text.
          <LogoLockup
            text={intro.headline}
            look={look}
            k={k}
            tS={tS}
            fullbleed={fullbleed}
            lockup={style.lockup}
          />
        ) : (
          <>
            {intro.wordmark ? (
          <Line
            progress={wordmarkP}
            style={{
              fontSize: WORDMARK_SIZE * k,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: look.wordmark,
              marginBottom: 28 * k,
            }}
          >
            <StyledInline text={intro.wordmark} look={look} />
          </Line>
        ) : null}
        <div
          style={{
            // The style owns the type scale. See TypeStyle in src/lib/style.ts
            // for why it is specified by rendered metrics rather than by
            // nominal size, and for where the four reference films sit.
            fontSize: style.type.sizePx * k,
            fontWeight: HEADLINE_WEIGHT,
            letterSpacing: style.type.letterSpacing,
            lineHeight: style.type.lineHeight,
            color: look.headline,
            // BALANCED, not greedy. The reference does not fill each line to the
            // column before wrapping: on its 3-line card the lines run 54%/52%/47%
            // of the available column, and on its 2-line card line 2 (1216px) is
            // WIDER than line 1 (1026px) — which greedy filling cannot produce,
            // since greedy always makes earlier lines the longest. Measured in
            // docs/reel/cursor/03-composition.md.
            //
            // Greedy wrapping is what left "feeds." alone on a line once the type
            // grew to 72px. Balancing fixes that class of break for all copy
            // rather than for one sentence. Full-bleed only: framed runs 96px on
            // 4-6 words and rarely wraps at all.
            ...(fullbleed ? { textWrap: "balance" as const } : {}),
          }}
        >
          {t.words.map((cue, i) => {
            const p = progressAt(cue, tS);
            return (
              <span
                key={`${cue.index}-${cue.word}`}
                style={{
                  display: "inline-block",
                  // Space is drawn as a LEADING margin: the first word and any
                  // tight unit (a trailing period) get none, so the line stays
                  // centred and punctuation hugs its word.
                  marginLeft: i === 0 || cue.tight ? 0 : "0.26em",
                  // A TYPED unit manages its own reveal per character below, so
                  // the unit-level fade and rise are off for it. Applying both
                  // would fade the word in while it was still being typed.
                  opacity: cue.typed ? 1 : p,
                  transform: cue.typed
                    ? undefined
                    : `translateY(${(1 - p) * RISE_EM}em)`,
                  // Per-word inline styling last, so bold/italic/highlight win
                  // over the block defaults for exactly the marked words.
                  //
                  // Except under full-bleed, where highlight is dropped. The
                  // reference uses NO emphasis on any of its five cards — every
                  // word the same ink at the same weight — and on a near-black
                  // ground a marker swatch is the highest-contrast object in
                  // frame, so the eye lands on the decoration before the words.
                  // `==markup==` still parses so copy stays portable between
                  // looks; it just renders as plain ink here.
                  ...wordCss(emphasis ? cue.style : undefined, look),
                }}
              >
                {cue.typed ? <Typed text={cue.word} p={p} /> : cue.word}
              </span>
            );
          })}
        </div>
        {intro.subhead ? (
          <Line
            progress={subheadP}
            style={{
              fontSize: SUBHEAD_SIZE * k,
              fontWeight: 400,
              letterSpacing: "-0.005em",
              color: look.subhead,
              marginTop: 26 * k,
            }}
          >
            {intro.subhead}
          </Line>
            ) : null}
          </>
        )}
      </div>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: look.ground }}>
      {look.flat || fullbleed ? null : (
        <AbsoluteFill style={{ transform: `scale(${drift})` }}>
          <Backdrop name={intro.backdrop} />
        </AbsoluteFill>
      )}
      {intro.chip && t.chip ? (
        <ShutteredChipPunch
          intro={intro}
          style={style}
          chip={intro.chip}
          timing={t.chip}
          look={look}
          k={k}
          words={t.words}
          vp={{ width, height }}
        />
      ) : (
        body
      )}
    </AbsoluteFill>
  );
};

/**
 * The punch layer: the sentence, the pointer, and the camera that pushes into
 * the chip.
 *
 * poseToCss is reused rather than reimplemented, and that buys two properties
 * for free. At scale 1 its clamp forces translate to exactly 0, so the card
 * sits still and un-panned at rest whatever `at` is; and as scale grows the
 * clamp releases continuously, so an off-centre chip pans smoothly onto the
 * frame centre instead of snapping there.
 */
type ChipPunchProps = {
  intro: IntroStoryboard;
  style: CardRender;
  chip: IntroChip;
  timing: ChipTiming;
  look: IntroLook;
  k: number;
  words: { word: string; index: number; startS: number; endS: number }[];
  vp: { width: number; height: number };
};

/** The punch camera at card time `tS`, as poseToCss's scale + translate. */
function chipCss(style: CardRender, timing: ChipTiming, tS: number) {
  const u = progressAt(
    { startS: timing.punchStartS, endS: timing.punchEndS },
    tS,
  );
  const scale = 1 + (style.punchScale - 1) * punchEase(u);
  return poseToCss({ scale, cx: CHIP_AT.x, cy: CHIP_AT.y }, 0, 1);
}

/**
 * The punch under a centred shutter — the same one the demo's window uses, so
 * a sample lands symmetrically about the frame instead of CameraMotionBlur's
 * +0.50…+0.94 (src/lib/shutter.ts).
 *
 * The sample count is decided out here, from how far the layer's fastest corner
 * travels while the shutter is open. The layer is `scale(s) translate(t)`, so a
 * corner sits at size·(½ + s·t ± s/2) — cornerTravelPx's form with the
 * translate pre-multiplied by the scale.
 */
const ShutteredChipPunch: React.FC<ChipPunchProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const at = (f: number): GroupPose => {
    const css = chipCss(props.style, props.timing, Math.max(0, f) / fps);
    return {
      scale: css.scale,
      translateX: css.scale * css.translateX,
      translateY: css.scale * css.translateY,
    };
  };
  const half = shutterFraction() / 2;
  const travel = cornerTravelPx(at(frame - half), at(frame + half), width, height);
  return (
    <ShutterBlur groups={groupsFor(travel)}>
      <ChipPunch {...props} />
    </ShutterBlur>
  );
};

/**
 * Reads its own clock rather than taking `tS` as a prop: ShutterBlur moves the
 * frame each sample sees with <Freeze>, and a time computed by the parent would
 * be the same for every sample. That is how the CameraMotionBlur this replaced
 * drew four identical copies — the punch was never blurred at all.
 */
const ChipPunch: React.FC<ChipPunchProps> = ({
  intro,
  style,
  chip,
  timing,
  look,
  k,
  words,
  vp,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tS = frame / fps;
  const css = chipCss(style, timing, tS);
  return (
    // This card is rendered outside the wrapper that sets the face, so it has
    // to name it itself.
    <AbsoluteFill style={{ fontFamily: style.type.fontFamily }}>
      <AbsoluteFill
        style={{
          transform: `scale(${css.scale}) translate(${css.translateX * 100}%, ${css.translateY * 100}%)`,
        }}
      >
        <ChipSentence
          intro={intro}
          chip={chip}
          look={look}
          k={k}
          tS={tS}
          words={words}
        />
        <Cursor
          log={cardPointerLog(chip, timing, vp)}
          timeS={tS}
          cameraScale={css.scale}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
