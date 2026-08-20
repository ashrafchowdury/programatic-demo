import { PUSH_BEZIER, clamp } from "./camera";

/**
 * The move–rest–move envelope of the full-bleed look.
 *
 * Reverse-engineered from the Cursor "Agent UX improvements" film. Every shot
 * there — card and footage alike — does the same three things:
 *
 *   1. arrives ALREADY MOVING and decelerates into place over ~14-18 frames,
 *   2. sits dead still for the bulk of its length (the film is 79% still),
 *   3. accelerates away over the last ~8-18 frames and is CUT MID-MOVE.
 *
 * The two moves are the same curve, time-reversed — measured, not assumed: the
 * exit reaches 15.7% of its travel at the halfway frame, and 1 - PUSH_BEZIER(0.5)
 * is 0.158. So one `settle` function drives both ends and the pair cannot drift
 * apart when either is tuned.
 *
 * Cutting mid-move is the point, not a rounding error. The eye reads "still
 * travelling" on the last frame and accepts the next shot's momentum, which is
 * what makes the film's hard cuts land as motion rather than as interruptions.
 */

/** Axis a push acts on. "scale" pushes toward/away from the viewer instead. */
export type PushAxis = "x" | "y" | "scale" | "none";

export type PushMove = {
  axis: PushAxis;
  /**
   * Travel, in DESIGN pixels for "x"/"y" (1920-wide space) or as a scale delta
   * for "scale" (the film's one scale exit is -0.07).
   *
   * On an entrance this is where the shot STARTS, relative to rest. On an exit
   * it is where the shot has got to ON THE FRAME THE CUT LANDS — not where the
   * move would have finished, which is never seen.
   */
  dist: number;
  /** Length of the move in frames. */
  frames: number;
};

export type PushSpec = { in?: PushMove; out?: PushMove };

/** What to apply to the shot's content. Rest is {x: 0, y: 0, scale: 1}. */
export type PushTransform = { x: number; y: number; scale: number };

export const PUSH_REST: PushTransform = { x: 0, y: 0, scale: 1 };

/**
 * Measured defaults, in frames at 30fps and design px.
 *
 * Entrance travel in the reference runs 54-114px (3-6% of frame width) for the
 * ordinary case; the 208-416px outliers are the whip cuts, which are authored
 * per segment rather than defaulted.
 */
export const PUSH_IN_FRAMES = 15;
export const PUSH_OUT_FRAMES = 13;
export const PUSH_IN_DIST = 114;
export const PUSH_OUT_DIST = 72;

/**
 * Still hold between the last word landing and the cut, in seconds.
 *
 * The hardest rule in the reference: measured 62-63 frames on every one of the
 * five sentence cards, regardless of whether the card carried 7 words or 15.
 * The word stagger is compressed to make that landing hit, not the hold
 * stretched to absorb it.
 */
export const HOLD_AFTER_TEXT_S = 2.07;

const clamp01 = (x: number): number => clamp(x, 0, 1);

/**
 * Remaining fraction of a move: 1 at u=0, 0 at u=1, decelerating.
 *
 * Both ends of the envelope are this function — the entrance reads it forwards,
 * the exit backwards.
 */
export const settle = (u: number): number => 1 - PUSH_BEZIER(clamp01(u));

/** Offset contributed by an entrance, `f` frames after the shot's first frame. */
export const pushIn = (move: PushMove, f: number): number =>
  move.frames > 0 ? move.dist * settle(f / move.frames) : 0;

/** Offset contributed by an exit, `g` frames after the exit begins. */
export const pushOut = (move: PushMove, g: number): number =>
  move.frames > 0 ? move.dist * settle(1 - g / move.frames) : 0;

/**
 * The whole envelope for one shot.
 *
 * `frame` is relative to the shot's first VISIBLE frame, so a card trimmed into
 * its own reveal still starts its push at 0 — the trim moves the text clock,
 * not the camera.
 */
export function pushEnvelope(
  frame: number,
  durationInFrames: number,
  spec: PushSpec | undefined,
): PushTransform {
  if (!spec || (!spec.in && !spec.out)) return PUSH_REST;

  let x = 0;
  let y = 0;
  let scale = 1;

  const apply = (axis: PushAxis, offset: number): void => {
    if (axis === "x") x += offset;
    else if (axis === "y") y += offset;
    else if (axis === "scale") scale += offset;
  };

  const inMove = spec.in;
  if (inMove && inMove.axis !== "none" && frame < inMove.frames)
    apply(inMove.axis, pushIn(inMove, frame));

  const outMove = spec.out;
  if (outMove && outMove.axis !== "none") {
    const start = durationInFrames - outMove.frames;
    if (frame > start) apply(outMove.axis, pushOut(outMove, frame - start));
  }

  return { x, y, scale };
}

/** CSS for a PushTransform, in the composition's own pixel scale. */
export function pushToCss(p: PushTransform, designScale = 1): string {
  const x = p.x * designScale;
  const y = p.y * designScale;
  return `translate3d(${x}px, ${y}px, 0) scale(${p.scale})`;
}

/**
 * Does a shot end while still travelling?
 *
 * Guards the rule that makes the cuts work. An exit that completes before the
 * cut lands on a dead-still frame, and the next shot's entrance then reads as a
 * fresh move rather than a continuation.
 */
export function cutsMidMove(
  durationInFrames: number,
  spec: PushSpec | undefined,
): boolean {
  const out = spec?.out;
  if (!out || out.axis === "none" || out.frames <= 0) return false;
  return durationInFrames - out.frames > 0 && out.frames > 1;
}

/**
 * Velocity, in design px per frame, on the shot's last frame.
 *
 * Feeds a motion-matched cut: the next shot's entrance is seeded from this so
 * momentum survives a content discontinuity. Measured across the reference's
 * signature cut, -84 px/f out and -68 px/f back in.
 */
export function exitVelocity(
  durationInFrames: number,
  spec: PushSpec | undefined,
): number {
  const out = spec?.out;
  if (!out || out.axis === "none" || out.frames <= 0) return 0;
  const last = durationInFrames - 1;
  const start = durationInFrames - out.frames;
  if (last <= start) return 0;
  return pushOut(out, last - start) - pushOut(out, last - start - 1);
}
