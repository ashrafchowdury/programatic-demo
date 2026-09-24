/**
 * The reel's transparent overlay layers — the step HUD and the annotation
 * chips — rendered once and cached, for the finishing graph to composite.
 *
 * Both span segments (they are placed in REEL time, and every segment renders
 * independently), so neither can be a segment prop. Remotion draws each alone
 * on a transparent ground: this ffmpeg has no `drawtext` (it needs
 * libfreetype), so burning text in was never available, and rendering it here
 * gets the repo's own type instead. ProRes 4444 because it carries alpha.
 *
 * These used to be two extra passes, each decoding and re-encoding the whole
 * film (segments -> xfade -> HUD -> chips: up to four h264 generations), and
 * neither was cached. Now each returns a layer and scripts/lib/xfade.ts puts
 * the joins and the layers through ONE encode.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ClickLog } from "../../src/lib/click-log";
import { chipProblem, type ReelChip } from "../../src/lib/chips";
import { hudSteps } from "../../src/lib/hud";
import type { ResolvedReel } from "../../src/lib/reel";
import type { StylePreset } from "../../src/lib/style";
import { renderComposition } from "./remotion";
import { digest, segmentSourceDigest, type SegmentKind } from "./reel-cache";

/** Render `id` with `props` into `workDir` unless an identical layer exists. */
function cachedLayer(
  kind: SegmentKind,
  id: string,
  props: unknown,
  workDir: string,
  keep: Set<string>,
): { file: string; cached: boolean } {
  const file = path.join(
    workDir,
    `${kind}-${digest({ props, src: segmentSourceDigest(kind) })}.mov`,
  );
  keep.add(path.basename(file));
  if (fs.existsSync(file)) return { file, cached: true };
  // Written beside its final name and moved into place, so a render killed
  // half-way cannot leave a truncated layer that the cache would then serve.
  const tmp = file.replace(/\.mov$/, ".partial.mov");
  renderComposition(id, tmp, props, { codec: "prores4444" });
  fs.renameSync(tmp, file);
  return { file, cached: false };
}

export type OverlayLayer = { file: string; label: string };

/** The film's size and its 16:9 size, when they differ (a non-native aspect). */
export type OverlayFrame = {
  size: { width: number; height: number };
  native: { width: number; height: number };
};

/**
 * The step HUD layer, or null when the style draws none or the log yields no
 * steps — a film with nothing to narrate composites nothing.
 */
export function hudLayer(
  reel: ResolvedReel,
  preset: StylePreset,
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  joins: number[],
  runtimeS: number,
  workDir: string,
  keep: Set<string>,
  frame?: OverlayFrame,
): OverlayLayer | null {
  if (preset.hud.kind !== "steps") return null;
  const steps = hudSteps(
    reel.segments,
    counts,
    fps,
    log,
    speed,
    runtimeS,
    joins,
    reel.hud?.skipLabels ?? [],
  );
  if (steps.length === 0) {
    console.log("hud        -> no labelled beats in any clip; skipped");
    return null;
  }
  const props = {
    steps,
    ink: preset.palette.plain.ink,
    totalS: runtimeS,
    ...(frame ? { size: frame.size, designWidth: frame.native.width } : {}),
  };
  const { file, cached } = cachedLayer("hud", "HudOverlay", props, workDir, keep);
  console.log(`hud        -> ${steps.length} step(s)${cached ? " (cached)" : ""}`);
  return { file, label: "hud" };
}

/** Every chip problem, before anything renders. */
export function chipsProblem(chips: ReelChip[], runtimeS: number): string | null {
  for (const c of chips) {
    const problem = chipProblem(c, runtimeS);
    if (problem) return problem;
  }
  return null;
}

/**
 * The annotation-chip layer, or null when the style has no chip look or the
 * reel authored none. `chips` are resolved (scripts/lib/reel-cut.ts): reel
 * seconds, cut to their shots, placed for the aspect. Chips ride ON TOP of the HUD: both are transparent, so
 * the order only matters where they overlap, and a step line is the smaller,
 * quieter object of the two.
 */
export function chipsLayer(
  chips: ReelChip[],
  preset: StylePreset,
  runtimeS: number,
  workDir: string,
  keep: Set<string>,
  frame?: OverlayFrame,
): OverlayLayer | null {
  const style = preset.annotation;
  if (chips.length === 0) return null;
  if (!style) {
    // reel-cut's prepare already refused this, or warned under --style; say
    // it again where the layer is skipped so the log shows why nothing drew.
    console.log(`chips      -> ${chips.length} authored; this style has no annotation look, none drawn`);
    return null;
  }
  // Validated before rendering. A chip placed outside the frame or past the end
  // of the film renders nothing at all, which is a silent way to lose one.
  const problem = chipsProblem(chips, runtimeS);
  if (problem) throw new Error(problem);
  const props = {
    chips,
    style,
    totalS: runtimeS,
    ...(frame ? { size: frame.size, designHeight: frame.native.height } : {}),
  };
  const { file, cached } = cachedLayer("chips", "ChipOverlay", props, workDir, keep);
  console.log(`chips      -> ${chips.length}${cached ? " (cached)" : ""}`);
  return { file, label: "chips" };
}
