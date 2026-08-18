import {
  BASE_BEAT_S,
  CAMERA_LEAD_S,
  END_TAIL_S,
  HOLD_MIN_S,
  TYPE_TAIL_S,
  LEAD_FALLBACK_S,
  type ClickEvent,
  type ClickLog,
} from "./click-log";
import {
  BASE_POSE,
  clamp,
  interpolatePose,
  MAX_PAN_PX,
  mix,
  moveDuration,
  poseToCss,
  posesNearlyEqual,
  poseTravelPx,
  type CameraPose,
} from "./camera";

export type { ClickEvent, ClickLog } from "./click-log";
export { EMPTY_LOG } from "./click-log";

export type ZoomState = {
  /** Effective on-screen magnification, WINDOW_FIT included. */
  scale: number;
  /** Pan, as fractions of the window group's own size (for CSS `translate(%)`). */
  translateX: number;
  translateY: number;
};

export type CameraKey = { t: number; pose: CameraPose };

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
};

// Region-framing knobs.
//
// These are CAMERA scale. What the viewer sees is WINDOW_FIT * scale, so these
// are budgeted against that: at WINDOW_FIT 0.86, S_MAX 1.74 shows the app at
// 1.50x native, which is where 1080p source stops holding up. If you change
// WINDOW_FIT in DemoClip.tsx, rescale these to keep the product near 1.5.
const S_MIN = 1.18;
const S_MAX = 1.74;
const S_MAX_SOFT = 1.54;
const PAD = 80;
const MENU_ROOM = 110;
const FRAME_FRAC = 0.55;
/** Subject sits this fraction of viewport width off centre, toward its native side. */
const FRAME_OFFSET = 0.26;
/**
 * How far inside the frame edge a click is kept, as a fraction of the frame.
 *
 * FRAME_OFFSET deliberately pushes the subject off-centre, which is fine when
 * the framed region is small but can shove the CLICK ITSELF out of shot when the
 * region is large and the click sits near its edge.
 */
const CLICK_MARGIN = 0.04;
/**
 * Cursor weight: a hint toward the click, not the aim point.
 * The camera frames the region, not the pointer.
 */
const CLICK_WEIGHT = 0.2;

// Auto-clustering fallback when clicks omit `cluster`.
const GROUP_TIME_GAP = 2.2;
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
 * Fit a click's control into the viewport, offset so the subject is not dead-centred.
 * Returns a content-space pose (not CSS origin).
 */
export function frameFor(
  c: ClickEvent,
  vp: { width: number; height: number },
  sMax: number,
): CameraPose {
  const W = vp.width;
  const H = vp.height;
  const rect = c.rect ?? { x: c.x - 60, y: c.y - 24, w: 120, h: 48 };

  const menuRoom = rect.h >= 90 ? 24 : MENU_ROOM;
  const extW = rect.w;
  const extH = rect.h + menuRoom;
  const rectCx = rect.x + rect.w / 2;
  const rectCy = rect.y + rect.h / 2 + menuRoom / 2;
  const focusX = mix(rectCx, c.x, CLICK_WEIGHT);
  const focusY = mix(rectCy, c.y, CLICK_WEIGHT);

  const sByW = (FRAME_FRAC * W) / (extW + 2 * PAD);
  const sByH = (FRAME_FRAC * H) / (extH + 2 * PAD);
  const S = clamp(Math.min(sByW, sByH), S_MIN, sMax);

  const contentCx = clamp(focusX / W, 0, 1);
  const contentCy = clamp(focusY / H, 0, 1);
  const sideX = contentCx >= 0.5 ? 1 : -1;
  const sideY = contentCy >= 0.5 ? 1 : -1;
  const half = 1 / (2 * S);
  let cx = clamp(contentCx - (FRAME_OFFSET * sideX) / S, half, 1 - half);
  let cy = clamp(contentCy - (FRAME_OFFSET * 0.65 * sideY) / S, half, 1 - half);

  // Whatever the offset wanted, the thing being clicked has to be on screen.
  //
  // This is the ONLY guard a too-large framed region needs. When `rect` is
  // bigger than the frame — a full-height drawer passed as `frame:` — the fit
  // maths clamps to S_MIN and FRAME_OFFSET then crops from whichever side the
  // subject leans toward, which is how a Create button at the bottom of a
  // drawer ended up 102px BELOW the frame edge. Pulling the framing back so the
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
  const clickY = clamp(c.y / H, 0, 1);
  const margin = Math.min(CLICK_MARGIN, half * 0.4);
  cx = clamp(cx, clickX - half + margin, clickX + half - margin);
  cy = clamp(cy, clickY - half + margin, clickY + half - margin);
  // Content bounds win: panning past the edge would show stretched footage.
  // The fit guard above is what keeps these two from actually conflicting.
  cx = clamp(cx, half, 1 - half);
  cy = clamp(cy, half, 1 - half);
  return { scale: S, cx, cy };
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
      out[out.length - 1] = k;
      continue;
    }
    if (k.t - prev.t < 0.2 && posesNearlyEqual(prev.pose, k.pose)) {
      out[out.length - 1] = { t: k.t, pose: k.pose };
      continue;
    }
    out.push(k);
  }
  return out;
}

export function buildCameraTrack(log: ClickLog, speed = 1): CameraKey[] {
  const vp = log.viewport;
  const groups = stickify(clusterize(log.clicks, vp), vp);
  const keys: CameraKey[] = [{ t: 0, pose: BASE_POSE }];
  if (groups.length === 0) {
    keys.push({
      t: Math.max((log.durationMs || 8000) / 1000, 0.5),
      pose: BASE_POSE,
    });
    return keys;
  }

  // Holds live on the click-log clock too, so they need the same speed scaling
  // as moves or they land ~20% short on screen at the default 1.25x.
  const holdMin = HOLD_MIN_S * speed;
  const typeTail = TYPE_TAIL_S * speed;
  const baseBeat = BASE_BEAT_S * speed;

  /**
   * When a click's action is actually finished, on the log clock.
   *
   * For a click that is its timestamp. For a typing beat it is the last
   * keystroke — the camera must not trail away from text still being typed.
   */
  const holdUntil = (c: ClickEvent): number =>
    c.typeEndMs != null
      ? Math.max(c.tMs / 1000 + holdMin, c.typeEndMs / 1000 + typeTail)
      : c.tMs / 1000 + holdMin;

  let prevPose = BASE_POSE;
  const meta = groups.map((group, i) => ({
    group,
    poses: group.map((c) => frameFor(c, vp, i === 0 ? S_MAX_SOFT : S_MAX)),
    tIn: Math.max(0, departS(group[0]) - CAMERA_LEAD_S),
  }));

  for (let i = 0; i < meta.length; i++) {
    const { group, poses, tIn } = meta[i];
    const last = group[group.length - 1];
    const inPose = poses[0];
    const startT = Math.max(tIn, keys[keys.length - 1].t);
    const durIn = moveDuration(prevPose, inPose, "in", vp, speed);
    keys.push({ t: startT, pose: prevPose });
    keys.push({ t: startT + durIn, pose: inPose });

    let curPose = inPose;
    let curT = startT + durIn;
    for (let j = 1; j < group.length; j++) {
      const nextPose = poses[j];
      const tPan = Math.max(curT, departS(group[j]) - CAMERA_LEAD_S);
      if (poseTravelPx(curPose, nextPose, vp) > MAX_PAN_PX) {
        // Too far to pan at magnification. Pull back to base, then punch in —
        // the reference clips never sweep the camera across the whole screen.
        const durBack = moveDuration(curPose, BASE_POSE, "out", vp, speed);
        const durNext = moveDuration(BASE_POSE, nextPose, "in", vp, speed);
        // Leave just in time to reach base as the cursor departs, but not
        // before the previous click has had its minimum hold, and never after
        // the cursor has already gone.
        const prevHoldEnd = holdUntil(group[j - 1]);
        const backStart = clamp(
          tPan - durBack,
          Math.max(curT, prevHoldEnd),
          Math.max(curT, tPan),
        );
        keys.push({ t: backStart, pose: curPose });
        keys.push({ t: backStart + durBack, pose: BASE_POSE });
        const inStart = Math.max(backStart + durBack, tPan);
        keys.push({ t: inStart, pose: BASE_POSE });
        keys.push({ t: inStart + durNext, pose: nextPose });
        curT = inStart + durNext;
      } else {
        const durPan = moveDuration(curPose, nextPose, "pan", vp, speed);
        keys.push({ t: tPan, pose: curPose });
        keys.push({ t: tPan + durPan, pose: nextPose });
        curT = tPan + durPan;
      }
      curPose = nextPose;
    }

    const holdEnd = Math.max(curT, holdUntil(last));
    const durOut = moveDuration(curPose, BASE_POSE, "out", vp, speed);
    const next = meta[i + 1];

    if (!next) {
      const clipEnd = Math.max(
        curT,
        (log.durationMs || last.tMs + END_TAIL_S * 1000) / 1000,
      );
      // Always land back at base: it is the one rule all four reference clips
      // keep. Start the trail as late as the minimum hold allows, but early
      // enough that it plus a beat at base fits before the cut. When the two
      // conflict the trail wins — ending zoomed in reads far worse than a hold
      // trimmed short.
      const latest = clipEnd - durOut - baseBeat;
      const trailStart = Math.max(curT, Math.min(holdEnd, latest));
      if (trailStart + durOut <= clipEnd) {
        keys.push({ t: trailStart, pose: curPose });
        keys.push({ t: trailStart + durOut, pose: BASE_POSE });
        keys.push({ t: clipEnd, pose: BASE_POSE });
      } else {
        // Recording is too short to get home. Raise END_TAIL_S and re-record.
        keys.push({ t: clipEnd, pose: curPose });
      }
      prevPose = BASE_POSE;
      continue;
    }

    // Same guardrail as the intra-cluster pan: if the next beat is too far to
    // reach at magnification, go home first. Without this the "no room to
    // trail" branches below pan straight across the screen — e.g. Save at the
    // bottom right to a header at the top left, ~790px in under a second.
    const farApart = poseTravelPx(curPose, next.poses[0], vp) > MAX_PAN_PX;
    if (next.tIn >= holdEnd + durOut || farApart) {
      // Leave as late as the hold allows, but early enough to land at base
      // before the next cluster opens. When those conflict the trail wins: a
      // clipped hold reads far better than a screen-wide sweep.
      const trailStart = Math.max(curT, Math.min(holdEnd, next.tIn - durOut));
      keys.push({ t: trailStart, pose: curPose });
      keys.push({ t: trailStart + durOut, pose: BASE_POSE });
      prevPose = BASE_POSE;
    } else if (next.tIn > holdEnd) {
      keys.push({ t: next.tIn, pose: curPose });
      prevPose = curPose;
    } else {
      keys.push({ t: Math.max(curT, next.tIn), pose: curPose });
      prevPose = curPose;
    }
  }

  return normalizeKeys(keys);
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
  return interpolatePose(a.pose, b.pose, (t - a.t) / dur);
}

/**
 * The track is a pure function of (log, speed) but zoomAt runs per frame — and
 * once per sub-sample under CameraMotionBlur, so ~8x that. Cache it per log.
 */
const trackCache = new WeakMap<ClickLog, Map<number, CameraKey[]>>();

function cachedTrack(log: ClickLog, speed: number): CameraKey[] {
  let bySpeed = trackCache.get(log);
  if (!bySpeed) {
    bySpeed = new Map();
    trackCache.set(log, bySpeed);
  }
  let track = bySpeed.get(speed);
  if (!track) {
    track = buildCameraTrack(log, speed);
    bySpeed.set(speed, track);
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
  return poseToCss(sampleTrack(cachedTrack(log, speed), t), chromeFrac, fit);
}
