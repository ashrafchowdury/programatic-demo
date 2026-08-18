/**
 * Cursor sampling for the Remotion-drawn pointer.
 *
 * The recorder generates the glide path itself (a quadratic Bézier eased with
 * the camera curve) and now emits every sample, so Remotion can redraw the
 * pointer as vector at composition resolution instead of relying on the copy
 * baked into the 1x footage.
 */
import {
  CLICK_SQUASH,
  CLICK_SQUASH_S,
  CURSOR_FADE_S,
  RIPPLE_S,
  type ClickEvent,
  type CursorSample,
} from "./click-log";
import { clamp, mix } from "./camera";

export type CursorState = {
  /** Recorded path position, viewport CSS px. */
  x: number;
  y: number;
  /** Mousedown squash, 1 when not pressing. */
  squash: number;
  /** Ripple progress 0..1, or null when no ripple is active. */
  ripple: number | null;
  /** 0 while the app's own text caret has the screen. */
  opacity: number;
};

/**
 * Arrow opacity at `tS`. Fades out once typing starts and back in when it ends,
 * so the handover to the app's blinking text caret is not a hard pop.
 */
export function cursorOpacity(clicks: ClickEvent[], tS: number): number {
  let opacity = 1;
  for (const c of clicks) {
    if (c.typeEndMs == null) continue;
    const from = c.tMs / 1000;
    const to = c.typeEndMs / 1000;
    if (tS <= from - CURSOR_FADE_S || tS >= to + CURSOR_FADE_S) continue;
    const fadingOut = clamp((from - tS) / CURSOR_FADE_S, 0, 1);
    const fadingIn = clamp((tS - to) / CURSOR_FADE_S, 0, 1);
    opacity = Math.min(opacity, Math.max(fadingOut, fadingIn));
  }
  return opacity;
}

/** Position on the recorded path at `tS`, holding the ends outside its range. */
export function samplePath(
  track: CursorSample[],
  tS: number,
): { x: number; y: number } | null {
  if (track.length === 0) return null;
  const tMs = tS * 1000;
  if (tMs <= track[0].t) return { x: track[0].x, y: track[0].y };
  const last = track[track.length - 1];
  if (tMs >= last.t) return { x: last.x, y: last.y };

  // Binary search: the track can hold a few thousand samples and this runs per
  // frame, once per motion-blur sub-sample.
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= tMs) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const span = b.t - a.t;
  const p = span < 1e-6 ? 0 : (tMs - a.t) / span;
  return { x: mix(a.x, b.x, p), y: mix(a.y, b.y, p) };
}

/**
 * Full cursor state at `tS`.
 *
 * The pointer sits perfectly still between glides, on purpose. An earlier
 * version added idle tremor to break up pixel-identical frames; it read as a
 * shake, and the premise was wrong — V1 of the reference footage is 31.3%
 * pixel-identical frames, so those cursors hold dead still too. Long frozen
 * stretches are a sign of dead air in the *script*, not something to paper over
 * in the renderer.
 */
export function cursorAt(
  track: CursorSample[],
  clicks: ClickEvent[],
  tS: number,
): CursorState | null {
  const here = samplePath(track, tS);
  if (!here) return null;

  let squash = 1;
  let ripple: number | null = null;
  for (const c of clicks) {
    if (c.tDownMs == null) continue;
    const since = tS - c.tDownMs / 1000;
    if (since < 0) continue;
    if (since <= CLICK_SQUASH_S) {
      squash = Math.min(
        squash,
        mix(CLICK_SQUASH, 1, clamp(since / CLICK_SQUASH_S, 0, 1)),
      );
    }
    if (since <= RIPPLE_S) ripple = clamp(since / RIPPLE_S, 0, 1);
  }

  return {
    x: here.x,
    y: here.y,
    squash,
    ripple,
    opacity: cursorOpacity(clicks, tS),
  };
}
