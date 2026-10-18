/**
 * How many frames a DemoClip runs, and where its footage runs out.
 *
 * The camera track can outlast the recording: when the last beat's hold + the
 * closing trail + a beat at base do not fit before durationMs, buildCameraTrack
 * runs past it rather than cut the payoff (see trackDurationMs). Sized from
 * durationMs alone, three of the logs in public/ ended mid-zoom — skillsmp-search
 * at 1.74x the recording, agent-demo 1.34x, agent-tool 1.05x. So the clip is
 * sized from the track, and the footage holds its final frame past its end.
 *
 * ONE length per (log, speed, chrome), whatever the style. A reel cuts frame
 * ranges out of out/demo/<name>.mp4 and then renders each range again in its
 * own style; if a camera-less style sized itself shorter, a range in the held
 * tail would point past its composition. So the length always comes from the
 * one camera there is — the framed window's, at WINDOW_FIT — and styles that
 * run no camera simply show the held frame for the extra beat.
 *
 * Shared by src/Root.tsx (calculateMetadata) and scripts/reel.ts (its frame
 * count check against the rendered demo), so the two cannot disagree.
 */
import { DESIGN_WIDTH, OUTPUT_WIDTH, type ClickLog } from "./click-log";
import { CHROME_H, WINDOW_FIT } from "./window";
import { trackDurationMs, type FrameGeometry } from "./zoom";

const even = (n: number) => Math.round(n / 2) * 2;

/**
 * The composition size: OUTPUT_WIDTH wide at the recording's aspect, rounded
 * to even so h264 accepts it.
 */
export function demoSize(log: ClickLog): { width: number; height: number } {
  const aspect = log.viewport.height / log.viewport.width;
  return { width: even(OUTPUT_WIDTH), height: even(OUTPUT_WIDTH * aspect) };
}

/**
 * The geometry DemoClip frames its camera for — the same numbers useCameraAt
 * computes from useVideoConfig(): the window at WINDOW_FIT (the camera style's
 * own windowFit) and, with chrome on, the titlebar's share of the window group.
 */
export function demoGeometry(
  log: ClickLog,
  chrome = false,
): Required<FrameGeometry> {
  const { width, height } = demoSize(log);
  const chromeH = CHROME_H * (width / DESIGN_WIDTH);
  return {
    fit: WINDOW_FIT,
    chromeFrac: chrome ? chromeH / (height + chromeH) : 0,
    focus: false,
  };
}

/**
 * Frames of real footage: the length the composition used to have. Frame
 * `footageFrames - 1` is the last one whose source time is inside the
 * recording; DemoClip holds that one from there on.
 */
export function footageFrames(
  log: ClickLog,
  speed: number,
  fps: number,
): number {
  return Math.max(1, Math.ceil((log.durationMs / 1000 / speed) * fps));
}

/**
 * Frames the composition needs for the camera to finish: the track's end on
 * the click-log clock, shifted by offsetMs (zoomAt subtracts it, so the camera
 * reaches a log time that much later), never shorter than the footage.
 */
export function demoDurationInFrames(
  log: ClickLog,
  speed: number,
  geom: FrameGeometry,
  fps: number,
): number {
  const trackMs = log.clicks?.length
    ? trackDurationMs(log, speed, geom) + (log.offsetMs ?? 0)
    : 0;
  return Math.max(
    footageFrames(log, speed, fps),
    Math.ceil((trackMs / 1000 / speed) * fps),
  );
}
