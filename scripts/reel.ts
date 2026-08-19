/**
 * Cuts a reel: title cards interleaved with ranges of an already-rendered demo.
 *
 *   reels/<name>.ts  ->  out/<name>.reel.mp4
 *
 * Clip segments are RE-RENDERED from the DemoClip composition with --frames
 * rather than cut out of out/<name>.mp4 with ffmpeg. Both are frame-accurate;
 * re-rendering costs the same total frames as one full render and adds no second
 * h264 generation to footage that was tuned at CRF 16. Cutting would have been
 * faster per iteration, which is why the segment cache below exists instead.
 *
 * Every segment is cached under .diag/reel/<name>/ keyed by a hash of its own
 * spec, so editing one card's copy re-renders that card and nothing else. This
 * is what makes iterating on the script cheap: the first cut costs a full
 * render, every later one costs a few seconds per changed card.
 *
 * Usage: pnpm reel <name>   (default: agent-skill)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePlaybackRate, type ClickLog } from "../src/lib/click-log";
import {
  clipFrames,
  isCard,
  reelProblem,
  SFX_KINDS,
  type Reel,
  type ReelAudioPiece,
  type ReelSegment,
} from "../src/lib/reel";
import {
  buildAudioMux,
  clickReelTimes,
  missingAudioFilters,
  resolvePiece,
  segmentBoundsSeconds,
  type ResolvedPiece,
} from "../src/lib/reel-audio";
import { compareStreams, type FileProbe } from "./lib/stitch";
import { outPath, outPathOf } from "./lib/out";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");
const FPS = 30;

const PROBE_KEYS =
  "stream=codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,nb_frames";

function probe(file: string): FileProbe {
  const out = execFileSync(
    REMOTION_BIN,
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      PROBE_KEYS,
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as FileProbe;
}

const frameCount = (p: FileProbe): number | null => {
  const v = p.streams.find((s) => s.codec_type === "video") as
    | { nb_frames?: string }
    | undefined;
  const n = v?.nb_frames != null ? Number(v.nb_frames) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function loadReel(name: string): Promise<Reel> {
  const reelPath = path.join(ROOT, "reels", `${name}.ts`);
  if (!fs.existsSync(reelPath))
    throw new Error(`No reel file at reels/${name}.ts`);
  return (await import(pathToFileURL(reelPath).href)).default as Reel;
}

function resolveGl(raw?: string): string {
  return raw != null && raw !== "" ? raw : "angle";
}

const digest = (value: unknown): string =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 10);

/**
 * Source files a segment's appearance depends on.
 *
 * Hashing the storyboard alone is not enough: edit src/Intro.tsx and every card
 * still has the same spec, so the cache would serve the old render and the reel
 * would silently not reflect the change. Hashing the code that draws it closes
 * that hole. Split by kind so retouching a card does not invalidate the clips,
 * which are the expensive half.
 */
const SOURCES = {
  // Must list the TRANSITIVE set, not just the obvious two: Intro.tsx draws the
  // backdrop from DemoClip, eases with lib/camera, sizes against lib/click-log,
  // and a chip card renders the shared Cursor. Miss one and editing it serves a
  // stale cached card — the exact failure this hash exists to prevent.
  card: [
    "src/Intro.tsx",
    "src/lib/intro.ts",
    "src/lib/camera.ts",
    "src/lib/click-log.ts",
    "src/Cursor.tsx",
    "src/lib/cursor.ts",
    "src/DemoClip.tsx",
    "src/WindowFrame.tsx",
    "src/lib/window.ts",
  ],
  clip: [
    "src/DemoClip.tsx",
    "src/WindowFrame.tsx",
    "src/lib/window.ts",
    "src/Cursor.tsx",
    "src/lib/zoom.ts",
    "src/lib/camera.ts",
    "src/lib/cursor.ts",
    "src/lib/click-log.ts",
  ],
} as const;

const sourceDigest = (kind: "card" | "clip"): string =>
  digest(SOURCES[kind].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")));

/**
 * Content hash of the FOOTAGE a clip is rendered from — the converted recording
 * and its click log. Folded into the clip cache key so a re-shoot invalidates
 * cached clips: without it, `sourceDigest` only sees the source code, so new
 * footage under an unchanged clip spec would silently serve the old segment.
 * Read as bytes, not utf8 — the mp4 is binary.
 */
const footageDigest = (name: string): string =>
  createHash("sha1")
    .update(fs.readFileSync(path.join(ROOT, "public", `${name}.mp4`)))
    .update(fs.readFileSync(path.join(ROOT, "public", `${name}.clicks.json`)))
    .digest("hex")
    .slice(0, 10);

function render(args: string[], out: string): void {
  execFileSync(
    REMOTION_BIN,
    [
      ...args,
      out,
      "--crf=16",
      `--gl=${resolveGl(process.env.DEMO_GL)}`,
      "--muted",
    ],
    { stdio: "inherit" },
  );
}

async function main() {
  const name = process.argv[2] ?? "agent-skill";
  const reel = await loadReel(name);

  const demo = outPathOf("demo", `${name}.mp4`);
  if (!fs.existsSync(demo))
    throw new Error(
      `Missing ${path.relative(ROOT, demo)} — the reel cuts ranges out of the ` +
        `demo, so render it first with \`pnpm render ${name}\`.`,
    );
  const total = frameCount(probe(demo));
  if (total == null)
    throw new Error(`Could not read a frame count from ${demo}`);

  // Clip ranges are frame numbers into a timeline whose length depends on the
  // playback rate. If the demo on disk was rendered at a different DEMO_SPEED
  // than this run would use, every range in the reel points somewhere else.
  const speed = resolvePlaybackRate(process.env.DEMO_SPEED);
  const log = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public", `${name}.clicks.json`), "utf8"),
  ) as ClickLog;
  const expected = Math.max(
    1,
    Math.ceil((log.durationMs / 1000 / speed) * FPS),
  );
  if (expected !== total)
    throw new Error(
      `${path.relative(ROOT, demo)} has ${total} frames, but DEMO_SPEED=${speed} ` +
        `would render ${expected}. The reel's clip ranges were timed against the ` +
        `file on disk — re-render the demo at this speed, or unset DEMO_SPEED.`,
    );

  const problem = reelProblem(reel, total, FPS);
  if (problem) throw new Error(`reels/${name}.ts: ${problem}`);
  if (reel.name !== name)
    throw new Error(
      `reels/${name}.ts has name "${reel.name}" — it must match the file name.`,
    );

  const workDir = path.join(ROOT, ".diag", "reel", name);
  fs.mkdirSync(workDir, { recursive: true });

  // Computed once: the footage every clip in this reel is cut from.
  const footage = footageDigest(name);

  const parts: string[] = [];
  const keep = new Set<string>();
  reel.segments.forEach((segment: ReelSegment, i) => {
    const index = String(i + 1).padStart(2, "0");
    const kind: "card" | "clip" = isCard(segment) ? "card" : "clip";
    // Hashing the segment spec (and the speed, which moves clip ranges) is what
    // makes the cache safe: change the copy, get a new filename, re-render. A
    // clip also keys on the footage digest, so a re-shoot re-renders it; a card
    // draws no footage, so its key is left untouched (its cache stays valid).
    const key =
      kind === "clip"
        ? { segment, speed, src: sourceDigest(kind), footage }
        : { segment, speed, src: sourceDigest(kind) };
    const file = path.join(workDir, `${index}-${kind}-${digest(key)}.mp4`);
    keep.add(path.basename(file));
    parts.push(file);

    if (fs.existsSync(file)) {
      console.log(`\n=== ${index} ${kind} (cached) ===`);
      return;
    }
    console.log(`\n=== ${index} ${kind} ===`);
    if (isCard(segment)) {
      render(
        [
          "render",
          "Intro",
          `--props=${JSON.stringify({ intro: segment.card })}`,
        ],
        file,
      );
    } else {
      const { first, last } = clipFrames(segment.clip, FPS);
      const { drift } = segment.clip;
      render(
        [
          "render",
          "DemoClip",
          // The key is omitted when unset, so a clip without drift renders with
          // exactly the props scripts/render.ts uses.
          `--props=${JSON.stringify({ name, speed, ...(drift != null ? { drift } : {}) })}`,
          `--frames=${first}-${last}`,
        ],
        file,
      );
    }
  });

  // Drop segments from earlier cuts so the work dir cannot grow without bound.
  for (const stale of fs.readdirSync(workDir))
    if (!keep.has(stale)) fs.rmSync(path.join(workDir, stale));

  // Same contract as scripts/stitch.ts: -c copy needs every part to agree.
  const probes = parts.map(probe);
  for (let i = 1; i < probes.length; i++) {
    const mismatches = compareStreams(
      probes[0],
      probes[i],
      path.basename(parts[0]),
      path.basename(parts[i]),
    );
    if (mismatches.length)
      throw new Error(
        `Segments do not match and cannot be concatenated:\n  ` +
          mismatches.join("\n  "),
      );
  }

  const list = path.join(workDir, "concat.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n") + "\n");
  const out = outPath("reel", `${name}.mp4`);

  // With audio, the -c copy concat writes a SILENT intermediate (you cannot mux
  // a file onto itself), and the audio pass below reads it and writes `out`.
  // Both live in workDir like concat.txt — created after the prune, overwritten
  // each run. No audio → the concat writes `out` directly, byte-for-byte as before.
  const hasAudio =
    (Array.isArray(reel.audio) && reel.audio.length > 0) || reel.sfx != null;
  const videoOnly = hasAudio ? path.join(workDir, `${name}.silent.mp4`) : out;
  execFileSync(
    REMOTION_BIN,
    [
      "ffmpeg",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      videoOnly,
    ],
    { stdio: "inherit" },
  );

  const counts = probes.map(frameCount);
  const sum = counts.reduce((a: number, b) => a + (b ?? 0), 0);
  const joined = frameCount(probe(videoOnly));
  if (joined != null && sum !== joined)
    throw new Error(
      `Frame count mismatch: segments total ${sum}, output has ${joined}.`,
    );

  const runtimeS = (joined ?? sum) / FPS;
  if (hasAudio)
    muxAudio(
      reel,
      videoOnly,
      out,
      runtimeS,
      counts.map((c) => c ?? 0),
      log,
      speed,
    );

  console.log(
    `\nsegments   -> ${parts.length} (${counts.map((c) => c ?? "?").join(" + ")})`,
  );
  console.log(`runtime    -> ${runtimeS.toFixed(1)}s`);
  console.log(`reel       -> ${path.relative(ROOT, out)}`);
}

/**
 * Mix reel.audio onto the silent cut, on the SYSTEM ffmpeg (the bundled remotion
 * build has no audio filters). Probes each source's real duration so fades and
 * lengths resolve exactly, then runs one filtergraph → `out`.
 */
function muxAudio(
  reel: Reel,
  videoOnly: string,
  out: string,
  totalReelS: number,
  counts: number[],
  log: ClickLog,
  speed: number,
): void {
  requireFfmpegAudio();
  const bounds = segmentBoundsSeconds(counts, FPS);
  const resolved: ResolvedPiece[] = [];
  const paths: string[] = [];
  const durCache = new Map<string, number>();

  const add = (piece: ReelAudioPiece) => {
    const abs = path.join(ROOT, "public", piece.src);
    if (!fs.existsSync(abs))
      throw new Error(
        `Missing audio file ${path.relative(ROOT, abs)} (src "${piece.src}").`,
      );
    let dur = durCache.get(abs);
    if (dur == null) {
      dur = audioDurationS(abs);
      durCache.set(abs, dur);
    }
    const r = resolvePiece(piece, totalReelS, dur, bounds);
    if (r.durationS > 0) {
      resolved.push(r);
      paths.push(abs);
    }
  };

  // Authored music/voice pieces.
  for (const piece of reel.audio ?? []) add(piece);

  // SFX from the click log — each matching beat becomes an "sfx" piece. Kinds in
  // SFX_LABEL_KINDS place only via atLabels; the rest use their built-in detector.
  if (reel.sfx) {
    for (const kind of SFX_KINDS) {
      const cue = reel.sfx[kind];
      if (!cue) continue;
      for (const t of clickReelTimes(
        reel.segments,
        counts,
        FPS,
        log,
        speed,
        kind,
        cue.atLabels,
      ))
        add({
          src: cue.src,
          start: t,
          gain: cue.gain,
          fadeOutS: cue.fadeOutS,
          role: "sfx",
        });
    }
  }

  if (resolved.length === 0) {
    // Nothing audible resolved — ship the silent cut unchanged.
    fs.copyFileSync(videoOnly, out);
    return;
  }
  const { inputs, filter, mapArgs } = buildAudioMux(resolved, paths, videoOnly, {
    loudnessLUFS: reel.loudnessLUFS,
    duck: reel.duck,
  });
  execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, ...mapArgs, out], {
    stdio: "inherit",
  });
  const sfx = resolved.filter((r) => r.role === "sfx").length;
  console.log(
    `audio      -> ${resolved.length} piece(s) mixed` +
      (sfx ? ` (${sfx} sfx)` : "") +
      (reel.duck ? " · ducked" : "") +
      (reel.loudnessLUFS != null ? ` @ ${reel.loudnessLUFS} LUFS` : ""),
  );
}

/** Fail with the fix, not a stack trace, when the system ffmpeg is too minimal. */
function requireFfmpegAudio(): void {
  let filters = "";
  try {
    filters = execFileSync("ffmpeg", ["-hide_banner", "-filters"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      "Reel audio needs a system ffmpeg on PATH — `brew install ffmpeg`.",
    );
  }
  const missing = missingAudioFilters(filters);
  if (missing.length)
    throw new Error(
      `This ffmpeg build lacks the ${missing.join(", ")} audio filter(s). ` +
        "Install a full build: `brew install ffmpeg`.",
    );
}

/** Source duration in seconds, via the system ffprobe. */
function audioDurationS(file: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0)
    throw new Error(`Could not read audio duration from ${path.relative(ROOT, file)}.`);
  return d;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
