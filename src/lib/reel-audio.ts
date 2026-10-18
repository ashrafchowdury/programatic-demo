/**
 * Reel audio — placement math and ffmpeg-filtergraph assembly.
 *
 * Pure by design: no ffmpeg, no fs, no Remotion (same discipline as reel.ts), so
 * every number and every filter string is unit-testable without spawning
 * anything. scripts/reel.ts probes durations, runs the graph on the SYSTEM
 * ffmpeg, and muxes — see docs/reel/design/audio.md.
 *
 * Audio is one post-concat pass: the finished silent reel is input 0, each piece
 * is a later input trimmed at the input level, and a single `-filter_complex`
 * places (adelay), levels (volume), fades (afade) and mixes (amix) them.
 */
import { logMsToDemoS, type ClickEvent, type ClickLog } from "./click-log";
import {
  coldOpenIndex,
  isClip,
  type ReelAnchor,
  type ReelAudioPiece,
  type ReelDuck,
  SFX_KINDS,
  type ReelSegment,
  type ReelSfx,
  type SfxCue,
  type SfxKind,
} from "./reel";

/** Reel-time start and duration of every segment, in seconds. */
export type SegmentBounds = { startS: number[]; durS: number[] };

/**
 * Prefix-sum the per-segment frame counts into reel-second boundaries.
 *
 * `overlaps` is the dissolve length of each JOIN — one entry per boundary, so
 * `overlaps[i-1]` precedes segment i. Segment i pulls earlier by the SUM of
 * every join before it. A list rather than one number because a style may blend
 * only some of its boundaries. Empty for a cutting style, which is every reel
 * on disk.
 *
 * This has to agree with dissolvedStarts in scripts/lib/xfade.ts, which drives
 * the PICTURE while this drives SFX placement. xfade.test.ts asserts they do:
 * if they drift, every tick fires progressively later than its own footage.
 */
export function segmentBoundsSeconds(
  counts: number[],
  fps: number,
  overlaps: number[] = [],
): SegmentBounds {
  const startS: number[] = [];
  const durS: number[] = [];
  let acc = 0;
  let eaten = 0;
  for (let i = 0; i < counts.length; i++) {
    if (i > 0) eaten += overlaps[i - 1] ?? 0;
    startS.push((acc - eaten) / fps);
    durS.push(counts[i] / fps);
    acc += counts[i];
  }
  return { startS, durS };
}

/** A placement value → reel seconds: a number passes through; an anchor snaps. */
export function resolveAnchor(
  a: number | ReelAnchor,
  bounds?: SegmentBounds,
): number {
  if (typeof a === "number") return a;
  if (!bounds || bounds.startS.length === 0) return 0;
  const i = Math.max(0, Math.min(a.segment, bounds.startS.length - 1));
  return bounds.startS[i] + (a.edge === "end" ? bounds.durS[i] : 0);
}

/** A piece with every field resolved to a concrete on-timeline number. */
export type ResolvedPiece = {
  src: string;
  /** Seconds into the source file to start reading. */
  sourceFromS: number;
  /** Trimmed source length available to read. */
  availS: number;
  /** Reel second the piece begins. */
  startS: number;
  /** Effective on-timeline length (> 0). */
  durationS: number;
  gain: number;
  fadeInS: number;
  fadeOutS: number;
  pad: boolean;
  /** Mixing role — drives ducking. Authored pieces default to "lead". */
  role: "bed" | "lead" | "sfx";
  /** Crossfade in from the previous piece over this many seconds (0 = none). */
  crossfadePrevS: number;
};

/** Delivery sample rate. Every piece is resampled to it and the mux writes it. */
export const SAMPLE_RATE = 48000;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** ffmpeg-friendly number: no scientific notation, no trailing zeros. */
const n = (x: number): string => String(Number(x.toFixed(6)));

/**
 * Resolve one authored piece against the reel length and the source's own
 * duration (probed by the caller). Every output is a concrete number so the
 * fades and the mix length are exact — a whole-file piece with a fade-out needs
 * to know where its end is, which only the source duration gives.
 */
export function resolvePiece(
  piece: ReelAudioPiece,
  totalReelS: number,
  sourceDurS: number,
  bounds?: SegmentBounds,
): ResolvedPiece {
  const startS = clamp(resolveAnchor(piece.start ?? 0, bounds), 0, totalReelS);
  const endS = piece.end != null ? resolveAnchor(piece.end, bounds) : null;
  const sourceFromS = clamp(piece.trim?.fromS ?? 0, 0, sourceDurS);
  const sourceToS =
    piece.trim?.toS != null
      ? clamp(piece.trim.toS, sourceFromS, sourceDurS)
      : sourceDurS;
  const availS = Math.max(0, sourceToS - sourceFromS);
  const reelRoom = Math.max(0, totalReelS - startS);

  // Requested footprint on the reel timeline.
  let spanS: number;
  if (piece.duration != null) spanS = piece.duration;
  else if (endS != null) spanS = Math.max(0, endS - startS);
  else spanS = piece.pad ? reelRoom : availS;

  // Without pad, a piece cannot outlast its own (trimmed) source.
  const wantS = piece.pad ? spanS : Math.min(spanS, availS);
  const durationS = Math.max(0, Math.min(wantS, reelRoom));
  // A zero-length piece used to be dropped by the mux without a word, so a
  // start past the end or a trim past the file shipped a reel without its bed
  // — possibly a silent one. audioPlacementProblem catches the reel-side cases
  // before anything renders; this catches the ones only the source length
  // reveals.
  if (!(durationS > 0))
    throw new Error(
      `audio "${piece.src}" resolves to zero length: it starts at ${n(startS)}s ` +
        `of a ${n(totalReelS)}s reel with ${n(availS)}s of source after its trim` +
        `${piece.duration === 0 ? " and `duration: 0`" : ""}. Fix its start, trim or length.`,
    );

  return {
    src: piece.src,
    sourceFromS,
    availS,
    startS,
    durationS,
    gain: piece.gain ?? 1,
    // Fades cannot exceed the piece; a longer authored fade is clamped.
    fadeInS: Math.min(Math.max(0, piece.fadeInS ?? 0), durationS),
    fadeOutS: Math.min(Math.max(0, piece.fadeOutS ?? 0), durationS),
    pad: piece.pad ?? false,
    role: piece.role ?? "lead",
    crossfadePrevS: Math.max(0, piece.crossfadePrevS ?? 0),
  };
}

/**
 * The first authored piece that cannot sound in THIS reel, or null.
 *
 * Needs the reel's own runtime and segment bounds, so it runs once the cut's
 * frame counts are known — not in reelProblem, which only knows the demo's
 * length and used to bound `start` by that (a 30 s demo, a 20 s reel: a start
 * at 25 s passed and then placed nothing). Anchors are resolved exactly as the
 * mux resolves them.
 */
export function audioPlacementProblem(
  audio: ReelAudioPiece[] | undefined,
  totalReelS: number,
  bounds: SegmentBounds,
): string | null {
  for (let i = 0; i < (audio ?? []).length; i++) {
    const piece = audio![i];
    const at = `audio[${i}] ("${piece.src}")`;
    // A crossfaded piece's own start is ignored; the fade places it.
    if (!(piece.crossfadePrevS && i > 0)) {
      const startS = resolveAnchor(piece.start ?? 0, bounds);
      if (startS >= totalReelS - 1e-6)
        return (
          `${at} starts at ${s2(startS)}s, at or after the reel ends ` +
          `(${s2(totalReelS)}s), so it would place no sound`
        );
      if (piece.end != null && resolveAnchor(piece.end, bounds) <= startS + 1e-6)
        return `${at} ends at or before it starts (${s2(startS)}s)`;
    }
    if (piece.duration === 0) return `${at} has \`duration: 0\`, so it would place no sound`;
  }
  return null;
}

/** One beat that lands inside a playing clip: where it is, and which clip. */
export type CueHit = {
  /** Segment index of the clip the beat plays in. */
  segment: number;
  /** When it sounds, in seconds of the rendered demo. */
  demoS: number;
  /** Seconds into that clip. */
  intoS: number;
  /**
   * How long it sounds, for a kind that lasts as long as its action (typing:
   * the first keystroke to the last on screen, cut at the clip's end). Absent:
   * the sample plays out.
   */
  durS?: number;
  label?: string;
};

/**
 * Every beat a cue fires on, per PLAYING clip — the hit list clickReelTimes
 * places and sfxProblem checks, so the two cannot disagree about what counts.
 *
 * A beat at `tMs` on the shoot clock lands at demo-second
 * `logMsToDemoS(tMs)` — the picture's own clock; a clip covering `[fromS,toS)` plays it `demoSec - fromS` in. The
 * cold-open clip is skipped — it replays footage a later clip also covers, so
 * its beats would fire twice.
 *
 * FROZEN clips are skipped too. A `freeze` clip holds ONE frame for its whole
 * length, so nothing in it is ever pressed — but its `{fromS,toS}` still spans
 * live footage, and scanning it would put a click on a motionless picture.
 */
export function cueHits(
  segments: ReelSegment[],
  log: ClickLog,
  speed: number,
  kind: SfxKind,
  labels?: string[],
): CueHit[] {
  const cold = coldOpenIndex(segments);
  const hits: CueHit[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i === cold) continue;
    const seg = segments[i];
    if (!isClip(seg)) continue;
    if (seg.clip.freeze) continue;
    const { fromS, toS } = seg.clip;
    for (const beat of log.clicks) {
      if (!beatMatches(beat, kind, labels)) continue;
      const demoS = logMsToDemoS(beatTimeMs(beat, kind, labels), log, speed);
      if (!(demoS >= fromS && demoS < toS)) continue;
      const hit: CueHit = { segment: i, demoS, intoS: demoS - fromS, label: beat.label };
      if (kind === "typing" && !labels?.length && beat.typeEndMs != null) {
        const endS = Math.min(toS, logMsToDemoS(beat.typeEndMs + TYPING_SHOWN_MS, log, speed));
        if (endS > demoS) hit.durS = endS - demoS;
      }
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * Reel-second of every click-log beat that falls inside a clip, for auto-SFX.
 *
 * `overlaps` is the join list the PICTURE was cut with (see
 * segmentBoundsSeconds). It has to be the same list: this used to rebuild the
 * bounds without it, so in a dissolving reel every tick landed the sum of the
 * joins before it late — 33 ms on the first dissolve, 333 ms by the end of
 * agent-schedule. Omit it only for a reel that hard-cuts throughout.
 */
export function clickReelTimes(
  segments: ReelSegment[],
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  kind: SfxKind,
  labels?: string[],
  overlaps: number[] = [],
): number[] {
  return cueReelSpans(segments, counts, fps, log, speed, kind, labels, overlaps).map((h) => h.startS);
}

/** Fade on a sound cut short to its action, so it does not click off. */
export const SFX_CUT_FADE_S = 0.08;

/**
 * The audio pieces one cue hit places. A hit with a length (typing) plays the
 * sample back to back until the action ends and fades out there: a 3s run of
 * keys used to play whole over a half-second name and stop halfway through a
 * six-second paragraph. Any other hit plays its sample out.
 */
export function sfxPieces(
  cue: SfxCue,
  hit: { startS: number; durS?: number },
  sourceS: number,
): ReelAudioPiece[] {
  const base = { src: cue.src, gain: cue.gain, role: "sfx" as const };
  if (hit.durS == null || !(sourceS > 0))
    return [{ ...base, start: hit.startS, fadeOutS: cue.fadeOutS }];
  const out: ReelAudioPiece[] = [];
  for (let at = 0; hit.durS - at > 1e-6; at += sourceS) {
    const duration = Math.min(sourceS, hit.durS - at);
    const last = hit.durS - (at + duration) <= 1e-6;
    out.push({
      ...base,
      start: hit.startS + at,
      duration,
      ...(last ? { fadeOutS: Math.min(SFX_CUT_FADE_S, duration) } : {}),
    });
  }
  return out;
}

/** clickReelTimes with each hit's length (CueHit.durS), sorted by start. */
export function cueReelSpans(
  segments: ReelSegment[],
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  kind: SfxKind,
  labels?: string[],
  overlaps: number[] = [],
): { startS: number; durS?: number }[] {
  const bounds = segmentBoundsSeconds(counts, fps, overlaps);
  return cueHits(segments, log, speed, kind, labels)
    .map((h) => ({
      startS: bounds.startS[h.segment] + h.intoS,
      ...(h.durS != null ? { durS: h.durS } : {}),
    }))
    .sort((a, b) => a.startS - b.startS);
}

const s2 = (x: number): string => x.toFixed(2);

/** Every clip's range, for an error that has to say where the footage is. */
function clipRanges(segments: ReelSegment[]): string {
  const cold = coldOpenIndex(segments);
  return segments
    .map((seg, i) => {
      if (!isClip(seg)) return null;
      const tag = i === cold ? " cold open" : seg.clip.freeze ? " freeze" : "";
      return `#${i} [${s2(seg.clip.fromS)}-${s2(seg.clip.toS)})${tag}`;
    })
    .filter((r): r is string => r != null)
    .join(", ");
}

/**
 * The first SFX cue that would place NOTHING, as a sentence — or null.
 *
 * A cue that resolves to zero beats does not fail anywhere downstream: the mux
 * simply has one fewer piece and the film ships without its payoff sound. It
 * takes very little — a re-trimmed range, a re-shoot that moves the press, a
 * clip turned into a `freeze` (never scanned), or reading the log's shoot-clock
 * seconds as demo seconds and forgetting the playback rate. So an empty cue is
 * an error, and the message says where the label actually is (in DEMO seconds,
 * speed applied) against every clip range.
 *
 * Pure: needs the click log, not the render, so it runs before any segment is
 * drawn.
 */
export function sfxProblem(
  segments: ReelSegment[],
  sfx: ReelSfx | undefined,
  log: ClickLog,
  speed: number,
): string | null {
  if (!sfx) return null;
  for (const kind of SFX_KINDS) {
    const cue = sfx[kind];
    if (!cue) continue;
    if (cueHits(segments, log, speed, kind, cue.atLabels).length > 0) continue;
    const ranges = clipRanges(segments);
    if (!cue.atLabels || cue.atLabels.length === 0)
      return (
        `\`sfx.${kind}\` matches no beat in any playing clip, so it would place ` +
        `no sound. Clips: ${ranges}.`
      );
    const where = cue.atLabels.map((want) => {
      const found = log.clicks
        .filter((b) => labelHit(b, [want]))
        .map(
          (b) =>
            `"${b.label}" at demo ${s2(logMsToDemoS(b.tDownMs ?? b.tMs, log, speed))}s`,
        );
      return found.length
        ? `"${want}" -> ${found.join(", ")}`
        : `"${want}" -> no beat in the click log has that label`;
    });
    return (
      `\`sfx.${kind}\` (atLabels ${JSON.stringify(cue.atLabels)}) falls in no ` +
      `playing clip, so it would place no sound. ${where.join("; ")}. ` +
      `Clips: ${ranges} (cold-open and freeze clips place no sound).`
    );
  }
  return null;
}

/** Words too common to say what a clip is about. */
const FILLER = new Set(["the", "and", "then", "with", "for", "into", "its", "it", "a", "an", "to", "of", "on", "in"]);

/**
 * One line per clip whose `label` shares no word with any beat it plays.
 *
 * ADVISORY, not an error: a clip label is prose ("set the hour") and beat
 * labels are the recorder's ("pick 08"), so a clean clip can still miss. But
 * the miss is also what a clip cut from the wrong range looks like, so each
 * line prints the beats it DOES play, which is enough to tell the two apart
 * at a glance.
 *
 * Freeze clips are skipped (they play no beats by design), as are clips with
 * no label.
 */
export function clipLabelWarnings(
  segments: ReelSegment[],
  log: ClickLog,
  speed: number,
): string[] {
  const words = (s: string): string[] =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !FILLER.has(w));
  const out: string[] = [];
  segments.forEach((seg, i) => {
    if (!isClip(seg) || seg.clip.freeze || !seg.clip.label) return;
    const { fromS, toS, label } = seg.clip;
    const inRange = log.clicks.filter((b) => {
      const t = logMsToDemoS(b.tDownMs ?? b.tMs, log, speed);
      return b.label && t >= fromS && t < toS;
    });
    const want = words(label);
    const hit = inRange.some((b) =>
      words(b.label!).some((w) => want.some((x) => w.includes(x) || x.includes(w))),
    );
    if (hit) return;
    const plays = inRange.length
      ? inRange.map((b) => `"${b.label}"`).join(", ")
      : "no labelled beat";
    out.push(
      `clip #${i} "${label}" [${s2(fromS)}-${s2(toS)}) plays ${plays} — check the range`,
    );
  });
  return out;
}

/** A typed span shorter than this is a keystroke, not a "typing a string" run. */
export const TYPING_MIN_MS = 500;
/** How long after input the UI's pop/response lands. */
export const POP_DELAY_MS = 120;
/**
 * How long after the recorder's clock a keystroke shows in the footage.
 * MEASURED on skills-launch (slow-motion shoot): the typed text starts 0.13-0.29s
 * after the first caret probe, which the recorder takes just before the first
 * key, and settles ~0.16s after `typeEndMs`.
 */
export const TYPING_SHOWN_MS = 150;

/** Length of a beat's typed span, or 0 if it isn't a typing beat. */
const typeSpanMs = (beat: ClickEvent): number =>
  beat.typeEndMs != null ? beat.typeEndMs - beat.tMs : 0;

function labelHit(beat: ClickEvent, labels?: string[]): boolean {
  if (!labels || labels.length === 0) return false;
  const l = beat.label?.toLowerCase();
  return l != null && labels.some((s) => l.includes(s.toLowerCase()));
}

function beatMatches(beat: ClickEvent, kind: SfxKind, labels?: string[]): boolean {
  if (labels && labels.length) return labelHit(beat, labels);
  if (kind === "click") return beat.tDownMs != null && beat.typeEndMs == null;
  if (kind === "typing") return typeSpanMs(beat) >= TYPING_MIN_MS;
  if (kind === "pop") return beat.typeEndMs != null;
  return false; // key/confirm/error have no built-in detector — need labels
}

/**
 * When a beat's sound should land, in shoot-clock ms.
 *
 * A click sounds on the PRESS. `tDownMs` is mousedown — the frame the ripple and
 * the cursor squash fire on — and `tMs` is the beat anchor 114-203ms later, so
 * placing a tick there put it 91-108ms behind the picture on every harness beat,
 * past the ~50ms where audio and video read as one event. `typing` starts on
 * the first keystroke and `pop` is deliberately late — it is the UI answering.
 */
function beatTimeMs(beat: ClickEvent, kind: SfxKind, labels?: string[]): number {
  if (labels && labels.length) return beat.tDownMs ?? beat.tMs;
  if (kind === "pop") return (beat.typeEndMs ?? beat.tMs) + POP_DELAY_MS;
  if (kind === "click") return beat.tDownMs ?? beat.tMs;
  // Typing sounds with the first keystroke on screen. The recorder probes the
  // caret just before it types (scripts/lib/recorder.ts), after the press and
  // the select-all, so the press itself is ~150-300ms early.
  if (kind === "typing") return (beat.caret?.[0]?.tMs ?? beat.tMs) + TYPING_SHOWN_MS;
  return beat.tMs;
}

/** sidechaincompress args for ducking, from a `ReelDuck` (or defaults). */
function sidechainArgs(duck: boolean | ReelDuck): string {
  const d = typeof duck === "object" ? duck : {};
  const ratio = d.ratio ?? 6;
  const attack = d.attackMs ?? 20;
  const release = d.releaseMs ?? 300;
  const threshold =
    d.thresholdDb != null ? Math.pow(10, d.thresholdDb / 20) : 0.06;
  return `threshold=${n(threshold)}:ratio=${n(ratio)}:attack=${n(attack)}:release=${n(release)}`;
}

/** Sum labels to one named stream (`anull` for a single input, else `amix`). */
function sumTo(labels: string[], name: string): string {
  return labels.length === 1
    ? `${labels[0]}anull[${name}]`
    : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${name}]`;
}

/**
 * The per-piece filter chain, producing label `[a<j>]`.
 *
 * Order matters: normalise rate + layout first (mixed sample rates mis-time an
 * amix, a mono file would collapse the mix), then bound the length with
 * apad?/atrim + asetpts (reset PTS so adelay places from zero), then level,
 * then fades, then the reel-placement delay. `adelay=…:all=1` delays every
 * channel — the bare form delays only channel 1.
 */
function unitChain(
  p: ResolvedPiece,
  inLabel: string,
  outLabel: string,
  place: boolean,
): string {
  const steps = [
    `aresample=${SAMPLE_RATE}`,
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
  ];
  if (p.pad) steps.push("apad");
  steps.push(`atrim=0:${n(p.durationS)}`, "asetpts=PTS-STARTPTS");
  if (p.gain !== 1) steps.push(`volume=${n(p.gain)}`);
  if (p.fadeInS > 0) steps.push(`afade=t=in:st=0:d=${n(p.fadeInS)}`);
  if (p.fadeOutS > 0)
    steps.push(
      `afade=t=out:st=${n(p.durationS - p.fadeOutS)}:d=${n(p.fadeOutS)}`,
    );
  // A piece inside a crossfade group is NOT placed here — the group places it.
  if (place) {
    const delayMs = Math.round(p.startS * 1000);
    if (delayMs > 0) steps.push(`adelay=${delayMs}:all=1`);
  }
  return `${inLabel}${steps.join(",")}${outLabel}`;
}

/**
 * Build the ffmpeg args for the audio mux. `videoPath` is input 0; `paths[j]` is
 * the resolved absolute path for `pieces[j]`. Returns the pieces the caller wires
 * into `execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter,
 * ...mapArgs, out])`.
 *
 * `amix=normalize=0` keeps authored gains intact (the default divides by N and a
 * bed would come out half-volume); `dropout_transition=0` stops the mix swelling
 * when a piece ends. `apad` after the mix + `-shortest` makes the VIDEO
 * authoritative — audio never truncates the picture, silence never extends it.
 */
export function buildAudioMux(
  pieces: ResolvedPiece[],
  paths: string[],
  videoPath: string,
  opts: { loudnessLUFS?: number; duck?: boolean | ReelDuck } = {},
): { inputs: string[]; filter: string; mapArgs: string[] } {
  const inputs = ["-i", videoPath];
  for (let j = 0; j < pieces.length; j++) {
    const p = pieces[j];
    inputs.push(
      "-ss",
      n(p.sourceFromS),
      "-t",
      n(p.availS),
      "-i",
      paths[j],
    );
  }

  // Consecutive crossfaded pieces become ONE stream; everything else is its own.
  // A standalone piece keeps its `[a<j>]` label (placed by its own adelay); a
  // crossfade group joins its members with acrossfade, then places the whole
  // group at the first member's start.
  const groups: number[][] = [];
  for (let j = 0; j < pieces.length; j++) {
    if (pieces[j].crossfadePrevS > 0 && groups.length > 0)
      groups[groups.length - 1].push(j);
    else groups.push([j]);
  }

  const chainParts: string[] = [];
  const streams: { label: string; role: string }[] = [];
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (grp.length === 1) {
      const j = grp[0];
      chainParts.push(unitChain(pieces[j], `[${j + 1}:a]`, `[a${j}]`, true));
      streams.push({ label: `[a${j}]`, role: pieces[j].role });
    } else {
      grp.forEach((j, k) =>
        chainParts.push(unitChain(pieces[j], `[${j + 1}:a]`, `[c${g}_${k}]`, false)),
      );
      let acc = `[c${g}_0]`;
      for (let k = 1; k < grp.length; k++) {
        const out = `[xf${g}_${k}]`;
        chainParts.push(
          `${acc}[c${g}_${k}]acrossfade=d=${n(pieces[grp[k]].crossfadePrevS)}${out}`,
        );
        acc = out;
      }
      const startMs = Math.round(pieces[grp[0]].startS * 1000);
      chainParts.push(
        startMs > 0 ? `${acc}adelay=${startMs}:all=1[s${g}]` : `${acc}anull[s${g}]`,
      );
      streams.push({ label: `[s${g}]`, role: pieces[grp[0]].role });
    }
  }
  const chains = chainParts.join(";");

  // loudnorm BEFORE apad — it must analyse the audio, not the trailing silence.
  // The aresample after it is load-bearing: loudnorm runs its true-peak limiter
  // at 4x oversampling and hands back 192 kHz, which the encoder then kept as
  // 96 kHz AAC — measured on four of the five reels with sound. Every piece is
  // already 48 kHz going in (unitChain), so this only undoes loudnorm's change.
  // The aformat pins the layout for apad: ffmpeg 5.1 (the Agenta sandbox's,
  // Debian bookworm) cannot negotiate one between them and fails the whole mux
  // ("Cannot select channel layout"); 8.x infers it. Stereo either way.
  const norm =
    opts.loudnessLUFS != null
      ? `loudnorm=I=${n(opts.loudnessLUFS)}:TP=-1.5:LRA=11,aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,`
      : "";

  const beds = streams.filter((s) => s.role === "bed");
  const leads = streams.filter((s) => s.role !== "bed");
  const wantDuck = !!opts.duck && beds.length > 0 && leads.length > 0;

  let tail: string;
  if (wantDuck) {
    // Sum the leads, split one copy to the sidechain and one to the final mix,
    // sum the beds, compress the beds by the lead sidechain, then mix.
    //
    // The `apad` on the SIDECHAIN branch is load-bearing. sidechaincompress ends
    // when its SHORTEST input ends, and the leads here are SFX — a handful of
    // 0.2-0.3s samples scattered over the reel. Unpadded, the sidechain runs out
    // at the last tick and takes the bed with it: the first harness cut with
    // duck on went silent at 16.433s, which is exactly its last SFX end, leaving
    // 13.5s of a 30s film with no music. Padding the sidechain with silence lets
    // the compressor run until the BED ends, which is the length we want.
    //
    // Only the sidechain copy is padded — `leadMix` must not be, or the mix
    // never terminates.
    tail =
      `${sumTo(leads.map((s) => s.label), "lead")};[lead]asplit[leadSc][leadMix];` +
      `[leadSc]apad[leadScPad];` +
      `${sumTo(beds.map((s) => s.label), "bed")};` +
      `[bed][leadScPad]sidechaincompress=${sidechainArgs(opts.duck!)}[ducked];` +
      `[ducked][leadMix]amix=inputs=2:normalize=0:dropout_transition=0[m];` +
      `[m]${norm}apad[aout]`;
  } else if (streams.length === 1) {
    tail = `${streams[0].label}${norm}apad[aout]`;
  } else {
    const labels = streams.map((s) => s.label).join("");
    tail = `${labels}amix=inputs=${streams.length}:normalize=0:dropout_transition=0[m];[m]${norm}apad[aout]`;
  }
  const filter = `${chains};${tail}`;

  const mapArgs = [
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    // Belt and braces for the aresample above: delivery is 48 kHz whatever
    // any filter in the graph decides. scripts/reel.ts asserts it on the output.
    "-ar",
    String(SAMPLE_RATE),
    "-shortest",
    "-movflags",
    "+faststart",
  ];
  return { inputs, filter, mapArgs };
}

/** Audio filters the mux needs; the bundled remotion ffmpeg lacks these. */
export const AUDIO_FILTERS = [
  "aresample",
  "aformat",
  "atrim",
  "asetpts",
  "volume",
  "afade",
  "adelay",
  "amix",
  "apad",
  "loudnorm",
  "asplit",
  "sidechaincompress",
  "acrossfade",
] as const;

/** Which required audio filters are absent from an `ffmpeg -filters` dump. Pure. */
export function missingAudioFilters(filtersText: string): string[] {
  return AUDIO_FILTERS.filter(
    (f) => !new RegExp(`\\b${f}\\b`).test(filtersText),
  );
}
