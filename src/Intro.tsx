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
  CARD_EXIT_DEFAULT,
  cardPointerLog,
  CHIP_AT,
  CHIP_PUNCH_SCALE,
  flooredEntry,
  FONT_STACK,
  FULLBLEED_LETTER_SPACING,
  headlineParts,
  introLook,
  introTiming,
  LOGO_FILE,
  LOGO_IN_S,
  LOGO_IN_SCALE,
  LOGO_PERSPECTIVE,
  LOGO_RISE,
  LOGO_TUMBLE_AXIS,
  LOGO_TUMBLE_S,
  LOGO_TUMBLE_TURNS,
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
import { pushEnvelope, pushToCss, type PushSpec } from "./lib/push";
import { RecapCard } from "./RecapCard";
import { resolvePreset } from "./lib/style";

export type IntroProps = {
  intro: IntroStoryboard;
};

/** Same convention as DemoClip: every px below is written at DESIGN_WIDTH. */
const useDesignScale = (): number => useVideoConfig().width / DESIGN_WIDTH;

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
  fullbleed?: boolean;
}> = ({ text, look, k, tS, fullbleed = false }) => {
  // Full-bleed runs a longer, larger settle. The framed 0.92 -> 1.0 nudge over
  // 0.45s reads as a fade with a hint of scale; the reference's mark travels a
  // factor of 1.57 over ~0.63s, which is what gives the opening something to
  // watch instead of something to land on.
  const inS = fullbleed ? LOGO_IN_S : WORDMARK_IN_S;
  const markP = flooredEntry(
    cameraEase(progressAt({ startS: 0, endS: inS }, tS)),
  );
  const markScale = fullbleed
    ? LOGO_IN_SCALE + (1 - LOGO_IN_SCALE) * markP
    : 0.92 + 0.08 * markP;
  // Rises as it shrinks, so the two read as one move rather than two.
  const markRise = fullbleed ? (1 - markP) * LOGO_RISE * k : 0;
  // One full turn, on its own longer clock than the scale so the mark is still
  // resolving after it has finished travelling. Full-bleed only: the framed
  // lockup's 0.92 -> 1.0 nudge is a different, quieter idea and stays as it is.
  const tumbleP = fullbleed
    ? cameraEase(progressAt({ startS: 0, endS: LOGO_TUMBLE_S }, tS))
    : 1;
  const spin = LOGO_TUMBLE_TURNS * 360 * (1 - tumbleP);
  const [ax, ay, az] = LOGO_TUMBLE_AXIS;
  // perspective() must lead the function list, and rotate3d has to sit INSIDE
  // scale so the mark turns about its own centre rather than about the point it
  // is scaling toward.
  const markSpin = fullbleed
    ? ` perspective(${LOGO_PERSPECTIVE * k}px) rotate3d(${ax}, ${ay}, ${az}, ${spin}deg)`
    : "";
  // The wordmark starts once the mark is mostly in.
  const writeStart = inS * 0.6;
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
          transform: `translateY(${markRise}px) scale(${markScale})${markSpin}`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: LOGO_TEXT_SIZE * k,
          fontWeight: HEADLINE_WEIGHT,
          letterSpacing: fullbleed ? FULLBLEED_LETTER_SPACING : "-0.022em",
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
  // A recap card shares nothing with a sentence card but its palette — it is
  // left-aligned, top-anchored, and reveals whole labels rather than words — so
  // it gets its own component rather than a branch through this one.
  if (intro.items?.length) return <RecapCard intro={intro} />;
  return <SentenceCard intro={intro} />;
};

const SentenceCard: React.FC<IntroProps> = ({ intro }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = useDesignScale();
  const tS = frame / fps;
  const t = introTiming(intro);
  const preset_ = resolvePreset(intro);
  const look = introLook(intro.background, preset_.look, preset_.palette);

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
  //
  // Full-bleed swaps the 4% scale nudge for a directional translate, because
  // that is what the reference measures: five sentence cards leaving by slide
  // left, slide up and scale down respectively, never all by the same move. The
  // entrance is the same curve reversed — a 56px rise, which is the one
  // entrance shape every card in the reference shares.
  const preset = resolvePreset(intro);
  // Typography and palette still key off the look. They are not yet preset
  // fields — see the `type` group proposed in choreography-references.md §5 —
  // but this reads a FIELD of the resolved preset, never a style's name.
  const fullbleed = preset.look === "fullbleed";
  const totalFrames = Math.max(1, Math.ceil(t.totalS * fps));

  // Does this grammar travel its cards on the push envelope? `push` says yes;
  // `ramp` (the framed scale nudge, applied further down) and `none` (Film B's
  // pixel-locked cards) say no. Dispatching on `kind` rather than on the style
  // is what lets a third grammar pick either without touching this file.
  const pEnter = preset.card.enter.kind === "push" ? preset.card.enter : null;
  const pExit = preset.card.exit.kind === "push" ? preset.card.exit : null;
  // A card's own enter/exit override its style's.
  const exit =
    intro.exit ??
    (pExit
      ? { axis: pExit.axis, dist: pExit.dist, frames: pExit.frames }
      : CARD_EXIT_DEFAULT);
  const enter = intro.enter;
  const spec: PushSpec | undefined =
    pEnter || pExit
      ? {
          in: {
            axis: enter?.axis ?? pEnter?.axis ?? "none",
            dist: enter?.dist ?? pEnter?.dist ?? 0,
            frames: enter?.frames ?? pEnter?.frames ?? 0,
          },
          out: {
            axis: exit.axis,
            dist: exit.dist ?? pExit?.dist ?? 0,
            frames: exit.frames ?? pExit?.frames ?? 0,
          },
        }
      : undefined;
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
      envelope.y -=
        Math.min(after, preset.bookend.driftFrames) *
        preset.bookend.driftPxPerFrame;
  }
  const push = spec ? envelope.scale : pushAt(tS, t.settledS, t.totalS);
  const shift = spec ? pushToCss(envelope, k) : null;
  // Full-bleed has no backdrop plate to drift, by design.
  const drift = DRIFT_FROM + (1 - DRIFT_FROM) * cameraEase(tS / t.totalS);

  const body = (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${MARGIN_X * k}px`,
        transform: shift ?? `scale(${push})`,
        fontFamily: FONT_STACK,
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
            // Full-bleed sets its own type scale: 72px on a 1.194 pitch with no
            // tracking — cap height 52px, line pitch 86px, measured off the
            // reference (see FULLBLEED_HEADLINE_SIZE for why it is specified by
            // rendered metrics). The framed values below were tuned against a
            // photographic backdrop and stay as they were.
            // The style owns the type scale. See TypeStyle in src/lib/style.ts
            // for why it is specified by rendered metrics rather than by
            // nominal size, and for where the four reference films sit.
            fontSize: preset.type.sizePx * k,
            fontWeight: HEADLINE_WEIGHT,
            letterSpacing: preset.type.letterSpacing,
            lineHeight: preset.type.lineHeight,
            color: look.headline,
            // BALANCED, not greedy. The reference does not fill each line to the
            // column before wrapping: on its 3-line card the lines run 54%/52%/47%
            // of the available column, and on its 2-line card line 2 (1216px) is
            // WIDER than line 1 (1026px) — which greedy filling cannot produce,
            // since greedy always makes earlier lines the longest. Measured in
            // docs/reel/03-composition.md.
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
                  opacity: p,
                  transform: `translateY(${(1 - p) * RISE_EM}em)`,
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
                  ...wordCss(fullbleed ? undefined : cue.style, look),
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
      {look.flat || fullbleed ? null : (
        <AbsoluteFill style={{ transform: `scale(${drift})` }}>
          <Backdrop name={intro.backdrop} />
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
