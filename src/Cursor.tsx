import React from "react";
import { CURSOR_SCALE_EXP, type ClickLog } from "./lib/click-log";
import { cursorAt } from "./lib/cursor";
import { useDesignScale } from "./WindowFrame";

/** Arrow tip inside the 24x32 viewBox — the point that sits on (x, y). */
const HOT_X = 1;
const HOT_Y = 1;
/** Drawn size at camera scale 1, in DESIGN_WIDTH px (scaled to the output). */
const ARROW_W = 34;
const ARROW_H = 45;
/**
 * Hand (pointer) glyph, its own 24x32 viewBox. Hotspot is the fingertip, the
 * point a real "cursor: pointer" hand clicks from, so it sits on (x, y) exactly
 * where the arrow tip did. Sized to read at the arrow's visual weight.
 */
const HAND_W = 32;
const HAND_H = 43;
const HAND_HOT_X = 9.1;
const HAND_HOT_Y = 2;
/** Outline weight in hand-viewBox units. Bold, like the reference glyph. */
const HAND_STROKE = 1.6;

/**
 * The hand, as rounded PRIMITIVES rather than one traced outline: a thick index
 * finger, two folded knuckles, a thumb, and a rounded fist.
 *
 * Drawn twice by the renderer below — once with a fat stroke, then again filled
 * — so the outline follows the UNION silhouette and the seams where the pieces
 * overlap disappear under the second pass. A single hand-traced path was tried
 * first and read thin and angular; composing it this way is what gives the
 * chunky, one-outline shape the reference cursor has, and keeps every joint
 * round without hand-fitting bezier control points.
 */
const HAND_SHAPES = (
  <>
    {/* index finger */}
    <rect x={7.2} y={2} width={3.8} height={16.5} rx={1.9} />
    {/* three folded fingers. Each clears the fist top by a bit less than the
        one before, which is what makes them read as three scalloped knuckles
        instead of dissolving into one smooth shoulder. */}
    <rect x={10.9} y={10.5} width={3.6} height={9.5} rx={1.8} />
    <rect x={14.2} y={12} width={3.6} height={8.5} rx={1.8} />
    <rect x={17.4} y={13.6} width={3.4} height={7} rx={1.7} />
    {/* thumb: short and steeply angled, so it reads as a bump on the fist's
        left flank. Longer or shallower and it hangs off like a second finger. */}
    <rect
      x={3.2}
      y={16}
      width={3.6}
      height={6}
      rx={1.8}
      transform="rotate(-58 5 19)"
    />
    {/* fist. Kept NARROW and shallow on purpose: widen it or raise the radius
        toward half its height and the whole glyph inflates into a bulky mitten
        that swallows the knuckles and thumb — which is how two earlier passes
        came out. The slim fist is what keeps this reading as a cursor. */}
    <rect x={4.9} y={16.5} width={14.6} height={11} rx={4.8} />
  </>
);
/**
 * Click-ring ("cluster") diameter and stroke, same DESIGN_WIDTH units. Bigger
 * and blue, so a click reads as the pointer highlight a screen recorder draws
 * rather than the small grey ripple this used to be. Kept deliberately under
 * the reference's ring — a click accent, not a spotlight. Only drawn when
 * `ripple` is on.
 */
const RIPPLE_D = 96;
const RIPPLE_STROKE = 2.5;
/** Click-ring colour. Tailwind blue-500, to match the app's own accent. */
const RIPPLE_RGB = "59, 130, 246";

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
  // The design width, not the frame's: identical at 16:9, and at another
  // aspect (src/lib/aspect.ts) the pointer keeps its 16:9 size rather than
  // shrinking with a 1440-wide frame.
  const k = useDesignScale();

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
  const handW = HAND_W * k;
  const handH = HAND_H * k;
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
            border: `${RIPPLE_STROKE * k}px solid rgba(${RIPPLE_RGB}, 0.9)`,
            background: `rgba(${RIPPLE_RGB}, 0.14)`,
            // Opens near full size and grows a little, so it reads as a ring
            // AROUND the pointer (the screen-recorder click highlight) rather
            // than a small ripple expanding from nothing. Opacity holds early
            // and falls off toward the end (1 - t^2), so the ring is visible at
            // a large size instead of only when it is tiny.
            transform: `scale(${0.72 + state.ripple * 0.4})`,
            opacity: 0.9 * (1 - state.ripple * state.ripple),
          }}
        />
      ) : null}

      {state.kind === "pointer" ? (
        <svg
          width={handW}
          height={handH}
          viewBox="0 0 24 32"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: "absolute",
            left: (-HAND_HOT_X / 24) * handW,
            top: (-HAND_HOT_Y / 32) * handH,
            transform: `scale(${state.squash})`,
            transformOrigin: `${(HAND_HOT_X / 24) * 100}% ${(HAND_HOT_Y / 32) * 100}%`,
            filter: `drop-shadow(0 ${1.5 * k}px ${2.5 * k}px rgba(15, 23, 42, 0.34))`,
          }}
        >
          <g
            fill="#ffffff"
            stroke="#111418"
            strokeWidth={HAND_STROKE}
            strokeLinejoin="round"
          >
            {HAND_SHAPES}
          </g>
          <g fill="#ffffff">{HAND_SHAPES}</g>
        </svg>
      ) : (
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
      )}
    </div>
  );
};
