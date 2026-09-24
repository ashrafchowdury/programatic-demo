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
  HAND_LEAD_S,
  HAND_HOLD_S,
  RIPPLE_S,
  type ClickEvent,
  type CursorSample,
} from "./click-log";
import { clamp, mix } from "./camera";

/**
 * Every window below — fade, ripple, squash, hand — is a SCREEN duration, but
 * `tS` and the log's times are on the recording clock, which the render replays
 * at `speed`. So each is multiplied by `speed` before it is compared, as the
 * keycap does (keycapAt). Unscaled, a 1.25x render played the 180 ms fade in
 * 144 ms, the 350 ms ripple in 280 ms and the 120 ms squash in 96 ms, and at
 * 1.5x each ran a third short. `speed` defaults to 1, where nothing changes.
 */
const onScreen = (s: number, speed: number) => s * (speed > 0 ? speed : 1);

/** Which glyph the pointer draws: the arrow, or the hand a click shows. */
export type CursorKind = "arrow" | "pointer";

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
  /** Arrow normally; a hand for the window around a click (see cursorKind). */
  kind: CursorKind;
};

/**
 * Arrow, except a hand while HOVERING a clickable element — the "cursor: pointer"
 * a real button or link shows. It appears the instant the pointer enters the
 * control and releases when it leaves, so it leads the click instead of trailing
 * it, exactly like the OS cursor.
 *
 * Hover is the pointer sitting inside the clicked element's box, which rides in
 * the log as `rect` (viewport CSS px, the cursor track's space). But a rect is
 * only real WHILE that element is on screen: a menu item's box does not exist
 * before the menu opens or after it closes, so the test is gated to each click's
 * own interaction window — from when the pointer sets off toward it (tDepartMs)
 * until just after the press. Without that gate the pointer lit up a hand every
 * time it merely passed over the spot where a since-closed menu had been.
 *
 * A typing beat carries `typeEndMs` and is skipped — a text field shows a caret,
 * not a hand, and the pointer is faded there anyway. A click with no rect (older
 * logs, focus beats) has no box to test, so the window alone drives the hand.
 */
export function cursorKind(
  clicks: ClickEvent[],
  tS: number,
  pos: { x: number; y: number },
  speed = 1,
): CursorKind {
  const lead = onScreen(HAND_LEAD_S, speed);
  const hold = onScreen(HAND_HOLD_S, speed);
  for (const c of clicks) {
    if (c.tDownMs == null || c.typeEndMs != null) continue;
    const from = c.tDepartMs != null ? c.tDepartMs / 1000 : c.tDownMs / 1000 - lead;
    const to = c.tDownMs / 1000 + hold;
    if (tS < from || tS > to) continue;
    const r = c.rect;
    if (!r) return "pointer";
    if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h)
      return "pointer";
  }
  return "arrow";
}

/**
 * Arrow opacity at `tS`. Fades out from the press that focuses the field and
 * back in when typing ends, so the handover to the app's blinking text caret is
 * not a hard pop.
 *
 * The fade-out STARTS at the press. It used to end at `tMs` (logged after
 * mouseup), so it began 180ms before — ~100ms before the arrow had even
 * clicked, and the viewer saw the pointer dissolve on its way in. Now the
 * click lands with a full arrow, squash and ripple, and the arrow leaves
 * during the ~150ms the recorder waits before the first key.
 */
export function cursorOpacity(
  clicks: ClickEvent[],
  tS: number,
  speed = 1,
): number {
  const fade = onScreen(CURSOR_FADE_S, speed);
  let opacity = 1;
  for (const c of clicks) {
    if (c.typeEndMs == null) continue;
    const press = (c.tDownMs ?? c.tMs) / 1000;
    const to = c.typeEndMs / 1000;
    if (tS <= press || tS >= to + fade) continue;
    const fadingOut = clamp(1 - (tS - press) / fade, 0, 1);
    const fadingIn = clamp((tS - to) / fade, 0, 1);
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
  speed = 1,
): CursorState | null {
  const here = samplePath(track, tS);
  if (!here) return null;

  const squashS = onScreen(CLICK_SQUASH_S, speed);
  const rippleS = onScreen(RIPPLE_S, speed);
  let squash = 1;
  let ripple: number | null = null;
  for (const c of clicks) {
    if (c.tDownMs == null) continue;
    const since = tS - c.tDownMs / 1000;
    if (since < 0) continue;
    if (since <= squashS) {
      squash = Math.min(squash, mix(CLICK_SQUASH, 1, clamp(since / squashS, 0, 1)));
    }
    if (since <= rippleS) ripple = clamp(since / rippleS, 0, 1);
  }

  return {
    x: here.x,
    y: here.y,
    squash,
    ripple,
    opacity: cursorOpacity(clicks, tS, speed),
    kind: cursorKind(clicks, tS, here, speed),
  };
}
