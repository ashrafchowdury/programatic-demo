/**
 * Reel audio — placement math and ffmpeg-filtergraph assembly.
 *
 * Pure by design: no ffmpeg, no fs, no Remotion (same discipline as reel.ts), so
 * every number and every filter string is unit-testable without spawning
 * anything. scripts/reel.ts probes durations, runs the graph on the SYSTEM
 * ffmpeg, and muxes — see docs/design/reels/audio.md.
 *
 * Audio is one post-concat pass: the finished silent reel is input 0, each piece
 * is a later input trimmed at the input level, and a single `-filter_complex`
 * places (adelay), levels (volume), fades (afade) and mixes (amix) them.
 */
import type { ClickEvent, ClickLog } from "./click-log";
import {
  coldOpenIndex,
  isClip,
  type ReelAnchor,
  type ReelAudioPiece,
  type ReelDuck,
  type ReelSegment,
  type SfxKind,
} from "./reel";

/** Reel-time start and duration of every segment, in seconds. */
export type SegmentBounds = { startS: number[]; durS: number[] };

/**
 * Prefix-sum the per-segment frame counts into reel-second boundaries.
 *
 * `overlapF` is the dissolve length for a style that does not hard-cut. Every
 * join before segment i has eaten `overlapF` frames, so its start pulls earlier
 * by `i * overlapF` — cumulative, not constant. Zero for a cutting style, which
 * is every reel today.
 *
 * This has to agree with dissolvedStarts in scripts/lib/xfade.ts, which drives
 * the PICTURE while this drives SFX placement. xfade.test.ts asserts they do:
 * if they drift, every tick fires progressively later than its own footage.
 */
export function segmentBoundsSeconds(
  counts: number[],
  fps: number,
  overlapF = 0,
): SegmentBounds {
  const startS: number[] = [];
  const durS: number[] = [];
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    startS.push((acc - i * overlapF) / fps);
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
 * Reel-second of every click-log beat that falls inside a clip, for auto-SFX.
 *
 * A beat at `tMs` on the shoot clock lands at demo-second `(tMs/1000)/speed -
 * offset`; a clip covering `[fromS,toS)` puts it at `segmentStart + (demoSec -
 * fromS)` in reel time. The cold-open clip is skipped — it replays footage a
 * later clip also covers, so its beats would fire twice.
 *
 * FROZEN clips are skipped too. A `freeze` clip holds ONE frame for its whole
 * length, so nothing in it is ever pressed — but its `{fromS,toS}` still spans
 * live footage, and scanning it would put a click on a motionless picture. The
 * harness reel misses this by 0.21s today: its still covers demo 12.5-15.6s and
 * the last press lands at 12.29s. A re-trim or a re-shoot closes that gap.
 */
export function clickReelTimes(
  segments: ReelSegment[],
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  kind: SfxKind,
  labels?: string[],
): number[] {
  const bounds = segmentBoundsSeconds(counts, fps);
  const cold = coldOpenIndex(segments);
  const offsetS = (log.offsetMs ?? 0) / 1000;
  const times: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i === cold) continue;
    const seg = segments[i];
    if (!isClip(seg)) continue;
    if (seg.clip.freeze) continue;
    const { fromS, toS } = seg.clip;
    const segStart = bounds.startS[i];
    for (const beat of log.clicks) {
      if (!beatMatches(beat, kind, labels)) continue;
      const demoSec = beatTimeMs(beat, kind, labels) / 1000 / speed - offsetS;
      if (demoSec >= fromS && demoSec < toS)
        times.push(segStart + (demoSec - fromS));
    }
  }
  return times.sort((a, b) => a - b);
}

/** A typed span shorter than this is a keystroke, not a "typing a string" run. */
export const TYPING_MIN_MS = 500;
/** How long after input the UI's pop/response lands. */
export const POP_DELAY_MS = 120;

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
 * past the ~50ms where audio and video read as one event. `typing` keeps `tMs`
 * (the run starts there) and `pop` is deliberately late — it is the UI answering.
 */
function beatTimeMs(beat: ClickEvent, kind: SfxKind, labels?: string[]): number {
  if (labels && labels.length) return beat.tDownMs ?? beat.tMs;
  if (kind === "pop") return (beat.typeEndMs ?? beat.tMs) + POP_DELAY_MS;
  if (kind === "click") return beat.tDownMs ?? beat.tMs;
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
    "aresample=48000",
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
  const norm =
    opts.loudnessLUFS != null
      ? `loudnorm=I=${n(opts.loudnessLUFS)}:TP=-1.5:LRA=11,`
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
