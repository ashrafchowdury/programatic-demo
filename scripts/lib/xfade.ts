/**
 * The finishing graph: every segment join and every overlay layer, in ONE
 * ffmpeg pass.
 *
 * Both Cursor films cut exclusively; monid never does, ramping between shots
 * over six frames. Supporting that means the concat stops being a concat.
 *
 * Cuts and dissolves are different filters. A cut boundary goes through
 * `concat` (frame-exact, nothing blended), a dissolve boundary through `xfade`.
 * This used to be an all-xfade chain once anything dissolved, and xfade cannot
 * do zero frames (see the note below), so every CUT inside a
 * dissolving film became a one-frame blend that dropped the incoming shot's
 * first frame. Runs of cut segments are now concatenated first and only the
 * runs are cross-faded.
 *
 * Overlays (the step HUD, the annotation chips) composite in the same graph.
 * They used to be a pass each, so a dissolving reel with both went through four
 * h264 generations: segments -> xfade -> HUD -> chips. Now a reel is at most
 * ONE re-encode after its segments, and a reel that only cuts and has no layer
 * is not re-encoded at all (the -c copy concat in scripts/lib/reel-cut.ts).
 *
 * TWO THINGS A DISSOLVE CHANGES, and both are load-bearing:
 *
 *  1. **It re-encodes.** `-c copy` cannot blend two streams, so a dissolving
 *     reel is decoded and re-encoded end to end. A reel that dissolves is
 *     therefore NOT byte-comparable against one that cuts, and the byte-identity
 *     contract used everywhere else has to carve this out explicitly.
 *
 *  2. **It shortens the film.** Every dissolve consumes its own `overlaps[i]`
 *     frames from BOTH sides, so the film loses their sum. The joins are a LIST,
 *     not one number, because the reference dissolves SELECTIVELY: monid blends
 *     2 of its ~4 boundaries, both between sections, and blending every join
 *     instead cross-fades cards into live UI, which reads as muddy.
 *
 *     Segment starts therefore shift earlier cumulatively, which matters well
 *     beyond the picture: SFX are placed against segment bounds, so a dissolving
 *     reel whose bounds were computed for cuts would fire every tick
 *     progressively later than its own footage.
 *
 * Pure string assembly, so the offsets can be checked without spawning ffmpeg.
 * Runs on the SYSTEM ffmpeg — the bundled Remotion build is filter-whitelisted
 * and has no `xfade`, the same reason the audio mux uses the system binary.
 */
import { VIDEO_ENCODE_ARGS } from "./encode";

/**
 * Why cuts never reach xfade: `xfade=duration=0` does not butt two shots
 * together — it degenerates, and the chain silently drops everything before it.
 * Measured: an 897-frame film with two zero joins came out at 556, exactly the
 * length of its longest segment. The old fix clamped every cut to a one-frame
 * blend, which cost the incoming shot its first frame; `runs` below routes cuts
 * through `concat` instead, so a zero join is never handed to xfade.
 */
/** ffmpeg-friendly number: no scientific notation, no trailing zeros. */
const n = (x: number): string => String(Number(x.toFixed(6)));

/**
 * Total frames of a dissolved film.
 *
 * Straight sum minus the overlap each join eats. A single segment has no join
 * and is returned untouched.
 */
export function dissolvedFrameCount(
  counts: number[],
  overlaps: number[],
): number {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (counts.length < 2) return sum;
  return sum - overlaps.reduce((a, b) => a + b, 0);
}

/**
 * Reel-time start of each segment once the dissolves have pulled them together.
 *
 * Segment i loses the SUM of every join before it, not a multiple of one value —
 * joins may differ, and a style that blends only some of them is the normal
 * case. The value returned is where the segment begins to appear; the midpoint
 * of its incoming dissolve is half that join later, which is the frame a viewer
 * would call the cut.
 */
export function dissolvedStarts(
  counts: number[],
  fps: number,
  overlaps: number[],
): number[] {
  const starts: number[] = [];
  let acc = 0;
  let eaten = 0;
  for (let i = 0; i < counts.length; i++) {
    if (i > 0) eaten += overlaps[i - 1] ?? 0;
    starts.push((acc - eaten) / fps);
    acc += counts[i];
  }
  return starts;
}

/**
 * Group segment indices into runs joined by cuts. `joins[i]` joins segment i to
 * i+1; a zero join keeps the next segment in the current run.
 */
export function runs(count: number, joins: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0 || (joins[i - 1] ?? 0) > 0) out.push([i]);
    else out[out.length - 1].push(i);
  }
  return out;
}

/**
 * The `-filter_complex` graph joining every part and compositing `layers`
 * transparent overlays on top, output as `[v]`.
 *
 * Inputs are the parts first (`[0:v]`..`[N-1:v]`), then the layers in the
 * order given — so the last layer draws on top.
 *
 * `xfade` takes two streams and one offset, so R runs chain as R-1 nodes. The
 * offset is measured on the ACCUMULATED output, not on the incoming run, and it
 * is where the fade STARTS — so each is the running length so far minus one
 * overlap. Getting that wrong does not error; it silently plays the join at
 * the wrong moment, which is why the offsets are computed here and tested.
 */
export function buildJoinFilter(
  counts: number[],
  fps: number,
  joins: number[],
  layers = 0,
): string {
  const parts: string[] = [];
  const groups = runs(counts.length, joins);
  // Once a graph cross-fades, every run is put on ONE timebase first. xfade
  // refuses two inputs that disagree, and concat's output (1/1000000) never
  // agrees with a lone segment's (1/90000) — measured: "First input link main
  // timebase (1/90000) do not match ... (1/1000000)" on the first mixed reel.
  // settb only relabels the clock; no frame is added or dropped.
  const retime = groups.length > 1;
  const runLabels = groups.map((g, r) => {
    if (g.length === 1 && !retime) return `[${g[0]}:v]`;
    const src =
      g.length === 1
        ? `[${g[0]}:v]`
        : `${g.map((i) => `[${i}:v]`).join("")}concat=n=${g.length}:v=1:a=0,`;
    parts.push(`${src}settb=AVTB[r${r}]`);
    return `[r${r}]`;
  });
  const runFrames = groups.map((g) => g.reduce((a, i) => a + counts[i], 0));

  let label = runLabels[0] ?? "[0:v]";
  // Length of the chain built so far, in seconds.
  let acc = (runFrames[0] ?? 0) / fps;
  for (let r = 1; r < groups.length; r++) {
    const out = `[x${r}]`;
    const d = (joins[groups[r][0] - 1] ?? 0) / fps;
    const offset = acc - d;
    parts.push(
      `${label}${runLabels[r]}xfade=transition=fade:duration=${n(d)}:offset=${n(offset)}${out}`,
    );
    acc = offset + runFrames[r] / fps;
    label = out;
  }

  // overlay runs to the LONGER input, so a layer one frame longer than the
  // film stretched it by that frame (stage + chips: 701 predicted, 702 out).
  // Trim each layer to the film's length; eof_action=pass shows the film
  // through if a layer ends early.
  const total = Math.round(acc * fps);
  for (let k = 0; k < layers; k++) {
    const layer = `[l${k}]`;
    const out = `[o${k}]`;
    parts.push(
      `[${counts.length + k}:v]trim=end_frame=${total},setpts=PTS-STARTPTS${layer}`,
    );
    parts.push(`${label}${layer}overlay=format=auto:eof_action=pass${out}`);
    label = out;
  }

  // Name the result [v] whatever produced it.
  if (parts.length === 0) return `${label}null[v]`;
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/\[[a-z0-9]+\]$/, "[v]");
  return parts.join(";");
}

/**
 * The whole ffmpeg invocation, `parts` + `layers` -> `out`, encoded once.
 *
 * The encode flags are the point of building it here: the pass used to name no
 * codec, CRF or pixel format, and came out H.264 High 4:4:4 at CRF 23 with no
 * colour tags. See scripts/lib/encode.ts.
 */
export function buildFinishArgs(
  parts: string[],
  counts: number[],
  fps: number,
  joins: number[],
  layers: string[],
  out: string,
): string[] {
  return [
    "-y",
    ...[...parts, ...layers].flatMap((f) => ["-i", f]),
    "-filter_complex",
    buildJoinFilter(counts, fps, joins, layers.length),
    "-map",
    "[v]",
    ...VIDEO_ENCODE_ARGS,
    "-movflags",
    "+faststart",
    out,
  ];
}
