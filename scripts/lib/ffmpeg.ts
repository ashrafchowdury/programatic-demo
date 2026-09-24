/**
 * Everything the scripts ask of ffmpeg/ffprobe that is not a filtergraph:
 * probing a file, counting its frames, checking the system build has the
 * filters a pass needs, and the stream-compatibility check for `-c copy`.
 *
 * TWO BINARIES, on purpose. Remotion bundles an ffmpeg (`remotion ffprobe`,
 * `remotion ffmpeg`) that always matches the encoder it renders with, so
 * probing segments and stream-copying them goes through it. It is
 * filter-whitelisted — no xfade, no overlay-with-alpha paths, no audio
 * filters — so every pass that FILTERS runs on the system ffmpeg instead, and
 * `requireFilters` fails with the fix before minutes of rendering are spent.
 *
 * compareStreams is pure and tested (ffmpeg.test.ts). It used to live in
 * scripts/lib/stitch.ts for the retired intro+demo stitch; the reel concat is
 * the only thing that needs it now.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { DELIVERY_PROBE_KEYS, type DeliveryStream } from "./encode";
import { REMOTION_BIN } from "./remotion";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export type StreamProbe = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  color_space?: string;
  nb_frames?: string;
};

export type FileProbe = { streams: StreamProbe[] };

const PROBE_KEYS =
  "stream=codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,nb_frames,color_space";

/** Stream facts for `file`, through Remotion's bundled ffprobe. */
export function probe(file: string): FileProbe {
  const out = execFileSync(
    REMOTION_BIN,
    ["ffprobe", "-v", "error", "-show_entries", PROBE_KEYS, "-of", "json", file],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as FileProbe;
}

/** The container's video frame count, or null when it does not say. */
export function frameCount(p: FileProbe): number | null {
  const v = p.streams.find((s) => s.codec_type === "video");
  const n = v?.nb_frames != null ? Number(v.nb_frames) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The finished file's streams, for deliveryProblems. System ffprobe, like the passes. */
export function probeDelivery(file: string): DeliveryStream[] {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", DELIVERY_PROBE_KEYS, "-of", "json", file],
    { encoding: "utf8" },
  );
  return (JSON.parse(out) as { streams: DeliveryStream[] }).streams;
}

/** A media file's duration in seconds, via the system ffprobe. */
export function mediaDurationS(file: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0)
    throw new Error(`Could not read a duration from ${path.relative(ROOT, file)}.`);
  return d;
}

/** Which of `wanted` are absent from an `ffmpeg -filters` dump. Pure. */
export function missingFilters(
  filtersText: string,
  wanted: readonly string[],
): string[] {
  return wanted.filter((f) => !new RegExp(`\\b${f}\\b`).test(filtersText));
}

let filterDump: string | null = null;

/**
 * Fail with the fix, not a stack trace, when the SYSTEM ffmpeg is missing or
 * lacks a filter `purpose` needs. The dump is read once per process.
 *
 * scripts/analyze.ts still carries its own copy (requireFfmpeg); it can switch
 * to `requireFilters(["scdet", "signalstats", ...], "scripts/analyze.ts")`.
 */
export function requireFilters(wanted: readonly string[], purpose: string): void {
  let dump = filterDump;
  if (dump == null) {
    try {
      dump = execFileSync("ffmpeg", ["-hide_banner", "-filters"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      throw new Error(`${purpose} needs a system ffmpeg on PATH — \`brew install ffmpeg\`.`);
    }
    filterDump = dump;
  }
  const missing = missingFilters(dump, wanted);
  if (missing.length)
    throw new Error(
      `This ffmpeg build lacks the ${missing.join(", ")} filter(s), which ${purpose} ` +
        "needs. Install a full build: `brew install ffmpeg`.",
    );
}

/**
 * Everything that has to match for `-c copy` to produce a valid file.
 *
 * The concat demuxer splices compressed packets straight into a new container.
 * That is fast and lossless, but it assumes every part already agrees on codec,
 * profile, level, geometry, pixel format and frame rate. When they do not,
 * ffmpeg does not necessarily fail — it can emit a file that plays for a few
 * seconds and then falls apart, which is a much worse failure than an error.
 */
const MATCHED_KEYS = [
  "codec_name",
  "profile",
  "level",
  "width",
  "height",
  "pix_fmt",
  "r_frame_rate",
  // Not a packet-level incompatibility — the concat succeeds — but a BT.601
  // part beside a BT.709 one plays with a hue shift at the cut, and the file
  // can carry only one tag for both.
  "color_space",
] as const;

const videoOf = (p: FileProbe): StreamProbe | undefined =>
  p.streams.find((s) => s.codec_type === "video");

/**
 * One human-readable line per reason `a` and `b` cannot be joined, empty when
 * they can. Never throws — the caller decides whether to abort or report.
 */
export function compareStreams(
  a: FileProbe,
  b: FileProbe,
  aLabel = "a",
  bLabel = "b",
): string[] {
  const problems: string[] = [];

  for (const [label, p] of [
    [aLabel, a],
    [bLabel, b],
  ] as const) {
    const video = p.streams.filter((s) => s.codec_type === "video").length;
    if (video !== 1) problems.push(`${label}: expected 1 video stream, found ${video}`);
    // An audio track on one side only is the classic way this breaks: every
    // segment render passes --muted, so a stray track means one did not.
    for (const s of p.streams.filter((s) => s.codec_type !== "video"))
      problems.push(
        `${label}: unexpected ${s.codec_type} stream — every render must pass --muted`,
      );
  }

  const av = videoOf(a);
  const bv = videoOf(b);
  if (!av || !bv) return problems;

  for (const key of MATCHED_KEYS)
    if (av[key] !== bv[key])
      problems.push(`${key}: ${aLabel} ${av[key]} vs ${bLabel} ${bv[key]}`);
  return problems;
}
