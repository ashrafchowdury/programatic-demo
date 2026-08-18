/**
 * Shared click-log types and camera-timing constants.
 * Imported by Remotion (src/) and the Playwright recorders (scripts/).
 */

export type ClickEvent = {
  label?: string;
  tMs: number;
  /**
   * Elapsed ms when the cursor *started* travelling toward this target.
   * Used to start the camera just before the pointer leaves. Optional so
   * older logs still render (camera falls back to tMs − LEAD_FALLBACK_S).
   */
  tDepartMs?: number;
  /**
   * Elapsed ms of mousedown. Drives the click ripple and cursor squash when
   * Remotion draws the cursor. Absent on `focus()` beats, which place a zoom
   * keyframe without actually clicking — and on older logs.
   */
  tDownMs?: number;
  /**
   * Elapsed ms when typing into this target finished. Present only on `typeInto`
   * beats. Between `tMs` and this, the pointer is parked and the app is drawing
   * its own text caret, so the arrow is faded out — two cursors on screen reads
   * as a bug, and the arrow is not the thing to watch while text appears.
   */
  typeEndMs?: number;
  x: number;
  y: number;
  /** The clicked element's bounding rect (viewport CSS px). When present the zoom
   *  frames the whole control; otherwise it falls back to a small box around x/y. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Explicit zoom cluster id. Same id → shared punch / hold / trail. */
  cluster?: string;
  /** When false, this event does not contribute to zoom (still in the video). */
  zoom?: boolean;
};

/** One recorded pointer position, on the click-log clock. */
export type CursorSample = {
  /** Elapsed ms. */
  t: number;
  /** Viewport CSS px. */
  x: number;
  y: number;
};

export type ClickLog = {
  name: string;
  viewport: { width: number; height: number };
  /**
   * Full pointer path emitted by the recorder's glide.
   *
   * When present, Remotion draws the cursor as vector at composition resolution
   * and the recorder does not bake one into the video. When absent (older
   * recordings) the cursor is already in the footage, so Remotion draws nothing
   * — which is what keeps those clips rendering correctly.
   */
  cursorTrack?: CursorSample[];
  /** Duration of the kept (demo) portion in ms; used to size the composition. */
  durationMs: number;
  /** Trim this many ms off the FRONT of the video (e.g. login) before the demo. */
  trimBeforeMs?: number;
  /** Manual nudge (ms) applied to every click time if video/log drift shows up. */
  offsetMs?: number;
  clicks: ClickEvent[];
};

export const EMPTY_LOG: ClickLog = {
  name: "",
  viewport: { width: 1920, height: 1080 },
  durationMs: 8000,
  offsetMs: 0,
  clicks: [],
};

/**
 * Width the composition renders at, independent of the capture viewport.
 *
 * The recording is capped at the CSS viewport (see DEVICE_SCALE_FACTOR), so
 * rendering wider does NOT sharpen the app footage — the same source pixels fill
 * the same fraction of the frame either way. What it does sharpen is everything
 * DRAWN rather than filmed: the vector cursor, the shadow, the gradient backdrop
 * and the window's rounded corners all rasterise at output resolution.
 *
 * It also stops the base-scale shot throwing detail away. The window sits at
 * WINDOW_FIT (0.86) of frame width, so at a 1920 output the 1920-wide source is
 * squeezed into 1651px; anyone watching on a display bigger than 1080p loses
 * that. At 2560 the base shot is a slight upscale instead, and nothing is
 * discarded.
 *
 * 2560 is where the value stops. Measured on the same 368-frame clip, before
 * GPU rasterisation was turned on — every number below is now ~16x smaller, and
 * the "memory, not pixels" reading of them was wrong (see scripts/render.ts):
 *
 *   1920x1080   741s   2.6MB
 *   2560x1440   837s   3.9MB    +13%
 *   3840x2160  1827s   6.9MB   +118% over 1440p
 *
 * The resolution scaling still holds in shape — 4K is disproportionately
 * expensive — but it is compositing cost, not swapping. And 4K buys almost
 * nothing:
 * side by side at matched size, the cursor edges are marginally cleaner and the
 * app text is indistinguishable, because it is the same 1920 source either way.
 * Do not raise this expecting the footage to improve.
 */
export const OUTPUT_WIDTH = 2560;
/**
 * Width the look was tuned at. Every composition-pixel constant (cursor size,
 * shadow radii, corner radius, chrome height) is written for this width and
 * scaled by OUTPUT_WIDTH / DESIGN_WIDTH at render, so changing the output
 * resolution moves the whole design together instead of shrinking the details.
 */
export const DESIGN_WIDTH = 1920;

/** Fallback lead-in when a log has no tDepartMs (older recordings). */
export const LEAD_FALLBACK_S = 0.75;
/** Minimum still hold after the last click of a cluster. */
export const HOLD_MIN_S = 1.3;
/**
 * Still hold after the last KEYSTROKE of a typing beat, before trailing out.
 *
 * A click is instantaneous, so HOLD_MIN_S measured from `tMs` covers it. Typing
 * is not: 111 characters take ~4s, and a hold measured from the click expired
 * a third of the way through, trailing the camera to base while two thirds of
 * the text was still being typed — the one thing the demo exists to show, played
 * at the widest framing in the clip. The camera must not leave an action that is
 * still happening, so a typing beat holds until `typeEndMs` instead.
 *
 * Shorter than HOLD_MIN_S because the viewer has been reading throughout, and
 * the trail-out itself keeps the text legible for most of another second.
 */
export const TYPE_TAIL_S = 0.4;
/** Camera starts this many seconds before cursor departure. */
export const CAMERA_LEAD_S = 0.035;
/**
 * After `flow.run()` returns, keep recording this long before cutting.
 *
 * Must cover the closing zoom-out (up to TRAIL_CEILING_S) plus BASE_BEAT_S at
 * base scale. Every reference clip ends at base — 4/4, the highest-confidence
 * finding in the analysis — so the recording has to contain enough footage for
 * the camera to get back there. At 1 s it did not, which is why the old track
 * builder skipped the closing trail and cut while still zoomed in.
 */
export const END_TAIL_S = 2.5;
/** Stillness held at base scale after the closing trail, before the cut. */
export const BASE_BEAT_S = 0.6;

/**
 * How much the drawn cursor grows with camera zoom.
 *
 * The reference analysis leaves this UNRESOLVED, but records V2's cursor blob
 * growing 33px -> 60px across a 1.0x -> 2.8x camera change. That is sub-linear:
 * ln(1.818) / ln(2.8) = 0.58. So the cursor is neither pinned to output size
 * (0) nor glued to the footage (1) — it grows, but slower than the frame.
 */
export const CURSOR_SCALE_EXP = 0.58;
/** Click ripple lifetime, seconds. */
export const RIPPLE_S = 0.35;
/** Cursor squash on mousedown, and how long it holds before releasing. */
export const CLICK_SQUASH = 0.9;
export const CLICK_SQUASH_S = 0.12;
/** Fade used when the arrow hands over to the app's own text caret. */
export const CURSOR_FADE_S = 0.18;
/**
 * Composition playback vs the recorded shoot. 1 = realtime, 1.25 / 1.5 / 2 = faster.
 * Override per render: `DEMO_SPEED=1.5 pnpm exec tsx scripts/render.ts skillsmp-search`
 */
export const DEFAULT_PLAYBACK_RATE = 1.25;

export function resolvePlaybackRate(raw?: number | string): number {
  const n =
    typeof raw === "number"
      ? raw
      : raw != null && raw !== ""
        ? Number(raw)
        : DEFAULT_PLAYBACK_RATE;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PLAYBACK_RATE;
  return n;
}
/** Pre-lead establish cushion kept by applyFrontTrim. */
export const ESTABLISH_CUSHION_S = 1.0;
/** Conservative zoom-out ceiling used to size CLUSTER_GAP. */
export const TRAIL_CEILING_S = 1.45;

export const clusterGapMs = (): number =>
  Math.round((HOLD_MIN_S + TRAIL_CEILING_S) * 1000);

/**
 * Page render scale. Affects screenshots only — NOT the recorded video.
 *
 * Playwright records video by forwarding `recordVideo.size` straight to CDP
 * `Page.startScreencast`, which captures at CSS-pixel resolution. Measured, on
 * playwright 1.62:
 *
 *   - viewport 1920x1080 @ DSF 2, size 3840x2160 -> a 3840x2160 file whose
 *     content sits in the top-left 1920x1080, the rest padded grey.
 *   - viewport 1280x720 @ DSF 2, size 2560x1440 -> same padding. DSF never
 *     reaches the screencast.
 *   - a larger CSS viewport (2880x1620) records cleanly but gains nothing:
 *     font sizes are in CSS px, so each element still renders at 1:1. You get
 *     more content on screen, not more pixels per element.
 *
 * Nor is this Playwright's doing. Driving CDP directly, with the screencast
 * asked for 3840x2160 explicitly:
 *
 *   - viewport 1920x1080 @ DSF 2, `page.screenshot()`      -> 3840x2160
 *   - viewport 1920x1080 @ DSF 2, `Page.startScreencast`
 *     with maxWidth/maxHeight 3840x2160                    -> 1920x1080
 *
 * The compositor surface really is 2x and screenshots get it; the screencast
 * emits CSS-viewport pixels no matter what it is asked for. So the source is
 * capped at the CSS viewport and every camera zoom above 1 / WINDOW_FIT
 * upscales — at WINDOW_FIT 0.86 and S_MAX 1.74 that is 1.50x.
 *
 * The only remaining route to more pixels is a bigger CSS viewport plus root
 * `zoom` to keep the layout the same size (2560x1440 at zoom 1.333 measured
 * +20% edge energy, but the app sizes panes off `window.innerHeight`, which
 * `zoom` does not change, so its full-height regions overflow). Anything based
 * on deviceScaleFactor is a dead end — measured three times now, most recently
 * against raw CDP. Do not retry it.
 */
export const DEVICE_SCALE_FACTOR = 2;
/** Cursor glide owns its own clock; Playwright slowMo would double-count. */
export const RECORD_SLOW_MO_MS = 0;
