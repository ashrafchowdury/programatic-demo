/**
 * Geometry of the floating window, shared by every composition that draws one.
 *
 * Pure constants rather than module-privates inside DemoClip, because two other
 * callers need them: src/StillShot.tsx frames a screenshot in the same window,
 * and scripts/shoot-still.ts sizes its CAPTURE against WINDOW_FIT — it has to
 * know how large the window can get before it knows how many pixels to shoot.
 * A script cannot import a .tsx without dragging React in, so the numbers live
 * here and the components import them back.
 */

/** macOS titlebar height inside the window group (px at DESIGN_WIDTH). */
export const CHROME_H = 38;
/**
 * Base float size of the window on the studio backdrop, before camera zoom.
 *
 * Trades gradient against legibility. The reference clips sit near 0.69, but
 * they frame a far simpler UI — a dense app at 1920px went unreadably small
 * there.
 * 0.86 keeps a clear gradient margin with the app still legible at base scale.
 *
 * Coupled to S_MAX in src/lib/zoom.ts: what the viewer sees is WINDOW_FIT *
 * scale, and the 1080p source starts to soften past ~1.5x. Raise this and lower
 * S_MAX to match, or the zooms quietly start upscaling harder.
 */
export const WINDOW_FIT = 0.86;
/** Corner radius of the floating window, shared by the window and its shadow. */
export const WINDOW_RADIUS = 14;
