/**
 * Renders the DemoClip composition for <name> to MP4.
 *   out/<name>.mp4    — h264, for docs / general use
 *
 * The composition reads public/<name>.clicks.json (via calculateMetadata) for its
 * size, duration, and zoom keyframes, so we only pass the name.
 *
 * Usage: pnpm render <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePlaybackRate } from "../src/lib/click-log";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

/**
 * Chromium's rasteriser. `angle` = the real GPU. This is the single biggest
 * lever in the whole pipeline.
 *
 * What this composition costs is <CameraMotionBlur>. It renders its subtree
 * once per sample and composites the copies with `plus-lighter` at fractional
 * opacity, so a frame is 8 full-size layer rasterisations plus 8 blends.
 * Software-rasterising that is what made the render slow, and it is precisely
 * the work a GPU exists to do.
 *
 * Measured on the 248-frame smoke clip, 2560x1440, samples=8, 8-core/16GB:
 *
 *   default (software)   ~510s
 *   --gl=angle             31s   <- 16x
 *   --gl=swiftshader      163s   (software GL: slower than the default)
 *   --gl=angle-egl        176s
 *
 * Same picture: 53.9 dB PSNR over the clip against the software render, and on
 * the fastest-moving frame (171px of camera travel, where the shutter is doing
 * the most work) the mean per-channel difference is 0.09 levels. The backdrop
 * banding metric in DemoClip.tsx is unchanged.
 *
 * Two earlier theories about this render were measured and are WRONG. They are
 * recorded so nobody re-derives them:
 *
 *   - "I/O bound on ~2,900 seeks into the source mp4, one per sample."
 *     Re-encoding the source all-intra (`-g 1`), which makes every seek O(1),
 *     changed nothing: 131s vs 137s on a 60-frame slice.
 *   - "Memory bound; the idle CPU is blocked on swap." Cost is simply LINEAR in
 *     samples — 8 / 22 / 38 / 55 / 123s for samples 1/2/3/4/8 on that slice.
 *     No cliff. The CPU was idle because one thread was compositing.
 *
 * Set DEMO_GL=swangle on a machine with no usable GPU (CI, headless Linux).
 */
function resolveGl(raw?: string): string {
  return raw != null && raw !== "" ? raw : "angle";
}

/**
 * Frames rendered in parallel. OPT-IN — unset means Remotion's own default.
 *
 * Leave it unset. Measured at 6 workers on an 8-core/16GB machine: a 33%
 * REGRESSION over the ~4-worker default. `DEMO_CONCURRENCY=1` is still useful
 * for debugging a render.
 */
function resolveConcurrency(raw?: string): number | null {
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return null;
}

function main() {
  const name = process.argv[2] ?? "smoke";
  const json = path.join(ROOT, "public", `${name}.clicks.json`);
  if (!fs.existsSync(json)) {
    throw new Error(
      `Missing ${path.relative(ROOT, json)} — record + convert ${name} first.`,
    );
  }
  const src = path.join(ROOT, "public", `${name}.mp4`);
  if (!fs.existsSync(src))
    throw new Error(
      `Missing ${path.relative(ROOT, src)} — run \`pnpm convert ${name}\` first.`,
    );

  const out = path.join(ROOT, "out", `${name}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const speed = resolvePlaybackRate(process.env.DEMO_SPEED);
  const concurrency = resolveConcurrency(process.env.DEMO_CONCURRENCY);
  const gl = resolveGl(process.env.DEMO_GL);
  execFileSync(
    REMOTION_BIN,
    [
      "render",
      "DemoClip",
      out,
      `--props=${JSON.stringify({ name, speed })}`,
      "--crf=16",
      `--gl=${gl}`,
      ...(concurrency != null ? [`--concurrency=${concurrency}`] : []),
      // These clips are silent by design; without this Remotion still muxes an
      // empty AAC track, which cost ~317 kb/s of pure nothing.
      "--muted",
    ],
    { stdio: "inherit" },
  );
  if (speed !== 1) console.log(`speed      -> ${speed}×`);
  if (concurrency != null) console.log(`workers    -> ${concurrency}`);
  console.log(`gl         -> ${gl}`);
  console.log(`mp4        -> ${path.relative(ROOT, out)}`);
}

main();
