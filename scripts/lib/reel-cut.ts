/**
 * Cuts a reel: title cards interleaved with ranges of an already-rendered demo.
 *
 *   reels/<name>.ts  ->  out/reel/<name>[.<style>][.<aspect>].mp4
 *
 * Four stages, each its own function below:
 *
 *   prepare   resolve beat anchors, validate, predict every segment's length.
 *             Needs only the click log, so `--check` stops here in seconds.
 *   segments  render each card and clip range, cached per segment.
 *   finish    join + composite overlays in ONE ffmpeg pass (xfade.ts), or a
 *             -c copy concat when there is nothing to blend or composite.
 *   deliver   mux audio (video stream-copied), assert the file is deliverable.
 *
 * Clip segments are RE-RENDERED from the DemoClip composition with --frames
 * rather than cut out of out/demo/<demo>.mp4 with ffmpeg. Both are
 * frame-accurate; re-rendering costs the same total frames as one full render
 * and adds no second h264 generation to footage that was tuned at CRF 16.
 * Cutting would have been faster per iteration, which is why the segment cache
 * exists instead: every segment is cached under .diag/reel/<out>/ keyed by a
 * hash of exactly what it renders (see reel-cache.ts), so editing one card's
 * copy re-renders that card and nothing else.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DESIGN_WIDTH,
  FPS,
  LEAD_FALLBACK_S,
  OUTPUT_WIDTH,
  resolvePlaybackRate,
  speedMismatch,
  type ClickLog,
} from "../../src/lib/click-log";
import {
  aspectFramePoint,
  aspectMagnification,
  aspectSize,
  aspectUpscale,
  cachedFollow,
  clampView,
  coverScale,
  cropPoint,
  cropRect,
  followAt,
  footageBounds,
  isNativeAspect,
  visibleHalf,
  type Aspect,
  type Point,
} from "../../src/lib/aspect";
import {
  chipCovers,
  chipSizePx,
  dodgeRects,
  pullInside,
  resolveChips,
  type FrameRect,
  type ReelChip,
} from "../../src/lib/chips";
import { cropUpscale, resolveCrop, SHARPNESS_CEILING } from "../../src/lib/crop";
import { demoDurationInFrames, demoGeometry, demoSize } from "../../src/lib/demo-duration";
import { compositionSize } from "../../src/lib/intro";
import type { PushSpec } from "../../src/lib/push";
import { openPose } from "../../src/lib/open";
import { WINDOW_FIT } from "../../src/lib/window";
import { zoomAt } from "../../src/lib/zoom";
import {
  beatDemoS,
  clipFrames,
  coldOpenIndex,
  framingMessage,
  ignoredClipFields,
  isCard,
  isClip,
  nudgeCard,
  overlapJoins,
  pacing,
  reelCard,
  reelDemo,
  reelProblem,
  findBeatEvent,
  resolveReel,
  segmentFrameCounts,
  segmentJoins,
  SFX_KINDS,
  type JoinBlend,
  type Reel,
  type ReelSegment,
  type ResolvedReel,
} from "../../src/lib/reel";
import { snapCardCuts, type BeatCut } from "../../src/lib/beats";
import {
  audioPlacementProblem,
  clickReelTimes,
  clipLabelWarnings,
  resolvePiece,
  SAMPLE_RATE,
  segmentBoundsSeconds,
  sfxProblem,
  type SegmentBounds,
} from "../../src/lib/reel-audio";
import { bedOnsets } from "./beats";
import {
  applySequence,
  resolveStyle,
  STYLE_PRESETS,
  type ReelStyle,
  type StylePreset,
} from "../../src/lib/style";
import { deliveryProblems } from "./encode";
import {
  compareStreams,
  frameCount,
  mediaDurationS,
  probe,
  probeDelivery,
  requireFilters,
} from "./ffmpeg";
import { outPath, outPathOf } from "./out";
import { chipsLayer, chipsProblem, hudLayer } from "./overlays";
import { missingAudio, muxAudio, reelHasAudio, reportLoudness } from "./reel-audio-mux";
import { digest, footageDigest, segmentSourceDigest } from "./reel-cache";
import { REMOTION_BIN, renderComposition } from "./remotion";
import { buildFinishArgs, dissolvedFrameCount, groundLuma } from "./xfade";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export type CutOptions = {
  /** Where the reel came from, for messages: "reels/harness.ts". */
  source: string;
  /** Output basename under out/reel/, without .mp4. */
  outBase: string;
  /**
   * Cut in this style instead of the reel's own. Fields the new framing cannot
   * honour become warnings rather than errors — comparing a proof reel in
   * stage is legitimate, and its crops are expected to fall away.
   */
  style?: ReelStyle;
  /** Resolve and report, render nothing. */
  check?: boolean;
  /**
   * Cut at this aspect instead of the reel's own (`aspect`, else 16:9). The
   * caller names the output; see scripts/reel.ts.
   */
  aspect?: Aspect;
};

export type Prepared = {
  reel: ResolvedReel;
  demo: string;
  preset: StylePreset;
  style: ReelStyle;
  log: ClickLog;
  speed: number;
  /** Predicted frames per segment; the render must agree. */
  counts: number[];
  joins: number[];
  /** How each join with frames blends: a dissolve's fade, or an exit overlap. */
  blends: JoinBlend[];
  /** Each card cut against the bed's beats, when the reel snaps to them. */
  beats: BeatCut[] | null;
  /** Fields each clip sets that its framing ignores, by segment index. */
  ignored: Map<number, string[]>;
  /** A non-native aspect to crop to, or undefined for the footage's own. */
  aspect: Aspect | undefined;
  /** Chips in reel time, cut to their shots and placed for this aspect. */
  chips: ReelChip[];
  /** What chip resolution clipped or moved, and what it could not clear. */
  chipNotes: { info: string[]; warn: string[] };
};

const s2 = (x: number): string => x.toFixed(2);

/**
 * `authored` cut in `style` instead: `--style=`.
 *
 * Drops the legacy `look` too — naming a grammar is an instruction, and
 * `classic` + `fullbleed` would otherwise be rejected. And it overrides EVERY
 * level, cards included: `--style` is an A/B tool ("this film, in that
 * grammar"), and a card that pinned its own style used to keep it, so the
 * comparison silently mixed two grammars (review 2).
 */
export function restyle(authored: Reel, style: ReelStyle): Reel {
  return {
    ...authored,
    style,
    look: undefined,
    segments: authored.segments.map((seg) => {
      if (!isCard(seg) || (seg.card.style === undefined && seg.card.look === undefined))
        return seg;
      const { style: _style, look: _look, ...card } = seg.card;
      return { ...seg, card };
    }),
  };
}

/** Everything that can be known before a frame renders — and every check. */
function prepare(authored: Reel, opts: CutOptions): Prepared {
  const src = opts.source;
  const styled: Reel = opts.style ? restyle(authored, opts.style) : authored;
  const base: Reel = opts.aspect ? { ...styled, aspect: opts.aspect } : styled;
  const demo = reelDemo(base);

  const logPath = path.join(ROOT, "public", `${demo}.clicks.json`);
  if (!fs.existsSync(logPath))
    throw new Error(
      `Missing public/${demo}.clicks.json — every segment takes its size from ` +
        `the recording, so record + convert ${demo} first.`,
    );
  const log = JSON.parse(fs.readFileSync(logPath, "utf8")) as ClickLog;
  const speed = resolvePlaybackRate(process.env.DEMO_SPEED);
  // Every clip re-renders the demo at `speed`, so a log paced for another rate
  // plays its glides and camera room at the wrong length here too.
  const paced = speedMismatch(log, speed);
  if (paced) console.warn(`  ⚠️  ${src}: ${paced}`);

  const resolved = resolveReel(base, log, speed);
  if ("problem" in resolved) throw new Error(`${src}: ${resolved.problem}`);
  const hasClips = resolved.reel.segments.some(isClip);

  // Sized exactly as src/Root.tsx sizes DemoClip: past the recording when the
  // camera needs longer to land back at base. The demo is rendered without
  // chrome (scripts/render.ts never passes it), so neither does this. Clip
  // ranges are frame numbers into THIS timeline, so its length is the bound.
  const expected = demoDurationInFrames(log, speed, demoGeometry(log), FPS);
  let total: number | undefined;
  if (hasClips) {
    const file = outPathOf("demo", `${demo}.mp4`);
    if (fs.existsSync(file)) {
      total = frameCount(probe(file)) ?? undefined;
      if (total == null) throw new Error(`Could not read a frame count from ${file}`);
      // If the demo on disk was rendered at a different DEMO_SPEED than this
      // run would use, every range in the reel points somewhere else.
      if (expected !== total) {
        const stale =
          `out/demo/${demo}.mp4 has ${total} frames, but DEMO_SPEED=${speed} would ` +
          `render ${expected}. The reel's clip ranges were timed against the file ` +
          `on disk, so re-render the demo first: \`pnpm render ${demo}\` (same ` +
          `DEMO_SPEED, or unset it). A demo rendered before the clip was sized ` +
          `from its camera track (src/lib/demo-duration.ts) is stale too.`;
        if (!opts.check) throw new Error(stale);
        console.warn(`  ⚠️  ${stale} Checking against ${expected}.`);
        total = expected;
      }
    } else if (opts.check) {
      console.warn(
        `  ⚠️  out/demo/${demo}.mp4 is not rendered yet; checking ranges against ` +
          `the ${expected} frames it would have.`,
      );
      total = expected;
    } else {
      throw new Error(
        `Missing out/demo/${demo}.mp4 — the reel cuts ranges out of the demo, so ` +
          `render it first with \`pnpm render ${demo}\`.`,
      );
    }
  }

  const problem = reelProblem(resolved.reel, total, FPS, { framing: !opts.style });
  if (problem) throw new Error(`${src}: ${problem}`);

  const style = resolveStyle(resolved.reel);
  const preset = STYLE_PRESETS[style];
  // R9: the style decides how each segment arrives and leaves given its place
  // in the film (exit cycle, direction continuity). Applied ONCE, here, so the
  // renders, the cache keys and --check all read the same sequenced segments.
  // An authored move always wins; this only fills gaps.
  let reel: ResolvedReel = {
    ...resolved.reel,
    segments: applySequence(resolved.reel.segments, preset),
  };
  const ignored = new Map<number, string[]>();
  reel.segments.forEach((seg, i) => {
    if (!isClip(seg)) return;
    const fields = ignoredClipFields(seg.clip, preset.shot);
    if (!fields.length) return;
    ignored.set(i, fields);
    console.warn(
      `  ⚠️  ${src} segment ${i + 1} (clip) ${framingMessage(fields, style, preset.shot)}`,
    );
  });

  // Before any render: a cue that places nothing ships a silent payoff with no
  // other symptom, and a missing audio file used to surface only after every
  // segment had been drawn.
  const silent = sfxProblem(reel.segments, reel.sfx, log, speed);
  if (silent) throw new Error(`${src}: ${silent}`);
  const noFile = missingAudio(reel);
  if (noFile) throw new Error(`${src}: ${noFile}`);
  for (const w of clipLabelWarnings(reel.segments, log, speed))
    console.warn(`  ⚠️  ${src}: ${w}`);

  let counts = segmentFrameCounts(reel, FPS);
  // R10: a style whose seams are an emptied frame overlaps each exit with the
  // next entry instead of cutting after it, keyed against its flat ground.
  const { joins, blends } = overlapJoins(
    reel.segments,
    segmentJoins(reel.segments, preset.join),
    preset,
  );
  if (blends.includes("overlap") && !preset.shot.ground)
    throw new Error(
      `${src}: the "${style}" style overlaps its exits (sequence.overlapExitF) but ` +
        `has no flat shot.ground to key the overlap against.`,
    );

  // R9: land each cut out of a card on a beat of the bed.
  let beats: BeatCut[] | null = null;
  if (reel.snapToBeats) {
    const snapped = snapToBed(reel, counts, joins);
    reel = snapped.reel;
    counts = segmentFrameCounts(reel, FPS);
    beats = snapped.cuts;
    const drift = counts.findIndex((c, i) => c !== snapped.counts[i]);
    if (drift >= 0)
      throw new Error(`beat snap: segment ${drift + 1} came out ${counts[drift]} frames, planned ${snapped.counts[drift]}`);
  }
  const runtimeS = dissolvedFrameCount(counts, joins) / FPS;

  // Chips draw only in a style with an annotation look. Authored chips under
  // one without it used to vanish with no message at all.
  const chipCount = reel.chips?.length ?? 0;
  if (chipCount > 0 && !preset.annotation) {
    const lost =
      `${chipCount} chip(s) authored, but the "${style}" style has no annotation ` +
      `look, so none would draw`;
    if (!opts.style)
      throw new Error(`${src}: ${lost}. Remove \`chips\`, or cut in a style that draws them.`);
    console.warn(`  ⚠️  ${src}: ${lost} (--style=${opts.style}); dropped from this cut.`);
  }
  const aspect = isNativeAspect(reel.aspect) ? undefined : reel.aspect;
  let chips: ReelChip[] = [];
  const chipNotes = { info: [] as string[], warn: [] as string[] };
  if (chipCount > 0 && preset.annotation) {
    const resolvedChips = resolveReelChips(reel, preset, log, speed, counts, joins);
    if ("problem" in resolvedChips) throw new Error(`${src}: ${resolvedChips.problem}`);
    chipNotes.info.push(...resolvedChips.notes);
    const placed = placeChips(
      { reel, preset, log, speed, counts, joins, ignored, aspect },
      resolvedChips.chips,
    );
    chips = placed.chips;
    chipNotes.info.push(...placed.info);
    chipNotes.warn.push(...placed.warn);
    const chipBad = chipsProblem(chips, runtimeS);
    if (chipBad) throw new Error(`${src}: ${chipBad}`);
  }

  // Audio placement against THIS reel's runtime and bounds — reelProblem only
  // knew the demo's length, which is the wrong bound for a start.
  const audioBad = audioPlacementProblem(
    reel.audio,
    runtimeS,
    segmentBoundsSeconds(counts, FPS, joins),
  );
  if (audioBad) throw new Error(`${src}: ${audioBad}`);

  return {
    reel, demo, preset, style, log, speed, counts, joins, blends, beats, ignored, aspect, chips, chipNotes,
  };
}

/**
 * Clip `i`'s push as the render will apply it: authored, else the style's own
 * shot arrival when its motion lives on the shots. clipProps and the chips both
 * read this, so a chip rides exactly the move its shot makes.
 */
function clipShotPush(authored: PushSpec | undefined, preset: StylePreset): PushSpec | undefined {
  return authored ?? (preset.motionLayer === "shots" ? presetShotPush(preset) : undefined);
}

/** Authored chips -> reel seconds, each cut to its shot and riding its push. */
function resolveReelChips(
  reel: ResolvedReel,
  preset: StylePreset,
  log: ClickLog,
  speed: number,
  counts: number[],
  joins: number[],
): ReturnType<typeof resolveChips> {
  const bounds = segmentBoundsSeconds(counts, FPS, joins);
  const segs = reel.segments.map((seg, i) => ({
    startF: Math.round(bounds.startS[i] * FPS),
    frames: counts[i],
    ...(isClip(seg)
      ? {
          push: clipShotPush(seg.clip.push, preset),
          clip: { fromS: seg.clip.fromS, toS: seg.clip.toS, freeze: seg.clip.freeze },
        }
      : {}),
  }));
  const beat = (label: string) => {
    const hit = findBeatEvent(label, log, speed);
    return "problem" in hit ? hit : { s: beatDemoS(hit.beat, log, speed) };
  };
  // FramedPush's useDesignScale: the 16:9 width over the design width, at every
  // aspect (DesignWidthContext carries the native width into an aspect cut).
  return resolveChips(reel.chips ?? [], segs, FPS, beat, compositionSize(log).width / DESIGN_WIDTH);
}

/** Frames between samples when collecting press targets under a chip. */
const PRESS_SAMPLE_F = 2;

/**
 * The press targets a chip must not cover, in frame fractions: at every sampled
 * frame of its window, the rect of the control the pointer is on or heading
 * for (the follow's own subject, by tDepartMs) and of the NEXT one — so a chip
 * placed over a button the hand is about to reach is caught before it lands.
 * Mapped through the shot's actual framing (window camera, crop, or the moving
 * aspect crop) and clipped to what is on screen.
 */
function pressRects(p: ChipPlacing, i: number, fromS: number, toS: number): FrameRect[] {
  const seg = p.reel.segments[i];
  if (!isClip(seg)) return [];
  const { log, speed, preset } = p;
  const shot = preset.shot;
  const windowed = shot.framing === "window";
  const fit = windowed ? (shot.windowFit ?? WINDOW_FIT) : 1;
  const crop =
    windowed || p.ignored.get(i)?.includes("crop") ? undefined : resolveCrop(seg.clip.crop);
  const W = log.viewport.width || 1;
  const H = log.viewport.height || 1;
  const clicks = [...log.clicks].sort((a, b) => a.tMs - b.tMs);
  if (!clicks.length) return [];
  const departs = clicks.map((c) => c.tDepartMs ?? c.tMs - LEAD_FALLBACK_S * 1000);
  const bounds = segmentBoundsSeconds(p.counts, FPS, p.joins);
  const startF = Math.round(bounds.startS[i] * FPS);
  const { first, last } = clipFrames(seg.clip, FPS);
  const camScale = (f: number) =>
    shot.zoom ? zoomAt(f, FPS, log, { speed, fit, drift: seg.clip.drift }).scale / fit : 1;

  // Footage point -> frame fraction at demo frame f, for this shot's framing.
  let toFrame: (pt: Point, f: number) => Point;
  if (p.aspect) {
    const native = demoSize(log);
    const size = aspectSize(native, p.aspect);
    const box = { width: size.width * fit, height: size.height * fit };
    const s = coverScale(box, native);
    const mag = aspectMagnification(native, size);
    const half = visibleHalf(box, native);
    const frames = demoDurationInFrames(log, speed, demoGeometry(log), FPS);
    const follow = cachedFollow(log, { fps: FPS, speed, frames, half, crop });
    toFrame = (pt, f) => {
      const c = followAt(follow, f);
      const view = clampView(
        { scale: Math.max(1, camScale(f) / mag), cx: c.x, cy: c.y },
        half,
        footageBounds(crop),
      );
      return aspectFramePoint(cropPoint(pt, crop), view, native, s, size);
    };
  } else if (windowed) {
    toFrame = (pt, f) => {
      const z = shot.zoom
        ? zoomAt(f, FPS, log, { speed, fit, drift: seg.clip.drift })
        : { scale: fit, translateX: 0, translateY: 0 };
      return {
        x: 0.5 + z.translateX + (pt.x - 0.5) * z.scale,
        y: 0.5 + z.translateY + (pt.y - 0.5) * z.scale,
      };
    };
  } else {
    toFrame = (pt) => cropPoint(pt, crop);
  }
  const panel = { lo: 0.5 - fit / 2, hi: 0.5 + fit / 2 };

  const out: FrameRect[] = [];
  const seen = new Set<string>();
  for (let rf = Math.ceil(fromS * FPS); rf < toS * FPS; rf += PRESS_SAMPLE_F) {
    const f = seg.clip.freeze ? last : first + (rf - startF);
    const tMs = ((f / FPS) * speed - (log.offsetMs ?? 0) / 1000) * 1000;
    let k = 0;
    while (k + 1 < departs.length && departs[k + 1] <= tMs) k++;
    for (const c of clicks.slice(k, k + 2)) {
      const r = c.rect ?? { x: c.x - 12, y: c.y - 12, w: 24, h: 24 };
      const a = toFrame({ x: r.x / W, y: r.y / H }, f);
      const b = toFrame({ x: (r.x + r.w) / W, y: (r.y + r.h) / H }, f);
      const rect = {
        x0: Math.max(panel.lo, Math.min(a.x, b.x)),
        x1: Math.min(panel.hi, Math.max(a.x, b.x)),
        y0: Math.max(panel.lo, Math.min(a.y, b.y)),
        y1: Math.min(panel.hi, Math.max(a.y, b.y)),
      };
      if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) continue;
      const key = [rect.x0, rect.y0, rect.x1, rect.y1].map((v) => v.toFixed(3)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rect);
    }
  }
  return out;
}

type ChipPlacing = Pick<
  Prepared,
  "reel" | "preset" | "log" | "speed" | "counts" | "joins" | "ignored" | "aspect"
>;

/**
 * Where each chip actually sits. At 16:9 the author's placement stands and
 * --check warns when it covers a press target. At any other aspect the author
 * placed it against a panel edge that no longer exists, so it is pulled inside
 * the frame and then moved to the nearest side of any press target it covers
 * (the control being clicked, or the next one) — measured on agent-tool 9:16,
 * "every action" sat on the Done button as it was pressed.
 */
function placeChips(
  p: ChipPlacing,
  chips: ReelChip[],
): { chips: ReelChip[]; info: string[]; warn: string[] } {
  const style = p.preset.annotation;
  if (!style) return { chips, info: [], warn: [] };
  const native = compositionSize(p.log);
  const size = aspectSize(native, p.aspect);
  const info: string[] = [];
  const warn: string[] = [];
  const placed = chips.map((c) => {
    const px = chipSizePx(c.text, style, native.height);
    const half = { w: px.width / 2 / size.width, h: px.height / 2 / size.height };
    const rects = c.segment != null ? pressRects(p, c.segment, c.fromS, c.toS) : [];
    let { x, y } = c;
    if (p.aspect) {
      x = pullInside(x, half.w);
      // A pill's height of clearance, so it reads as beside the control, not
      // touching it.
      const d = dodgeRects(x, y, half, rects, { x: half.h, y: half.h / 2 });
      if (d.moved)
        info.push(
          `"${c.text}" moved (${c.x.toFixed(3)}, ${c.y.toFixed(3)}) -> ` +
            `(${d.x.toFixed(3)}, ${d.y.toFixed(3)}) off a press target`,
        );
      x = d.x;
      y = d.y;
    }
    if (chipCovers(x, y, half, rects))
      warn.push(
        `chip "${c.text}" at (${x.toFixed(3)}, ${y.toFixed(3)}) covers a press target ` +
          `in segment ${(c.segment ?? 0) + 1} (${c.fromS.toFixed(2)}-${c.toS.toFixed(2)}s). Move it.`,
      );
    return { ...c, x, y };
  });
  return { chips: placed, info, warn };
}

/**
 * The reel with each card's hold nudged (±SNAP_MAX_F frames) so the cut out of
 * it lands on the nearest onset of its `role: "bed"` audio. Onsets are
 * detected once per bed and cached (scripts/lib/beats.ts); the bed is placed
 * exactly as the mux will place it, against the bounds as they stand at each
 * step, so an anchored bed moves with the nudges.
 */
function snapToBed(
  reel: ResolvedReel,
  counts: number[],
  joins: number[],
): { reel: ResolvedReel; counts: number[]; cuts: BeatCut[] } {
  const beds = (reel.audio ?? []).map((piece) => {
    const file = path.join(ROOT, "public", piece.src);
    const durS = mediaDurationS(file);
    // The trim alone decides which source range is read; placement comes later.
    const probe = resolvePiece({ ...piece, start: 0, end: undefined, duration: undefined, pad: false }, durS, durS);
    return { piece, durS, onsets: piece.role === "bed" ? bedOnsets(file, probe.sourceFromS, probe.availS) : [] };
  }).filter((b) => b.piece.role === "bed");
  const onsetsAt = (bounds: SegmentBounds): number[] => {
    const total = bounds.startS[bounds.startS.length - 1] + bounds.durS[bounds.durS.length - 1];
    return beds.flatMap((b) => {
      const r = resolvePiece(b.piece, total, b.durS, bounds);
      return b.onsets
        .filter((o) => o >= r.sourceFromS && o < r.sourceFromS + r.durationS)
        .map((o) => r.startS + (o - r.sourceFromS));
    });
  };
  const segments = [...reel.segments];
  const nudged = new Map<string, ReelSegment | null>();
  const tryNudge = (i: number, d: number): ReelSegment | null => {
    const key = `${i}:${d}`;
    if (!nudged.has(key)) {
      const seg = segments[i];
      const card = isCard(seg) ? nudgeCard(reel, seg.card, d, FPS) : null;
      nudged.set(key, card ? { ...seg, card } : null);
    }
    return nudged.get(key)!;
  };
  const snapped = snapCardCuts(
    (i) => isCard(segments[i]),
    counts,
    joins,
    FPS,
    onsetsAt,
    (i, d) => tryNudge(i, d) != null,
  );
  for (const c of snapped.cuts) if (c.nudgeF !== 0) segments[c.segment] = tryNudge(c.segment, c.nudgeF)!;
  return { reel: { ...reel, segments }, counts: snapped.counts, cuts: snapped.cuts };
}

/** One line on how the cuts sit against the bed's beats. */
function beatsLine(cuts: BeatCut[]): string {
  const on = cuts.filter((c) => c.offF != null && Math.abs(c.offF) <= 0.5).length;
  const each = cuts
    .map((c) => `#${c.segment + 1} ${c.nudgeF > 0 ? "+" : ""}${c.nudgeF}f${c.offF == null ? "" : ` (${c.offF >= 0 ? "+" : ""}${c.offF.toFixed(1)}f)`}`)
    .join(", ");
  return `beats      -> ${on}/${cuts.length} card cuts on a beat (±0.5f) · nudge (off after): ${each}`;
}

/**
 * What a clip's FIRST FRAME is framed at, in the units its framing uses — the
 * zoom camera's pose scale on a windowed style, the crop's k on a full-bleed
 * one — with and without its authored `open`. `--check` prints both, so a clip
 * that the spec says opens tight and the footage opens wide is visible in
 * seconds, not in a render (audit R10).
 */
function openingScale(p: Prepared, i: number): { natural: number; opens: number } {
  const seg = p.reel.segments[i];
  if (!isClip(seg)) throw new Error("not a clip");
  const { first } = clipFrames(seg.clip, FPS);
  const shot = p.preset.shot;
  let natural: number;
  if (shot.framing === "window") {
    const fit = shot.windowFit ?? WINDOW_FIT;
    natural = shot.zoom
      ? zoomAt(first, FPS, p.log, { speed: p.speed, fit, drift: seg.clip.drift }).scale / fit
      : 1;
  } else {
    natural = p.ignored.get(i)?.includes("crop") ? 1 : (resolveCrop(seg.clip.crop)?.k ?? 1);
  }
  const open = seg.clip.open;
  if (!open) return { natural, opens: natural };
  // What DemoClip will actually open on: openPose may step the scale down to
  // keep the target in shot. The aspect path frames by its own crop.
  if (p.aspect) return { natural, opens: Math.max(open.scale, natural) };
  const running = { scale: natural, cx: 0.5, cy: 0.5 };
  if (shot.framing === "window") {
    const fit = shot.windowFit ?? WINDOW_FIT;
    return { natural, opens: openPose(open, running, { viewScale: (s) => fit * s }).scale };
  }
  const crop = p.ignored.get(i)?.includes("crop") ? undefined : resolveCrop(seg.clip.crop);
  const k = crop?.k ?? 1;
  const pose = openPose(
    {
      ...open,
      scale: open.scale / k,
      at: cropPoint(open.at, crop),
      ...(open.rect ? { rect: cropRect(open.rect, crop) } : {}),
    },
    { scale: 1, cx: 0.5, cy: 0.5 },
  );
  return { natural, opens: Math.max(natural, pose.scale * k) };
}

/** Source px per output px for clip `i` at rest — the number SHARPNESS_CEILING caps. */
function clipUpscale(p: Prepared, i: number): number {
  const seg = p.reel.segments[i];
  if (!isClip(seg)) return 1;
  const windowed = p.preset.shot.framing === "window";
  const k = windowed || p.ignored.get(i)?.includes("crop") ? undefined : seg.clip.crop;
  if (!p.aspect) return cropUpscale(k, p.log.viewport.width, OUTPUT_WIDTH);
  const base = demoSize(p.log);
  const fit = windowed ? (p.preset.shot.windowFit ?? WINDOW_FIT) : 1;
  return aspectUpscale(
    p.log.viewport.width,
    base,
    aspectSize(base, p.aspect),
    resolveCrop(k)?.k ?? 1,
    fit,
  );
}

/** `--check`: every number the cut will have, without cutting it. */
function report(p: Prepared, authored: Reel, opts: CutOptions): void {
  const { reel, counts, joins, preset, log, speed } = p;
  const bounds = segmentBoundsSeconds(counts, FPS, joins);
  const cold = coldOpenIndex(reel.segments);
  console.log(
    `\nreel       -> ${opts.outBase} · demo ${p.demo} · style ${p.style} · ` +
      `${p.aspect ?? "16:9"} · speed ${speed}× · ${FPS} fps`,
  );
  if (p.aspect) {
    const base = demoSize(log);
    const size = aspectSize(base, p.aspect);
    console.log(
      `aspect     -> ${size.width}x${size.height}, a moving crop of the ` +
        `${log.viewport.width}x${log.viewport.height} footage at ` +
        `${aspectMagnification(base, size).toFixed(2)}x the 16:9 picture`,
    );
  }
  console.log(`  #  kind   reel s          len    demo s        what`);
  reel.segments.forEach((seg, i) => {
    const at = `${s2(bounds.startS[i])}-${s2(bounds.startS[i] + bounds.durS[i])}`;
    const len = `${s2(bounds.durS[i])}s`;
    let demoRange = "—";
    let what: string;
    const move = (m?: { axis: string; dist?: number; frames?: number }) =>
      m ? (m.axis === "none" ? "still" : `${m.axis}${m.dist ?? ""}/${m.frames ?? ""}f`) : "";
    const moves = isCard(seg)
      ? [seg.card.enter && `in ${move(seg.card.enter)}`, seg.card.exit && `out ${move(seg.card.exit)}`]
      : [seg.clip.push?.in && `in ${move(seg.clip.push.in)}`, seg.clip.push?.out && `out ${move(seg.clip.push.out)}`];
    const motion = moves.filter(Boolean).length ? `  {${moves.filter(Boolean).join(", ")}}` : "";
    if (isCard(seg)) {
      what = JSON.stringify(seg.card.headline ?? "") + motion;
    } else {
      demoRange = `${s2(seg.clip.fromS)}-${s2(seg.clip.toS)}`;
      const a = authored.segments[i];
      const anchors =
        a && "clip" in a && (a.clip.fromBeat || a.clip.toBeat)
          ? ` [${[a.clip.fromBeat && `from "${a.clip.fromBeat}"`, a.clip.toBeat && `to "${a.clip.toBeat}"`]
              .filter(Boolean)
              .join(", ")}]`
          : "";
      const o = openingScale(p, i);
      const up = clipUpscale(p, i);
      const tags = [
        // The first frame's framing, stated when the spec asks for one and
        // always when it is tighter than rest.
        seg.clip.open
          ? `opens ${o.opens.toFixed(2)}x${Math.abs(o.natural - o.opens) > 0.05 ? ` (footage alone ${o.natural.toFixed(2)}x)` : ""}`
          : `opens ${o.natural.toFixed(2)}x`,
        up > SHARPNESS_CEILING ? `${up.toFixed(2)}x src->out, OVER ${SHARPNESS_CEILING}` : "",
        i === cold ? "cold open" : "",
        seg.clip.freeze ? "freeze" : "",
        p.ignored.has(i) ? `ignores ${p.ignored.get(i)!.join("/")}` : "",
      ].filter(Boolean);
      what = `${seg.clip.label ?? ""}${anchors}${tags.length ? ` (${tags.join(", ")})` : ""}${motion}`;
    }
    const join =
      i > 0 && joins[i - 1] > 0
        ? `${p.blends[i - 1] === "overlap" ? "+" : "~"}${joins[i - 1]}f `
        : "";
    console.log(
      `  ${String(i + 1).padStart(2)} ${isCard(seg) ? "card" : "clip"}  ` +
        `${(join + at).padEnd(15)} ${len.padStart(6)}  ${demoRange.padEnd(12)}  ${what}`,
    );
  });

  // A card that punches into a control, cut to a clip that opens wide, is a
  // match cut that does not match. Say so; `open` is the fix.
  reel.segments.forEach((seg, i) => {
    const prev = reel.segments[i - 1];
    if (!isClip(seg) || !prev || !isCard(prev) || !prev.card.chip) return;
    const o = openingScale(p, i);
    if (o.opens < 1.3)
      console.warn(
        `  ⚠️  segment ${i} punches into "${prev.card.chip.label}", but clip ${i + 1} ` +
          `opens at ${o.opens.toFixed(2)}x. State \`open: { scale, at: "<beat>" }\` ` +
          `on the clip so the cut matches.`,
      );
  });

  const pace = pacing(reel.segments, counts, joins, FPS);
  const t = preset.targets;
  const vs = (v: number, target: number | undefined, unit: string, digits = 2) =>
    `${v.toFixed(digits)}${unit}` + (target != null ? ` (target ${target.toFixed(digits)}${unit})` : "");
  const overlaps = p.blends.filter((b, i) => b === "overlap" && joins[i] > 0).length;
  console.log(
    `\nruntime    -> ${s2(pace.runtimeS)}s · ${pace.shots} shots · ` +
      `${pace.dissolves - overlaps} dissolve(s)` +
      (overlaps ? ` · ${overlaps} exit overlap(s) (+Nf above)` : ""),
  );
  console.log(`mean shot  -> ${vs(pace.meanShotS, t?.meanShotS, "s")}`);
  console.log(`cut rate   -> ${vs(pace.cutsPerMin, t?.cutsPerMin, "/min", 1)}`);
  console.log(
    `share      -> clips ${(pace.clipShare * 100).toFixed(0)}% · cards ${(pace.cardShare * 100).toFixed(0)}%`,
  );
  if (!t) console.log(`targets    -> the "${p.style}" style has none (no reference film)`);

  if (reel.sfx) {
    for (const kind of SFX_KINDS) {
      const cue = reel.sfx[kind];
      if (!cue) continue;
      const times = clickReelTimes(reel.segments, counts, FPS, log, speed, kind, cue.atLabels, joins);
      console.log(`sfx ${kind.padEnd(7)}-> ${times.length} hit(s) at ${times.map(s2).join(", ")}s`);
    }
  }
  if (p.beats) console.log(beatsLine(p.beats));
  const hud = preset.hud.kind === "steps" ? "steps" : "none";
  console.log(`overlays   -> hud ${hud} · chips ${preset.annotation ? p.chips.length : "n/a"}`);
  for (const c of p.chips)
    console.log(
      `  chip     -> "${c.text}" seg ${(c.segment ?? 0) + 1} ${s2(c.fromS)}-${s2(c.toS)}s ` +
        `at (${c.x.toFixed(3)}, ${c.y.toFixed(3)})${c.ride ? " · rides its shot" : ""}`,
    );
  for (const n of p.chipNotes.info) console.log(`  chip     -> ${n}`);
  for (const w of p.chipNotes.warn) console.warn(`  ⚠️  ${w}`);
  console.log(`\nchecked. Nothing rendered.`);
}

/**
 * A style's own shot arrival, as a PushSpec — or undefined when it has none.
 *
 * Only the `push` kind maps: `ramp` is the framed scale nudge, which is a
 * card mechanism with no clip equivalent, and `none` means the grammar holds
 * its shots still.
 */
function presetShotPush(preset: StylePreset): PushSpec | undefined {
  const toMove = (m: StylePreset["shot"]["enter"]) =>
    m.kind === "push" ? { axis: m.axis, dist: m.dist, frames: m.frames } : undefined;
  const inMove = toMove(preset.shot.enter);
  const outMove = toMove(preset.shot.exit);
  if (!inMove && !outMove) return undefined;
  return { ...(inMove ? { in: inMove } : {}), ...(outMove ? { out: outMove } : {}) };
}

/** DemoClip props for clip `i`, omitting every field its framing ignores. */
export function clipProps(p: Prepared, i: number): Record<string, unknown> {
  const { reel, preset } = p;
  const seg = reel.segments[i];
  if (!isClip(seg)) throw new Error("not a clip");
  const { first, last } = clipFrames(seg.clip, FPS);
  const skip = new Set(p.ignored.get(i) ?? []);
  const has = <K extends keyof typeof seg.clip>(k: K) =>
    seg.clip[k] !== undefined && !skip.has(k);
  const { drift, crop, push, pageBg, cursor, ripple, freeze, open } = seg.clip;
  // A grammar whose motion lives on the SHOTS supplies the clip's default
  // arrival. Without this, switching a reel to such a style removes the card
  // motion and adds nothing — measured on the harness reel, 24% moving under
  // proof became 18% under narration against a 36.8% target. Authored `push`
  // still wins, and a cards-layer style contributes nothing here.
  const shotPush = clipShotPush(push, preset);
  const common = {
    name: p.demo,
    speed: p.speed,
    ...(has("drift") ? { drift } : {}),
    // ALWAYS the resolved style, never the reel's raw field. DemoClip resolves
    // an absent style to DEFAULT_STYLE ("proof", full-bleed), so a reel that
    // said only `look: "framed"` — or nothing — used to get framed CARDS and
    // full-bleed CLIPS (review 2). `look` is not passed: the style supersedes it.
    style: p.style,
    // The range is what lets a push know where the shot starts and ends:
    // --frames renders absolute frame numbers, so without it the envelope would
    // measure from the demo's frame 0.
    ...(shotPush ? { push: shotPush } : {}),
    // The pointer is honoured on BOTH paths (src/DemoClip.tsx): absent, a
    // windowed clip takes its style's shot.cursor/ripple. These used to be
    // dropped on the framed path, so every stage reel drew a ripple its preset
    // said it should not.
    ...(has("cursor") ? { cursor } : {}),
    ...(has("ripple") ? { ripple } : {}),
    // Absent at 16:9, so a native clip's props — and its cache key — are what
    // they were before aspects existed.
    ...(p.aspect ? { aspect: p.aspect } : {}),
    ...(open ? { open } : {}),
  };
  if (preset.shot.framing === "window") {
    // The range only matters to a push, an opening and a moving crop, which
    // all measure from the shot's first frame.
    const needsRange = shotPush || open || p.aspect;
    return { ...common, ...(needsRange ? { range: { first, last } } : {}) };
  }
  return {
    ...common,
    range: { first, last },
    ...(has("crop") ? { crop } : {}),
    ...(has("pageBg") ? { pageBg } : {}),
    ...(has("freeze") && freeze ? { freeze } : {}),
  };
}

/** Render (or reuse) every segment; returns their files in order. */
function renderSegments(p: Prepared, workDir: string, keep: Set<string>): string[] {
  const { reel, preset, log } = p;
  const footage = reel.segments.some(isClip) ? footageDigest(p.demo) : null;
  const size = aspectSize(compositionSize(log), p.aspect);

  return reel.segments.map((seg, i) => {
    const index = String(i + 1).padStart(2, "0");
    const kind = isCard(seg) ? "card" : "clip";
    // Keyed on exactly what the render receives. A card keys on its size too:
    // it is read from the demo's click log, and the concat needs it to match.
    const job = isCard(seg)
      ? {
          id: "Intro",
          props: {
            intro: reelCard(reel, seg.card),
            ...(p.aspect ? { aspect: p.aspect } : {}),
          },
          frames: undefined,
          key: { size },
        }
      : {
          id: "DemoClip",
          props: clipProps(p, i),
          frames: clipFrames(seg.clip, FPS),
          key: { footage },
        };
    const file = path.join(
      workDir,
      `${index}-${kind}-${digest({ props: job.props, frames: job.frames, ...job.key, src: segmentSourceDigest(kind) })}.mp4`,
    );
    keep.add(path.basename(file));
    if (fs.existsSync(file)) {
      console.log(`\n=== ${index} ${kind} (cached) ===`);
      return file;
    }
    console.log(`\n=== ${index} ${kind} ===`);
    if (isClip(seg) && (p.aspect || (preset.shot.framing !== "window" && seg.clip.crop))) {
      // Report the framing's cost in source pixels before spending minutes on
      // it. A `rect` framing derives its magnification from the component, so
      // it can silently ask for more resolution than the shoot has, and so
      // does a vertical crop of a 1x capture. See SHARPNESS_CEILING in
      // src/lib/crop.ts and the table in src/lib/aspect.ts.
      const up = clipUpscale(p, i);
      const how = up > SHARPNESS_CEILING ? "OVER the ceiling" : "ok";
      console.log(
        `    framing  -> ${up.toFixed(2)}x source->output (${how}, ceiling ${SHARPNESS_CEILING})`,
      );
    }
    // Rendered beside its final name and moved into place, so a render killed
    // half-way cannot leave a truncated segment the cache would then serve.
    const tmp = file.replace(/\.mp4$/, ".partial.mp4");
    renderComposition(job.id, tmp, job.props, job.frames ? { frames: job.frames } : {});
    fs.renameSync(tmp, file);
    return file;
  });
}

/** Cut `authored` to out/reel/<opts.outBase>.mp4 — or, with `check`, report it. */
export function cutReel(authored: Reel, opts: CutOptions): string | null {
  const p = prepare(authored, opts);
  if (opts.check) {
    report(p, authored, opts);
    return null;
  }
  const { reel, preset, log, speed, joins } = p;

  // One work dir per OUTPUT, so cutting a reel in a second style never prunes
  // the first style's cache.
  const workDir = path.join(ROOT, ".diag", "reel", opts.outBase);
  fs.mkdirSync(workDir, { recursive: true });
  const keep = new Set<string>();

  const parts = renderSegments(p, workDir, keep);

  // -c copy needs every part to agree, and so does the concat filter.
  const probes = parts.map(probe);
  for (let i = 1; i < probes.length; i++) {
    const mismatches = compareStreams(
      probes[0],
      probes[i],
      path.basename(parts[0]),
      path.basename(parts[i]),
    );
    if (mismatches.length)
      throw new Error(`Segments do not match and cannot be joined:\n  ${mismatches.join("\n  ")}`);
  }
  const counts = probes.map((pr) => frameCount(pr) ?? 0);
  counts.forEach((c, i) => {
    if (c !== p.counts[i])
      console.warn(
        `  ⚠️  segment ${i + 1} rendered ${c} frames, predicted ${p.counts[i]} — --check is off by that much`,
      );
  });

  // Arithmetic, not a probe: the overlays are placed in reel time and have to
  // be rendered before the finishing pass that produces the film.
  const expectedF = dissolvedFrameCount(counts, joins);
  const runtimeS = expectedF / FPS;
  // The overlays take the film's size, and at another aspect the 16:9 size too,
  // which their type is laid out against. Nothing at 16:9, so native layer
  // cache keys are unchanged.
  const native = compositionSize(log);
  const frame = p.aspect ? { size: aspectSize(native, p.aspect), native } : undefined;
  const layers = [
    hudLayer(reel, preset, counts, FPS, log, speed, joins, runtimeS, workDir, keep, frame),
    chipsLayer(p.chips, preset, runtimeS, workDir, keep, frame),
  ].filter((l): l is NonNullable<typeof l> => l != null);

  const out = outPath("reel", `${opts.outBase}.mp4`);
  const hasAudio = reelHasAudio(reel);
  // With audio, the picture is written to a silent intermediate (you cannot
  // mux a file onto itself) and the audio pass writes `out`.
  const videoOnly = hasAudio ? path.join(workDir, `${opts.outBase}.silent.mp4`) : out;
  keep.add(path.basename(videoOnly));

  const dissolving = joins.some((j) => j > 0);
  if (dissolving || layers.length) {
    // ONE encode: joins and overlays in a single graph, on the system ffmpeg
    // (the bundled Remotion build is filter-whitelisted and has no xfade).
    requireFilters(["concat", "xfade", "overlay"], "Joining a reel");
    execFileSync(
      "ffmpeg",
      buildFinishArgs(
        parts,
        counts,
        FPS,
        joins,
        layers.map((l) => l.file),
        videoOnly,
        p.preset.shot.ground
          ? { blends: p.blends, groundY: groundLuma(p.preset.shot.ground) }
          : undefined,
      ),
      { stdio: "inherit" },
    );
  } else {
    // Nothing to blend or composite: splice the packets, no re-encode at all.
    const list = path.join(workDir, "concat.txt");
    keep.add("concat.txt");
    fs.writeFileSync(list, parts.map((f) => `file '${f}'`).join("\n") + "\n");
    execFileSync(
      REMOTION_BIN,
      ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", videoOnly],
      { stdio: "inherit" },
    );
  }

  // Drop files from earlier cuts of THIS output so the dir cannot grow without
  // bound. Other styles of the same reel live in their own dirs.
  for (const stale of fs.readdirSync(workDir))
    if (!keep.has(stale)) fs.rmSync(path.join(workDir, stale));

  // concat is exact; xfade lands within a frame of the arithmetic per dissolve.
  const joined = frameCount(probe(videoOnly));
  const slack = joins.filter((j) => j > 0).length;
  if (joined != null && Math.abs(expectedF - joined) > slack)
    throw new Error(`Frame count mismatch: segments total ${expectedF}, output has ${joined}.`);

  const withAudio =
    hasAudio && muxAudio(reel, videoOnly, out, runtimeS, counts, FPS, log, speed, joins);
  if (hasAudio && !withAudio) console.log("audio      -> nothing audible resolved; silent");

  // Assert the FILE, not the recipe. Every segment passed its checks while the
  // xfade pass turned the film into 4:4:4 at 96 kHz; only the output shows that.
  const v0 = probes[0].streams.find((st) => st.codec_type === "video");
  const bad = deliveryProblems(probeDelivery(out), {
    width: v0?.width ?? 0,
    height: v0?.height ?? 0,
    fps: FPS,
    sampleRate: withAudio ? SAMPLE_RATE : null,
  });
  if (bad.length)
    throw new Error(`${path.relative(ROOT, out)} is not a deliverable film:\n  ${bad.join("\n  ")}`);

  reportLoudness(preset.source?.loudnessLUFS ?? null, withAudio ? out : null);

  const encode = dissolving || layers.length ? "1 encode" : "stream copy";
  console.log(
    `\nsegments   -> ${parts.length} (${counts.join(" + ")})` +
      (dissolving ? `  blend ${joins.filter((o) => o > 0).length}x` : "") +
      (layers.length ? `  + ${layers.map((l) => l.label).join(", ")}` : "") +
      `  · ${encode}`,
  );
  if (p.beats) console.log(beatsLine(p.beats));
  console.log(`frames     -> ${joined ?? expectedF}`);
  console.log(`runtime    -> ${runtimeS.toFixed(2)}s`);
  console.log(`reel       -> ${path.relative(ROOT, out)}`);
  return out;
}
