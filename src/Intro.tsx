import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { Backdrop } from "./DemoClip";
import { Cursor } from "./Cursor";
import { cameraEase, poseToCss } from "./lib/camera";
import { DESIGN_WIDTH } from "./lib/click-log";
import {
  cardPointerLog,
  CHIP_AT,
  CHIP_PUNCH_SCALE,
  headlineParts,
  flooredEntry,
  introLook,
  introTiming,
  LOGO_FILE,
  parseHeadline,
  progressAt,
  punchEase,
  pushAt,
  readableInk,
  WORDMARK_IN_S,
  type ChipTiming,
  type IntroChip,
  type IntroLook,
  type IntroStoryboard,
  type StyledToken,
  type WordStyle,
} from "./lib/intro";

export type IntroProps = {
  intro: IntroStoryboard;
};

/** Same convention as DemoClip: every px below is written at DESIGN_WIDTH. */
const useDesignScale = (): number => useVideoConfig().width / DESIGN_WIDTH;

/** Left inset of the text column. */
const MARGIN_X = 168;
const HEADLINE_SIZE = 96;
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

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

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
 * unit — no per-word timing. Used for the wordmark, so `==Agenta==` (or a bold /
 * italic brand lockup) works with exactly the vocabulary the headline uses.
 * Spacing is a leading margin, matching the headline, so tight punctuation hugs.
 */
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
 * Brand sign-off: the mark and the wordmark on one line.
 *
 * The mark fades and scales in first (floored, so frame 0 already carries it),
 * then the wordmark WRITES in a character at a time — a short per-letter reveal
 * that reads as the name being drawn next to the mark. Sized so the mark sits
 * just above the wordmark's cap height rather than dwarfing it.
 */
const LogoLockup: React.FC<{
  text: string;
  look: IntroLook;
  k: number;
  tS: number;
}> = ({ text, look, k, tS }) => {
  const markP = flooredEntry(
    cameraEase(progressAt({ startS: 0, endS: WORDMARK_IN_S }, tS)),
  );
  // The wordmark starts once the mark is mostly in.
  const writeStart = WORDMARK_IN_S * 0.6;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: LOGO_GAP * k,
      }}
    >
      <Img
        src={staticFile(LOGO_FILE)}
        style={{
          height: LOGO_MARK_SIZE * k,
          width: "auto",
          opacity: markP,
          transform: `scale(${0.92 + 0.08 * markP})`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: LOGO_TEXT_SIZE * k,
          fontWeight: HEADLINE_WEIGHT,
          letterSpacing: "-0.022em",
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
 * The punch runs inside CameraMotionBlur, and the rule at DemoClip.tsx:100-138
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
  const parts = headlineParts(intro.headline);
  if (!parts) return null;

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
        <Chip label={chip.label} look={look} k={k} />
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
 * CameraMotionBlur is mounted ONLY for a chip card. An 8x push in 0.42s strobes
 * without a shutter, but the blur is the dominant cost of a render and every
 * other card has no fast move to blur — so plain cards keep their zero-blur
 * path and render in seconds.
 */
export const Intro: React.FC<IntroProps> = ({ intro }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = useDesignScale();
  const tS = frame / fps;
  const t = introTiming(intro);
  const look = introLook(intro.background);

  // Floored: the film's first frame is a card, and it must not be an empty field.
  const wordmarkP = flooredEntry(
    cameraEase(progressAt({ startS: 0, endS: WORDMARK_IN_S }, tS)),
  );
  const subheadP = cameraEase(
    progressAt({ startS: t.subheadStartS, endS: t.subheadEndS }, tS),
  );
  // No fade. The card is cut while fully on screen and still moving — see
  // introTiming. `push` is what keeps it moving: linear, so the last frame (the
  // one the cut lands on) still has velocity.
  const push = pushAt(tS, t.settledS, t.totalS);
  const drift = DRIFT_FROM + (1 - DRIFT_FROM) * cameraEase(tS / t.totalS);

  const body = (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${MARGIN_X * k}px`,
        transform: `scale(${push})`,
        fontFamily: FONT_STACK,
      }}
    >
      <div style={{ maxWidth: width * look.columnFrac, textAlign: "center" }}>
        {intro.logo ? (
          // A logo card IS the lockup — mark + wordmark on one line, the wordmark
          // written in. It replaces the normal wordmark/headline/subhead stack,
          // so the headline copy ("Agenta") becomes the lockup's text.
          <LogoLockup text={intro.headline} look={look} k={k} tS={tS} />
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
            fontSize: HEADLINE_SIZE * k,
            fontWeight: HEADLINE_WEIGHT,
            letterSpacing: "-0.022em",
            lineHeight: 1.12,
            color: look.headline,
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
                  opacity: p,
                  transform: `translateY(${(1 - p) * RISE_EM}em)`,
                  // Per-word inline styling last, so bold/italic/highlight win
                  // over the block defaults for exactly the marked words.
                  ...wordCss(cue.style, look),
                }}
              >
                {cue.word}
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
      {look.flat ? null : (
        <AbsoluteFill style={{ transform: `scale(${drift})` }}>
          <Backdrop />
        </AbsoluteFill>
      )}
      {intro.chip && t.chip ? (
        <CameraMotionBlur shutterAngle={180} samples={4}>
          <ChipPunch
            intro={intro}
            chip={intro.chip}
            timing={t.chip}
            look={look}
            k={k}
            tS={tS}
            words={t.words}
            vp={{ width, height }}
          />
        </CameraMotionBlur>
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
const ChipPunch: React.FC<{
  intro: IntroStoryboard;
  chip: IntroChip;
  timing: ChipTiming;
  look: IntroLook;
  k: number;
  tS: number;
  words: { word: string; index: number; startS: number; endS: number }[];
  vp: { width: number; height: number };
}> = ({ intro, chip, timing, look, k, tS, words, vp }) => {
  const u = progressAt(
    { startS: timing.punchStartS, endS: timing.punchEndS },
    tS,
  );
  const scale = 1 + (CHIP_PUNCH_SCALE - 1) * punchEase(u);
  const css = poseToCss({ scale, cx: CHIP_AT.x, cy: CHIP_AT.y }, 0, 1);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_STACK }}>
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
          cameraScale={scale}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
