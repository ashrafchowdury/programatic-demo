import React from "react";
import { useVideoConfig } from "remotion";
import { CURSOR_SCALE_EXP, DESIGN_WIDTH, type ClickLog } from "./lib/click-log";
import { cursorAt } from "./lib/cursor";

/** Arrow tip inside the 24x32 viewBox — the point that sits on (x, y). */
const HOT_X = 1;
const HOT_Y = 1;
/** Drawn size at camera scale 1, in DESIGN_WIDTH px (scaled to the output). */
const ARROW_W = 34;
const ARROW_H = 45;
/** Ripple diameter and stroke, same units. Only drawn when `ripple` is on. */
const RIPPLE_D = 22;
const RIPPLE_STROKE = 2;

/**
 * Vector pointer, drawn over the footage.
 *
 * Lives inside the camera transform so it tracks the page, but counter-scales
 * so it grows sub-linearly with zoom (see CURSOR_SCALE_EXP): the camera
 * multiplies by `scale`, this divides by `scale^(1 - exp)`, leaving
 * `scale^exp`. Drawing it here rather than baking it into the recording keeps
 * it sharp at any zoom and lets it move on the composition's clock instead of
 * the 25fps source.
 */
export const Cursor: React.FC<{
  log: ClickLog;
  /** Seconds on the click-log clock. */
  timeS: number;
  /** Current camera scale, to counter-scale against. */
  cameraScale: number;
  /**
   * Draw the expanding circle on mousedown.
   *
   * NO DEFAULT HERE ON PURPOSE — the two looks disagree and each states its
   * own in DemoClip. Full-bleed is a reproduction of the reference films, and
   * neither of them draws a ripple (docs/reel/03-composition.md): Film A shows
   * no pointer at all, and Film B's pointer clicks with no ripple, because the
   * feedback is the real control's press state, which the capture records for
   * free. The framed look is this repo's own language — backdrop, window
   * chrome, zoom camera, none of which the reference has — and its demos were
   * cut with the ripple, so it keeps it.
   */
  ripple?: boolean;
}> = ({ log, timeS, cameraScale, ripple = true }) => {
  // Before the early returns — hooks cannot be conditional.
  const k = useVideoConfig().width / DESIGN_WIDTH;

  const track = log.cursorTrack;
  if (!track || track.length === 0) return null;

  const state = cursorAt(track, log.clicks, timeS);
  if (!state) return null;
  // Fully faded out while the app's text caret is the subject — skip the
  // subtree entirely rather than compositing an invisible layer every frame.
  if (state.opacity <= 0.001) return null;

  const { width, height } = log.viewport;
  const counter = Math.pow(cameraScale, CURSOR_SCALE_EXP - 1);
  const arrowW = ARROW_W * k;
  const arrowH = ARROW_H * k;
  const rippleD = RIPPLE_D * k;

  return (
    <div
      style={{
        position: "absolute",
        // Percentages, because the video area is the viewport stretched to fit
        // under the chrome bar — proportional mapping survives that, absolute
        // pixels would not.
        left: `${(state.x / width) * 100}%`,
        top: `${(state.y / height) * 100}%`,
        width: 0,
        height: 0,
        pointerEvents: "none",
        opacity: state.opacity,
        // Counter-scale about the arrow tip so the hotspot stays on the target.
        transform: `scale(${counter})`,
        transformOrigin: "0 0",
      }}
    >
      {ripple && state.ripple !== null ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: rippleD,
            height: rippleD,
            marginLeft: -rippleD / 2,
            marginTop: -rippleD / 2,
            borderRadius: "50%",
            border: `${RIPPLE_STROKE * k}px solid rgba(15, 23, 42, 0.55)`,
            background: "rgba(15, 23, 42, 0.10)",
            // 0.3 -> 1.35 over the ripple's life, fading out. Matches the
            // in-page ripple this replaces.
            transform: `scale(${0.3 + state.ripple * 1.05})`,
            opacity: 0.85 * (1 - state.ripple),
          }}
        />
      ) : null}

      <svg
        width={arrowW}
        height={arrowH}
        viewBox="0 0 24 32"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          left: (-HOT_X / 24) * arrowW,
          top: (-HOT_Y / 32) * arrowH,
          transform: `scale(${state.squash})`,
          transformOrigin: `${(HOT_X / 24) * 100}% ${(HOT_Y / 32) * 100}%`,
          filter: `drop-shadow(0 ${1.5 * k}px ${2.5 * k}px rgba(15, 23, 42, 0.34))`,
        }}
      >
        <path
          d="M1 1 L1 23 L6.5 17.8 L10.2 26.6 L13.7 25 L9.95 16.5 L17 16.3 Z"
          fill="#111418"
          stroke="#ffffff"
          strokeWidth={1.85}
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </svg>
    </div>
  );
};
