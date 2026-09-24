/**
 * How long the recorder must wait before a press so the camera is not rushed.
 *
 * The camera track (src/lib/zoom.ts buildCameraTrack) is built AFTER the shoot
 * from the click log, and it has to land each move SETTLE_BEFORE_PRESS_S before
 * the press. When the press comes sooner than the move's natural duration
 * allows, the track squeezes the move — down to MOVE_FLOOR_S (450 ms on screen)
 * — and a squeezed move is where the remaining velocity spikes in the camera
 * came from. The track cannot fix that after the fact; only the recorder, which
 * decides when the press happens, can give the move its time.
 *
 * This is an ESTIMATE of the track's in-move, from the same functions it uses
 * (frameFor, moveDuration) and mirroring its placement rules in reach(). The
 * track stays authoritative: if this estimate is off, the only effect is that a
 * move is squeezed (as before) or the pointer hovers a little longer than it
 * needed to. It is deliberately conservative — it prices the sharp ceiling
 * rather than the softened first-cluster one, so it errs toward room.
 */
import { moveDuration, posesNearlyEqual, type CameraPose } from "../../src/lib/camera";
import {
  ACTION_WATCH_S,
  CAMERA_LEAD_S,
  DEFAULT_PLAYBACK_RATE,
  SETTLE_BEFORE_PRESS_S,
  type ClickEvent,
} from "../../src/lib/click-log";
import { SHARPNESS_CEILING } from "../../src/lib/crop";
import { WINDOW_FIT } from "../../src/lib/window";
import { CLICK_MARGIN, frameFor, GROUP_TIME_GAP, REPOSE_MIN_DS } from "../../src/lib/zoom";

type Vp = { width: number; height: number };

/** A beat the camera already framed: the logged event and the pose it got. */
export type FramedBeat = { event: ClickEvent; pose: CameraPose };

/** What frameFor needs from a beat that has not been logged yet. */
export type Beat = Pick<ClickEvent, "x" | "y" | "rect" | "cluster" | "zoom" | "zoomScale" | "content">;

/** The pose the camera will frame this beat at (sharp ceiling, see top). */
export function poseFor(beat: Beat, vp: Vp): CameraPose {
  return frameFor({ tMs: 0, ...beat }, vp, SHARPNESS_CEILING);
}

/** clickInShot from zoom.ts: is the click already visible at `pose`? */
function inShot(beat: Beat, pose: CameraPose, vp: Vp): boolean {
  const eff = pose.scale * WINDOW_FIT;
  if (eff <= 1) return true;
  const half = 1 / (2 * eff);
  const margin = Math.min(CLICK_MARGIN, half * 0.4);
  const x = Math.min(1, Math.max(0, beat.x / vp.width));
  const y = Math.min(1, Math.max(0, beat.y / vp.height));
  return (
    Math.abs(x - pose.cx) <= half - margin &&
    Math.abs(y - pose.cy) <= half - margin
  );
}

/**
 * Earliest press time (recording ms) that lets the camera arrive unhurried.
 *
 * @param beat     the target about to be pressed
 * @param departMs when the pointer set off toward it (the camera's `want`)
 * @param prev     the last zoomable beat logged, if any
 * @returns a recording-clock time; 0 when the camera has no move to make.
 */
export function earliestPressMs(
  beat: Beat,
  departMs: number,
  prev: FramedBeat | null,
  vp: Vp,
  rate = DEFAULT_PLAYBACK_RATE,
): number {
  if (beat.zoom === false) return 0;
  const to = poseFor(beat, vp);
  const settle = SETTLE_BEFORE_PRESS_S * rate * 1000;
  const want = departMs - CAMERA_LEAD_S * 1000;
  const dur = (a: CameraPose, kind: "in" | "out" | "pan") =>
    moveDuration(a, to, kind, vp, rate) * 1000;
  const base: CameraPose = { scale: 1, cx: 0.5, cy: 0.5 };

  if (!prev) return want + dur(base, "in") + settle;

  const p = prev.event;
  const sameCluster =
    beat.cluster != null
      ? beat.cluster === p.cluster
      : p.cluster == null && departMs - p.tMs < GROUP_TIME_GAP * 1000;
  // The camera may not leave the previous action before it has been watched.
  const hard = Math.max(p.tMs, p.typeEndMs ?? p.tMs) + ACTION_WATCH_S * rate * 1000;

  if (sameCluster) {
    // settle() in zoom.ts: a click already in shot keeps the pose unless the
    // next frame is meaningfully tighter.
    if (
      posesNearlyEqual(prev.pose, to) ||
      (to.scale - prev.pose.scale < REPOSE_MIN_DS && inShot(beat, prev.pose, vp))
    )
      return 0;
    return Math.max(want, hard) + dur(prev.pose, "pan") + settle;
  }

  // A new cluster. With room, the camera trails to base and punches in from
  // `want`; without it, it pans (or dips through a middle scale) from the
  // watch floor — never shorter than a pan.
  const outDur = moveDuration(prev.pose, base, "out", vp, rate) * 1000;
  if (want >= hard + outDur) return want + dur(base, "in") + settle;
  return Math.max(want, hard) + dur(prev.pose, "pan") + settle;
}
