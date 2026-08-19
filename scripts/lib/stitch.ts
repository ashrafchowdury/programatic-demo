/**
 * Stream compatibility check for the intro/demo concat.
 *
 * scripts/stitch.ts joins the two files with the concat demuxer and `-c copy`,
 * which does not re-encode: it splices compressed packets straight into a new
 * container. That is fast and lossless, but it assumes both files already agree
 * on codec, profile, level, geometry, pixel format and frame rate. When they do
 * not, ffmpeg does not necessarily fail — it can emit a file that plays for a
 * few seconds and then falls apart, which is a much worse failure than an error.
 *
 * So the geometry is checked before the concat, not after. Kept pure and apart
 * from the ffprobe call so it can be tested without running ffmpeg.
 */

export type StreamProbe = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
};

export type FileProbe = { streams: StreamProbe[] };

/** Everything that has to match for `-c copy` to produce a valid file. */
const MATCHED_KEYS = [
  "codec_name",
  "profile",
  "level",
  "width",
  "height",
  "pix_fmt",
  "r_frame_rate",
] as const;

const videoOf = (probe: FileProbe): StreamProbe | undefined =>
  probe.streams.find((s) => s.codec_type === "video");

/**
 * Returns one human-readable line per problem, empty when the two can be
 * concatenated. Never throws — the caller decides whether to abort or report.
 */
export function compareStreams(
  a: FileProbe,
  b: FileProbe,
  aLabel = "intro",
  bLabel = "demo",
): string[] {
  const problems: string[] = [];

  for (const [label, probe] of [
    [aLabel, a],
    [bLabel, b],
  ] as const) {
    const video = probe.streams.filter((s) => s.codec_type === "video").length;
    if (video !== 1)
      problems.push(`${label}: expected 1 video stream, found ${video}`);
    // An audio track on one side only is the classic way this breaks: both
    // renders pass --muted, so a stray track means one was rendered without it.
    const extra = probe.streams.filter((s) => s.codec_type !== "video");
    for (const s of extra)
      problems.push(
        `${label}: unexpected ${s.codec_type} stream — both renders must pass --muted`,
      );
  }

  const av = videoOf(a);
  const bv = videoOf(b);
  if (!av || !bv) return problems;

  for (const key of MATCHED_KEYS) {
    if (av[key] !== bv[key])
      problems.push(`${key}: ${aLabel} ${av[key]} vs ${bLabel} ${bv[key]}`);
  }
  return problems;
}
