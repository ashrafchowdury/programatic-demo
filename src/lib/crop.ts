/**
 * Full-bleed framing: which part of the footage the shot is actually about.
 *
 * TWO WAYS TO SAY IT, and the second one is not the default despite being the
 * one that measures better. Read the whole note before reaching for it.
 *
 * `{ k, cx, cy, dx, dy }` is a CAMERA — magnify by k about a point, then pan.
 * It frames by moving the whole page, so a component keeps its native
 * on-screen size and simply arrives near the middle, and the footage still
 * fills the frame edge to edge. This is what full-bleed clips use.
 *
 * `{ rect, fill }` is an ISOLATION — name the component's box, and the scale,
 * the pan and a clip-path are all derived so that box fills `fill` of the frame
 * with nothing else in shot. It is Film B's grammar, not Film A's.
 *
 * WHY THE CAMERA IS STILL THE DEFAULT. The harness reel was cut both ways and
 * measured both ways. Isolation won every number: the settings drawer went from
 * 32% of frame width to 65%, and its UI text from 12.8px to 30.8px normalised
 * to DESIGN_WIDTH, against the reference's 30px. It lost on the picture. The
 * drawer came out of its page and floated on a flat grey mat covering half the
 * frame; the clip-path sliced two rows of the model list mid-glyph; every cue
 * that the shot was a settings page went away; and the 2.6x magnification cost
 * 1.73x of upscale, taking edge energy to 11.4 against the reference's
 * 17.8-20.5. A full-bleed film became a slide deck.
 *
 * So: reach for `rect` when the component genuinely IS the shot and the capture
 * has the pixels to back it — Film B isolates components that were shot at
 * size. Do not reach for it to buy text size out of a capture that is too
 * small. That is a CAPTURE_SCALE problem and it has a capture-side fix.
 *
 * Pure: no React, no Remotion. DemoClip renders the result, scripts/reel.ts
 * checks it against the source resolution, and both go through resolveCrop so
 * a framing cannot mean two different things in two places.
 */

/** A component's box in the footage, as fractions of frame width and height. */
export type CropRect = { x: number; y: number; w: number; h: number };

export type CropSpec = {
  /** Magnification about (cx, cy). Ignored when `rect` is set. */
  k?: number;
  /** Scale origin, 0..1. Defaults to the frame centre. */
  cx?: number;
  cy?: number;
  /** Pan after scaling, as a fraction of frame width / height. */
  dx?: number;
  dy?: number;
  /** The component to frame. Derives k, dx and dy; overrides all four above. */
  rect?: CropRect;
  /** Fraction of the frame `rect`'s longer side fills. Defaults to COMPONENT_FILL. */
  fill?: number;
  /**
   * Clip the footage to `rect`, so the shot is the component ALONE on `pageBg`.
   *
   * Defaults ON whenever `rect` is set, because a half-magnified page behind an
   * isolated component is worse than either: framing our settings drawer (the
   * right 25% of the viewport) at 2.6x leaves a 6.7%-wide strip of magnified
   * table text down the left edge of frame.
   *
   * But note what turning it on costs, because it is what sank the isolated cut
   * of the harness reel: everything outside the rect becomes `pageBg`, so the
   * shot is a component on a mat, and the clip edge is a hard rectangle that
   * will slice through whatever content crosses it. Set false to keep the
   * surroundings — right whenever the context is part of the story.
   */
  isolate?: boolean;
};

export type ResolvedCrop = {
  k: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
};

/**
 * How much of the frame an isolated component fills, when one is isolated.
 *
 * 0.85 is the middle of Film B's measured 79.9-89.9% band. It is a fraction of
 * the LONGER side of the rect, so a tall panel fills the height and a wide one
 * fills the width — either way the whole component is on screen, which neither
 * reference ever violates.
 */
export const COMPONENT_FILL = 0.85;

/**
 * The largest source-to-output scale that still looks sharp.
 *
 * Same number as S_MAX in src/lib/zoom.ts, which is where it was measured for
 * the framed camera; the constraint is the encoder and the eye, not the look,
 * so it applies to a full-bleed framing too. Kept as its own export rather than
 * imported because zoom.ts carries a second, softer variant that means
 * something else (S_MAX_SOFT, the opening-shot relaxation) and importing one of
 * a pair invites using the wrong one.
 */
export const SHARPNESS_CEILING = 1.74;

/**
 * Turn either spelling into the single {k, cx, cy, dx, dy} the transform needs.
 *
 * The `rect` branch is two lines of algebra worth writing out. cropToCss emits
 * `translate(dx, dy) scale(k)` about (cx, cy), and CSS applies that list
 * right-to-left, so a content point at fraction p lands at
 *
 *     cx + (p - cx) * k + dx
 *
 * Fixing the origin at the frame centre (cx = cy = 0.5) and asking for the
 * rect's centre to land at 0.5 collapses that to dx = -(p - 0.5) * k. The scale
 * follows from the fill: the rect's longer side, times k, must equal `fill`.
 */
export function resolveCrop(crop?: CropSpec): ResolvedCrop | undefined {
  if (!crop) return undefined;
  if (crop.rect) {
    const { x, y, w, h } = crop.rect;
    const k = (crop.fill ?? COMPONENT_FILL) / Math.max(w, h);
    return {
      k,
      cx: 0.5,
      cy: 0.5,
      dx: -(x + w / 2 - 0.5) * k,
      dy: -(y + h / 2 - 0.5) * k,
    };
  }
  return {
    k: crop.k ?? 1,
    cx: crop.cx ?? 0.5,
    cy: crop.cy ?? 0.5,
    dx: crop.dx ?? 0,
    dy: crop.dy ?? 0,
  };
}

/**
 * The component's box as a CSS `inset()`, or undefined when nothing is clipped.
 *
 * Expressed in the UNTRANSFORMED content box on purpose: the layer this lands on
 * is frame-sized and the footage covers it exactly, so rect fractions ARE
 * percentages here, and the crop transform on the same element scales the
 * already-clipped result. Compute it after the transform and every number would
 * have to be un-projected through k first.
 */
export function cropClipPath(crop?: CropSpec): string | undefined {
  if (!crop?.rect || crop.isolate === false) return undefined;
  const { x, y, w, h } = crop.rect;
  const pc = (n: number) => `${(n * 100).toFixed(4)}%`;
  return `inset(${pc(y)} ${pc(1 - (x + w))} ${pc(1 - (y + h))} ${pc(x)})`;
}

/**
 * Source pixels per output pixel after this framing — 1.0 is exactly 1:1.
 *
 * Above SHARPNESS_CEILING the footage is being blown up past where h264 and the
 * eye forgive it. Worth reporting rather than enforcing: a shot that has to
 * choose between soft-and-legible and sharp-and-unreadable should be allowed to
 * pick, but never by accident.
 */
export function cropUpscale(
  crop: CropSpec | undefined,
  sourceWidth: number,
  outputWidth: number,
): number {
  const resolved = resolveCrop(crop);
  if (!resolved || sourceWidth <= 0) return 1;
  return (outputWidth / sourceWidth) * resolved.k;
}
