import {
  BASE_BEAT_S,
  CAMERA_LEAD_S,
  DESIGN_WIDTH,
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
  const S =
    c.zoomScale != null
      ? clamp(c.zoomScale, S_MIN, sMax)
      : clamp(Math.min(sByW, sByH), S_MIN, sMax);

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
    poses: group.map((c) =>
      // The first cluster is softened (S_MAX_SOFT) so a film does not open on
      // its most aggressive push — but an explicit zoomScale is a deliberate
      // request, so it gets the full sharp ceiling even in first position.
      frameFor(c, vp, i === 0 && c.zoomScale == null ? S_MAX_SOFT : S_MAX),
    ),
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
  return posesNearlyEqual(a.pose, b.pose) ? { startT: a.t, endT: b.t } : null;
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
  const track = cachedTrack(log, speed);
  const pose = driftPose(
    sampleTrack(track, t),
    track,
    t,
    speed,
    opts.drift ?? 0,
  );
  return poseToCss(pose, chromeFrac, fit);
}
