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
export type ResolvedOpen = {
  scale: number;
  at: Point;
  /**
   * The target control's box in footage fractions, when `at` named a beat that
   * recorded one. openPose keeps it wholly in shot, with a margin.
   */
  rect?: { x: number; y: number; w: number; h: number };
  settleS?: number;
};

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
 * Frame share kept between the opening's target and the frame edge. A button
 * flush against the edge reads as cut off even when every pixel is in shot:
 * agent-skill's Create sat on the bottom-right corner, its rect running 8px
 * past the footage, and opened "half cut off" (round-3 review).
 */
export const OPEN_MARGIN = 0.05;

/** How a framing turns a pose scale into what the frame shows. */
export type OpenFraming = {
  /**
   * The magnification the PAN CLAMP is judged at — the render's own clamp,
   * poseToCss's panLimit on the pose scale. Default: the scale itself.
   */
  clampScale?: (s: number) => number;
  /**
   * Content magnification relative to the frame: 1 shows the whole picture.
   * The window camera's is fit * s (the window sits at `fit` of the frame).
   * Default: the scale itself.
   */
  viewScale?: (s: number) => number;
};

/** Step between the scales openPose tries when the target does not fit. */
const FIT_STEP = 0.01;

/** A beat's control box in footage fractions, or undefined when it has none. */
export function beatRect(
  beat: ClickLog["clicks"][number],
  vp: ClickLog["viewport"],
): ResolvedOpen["rect"] {
  const r = beat.rect;
  if (!r) return undefined;
  const W = vp.width || 1;
  const H = vp.height || 1;
  return { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
}

/**
 * The opening as a camera pose over a framing whose own pose is `running`.
 *
 * CENTRED on the target, as far as the pan clamp allows. It used to be clamped
 * where the zoom camera's KEYFRAMES are (the framing rule on the window's
 * effective scale), which put a corner control on the frame's corner — the
 * camera's choice for a hold, and the wrong one for a match cut, whose whole
 * point is that the control the card punched into is the subject. The render
 * clamp (`clampScale`, the pose scale) is looser: it shows as much backdrop past
 * the window edge as the base shot does, which is enough to bring a corner
 * button in off the edge.
 *
 * When even that clamp leaves the target's box (`rect`) closer than
 * OPEN_MARGIN to the frame edge, the scale steps down to the largest at which
 * it is fully inside with the margin — never below `running.scale`: an opening
 * only pushes in.
 */
export function openPose(
  open: ResolvedOpen,
  running: CameraPose,
  framing: OpenFraming = {},
): CameraPose {
  const clampScale = framing.clampScale ?? ((s: number) => s);
  const viewScale = framing.viewScale ?? ((s: number) => s);
  const poseAt = (scale: number): CameraPose => {
    const lim = panLimit(clampScale(scale));
    const clampC = (c: number) => Math.min(0.5 + lim, Math.max(0.5 - lim, c));
    return { scale, cx: clampC(open.at.x), cy: clampC(open.at.y) };
  };
  const fits = (p: CameraPose): boolean => {
    const r = open.rect;
    if (!r) return true;
    const v = viewScale(p.scale);
    // Half the frame in content units, less the margin.
    const h = (0.5 - OPEN_MARGIN) / v;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(1, r.x + r.w);
    const y1 = Math.min(1, r.y + r.h);
    return x0 >= p.cx - h && x1 <= p.cx + h && y0 >= p.cy - h && y1 <= p.cy + h;
  };
  const top = Math.max(open.scale, running.scale);
  for (let s = top; s > running.scale; s -= FIT_STEP) {
    const p = poseAt(s);
    if (fits(p)) return p;
  }
  return poseAt(running.scale);
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
