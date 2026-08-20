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
 *  2. **It shortens the film.** Every dissolve consumes `overlapF` frames from
 *     BOTH sides, so N segments joined by N-1 dissolves lose (N-1) * overlapF
 *     frames in total. Segment starts shift earlier as they go, which matters
 *     well beyond the picture: SFX are placed against segment bounds, so a
 *     dissolving reel whose bounds were computed for cuts would fire every tick
 *     progressively later than its own footage.
 *
 * Pure string assembly, so the offsets can be checked without spawning ffmpeg.
 * Runs on the SYSTEM ffmpeg — the bundled Remotion build is filter-whitelisted
 * and has no `xfade`, the same reason the audio mux uses the system binary.
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
  overlapF: number,
): number {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (counts.length < 2 || overlapF <= 0) return sum;
  return sum - (counts.length - 1) * overlapF;
}

/**
 * Reel-time start of each segment once the dissolves have pulled them together.
 *
 * Segment i loses `i * overlapF` frames of lead-in, because every join before it
 * overlapped. The value returned is where the segment BEGINS to appear — the
 * midpoint of its incoming dissolve is `overlapF / 2` later, which is the frame
 * a viewer would call the cut.
 */
export function dissolvedStarts(
  counts: number[],
  fps: number,
  overlapF: number,
): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    starts.push((acc - i * overlapF) / fps);
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
  overlapF: number,
): string {
  if (counts.length < 2) return "";
  const d = overlapF / fps;
  const parts: string[] = [];
  // Length of the chain built so far, in seconds.
  let acc = counts[0] / fps;
  let label = "[0:v]";
  for (let i = 1; i < counts.length; i++) {
    const out = i === counts.length - 1 ? "[v]" : `[x${i}]`;
    const offset = acc - d;
    parts.push(
      `${label}[${i}:v]xfade=transition=fade:duration=${n(d)}:offset=${n(offset)}${out}`,
    );
    acc = offset + d + counts[i] / fps - d;
    label = out;
  }
  return parts.join(";");
}
