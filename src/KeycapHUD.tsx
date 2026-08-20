import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { chordGlyphs, type KeyEvent } from "./lib/click-log";
import { settle } from "./lib/push";
import { useDesignScale } from "./WindowFrame";

/**
 * On-screen keycap, the full-bleed look's replacement for a mouse cursor.
 *
 * The reference film has no pointer in any frame of any of its four footage
 * shots. Interaction is keyboard-driven and announced by a black pill near the
 * bottom of the frame — measured at x 852-1068, y 924-1027 in 1920x1080, so
 * 216x103, horizontally centred, 53px clear of the bottom edge.
 *
 * It is a SIBLING of the plate, not a child: measured, the pill holds a fixed
 * frame position while the footage under it slides, so it must not inherit the
 * push transform.
 */

/** Measured pill geometry, in design px (1920-wide space). */
export const KEYCAP_H = 103;
export const KEYCAP_MIN_W = 216;
export const KEYCAP_PAD_X = 46;
export const KEYCAP_BOTTOM = 53;
export const KEYCAP_RADIUS = 26;
export const KEYCAP_GLYPH = 44;
export const KEYCAP_GROUND = "#0a0a0a";
export const KEYCAP_INK = "#ffffff";

/** How long a chord stays up once pressed, in seconds. */
export const KEYCAP_HOLD_S = 1.1;
/**
 * Entrance/exit of the pill itself, in seconds.
 *
 * NOT measured — the reference's sampled frames show the pill fully present or
 * fully absent, and at 600kbps a sub-100ms ramp would not survive the re-encode
 * anyway. Kept short and understated so it cannot upstage the footage, and run
 * through the same `settle` curve as everything else in the look.
 */
export const KEYCAP_IN_S = 0.13;
export const KEYCAP_OUT_S = 0.17;

export type KeycapHUDProps = {
  keys: KeyEvent[];
  /** Seconds into the shot, on the click log's clock. */
  timeS: number;
  holdS?: number;
};

/** The chord on screen at `timeS`, with its own progress, or null. */
export function keycapAt(
  keys: KeyEvent[],
  timeS: number,
  holdS = KEYCAP_HOLD_S,
): { chord: string; inP: number; outP: number } | null {
  // Last chord whose window contains timeS: chords pressed in quick succession
  // should replace each other rather than stack.
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const startS = key.tMs / 1000;
    const endS = startS + holdS;
    if (timeS < startS || timeS >= endS) continue;
    const inP = KEYCAP_IN_S > 0 ? (timeS - startS) / KEYCAP_IN_S : 1;
    const outP = KEYCAP_OUT_S > 0 ? (endS - timeS) / KEYCAP_OUT_S : 1;
    return {
      chord: key.chord,
      inP: Math.min(1, Math.max(0, inP)),
      outP: Math.min(1, Math.max(0, outP)),
    };
  }
  return null;
}

export const KeycapHUD: React.FC<KeycapHUDProps> = ({
  keys,
  timeS,
  holdS = KEYCAP_HOLD_S,
}) => {
  // Hook before the early return: React counts hooks per render, and a frame
  // with no chord on screen would otherwise call one fewer than a frame with.
  const k = useDesignScale();
  const active = keycapAt(keys, timeS, holdS);
  if (!active) return null;

  // `settle` runs 1 -> 0, so 1 - settle is the arrival and settle is the exit.
  const appear = 1 - settle(active.inP);
  const leave = 1 - settle(active.outP);
  const opacity = Math.min(appear, leave);
  // A touch of rise on the way in only. Leaving is a straight fade: the pill
  // should get out of the way, not perform.
  const rise = (1 - appear) * 10 * k;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: KEYCAP_BOTTOM * k,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: KEYCAP_MIN_W * k,
          height: KEYCAP_H * k,
          padding: `0 ${KEYCAP_PAD_X * k}px`,
          borderRadius: KEYCAP_RADIUS * k,
          backgroundColor: KEYCAP_GROUND,
          color: KEYCAP_INK,
          fontSize: KEYCAP_GLYPH * k,
          // Gap rather than letter-spacing: letter-spacing adds a trailing gap
          // after the last glyph and visibly decentres a two-glyph chord.
          gap: 0.28 * KEYCAP_GLYPH * k,
          lineHeight: 1,
          opacity,
          transform: `translateY(${rise}px)`,
        }}
      >
        {chordGlyphs(active.chord)}
      </div>
    </AbsoluteFill>
  );
};

/** Seconds into the shot for a frame, matching DemoClip's cursor time base. */
export const useKeycapTime = (speed: number, offsetMs = 0): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (frame / fps) * speed - offsetMs / 1000;
};
