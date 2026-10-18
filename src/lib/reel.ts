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
 * you read off a scrubber — or, better, as BEAT ANCHORS into the demo's click
 * log (`fromBeat: "Add provider"`), which survive a re-shoot that moves the
 * action. resolveReel turns anchors into seconds; frames are derived from
 * seconds — see clipFrames.
 *
 * Pure by design: no ffmpeg, no Remotion. scripts/reel.ts does the rendering.
 */
import {
  introDurationInFrames,
  introProblem,
  introTiming,
  type IntroStoryboard,
} from "./intro";
import type { ReelChipInput } from "./chips";
import { FPS, logMsToDemoS, type ClickLog } from "./click-log";
import { brandProblem } from "./brand";
import { DEMO_LOOK, LOOKS, type ReelLook } from "./look";
import {
  resolveStyle,
  STYLE_PRESETS,
  styleProblem,
  type ReelStyle,
  type ShotJoin,
  type ShotStyle,
  type StylePreset,
  type WindowSpec,
} from "./style";
import type { PushSpec } from "./push";
import type { CropSpec } from "./crop";
import { isAspect, isNativeAspect, ASPECTS, type Aspect } from "./aspect";
import { beatPoint, beatRect, openProblem, type ClipOpen, type ResolvedOpen } from "./open";

/** Re-exported so `look` can be authored and validated from one import. */
export { DEMO_LOOK, LOOKS, type ReelLook };

export type ReelCard = { card: IntroStoryboard };

/** Inclusive start, EXCLUSIVE end, in seconds of out/demo/<demo>.mp4. */
export type ClipRange = { fromS: number; toS: number };

/**
 * A clip range as AUTHORED: plain seconds, beat anchors, or a mix.
 *
 * Hand-typed seconds break silently on a re-shoot or a label drift, and three
 * clocks are in play (25 fps capture, 30 fps output, 1.25x playback) — which
 * is where the earlier "25% late" error came from. An anchor names a beat in
 * public/<demo>.clicks.json instead, and resolveReel places it with the same
 * playback rate the demo renders at:
 *
 *   { fromBeat: "Add provider", leadS: -0.4, toBeat: "Save", tailS: 0.3 }
 *
 * - `fromS`/`toS` win when given; otherwise the beat side is used.
 * - A beat sits on its PRESS (`tDownMs`, else `tMs`) — the frame the pointer
 *   squashes and the SFX tick lands on.
 * - `leadS`/`tailS` are SIGNED offsets added to the beat: `leadS: -0.4` starts
 *   0.4s before the press, `tailS: 0.3` ends 0.3s after it.
 * - The end is `toBeat` (else `fromBeat`) plus `tailS`, so `{ fromBeat, leadS,
 *   tailS }` alone frames one action.
 * - Labels match the click log's `label` exactly, ignoring case. A label used
 *   more than once is ambiguous and must say which: `"open cadence#2"`.
 * - `toEdge: "typeEnd"` ends on the end beat's last keystroke (`typeEndMs`)
 *   instead of its press, so a clip that frames a typing beat keeps its tail
 *   after the text across a re-shoot that types faster or slower. Only a typing
 *   beat has that edge; naming it on a click is an error. Default `"press"`.
 */
export type ClipAnchors = {
  fromS?: number;
  toS?: number;
  fromBeat?: string;
  leadS?: number;
  toBeat?: string;
  tailS?: number;
  toEdge?: ClipEdge;
};

export const CLIP_EDGES = ["press", "typeEnd"] as const;
export type ClipEdge = (typeof CLIP_EDGES)[number];

/** Everything on a clip except where it starts and ends. */
export type ClipFields = {
  /**
   * Cut from this recording instead of the reel's `demo`: a scene shot on its
   * own (another app, another page), so changing it re-renders only its clips.
   * Its anchors read its own click log. Native aspect only.
   */
  demo?: string;
  label?: string;
  /**
   * Slow push inside long holds, 0..1. Off by default.
   *
   * Reaches the camera as a DemoClip prop; see driftPose in src/lib/zoom.ts.
   * out/demo/<demo>.mp4 never gets it, so the demo render is untouched. Only the
   * click-log zoom camera reads it (checked).
   */
  drift?: number;
  /**
   * Static framing for the full-bleed styles. A windowed style (`classic`,
   * `stage`) cannot honour it, so reelProblem rejects it there.
   *
   * Two spellings, and `rect` is the one to reach for: name the component's
   * box in the footage and the magnification follows from it. `k`/`dx` frame
   * by panning a barely-magnified page, which is how our first cut left the
   * settings drawer at 32% of frame width against the reference's 80-90%.
   * See src/lib/crop.ts.
   *
   * Authored per clip because nothing in the click log says which component
   * a shot is about — but the click RECTS do say where that component is, so
   * a `rect` can be read off them rather than guessed.
   */
  crop?: CropSpec;
  /** Entrance/exit push; absent = the style's own shot arrival, if any. */
  push?: PushSpec;
  /** Colour behind the plate if the crop leaves a gap. Full-bleed only (checked). */
  pageBg?: string;
  /**
   * Draw the synthetic pointer. Honoured by every framing: absent = OFF
   * full-bleed, the style's `shot.cursor` windowed.
   *
   * Turn it ON for any mouse-driven flow. The reference film hides the pointer
   * because its feature is keyboard-driven; over a flow that clicks, a hidden
   * pointer shows the UI reacting to nothing.
   */
  cursor?: boolean;
  /**
   * Draw the pointer's click ripple. Absent = OFF full-bleed, the style's
   * `shot.ripple` windowed.
   *
   * Neither reference film has one — the feedback is the real control's own
   * press state, which the capture already records. Turn it on only for a
   * target with no visible press state of its own.
   */
  ripple?: boolean;
  /**
   * Hold this range's LAST frame for the range's length: a still of the end
   * state, with no pointer. Full-bleed only (checked).
   *
   * The reference film spends one shot in eleven perfectly frozen, directly
   * before the recap — 95 frames on which nothing crosses the motion
   * threshold. It is the only place the film stops, and having somewhere to
   * stop is what its otherwise metronomic cutting needs.
   *
   * A still does not play, so it is exempt from the ranges-move-forward rule
   * below on the same grounds as a cold open: it cannot read as a jump cut
   * backwards. What it must not do is show a state OLDER than the shot before
   * it, and that is checked.
   */
  freeze?: boolean;
  /**
   * The first frame's framing: `{ scale, at }`, eased into the style's own.
   * State it wherever a cut is meant to MATCH — a card that punches into a
   * control, cut to the clip that presses it. See src/lib/open.ts.
   */
  open?: ClipOpen;
};

/** A clip whose range is resolved to seconds — what everything downstream reads. */
export type ReelClip = {
  clip: ClipRange & Omit<ClipFields, "open"> & { open?: ResolvedOpen };
};
/** A clip as authored in reels/<name>.ts. See ClipAnchors. */
export type ReelClipInput = { clip: ClipAnchors & ClipFields };

/**
 * How a segment arrives from the one before it, overriding its style's default.
 *
 * `segments[0].join` is meaningless — nothing precedes it — and is ignored.
 *
 * Exists because a dissolving style should not dissolve EVERYTHING. monid has
 * ~4 boundaries and blends 2, both between sections; cross-fading a card into
 * live UI on every join reads as muddy. So a ledger reel cuts by default within
 * a section and asks for the blend where a section changes.
 */
export type SegmentJoin = "cut" | "dissolve";

/**
 * Tuning for the step HUD, when the style draws one.
 *
 * The steps derive from the click log for free, which is the point — but a flow
 * is labelled for the RECORDER, so some of its beats are plumbing. On the
 * schedule flow, "open cadence", "close cadence" and "open 09:00" are internal
 * moves the viewer does not need named, and a line that narrates all nine reads
 * as a click log rather than the three-or-four-step summary the reference
 * shows.
 *
 * A blacklist rather than a whitelist on purpose: the derived list stays the
 * default, so a reel that says nothing still gets a HUD, and adding a beat to
 * the flow does not silently drop it from the film.
 */
export type ReelHud = {
  /** Drop beats whose label contains any of these (case-insensitive). */
  skipLabels?: string[];
};

/** A resolved segment: every clip range in seconds. */
export type ReelSegment = (ReelCard | ReelClip) & { join?: SegmentJoin };
/** A segment as authored — a clip may still carry beat anchors. */
export type ReelSegmentInput = (ReelCard | ReelClipInput) & { join?: SegmentJoin };

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
  /** Path under public/, e.g. "audio/intro.mp3" (the committed stock lives in public/audio/). */
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
  /** The reel's own name: reels/<name>.ts -> out/reel/<name>.mp4. */
  name: string;
  /**
   * The demo the clips are cut from — public/<demo>.mp4, its click log, and
   * out/demo/<demo>.mp4. Absent = `name`.
   *
   * Exists so one demo can be cut into several films. Before it, the reel's
   * name WAS the demo's, and the only way to cut agent-schedule a second time
   * was to byte-copy its footage under a new name.
   */
  demo?: string;
  segments: ReelSegmentInput[];
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
  /**
   * Land every cut out of a card on a beat of the bed: each card's length is
   * nudged by at most ±2 frames toward the nearest onset in the `role: "bed"`
   * audio (src/lib/beats.ts). Absent = off. `--check` reports the hits.
   */
  snapToBeats?: boolean;
  /** Step-HUD tuning. Only read when the style draws one. */
  hud?: ReelHud;
  /**
   * Floating annotation chips, each anchored to a segment (`from: { segment,
   * atS }` or `{ segment, beat }`), cut to that shot's visible span and riding
   * its push. Only drawn when the style defines an `annotation` look.
   *
   * AUTHORED, unlike the step HUD, which is derived from the click log. A chip
   * names something the footage does not say out loud, so no recording carries
   * it — see src/lib/chips.ts.
   */
  chips?: ReelChipInput[];
  /**
   * A brand pack id (src/lib/brand.ts): every card and clip takes its look —
   * grounds, inks, faces, logo, the window's flat ground — from the pack, and
   * its motion from the style. Absent = the style's own look, as before.
   */
  brand?: string;
  /**
   * The window's ground (hex) and where its camera works, over the style and
   * the brand (see WindowSpec). Absent = theirs, as before.
   */
  window?: WindowSpec;
  /**
   * How it renders: output size as a share of the 2560-wide composition
   * (0.75 = 1920x1080), and whether clips draw the camera shutter. Absent =
   * full size with the shutter, as before.
   */
  render?: ReelRender;
  /** Visual treatment of the footage. Absent = "framed", i.e. unchanged. */
  look?: ReelLook;
  /**
   * The choreography grammar this reel is cut in — motion AND look together.
   *
   * Absent falls back to `look`, and then to the default, so every reel written
   * before styles existed renders unchanged. A card may override it. See
   * src/lib/style.ts, and docs/reel/design/choreography-styles.md.
   */
  style?: ReelStyle;
  /**
   * Output aspect: "16:9" (absent), "1:1" or "9:16". Every other aspect is a
   * moving crop of the 16:9 footage that follows the clicks; cards reflow. The
   * CLI's `--aspect=` overrides it. See src/lib/aspect.ts.
   */
  aspect?: Aspect;
};

/** A reel after resolveReel: every clip range is plain seconds. */
export type ResolvedReel = Omit<Reel, "segments"> & { segments: ReelSegment[] };

export { STYLES, type ReelStyle } from "./style";

export const defineReel = (reel: Reel): Reel => reel;

/** The demo a reel cuts from. */
export const reelDemo = (reel: Pick<Reel, "name" | "demo">): string =>
  reel.demo ?? reel.name;

/** Longest a leading clip can be and still read as a tease rather than a scene. */
export const COLD_OPEN_MAX_S = 1.2;

export const isCard = <S extends ReelSegmentInput>(
  s: S,
): s is Extract<S, ReelCard> => "card" in s;
export const isClip = <S extends ReelSegmentInput>(
  s: S,
): s is Extract<S, { clip: unknown }> => "clip" in s;

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
  /** The demo's frames; or, per recording, a lookup by demo name (see ClipFields.demo). */
  totalFrames?: number | ((demo: string) => number | undefined),
  fps = FPS,
  opts: { framing?: boolean } = {},
): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const reel = value as Partial<Reel>;
  if (typeof reel.name !== "string" || reel.name === "")
    return "missing a `name`";
  if (!Array.isArray(reel.segments) || reel.segments.length === 0)
    return "has no `segments`";
  if (reel.look !== undefined && !LOOKS.includes(reel.look))
    return `look must be one of ${LOOKS.join(", ")}`;
  const badStyle = styleProblem({ style: reel.style, look: reel.look });
  if (badStyle) return badStyle;
  if (reel.brand !== undefined) {
    const badBrand = brandProblem(reel.brand);
    if (badBrand) return `\`brand\`: ${badBrand}`;
  }
  if (reel.render !== undefined) {
    const badRender = renderProblem(reel.render);
    if (badRender) return `\`render\`: ${badRender}`;
  }
  if (reel.window !== undefined) {
    const badWindow = windowProblem(reel.window);
    if (badWindow) return `\`window\`: ${badWindow}`;
  }
  if (reel.demo !== undefined && (typeof reel.demo !== "string" || reel.demo === ""))
    return "`demo` must be a non-empty string (the demo's name)";
  if (reel.aspect !== undefined && !isAspect(reel.aspect))
    return `aspect must be one of ${ASPECTS.join(", ")}`;

  const style = resolveStyle({ style: reel.style, look: reel.look });
  const shot = STYLE_PRESETS[style].shot;
  const cold = coldOpenIndex(reel.segments as ReelSegment[]);
  let previousLast = -1;
  let orderDemo: string | undefined;
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
    if (segment.clip.open !== undefined) {
      const bad = openProblem(segment.clip.open);
      if (bad) return `${at} (clip) ${bad}`;
      if (typeof segment.clip.open.at === "string")
        return `${at} (clip) \`open.at\` "${segment.clip.open.at}" was not resolved to a point — run resolveReel first`;
    }
    if (segment.clip.demo !== undefined && (typeof segment.clip.demo !== "string" || segment.clip.demo === ""))
      return `${at} (clip) \`demo\` must be a recording's name`;
    if (segment.clip.demo !== undefined && reel.aspect !== undefined && !isNativeAspect(reel.aspect))
      return `${at} (clip) \`demo\` is for the native aspect only; ${reel.aspect} crops from one recording`;
    if (opts.framing !== false) {
      const ignored = ignoredClipFields(segment.clip, shot);
      if (ignored.length) return `${at} (clip) ${framingMessage(ignored, style, shot)}`;
    }
    if (!(toS > fromS)) return `${at} (clip) ends at or before it starts`;
    if (fromS < 0) return `${at} (clip) starts before the demo does`;
    const { first, last } = clipFrames(segment.clip, fps);
    const demo = segment.clip.demo ?? reelDemo(reel as Pick<Reel, "name" | "demo">);
    const total =
      typeof totalFrames === "function" ? totalFrames(demo) : segment.clip.demo ? undefined : totalFrames;
    if (total != null && last >= total)
      return (
        `${at} (clip) ends at frame ${last}, but the demo has ${total} ` +
        `frames (0-${total - 1})`
      );
    // Each recording keeps its own clock: order is checked within one.
    if (demo !== orderDemo) {
      orderDemo = demo;
      previousLast = -1;
    }
    // Out-of-order ranges are almost always a typo, and they play as a jump cut
    // backwards in time. Deliberate reordering is rare enough to be worth
    // failing on until someone actually wants it — with one exception, the cold
    // open, which neither reads nor advances the high-water mark.
    if (segment.clip.freeze) {
      // A still holds ONE frame, so "starts before the last shot ended" is
      // meaningless for it — but "shows an older state than the last shot" is
      // not, and would play as the product un-doing itself.
      if (last < previousLast)
        return (
          `${at} (clip) freezes frame ${last}, which the previous clip had ` +
          `already passed (it ended at ${previousLast})`
        );
      previousLast = last;
    } else if (i !== cold) {
      if (first <= previousLast)
        return `${at} (clip) starts at or before the previous clip ended`;
      previousLast = last;
    }
  }
  if (reel.audio !== undefined) {
    // Shape only. `totalFrames` is the DEMO's length, not the reel's, so it
    // cannot bound where a piece starts: the cut checks that with
    // audioPlacementProblem once its own runtime is known.
    const problem = audioProblem(reel.audio, undefined, fps, reel.segments.length);
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
  if (reel.snapToBeats !== undefined) {
    if (typeof reel.snapToBeats !== "boolean") return "`snapToBeats` must be a boolean";
    if (reel.snapToBeats && !(reel.audio ?? []).some((p) => p?.role === "bed"))
      return "`snapToBeats` needs an audio piece with `role: \"bed\"` to find beats in";
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

/**
 * Shape check for `reel.audio`, mirroring reelProblem's return-a-string style.
 * Exported so it can be unit-tested on its own. `totalFrames` is the REEL's
 * length when known (never the demo's) and bounds a numeric start to inside it
 * — a piece that begins after the reel ends is inaudible and almost always a
 * typo; an overrun past the END is fine (the mux truncates it), so it is not
 * checked here. reel-audio.ts's audioPlacementProblem also resolves anchors.
 */
export function audioProblem(
  value: unknown,
  totalFrames?: number,
  fps = FPS,
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

// ---------------------------------------------------------------------------
// Framing: which clip fields the resolved style can honour
// ---------------------------------------------------------------------------

/**
 * Clip fields the style's FRAMING would silently drop.
 *
 * A windowed style renders footage through DemoClip's framed path, which reads
 * `push`, `cursor`, `ripple` and — only while its zoom camera runs — `drift`.
 * It has no static crop, no plate behind one and no still, so `crop`,
 * `pageBg` and `freeze` do nothing there: a `freeze` on a classic clip just
 * played. The full-bleed path has no camera, so it cannot drift.
 *
 * Returned rather than thrown so a `--style=` override can print them as
 * warnings: cutting a proof reel in `stage` to compare is legitimate, and its
 * crops are expected to fall away.
 */
export function ignoredClipFields(clip: ClipFields, shot: ShotStyle): string[] {
  const out: string[] = [];
  if (shot.framing === "window") {
    for (const k of ["crop", "pageBg", "freeze"] as const)
      if (clip[k] !== undefined && clip[k] !== false) out.push(k);
    if (clip.drift !== undefined && !shot.zoom) out.push("drift");
  } else if (clip.drift !== undefined) {
    out.push("drift");
  }
  return out;
}

/** "sets `crop`, which the "stage" style ignores (...)" — one sentence. */
export function framingMessage(
  fields: string[],
  style: ReelStyle,
  shot: ShotStyle,
): string {
  const names = fields.map((f) => `\`${f}\``).join(", ");
  const why =
    shot.framing === "window"
      ? shot.zoom
        ? "its footage is a window driven by the click-log camera"
        : "its footage is a window with no camera"
      : "its footage is full-bleed with no camera";
  return (
    `sets ${names}, which the "${style}" style ignores (${why}). Remove ` +
    `${fields.length > 1 ? "them" : "it"}, or cut this reel in a style that reads ` +
    `${fields.length > 1 ? "them" : "it"}.`
  );
}

// ---------------------------------------------------------------------------
// Beat anchors
// ---------------------------------------------------------------------------

/**
 * A click-log beat's press, in seconds of the rendered demo — the frame the
 * picture draws it on (logMsToDemoS). This was `t / speed - offset`, which
 * disagreed with the picture by offset x (1 + 1/speed) whenever offsetMs was
 * not 0: 900 ms early at 500 ms and 1.25x.
 */
export function beatDemoS(
  beat: { tMs: number; tDownMs?: number },
  log: Pick<ClickLog, "offsetMs">,
  speed: number,
): number {
  return logMsToDemoS(beat.tDownMs ?? beat.tMs, log, speed);
}

const s2 = (x: number): string => x.toFixed(2);

/**
 * The demo second a beat anchor names, or a sentence saying why it names none.
 *
 * Exact label, case-insensitive. `"label#n"` picks the n-th (1-based) beat
 * carrying that label; a bare label carried by several beats is ambiguous and
 * the error lists every one with its time. A miss lists near misses (labels
 * containing the text) or, failing that, every label in the log.
 */
export function findBeat(
  anchor: string,
  log: ClickLog,
  speed: number,
): { s: number } | { problem: string } {
  const hit = findBeatEvent(anchor, log, speed);
  return "problem" in hit ? hit : { s: beatDemoS(hit.beat, log, speed) };
}

/** findBeat, returning the click-log beat itself rather than its second. */
export function findBeatEvent(
  anchor: string,
  log: ClickLog,
  speed: number,
): { beat: ClickLog["clicks"][number] } | { problem: string } {
  const m = /^(.*?)#(\d+)$/.exec(anchor);
  const want = (m ? m[1] : anchor).trim().toLowerCase();
  const nth = m ? Number(m[2]) : null;
  const hits = log.clicks.filter((b) => b.label?.trim().toLowerCase() === want);
  const at = (b: ClickLog["clicks"][number]) =>
    `"${b.label}" at ${s2(beatDemoS(b, log, speed))}s`;
  if (hits.length === 0) {
    const near = log.clicks.filter((b) => b.label?.toLowerCase().includes(want));
    const pool = near.length ? near : log.clicks.filter((b) => b.label);
    return {
      problem:
        `no beat is labelled "${anchor}". ` +
        `${near.length ? "Near misses" : "Labels in the log"}: ` +
        (pool.length ? pool.map(at).join(", ") : "none — the log has no labelled beats"),
    };
  }
  if (nth != null) {
    if (nth < 1 || nth > hits.length)
      return {
        problem: `"${anchor}" asks for occurrence ${nth}, but the label occurs ${hits.length} time(s): ${hits.map(at).join(", ")}`,
      };
    return { beat: hits[nth - 1] };
  }
  if (hits.length > 1)
    return {
      problem:
        `"${anchor}" is ambiguous — ${hits.length} beats carry it: ` +
        hits.map((b, i) => `#${i + 1} at ${s2(beatDemoS(b, log, speed))}s`).join(", ") +
        `. Name one, e.g. "${anchor}#2".`,
    };
  return { beat: hits[0] };
}

/** One authored range -> seconds, or a sentence. */
export function resolveClipRange(
  clip: ClipAnchors,
  log: ClickLog,
  speed: number,
): ClipRange | { problem: string } {
  const num = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
  for (const k of ["fromS", "toS", "leadS", "tailS"] as const)
    if (!num(clip[k])) return { problem: `\`${k}\` must be a number of seconds` };
  for (const k of ["fromBeat", "toBeat"] as const)
    if (clip[k] !== undefined && (typeof clip[k] !== "string" || clip[k] === ""))
      return { problem: `\`${k}\` must be a click-log label` };
  if (clip.fromS === undefined && clip.fromBeat === undefined)
    return { problem: "needs `fromS` or `fromBeat`" };
  if (clip.leadS !== undefined && clip.fromBeat === undefined)
    return { problem: "`leadS` offsets `fromBeat`, which is not set" };
  if (clip.toEdge !== undefined && !CLIP_EDGES.includes(clip.toEdge))
    return { problem: `\`toEdge\` must be one of ${CLIP_EDGES.join(", ")}` };

  let fromS = clip.fromS;
  if (clip.fromBeat !== undefined) {
    const hit = findBeat(clip.fromBeat, log, speed);
    if ("problem" in hit) return { problem: `fromBeat: ${hit.problem}` };
    fromS ??= hit.s + (clip.leadS ?? 0);
  }

  let toS = clip.toS;
  if (toS === undefined) {
    if (clip.toBeat === undefined && clip.tailS === undefined)
      return { problem: "needs `toS`, `toBeat` or `tailS` to say where it ends" };
    const endLabel = clip.toBeat ?? clip.fromBeat;
    if (endLabel === undefined)
      return { problem: "`tailS` offsets `toBeat` (or `fromBeat`), and neither is set" };
    const key = clip.toBeat !== undefined ? "toBeat" : "fromBeat";
    const hit = findBeatEvent(endLabel, log, speed);
    if ("problem" in hit) return { problem: `${key}: ${hit.problem}` };
    let endBeatS = beatDemoS(hit.beat, log, speed);
    if (clip.toEdge === "typeEnd") {
      if (hit.beat.typeEndMs === undefined)
        return {
          problem:
            `\`toEdge: "typeEnd"\` needs a typing beat, but "${endLabel}" types nothing ` +
            `(no typeEndMs in the click log). End it on its press instead.`,
        };
      endBeatS = logMsToDemoS(hit.beat.typeEndMs, log, speed);
    }
    toS = endBeatS + (clip.tailS ?? 0);
  }
  return { fromS: fromS!, toS };
}

/**
 * Every clip range resolved to seconds, or the first reason one cannot be.
 *
 * Pure: the click log and the playback rate are all it needs, so it runs — and
 * fails — before anything renders. Plain-second clips pass through untouched,
 * so a reel with no anchors resolves to itself.
 */
/** A recording's click log by demo name, or null when it has none. */
export type ReelLogs = (demo: string) => ClickLog | null;

/**
 * The reel's own click log carrying its scenes' logs (ClipFields.demo), so
 * everything that reads clips against a log (anchors, SFX, label checks) can
 * find each clip's without a second parameter threaded through it.
 */
export type ReelClickLog = ClickLog & { scenes?: ReelLogs };

/** The log a clip is read against: its own recording's, or the reel's. */
export function clipLog(log: ReelClickLog, clip: { demo?: string }): ClickLog {
  if (clip.demo === undefined) return log;
  const own = log.scenes?.(clip.demo);
  if (!own) throw new Error(`a clip cuts from "${clip.demo}", but its click log was not loaded`);
  return own;
}

export function resolveReel(
  reel: Reel,
  log: ReelClickLog,
  speed: number,
  /** For clips cut from their own recording (ClipFields.demo). Default: log.scenes. */
  logs: ReelLogs | undefined = log.scenes,
): { reel: ResolvedReel } | { problem: string } {
  if (!Array.isArray(reel.segments)) return { problem: "has no `segments`" };
  const segments: ReelSegment[] = [];
  for (let i = 0; i < reel.segments.length; i++) {
    const seg = reel.segments[i];
    if (!isClip(seg)) {
      segments.push(seg as ReelSegment);
      continue;
    }
    if (typeof seg.clip !== "object" || seg.clip === null)
      return { problem: `segment ${i + 1} (clip) is not an object` };
    const own = seg.clip.demo !== undefined ? (logs?.(seg.clip.demo) ?? null) : log;
    if (!own)
      return { problem: `segment ${i + 1} (clip) cuts from "${seg.clip.demo}", which has no click log: record and convert it first` };
    const r = resolveClipRange(seg.clip, own, speed);
    if ("problem" in r) return { problem: `segment ${i + 1} (clip) ${r.problem}` };
    // The anchors are spent: downstream reads seconds only, and the cache key
    // hashes the resolved range, so a re-shoot that moves a beat re-renders.
    const { open, ...fields }: ClipFields & ClipAnchors = { ...seg.clip };
    for (const k of ["fromBeat", "leadS", "toBeat", "tailS", "toEdge"] as const) delete fields[k];
    // An opening's beat resolves to its control's centre here, with the range,
    // so DemoClip and the cache key see a point and a re-shoot that moves the
    // control re-renders the clip.
    let resolvedOpen: ResolvedOpen | undefined;
    if (open !== undefined) {
      const bad = openProblem(open);
      if (bad) return { problem: `segment ${i + 1} (clip) ${bad}` };
      let at = { x: 0.5, y: 0.5 };
      let rect: ResolvedOpen["rect"];
      if (typeof open.at === "string") {
        const hit = findBeatEvent(open.at, own, speed);
        if ("problem" in hit) return { problem: `segment ${i + 1} (clip) open.at: ${hit.problem}` };
        at = beatPoint(hit.beat, own.viewport);
        // The control's box too, so the opening can keep all of it in shot.
        rect = beatRect(hit.beat, own.viewport);
      } else if (open.at) {
        at = open.at;
      }
      resolvedOpen = { ...open, at, ...(rect ? { rect } : {}) };
    }
    segments.push({
      ...seg,
      clip: {
        ...fields,
        ...(resolvedOpen ? { open: resolvedOpen } : {}),
        fromS: r.fromS,
        toS: r.toS,
      },
    });
  }
  return { reel: { ...reel, segments } };
}

// ---------------------------------------------------------------------------
// Timeline: what the finished film will measure, before it is rendered
// ---------------------------------------------------------------------------

/** How long a dissolve lasts when a segment asks for one its style lacks. */
export const DEFAULT_DISSOLVE_F = 6;

/**
 * One entry per BOUNDARY: joins[i] joins segment i to segment i+1, in frames
 * (0 = cut). A segment's own `join` overrides its style's, so a dissolving
 * style can still cut inside a section and blend only where a section changes
 * — which is what the reference does. See SegmentJoin.
 */
export function segmentJoins(
  segments: ReelSegmentInput[],
  styleJoin: ShotJoin,
): number[] {
  const styleF = styleJoin.kind === "dissolve" ? styleJoin.frames : 0;
  return segments.slice(1).map((seg) => {
    if (seg.join === "cut") return 0;
    if (seg.join === "dissolve") return styleF || DEFAULT_DISSOLVE_F;
    return styleF;
  });
}

/** How a join with frames > 0 blends: a cross-fade, or an exit overlap. */
export type JoinBlend = "fade" | "overlap";

/** A segment's exit as it will RENDER, when it travels; undefined otherwise. */
function renderedExit(
  seg: ReelSegmentInput,
  preset: StylePreset,
): { axis: string; dist: number; frames: number } | undefined {
  let exit: { axis: string; dist?: number; frames?: number } | undefined;
  if (isCard(seg)) {
    // A recap or chip card does not travel on the push envelope.
    if (seg.card.items?.length || seg.card.chip !== undefined) return undefined;
    const own = seg.card.exit;
    const style = preset.card.exit.kind === "push" ? preset.card.exit : undefined;
    exit = own
      ? { axis: own.axis, dist: own.dist ?? style?.dist, frames: own.frames ?? style?.frames }
      : style;
  } else if (isClip(seg)) {
    if (seg.clip.freeze) return undefined;
    const push = seg.clip.push;
    const shot = preset.shot.exit.kind === "push" ? preset.shot.exit : undefined;
    // The `shots`-layer default scripts/lib/reel-cut.ts supplies (presetShotPush).
    exit = push ? push.out : preset.motionLayer === "shots" ? shot : undefined;
  }
  if (!exit || exit.axis === "none" || !exit.dist || !exit.frames) return undefined;
  return { axis: exit.axis, dist: exit.dist, frames: exit.frames };
}

/**
 * `joins` with every CUT after a directional exit turned into an overlap of
 * `sequence.overlapExitF` frames (capped at the exit's own length), and the
 * blend of every boundary. See SequenceStyle.overlapExitF.
 *
 * Only cuts become overlaps: an authored or style dissolve keeps its fade, and
 * a segment that says `join: "cut"` keeps its cut — that is the opt-out. The
 * overlap lives in the SAME join list a dissolve does, so the runtime, the
 * segment bounds, the SFX and the HUD all account for it without knowing.
 */
export function overlapJoins(
  segments: ReelSegmentInput[],
  joins: number[],
  preset: StylePreset,
): { joins: number[]; blends: JoinBlend[] } {
  const f = preset.sequence.overlapExitF;
  const blends: JoinBlend[] = joins.map(() => "fade");
  if (!(f > 0)) return { joins, blends };
  const out = joins.map((j, i) => {
    if (j > 0 || segments[i + 1]?.join === "cut") return j;
    const exit = renderedExit(segments[i], preset);
    if (!exit) return j;
    blends[i] = "overlap";
    return Math.min(f, exit.frames);
  });
  return { joins: out, blends };
}

/** See Reel.render. */
export type ReelRender = { scale?: number; motionBlur?: boolean };

/** Why a reel's render settings cannot be honoured, or null. */
function renderProblem(render: ReelRender): string | null {
  if (typeof render !== "object" || render === null) return "must be an object";
  const extra = Object.keys(render).filter((k) => k !== "scale" && k !== "motionBlur");
  if (extra.length) return `unknown field ${extra.map((k) => `\`${k}\``).join(", ")}`;
  if (render.scale !== undefined && !(typeof render.scale === "number" && render.scale > 0 && render.scale <= 1))
    return "`scale` must be a number in (0, 1]";
  if (render.motionBlur !== undefined && typeof render.motionBlur !== "boolean")
    return "`motionBlur` must be true or false";
  return null;
}

/** Why a reel's window cannot be drawn, or null. */
function windowProblem(window: WindowSpec): string | null {
  if (typeof window !== "object" || window === null) return "must be an object";
  const extra = Object.keys(window).filter((k) => k !== "ground" && k !== "camera");
  if (extra.length) return `unknown field ${extra.map((k) => `\`${k}\``).join(", ")}`;
  if (window.ground !== undefined && !/^#[0-9a-f]{6}$/i.test(window.ground))
    return "`ground` must be a #rrggbb colour";
  if (window.camera !== undefined && window.camera !== "window" && window.camera !== "inside")
    return '`camera` must be "window" or "inside"';
  return null;
}

/**
 * The storyboard a card renders with: the reel's look/style unless the card
 * overrides them, and the DEMO's name, because a card takes its size from
 * public/<name>.clicks.json and has to match the clips it is concatenated
 * with. (A reel card's `name` has no other use.)
 */
export function reelCard(
  reel: Pick<Reel, "name" | "demo" | "look" | "style" | "brand">,
  card: IntroStoryboard,
): IntroStoryboard {
  return {
    ...(reel.look ? { look: reel.look } : {}),
    ...(reel.style ? { style: reel.style } : {}),
    ...(reel.brand ? { brand: reel.brand } : {}),
    ...card,
    name: reelDemo(reel),
  };
}

/**
 * `card` re-timed to render exactly `frames` longer (or shorter), by its
 * `holdS` — or null when it has no hold to give.
 *
 * Every card's length is linear in its hold once the hold is authored (an
 * authored hold opts out of the style's floors, see introTiming), so the hold
 * is solved for, not searched: the length at hold 0, plus the difference,
 * aimed at the middle of the target frame so ceil() cannot tip it over. The
 * result is checked, never trusted.
 */
export function nudgeCard(
  reel: Pick<Reel, "name" | "demo" | "look" | "style">,
  card: IntroStoryboard,
  frames: number,
  fps: number,
): IntroStoryboard | null {
  if (frames === 0) return card;
  const target = introDurationInFrames(reelCard(reel, card), fps) + frames;
  const zeroS = introTiming(reelCard(reel, { ...card, holdS: 0 })).totalS;
  const holdS = Number(((target - 0.5) / fps - zeroS).toFixed(4));
  if (!(holdS >= 0)) return null;
  const out = { ...card, holdS };
  return introDurationInFrames(reelCard(reel, out), fps) === target ? out : null;
}

/** Frames each segment will render to, without rendering it. */
export function segmentFrameCounts(reel: ResolvedReel, fps: number): number[] {
  return reel.segments.map((seg) =>
    isCard(seg)
      ? introDurationInFrames(reelCard(reel, seg.card), fps)
      : clipFrameCount(seg.clip, fps),
  );
}

export type Pacing = {
  runtimeS: number;
  shots: number;
  meanShotS: number;
  /** Boundaries per minute of film, dissolves included. */
  cutsPerMin: number;
  dissolves: number;
  /** Share of the film's frames that are clips / cards. */
  clipShare: number;
  cardShare: number;
};

/** The numbers a style's `targets` are written in. */
export function pacing(
  segments: ReelSegment[],
  counts: number[],
  joins: number[],
  fps: number,
): Pacing {
  const raw = counts.reduce((a, b) => a + b, 0);
  const runtimeF = raw - joins.reduce((a, b) => a + b, 0);
  const runtimeS = runtimeF / fps;
  const clipF = counts.reduce((a, c, i) => a + (isClip(segments[i]) ? c : 0), 0);
  const shots = counts.length;
  return {
    runtimeS,
    shots,
    meanShotS: shots ? runtimeS / shots : 0,
    cutsPerMin: runtimeS > 0 ? ((shots - 1) / runtimeS) * 60 : 0,
    dissolves: joins.filter((j) => j > 0).length,
    clipShare: raw ? clipF / raw : 0,
    cardShare: raw ? 1 - clipF / raw : 0,
  };
}
