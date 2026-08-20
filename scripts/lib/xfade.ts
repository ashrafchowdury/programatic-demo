/**
 * Dissolve chain for a reel whose style does not hard-cut.
 *
 * Both Cursor films cut exclusively; monid never does, ramping between shots
 * over six frames. Supporting that means the concat stops being a concat.
 *
 * TWO THINGS THIS CHANGES, and both are load-bearing:
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

/**
 * The shortest join xfade can actually perform: one frame.
 *
 * `xfade=duration=0` does not butt two shots together — it degenerates, and the
 * chain silently drops everything before it. Measured: an 897-frame film with
 * two zero joins came out at 556, exactly the length of its longest segment.
 *
 * So inside a dissolving film a "cut" is a ONE-FRAME blend. That is invisible
 * at 30fps, and it costs one frame per cut join, which the frame accounting has
 * to charge for or the render is rejected as a mismatch. Clamp with this before
 * calling anything here, so the filter and the arithmetic cannot disagree.
 */
export const MIN_JOIN_F = 1;

/** Clamp a join list for use in a dissolving film. See MIN_JOIN_F. */
export function joinable(overlaps: number[]): number[] {
  return overlaps.map((o) => Math.max(o, MIN_JOIN_F));
}

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
 * The `-filter_complex` graph joining every part with a fade.
 *
 * `xfade` takes two streams and one offset, so N parts chain as N-1 nodes. The
 * offset is measured on the ACCUMULATED output, not on the incoming segment,
 * and it is where the fade STARTS — so each is the running length so far minus
 * one overlap. Getting that wrong does not error; it silently plays the join at
 * the wrong moment, which is why the offsets are computed here and tested.
 */
export function buildXfadeFilter(
  counts: number[],
  fps: number,
  overlaps: number[],
): string {
  if (counts.length < 2) return "";
  const parts: string[] = [];
  // Length of the chain built so far, in seconds.
  let acc = counts[0] / fps;
  let label = "[0:v]";
  for (let i = 1; i < counts.length; i++) {
    const out = i === counts.length - 1 ? "[v]" : `[x${i}]`;
    const d = (overlaps[i - 1] ?? 0) / fps;
    const offset = acc - d;
    parts.push(
      `${label}[${i}:v]xfade=transition=fade:duration=${n(d)}:offset=${n(offset)}${out}`,
    );
    acc = offset + counts[i] / fps;
    label = out;
  }
  return parts.join(";");
}
