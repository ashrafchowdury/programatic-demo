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
import { outPath, outRel } from "./lib/out";

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
 * Measured on one 60-frame slice of the smoke clip, 2560x1440, samples=8, on an
 * 8-core/16GB machine. All four on the SAME scale — mixing a full-clip time in
 * here once made swiftshader look 3x faster than the default:
 *
 *   --gl=angle            13.1s   <- the only one worth having
 *   default (software)   136.6s
 *   --gl=swiftshader     163.4s   software GL: SLOWER than doing nothing
 *   --gl=angle-egl       176.4s
 *
 * Full 248-frame clip, end to end: ~510s software -> 31s on angle, 16x.
 *
 * BUT 16x is the synthetic fixture's number — quote the production one instead.
 * Verified on `agent-skill`, a real 23.3s app demo (560 frames), whole clip:
 *
 *   --gl=swiftshader    1425s  (23.8 min)
 *   --gl=angle           131s  ( 2.2 min)  on a cold machine
 *   --gl=angle           206s  ( 3.4 min)  after ~40 min of sustained rendering
 *
 * MIND THE THERMALS when benchmarking this. That last row is not noise: the same
 * command, same flags, run twice, went 131s -> 206s purely because the laptop had
 * been rendering for half an hour. A cold first run will flatter any change you
 * make here. The most trustworthy figure came from two 60-frame slices measured
 * back to back in the same thermal state: 150.8s default vs 15.5s angle.
 *
 * So: ~7x hot, ~10x like-for-like, ~11x cold. Call it roughly an order of
 * magnitude and budget 0.23-0.37 s/frame on the GPU. Real app footage costs
 * ~1.8x more per frame than the smoke fixture, which is why none of these reach
 * the fixture's 16x.
 *
 * Note also that swiftshader came out level with the default on this clip, not
 * 20% behind it as on smoke — that gap is clip-dependent, so treat swiftshader
 * as "about as slow as no GPU", not reliably worse.
 *
 * Same picture. On smoke: 53.9 dB PSNR over the clip against the software
 * render. On `agent-skill`, which is the harder case because real app UI is all
 * text edges, the two renders were compared frame by frame:
 *
 *   PSNR 46.4 dB average (median 49.9, worst frame 40.1), SSIM 0.9976
 *   only 0.09% of pixels differ by more than 8 levels
 *   the differences trace glyph and UI-element outlines — flat areas are equal
 *   backdrop banding metric BYTE-IDENTICAL on every scanline tested
 *   Laplacian variance 203.8 vs 204.5 — no sharpness lost
 *
 * So the lower PSNR here is sub-pixel antialiasing on edges, not degradation.
 * If you change this, re-check the banding metric first — that is the one this
 * composition is actually tuned around (see DemoClip.tsx).
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
 * Set DEMO_GL=swiftshader on a machine with no usable GPU (CI, headless Linux).
 * It is a COMPATIBILITY fallback, not a fast one — it is software rasterising
 * too, so it lands at roughly the un-accelerated time (level with the default on
 * agent-skill, ~20% behind it on smoke). It is still the value to reach for,
 * because the config file now pins `angle`, so there is no longer an "unset"
 * path to fall back to. (`swangle` fails outright here.)
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

  const out = outPath("demo", `${name}.mp4`);
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
  console.log(`mp4        -> ${outRel(out)}`);
}

main();
