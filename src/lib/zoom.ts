import {
  ACTION_WATCH_S,
  BASE_BEAT_S,
  BASE_REST_S,
  CAMERA_LEAD_S,
  DESIGN_WIDTH,
  END_TAIL_S,
  HOLD_MIN_S,
  MOVE_FLOOR_S,
  SETTLE_BEFORE_PRESS_S,
  TYPE_TAIL_S,
  LEAD_FALLBACK_S,
  type ClickEvent,
  type ClickLog,
} from "./click-log";
import {
  basePose,
  BASE_POSE,
  clamp,
  groupToContentY,
  interpolatePose,
  interpolateVia,
  MAX_PAN_PX,
  mix,
  moveDuration,
  panLimit,
  poseAlong,
  poseToCss,
  posesNearlyEqual,
  poseTravelPx,
  type CameraPose,
  type MoveSlopes,
} from "./camera";
import { WINDOW_FIT } from "./window";

// DemoClip.tsx still imports ClickLog from here; everything else takes it from
// ./click-log directly.
export type { ClickLog } from "./click-log";

export type ZoomState = {
  /** Effective on-screen magnification, WINDOW_FIT included. */
  scale: number;
  /** Pan, as fractions of the window group's own size (for CSS `translate(%)`). */
  translateX: number;
  translateY: number;
};

export type CameraKey = {
  t: number;
  pose: CameraPose;
  /**
   * Bend the move that ENDS at this key toward this pose (see interpolateVia).
   * Absent on ordinary keys, whose move is a straight line.
   */
  via?: CameraPose;
  /**
   * The move that ENDS at this key carries speed through its ends instead of
   * starting and landing at rest (see carryThrough). Absent on every move that
   * meets a hold, which is nearly all of them.
   */
  slopes?: MoveSlopes;
};

export type ZoomOptions = {
  /**
   * Top chrome height as a fraction of the window group (e.g. 38/1118).
   * Camera transform targets chrome+page together; poses remap into that space.
   */
  chromeFrac?: number;
  /** Composition speed vs the click-log clock. Default 1 (tests / unsped). */
  speed?: number;
  /** Base shrink of the window on the backdrop (WINDOW_FIT). Default 1. */
  fit?: number;
  /**
   * Hold drift, 0..1. OPT-IN and off by default — see driftPose.
   *
   * scripts/render.ts never passes it, so every demo mp4 renders exactly as it
   * does today. Only reel clips ask for it.
   */
  drift?: number;
};

// Region-framing knobs.
//
// These are CAMERA scale. What the viewer sees is WINDOW_FIT * scale, so these
// are budgeted against that: at WINDOW_FIT 0.86, S_MAX 1.74 shows the app at
// 1.50x native, which is where 1080p source stops holding up. If you change
// WINDOW_FIT in DemoClip.tsx, rescale these to keep the product near 1.5.
const S_MIN = 1.18;
export const S_MAX = 1.74;
const S_MAX_SOFT = 1.54;
/**
 * The least a punch may zoom when the target leaves it a choice.
 *
 * S_MIN is what the fit maths falls to on a wide control, and at WINDOW_FIT
 * 0.86 it puts the app on screen at 1.015x — two percent bigger than base,
 * which is not a zoom, it is the window twitching. Measured on a form whose
 * fields span 676-744px: every beat landed at S 1.18-1.26, the picture barely
 * changed, and the framing pan did all the visible moving. Below this
 * floor a punch does not read as one; 1.45 shows the app at 1.25x, the low end
 * of what the reference clips do on a punch.
 *
 * Applied only when the control still FITS at this scale (see WIDE_FIT). A
 * target that needs S_MIN to be seen whole — a full-height drawer passed as
 * `frame:` — keeps it, because cropping the thing the author framed is worse
 * than a soft zoom.
 */
const S_PUNCH_MIN = 1.45;
/** How much of the visible frame a lifted control may span before it is left at the fit scale. */
const WIDE_FIT = 0.92;
/**
 * Re-pose threshold inside a cluster (and when a pose carries over into the
 * next one): a click that is already in shot does not move the camera unless
 * the next control wants a tighter frame by at least this much. Without it a
 * form's three fields produced three poses at S 1.26 / 1.18 / 1.25 — each a
 * 0.7-1.0s blurred glide that changed the picture by 7% and read as a camera
 * that could not make up its mind. A cluster only tightens or pans to reach a
 * click; it never pulls back mid-cluster for a click it can already see.
 */
export const REPOSE_MIN_DS = 0.12;
const PAD = 80;
const MENU_ROOM = 110;
const FRAME_FRAC = 0.55;
/**
 * How far inside the frame edge a click is kept, as a fraction of the frame.
 *
 * A subject keeps its screen position through a punch (see frameFor), which is
 * fine when the framed region is small but can leave the CLICK ITSELF at the
 * very edge when the region is large and the click sits near its edge.
 */
export const CLICK_MARGIN = 0.04;
/**
 * Cursor weight: a hint toward the click, not the aim point.
 * The camera frames the region, not the pointer.
 */
const CLICK_WEIGHT = 0.2;

// Auto-clustering fallback when clicks omit `cluster`. Time gap in seconds.
export const GROUP_TIME_GAP = 2.2;
const GROUP_DIST_FRAC = 0.28;

/**
 * Sticky zoom: nearby *auto* clusters pan without fully trailing to 1.0.
 * Explicit cluster ids never sticky-merge with a different id.
 */
const STICKY_TIME_GAP = 2.8;
const STICKY_DIST_FRAC = 0.22;

const zoomable = (clicks: ClickEvent[]): ClickEvent[] =>
  clicks.filter((c) => c.zoom !== false);

export function clusterize(
  clicks: ClickEvent[],
  vp: { width: number; height: number },
): ClickEvent[][] {
  const list = zoomable(clicks);
  if (list.length === 0) return [];

  const diag = Math.hypot(vp.width, vp.height);
  const tooFar = (a: ClickEvent, b: ClickEvent) =>
    Math.hypot(b.x - a.x, b.y - a.y) / diag > GROUP_DIST_FRAC;

  const hasExplicit = list.some((c) => c.cluster != null && c.cluster !== "");
  if (hasExplicit) {
    const groups: ClickEvent[][] = [];
    let cur: ClickEvent[] = [];
    let curId: string | undefined;
    for (const c of list) {
      const id = c.cluster ?? `__auto_${groups.length}`;
      if (cur.length === 0) {
        cur = [c];
        curId = id;
        continue;
      }
      // A cluster id means these targets MAY share a framing, not that they
      // must. Tour clusters in particular are inferred from capture-time gaps
      // (see scripts/lib/tour.ts) with no knowledge of where things are on
      // screen, so one id can span opposite corners. Split when it does —
      // otherwise the camera sweeps the whole screen at magnification, which
      // nothing in the reference footage ever does.
      if (id === curId && !tooFar(cur[cur.length - 1], c)) {
        cur.push(c);
      } else {
        groups.push(cur);
        cur = [c];
        curId = id;
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  const groups: ClickEvent[][] = [[list[0]]];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    const dt = (cur.tMs - prev.tMs) / 1000;
    if (dt > GROUP_TIME_GAP || tooFar(prev, cur)) groups.push([cur]);
    else groups[groups.length - 1].push(cur);
  }
  return groups;
}

export function stickify(
  groups: ClickEvent[][],
  vp: { width: number; height: number },
): ClickEvent[][] {
  if (groups.length <= 1) return groups;
  const hasExplicit = groups.some((g) =>
    g.some((c) => c.cluster != null && c.cluster !== ""),
  );
  const diag = Math.hypot(vp.width, vp.height);
  const out: ClickEvent[][] = [groups[0].slice()];
  for (let i = 1; i < groups.length; i++) {
    const prev = out[out.length - 1];
    const next = groups[i];
    const last = prev[prev.length - 1];
    const first = next[0];
    const prevId = last.cluster;
    const nextId = first.cluster;
    if (hasExplicit && prevId && nextId && prevId !== nextId) {
      out.push(next.slice());
      continue;
    }
    const dt = (first.tMs - last.tMs) / 1000;
    const dist = Math.hypot(first.x - last.x, first.y - last.y) / diag;
    if (dt <= STICKY_TIME_GAP && dist <= STICKY_DIST_FRAC) {
      out[out.length - 1] = prev.concat(next);
    } else {
      out.push(next.slice());
    }
  }
  return out;
}

/**
 * The window group a track is framed for. zoomAt passes what the composition
 * draws; the defaults are the plain framed look with no chrome.
 */
export type FrameGeometry = {
  /** Base float size of the window on the backdrop. Default WINDOW_FIT. */
  fit?: number;
  /** Chrome strip on top of the group, as a fraction of it. Default 0. */
  chromeFrac?: number;
};

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Most of the frame a `content` rect may leave blank before frameFor re-aims.
 *
 * gmail-automation's zooms were 60-70% blank page: zoom-about-subject keeps a
 * small form near the top of a tall, sparse page where it sat, and the frame
 * fills with the empty page below it. Framing knew where the click was, not
 * where the product was. With the populated region logged (ClickEvent.content)
 * the frame centres on target + content and tightens until at most this much is
 * blank — or until the sharpness ceiling, whichever comes first.
 */
const BLANK_CAP = 0.4;

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

const clipTo = (r: Rect, W: number, H: number): Rect => {
  const x = clamp(r.x, 0, W);
  const y = clamp(r.y, 0, H);
  return {
    x,
    y,
    w: clamp(r.x + r.w, 0, W) - x,
    h: clamp(r.y + r.h, 0, H) - y,
  };
};

/**
 * Fit a click's control into the viewport, offset so the subject is not dead-centred.
 * Returns a content-space pose (not CSS origin).
 */
export function frameFor(
  c: ClickEvent,
  vp: { width: number; height: number },
  sMax: number,
  geom: FrameGeometry = {},
): CameraPose {
  const W = vp.width;
  const H = vp.height;
  const fit = geom.fit && geom.fit > 0 ? geom.fit : WINDOW_FIT;
  const cf = clamp(geom.chromeFrac ?? 0, 0, 0.2);
  // PAD, MENU_ROOM and the thresholds below are design px at DESIGN_WIDTH. A log
  // shot under CAPTURE_SCALE carries rects in a 2560- or 3840-wide viewport, so
  // they have to be scaled or the padding silently shrinks by that factor. k = 1
  // for every 1x log, which keeps those byte-identical.
  const k = W > 0 ? W / DESIGN_WIDTH : 1;
  const rect = c.rect ?? {
    x: c.x - 60 * k,
    y: c.y - 24 * k,
    w: 120 * k,
    h: 48 * k,
  };

  const menuRoom = (rect.h >= 90 * k ? 24 : MENU_ROOM) * k;
  const extW = rect.w;
  const extH = rect.h + menuRoom;
  const rectCx = rect.x + rect.w / 2;
  const rectCy = rect.y + rect.h / 2 + menuRoom / 2;
  const focusX = mix(rectCx, c.x, CLICK_WEIGHT);
  const focusY = mix(rectCy, c.y, CLICK_WEIGHT);

  const sByW = (FRAME_FRAC * W) / (extW + 2 * PAD * k);
  const sByH = (FRAME_FRAC * H) / (extH + 2 * PAD * k);
  // An explicit zoomScale overrides the fit: a wide target (a menu across most
  // of the frame) fits at S_MIN, but the author may want to crop TIGHT on it.
  // Still clamped to sMax, so "tight" never upscales past the sharpness ceiling.
  const sFit = clamp(Math.min(sByW, sByH), S_MIN, sMax);
  // Lift a soft fit to a real punch when the control still fits at that scale.
  // Sized against the float size because that is what the viewer sees.
  const punchMin = Math.min(S_PUNCH_MIN, sMax);
  const fitsAtPunch =
    extW * fit * punchMin <= WIDE_FIT * W &&
    extH * fit * punchMin <= WIDE_FIT * H;
  let S =
    c.zoomScale != null
      ? clamp(c.zoomScale, S_MIN, sMax)
      : fitsAtPunch
        ? Math.max(sFit, punchMin)
        : sFit;

  // Work in WINDOW-GROUP space (x as-is, y shifted under the chrome strip):
  // that is the space poseToCss centres and clamps in, so a clamp applied here
  // is exactly the one the render sees.
  const toG = (yPx: number) => cf + (clamp(yPx / H, 0, 1) * (1 - cf));
  const px = clamp(focusX / W, 0, 1);
  const py = toG(focusY);

  // Framing is held to panLimit on the EFFECTIVE scale (fit * S): once the
  // window is bigger than the frame its edges stay out of shot. Clamping on the
  // pose scale instead let a soft punch (effective 1.02-1.09) slide the window
  // until its edge sat at the base margin — a window inflating from its corner.
  // poseToCss used to fix that at render; here it is fixed in the keyframe, so
  // the render clamp never has to act (see poseToCss).
  const halfFor = (s: number) => 1 / (2 * fit * s);
  const limFor = (s: number) => panLimit(fit * s);

  // Zoom ABOUT the subject: it keeps the screen position it had at base and
  // the picture grows around it, so the move points at the thing being clicked
  // by construction. A subject that lives off-centre stays off-centre; one near
  // the middle stays near the middle.
  //
  // This replaced a fixed FRAME_OFFSET of 0.26 that parked every subject at
  // 0.76 (or 0.24) of the frame, toward whichever half it sat in. For a field
  // centred at 0.55 that shoved the camera 0.18 LEFT onto the edge clamp, and
  // with the same push on Y the punch travelled diagonally to the window's
  // top-left corner while the field sat at its top-right — the zoom visibly
  // aimed away from the click.
  //
  // WINDOW_FIT cancels out here: a base point sits at 0.5 + (p - 0.5) * fit on
  // screen and at 0.5 + (p - cx) * fit * S after the punch, so holding it still
  // needs cx = p - (p - 0.5) / S whatever fit is.
  let gx = px - (px - 0.5) / S;
  let gy = py - (py - 0.5) / S;

  // Content-aware framing (D9). Only when the recorder logged the populated
  // region; without it every line below is skipped and framing is as before.
  if (c.content) {
    const ext = { x: rect.x, y: rect.y, w: rect.w, h: rect.h + menuRoom };
    const u = clipTo(union(ext, c.content), W, H);
    if (u.w > 0 && u.h > 0) {
      // Visible content px at S: W / (fit S) wide, H / ((1 - cf) fit S) tall.
      const sFill = Math.min(
        W / (fit * (u.w + 2 * PAD * k)),
        (H / (1 - cf)) / (fit * (u.h + 2 * PAD * k)),
      );
      // Blank share if the union were wholly in shot: 1 - area(u) / area(view).
      const sCap =
        Math.sqrt(((1 - BLANK_CAP) * W * H) / (u.w * u.h * (1 - cf))) / fit;
      // Tighten, never loosen: the target's own fit already chose S.
      S = Math.max(S, Math.min(sCap, sFill, sMax));
      // Aim at the union instead of the subject's base position.
      gx = (u.x + u.w / 2) / W;
      gy = toG(u.y + u.h / 2);
      // …but the framed control itself stays in shot when it can.
      const h = halfFor(S);
      const tx0 = rect.x / W;
      const tx1 = (rect.x + rect.w) / W;
      const ty0 = toG(ext.y);
      const ty1 = toG(ext.y + ext.h);
      if (tx1 - tx0 <= 2 * h) gx = clamp(gx, tx1 - h, tx0 + h);
      if (ty1 - ty0 <= 2 * h) gy = clamp(gy, ty1 - h, ty0 + h);
    }
  }

  const half = halfFor(S);
  const lim = limFor(S);
  gx = clamp(gx, 0.5 - lim, 0.5 + lim);
  gy = clamp(gy, 0.5 - lim, 0.5 + lim);

  // Whatever the offset wanted, the thing being clicked has to be on screen.
  //
  // This is the ONLY guard a too-large framed region needs. When `rect` is
  // bigger than the frame — a full-height drawer passed as `frame:` — the fit
  // maths clamps to S_MIN and the old fixed offset then cropped from whichever
  // side the subject leaned toward, which is how a Create button at the bottom
  // of a drawer ended up 102px BELOW the frame edge. Pulling the framing back so the
  // click stays visible fixes that while keeping the zoom.
  //
  // An earlier version bailed to BASE_POSE whenever the region did not fit.
  // Measured, that was strictly worse: it fixed nothing this clamp does not
  // already fix, and it threw away the zoom on beats that were framing fine at
  // S_MIN — a subscription demo visibly pulled back to the whole app mid-flow.
  // Do not reintroduce it.
  //
  // Margin is capped against `half` so this can never invert at high zoom.
  const clickX = clamp(c.x / W, 0, 1);
  const clickY = toG(c.y);
  const margin = Math.min(CLICK_MARGIN, half * 0.4);
  gx = clamp(gx, clickX - half + margin, clickX + half - margin);
  gy = clamp(gy, clickY - half + margin, clickY + half - margin);
  // Content bounds win: panning past the edge would show stretched footage.
  // The fit guard above is what keeps these two from actually conflicting.
  gx = clamp(gx, 0.5 - lim, 0.5 + lim);
  gy = clamp(gy, 0.5 - lim, 0.5 + lim);
  return { scale: S, cx: gx, cy: groupToContentY(gy, cf) };
}

/**
 * Is the click on screen at `pose`, inside the same margin frameFor keeps?
 * Bounds use the EFFECTIVE scale, matching poseToCss's clamp.
 */
function clickInShot(
  c: ClickEvent,
  pose: CameraPose,
  vp: { width: number; height: number },
  fit: number,
): boolean {
  const eff = pose.scale * fit;
  if (eff <= 1) return true;
  const half = 1 / (2 * eff);
  const margin = Math.min(CLICK_MARGIN, half * 0.4);
  const x = clamp(c.x / vp.width, 0, 1);
  const y = clamp(c.y / vp.height, 0, 1);
  return (
    Math.abs(x - pose.cx) <= half - margin &&
    Math.abs(y - pose.cy) <= half - margin
  );
}

/**
 * How much more of the frame the product must fill at `next` than at `cur` for
 * a click that is already in shot to re-aim anyway (see settle).
 *
 * The click being in shot is not enough when the page has changed under the
 * camera. gmail-automation held the trigger popover's framing (page y 283-1006)
 * through the instruction beat and Create, after Done had closed the popover:
 * the click was still in shot, the next pose was no tighter, so the camera
 * stayed — on the bottom half of the form's frame and the empty page below it.
 * 86% of that hold was blank (analyze), the worst hold in the five demos.
 * Measured by `contentShare` on the logs in public/: that carry-over filled
 * 0.20 of the frame with the form where the form's own pose fills 0.39 (0.30
 * vs 0.49 at Create). Every other pose carried over a click in public/ is
 * within 0.05 of that click's own, so 0.15 re-aims only where the page moved.
 * After: gmail's instruction and Create hold 75% blank (max 76%), was 86-87%
 * — measured on the footage at the track's poses. The form is itself mostly
 * white; no pose that keeps it the subject reads under ~73% (a pose scan at
 * S 1.2-1.74), so the rest of that number is the page, not the framing.
 */
export const REFRAME_GAIN = 0.15;

/**
 * Share of the frame at `pose` that the click's product fills: its control
 * (with the menu room frameFor gives it) and logged content, in shot. 0 when
 * no content was logged — there is nothing to measure against.
 */
export function contentShare(
  c: ClickEvent,
  pose: CameraPose,
  vp: { width: number; height: number },
  geom: FrameGeometry = {},
): number {
  if (!c.content) return 0;
  const W = vp.width;
  const H = vp.height;
  const fit = geom.fit && geom.fit > 0 ? geom.fit : WINDOW_FIT;
  const cf = clamp(geom.chromeFrac ?? 0, 0, 0.2);
  const eff = Math.max(1, fit * pose.scale);
  const k = W > 0 ? W / DESIGN_WIDTH : 1;
  const rect = c.rect ?? { x: c.x - 60 * k, y: c.y - 24 * k, w: 120 * k, h: 48 * k };
  const menuRoom = (rect.h >= 90 * k ? 24 : MENU_ROOM) * k;
  const u = clipTo(
    union({ x: rect.x, y: rect.y, w: rect.w, h: rect.h + menuRoom }, c.content),
    W,
    H,
  );
  // The visible window-group span, in content px: the group is H / (1 - cf)
  // tall with the chrome on top, as frameFor works in.
  const vw = W / eff;
  const vh = H / (1 - cf) / eff;
  const x0 = pose.cx * W - vw / 2;
  const y0 = pose.cy * H - vh / 2;
  const ix = Math.max(0, Math.min(x0 + vw, u.x + u.w) - Math.max(x0, u.x));
  const iy = Math.max(0, Math.min(y0 + vh, u.y + u.h) - Math.max(y0, u.y));
  return (ix * iy) / (vw * vh);
}

/**
 * The pose to use for click `c` when the camera is already at `cur`: `next`
 * if the move earns itself, otherwise `cur`. See REPOSE_MIN_DS and
 * REFRAME_GAIN.
 */
function settle(
  cur: CameraPose,
  next: CameraPose,
  c: ClickEvent,
  vp: { width: number; height: number },
  geom: FrameGeometry,
): CameraPose {
  const fit = geom.fit && geom.fit > 0 ? geom.fit : WINDOW_FIT;
  if (cur.scale <= BASE_POSE.scale) return next;
  if (next.scale - cur.scale >= REPOSE_MIN_DS) return next;
  if (!clickInShot(c, cur, vp, fit)) return next;
  return contentShare(c, next, vp, geom) - contentShare(c, cur, vp, geom) >=
    REFRAME_GAIN
    ? next
    : cur;
}

/**
 * The pose that keeps a caret sample in shot: `pose` when it already is, else
 * `pose` panned (never zoomed) so the caret sits mid-frame on each axis it had
 * left — half a frame of room for the lines still to come, so the camera steps
 * once per screenful of text rather than once per line. A rect too big for the
 * frame (a textarea logged whole) keeps its end in shot: the bottom, where the
 * text is growing, and the left, where each line starts. Held to the same
 * effective-scale pan limit frameFor uses, so the render clamp never acts.
 */
export function caretInShot(
  pose: CameraPose,
  r: { x: number; y: number; w: number; h: number },
  vp: { width: number; height: number },
  geom: FrameGeometry = {},
): CameraPose {
  const fit = geom.fit && geom.fit > 0 ? geom.fit : WINDOW_FIT;
  const cf = clamp(geom.chromeFrac ?? 0, 0, 0.2);
  const eff = pose.scale * fit;
  if (eff <= 1) return pose;
  const half = 1 / (2 * eff);
  const margin = Math.min(CLICK_MARGIN, half * 0.4);
  const reach = half - margin;
  const lim = panLimit(eff);
  const toG = (yPx: number) => cf + clamp(yPx / vp.height, 0, 1) * (1 - cf);
  // Window-group space, as frameFor works in (x as-is, y under the chrome).
  const axis = (g: number, a: number, b: number, keepEnd: boolean) => {
    if (a >= g - reach && b <= g + reach) return g;
    const want =
      b - a <= 2 * reach ? (a + b) / 2 : keepEnd ? b - reach : a + reach;
    return clamp(want, 0.5 - lim, 0.5 + lim);
  };
  const gx = axis(
    pose.cx,
    clamp(r.x / vp.width, 0, 1),
    clamp((r.x + r.w) / vp.width, 0, 1),
    false,
  );
  const gy = axis(cf + pose.cy * (1 - cf), toG(r.y), toG(r.y + r.h), true);
  return { scale: pose.scale, cx: gx, cy: groupToContentY(gy, cf) };
}

function departS(c: ClickEvent): number {
  return (c.tDepartMs ?? c.tMs - LEAD_FALLBACK_S * 1000) / 1000;
}

function normalizeKeys(keys: CameraKey[]): CameraKey[] {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const out: CameraKey[] = [];
  for (const k of sorted) {
    if (out.length === 0) {
      out.push(k);
      continue;
    }
    const prev = out[out.length - 1];
    if (k.t + 1e-4 < prev.t) continue;
    if (k.t - prev.t < 1e-4) {
      // Same instant: the segment that ENDS here is prev's, so keep its bend.
      out[out.length - 1] = { ...k, via: k.via ?? prev.via };
      continue;
    }
    if (k.t - prev.t < 0.2 && posesNearlyEqual(prev.pose, k.pose)) {
      // A micro-move: snap it to a hold rather than stretching the previous
      // move over it. Stretching (the old behaviour) slid a move's landing up
      // to 0.2s later — past the press it had been timed to settle before.
      out.push({ t: k.t, pose: prev.pose });
      continue;
    }
    out.push(k);
  }
  return out;
}

/**
 * Carry speed through every key where one straight move ends exactly as the
 * next begins (D1).
 *
 * Every move eases in from rest and lands at rest, which is right wherever a
 * move meets a hold. Where two moves meet with no hold between them — a caret
 * follow running straight into the next beat's pan, a pan fitMove could only
 * start the instant the last one landed — it was a dead stop and a re-launch in
 * the middle of what reads as one glide, the same fault interpolateVia fixed
 * for an out-and-in through base.
 *
 * This keeps both keys (the junction pose is still reached at its time — it is
 * the framing a press was timed against) and gives the two moves matching
 * on-screen speed there: the harmonic mean of their average speeds (the
 * Fritsch-Butland tangent, which keeps each slope under 2 and the progress
 * monotone), scaled by the cosine of the turn. A reversal (turn >= 90 degrees)
 * carries nothing: stopping is what a camera does when it changes its mind.
 * Speed is matched in screen space (poseToCss at this fit and chrome) so the
 * frame edge, not the pose maths, is what runs continuously.
 *
 * Via moves keep their rest-to-rest ease: their ends are already the far ends
 * of a trail, and bending one AND carrying through it is not worth the curve.
 * On the 21 logs in public/ there are no junctions today (measured), so every
 * shipped track is unchanged; the follow pans (followCaret) are what create them.
 */
export function carryThrough(
  keys: CameraKey[],
  vp: { width: number; height: number },
  geom: FrameGeometry,
): CameraKey[] {
  const fit = geom.fit && geom.fit > 0 ? geom.fit : WINDOW_FIT;
  const cf = clamp(geom.chromeFrac ?? 0, 0, 0.2);
  const aspect = vp.width > 0 ? vp.height / vp.width : 1;
  // Frame-edge position in output widths: translate x, translate y, and the
  // edge's growth (half the scale), the three things the viewer sees move.
  const screen = (p: CameraPose) => {
    const z = poseToCss(p, cf, fit);
    return [z.translateX, z.translateY * aspect, z.scale / 2];
  };
  const straight = (a: CameraKey, b: CameraKey) =>
    b.via == null && b.t - a.t > 1e-6 && !posesSame(a.pose, b.pose);
  const D = 1e-4;
  const diff = (p: number[], q: number[]) => p.map((v, i) => (v - q[i]) / D);
  const norm = (v: number[]) => Math.hypot(...v);
  const out = keys.map((k) => ({ ...k }));
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1];
    const j = out[i];
    const c = out[i + 1];
    if (!straight(a, j) || !straight(j, c)) continue;
    // Screen velocity per unit of progress at the junction end of each move.
    const dL = diff(screen(j.pose), screen(poseAlong(a.pose, j.pose, 1 - D)));
    const dR = diff(screen(poseAlong(j.pose, c.pose, D)), screen(j.pose));
    const nL = norm(dL);
    const nR = norm(dR);
    if (nL < 1e-9 || nR < 1e-9) continue;
    const cos = dL.reduce((s, v, k) => s + v * dR[k], 0) / (nL * nR);
    if (cos <= 0) continue;
    const vL = nL / (j.t - a.t);
    const vR = nR / (c.t - j.t);
    const v = (cos * 2 * vL * vR) / (vL + vR);
    j.slopes = { from: j.slopes?.from ?? 0, to: v / vL };
    c.slopes = { from: v / vR, to: 0 };
  }
  return out;
}

const posesSame = (a: CameraPose, b: CameraPose): boolean =>
  Math.abs(a.scale - b.scale) < 1e-6 &&
  Math.abs(a.cx - b.cx) < 1e-6 &&
  Math.abs(a.cy - b.cy) < 1e-6;

/** Mousedown of a click, on the log clock (focus beats have none: use tMs). */
const pressS = (c: ClickEvent): number => (c.tDownMs ?? c.tMs) / 1000;

/** When the action itself is over: the click, or the last keystroke. */
const actionEndS = (c: ClickEvent): number =>
  Math.max(c.tMs, c.typeEndMs ?? c.tMs) / 1000;

export function buildCameraTrack(
  log: ClickLog,
  speed = 1,
  geom: FrameGeometry = {},
): CameraKey[] {
  const vp = log.viewport;
  const base = basePose(geom.chromeFrac ?? 0);
  const groups = stickify(clusterize(log.clicks, vp), vp);
  const keys: CameraKey[] = [{ t: 0, pose: base }];
  if (groups.length === 0) {
    keys.push({
      t: Math.max((log.durationMs || 8000) / 1000, 0.5),
      pose: base,
    });
    return keys;
  }

  // Everything below is authored in SCREEN seconds and runs on the click-log
  // clock, which the composition replays at `speed` — so each one is scaled up
  // by it, or it lands ~20% short on screen at the default 1.25x.
  const holdMin = HOLD_MIN_S * speed;
  const typeTail = TYPE_TAIL_S * speed;
  const baseBeat = BASE_BEAT_S * speed;
  const settleGap = SETTLE_BEFORE_PRESS_S * speed;
  const moveFloor = MOVE_FLOOR_S * speed;
  const watch = ACTION_WATCH_S * speed;
  const baseRest = BASE_REST_S * speed;

  /** The camera must not leave an action before this (see ACTION_WATCH_S). */
  const watchUntil = (c: ClickEvent): number => actionEndS(c) + watch;
  /**
   * When the camera would LIKE to leave: the full hold. For a typing beat that
   * is the last keystroke plus a tail — the camera must not trail away from
   * text still being typed.
   */
  const holdUntil = (c: ClickEvent): number =>
    Math.max(
      watchUntil(c),
      c.tMs / 1000 + holdMin,
      c.typeEndMs != null ? c.typeEndMs / 1000 + typeTail : 0,
    );

  const meta = groups.map((group, i) => ({
    group,
    poses: group.map((c) =>
      // The first cluster is softened (S_MAX_SOFT) so a film does not open on
      // its most aggressive push — but an explicit zoomScale is a deliberate
      // request, so it gets the full sharp ceiling even in first position.
      frameFor(
        c,
        vp,
        i === 0 && c.zoomScale == null ? S_MAX_SOFT : S_MAX,
        geom,
      ),
    ),
    tIn: Math.max(0, departS(group[0]) - CAMERA_LEAD_S),
  }));

  // The camera is at `pose`, and still from `free` on.
  let pose = base;
  let free = 0;
  const move = (to: CameraPose, start: number, dur: number, via?: CameraPose) => {
    keys.push({ t: start, pose });
    keys.push(via ? { t: start + dur, pose: to, via } : { t: start + dur, pose: to });
    pose = to;
    free = start + dur;
  };

  /**
   * Place a move that would like to start at `want` so it LANDS by `deadline`.
   *
   * The cursor glide is not scaled by speed and the camera's durations are, so
   * nothing used to line the two up: 12 of 118 presses landed while the camera
   * was still moving (skillsmp-search settled 482ms after its press, blurring
   * the ripple). A move that would land late is shortened, down to MOVE_FLOOR_S
   * on screen; if even that does not fit it starts earlier, borrowing from the
   * hold before it — never before `earliest`.
   */
  const fitMove = (earliest: number, want: number, deadline: number, dur: number) => {
    let start = Math.max(earliest, want);
    if (start + dur <= deadline) return { start, dur };
    const d = Math.min(dur, Math.max(moveFloor, deadline - start));
    start = Math.max(earliest, Math.min(start, deadline - d));
    return { start, dur: d };
  };

  /**
   * Take the camera from where it is to `to`, landing SETTLE_BEFORE_PRESS_S
   * before `press` — or, when that and the watch floor collide, by the press
   * itself: the settle gap is the first thing given up.
   *
   * `leave` bounds when it may pull away from the previous action: `hard` is
   * the floor (the action has finished and been watched), `soft` the full hold.
   * `trail` asks for a return to base when there is room for one.
   */
  const reach = (
    to: CameraPose,
    want: number,
    press: number,
    leave: { hard: number; soft: number },
    trail: boolean,
  ) => {
    const deadline = press - settleGap;
    if (posesNearlyEqual(pose, to)) return;
    if (pose.scale <= base.scale + 1e-3) {
      const dur = moveDuration(pose, to, "in", vp, speed);
      const m = fitMove(free, want, deadline, dur);
      move(to, m.start, m.dur);
      return;
    }
    const hard = Math.max(free, leave.hard);
    const soft = Math.max(hard, leave.soft);
    const far = poseTravelPx(pose, to, vp) > MAX_PAN_PX;
    const outDur = moveDuration(pose, base, "out", vp, speed);
    const inDur = moveDuration(base, to, "in", vp, speed);

    if (far || (trail && want >= soft + outDur)) {
      // Trail to base and punch back in — the reference clips never sweep the
      // camera across the whole screen at magnification. Leave as late as the
      // hold allows but in time to reach base as the cursor departs; never
      // before the action has been watched. The in-move may then start after
      // the cursor has gone (it is delayed rather than the hold cut).
      const outStart = Math.max(hard, Math.min(soft, want - outDur));
      const landed = outStart + outDur;
      const m = fitMove(landed, want, deadline, inDur);
      if (m.start + m.dur <= deadline + 1e-6) {
        if (m.start - landed < baseRest) {
          // No real rest at base: one move that carries its speed through a
          // middle scale, instead of stopping dead at base and re-launching.
          move(to, outStart, m.start + m.dur - outStart, base);
        } else {
          move(base, outStart, outDur);
          move(to, m.start, m.dur);
        }
        return;
      }
      if (far) {
        // No time for a trail and a punch: one combined out-and-in through a
        // middle scale. It never reaches base, so it is a pan at magnification
        // that eases the zoom off while it crosses — kinder than a straight
        // screen-wide pan at full zoom. It takes whatever time there is
        // between the watch and the press, within a pan's and a full trail's
        // length.
        const earliest = hard;
        const dur = clamp(
          deadline - earliest,
          moveDuration(pose, to, "pan", vp, speed),
          outDur + inDur,
        );
        const m2 = fitMove(earliest, Math.min(want, deadline - dur), deadline, dur);
        move(to, m2.start, m2.dur, base);
        return;
      }
    }
    // Pan at magnification. A pan is not a zoom-out, so when the watch and the
    // next press collide the watch gives way — but only as far as it takes to
    // land by the press itself; the settle gap goes first.
    const dur = moveDuration(pose, to, "pan", vp, speed);
    const m = fitMove(
      Math.max(free, Math.min(hard, press - moveFloor)),
      want,
      deadline,
      dur,
    );
    move(to, m.start, m.dur);
  };

  /**
   * Keep the text in shot while `c` types (D15). The recorder logs where the
   * text is going (ClickEvent.caret) every ~250 ms; a field that grows or a
   * caret that runs down the page past the zoomed frame used to type out of
   * shot, because the pose was fixed at the press. Each sample the camera is
   * free for is checked — the latest one a pan's length ahead (the log is
   * offline, so the camera can leave as the text is about to go out of shot
   * rather than after it has) — and when that caret is out of frame the camera
   * pans (caretInShot: same scale, pan-clamped) to bring it back mid-frame.
   * Samples a pan in progress has already covered are skipped, not chased.
   *
   * It lives inside the hold and never stretches it: a pan that cannot land by
   * `until` (the full hold, or the next beat's own move if that is sooner) is
   * not started. No caret samples, or none that leave the frame, adds no key.
   */
  // A pan is never shorter than 700ms on screen (moveDuration), so that is how
  // far ahead the camera looks.
  const caretLead = 0.7 * speed;
  const followCaret = (c: ClickEvent, until: number) => {
    const samples = c.caret;
    if (!samples?.length || pose.scale <= base.scale + 1e-3) return;
    const from = pressS(c);
    for (let i = 0; i < samples.length; i++) {
      // Superseded while the camera was still busy: a later sample says more.
      if (i + 1 < samples.length && samples[i + 1].tMs / 1000 <= free) continue;
      const now = Math.max(free, from, samples[i].tMs / 1000);
      let j = i;
      while (j + 1 < samples.length && samples[j + 1].tMs / 1000 <= now + caretLead) j++;
      const to = caretInShot(pose, samples[j], vp, geom);
      if (posesNearlyEqual(pose, to)) continue;
      const m = fitMove(now, now, until, moveDuration(pose, to, "pan", vp, speed));
      if (m.start + m.dur > until + 1e-6) return;
      move(to, m.start, m.dur);
    }
  };
  /** When the beat after `c` wants the camera: its own lead, or its group's. */
  const nextWant = (i: number, j: number): number => {
    const group = meta[i].group;
    if (j + 1 < group.length) return departS(group[j + 1]) - CAMERA_LEAD_S;
    return i + 1 < meta.length ? meta[i + 1].tIn : Infinity;
  };

  for (let i = 0; i < meta.length; i++) {
    const { group, poses, tIn } = meta[i];
    const prev = i > 0 ? meta[i - 1].group : null;
    const prevLast = prev ? prev[prev.length - 1] : null;
    reach(
      settle(pose, poses[0], group[0], vp, geom),
      tIn,
      pressS(group[0]),
      prevLast
        ? { hard: watchUntil(prevLast), soft: holdUntil(prevLast) }
        : { hard: 0, soft: 0 },
      true,
    );
    followCaret(group[0], Math.min(holdUntil(group[0]), nextWant(i, 0)));
    for (let j = 1; j < group.length; j++) {
      reach(
        settle(pose, poses[j], group[j], vp, geom),
        departS(group[j]) - CAMERA_LEAD_S,
        pressS(group[j]),
        { hard: watchUntil(group[j - 1]), soft: holdUntil(group[j - 1]) },
        false,
      );
      followCaret(group[j], Math.min(holdUntil(group[j]), nextWant(i, j)));
    }
  }

  // Always land back at base: it is the one rule all four reference clips
  // keep. The last beat gets its full hold — it is never cut to make the trail
  // fit. When the recording is too short for hold + trail + a beat at base, the
  // track runs past durationMs and the composition holds the last frame of the
  // footage (see trackDurationMs) rather than ending zoomed in or clipping the
  // payoff.
  //
  // For the closing CLICK that full hold is HOLD_MIN_S of stillness counted
  // from when the camera came to rest on it, not from the click: the camera
  // has usually been still on the button for 0.3-1 s before the press, and
  // what follows the press is the payoff, which reads at base. Counted from the
  // click, the hold sat zoomed on where the button had been — agent-skill's
  // Create drawer closes under it (78% blank page, analyze) — and ran
  // agent-tool 1.05 s past its footage. The watch floor still applies, and a
  // typing beat keeps its tail.
  const lastGroup = meta[meta.length - 1].group;
  const last = lastGroup[lastGroup.length - 1];
  if (pose.scale > base.scale + 1e-3 || !posesNearlyEqual(pose, base)) {
    const leave =
      last.typeEndMs != null
        ? holdUntil(last)
        : Math.max(watchUntil(last), Math.min(holdUntil(last), free + holdMin));
    const outStart = Math.max(free, leave);
    move(base, outStart, moveDuration(pose, base, "out", vp, speed));
  }
  const clipEnd = (log.durationMs || last.tMs + END_TAIL_S * 1000) / 1000;
  keys.push({ t: Math.max(clipEnd, free + baseBeat), pose: base });

  return carryThrough(normalizeKeys(keys), vp, geom);
}

/**
 * How long, on the click-log clock, the composition must run for the camera to
 * finish: the recording, or longer when the last beat's hold + trail + base
 * beat does not fit inside it. Past durationMs the footage should hold its last
 * frame. The composition sizes itself from durationMs today; switch it to this
 * (plus offsetMs, which zoomAt subtracts) to stop a short tail from ever
 * cutting the closing trail.
 */
export function trackDurationMs(
  log: ClickLog,
  speed = 1,
  geom: FrameGeometry = {},
): number {
  const keys = buildCameraTrack(log, speed, geom);
  const end = keys[keys.length - 1].t * 1000;
  return Math.max(log.durationMs || 0, Math.ceil(end));
}

export function sampleTrack(keys: CameraKey[], t: number): CameraPose {
  if (keys.length === 0) return BASE_POSE;
  if (t <= keys[0].t) return keys[0].pose;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.pose;
  let i = 0;
  while (i < keys.length - 1 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const dur = b.t - a.t;
  if (dur < 1e-6) return b.pose;
  const u = (t - a.t) / dur;
  return b.via
    ? interpolateVia(a.pose, b.via, b.pose, u)
    : interpolatePose(a.pose, b.pose, u, b.slopes);
}

/**
 * Slow push inside a long hold.
 *
 * This is a LOOK choice, and deliberately not the thing that was tried and
 * reverted before: src/lib/cursor.ts:76-84 and scripts/analyze.ts:70-79 record
 * an idle-tremor experiment that was reverted, with the right conclusion that
 * long frozen stretches are a script problem. That conclusion is accepted here
 * — the script fix is to cut the beat shorter — and this only handles what is
 * left. It is authored, deterministic, monotone into the middle of the shot,
 * and off unless a storyboard asks for it.
 *
 * Peak velocity in scale units per SCREEN second. The budget is 0.029: a hold
 * has to stay under |dscale| 0.01 across any 0.35s window to still read as
 * still, which is the window src/lib/zoom.test.ts pins on the track itself.
 */
export const DRIFT_RATE = 0.02;
/** Never more than this fraction of the authored scale. */
export const DRIFT_PEAK_FRAC = 0.03;
/** Shorter holds are intentional stillness — leave them alone. */
export const DRIFT_MIN_HOLD_S = 2.0;
/** Never drift at base pose, so a clip still starts and ends where it did. */
export const DRIFT_MIN_SCALE = 0.02;

/**
 * The hold bracketing `t`, or null when the camera is moving.
 *
 * A hold is not a tagged state — buildCameraTrack encodes one as two keys
 * carrying the SAME pose, so any interval whose endpoints match is a hold. This
 * scans for that rather than refactoring sampleTrack, whose output is pinned by
 * exact-equality assertions and must not grow a branch.
 */
export function holdSpanAt(
  keys: CameraKey[],
  t: number,
): { startT: number; endT: number } | null {
  if (keys.length < 2 || t <= keys[0].t) return null;
  const last = keys[keys.length - 1];
  if (t >= last.t) return null;
  let i = 0;
  while (i < keys.length - 1 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  return posesNearlyEqual(a.pose, b.pose) && !b.via
    ? { startT: a.t, endT: b.t }
    : null;
}

/**
 * Raised cosine: zero AND flat at both ends.
 *
 * The flatness is the point. Drift has to join and leave a hold with matched
 * value and matched VELOCITY, or there is a visible kick where the glide hands
 * over. A sine half-wave would match the value and step the velocity.
 *
 * The DRIFT_RATE * T / PI term is not a fudge factor: the peak derivative of
 * this curve is peak*PI/T, so dividing by it makes the realised rate exactly
 * DRIFT_RATE whatever the hold length. Without it a flat 3% peak over a 2.1s
 * hold runs at 0.05 scale/s — nearly double the budget.
 */
export function driftScale(
  scale: number,
  u: number,
  holdScreenS: number,
  amount: number,
): number {
  const peak = Math.min(
    DRIFT_PEAK_FRAC * scale,
    (DRIFT_RATE * holdScreenS) / Math.PI,
    Math.max(0, S_MAX - scale),
  );
  return scale + (amount * peak * (1 - Math.cos(2 * Math.PI * u))) / 2;
}

/**
 * The drifted pose, or the SAME OBJECT when drift is off.
 *
 * Returning by reference matters: with drift unset, poseToCss receives the
 * identical object today's code hands it, so a demo render is bit-identical
 * rather than merely equal to within floating point.
 *
 * Scale-UP only, and that is load-bearing rather than a preference. poseToCss
 * re-clamps cx to [half, 1-half] with half = 1/(2S), and frameFor drives edge
 * targets onto that clamp — agent-skill's long typing hold sits at cx 0.66620
 * with 1-half = 0.66620 exactly. Scaling up loosens the clamp and moves the
 * framed point by nothing; scaling down tightens it and produces a pan of
 * roughly 24 screen px that nobody authored.
 */
export function driftPose(
  pose: CameraPose,
  keys: CameraKey[],
  t: number,
  speed: number,
  amount: number,
): CameraPose {
  if (!(amount > 0)) return pose;
  if (pose.scale - BASE_POSE.scale < DRIFT_MIN_SCALE) return pose;
  const span = holdSpanAt(keys, t);
  if (!span) return pose;
  const holdScreenS = (span.endT - span.startT) / (speed || 1);
  if (holdScreenS < DRIFT_MIN_HOLD_S) return pose;
  const u = (t - span.startT) / (span.endT - span.startT);
  return { ...pose, scale: driftScale(pose.scale, u, holdScreenS, amount) };
}

/**
 * The track is a pure function of (log, speed) but zoomAt runs per frame — and
 * once per shutter sample under ShutterBlur (8 or 16 per frame, see
 * src/lib/shutter.ts groupsFor). Cache it per log.
 */
const trackCache = new WeakMap<ClickLog, Map<string, CameraKey[]>>();

function cachedTrack(
  log: ClickLog,
  speed: number,
  geom: Required<FrameGeometry>,
): CameraKey[] {
  let byKey = trackCache.get(log);
  if (!byKey) {
    byKey = new Map();
    trackCache.set(log, byKey);
  }
  const key = `${speed}|${geom.fit}|${geom.chromeFrac}`;
  let track = byKey.get(key);
  if (!track) {
    track = buildCameraTrack(log, speed, geom);
    byKey.set(key, track);
  }
  return track;
}

/**
 * Scale + origin for the camera at `frame`.
 * Applied to the *whole window group* (chrome + footage + shadow), not just the page.
 */
export function zoomAt(
  frame: number,
  fps: number,
  log: ClickLog,
  opts: ZoomOptions = {},
): ZoomState {
  const chromeFrac = clamp(opts.chromeFrac ?? 0, 0, 0.2);
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const fit = opts.fit && opts.fit > 0 ? opts.fit : 1;
  const offset = (log.offsetMs ?? 0) / 1000;
  const t = (frame / fps) * speed - offset;
  // The track is framed for the window it will be drawn in: frameFor holds
  // keyframes to the pan clamp at this fit and chrome, so poseToCss's clamp
  // below never has to act. (No fit given: framed for WINDOW_FIT, as always.)
  const track = cachedTrack(log, speed, {
    fit: opts.fit && opts.fit > 0 ? opts.fit : WINDOW_FIT,
    chromeFrac,
  });
  const pose = driftPose(
    sampleTrack(track, t),
    track,
    t,
    speed,
    opts.drift ?? 0,
  );
  return poseToCss(pose, chromeFrac, fit);
}
