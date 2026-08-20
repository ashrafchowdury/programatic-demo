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
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  OUTPUT_WIDTH,
  resolvePlaybackRate,
  type ClickLog,
} from "../src/lib/click-log";
import { cropUpscale, SHARPNESS_CEILING } from "../src/lib/crop";
import { hudSteps } from "../src/lib/hud";
import { resolvePreset, type StylePreset } from "../src/lib/style";
import type { PushSpec } from "../src/lib/push";
import { buildXfadeFilter, dissolvedFrameCount, joinable } from "./lib/xfade";
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
const DEFAULT_DISSOLVE_F = 6;
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
  // backdrop from DemoClip (which names the image via lib/backdrop), eases with
  // lib/camera, sizes against lib/click-log, enters and leaves on lib/push,
  // colours itself from lib/look, and a chip card renders the shared Cursor
  // while an items[] card renders RecapCard. Miss one and editing it serves a
  // stale cached card — the exact failure this hash exists to prevent.
  card: [
    "src/Intro.tsx",
    "src/lib/intro.ts",
    "src/lib/camera.ts",
    "src/lib/click-log.ts",
    "src/lib/push.ts",
    "src/lib/look.ts",
    "src/lib/style.ts",
    "src/Cursor.tsx",
    "src/lib/cursor.ts",
    "src/RecapCard.tsx",
    "src/DemoClip.tsx",
    "src/lib/backdrop.ts",
    "src/WindowFrame.tsx",
    "src/lib/window.ts",
  ],
  // Same rule on this side: the full-bleed path overlays KeycapHUD, and both
  // paths push in on lib/push, tint from lib/look, and pick a backdrop image
  // through lib/backdrop.
  clip: [
    "src/DemoClip.tsx",
    "src/lib/backdrop.ts",
    "src/KeycapHUD.tsx",
    "src/WindowFrame.tsx",
    "src/lib/window.ts",
    "src/Cursor.tsx",
    "src/lib/zoom.ts",
    "src/lib/camera.ts",
    "src/lib/cursor.ts",
    "src/lib/click-log.ts",
    "src/lib/push.ts",
    "src/lib/look.ts",
    "src/lib/style.ts",
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
  const preset = resolvePreset(reel);

  reel.segments.forEach((segment: ReelSegment, i) => {
    const index = String(i + 1).padStart(2, "0");
    const kind: "card" | "clip" = isCard(segment) ? "card" : "clip";
    // Hashing the segment spec (and the speed, which moves clip ranges) is what
    // makes the cache safe: change the copy, get a new filename, re-render. A
    // clip also keys on the footage digest, so a re-shoot re-renders it; a card
    // draws no footage, so its key is left untouched (its cache stays valid).
    // `look` lives on the reel, not the segment, so it has to be hashed
    // explicitly — otherwise flipping the reel's look would serve every
    // segment from cache. Folded in only when set, so an unopted reel keeps
    // the keys (and therefore the cached segments) it already has.
    // `style` is folded in AFTER `look` and only when set, so a reel that never
    // mentions a style serialises byte-for-byte the key it always has — and
    // therefore keeps every cached segment it already has on disk.
    const lookKey = reel.look ? { look: reel.look } : {};
    const styleKey = reel.style ? { style: reel.style } : {};
    const key =
      kind === "clip"
        ? { segment, speed, src: sourceDigest(kind), footage, ...lookKey, ...styleKey }
        : { segment, speed, src: sourceDigest(kind), ...lookKey, ...styleKey };
    const file = path.join(workDir, `${index}-${kind}-${digest(key)}.mp4`);
    keep.add(path.basename(file));
    parts.push(file);

    if (fs.existsSync(file)) {
      console.log(`\n=== ${index} ${kind} (cached) ===`);
      return;
    }
    console.log(`\n=== ${index} ${kind} ===`);
    if (isCard(segment)) {
      // The card carries the reel's look unless it overrode it itself, so an
      // author sets the language once on the reel. Spread first so a card can
      // still opt out of a full-bleed reel.
      // Reel-level first so a CARD can still override either field on its own.
      const card = {
        ...(reel.look ? { look: reel.look } : {}),
        ...(reel.style ? { style: reel.style } : {}),
        ...segment.card,
      };
      render(
        ["render", "Intro", `--props=${JSON.stringify({ intro: card })}`],
        file,
      );
    } else {
      const { first, last } = clipFrames(segment.clip, FPS);
      const { drift, crop, push, pageBg, cursor, ripple, freeze } =
        segment.clip;
      // Report the framing's cost in source pixels before spending minutes on
      // it. A `rect` framing derives its magnification from the component, so
      // it can silently ask for more resolution than the shoot has — which is
      // exactly the trade the author should be making on purpose. See
      // SHARPNESS_CEILING in src/lib/crop.ts.
      if (preset.shot.framing !== "window" && crop) {
        const up = cropUpscale(crop, log.viewport.width, OUTPUT_WIDTH);
        const how = up > SHARPNESS_CEILING ? "OVER the ceiling" : "ok";
        console.log(
          `    framing  -> ${up.toFixed(2)}x source->output (${how}, ceiling ${SHARPNESS_CEILING})`,
        );
      }
      // Every key below is omitted when unset, so a framed clip renders with
      // exactly the props scripts/render.ts uses and its output stays
      // byte-identical to a plain `pnpm render`.
      // A grammar whose motion lives on the SHOTS supplies the clip's default
      // arrival. Without this, switching a reel to such a style removes the
      // card motion and adds nothing — measured on the harness reel, 24% moving
      // under proof became 18% under narration against a 36.8% target.
      // Authored `push` still wins, and a cards-layer style contributes nothing
      // here, so every existing reel is untouched.
      const shotPush =
        push ??
        (preset.motionLayer === "shots" ? presetShotPush(preset) : undefined);
      // Gate on the STYLE's framing, not the legacy look. A reel that names a
      // style and no look would otherwise fall through to the framed renderer
      // with none of these props — measured: every clip in a narration cut of
      // harness rendered as a framed window, which is also why the style's own
      // shot arrival never fired.
      const full =
        preset.shot.framing !== "window"
          ? {
              // Both, and only when set: `look` keeps a legacy reel's props
              // byte-identical, `style` is what a styled reel dispatches on.
              ...(reel.look ? { look: reel.look } : {}),
              ...(reel.style ? { style: reel.style } : {}),
              // The range is what lets the push know where the shot starts and
              // ends: --frames renders absolute frame numbers, so without it the
              // envelope would measure from the demo's frame 0.
              range: { first, last },
              ...(crop ? { crop } : {}),
              ...(shotPush ? { push: shotPush } : {}),
              ...(pageBg ? { pageBg } : {}),
              ...(cursor != null ? { cursor } : {}),
              ...(ripple != null ? { ripple } : {}),
              ...(freeze ? { freeze } : {}),
            }
          : {};
      render(
        [
          "render",
          "DemoClip",
          `--props=${JSON.stringify({ name, speed, ...(drift != null ? { drift } : {}), ...full })}`,
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
  // A style that does not hard-cut cannot be stream-copied: xfade has to blend
  // two decoded streams, so the whole film is re-encoded. Everything else still
  // takes the -c copy path and stays byte-for-byte as before.
  const join = preset.join;
  const styleOverlapF = join.kind === "dissolve" ? join.frames : 0;
  // One entry per BOUNDARY: overlaps[i] joins segment i to segment i+1. A
  // segment's own `join` overrides its style's, so a dissolving style can still
  // cut inside a section and blend only where a section changes — which is what
  // the reference does. See SegmentJoin in src/lib/reel.ts.
  const overlaps = reel.segments.slice(1).map((seg) => {
    if (seg.join === "cut") return 0;
    if (seg.join === "dissolve") return styleOverlapF || DEFAULT_DISSOLVE_F;
    return styleOverlapF;
  });
  const dissolving = overlaps.some((o) => o > 0);
  // Inside a dissolving film even a cut has to be a one-frame blend — see
  // MIN_JOIN_F. Clamped ONCE here so the filter, the frame count and the audio
  // bounds all read the same list.
  const joins = dissolving ? joinable(overlaps) : overlaps;
  const counts = probes.map((p) => frameCount(p) ?? 0);

  if (dissolving) {
    // System ffmpeg: the bundled Remotion build is filter-whitelisted and has
    // no xfade, the same reason the audio mux uses the system binary.
    requireFfmpegVideo();
    const inputs = parts.flatMap((f) => ["-i", f]);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        ...inputs,
        "-filter_complex",
        buildXfadeFilter(counts, FPS, joins),
        "-map",
        "[v]",
        "-movflags",
        "+faststart",
        videoOnly,
      ],
      { stdio: "inherit" },
    );
  } else {
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
  }

  // Every join eats `overlapF` frames from both sides, so the expected total is
  // not the plain sum once a style dissolves.
  const sum = dissolvedFrameCount(counts, joins);
  const joined = frameCount(probe(videoOnly));
  // xfade lands within a frame of the arithmetic; -c copy is exact.
  const slack = dissolving ? overlaps.length : 0;
  if (joined != null && Math.abs(sum - joined) > slack)
    throw new Error(
      `Frame count mismatch: segments total ${sum}, output has ${joined}.`,
    );

  const runtimeS = (joined ?? sum) / FPS;

  // The HUD spans segments, so it lands here rather than in any of them —
  // rendered alone on a transparent ground and composited onto the finished
  // picture. It must go on BEFORE the audio pass, which copies the video
  // stream. Like a dissolve, it re-encodes.
  const hudSrc =
    preset.hud.kind === "steps"
      ? overlayHud(reel, preset, videoOnly, workDir, counts, log, speed, joins, runtimeS)
      : videoOnly;

  if (hasAudio)
    muxAudio(
      reel,
      hudSrc,
      out,
      runtimeS,
      counts,
      log,
      speed,
      joins,
    );

  if (!hasAudio && hudSrc !== videoOnly) fs.copyFileSync(hudSrc, out);

  reportLoudness(reel, hasAudio ? out : null);

  console.log(
    `\nsegments   -> ${parts.length} (${counts.join(" + ")})` +
      (dissolving ? `  dissolve ${overlaps.filter((o) => o > 0).length}x${styleOverlapF}f` : ""),
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
  overlaps: number[] = [],
): void {
  requireFfmpegAudio();
  // The bounds must be the DISSOLVED ones, or every tick fires progressively
  // later than the footage it belongs to. See scripts/lib/xfade.ts.
  const bounds = segmentBoundsSeconds(counts, FPS, overlaps);
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

/**
 * Render the step HUD and composite it onto the film. Returns the new path.
 *
 * Two passes, both unavoidable. Remotion draws the overlay on a transparent
 * ground — this ffmpeg has no `drawtext` (it needs libfreetype), so burning
 * text in directly was never available, and rendering it here gets the repo's
 * own type instead. ProRes 4444 because it is the codec that carries alpha.
 * Then `overlay` composites, which re-encodes the picture.
 *
 * Returns `videoOnly` unchanged when the log yields no steps — a film with
 * nothing to narrate should not pay for a re-encode.
 */
function overlayHud(
  reel: Reel,
  preset: StylePreset,
  videoOnly: string,
  workDir: string,
  counts: number[],
  log: ClickLog,
  speed: number,
  overlaps: number[],
  runtimeS: number,
): string {
  const steps = hudSteps(
    reel.segments,
    counts,
    FPS,
    log,
    speed,
    runtimeS,
    overlaps,
  );
  if (steps.length === 0) {
    console.log("hud        -> no labelled beats in any clip; skipped");
    return videoOnly;
  }
  const ink = preset.palette.plain.ink;
  const mov = path.join(workDir, `${reel.name}.hud.mov`);
  execFileSync(
    REMOTION_BIN,
    [
      "render",
      "HudOverlay",
      `--props=${JSON.stringify({ steps, ink, totalS: runtimeS })}`,
      mov,
      "--codec=prores",
      "--prores-profile=4444",
      // WITHOUT THIS THE ALPHA IS DROPPED. prores-profile=4444 alone still
      // encoded yuv422p12le, so the transparent ground became opaque black and
      // the overlay hid the entire film. The pixel format is what carries it.
      "--pixel-format=yuva444p10le",
      `--gl=${resolveGl(process.env.DEMO_GL)}`,
      "--muted",
    ],
    { stdio: "inherit" },
  );
  const out = path.join(workDir, `${reel.name}.hud.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      videoOnly,
      "-i",
      mov,
      "-filter_complex",
      "[0:v][1:v]overlay=format=auto[v]",
      "-map",
      "[v]",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  console.log(`hud        -> ${steps.length} step(s) composited`);
  return out;
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
    m.kind === "push"
      ? { axis: m.axis, dist: m.dist, frames: m.frames }
      : undefined;
  const inMove = toMove(preset.shot.enter);
  const outMove = toMove(preset.shot.exit);
  if (!inMove && !outMove) return undefined;
  return { ...(inMove ? { in: inMove } : {}), ...(outMove ? { out: outMove } : {}) };
}

/**
 * Print the cut's loudness beside its style's reference. ADVISORY — it sets
 * nothing.
 *
 * Audio deliberately stays per-reel: a style that silently mutes or un-mutes a
 * film is a nasty surprise. But the four references span 23 LU — Film B ships
 * silent, Film A sits at -31.3, monid at -14.5, Uber at a brick-walled -8.2 —
 * so "is this reel in the right register for the grammar it is cut in" is a
 * real question that used to have no answer at all.
 *
 * Never throws. A missing ffmpeg or an unreadable file costs an advisory line,
 * not a render.
 */
function reportLoudness(reel: Reel, file: string | null): void {
  const ref = resolvePreset(reel).source?.loudnessLUFS ?? null;
  if (!file) {
    if (ref != null)
      console.log(
        `loudness   -> this reel is SILENT; its reference sits at ${ref} LUFS`,
      );
    return;
  }
  let measured: number | null = null;
  try {
    // ebur128 writes its summary to STDERR, not stdout — execFileSync returns
    // only stdout, so reading that gets an empty string and silently no line.
    const r = spawnSync(
      "ffmpeg",
      ["-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    // ebur128 prints a RUNNING integrated value every frame and the true one
    // only in its Summary. The first match is the pre-roll (-70.0, i.e.
    // silence); take the last.
    const all = [...(r.stderr ?? "").matchAll(/I:\s*(-?[0-9.]+)\s*LUFS/g)];
    if (all.length) measured = Number(all[all.length - 1][1]);
  } catch {
    return;
  }
  if (measured == null) return;
  if (ref == null) {
    console.log(`loudness   -> ${measured.toFixed(1)} LUFS (no reference)`);
    return;
  }
  const d = measured - ref;
  const how = Math.abs(d) < 1 ? "on reference" : `${d > 0 ? "+" : ""}${d.toFixed(1)} LU`;
  console.log(
    `loudness   -> ${measured.toFixed(1)} LUFS · reference ${ref} · ${how}`,
  );
}

/**
 * The system ffmpeg must have `xfade`, which the bundled Remotion build lacks.
 * Mirrors requireFfmpegAudio — fail before spending minutes on a render that
 * cannot finish.
 */
function requireFfmpegVideo(): void {
  let filters = "";
  try {
    filters = execFileSync("ffmpeg", ["-hide_banner", "-filters"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      "A dissolving style needs a system ffmpeg on PATH — `brew install ffmpeg`.",
    );
  }
  if (!/\bxfade\b/.test(filters))
    throw new Error(
      "This ffmpeg build lacks the xfade filter, which a dissolving style " +
        "needs. Install a full build: `brew install ffmpeg`.",
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
