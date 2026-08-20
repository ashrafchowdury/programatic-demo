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
import { DEFAULT_LOOK, LOOKS, type ReelLook } from "./look";
import type { PushSpec } from "./push";

/** Re-exported so `look` can be authored and validated from one import. */
export { DEFAULT_LOOK, LOOKS, type ReelLook };

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
    /**
     * Static crop for the full-bleed look: `k` magnification about the content
     * point (`cx`, `cy`). Ignored under "framed", which derives its camera from
     * the click log instead.
     *
     * Authored per clip because the reference film hand-picks one framing per
     * shot: measured, the component that matters spans 84-93% of frame width in
     * every one of its four footage shots, and nothing about the click log
     * predicts which component that is.
     */
    crop?: { k: number; cx: number; cy: number; dx?: number; dy?: number };
    /** Entrance/exit push. Full-bleed only; absent = the clip does not move. */
    push?: PushSpec;
    /** Colour behind the plate if the crop leaves a gap. Full-bleed only. */
    pageBg?: string;
    /**
     * Draw the synthetic pointer. Full-bleed only, where it defaults to OFF.
     *
     * Turn it ON for any mouse-driven flow. The reference film hides the pointer
     * because its feature is keyboard-driven; over a flow that clicks, a hidden
     * pointer shows the UI reacting to nothing.
     */
    cursor?: boolean;
    /**
     * Draw the pointer's click ripple. Defaults to OFF.
     *
     * Neither reference film has one — the feedback is the real control's own
     * press state, which the capture already records. Turn it on only for a
     * target with no visible press state of its own.
     */
    ripple?: boolean;
  };
};
export type ReelSegment = ReelCard | ReelClip;

/**
 * One audio piece laid onto the finished reel's timeline.
 *
 * Opt-in and additive: a reel with no `audio` renders silent, byte-for-byte as
 * before. Pieces are mixed in a single post-concat pass on the SYSTEM ffmpeg
 * (the bundled remotion build has no audio filters) — see scripts/reel.ts and
 * the pure src/lib/reel-audio.ts. Multiple pieces cover both cases: place them
 * end to end (sequential) or overlapping (a bed under a lead).
 */
/**
 * A reel-time position that snaps to a segment boundary instead of a
 * hand-counted second — "start this tune at the 4th card's cut". `segment` is
 * 0-based; `edge` defaults to the segment's start.
 */
export type ReelAnchor = { segment: number; edge?: "start" | "end" };

export type ReelAudioPiece = {
  /** Path under public/, e.g. "audio/bed.mp3". Supplied locally (gitignored). */
  src: string;
  /** Source sub-range in seconds — use 12–25s of a file, say. Omit = whole file. */
  trim?: { fromS: number; toS?: number };
  /** Reel second (or a segment anchor) the piece begins. Default 0. */
  start?: number | ReelAnchor;
  /** Hard reel-time end. Mutually exclusive with `duration`. */
  end?: number | ReelAnchor;
  /** Reel seconds the piece occupies. Mutually exclusive with `end`. */
  duration?: number;
  /** Linear gain multiplier. Default 1 — use ~0.3–0.5 for a bed. */
  gain?: number;
  /** Fade in / out, seconds. */
  fadeInS?: number;
  fadeOutS?: number;
  /** Silence-pad to fill the span if the (trimmed) source is shorter than it. */
  pad?: boolean;
  /**
   * Mixing role. `bed` pieces duck under `lead`/`sfx` when `Reel.duck` is on;
   * everything else defaults to `lead`. Auto-SFX are tagged `sfx`.
   */
  role?: "bed" | "lead" | "sfx";
  /**
   * Crossfade into this piece from the PREVIOUS one over this many seconds. The
   * pair plays back to back (this piece's own `start` is ignored — the fade
   * defines the join), for a seamless track change.
   */
  crossfadePrevS?: number;
};

/**
 * One SFX cue: the sample to place, and how loud. `atLabels` overrides the kind's
 * built-in detector — the cue then fires on every beat whose click-log `label`
 * includes one of these strings (case-insensitive). Kinds without a built-in
 * detector (`key`, `confirm`, `error`) REQUIRE `atLabels`.
 */
export type SfxCue = {
  src: string;
  gain?: number;
  fadeOutS?: number;
  atLabels?: string[];
};

/**
 * SFX placed from the demo's click log, mapped into reel time. Three kinds have a
 * built-in detector; the other three are placed by `atLabels`:
 *
 * - `click`   — a real press that isn't a typing run (tDownMs, no typeEndMs).
 * - `typing`  — a real typed string (a bed over the run); short taps don't count.
 * - `pop`     — the UI's response ~120ms after any typed input (a menu opening).
 * - `key`     — one discrete key (Enter, an intro-text key); `atLabels` only.
 * - `confirm` — the payoff action (e.g. label "Allow all"); `atLabels` only.
 * - `error`   — a blocked/error action; `atLabels` only.
 */
export type ReelSfx = {
  click?: SfxCue;
  typing?: SfxCue;
  pop?: SfxCue;
  key?: SfxCue;
  confirm?: SfxCue;
  error?: SfxCue;
};

/** SFX kinds that place from a built-in click-log detector. */
export const SFX_AUTO_KINDS = ["click", "typing", "pop"] as const;
/** SFX kinds that only place via `atLabels`. */
export const SFX_LABEL_KINDS = ["key", "confirm", "error"] as const;
export const SFX_KINDS = [...SFX_AUTO_KINDS, ...SFX_LABEL_KINDS] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

/** Sidechain-ducking of `bed` pieces under `lead`/`sfx`. `true` = defaults. */
export type ReelDuck = {
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
};

export type Reel = {
  /** The demo these clips come from: out/<name>.mp4 and the DemoClip props. */
  name: string;
  segments: ReelSegment[];
  /** Audio pieces mixed onto the finished reel. Absent = silent (unchanged). */
  audio?: ReelAudioPiece[];
  /**
   * Normalize the final mix to this integrated loudness (LUFS). Absent = off.
   * -14 is the web/social standard. Applied on the mix before it is muxed.
   */
  loudnessLUFS?: number;
  /** Auto-SFX generated from the click log. Absent = none. */
  sfx?: ReelSfx;
  /** Duck `bed` pieces under `lead`/`sfx`. Absent = off. */
  duck?: boolean | ReelDuck;
  /** Visual treatment of the footage. Absent = "framed", i.e. unchanged. */
  look?: ReelLook;
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
  if (reel.look !== undefined && !LOOKS.includes(reel.look))
    return `look must be one of ${LOOKS.join(", ")}`;

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
  if (reel.audio !== undefined) {
    const problem = audioProblem(
      reel.audio,
      totalFrames,
      fps,
      reel.segments.length,
    );
    if (problem) return problem;
  }
  if (
    reel.loudnessLUFS !== undefined &&
    !(
      typeof reel.loudnessLUFS === "number" &&
      reel.loudnessLUFS <= 0 &&
      reel.loudnessLUFS >= -70
    )
  )
    return "`loudnessLUFS` must be a number between -70 and 0";
  if (reel.sfx !== undefined) {
    if (typeof reel.sfx !== "object" || reel.sfx === null)
      return "`sfx` must be an object";
    for (const kind of SFX_KINDS) {
      const cue = reel.sfx[kind];
      if (cue === undefined) continue;
      if (
        typeof cue !== "object" ||
        cue === null ||
        typeof cue.src !== "string" ||
        cue.src === ""
      )
        return `\`sfx.${kind}\` needs a \`src\``;
      for (const k of ["gain", "fadeOutS"] as const)
        if (cue[k] !== undefined && !(typeof cue[k] === "number" && cue[k]! >= 0))
          return `\`sfx.${kind}.${k}\` must be a number >= 0`;
      if (cue.atLabels !== undefined) {
        if (
          !Array.isArray(cue.atLabels) ||
          cue.atLabels.length === 0 ||
          cue.atLabels.some((l) => typeof l !== "string" || l === "")
        )
          return `\`sfx.${kind}.atLabels\` must be a non-empty array of non-empty strings`;
      } else if ((SFX_LABEL_KINDS as readonly string[]).includes(kind)) {
        return `\`sfx.${kind}\` needs \`atLabels\` (it has no built-in detector)`;
      }
    }
  }
  if (reel.duck !== undefined && typeof reel.duck !== "boolean") {
    if (typeof reel.duck !== "object" || reel.duck === null)
      return "`duck` must be a boolean or an object";
    for (const k of ["thresholdDb", "ratio", "attackMs", "releaseMs"] as const)
      if (reel.duck[k] !== undefined && typeof reel.duck[k] !== "number")
        return `\`duck.${k}\` must be a number`;
  }
  return null;
}

/**
 * Shape check for `reel.audio`, mirroring reelProblem's return-a-string style.
 * Exported so it can be unit-tested on its own. `totalFrames` bounds a piece's
 * start to inside the reel when known — a piece that begins after the reel ends
 * is inaudible and almost always a typo; an overrun past the END is fine (the
 * mux truncates it), so it is not checked here.
 */
/** A `start`/`end` value: seconds >= 0, or a `{ segment }` anchor. */
function anchorOrSecondsProblem(
  v: unknown,
  label: string,
  segmentCount?: number,
): string | null {
  if (v === undefined) return null;
  if (typeof v === "number")
    return v >= 0 ? null : `${label} must be a number >= 0`;
  if (typeof v === "object" && v !== null) {
    const a = v as Partial<ReelAnchor>;
    if (!Number.isInteger(a.segment))
      return `${label} anchor needs an integer \`segment\``;
    if (segmentCount != null && (a.segment! < 0 || a.segment! >= segmentCount))
      return `${label} anchor \`segment\` ${a.segment} is out of range (0-${segmentCount - 1})`;
    if (a.edge !== undefined && a.edge !== "start" && a.edge !== "end")
      return `${label} anchor \`edge\` must be "start" or "end"`;
    return null;
  }
  return `${label} must be a number of seconds or a { segment } anchor`;
}

export function audioProblem(
  value: unknown,
  totalFrames?: number,
  fps = 30,
  segmentCount?: number,
): string | null {
  if (!Array.isArray(value)) return "`audio` must be an array";
  const totalS = totalFrames != null ? totalFrames / fps : null;
  for (let i = 0; i < value.length; i++) {
    const piece = value[i] as Partial<ReelAudioPiece>;
    const at = `audio[${i}]`;
    if (typeof piece !== "object" || piece === null)
      return `${at} must be an object`;
    if (typeof piece.src !== "string" || piece.src === "")
      return `${at} needs a \`src\``;
    if (piece.trim !== undefined) {
      const { fromS, toS } = piece.trim;
      if (!(typeof fromS === "number" && fromS >= 0))
        return `${at} trim.fromS must be a number >= 0`;
      if (toS !== undefined && !(typeof toS === "number" && toS > fromS))
        return `${at} trim.toS must be a number greater than fromS`;
    }
    for (const key of [
      "duration",
      "gain",
      "fadeInS",
      "fadeOutS",
      "crossfadePrevS",
    ] as const) {
      const v = piece[key];
      if (v !== undefined && !(typeof v === "number" && v >= 0))
        return `${at} \`${key}\` must be a number >= 0`;
    }
    if (
      piece.role !== undefined &&
      piece.role !== "bed" &&
      piece.role !== "lead" &&
      piece.role !== "sfx"
    )
      return `${at} \`role\` must be bed, lead or sfx`;
    const startBad = anchorOrSecondsProblem(piece.start, `${at}.start`, segmentCount);
    if (startBad) return startBad;
    const endBad = anchorOrSecondsProblem(piece.end, `${at}.end`, segmentCount);
    if (endBad) return endBad;
    if (piece.end !== undefined && piece.duration !== undefined)
      return `${at} sets both \`end\` and \`duration\` — use one`;
    // Numeric ordering only; an anchor's position is trusted (resolved later).
    if (
      typeof piece.end === "number" &&
      typeof piece.start === "number" &&
      !(piece.end > piece.start)
    )
      return `${at} \`end\` must be after \`start\``;
    if (totalS != null && typeof piece.start === "number" && piece.start >= totalS)
      return `${at} starts at ${piece.start}s, after the reel ends (${totalS.toFixed(2)}s)`;
  }
  return null;
}
