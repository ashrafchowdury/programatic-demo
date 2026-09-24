/**
 * Turn any image into a studio backdrop: public/backdrops/<name>.jpg, and
 * its still variant public/backdrops/<name>-still.jpg.
 *
 *   pnpm backdrop ~/Pictures/wall.heic aurora
 *   pnpm backdrop wall.png aurora --lift --blur=10
 *   pnpm backdrop --still aurora     the still variant alone, from <name>.jpg
 *   pnpm backdrop --still --all      ... for every backdrop in the directory
 *
 * The preparation is not cosmetic. A soft ramp is banded into rings by h264's
 * deadzone quantiser, and the only thing that survives is grain present in the
 * SOURCE at full amplitude — weak grain measures WORSE than none, because the
 * encoder quantises it into blocks. So: blur first (it would destroy grain
 * applied before it), lift the black floor if the image is clipped, grain last.
 *
 * Every backdrop is checked afterwards the way the originals were: the longest
 * run of identical pixels on a scanline, after an h264 pass. Single digits is
 * good; the CSS gradient this replaced measured 97, a flat colour 2560.
 *
 * THE STILL VARIANT is the same picture for a PNG, which wants the opposite.
 * The grain exists to beat h264's quantiser, and a PNG has none; a 4K still
 * draws the 2560px file 1.5x (wide) to 2.7x (story) up, where noise=12
 * becomes a visible grid of blobs and costs the PNG its compression. So: 4K,
 * and no grain. Measured on smoke-story over glaze, the PNG went from
 * 7.9 MB to 1.2 MB (smoke-wide 5.6 to 1.0) — see STILL_QUALITY for the format.
 *
 * `--still` derives it from the committed video file when the source is gone
 * (all sixteen shipped ones): a sigma-3 blur takes the ±12 grain to under a
 * level, and every shipped backdrop was blurred at sigma 16 before its grain
 * went on, so nothing else in the picture is that fine.
 *
 * Needs system ffmpeg. HEIC and AVIF are converted with `sips` first.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "backdrops");

/** The still variant's size: the largest canvas edge any still preset has. */
const STILL_W = 3840;
const STILL_H = 2160;
/**
 * JPEG, at ffmpeg's -q:v 2. Measured on glaze / chalk / cobalt at 3840x2160,
 * grain-free: PNG 3.4 / 3.4 / 4.4 MB, JPEG q2 223 / 183 / 274 KB. The JPEG's
 * error sits under one level on a blurred gradient and never reaches the
 * product (it is drawn over it), so the 15x is free. A light grain
 * (noise=2) bought nothing visible and cost 2-3% in size; none it is.
 */
const STILL_QUALITY = 2;

/** Write <name>-still.jpg from `input` through `filters`, and report it. */
function writeStill(name: string, input: string, filters: string[]): void {
  const out = path.join(DIR, `${name}-still.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", filters.join(","),
    "-q:v", String(STILL_QUALITY), out]);
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`still      -> public/backdrops/${name}-still.jpg  ${kb} KB, ${STILL_W}x${STILL_H}, no grain`);
}

/** The still variant of an existing backdrop, from its video file alone. */
function stillFromVideoFile(name: string): void {
  const src = path.join(DIR, `${name}.jpg`);
  if (!fs.existsSync(src)) throw new Error(`No backdrop at public/backdrops/${name}.jpg`);
  writeStill(name, src, [
    "gblur=sigma=3",
    `scale=${STILL_W}:${STILL_H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${STILL_W}:${STILL_H}`,
  ]);
}

const num = (argv: string[], flag: string, fallback: number): number => {
  const raw = argv.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Longest run of identical pixels on one scanline, after an h264 pass.
 *
 * The row is taken from the middle by expression rather than a fixed y, and
 * `format=rgb24` comes FIRST: a 1px-tall crop is illegal on yuv420p, whose
 * chroma planes need even dimensions, so cropping straight off the decoded
 * video emits zero bytes — which a run counter happily reports as a run of 1.
 */
function bandingRun(jpg: string): number {
  const tmp = path.join(os.tmpdir(), `bd-${path.basename(jpg)}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", jpg, "-t", "0.5",
    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", tmp]);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", tmp, "-vf", "format=rgb24,crop=iw:1:0:ih/2",
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 24 });
  fs.rmSync(tmp, { force: true });
  if (raw.length < 6)
    throw new Error("banding probe read no pixels — the filter chain failed");
  let best = 1;
  let run = 1;
  for (let i = 3; i + 2 < raw.length; i += 3) {
    const same = raw[i] === raw[i - 3] && raw[i + 1] === raw[i - 2] && raw[i + 2] === raw[i - 1];
    run = same ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("-"));
  if (argv.includes("--still")) {
    const names = argv.includes("--all")
      ? fs.readdirSync(DIR)
          .filter((f) => f.endsWith(".jpg") && !f.endsWith("-still.jpg"))
          .map((f) => f.slice(0, -".jpg".length))
      : positional;
    if (names.length === 0)
      throw new Error("Usage: pnpm backdrop --still <name>... | --still --all");
    for (const n of names) stillFromVideoFile(n);
    return;
  }
  const [source, name] = positional;
  if (!source || !name)
    throw new Error("Usage: pnpm backdrop <image> <name> [--lift] [--blur=16] [--quality=4]");
  if (/[/\\.]/.test(name))
    throw new Error("<name> is a bare name, e.g. `aurora` — no path, no extension");
  if (!fs.existsSync(source)) throw new Error(`No image at ${source}`);

  const blur = num(argv, "blur", 16);
  const quality = num(argv, "quality", 4);
  // Only for a source whose blacks are already clipped: noise on clipped black
  // is half-rectified, so it can only swing up and dithers far less.
  const lift = argv.includes("--lift");

  let input = path.resolve(source);
  if (/\.(heic|avif)$/i.test(input)) {
    const png = path.join(os.tmpdir(), `bd-src-${name}.png`);
    execFileSync("sips", ["-s", "format", "png", input, "--out", png], { stdio: "ignore" });
    input = png;
  }

  fs.mkdirSync(DIR, { recursive: true });
  const out = path.join(DIR, `${name}.jpg`);
  const filters = [
    "scale=2560:1440:force_original_aspect_ratio=increase:flags=lanczos",
    "crop=2560:1440",
    `gblur=sigma=${blur}`,
    ...(lift ? ["lutrgb=r='10+val*245/255':g='10+val*245/255':b='10+val*245/255'"] : []),
    "noise=alls=12:allf=u",
  ].join(",");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", filters, "-q:v", String(quality), out]);

  // The still variant from the SOURCE, not from the grained file: same crop
  // and blur (scaled with the size, so the picture matches), same lift, no
  // grain.
  writeStill(name, input, [
    `scale=${STILL_W}:${STILL_H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${STILL_W}:${STILL_H}`,
    `gblur=sigma=${blur * (STILL_W / 2560)}`,
    ...(lift ? ["lutrgb=r='10+val*245/255':g='10+val*245/255':b='10+val*245/255'"] : []),
  ]);

  const run = bandingRun(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`backdrop   -> public/backdrops/${name}.jpg  ${kb} KB`);
  console.log(`banding    -> longest identical run ${run}px on a scanline after h264`);
  if (run > 24)
    console.warn(
      `           !  that will show as rings. Try --lift (clipped blacks) or a ` +
        `higher --quality.`,
    );
  console.log(`use it     -> backdrop: "${name}"  in a flow, shot or reel`);
}

main();
