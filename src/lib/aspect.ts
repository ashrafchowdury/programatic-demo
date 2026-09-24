/**
 * Output aspect: one reel spec cut 16:9, 1:1 or 9:16.
 *
 * Launch films live on social feeds, and a feed is square or vertical. The
 * footage is always a 16:9 screen recording, so every other aspect is a CROP of
 * it — and a static crop cannot work: a 9:16 frame holding a 16:9 recording at
 * full height sees 32% of its width, and the thing being clicked moves across
 * the whole of it. So the crop MOVES, following the clicks.
 *
 * THE MODEL. The picture a 16:9 cut would draw — the footage with its authored
 * crop, pointer included — is a PLATE of the 16:9 film's size. At another aspect
 * the plate is scaled to cover a BOX (the frame, full-bleed; the window, framed)
 * and slid under it so a per-frame centre (followTrack) lands in the middle.
 * Everything drawn ON the footage rides the plate, so the pointer can never
 * drift off its target; everything drawn over the FRAME (keycap, overlays,
 * cards) is laid out for the new frame.
 *
 * SIZE: the SHORT side is kept. 9:16 renders 1440x2560 and 1:1 1440x1440 beside
 * a 2560x1440 16:9 cut, so every vector element (type, pointer, window radius)
 * is the same pixel size in all three and the frame just gets taller or
 * narrower. The alternative the brief offered — 1:1 at 2160 — buys nothing: the
 * footage there is 2560x1440 of plate either way, measured below.
 *
 *   aspect  size        plate on screen   source->output, 3840 capture | 1920
 *   16:9    2560x1440   2560x1440 (1.00)  0.67                         | 1.33
 *   1:1     1440x1440   2560x1440 (1.00)  0.67                         | 1.33
 *   1:1     2160x2160   3840x2160 (1.50)  1.00                         | 2.00
 *   9:16    1440x2560   4551x2560 (1.78)  1.19                         | 2.37
 *   9:16    1080x1920   3413x1920 (1.78)  0.89                         | 1.78
 *
 * 1:1 at 1440 shows the same source pixels at the same size as the 16:9 cut, so
 * it is exactly as sharp. 9:16 at 1440 stays under SHARPNESS_CEILING (1.74) for
 * any capture at CAPTURE_SCALE=2 — the default — and over it for a 1x capture,
 * which `pnpm reel --check` says out loud per clip. Dropping 9:16 to 1080 would
 * buy a 1x capture nothing (1.78 is still over) and shrink every card.
 *
 * Pure: no React, no Remotion. DemoClip renders it; scripts/lib/reel-cut.ts
 * reports its cost before anything renders.
 */
import { clamp, type CameraPose } from "./camera";
import { LEAD_FALLBACK_S, type ClickLog } from "./click-log";
import type { ResolvedCrop } from "./crop";
import { samplePath } from "./cursor";

export const ASPECTS = ["16:9", "1:1", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** The recording's own shape, and every reel's until it says otherwise. */
export const NATIVE_ASPECT: Aspect = "16:9";

export const isAspect = (v: unknown): v is Aspect =>
  typeof v === "string" && (ASPECTS as readonly string[]).includes(v);

/** True when `aspect` needs no crop: absent, or the native 16:9. */
export const isNativeAspect = (aspect?: Aspect): boolean =>
  aspect == null || aspect === NATIVE_ASPECT;

/** "9:16" -> "9x16", for file names: out/reel/<name>.9x16.mp4. */
export const aspectSlug = (aspect: Aspect): string => aspect.replace(":", "x");

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

const even = (n: number) => Math.round(n / 2) * 2;

/**
 * The composition size at `aspect`, given the native (16:9) one. The short side
 * is kept — see the table above. Native returns `base` itself.
 */
export function aspectSize(base: Size, aspect?: Aspect): Size {
  if (isNativeAspect(aspect)) return base;
  const short = Math.min(base.width, base.height);
  const [w, h] = aspect!.split(":").map(Number);
  return w >= h
    ? { width: even((short * w) / h), height: even(short) }
    : { width: even(short), height: even((short * h) / w) };
}

/** Scale that makes `plate` cover `box` exactly (the larger of the two fits). */
export const coverScale = (box: Size, plate: Size): number =>
  Math.max(box.width / plate.width, box.height / plate.height);

/**
 * How much bigger the footage is at rest at `size` than in the native cut:
 * 1.78 at 9:16, 1.00 at 1:1. The same for a window, whose box is `fit` of the
 * frame at every aspect, so `fit` cancels.
 */
export const aspectMagnification = (base: Size, size: Size): number =>
  coverScale(size, base);

/**
 * Source pixels per output pixel at `size` — 1.0 is exactly 1:1 — for footage
 * `sourceWidth` wide under a crop of magnification `k` in a box `fit` of the
 * frame. Same meaning as cropUpscale in src/lib/crop.ts, and compared against
 * the same SHARPNESS_CEILING.
 */
export function aspectUpscale(
  sourceWidth: number,
  base: Size,
  size: Size,
  k = 1,
  fit = 1,
): number {
  if (sourceWidth <= 0) return 1;
  return (base.width * aspectMagnification(base, size) * k * fit) / sourceWidth;
}

/**
 * Half the plate visible in `box` at rest, as fractions of the plate. 0.158 x
 * 0.5 for a 9:16 frame over a 16:9 plate: all of its height, a sixth of its
 * width either side of the centre.
 */
export function visibleHalf(box: Size, plate: Size): Point {
  const s = coverScale(box, plate);
  return {
    x: Math.min(0.5, box.width / (s * plate.width) / 2),
    y: Math.min(0.5, box.height / (s * plate.height) / 2),
  };
}

/** Where footage exists on the plate, in plate fractions. */
export type Bounds = { x0: number; x1: number; y0: number; y1: number };

/** Footage point (viewport fractions) -> plate fraction, through the crop. */
export function cropPoint(p: Point, crop?: ResolvedCrop): Point {
  if (!crop) return p;
  return {
    x: crop.cx + (p.x - crop.cx) * crop.k + crop.dx,
    y: crop.cy + (p.y - crop.cy) * crop.k + crop.dy,
  };
}

/** A footage box (viewport fractions) -> its box on the plate, through the crop. */
export function cropRect(
  r: { x: number; y: number; w: number; h: number },
  crop?: ResolvedCrop,
): { x: number; y: number; w: number; h: number } {
  const a = cropPoint({ x: r.x, y: r.y }, crop);
  const b = cropPoint({ x: r.x + r.w, y: r.y + r.h }, crop);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/**
 * The footage's extent on the plate: the crop's image of [0,1]^2, cut to the
 * plate. A pan can leave a strip of `pageBg` at one edge of a native cut; the
 * moving crop must not slide that strip into the middle of a vertical one.
 */
export function footageBounds(crop?: ResolvedCrop): Bounds {
  const a = cropPoint({ x: 0, y: 0 }, crop);
  const b = cropPoint({ x: 1, y: 1 }, crop);
  return {
    x0: Math.max(0, Math.min(a.x, b.x)),
    x1: Math.min(1, Math.max(a.x, b.x)),
    y0: Math.max(0, Math.min(a.y, b.y)),
    y1: Math.min(1, Math.max(a.y, b.y)),
  };
}

/**
 * A view of the plate: centre (cx, cy) in plate fractions, magnified `scale`
 * over the at-rest cover. Same shape as a CameraPose on purpose, so the camera's
 * own interpolation (interpolatePose) moves it.
 */
export type View = CameraPose;

/** Keep the view's edges inside the footage at its magnification. */
export function clampView(view: View, half: Point, bounds: Bounds): View {
  const m = Math.max(1, view.scale);
  const along = (c: number, h: number, lo: number, hi: number) =>
    hi - lo <= 2 * h ? (lo + hi) / 2 : clamp(c, lo + h, hi - h);
  return {
    scale: m,
    cx: along(view.cx, half.x / m, bounds.x0, bounds.x1),
    cy: along(view.cy, half.y / m, bounds.y0, bounds.y1),
  };
}

// ---------------------------------------------------------------------------
// The follow: where the moving crop is centred, per frame
// ---------------------------------------------------------------------------

/**
 * How far ahead of and behind a subject change the crop spreads its move, as a
 * Gaussian sigma in SCREEN seconds. The move reads as ~4 sigma end to end.
 *
 * With FOLLOW_SMOOTH_S below, measured over every click log in public/ that
 * carries a pointer track (16 of them), full-bleed at 9:16:
 *
 *   sigma  smooth  pointer outside crop  peak pan (px/frame)  pan at a press
 *   0.20   0.10    max 1.3% of frames    max 234, mean 116    max 1
 *   0.30   0.15    max 2.6%              max 180, mean 84     max 5
 *   0.30   0.20    max 3.1%              max 160, mean 75     max 6   <- this
 *   0.45   0.20    max 3.5%              max 147, mean 68     —
 *
 * Every press lands with the pointer inside the crop at all four. The frames
 * outside are mid-hop, on the long cross-page moves (new-automation,
 * model-providers), where the hand outruns any pan a viewer can follow. The
 * peak is set by those same hops — the pointer clamp drags the crop with the
 * hand — so a wider sigma buys little and the second pass buys more. For scale:
 * the reference film's fastest move is ~34px/frame at 1080p, and the zoom
 * camera routes any pan over MAX_PAN_PX through base instead; a vertical crop
 * of a whole-page hop has no wider framing to route through.
 */
export const FOLLOW_SIGMA_S = 0.3;
/**
 * Second pass that rounds off the corners the pointer clamp leaves, in screen
 * seconds. It relaxes that clamp by up to its own reach, which is what
 * FOLLOW_MARGIN absorbs; see the table above for what it trades.
 */
export const FOLLOW_SMOOTH_S = 0.2;
/**
 * Room kept between the pointer and the crop edge, as a share of the half-width.
 * The arrow's body hangs down-right of its hotspot; a quarter of the half-width
 * (~180px of a 1440 frame) keeps all of it in shot, and absorbs what the
 * second smoothing pass gives back.
 */
export const FOLLOW_MARGIN = 0.25;

/** Zero-phase Gaussian smoothing, ends held. */
function gaussian(values: Float64Array, sigma: number): Float64Array {
  if (!(sigma > 0) || values.length < 2) return Float64Array.from(values);
  const r = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  const n = values.length;
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let acc = 0;
    for (let i = -r; i <= r; i++)
      acc += w[i + r] * values[Math.min(n - 1, Math.max(0, f + i))];
    out[f] = acc / sum;
  }
  return out;
}

export type FollowSpec = {
  fps: number;
  speed: number;
  /** Frames to plan for: the composition's length. */
  frames: number;
  /** Half the plate visible at rest (visibleHalf). */
  half: Point;
  /** The clip's static crop; the follow works in plate fractions after it. */
  crop?: ResolvedCrop;
};

export type Follow = { x: Float64Array; y: Float64Array };

/**
 * Log seconds at composition frame `f` — the clock Cursor and zoomAt read.
 */
const logS = (f: number, spec: FollowSpec, log: ClickLog) =>
  (f / spec.fps) * spec.speed - (log.offsetMs ?? 0) / 1000;

/** The click the story is about at log time `tMs`: the last one departed for. */
function subjectIndex(departs: number[], tMs: number): number {
  let i = 0;
  while (i + 1 < departs.length && departs[i + 1] <= tMs) i++;
  return i;
}

/**
 * The crop centre for every frame of the composition, in plate fractions.
 *
 * Three passes, each pure and each over the whole clip, so any frame can be
 * rendered alone (Remotion renders frames in parallel, out of order):
 *
 *   1. TARGET — the centre of the control the pointer is heading for, from the
 *      moment it departs toward it (tDepartMs), held until it departs again.
 *      Before the first departure the first target is already framed, so a
 *      clip that enters on its action opens on it. Smoothed by FOLLOW_SIGMA_S.
 *   2. POINTER — clamped so the recorded pointer stays FOLLOW_MARGIN inside the
 *      crop. A target alone can leave the hand behind on a long, fast hop.
 *   3. EDGES — re-smoothed by FOLLOW_SMOOTH_S, then held inside the footage so
 *      the plate always covers the box.
 *
 * Read-only use of the click log: the zoom camera's own track is framed for a
 * 16:9 window (frameFor clamps a subject near an edge toward the centre), which
 * is the opposite of what a narrow crop needs, so the targets come from the
 * click rects instead. The camera still contributes its MAGNIFICATION — see
 * DemoClip.
 */
export function followTrack(log: ClickLog, spec: FollowSpec): Follow {
  const n = Math.max(1, spec.frames);
  const W = log.viewport.width || 1;
  const H = log.viewport.height || 1;
  const half = spec.half;
  const bounds = footageBounds(spec.crop);
  const tx = new Float64Array(n).fill(0.5);
  const ty = new Float64Array(n).fill(0.5);

  const clicks = [...(log.clicks ?? [])].sort((a, b) => a.tMs - b.tMs);
  if (clicks.length) {
    const targets = clicks.map((c) =>
      cropPoint(
        {
          x: (c.rect ? c.rect.x + c.rect.w / 2 : c.x) / W,
          y: (c.rect ? c.rect.y + c.rect.h / 2 : c.y) / H,
        },
        spec.crop,
      ),
    );
    const departs = clicks.map((c) => c.tDepartMs ?? c.tMs - LEAD_FALLBACK_S * 1000);
    for (let f = 0; f < n; f++) {
      const t = targets[subjectIndex(departs, logS(f, spec, log) * 1000)];
      tx[f] = t.x;
      ty[f] = t.y;
    }
  }
  const sigma = Math.max(1, Math.round(FOLLOW_SIGMA_S * spec.fps));
  let x = gaussian(tx, sigma);
  let y = gaussian(ty, sigma);

  const track = log.cursorTrack;
  if (track?.length) {
    const hx = half.x * (1 - FOLLOW_MARGIN);
    const hy = half.y * (1 - FOLLOW_MARGIN);
    for (let f = 0; f < n; f++) {
      const at = samplePath(track, logS(f, spec, log));
      if (!at) continue;
      const p = cropPoint({ x: at.x / W, y: at.y / H }, spec.crop);
      x[f] = clamp(x[f], p.x - hx, p.x + hx);
      y[f] = clamp(y[f], p.y - hy, p.y + hy);
    }
  }
  const smooth = Math.max(1, Math.round(FOLLOW_SMOOTH_S * spec.fps));
  x = gaussian(x, smooth);
  y = gaussian(y, smooth);
  for (let f = 0; f < n; f++) {
    const v = clampView({ scale: 1, cx: x[f], cy: y[f] }, half, bounds);
    x[f] = v.cx;
    y[f] = v.cy;
  }
  return { x, y };
}

const followCache = new WeakMap<ClickLog, Map<string, Follow>>();

/**
 * followTrack, planned once per (log, spec) and read per frame. Keyed on the
 * numbers only, so two clips of one reel that share a crop share a plan.
 */
export function cachedFollow(log: ClickLog, spec: FollowSpec): Follow {
  let byKey = followCache.get(log);
  if (!byKey) {
    byKey = new Map();
    followCache.set(log, byKey);
  }
  const key = JSON.stringify(spec);
  let plan = byKey.get(key);
  if (!plan) {
    plan = followTrack(log, spec);
    byKey.set(key, plan);
  }
  return plan;
}

/** The follow's centre at `frame`, holding the ends. */
export function followAt(follow: Follow, frame: number): Point {
  const i = Math.min(follow.x.length - 1, Math.max(0, Math.round(frame)));
  return { x: follow.x[i], y: follow.y[i] };
}

/**
 * CSS for the plate: a `plate`-sized box centred in its container, scaled
 * `s * view.scale` and slid so plate point (cx, cy) lands on the container's
 * centre. Pixels, not percentages, because it is read against the PLATE's size
 * and a percentage translate is too — but only for the part before the scale.
 */
export function plateTransform(view: View, plate: Size, s: number): string {
  const m = s * view.scale;
  const tx = (0.5 - view.cx) * plate.width * m;
  const ty = (0.5 - view.cy) * plate.height * m;
  return `translate(${tx}px, ${ty}px) scale(${m})`;
}

/**
 * Share of frames on which the pointer is outside the crop, and the fastest the
 * crop pans, in output px per frame. What the tests pin and --check reports.
 */
export function followReport(
  log: ClickLog,
  spec: FollowSpec,
  frames: { first: number; last: number },
  plateWidth: number,
  s: number,
): { outside: number; peakPx: number } {
  const plan = cachedFollow(log, spec);
  const W = log.viewport.width || 1;
  const H = log.viewport.height || 1;
  let out = 0;
  let n = 0;
  let peak = 0;
  for (let f = frames.first; f <= frames.last; f++) {
    const c = followAt(plan, f);
    if (f > frames.first) {
      const prev = followAt(plan, f - 1);
      peak = Math.max(peak, Math.abs(c.x - prev.x) * plateWidth * s);
    }
    const at = log.cursorTrack?.length ? samplePath(log.cursorTrack, logS(f, spec, log)) : null;
    if (!at) continue;
    const p = cropPoint({ x: at.x / W, y: at.y / H }, spec.crop);
    n++;
    if (Math.abs(p.x - c.x) > spec.half.x || Math.abs(p.y - c.y) > spec.half.y) out++;
  }
  return { outside: n ? out / n : 0, peakPx: peak };
}

/**
 * Where plate point `q` (plate fractions) lands in the output frame, as frame
 * fractions, under `view` — the inverse reading of plateTransform: the plate is
 * centred in the frame (and in a centred window box, which shares that centre),
 * scaled `s * view.scale`, and slid so (cx, cy) sits on the centre. What places
 * an overlay chip against the moving crop without rendering it.
 */
export function aspectFramePoint(
  q: Point,
  view: View,
  plate: Size,
  s: number,
  frame: Size,
): Point {
  const m = s * view.scale;
  return {
    x: 0.5 + ((q.x - view.cx) * plate.width * m) / frame.width,
    y: 0.5 + ((q.y - view.cy) * plate.height * m) / frame.height,
  };
}
