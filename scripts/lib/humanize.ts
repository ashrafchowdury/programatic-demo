/**
 * The pointer and keyboard as a person drives them — pure maths, no page.
 *
 * recorder.ts owns the side effects (mouse.move, keyboard.type, the click log);
 * everything here is a function of its inputs and a seed, so a re-shoot of the
 * same flow draws the same paths and types with the same rhythm, and the shape
 * of each can be tested without a browser.
 */
import { DEFAULT_PLAYBACK_RATE } from "../../src/lib/click-log";

/** A point in viewport CSS px. */
export type Pt = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * A seeded [0, 1) stream: FNV-1a over the seed string into mulberry32.
 *
 * Seeded from the flow and the action's index in it (see buildContext), so the
 * same flow re-shot draws the same bows and types with the same rhythm — a
 * retake differs only where the APP did something different, which is what
 * makes two takes comparable frame by frame.
 */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flash & Hogan's minimum-jerk position profile, 0..1 over 0..1. */
export const minJerk = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * u * (10 - 15 * u + 6 * u * u);
};

/**
 * Time warp that moves the speed peak ahead of the midpoint.
 *
 * Aimed human reaches are not symmetric: the deceleration phase runs longer
 * than the acceleration — the homing-in on the target — and peak velocity
 * lands at ~40-45% of the movement. A pure minimum-jerk profile peaks at
 * exactly 50%. Warping time by t^0.85 puts the peak at 0.42 T (sampled; see
 * humanize.test.ts) while keeping both ends at zero velocity:
 * d/dt of minJerk(t^a) ~ t^(3a - 1) near 0, which vanishes for any a > 1/3.
 *
 * The camera's curve (CAMERA_BEZIER) was used here before, and it is the wrong
 * shape for a hand: it reaches 84% of the distance by half time and then creeps
 * for the second half, which reads as a pointer that snaps most of the way and
 * then drifts in.
 */
export const GLIDE_SKEW = 0.85;
export const glideEase = (t: number): number =>
  minJerk(Math.pow(clamp(t, 0, 1), GLIDE_SKEW));

/**
 * Mean glide speed in design px per SCREEN ms (~700 px/s at DESIGN_WIDTH).
 * The reference cursors measure 300-900 px/s on screen.
 *
 * Was 0.55. Moving the glide onto the screen clock (below) took the pointer
 * from the ~690 px/s it had actually been playing at down to 550, and the
 * 540-670 px throws of the automation forms from 0.5-0.85 s to 1.0-1.3 s on
 * screen each: gmail-automation's four long throws took 2.3 s more recording
 * than before, over half of its 20% runtime growth. 0.7 restores the speed the earlier
 * renders showed (the frame-by-frame reviews never flagged it as fast) while
 * keeping what the clock fix was for — the 450-1350 ms window is still on
 * screen, so a short hop no longer plays in 360 ms. Replayed through the
 * recorder's timing (camera room included): gmail -0.96 s, hourly -0.2 s,
 * agent-tool -0.5 s; presses mid-move and early zoom-outs stay 0.
 */
export const GLIDE_PX_PER_MS = 0.7;
/** The measured on-screen travel window a glide is clamped to, ms. */
export const GLIDE_MIN_MS = 450;
export const GLIDE_MAX_MS = 1350;

/**
 * Recording-clock duration of a glide over `designPx` (distance at
 * DESIGN_WIDTH), so that it takes 450-1350 ms ON SCREEN at playback `rate`.
 * The recorder passes the rate the shoot is paced for (recordingRate, i.e.
 * DEMO_SPEED); the default is only for callers with no shoot to ask.
 *
 * Those bounds and the ~550 px/s mean were measured off reference footage, i.e.
 * on screen, but the glide used them on the recording clock, which the render
 * replays at DEFAULT_PLAYBACK_RATE: every glide played 1.25x fast (~690 px/s
 * mean, 360-1080 ms), shorter than the camera move meant to arrive with it.
 * Multiplying by the rate puts the glide back on the clock it was measured on.
 */
export function glideTravelMs(
  designPx: number,
  rate = DEFAULT_PLAYBACK_RATE,
): number {
  return clamp(designPx / GLIDE_PX_PER_MS, GLIDE_MIN_MS, GLIDE_MAX_MS) * rate;
}

/**
 * The corrective sub-movement after an overshoot, on screen ms, or a fifth of
 * the primary when that is longer. Human secondary sub-movements run ~100-250
 * ms; the old fixed 130 ms (recording) played at 104 ms, the snappy end of that.
 * Scaling with the primary keeps the correction ending AFTER the primary on a
 * slow throw — a fixed 150 ms began and finished inside the last 15% of a
 * 1.7 s glide and the overshoot shrank to 10 px (17 px at 0.2 T; sampled).
 */
export const CORRECTION_MS = 150;
export const CORRECTION_FRAC = 0.2;
/**
 * Where in the primary movement the correction begins, as a fraction of it.
 *
 * The correction used to start after the primary had stopped dead on its
 * overshoot point — a stop, then a second go. A real corrective sub-movement
 * overlaps the tail of the first: it launches while the hand is still
 * decelerating, and the two velocities add. At 0.85 T the primary still carries
 * ~18% of its peak speed, which carries the pointer through the turn: sampled
 * over 700-1700 ms throws, speed through the hook bottoms out at 2.5-4% of peak
 * instead of the dead stop (0) the old stop-then-correct made.
 */
export const CORRECTION_AT = 0.85;

export type GlideOpts = {
  /** Primary movement duration, recording ms. */
  durationMs: number;
  /** Seeded stream for the bow and the overshoot. */
  rand: () => number;
  /** Overshoot distance (viewport px); 0 = land on target directly. */
  overshootPx?: number;
  /** Correction duration, recording ms. Default: see CORRECTION_MS. */
  correctionMs?: number;
  /**
   * Playback rate the shoot is paced for, which puts the default correction's
   * CORRECTION_MS (screen ms) on the recording clock. Default 1.25.
   */
  rate?: number;
  /** Viewport to keep the control point and the overshoot inside. */
  bounds?: { width: number; height: number };
};

export type GlidePlan = {
  /** Whole glide including any correction, recording ms. */
  durationMs: number;
  /** Pointer position `ms` into the glide (held at the ends outside it). */
  at: (ms: number) => Pt;
};

/**
 * One pointer glide from `from` to `to`.
 *
 * A quadratic Bézier bowed to one side — by a seeded 3-14% of the distance, to
 * a seeded side. Every path used to bow exactly 10%, to the side fixed by the
 * quadrant of travel, so every left-to-right-downward move drew the identical
 * arc; the reference cursors measure 0.245-0.953 straightness, never a constant.
 *
 * Long throws overshoot and correct (see recorder.ts). The overshoot point sits
 * past the target AND off to the bow's side, and the correction is a second
 * minimum-jerk sub-movement superimposed on the tail of the first. Because the
 * correction vector is never collinear with the primary's end tangent (the bow
 * pulls the tangent to the other side), the summed velocity turns through the
 * hook instead of passing through zero.
 */
export function planGlide(from: Pt, to: Pt, opts: GlideOpts): GlidePlan {
  const { rand, bounds } = opts;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const T1 = Math.max(1, opts.durationMs);
  if (dist < 1e-6) return { durationMs: T1, at: () => ({ ...to }) };

  const ux = (to.x - from.x) / dist;
  const uy = (to.y - from.y) / dist;
  const nx = -uy;
  const ny = ux;
  const side = rand() < 0.5 ? -1 : 1;
  const bulge = side * dist * (0.03 + 0.11 * rand());
  const inX = (v: number) => (bounds ? clamp(v, 1, bounds.width - 1) : v);
  const inY = (v: number) => (bounds ? clamp(v, 1, bounds.height - 1) : v);

  const over = Math.max(0, opts.overshootPx ?? 0);
  const along = over * (0.7 + 0.6 * rand());
  const lateral = side * over * (0.35 + 0.3 * rand());
  const aim: Pt =
    over > 0
      ? {
          x: inX(to.x + ux * along + nx * lateral),
          y: inY(to.y + uy * along + ny * lateral),
        }
      : { ...to };
  const cp: Pt = {
    x: inX((from.x + aim.x) / 2 + nx * bulge),
    y: inY((from.y + aim.y) / 2 + ny * bulge),
  };

  const primary = (ms: number): Pt => {
    const p = glideEase(ms / T1);
    const u = 1 - p;
    return {
      x: u * u * from.x + 2 * u * p * cp.x + p * p * aim.x,
      y: u * u * from.y + 2 * u * p * cp.y + p * p * aim.y,
    };
  };
  if (over <= 0) return { durationMs: T1, at: primary };

  const T2 = Math.max(
    1,
    opts.correctionMs ??
      Math.max(
        CORRECTION_MS * (opts.rate ?? DEFAULT_PLAYBACK_RATE),
        CORRECTION_FRAC * T1,
      ),
  );
  const c0 = CORRECTION_AT * T1;
  const total = Math.max(T1, c0 + T2);
  const dx = to.x - aim.x;
  const dy = to.y - aim.y;
  return {
    durationMs: total,
    at: (ms) => {
      const p = primary(ms);
      const q = minJerk((ms - c0) / T2);
      return { x: p.x + dx * q, y: p.y + dy * q };
    },
  };
}

/** Mean per-key interval the typing plan is normalised to, recording ms. */
export const TYPE_MEAN_MS = 33;

/**
 * Per-character delays (ms BEFORE each key) for typing `text`.
 *
 * Replaces a fixed 30 ms/char, which reads as a metronome. Each key gets a
 * seeded 0.6-1.4x jitter; the first key of a word waits ~3x (the reach for a
 * new word), and a key after punctuation ~2x. The plan is then scaled so it
 * sums to text.length * meanMs: the rhythm changes, the beat's length does not,
 * so the flows' pacing and every hold measured against a typing beat stay put.
 *
 * meanMs 33 is the old rate as it actually ran: `keyboard.type(…, {delay: 30})`
 * plus CDP dispatch measured 33 ms/char (gmail-automation: 30 chars in 980 ms).
 */
export function typingDelays(
  text: string,
  rand: () => number,
  meanMs = TYPE_MEAN_MS,
): number[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  const w = chars.map((ch, i) => {
    const prev = i > 0 ? chars[i - 1] : "";
    let k = 0.6 + 0.8 * rand();
    if (i > 0 && /\s/.test(prev) && !/\s/.test(ch)) k *= 3;
    else if (/[.,;:!?]/.test(prev)) k *= 2;
    return k;
  });
  const sum = w.reduce((a, b) => a + b, 0);
  const scale = (chars.length * meanMs) / sum;
  return w.map((k) => k * scale);
}
