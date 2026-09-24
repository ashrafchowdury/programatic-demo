/**
 * A clip's OPENING POSE: how tight its first frame is, and on what.
 *
 * A reel cuts a card into a clip, and the best cuts MATCH — the card's chip
 * punches into "Create", the clip opens tight on the real Create button. Until
 * this existed a clip's first frame was whatever the footage's own camera was
 * doing at `fromS`, which nothing in the spec stated and nothing checked:
 * agent-skill's "create and land" clip is commented "opens tight on the button
 * at 1.74x" and shipped opening on the whole window (audit R10, reel f527->528),
 * because the reel had been cut in a camera-less style.
 *
 *   { clip: { fromBeat: "Create", leadS: -0.2, tailS: 2.5,
 *             open: { scale: 1.74, at: "Create" } } }
 *
 * The first frame is framed at `scale` about `at`, then eases into whatever the
 * style would have shown — the zoom camera's pose, the static crop, the moving
 * aspect crop — on the camera's own curve (interpolatePose). When the style is
 * already there, the ease is a no-op; when it is not, the opening is honoured
 * rather than silently lost. `pnpm reel --check` prints every clip's first-frame
 * scale beside what the footage alone would have opened on, so a mismatch shows.
 *
 * `scale` is in the units the clip's framing already uses: the zoom camera's
 * pose scale on a windowed style (1 = the whole window, 1.74 = S_MAX), the
 * crop's `k` on a full-bleed one (1 = the whole frame). Asking for less than the
 * framing already has does nothing: an opening only ever pushes IN.
 *
 * Pure: no React. DemoClip renders it, reel-cut reports it.
 */
import {
  interpolatePose,
  moveDuration,
  panLimit,
  type CameraPose,
} from "./camera";
import type { ClickLog } from "./click-log";
import type { Point } from "./aspect";

/** As authored on a clip. */
export type ClipOpen = {
  /** Magnification of the first frame, in the framing's own units (above). */
  scale: number;
  /**
   * What the first frame is centred on: a click-log beat label (its control's
   * centre, same matching as `fromBeat`), or a point in footage fractions.
   * Absent = the centre of the frame.
   */
  at?: string | Point;
  /**
   * Seconds (on screen) to ease from the opening into the style's own framing.
   * Absent = what the zoom camera itself would take for that move
   * (moveDuration), so the release reads as one of its own moves.
   */
  settleS?: number;
};

/** After resolveReel: `at` is a point. What DemoClip receives. */
export type ResolvedOpen = { scale: number; at: Point; settleS?: number };

/** Why an authored `open` cannot be honoured, or null. */
export function openProblem(open: unknown): string | null {
  if (typeof open !== "object" || open === null) return "`open` must be an object";
  const o = open as Partial<ClipOpen>;
  if (!(typeof o.scale === "number" && o.scale >= 1 && o.scale <= 4))
    return "`open.scale` must be a number between 1 and 4";
  if (
    o.settleS !== undefined &&
    !(typeof o.settleS === "number" && o.settleS > 0 && o.settleS <= 5)
  )
    return "`open.settleS` must be a number of seconds between 0 and 5";
  if (o.at !== undefined && typeof o.at !== "string") {
    const p = o.at as Partial<Point>;
    if (
      typeof p !== "object" ||
      p === null ||
      !(typeof p.x === "number" && p.x >= 0 && p.x <= 1) ||
      !(typeof p.y === "number" && p.y >= 0 && p.y <= 1)
    )
      return "`open.at` must be a beat label or { x, y } in 0..1 footage fractions";
  }
  return null;
}

/** A beat's control centre, in footage fractions. */
export function beatPoint(
  beat: ClickLog["clicks"][number],
  vp: ClickLog["viewport"],
): Point {
  const r = beat.rect;
  return {
    x: (r ? r.x + r.w / 2 : beat.x) / (vp.width || 1),
    y: (r ? r.y + r.h / 2 : beat.y) / (vp.height || 1),
  };
}

/**
 * The opening as a camera pose over a framing whose own pose is `running`.
 *
 * `edgeScale` is the magnification the pan clamp is judged at: the window's
 * EFFECTIVE scale (fit * S) for the zoom camera — the rule frameFor holds its
 * own keyframes to, so an opening on a corner control lands exactly where the
 * camera would have put it — and the pose scale itself elsewhere. Never below
 * `running.scale`: an opening only pushes in.
 */
export function openPose(
  open: ResolvedOpen,
  running: CameraPose,
  edgeScale: (s: number) => number = (s) => s,
): CameraPose {
  const scale = Math.max(open.scale, running.scale);
  const lim = panLimit(edgeScale(scale));
  const clampC = (c: number) => Math.min(0.5 + lim, Math.max(0.5 - lim, c));
  return { scale, cx: clampC(open.at.x), cy: clampC(open.at.y) };
}

/** Frames the opening takes to hand over: authored, or the camera's own. */
export function openFrames(
  open: ResolvedOpen,
  from: CameraPose,
  to: CameraPose,
  vp: ClickLog["viewport"],
  speed: number,
  fps: number,
): number {
  const s =
    open.settleS ??
    moveDuration(from, to, from.scale > to.scale ? "out" : "in", vp, speed) / speed;
  return Math.max(1, Math.round(s * fps));
}

/**
 * The pose at `f` frames into the shot: the opening, eased into `running`.
 * Returns `running` itself once the hand-over is done.
 */
export function openAt(
  start: CameraPose,
  running: CameraPose,
  f: number,
  frames: number,
): CameraPose {
  if (f >= frames) return running;
  return interpolatePose(start, running, Math.max(0, f) / frames);
}
