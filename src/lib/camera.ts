import { Easing } from "remotion";
import { DESIGN_WIDTH } from "./click-log";

/**
 * Single camera interpolator.
 *
 * Measured from Screen Studio-style refs: cubic-bezier(0.2, 0.2, 0.15, 1) —
 * short ease-in, long decaying tail, velocity peak ~0.13 T, 0% overshoot.
 */
export const CAMERA_BEZIER = Easing.bezier(0.2, 0.2, 0.15, 1);

/**
 * Entrance/exit interpolator for the full-bleed look's push envelope.
 *
 * Measured off the Cursor "Agent UX improvements" film: every decelerating
 * entrance there is a decaying exponential, ~0.78 of the remaining distance
 * retained per frame at 30fps (tau ~134ms). Fitting a cubic to the sampled
 * remaining-distance table gives cubic-bezier(0.15, 0.90, 0.75, 0.95) at
 * RMS 0.005; CAMERA_BEZIER above is the closest standard curve at RMS 0.066
 * but is measurably too slow off the mark — the reference covers 28% of the
 * distance in frame ONE.
 *
 * Kept separate from CAMERA_BEZIER on purpose: that one drives the demo camera
 * and every existing reel's zoom track, and must not move.
 */
export const PUSH_BEZIER = Easing.bezier(0.15, 0.9, 0.75, 0.95);

export type CameraPose = {
  scale: number;
  /** Focal point in *content* space (0..1), not CSS transform-origin. */
  cx: number;
  cy: number;
};

export const BASE_POSE: CameraPose = { scale: 1, cx: 0.5, cy: 0.48 };

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function cameraEase(t01: number): number {
  return CAMERA_BEZIER(clamp(t01, 0, 1));
}

/** One progress value drives scale and center. Convert to CSS origin *after* this. */
export function interpolatePose(
  a: CameraPose,
  b: CameraPose,
  t01: number,
): CameraPose {
  const p = cameraEase(t01);
  return {
    scale: mix(a.scale, b.scale, p),
    cx: mix(a.cx, b.cx, p),
    cy: mix(a.cy, b.cy, p),
  };
}

export function posesNearlyEqual(a: CameraPose, b: CameraPose): boolean {
  return (
    Math.abs(a.scale - b.scale) < 0.008 &&
    Math.abs(a.cx - b.cx) < 0.01 &&
    Math.abs(a.cy - b.cy) < 0.01
  );
}

/**
 * Distance-aware move duration.
 *
 * The windows below are what the viewer should SEE (refs: ~750–1100 ms for a
 * zoom-in, zoom-out ~1.25x that). The camera track, however, runs on the click
 * log's clock, which the composition replays at `speed` — so a duration authored
 * here is divided by `speed` on screen. We therefore clamp in output time and
 * return log time, multiplying the result back up. Without this every measured
 * constant lands ~20% short at the default 1.25x.
 *
 * @param speed Composition playback rate vs the shoot. 1 = realtime.
 * @returns Seconds on the click-log clock.
 */
export function moveDuration(
  from: CameraPose,
  to: CameraPose,
  kind: "in" | "out" | "pan",
  vp: { width: number; height: number },
  speed = 1,
): number {
  const dS = Math.abs(to.scale - from.scale);
  const dPx = poseTravelPx(from, to, vp);
  const ms = 480 + 420 * dS + 0.35 * dPx;
  const onScreen =
    kind === "out"
      ? clamp(ms * 1.25, 650, 1450)
      : kind === "pan"
        ? clamp(ms, 700, 1400)
        : clamp(ms, 550, 1250);
  return (onScreen * speed) / 1000;
}

/**
 * Focal travel of a move, in DESIGN px (i.e. at DESIGN_WIDTH), not viewport px.
 *
 * Reference camera moves travel 31–501 px. A repositioning much larger than that
 * is not a pan any camera operator would make at magnification — it should pass
 * through a wider framing instead. Used by the track builder to decide between
 * panning and routing via base, and by moveDuration to price a move.
 *
 * NORMALISED ON PURPOSE. The poses are fractions of the frame, so multiplying by
 * a raw viewport gives a number that doubles when the same shot is captured at
 * CAPTURE_SCALE=2 — and MAX_PAN_PX below is a fixed 500. Measured: the API-key
 * to Harnesses pan priced 645px at 1920 and 1290px at 3840, so the 3840 cut
 * routed through base where the 1920 cut panned, adding a full zoom-out and
 * back that the 1x film never had. Dividing by k makes both price the same move
 * identically, and is exact (k = 1) for every 1x log.
 */
export function poseTravelPx(
  from: CameraPose,
  to: CameraPose,
  vp: { width: number; height: number },
): number {
  const k = vp.width > 0 ? vp.width / DESIGN_WIDTH : 1;
  return (
    Math.hypot(
      (to.cx - from.cx) * vp.width,
      (to.cy - from.cy) * vp.height,
    ) / k
  );
}

/** Above this focal travel, route through base rather than panning across. */
export const MAX_PAN_PX = 500;

/**
 * Map a content-space point into the window group that includes a top chrome strip.
 */
export function contentToWindow(
  cx: number,
  cy: number,
  chromeFrac: number,
): { cx: number; cy: number } {
  if (chromeFrac <= 0) return { cx, cy };
  return { cx, cy: chromeFrac + cy * (1 - chromeFrac) };
}

/**
 * Convert an interpolated content-space pose into the CSS transform DemoClip
 * applies to the window group: a translate (fractions of the group's own size,
 * for `translate(%)`) plus a scale, about the group's centre.
 *
 * Pan is expressed as a TRANSLATE, not a transform-origin, and that matters.
 * The origin form needs `(0.5 - C*S) / (1 - S)`, which is singular at S = 1: on
 * the way out of a zoom the origin runs away to +/-infinity, clips against a pad,
 * mis-frames the last ~10 frames of the move, then snaps back the instant S hits
 * exactly 1. That read as a shake at the end of every zoom-out. The translate
 * form below is linear in scale, so it stays continuous through S = 1 and needs
 * no clamping at all.
 *
 * @param fit Base shrink of the window on the backdrop (WINDOW_FIT).
 */
export function poseToCss(
  pose: CameraPose,
  chromeFrac: number,
  fit = 1,
): { scale: number; translateX: number; translateY: number } {
  const S = pose.scale;
  const effective = fit * S;
  const mapped = contentToWindow(pose.cx, pose.cy, chromeFrac);
  // Keep the framed region inside the content so a zoom never reveals past its
  // edge. At S = 1 this collapses to dead centre, which is the identity.
  const half = 1 / (2 * S);
  const Cx = clamp(mapped.cx, half, 1 - half);
  const Cy = clamp(mapped.cy, half, 1 - half);
  return {
    scale: effective,
    translateX: effective * (0.5 - Cx),
    translateY: effective * (0.5 - Cy),
  };
}
