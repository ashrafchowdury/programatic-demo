/**
 * Converts the raw recording -> public/<name>.mp4 using Remotion's BUNDLED
 * ffmpeg (no system ffmpeg needed). libx264 + yuv420p + faststart = clean input
 * for Remotion and broad player compatibility.
 *
 * The raw recording is whichever of these the recorder wrote last:
 *   recordings/<name>.mkv    CDP frames, lossless 4:4:4 (the default)
 *   recordings/<name>.webm   Playwright's 1 Mbps VP8 (DEMO_CAPTURE=playwright)
 *
 * Usage: pnpm convert <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { BT709_ARGS, X264_BT709_VUI } from "./lib/encode";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

/**
 * Near-lossless, because this is the LAST lossy step before the camera zooms
 * the footage 1.5x: everything it throws away is magnified.
 *
 * It was CRF 20 over a 1 Mbps VP8 source, i.e. two lossy passes before
 * Remotion's own. Measured on smoke at 3840x2160, the closing (static) frame
 * against the lossless CDP capture of the same state:
 *
 *                                        whole frame        text crop 1400x700
 *                                        SSIM Y   PSNR      SSIM Y   PSNR
 *   old  VP8 1M -> CRF 20 medium         0.99875  42.4 dB   0.99573  39.4 dB
 *   new  lossless 4:4:4 -> CRF 10 medium 0.99991  49.5 dB   0.99986  46.2 dB
 *
 * 1-SSIM on the text falls ~30x, and the mp4 got SMALLER (803 kB -> 579 kB):
 * the source is mostly held frames, so the rate goes to the few that move, and
 * there is no VP8 noise left to spend it on. `slow` measured 2.3x the time of
 * `medium` (123s vs 54s, loaded machine) for a file 2% bigger, so medium.
 *
 * Colour: RGB (or VP8's BT.601) is converted INTO BT.709 limited range here and
 * tagged as such (BT709_ARGS), so the matrix in the pixels and the tag agree —
 * untagged, Chrome guesses, and #f0f05a drifted (audit X3).
 */
const CONVERT_ARGS = [
  "-c:v",
  "libx264",
  "-crf",
  "10",
  "-preset",
  "medium",
  "-pix_fmt",
  "yuv420p",
  ...BT709_ARGS,
  // Primaries and transfer only land through x264's own VUI — BT709_ARGS alone
  // probed "unknown" on both ffmpegs. See X264_BT709_VUI.
  ...X264_BT709_VUI,
];

/** The newer of the two raw recordings, so a re-shoot on either path wins. */
function rawRecording(name: string): string | null {
  const found = [".mkv", ".webm"]
    .map((ext) => path.join(ROOT, "recordings", `${name}${ext}`))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] ?? null;
}

function main() {
  const name = process.argv[2] ?? "smoke";
  const input = rawRecording(name);
  const output = path.join(ROOT, "public", `${name}.mp4`);
  if (!input)
    throw new Error(
      `Missing recordings/${name}.mkv (or .webm) — run the recorder for ${name} first.`,
    );

  execFileSync(
    REMOTION_BIN,
    [
      "ffmpeg",
      "-v",
      "error",
      "-stats",
      "-y",
      "-i",
      input,
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv",
      ...CONVERT_ARGS,
      "-movflags",
      "+faststart",
      "-an",
      output,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `mp4        -> ${path.relative(ROOT, output)} (from ${path.relative(ROOT, input)})`,
  );
}

main();
