/**
 * The one set of flags every ffmpeg pass that ENCODES video uses, and the check
 * that the file it wrote is actually deliverable.
 *
 * Remotion encodes every segment (libx264, CRF 16, its default `medium` preset,
 * yuv420p, BT.709 via Config.setColorSpace in remotion.config.ts). Any pass
 * after it that decodes and re-encodes — xfade, the HUD and chip overlays, a
 * re-encoding stitch — has to say all of that again, because ffmpeg's defaults
 * are different on every axis:
 *
 *  - No `-pix_fmt`: xfade kept the 4:4:4 its own conversion produced, and x264
 *    picked High 4:4:4 Predictive. Measured on out/reel/agent-schedule.mp4:
 *    yuv444p, 384 kb/s — QuickTime, Safari/iOS and most upload paths reject it.
 *  - No `-crf`: x264's 23, against 16 everywhere else.
 *  - No colour tags: untagged, so players guess BT.709 while the pixels were
 *    matrixed BT.601 — #f0f05a showed as ~#f2e653.
 *
 * Pure: no ffmpeg, no fs. scripts/reel.ts runs the probe.
 */

/** BT.709, limited range — what Remotion writes with colorSpace "bt709". */
export const BT709_ARGS = [
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-color_range",
  "tv",
] as const;

/**
 * libx264 at the segments' own settings. `medium` is Remotion's DEFAULT_PRESET
 * (@remotion/renderer options/x264-preset), so a re-encoded pass matches the
 * segments it came from rather than out-spending them.
 */
export const X264_ARGS = [
  "-c:v",
  "libx264",
  "-crf",
  "16",
  "-preset",
  "medium",
  "-pix_fmt",
  "yuv420p",
] as const;

/** Every flag a video-encoding ffmpeg pass needs, in one spread. */
export const VIDEO_ENCODE_ARGS: string[] = [...X264_ARGS, ...BT709_ARGS];

/** ffprobe entries deliveryProblems reads. */
export const DELIVERY_PROBE_KEYS =
  "stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate," +
  "color_space,color_transfer,color_primaries,sample_rate";

export type DeliveryStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  sample_rate?: string;
};

export type DeliveryExpect = {
  width: number;
  height: number;
  fps: number;
  /** Required audio rate, or null for a film that must be silent. */
  sampleRate: number | null;
};

/**
 * One line per way the output is not a deliverable h264 film; empty when it is.
 *
 * Checks the OUTPUT, not the inputs: the 4:4:4 export passed every segment
 * check, because every segment was fine — it was the pass after them that
 * changed the stream.
 */
export function deliveryProblems(
  streams: DeliveryStream[],
  want: DeliveryExpect,
): string[] {
  const problems: string[] = [];
  const video = streams.filter((s) => s.codec_type === "video");
  if (video.length !== 1) {
    problems.push(`expected 1 video stream, found ${video.length}`);
    return problems;
  }
  const v = video[0];
  if (v.codec_name !== "h264") problems.push(`codec ${v.codec_name}, want h264`);
  if (v.profile && /4:4:4|4:2:2|10/.test(v.profile))
    problems.push(`profile "${v.profile}" — most players reject it, want High`);
  if (v.pix_fmt !== "yuv420p") problems.push(`pix_fmt ${v.pix_fmt}, want yuv420p`);
  if (v.r_frame_rate !== `${want.fps}/1`)
    problems.push(`frame rate ${v.r_frame_rate}, want ${want.fps}/1`);
  if (v.width !== want.width || v.height !== want.height)
    problems.push(`size ${v.width}x${v.height}, want ${want.width}x${want.height}`);
  for (const key of ["color_space", "color_transfer", "color_primaries"] as const)
    if (v[key] !== "bt709") problems.push(`${key} ${v[key] ?? "untagged"}, want bt709`);

  const audio = streams.filter((s) => s.codec_type === "audio");
  if (want.sampleRate == null) {
    if (audio.length) problems.push(`unexpected audio stream on a silent film`);
  } else if (audio.length !== 1) {
    problems.push(`expected 1 audio stream, found ${audio.length}`);
  } else if (Number(audio[0].sample_rate) !== want.sampleRate) {
    problems.push(`audio ${audio[0].sample_rate} Hz, want ${want.sampleRate}`);
  }
  return problems;
}

/**
 * ffmpeg args compositing a transparent overlay (`mov`, ProRes 4444 with alpha)
 * onto `src`. Used by the HUD and chip passes, which re-encode the whole film.
 */
export function overlayArgs(src: string, mov: string, out: string): string[] {
  return [
    "-y",
    "-i",
    src,
    "-i",
    mov,
    "-filter_complex",
    "[0:v][1:v]overlay=format=auto[v]",
    "-map",
    "[v]",
    ...VIDEO_ENCODE_ARGS,
    "-movflags",
    "+faststart",
    out,
  ];
}
