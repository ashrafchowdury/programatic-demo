import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  FONT_STACK,
  introLook,
  LOGO_FILE,
  RECAP_ITEM_STAGGER_S,
  RECAP_ITEMS_LEAD_S,
  RECAP_LEAD_S,
  RECAP_LOCKUP_STAGGER_S,
  type IntroStoryboard,
} from "./lib/intro";
import { settle } from "./lib/push";
import { resolvePreset } from "./lib/style";
import { useDesignScale } from "./WindowFrame";

/**
 * The recap card: a top-left lockup over a list of what the film just showed.
 *
 * The one composition in the reference that is NOT centred, and that is what
 * makes it read as a list rather than as another statement. Measured off its
 * final frame, in 1920x1080 design px:
 *
 *   lockup   x124, band y136-218   (mark + wordmark on one line)
 *   items    x124, first band y308, pitch 120px
 *   cadence  one item every 16 frames — three times slower than the sentence
 *            cards' words, because these are labels to be read, not prose to
 *            be scanned
 *   lead     5 completely empty frames before anything appears
 *
 * That empty lead is deliberate and worth keeping. The cut into this card is
 * dark-to-dark (measured luma delta 3.1 against ~200 at every other cut), so it
 * does not read as a cut at all — it reads as the film catching its breath
 * before the summary.
 */

export const RECAP_MARGIN_X = 124;
export const RECAP_LOCKUP_Y = 136;
export const RECAP_LOCKUP_SIZE = 60;
export const RECAP_MARK_SIZE = 70;
export const RECAP_MARK_GAP = 26;
export const RECAP_ITEMS_Y = 308;
export const RECAP_ITEM_PITCH = 120;
export const RECAP_ITEM_SIZE = 64;

/** The mark rises 8px as it lands, the only motion inside the card. */
export const RECAP_RISE = 8;
export const RECAP_RISE_S = 0.2;
/**
 * ITEMS RISE TOO — the same 8px, on the same clock. The constant was already
 * here; only the mark was using it.
 *
 * An item's APPEARANCE is binary, which is what docs/reel/02-motion.md records:
 * ink goes 0 -> 14749 between two frames. But it is not finished when it
 * appears. Tracking the ink band of the reference's first recap item across its
 * reveal, the top edge reads
 *
 *     f1115 317   f1116 314   f1117 312   f1118 311   f1119 310   f1122 309
 *
 * — an 8px rise decelerating over six frames, i.e. RECAP_RISE on RECAP_RISE_S,
 * which is exactly what the mark does. The doc even says "no per-item rise
 * larger than the 8px already in RECAP_RISE"; the items simply never got it.
 */

/** When each element lands, in seconds from the card's first frame. */
export function recapSchedule(n: number): {
  markS: number;
  wordmarkS: number;
  itemsS: number[];
} {
  const markS = RECAP_LEAD_S;
  const wordmarkS = markS + RECAP_LOCKUP_STAGGER_S;
  const first = wordmarkS + RECAP_ITEMS_LEAD_S;
  return {
    markS,
    wordmarkS,
    itemsS: Array.from(
      { length: n },
      (_, i) => first + i * RECAP_ITEM_STAGGER_S,
    ),
  };
}

export const RecapCard: React.FC<{ intro: IntroStoryboard }> = ({ intro }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = useDesignScale();
  const tS = frame / fps;
  const preset_ = resolvePreset(intro);
  const look = introLook(intro.background, preset_.look, preset_.palette);
  const items = intro.items ?? [];
  const at = recapSchedule(items.length);

  // Presence is binary — an item is on screen or it is not, never part-way —
  // but what happens AFTER it lands is a settle. See RECAP_ITEM_RISE.
  const shown = (s: number): boolean => tS >= s;
  const riseAfter = (s: number): number =>
    settle(RECAP_RISE_S > 0 ? (tS - s) / RECAP_RISE_S : 1);
  // The mark is the one thing that moves, and only 8px.
  const markRise =
    settle(RECAP_RISE_S > 0 ? (tS - at.markS) / RECAP_RISE_S : 1) * RECAP_RISE;

  return (
    // FONT_STACK explicitly, not inherited: this component is returned from
    // Intro *before* the wrapper that sets it, so without this the card falls
    // back to the browser default serif.
    <AbsoluteFill
      style={{ backgroundColor: look.ground, fontFamily: FONT_STACK }}
    >
      <div
        style={{
          position: "absolute",
          left: RECAP_MARGIN_X * k,
          top: RECAP_LOCKUP_Y * k,
          display: "flex",
          alignItems: "center",
          gap: RECAP_MARK_GAP * k,
          color: look.headline,
          fontSize: RECAP_LOCKUP_SIZE * k,
          lineHeight: 1,
          transform: `translateY(${Math.max(0, markRise) * k}px)`,
        }}
      >
        {shown(at.markS) ? (
          <Img
            src={staticFile(LOGO_FILE)}
            style={{
              height: RECAP_MARK_SIZE * k,
              width: RECAP_MARK_SIZE * k,
              objectFit: "contain",
            }}
          />
        ) : null}
        {shown(at.wordmarkS) ? <span>{intro.headline}</span> : null}
      </div>

      {items.map((item, i) =>
        shown(at.itemsS[i]) ? (
          <div
            key={item}
            style={{
              position: "absolute",
              left: RECAP_MARGIN_X * k,
              // Absolute per item rather than a flow column: an item that has
              // not appeared yet must not collapse the ones below it upward.
              top: (RECAP_ITEMS_Y + i * RECAP_ITEM_PITCH) * k,
              color: look.subhead,
              fontSize: RECAP_ITEM_SIZE * k,
              lineHeight: 1,
              whiteSpace: "pre",
              transform: `translateY(${riseAfter(at.itemsS[i]) * RECAP_RISE * k}px)`,
            }}
          >
            {item}
          </div>
        ) : null,
      )}
    </AbsoluteFill>
  );
};
