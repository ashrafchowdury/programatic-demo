/**
 * Chunked rendering, so a fix re-renders seconds instead of the whole film.
 *
 * A DemoClip render — the whole demo, or one clip range of a reel — is cut on a
 * fixed grid into chunks of `chunkFrames` (DEMO_CHUNK_S, default 2s), counted
 * from the range's first frame. Every chunk is its own cache file, keyed by
 * what draws it plus its frames. The missing chunks of a range render in ONE
 * `remotion render` per contiguous run, with an IDR forced on every chunk
 * boundary (remotion.config.ts), and the run is cut into chunk files by stream
 * copy; the chunks are then spliced back into the range by stream copy. Neither
 * cut re-encodes, so a full render costs what it did before: one Remotion call.
 * (Measured on smoke: split + splice is frame-for-frame identical to the run.)
 *
 * That alone only helps when what changed is local — a longer range renders
 * just its new chunks. A code fix changes the key of EVERY chunk, so it would
 * re-render everything. `--patch` is the escape hatch: chunks overlapping the
 * patch window render under the new key, and every other chunk is reused from
 * the previous cut (chunks.json) though its key is stale. That is a deliberate
 * lie the run says out loud; the next cut without --patch renders the stale
 * chunks clean. Each patched edge that jumps is reported (seamReport), because
 * a fix whose effect reaches past the window shows as a jump there.
 *
 * Every frame of a Remotion composition is a pure function of its props and
 * its frame number, which is what makes rendering a range in pieces safe.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { frameCount, probe } from "./ffmpeg";
import { digest } from "./reel-cache";
import { REMOTION_BIN, renderComposition } from "./remotion";

/** Inclusive frame range, in the composition's absolute frames. */
export type Range = { first: number; last: number };

/** Chunk length in frames: DEMO_CHUNK_S seconds (default 2) at `fps`. */
export function resolveChunkFrames(fps: number, raw?: string): number {
  const s = raw != null && raw !== "" ? Number(raw) : 2;
  if (!Number.isFinite(s) || s <= 0) throw new Error(`DEMO_CHUNK_S=${raw} is not a positive number of seconds`);
  return Math.max(1, Math.round(s * fps));
}

/** `range` cut on a grid of `size` frames from its first frame; the last chunk may be short. */
export function planChunks(range: Range, size: number): Range[] {
  const out: Range[] = [];
  for (let f = range.first; f <= range.last; f += size)
    out.push({ first: f, last: Math.min(f + size - 1, range.last) });
  return out;
}

export const overlaps = (a: Range, b: Range): boolean => a.first <= b.last && b.first <= a.last;

/** Indices where `need` is true, grouped into contiguous runs. */
export function contiguousRuns(need: boolean[]): number[][] {
  const runs: number[][] = [];
  need.forEach((n, i) => {
    if (!n) return;
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else runs.push([i]);
  });
  return runs;
}

/** A window of the output timeline, in seconds. */
export type PatchWindow = { fromS: number; toS: number };

/** "12.4", "1:02.5" → seconds. */
function parseTime(raw: string): number {
  const parts = raw.trim().split(":");
  if (parts.length > 2 || parts.some((p) => p === "" || !Number.isFinite(Number(p))))
    throw new Error(`--patch: "${raw}" is not a time (seconds, or m:ss)`);
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/**
 * `--patch` → windows. Comma-separated; each is `from-to` or a single time
 * (the chunk around it): "12.4-15", "12.4-15,31", "1:02-1:05".
 */
export function parsePatch(spec: string): PatchWindow[] {
  const windows = spec.split(",").map((part) => {
    const [a, b, extra] = part.split("-");
    if (extra !== undefined || a == null) throw new Error(`--patch: "${part}" is not from-to`);
    const fromS = parseTime(a);
    const toS = b === undefined ? fromS : parseTime(b);
    if (toS < fromS) throw new Error(`--patch: "${part}" ends before it starts`);
    return { fromS, toS };
  });
  if (!windows.length) throw new Error("--patch needs a window, e.g. --patch=12.4-15");
  return windows;
}

/** The `--patch=` value in argv, parsed, or null. */
export function patchFlag(argv: string[]): PatchWindow[] | null {
  const raw = argv.find((a) => a.startsWith("--patch="))?.slice("--patch=".length);
  return raw == null ? null : parsePatch(raw);
}

/**
 * A window of output time → the composition frames it covers, for a range
 * that starts at `startS` on the output timeline and at frame `range.first`
 * of the composition. Null when the window misses the range.
 */
export function windowFrames(w: PatchWindow, startS: number, range: Range, fps: number): Range | null {
  const first = range.first + Math.floor((w.fromS - startS) * fps + 1e-6);
  const last = range.first + Math.ceil((w.toS - startS) * fps - 1e-6);
  const hit = { first: Math.max(first, range.first), last: Math.min(Math.max(first, last), range.last) };
  return hit.first <= hit.last ? hit : null;
}

/** One chunk of the last cut, as chunks.json records it. */
export type ChunkRecord = Range & { file: string };

/**
 * What a range was rendered as in the last cut. `guard` is everything that
 * must still hold for its chunks to splice beside new ones — the footage, the
 * size, the grid — so a re-shoot can never be patched over.
 */
export type ManifestEntry = { guard: string; chunks: ChunkRecord[] };
export type Manifest = Record<string, ManifestEntry>;

export const readManifest = (dir: string): Manifest => {
  const file = path.join(dir, "chunks.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
  } catch {
    return {};
  }
};

export const writeManifest = (dir: string, m: Manifest, keep: Set<string>): void => {
  fs.writeFileSync(path.join(dir, "chunks.json"), JSON.stringify(m, null, 2) + "\n");
  keep.add("chunks.json");
};

export type ChunkPlan = {
  chunk: Range;
  /** reuse: this key's file exists. stale: the last cut's, kept by --patch. render: neither. */
  action: "reuse" | "stale" | "render";
  file: string;
};

/**
 * Decide each chunk. Pure apart from `exists`, so the rules are testable:
 * the current key's file always wins; under a patch, a chunk outside every
 * window takes the last cut's file for the same frames when its guard holds.
 */
export function decideChunks(opts: {
  chunks: Range[];
  fileFor: (c: Range) => string;
  exists: (file: string) => boolean;
  patch: Range[] | null;
  previous: ManifestEntry | undefined;
  guard: string;
}): ChunkPlan[] {
  const { chunks, fileFor, exists, patch, previous, guard } = opts;
  const old = previous?.guard === guard ? previous.chunks : [];
  return chunks.map((chunk) => {
    const file = fileFor(chunk);
    if (exists(file)) return { chunk, action: "reuse", file };
    if (patch && !patch.some((w) => overlaps(w, chunk))) {
      const prior = old.find((r) => r.first === chunk.first && r.last === chunk.last);
      if (prior && exists(prior.file)) return { chunk, action: "stale", file: prior.file };
    }
    return { chunk, action: "render", file };
  });
}

let segmentMuxer: boolean | null = null;

/** Whether the system ffmpeg can cut a file at given frames (the bundled one cannot). */
function hasSegmentMuxer(): boolean {
  if (segmentMuxer == null) {
    try {
      const out = execFileSync("ffmpeg", ["-hide_banner", "-muxers"], { encoding: "utf8" });
      segmentMuxer = /^\s*E\s+segment\b/m.test(out);
    } catch {
      segmentMuxer = false;
    }
    if (!segmentMuxer)
      console.warn(
        "  ⚠️  no system ffmpeg with the segment muxer: each chunk renders as its own call (slower). `brew install ffmpeg`.",
      );
  }
  return segmentMuxer;
}

/** Splice `files` into `out` by stream copy (written beside it, then moved). */
export function spliceFiles(files: string[], out: string): void {
  const tmp = out.replace(/\.mp4$/, ".partial.mp4");
  if (files.length === 1) fs.copyFileSync(files[0], tmp);
  else {
    const list = out.replace(/\.mp4$/, ".concat.txt");
    fs.writeFileSync(list, files.map((f) => `file '${f}'`).join("\n") + "\n");
    execFileSync(
      REMOTION_BIN,
      ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tmp],
      { stdio: "inherit" },
    );
    fs.rmSync(list);
  }
  fs.renameSync(tmp, out);
}

/** Render chunks `run` (contiguous) in one call and cut the result into their files. */
function renderRun(job: ChunkJob, run: ChunkPlan[], size: number): void {
  const range = { first: run[0].chunk.first, last: run[run.length - 1].chunk.last };
  const tmp = path.join(job.dir, `${job.name}-run-${range.first}-${range.last}.partial.mp4`);
  renderComposition(job.id, tmp, job.props, {
    frames: range,
    keyframeEvery: size,
    ...(job.scale != null && job.scale !== 1 ? { scale: job.scale } : {}),
  });
  if (run.length === 1) {
    fs.renameSync(tmp, run[0].file);
    return;
  }
  const pattern = tmp.replace(/\.partial\.mp4$/, "-%03d.piece.mp4");
  const cuts = run.slice(1).map((p) => p.chunk.first - range.first);
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", tmp, "-map", "0:v", "-c", "copy", "-f", "segment",
      "-segment_frames", cuts.join(","), "-reset_timestamps", "1", "-segment_format", "mp4",
      "-segment_format_options", "movflags=+faststart", pattern],
    { stdio: "inherit" },
  );
  run.forEach((p, i) => {
    const piece = pattern.replace("%03d", String(i).padStart(3, "0"));
    const want = p.chunk.last - p.chunk.first + 1;
    const got = fs.existsSync(piece) ? frameCount(probe(piece)) : null;
    if (got !== want)
      throw new Error(
        `chunk ${p.chunk.first}-${p.chunk.last} came out ${got ?? "missing"} frames, want ${want} — ` +
          "the keyframe grid did not hold (is DEMO_KEYFRAME_EVERY reaching remotion.config.ts?)",
      );
    fs.renameSync(piece, p.file);
  });
  fs.rmSync(tmp);
}

export type ChunkJob = {
  /** Composition id, e.g. "DemoClip". */
  id: string;
  props: unknown;
  range: Range;
  scale?: number;
  /** Work dir the chunks, the spliced range and chunks.json live in. */
  dir: string;
  /** File prefix and manifest name, unique within `dir`: "02-clip", "demo". */
  name: string;
  /** Digest of everything that draws a frame, except which frame. */
  key: string;
  /** Digest of what must hold for a stale chunk to splice beside a new one. */
  guard: string;
  fps: number;
  /** --patch windows, in this range's composition frames; null renders normally. */
  patch: Range[] | null;
  manifest: Manifest;
  /** The manifest the next cut reads; this job writes its own entry. */
  nextManifest: Manifest;
  keep: Set<string>;
};

export type ChunkResult = {
  /** The whole range, spliced. */
  file: string;
  plans: ChunkPlan[];
  /** Boundaries between a freshly rendered chunk and a stale one: the first frame after each. */
  patchedEdges: number[];
};

/** Render (or reuse) every chunk of `job.range` and splice them into one file. */
export function renderChunked(job: ChunkJob): ChunkResult {
  const size = resolveChunkFrames(job.fps, process.env.DEMO_CHUNK_S);
  const chunks = planChunks(job.range, size);
  const plans = decideChunks({
    chunks,
    fileFor: (c) => path.join(job.dir, `${job.name}-${job.key}-${c.first}-${c.last}.mp4`),
    exists: fs.existsSync,
    patch: job.patch,
    previous: job.manifest[job.name],
    guard: job.guard,
  });

  const need = plans.map((p) => p.action === "render");
  const missing = plans.filter((p, i) => need[i] && job.patch && !job.patch.some((w) => overlaps(w, p.chunk)));
  if (missing.length)
    console.warn(
      `  ⚠️  ${job.name}: ${missing.length} chunk(s) outside the patch have no earlier render to reuse` +
        (job.manifest[job.name] && job.manifest[job.name].guard !== job.guard
          ? " (the footage, size or chunk grid changed since the last cut)"
          : "") +
        "; rendering them too",
    );
  const counts = { reuse: 0, stale: 0, render: 0 };
  for (const p of plans) counts[p.action]++;
  console.log(
    `    chunks   -> ${plans.length} × ${size}f: ${counts.render} render, ${counts.reuse} cached` +
      (counts.stale ? `, ${counts.stale} kept from the last cut (patch)` : ""),
  );

  const runs = hasSegmentMuxer() ? contiguousRuns(need) : contiguousRuns(need).flatMap((r) => r.map((i) => [i]));
  for (const run of runs) renderRun(job, run.map((i) => plans[i]), size);

  for (const p of plans) job.keep.add(path.basename(p.file));
  const file = path.join(job.dir, `${job.name}-${digest(plans.map((p) => path.basename(p.file)))}.mp4`);
  job.keep.add(path.basename(file));
  if (!fs.existsSync(file)) spliceFiles(plans.map((p) => p.file), file);

  job.nextManifest[job.name] = { guard: job.guard, chunks: plans.map((p) => ({ ...p.chunk, file: p.file })) };
  const fresh = (p: ChunkPlan) => p.action !== "stale";
  const patchedEdges = plans.flatMap((p, i) =>
    i > 0 && fresh(plans[i - 1]) !== fresh(p) ? [p.chunk.first] : [],
  );
  return { file, plans, patchedEdges };
}

/**
 * How far two 8-bit grey frames `width` wide differ where they differ most:
 * the mean absolute difference of the worst `block`-square tile. A whole-frame
 * mean missed the case that matters — a fix that removed the cursor moved the
 * frame mean by 0.1, level with encoder noise.
 */
export function blockDiff(a: Buffer, b: Buffer, width: number, block = 16): number {
  const height = Math.floor(a.length / width);
  let worst = 0;
  for (let by = 0; by < height; by += block)
    for (let bx = 0; bx < width; bx += block) {
      let s = 0;
      let n = 0;
      for (let y = by; y < Math.min(by + block, height); y++)
        for (let x = bx; x < Math.min(bx + block, width); x++, n++) s += Math.abs(a[y * width + x] - b[y * width + x]);
      worst = Math.max(worst, s / n);
    }
  return worst;
}

/**
 * Whether the cut at `frame` jumps. Compares the two frames across the seam
 * against the frame-to-frame motion just inside it on both sides: ordinary
 * motion moves all three alike, a fix that reached past the patch moves only
 * the seam. Null when the system ffmpeg cannot decode it.
 */
export function seamJump(spliced: string, frame: number, rangeFirst: number): { seam: number; motion: number } | null {
  const local = frame - rangeFirst;
  if (local < 2) return null;
  const W = 320;
  try {
    const raw = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", spliced, "-vf", `select='between(n\\,${local - 2}\\,${local + 1})',scale=${W}:-2,format=gray`,
        "-vsync", "0", "-f", "rawvideo", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const n = raw.length / 4;
    if (!Number.isInteger(n) || n === 0) return null;
    const f = [0, 1, 2, 3].map((i) => raw.subarray(i * n, (i + 1) * n));
    return {
      seam: blockDiff(f[1], f[2], W),
      motion: Math.max(blockDiff(f[0], f[1], W), blockDiff(f[2], f[3], W)),
    };
  } catch {
    return null;
  }
}

/** A seam jumps when it moves well past the motion either side of it. */
export const jumps = (j: { seam: number; motion: number }): boolean => j.seam > 3 * j.motion + 2;

/**
 * Report every patched edge: fine, or a jump with the window to widen to.
 * `atS` turns a composition frame into a time on the output timeline.
 */
export function seamReport(file: string, edges: number[], rangeFirst: number, atS: (frame: number) => number): void {
  for (const edge of edges) {
    const j = seamJump(file, edge, rangeFirst);
    const t = atS(edge).toFixed(2);
    if (j == null) console.log(`    seam     -> ${t}s not checked (no system ffmpeg)`);
    else if (jumps(j))
      console.warn(
        `  ⚠️  seam at ${t}s JUMPS (${j.seam.toFixed(1)} vs ${j.motion.toFixed(1)} motion): ` +
          "the fix reaches past the patch — widen --patch over it, or cut without --patch",
      );
    else console.log(`    seam     -> ${t}s clean (${j.seam.toFixed(1)} vs ${j.motion.toFixed(1)} motion)`);
  }
}
