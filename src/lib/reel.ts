/**
 * A reel: one video cut from title cards and ranges of an already-rendered demo.
 *
 * The card/clip/card/clip shape is the whole point. A raw screen recording shows
 * what the product does but not why any of it matters; a card before each beat
 * says the why in four words and gives the eye somewhere to rest. Cutting the
 * footage into ranges rather than playing it through is what makes the cards
 * land on the action they describe.
 *
 * Clip ranges are authored in SECONDS of the rendered demo, because that is what
 * you read off a scrubber. Frames are derived — see clipFrames.
 *
 * Pure by design: no ffmpeg, no Remotion. scripts/reel.ts does the rendering.
 */
import { introProblem, type IntroStoryboard } from "./intro";

export type ReelCard = { card: IntroStoryboard };
/** Inclusive start, EXCLUSIVE end, in seconds of out/<name>.mp4. */
export type ReelClip = {
  clip: {
    fromS: number;
    toS: number;
    label?: string;
    /**
     * Slow push inside long holds, 0..1. Off by default.
     *
     * Reaches the camera as a DemoClip prop; see driftPose in src/lib/zoom.ts.
     * out/<name>.mp4 never gets it, so the demo render is untouched.
     */
    drift?: number;
  };
};
export type ReelSegment = ReelCard | ReelClip;

export type Reel = {
  /** The demo these clips come from: out/<name>.mp4 and the DemoClip props. */
  name: string;
  segments: ReelSegment[];
};

export const defineReel = (reel: Reel): Reel => reel;

/** Longest a leading clip can be and still read as a tease rather than a scene. */
export const COLD_OPEN_MAX_S = 1.2;

export const isCard = (s: ReelSegment): s is ReelCard => "card" in s;
export const isClip = (s: ReelSegment): s is ReelClip => "clip" in s;

/**
 * Frame range for a clip, as Remotion's --frames wants it: inclusive on both
 * ends. `toS` is exclusive so adjacent ranges can be written 0-3.2 and 3.2-7.9
 * without the shared second appearing twice.
 */
export function clipFrames(
  clip: ReelClip["clip"],
  fps: number,
): { first: number; last: number } {
  const first = Math.round(clip.fromS * fps);
  const last = Math.round(clip.toS * fps) - 1;
  return { first, last: Math.max(first, last) };
}

export const clipFrameCount = (clip: ReelClip["clip"], fps: number): number => {
  const { first, last } = clipFrames(clip, fps);
  return last - first + 1;
};

/**
 * Index of the cold open, or -1.
 *
 * A cold open is RECOGNISED by its shape, not asserted by the author: a short
 * clip in first position, immediately followed by a card. That shape is a
 * deliberate flash-forward — it shows a few frames of product before the title,
 * replaying footage the next clip also covers — and it is the one case the
 * monotonic rule must not reject.
 *
 * Recognition rather than a flag is what keeps the exemption from widening into
 * a general escape hatch. Two clips in a row is a typo, not a tease; a long
 * leading clip is a scene, and whatever follows it still has to be in order.
 */
export function coldOpenIndex(segments: ReelSegment[]): number {
  const first = segments[0];
  const second = segments[1];
  if (!first || !isClip(first)) return -1;
  if (!second || !isCard(second)) return -1;
  return first.clip.toS - first.clip.fromS <= COLD_OPEN_MAX_S ? 0 : -1;
}

/**
 * Shape check for a dynamically imported reel, mirroring introProblem.
 *
 * `totalFrames` is the length of the rendered demo when it is known. Checking
 * ranges against it here turns "the last clip ran off the end" into an error
 * before the first segment renders, rather than an ffmpeg failure after several
 * minutes of work.
 */
export function reelProblem(
  value: unknown,
  totalFrames?: number,
  fps = 30,
): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const reel = value as Partial<Reel>;
  if (typeof reel.name !== "string" || reel.name === "")
    return "missing a `name`";
  if (!Array.isArray(reel.segments) || reel.segments.length === 0)
    return "has no `segments`";

  const cold = coldOpenIndex(reel.segments as ReelSegment[]);
  let previousLast = -1;
  for (let i = 0; i < reel.segments.length; i++) {
    const segment = reel.segments[i] as ReelSegment;
    const at = `segment ${i + 1}`;
    if (isCard(segment)) {
      const problem = introProblem(segment.card);
      if (problem) return `${at} (card) is ${problem}`;
      continue;
    }
    if (!isClip(segment)) return `${at} is neither a card nor a clip`;
    const { fromS, toS } = segment.clip;
    if (typeof fromS !== "number" || typeof toS !== "number")
      return `${at} (clip) needs numeric fromS and toS`;
    const { drift } = segment.clip;
    if (
      drift !== undefined &&
      !(typeof drift === "number" && drift >= 0 && drift <= 1)
    )
      return `${at} (clip) drift must be a number between 0 and 1`;
    if (!(toS > fromS)) return `${at} (clip) ends at or before it starts`;
    if (fromS < 0) return `${at} (clip) starts before the demo does`;
    const { first, last } = clipFrames(segment.clip, fps);
    if (totalFrames != null && last >= totalFrames)
      return (
        `${at} (clip) ends at frame ${last}, but the demo has ${totalFrames} ` +
        `frames (0-${totalFrames - 1})`
      );
    // Out-of-order ranges are almost always a typo, and they play as a jump cut
    // backwards in time. Deliberate reordering is rare enough to be worth
    // failing on until someone actually wants it — with one exception, the cold
    // open, which neither reads nor advances the high-water mark.
    if (i !== cold) {
      if (first <= previousLast)
        return `${at} (clip) starts at or before the previous clip ended`;
      previousLast = last;
    }
  }
  return null;
}
