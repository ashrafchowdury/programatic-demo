/**
 * One way to call `remotion render`, shared by the demo render and the reel.
 *
 * Every render in this repo wants the same things said the same way — the GPU
 * rasteriser, the opt-in worker count, CRF 16, no audio track — and when each
 * script spelled them out itself they drifted: the reel's segment renders
 * silently ignored DEMO_CONCURRENCY while `pnpm render` honoured it. The
 * measurements behind each flag live here, beside the code that applies them.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

/**
 * Chromium's rasteriser. `angle` = the real GPU. This is the single biggest
 * lever in the whole pipeline.
 *
 * What this composition costs is its motion blur — src/ShutterBlur.tsx now,
 * Remotion's <CameraMotionBlur> when the numbers below were taken; both work the
 * same way. It renders its subtree once per sample and composites the copies
 * with `plus-lighter` at fractional opacity, so a frame is 8 (16 on a fast
 * move) full-size layer rasterisations plus as many blends.
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
export function resolveGl(raw?: string): string {
  return raw != null && raw !== "" ? raw : "angle";
}

/**
 * Frames rendered in parallel. OPT-IN — unset means Remotion's own default.
 *
 * Leave it unset. Measured at 6 workers on an 8-core/16GB machine: a 33%
 * REGRESSION over the ~4-worker default. `DEMO_CONCURRENCY=1` is still useful
 * for debugging a render.
 */
export function resolveConcurrency(raw?: string): number | null {
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return null;
}

export type RenderOptions = {
  /** Remotion's `--frames=a-b`, inclusive on both ends. */
  frames?: { first: number; last: number };
  /**
   * `h264` (default) is every segment and demo. `prores4444` is a transparent
   * overlay layer: ProRes 4444 is the codec that carries alpha.
   */
  codec?: "h264" | "prores4444";
};

/** The CLI flags `renderComposition` passes. Pure, so it can be tested. */
export function renderArgs(
  id: string,
  out: string,
  props: unknown,
  opts: RenderOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const concurrency = resolveConcurrency(env.DEMO_CONCURRENCY);
  const codec =
    opts.codec === "prores4444"
      ? [
          "--codec=prores",
          "--prores-profile=4444",
          // WITHOUT THIS THE ALPHA IS DROPPED. prores-profile=4444 alone still
          // encoded yuv422p12le, so the transparent ground became opaque black
          // and the overlay hid the entire film. The pixel format carries it.
          "--pixel-format=yuva444p10le",
        ]
      : ["--crf=16"];
  return [
    "render",
    id,
    out,
    `--props=${JSON.stringify(props)}`,
    ...(opts.frames ? [`--frames=${opts.frames.first}-${opts.frames.last}`] : []),
    ...codec,
    `--gl=${resolveGl(env.DEMO_GL)}`,
    ...(concurrency != null ? [`--concurrency=${concurrency}`] : []),
    // Every composition here is silent by design; without this Remotion still
    // muxes an empty AAC track, which cost ~317 kb/s of pure nothing — and a
    // stray track on one segment breaks the -c copy concat.
    "--muted",
  ];
}

/** Render composition `id` to `out`, inheriting stdio so progress shows. */
export function renderComposition(
  id: string,
  out: string,
  props: unknown,
  opts: RenderOptions = {},
): void {
  execFileSync(REMOTION_BIN, renderArgs(id, out, props, opts), { stdio: "inherit" });
}
