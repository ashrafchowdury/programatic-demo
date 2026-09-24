/**
 * The camera shutter: when each motion-blur sample is taken, and how many.
 *
 * Pure numbers, so the timing can be tested without a renderer. The component
 * that draws the samples is src/ShutterBlur.tsx.
 *
 * WHY NOT @remotion/motion-blur's CameraMotionBlur. Two measured problems:
 *
 * 1. IT IS NOT CENTRED ON THE FRAME. v4.0.506 draws sample i of N at
 *    `frame - shutter * i/N + 1`, i = 1..N — at 180° and 8 samples that is
 *    frame +0.50 … +0.94, mean +0.72. Everything outside the shutter (the rim
 *    light, the push, the keycap) is drawn at `frame`, so the window ran 0.72
 *    of a frame ahead of its own rim. Measured on gmail-automation f540-545
 *    (zoom-out, left edge at 13-30 px/frame, 2560 wide): the hairline sat 9-18
 *    px outside the window's mid-edge with dark ground between, where it
 *    belongs 1.3 px out. Centred, the window's mid-edge lands on the old rim
 *    position to the pixel (f543-545: 77/92/105 → 78/92/105) and the rim merges
 *    into the edge. At the 60-100 px/frame punch-ins the old gap was 40-70 px.
 * 2. ITS SAMPLE COUNT IS FIXED. 8 copies across a 31 px shutter leave 4 px
 *    steps — the "stacked copies" on the first frames of a move (gmail f25).
 *
 * Samples here sit symmetrically about `frame`, so the blurred window's
 * centroid and the unblurred rim are the same instant.
 */

/** Shutter angle in degrees. 180° = open for half of each frame. */
export const SHUTTER_ANGLE = 180;

/**
 * Samples in one GROUP. The unit, not a default: the count only ever grows in
 * whole groups. See `samplesAt` for why.
 */
export const GROUP_SAMPLES = 8;

/** Most groups a frame may draw. 2 = 16 samples. */
export const MAX_GROUPS = 2;

/**
 * Largest gap between adjacent samples, in OUTPUT px, before a frame earns a
 * second group.
 *
 * Measured on gmail-automation f25 (2560 wide, edge travel 62 px/frame, so a
 * 31 px shutter / 8 = 3.9 px steps): the copies read as discrete rings on
 * every text edge. A 2 px step sits under the footage's own softness after the
 * upscale and reads as a smear. So: 8 samples up to a 16 px shutter smear,
 * 16 above it.
 */
export const MAX_SAMPLE_STEP_PX = 2;

/** Fraction of one frame the shutter is open for. */
export const shutterFraction = (angle = SHUTTER_ANGLE): number =>
  Math.min(1, Math.max(0, angle / 360));

/**
 * How many groups of GROUP_SAMPLES this frame needs, given how far the window's
 * fastest corner travels while the shutter is open.
 *
 * WHOLE GROUPS, AND NEVER FEWER THAN ONE, because every sample is composited at
 * 1/N opacity and each composite rounds to 8 bits: N identical copies of level v
 * come out as N·round(v/N). Measured on a gmail-automation hold (f21), page
 * white renders 248 at 8 samples and 255 at a flat 16 — 9.4% of the frame's
 * pixels move, by up to 9 levels, so switching counts mid-move would flash the
 * whole window. Groups dodge that: each group of 8 flattens to a multiple of 8
 * first, and halving a multiple of 8 is exact. Measured, the same hold at one
 * group and at two is byte-identical. That is also why holds keep all 8 — one
 * sample would be the "right" picture but a different one, and the jump into
 * the first moving frame would show.
 *
 * COST. A second group doubles that frame's render. On gmail-automation f170-199
 * (6 of 30 frames doubled, concurrency 1) the range took 5.0-5.2s at a fixed 8,
 * 5.3-6.5s adaptive, 13.0s at a fixed 16. Across five demos 5-16% of frames
 * earn the second group (model-providers the most).
 */
export function groupsFor(
  travelPx: number,
  maxStepPx = MAX_SAMPLE_STEP_PX,
): number {
  if (!(travelPx > 0) || !(maxStepPx > 0)) return 1;
  const needed = Math.ceil(travelPx / (GROUP_SAMPLES * maxStepPx));
  return Math.min(MAX_GROUPS, Math.max(1, needed));
}

/**
 * Sample times for one frame, as `groups` arrays of GROUP_SAMPLES frames each.
 *
 * All N = groups × GROUP_SAMPLES samples are spread evenly over the open
 * shutter, centred on `frame`: sample j sits at
 * `frame + fraction · ((j + ½)/N − ½)`. Group g takes every groups-th sample
 * starting at g, so each group on its own spans the whole shutter (its own
 * copies average to the right place) and group 0 at one group is exactly the
 * even 8-sample spread.
 *
 * Clamped to [0, lastFrame]: a centred shutter reaches half a sample before
 * frame 0, where the camera track has nothing to say.
 */
export function sampleFrames(
  frame: number,
  groups: number,
  opts: { fraction?: number; lastFrame?: number } = {},
): number[][] {
  const fraction = opts.fraction ?? shutterFraction();
  const last = opts.lastFrame ?? Infinity;
  const g = Math.max(1, Math.floor(groups));
  const n = g * GROUP_SAMPLES;
  const out: number[][] = [];
  for (let gi = 0; gi < g; gi++) {
    const times: number[] = [];
    for (let k = 0; k < GROUP_SAMPLES; k++) {
      const j = gi + k * g;
      const t = frame + fraction * ((j + 0.5) / n - 0.5);
      times.push(Math.min(last, Math.max(0, t)));
    }
    out.push(times);
  }
  return out;
}

/** The camera state the shutter measures: DemoClip's window-group transform. */
export type GroupPose = { scale: number; translateX: number; translateY: number };

/**
 * Furthest any corner of the window group moves between two poses, in px of a
 * `width` × `height` stage.
 *
 * The group is centred, translated by `translate × size` and scaled about its
 * centre (see useCameraGroup in DemoClip), so a corner at (±½, ±½) of the group
 * lands at `size · (½ + translate ± scale/2)`. Corners, not the centre: a pure
 * zoom leaves the centre still while the edges travel furthest.
 */
export function cornerTravelPx(
  a: GroupPose,
  b: GroupPose,
  width: number,
  height: number,
): number {
  let max = 0;
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5]) {
      const dx = width * (b.translateX - a.translateX + sx * (b.scale - a.scale));
      const dy = height * (b.translateY - a.translateY + sy * (b.scale - a.scale));
      max = Math.max(max, Math.hypot(dx, dy));
    }
  return max;
}
