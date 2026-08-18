/**
 * Motion forensics for rendered demo clips.
 *
 * Turns the ad-hoc ffmpeg passes used to diagnose the Screen Studio gap into a
 * repeatable check, so every camera change can be measured instead of eyeballed.
 * Three signals, all per-frame:
 *
 *   1. Motion runs   — `scdet` score, grouped into above-threshold runs. A camera
 *                      move should read as one 400–600 ms run, not a 2-frame spike.
 *   2. Frozen runs   — frames pixel-identical to their predecessor. Real screen
 *                      recordings never freeze; a long frozen run is the loudest
 *                      synthetic tell we have.
 *   3. Sharpness     — Laplacian high-frequency energy, normalised to the clip
 *                      median. Dips during camera moves = motion blur working.
 *                      A dip that never recovers = upscaling, or a clip that
 *                      ended zoomed in instead of returning to base.
 *
 * Usage:
 *   pnpm analyze                       # out/agent-demo.mp4
 *   pnpm analyze agent-demo smoke      # bare names resolve under out/
 *   pnpm analyze path/to/ref.mp4       # or pass explicit paths
 *   pnpm analyze --sheet agent-demo    # also write a contact sheet PNG
 *
 * Reference values measured from the two Screen Studio clips are in REFERENCE
 * below; the verdict lines compare against those, not against invented targets.
 *
 * NOTE: this needs a SYSTEM ffmpeg (`brew install ffmpeg`), unlike the rest of
 * the pipeline. Remotion's bundled binary is a minimal build with no `scdet`,
 * `signalstats` or `convolution` filter, and no encoder for `-f null`. This is a
 * dev-only diagnostic, so the extra dependency stays out of the render path.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, ".diag", "analyze");

/**
 * Thresholds calibrated so BOTH supplied Screen Studio references pass
 * (V1 = 30fps slide editor, V3 = 24fps Notion board) while the current render
 * fails. A threshold that flags the references is measuring the wrong thing.
 *
 * Measured reference values are quoted per field. These are observations of two
 * clips, not published Screen Studio defaults.
 */
const REFERENCE = {
  /**
   * A glide shows up as a sustained run of motion; a snap or hard cut is over in
   * one or two frames. Note this cannot measure glide *quality* — run length also
   * grows with zoom magnitude, so a gentle 1.5x move reads shorter than V1's 2.0x
   * one even at identical duration. It is a floor that catches snapping, not a
   * grade. The authored move duration is asserted directly in src/lib/zoom.test.ts.
   * Longest run: V1 867 ms, V3 833 ms; a snapped camera would be under 100 ms.
   */
  longestMoveMs: 250,
  /**
   * Frozen-frame measures are a DEAD-AIR signal about the script, not a
   * rendering defect.
   *
   * These were recalibrated once, and the history matters because it invalidated
   * a lot of earlier conclusions. They used to be measured off `motionTrace`,
   * which scales to 320px first — so anything smaller than one thumbnail pixel
   * was invisible and scored as frozen. Under that metric this pipeline appeared
   * to sit at 31–42% frozen against the references' 2.9–31.3%, and a long
   * paragraph of text being typed registered as a 2.87s dead hole.
   *
   * Measured properly (changeTrace, full resolution), the same clip is 0.3%
   * frozen and V1 is 6.3% — this pipeline is BETTER than the reference, and the
   * gap those numbers described never existed. Two "fixes" were built and
   * reverted chasing it:
   *
   *   - Idle cursor tremor. Read as a shake, and the premise was false anyway.
   *   - A compositor keep-alive at capture, on the theory that Playwright was
   *     dropping frames. It changed nothing, because nothing was being dropped.
   *
   * If a dead-air check fails, confirm what is on screen at that timestamp
   * before changing anything. Both reverted fixes would have been avoided by
   * pulling two frames out of the "frozen" span and looking at them.
   *
   * Frozen frames overall: V1 6.3%, V3 0.0%.
   */
  frozenPct: 15,
  /** Time inside frozen runs > 0.5 s: V1 4.6%, V3 0%. */
  frozenRunPct: 18,
  /** Longest single frozen run: V1 0.53 s, V3 none. */
  frozenRunS: 1.1,
  /**
   * Sharpness at peak camera velocity, sampled only inside motion runs so an
   * empty end-card can't masquerade as motion blur. V1 0.35, V3 0.57 of median.
   */
  blurDip: 0.65,
  /**
   * Every reference clip returns to base scale, so it ends framed like it
   * started. This ratio — not absolute sharpness — is what detects the return:
   * V1 0.93, V3 0.98, ours 0.33 (ends parked at 1.6x on an empty corner).
   */
  endVsStart: 0.8,
};

/**
 * Above this scdet score a frame counts as "the picture is moving". Low enough to
 * follow the long decaying tail of the camera easing, which spends the second half
 * of every move covering the last ~10% of the distance.
 */
const MOTION_THRESHOLD = 0.08;
/** Motion strong enough to be worth sampling for motion blur. */
const BLUR_SAMPLE_THRESHOLD = 0.25;
/**
 * Largest single-channel change between consecutive frames, below which nothing
 * happened. 0 is bit-identical; 1–2 is h264 ringing on a held frame. One new
 * text glyph on white reads ~200, so this separates cleanly.
 */
const FROZEN_THRESHOLD = 2;
/** Frames closer than this join the same run. */
const RUN_GAP_S = 0.15;

type Sample = { t: number; v: number };
type Run = { start: number; end: number; peak: number };
type Probe = { width: number; height: number; fps: number; duration: number };

const run = (bin: string, args: string[]): string =>
  execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });

const ffmpeg = (args: string[]) => run("ffmpeg", args);
const ffprobe = (args: string[]) => run("ffprobe", args);

/** Fail with the fix, not a stack trace, when ffmpeg is missing or too minimal. */
function requireFfmpeg(): void {
  let filters = "";
  try {
    filters = run("ffmpeg", ["-hide_banner", "-filters"]);
  } catch {
    throw new Error(
      "scripts/analyze.ts needs a system ffmpeg on PATH — `brew install ffmpeg`.",
    );
  }
  const missing = ["scdet", "signalstats", "convolution", "metadata"].filter(
    (f) => !new RegExp(`\\b${f}\\b`).test(filters),
  );
  if (missing.length) {
    throw new Error(
      `This ffmpeg build lacks the ${missing.join(", ")} filter(s). Install a full build: \`brew install ffmpeg\`.`,
    );
  }
}

function probe(file: string): Probe {
  const raw = ffprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,duration",
    "-of", "default=noprint_wrappers=1",
    file,
  ]);
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? "";
  const [num, den] = get("r_frame_rate").split("/");
  return {
    width: Number(get("width")),
    height: Number(get("height")),
    fps: Number(num) / Number(den || 1),
    duration: Number(get("duration")),
  };
}

/**
 * Run one ffmpeg filter pass and read back a `metadata=print` dump.
 * Written to a file rather than parsed off stderr so ffmpeg's own logging can't
 * interleave into the numbers.
 */
function meter(file: string, filters: string, key: string): Sample[] {
  fs.mkdirSync(WORK, { recursive: true });
  const dump = path.join(WORK, `${path.basename(file)}.${key}.txt`);
  ffmpeg([
    "-v", "error", "-y",
    "-i", file,
    "-vf", `${filters},metadata=print:file=${dump}`,
    "-an", "-f", "null", "-",
  ]);

  const out: Sample[] = [];
  let t = 0;
  for (const line of fs.readFileSync(dump, "utf8").split("\n")) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) {
      t = Number(time[1]);
      continue;
    }
    const val = line.match(new RegExp(`${key}=([-\\d.]+)`));
    if (val) out.push({ t, v: Number(val[1]) });
  }
  return out;
}

/**
 * Per-frame CAMERA motion. Scaled to 320px first so codec noise averages out and
 * only whole-frame movement registers — which is exactly what a camera glide is.
 *
 * Do not reuse this to answer "is anything happening": see changeTrace.
 */
const motionTrace = (file: string): Sample[] =>
  meter(file, "scale=320:-1,scdet=s=0:threshold=0", "lavfi.scd.score");

/**
 * Per-frame "did ANY pixel change", at full resolution.
 *
 * A separate signal from motionTrace, and the distinction matters. scdet runs on
 * a 320px thumbnail, where a typed character is smaller than one pixel — so a
 * 3s stretch of text being typed scored as perfectly frozen and the dead-air
 * checks reported 42.9% of the clip dead. It was not: three frames a second
 * apart showed "You are an expert PR |", "...analyzing code|", "...providing
 * clear, act|".
 *
 * That made the harness punish the correct behaviour, since holding the camera
 * still through a typing beat is what it is supposed to do. `tblend` differences
 * consecutive frames at full size and YMAX takes the single largest channel
 * delta, so one new glyph on white reads ~200 while a genuinely held frame reads
 * 0. Frozen means frozen.
 */
const changeTrace = (file: string): Sample[] =>
  meter(
    file,
    "format=gray,tblend=all_mode=difference,signalstats",
    "lavfi.signalstats.YMAX",
  );

/**
 * Per-frame high-frequency energy: a Laplacian kernel, then mean luma of the
 * edge image. Higher = more fine detail = sharper.
 */
const sharpnessTrace = (file: string): Sample[] =>
  meter(
    file,
    "format=gray,scale=640:-1,convolution=" +
      Array(4).fill("0 -1 0 -1 4 -1 0 -1 0").join(":") +
      ",signalstats",
    "lavfi.signalstats.YAVG",
  );

/** Group samples passing `hit` into contiguous runs. */
function runs(samples: Sample[], hit: (v: number) => boolean): Run[] {
  const out: Run[] = [];
  for (const s of samples) {
    if (!hit(s.v)) continue;
    const cur = out[out.length - 1];
    if (cur && s.t - cur.end <= RUN_GAP_S) {
      cur.end = s.t;
      cur.peak = Math.max(cur.peak, s.v);
    } else {
      out.push({ start: s.t, end: s.t, peak: s.v });
    }
  }
  return out;
}

const median = (nums: number[]): number => {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const pct = (n: number, of: number) => (of === 0 ? 0 : (100 * n) / of);
const ok = (pass: boolean) => (pass ? "ok  " : "FAIL");

function contactSheet(file: string, label: string): void {
  fs.mkdirSync(WORK, { recursive: true });
  const out = path.join(WORK, `${label}.sheet.png`);
  ffmpeg([
    "-v", "error", "-y",
    "-i", file,
    "-vf", "fps=2,scale=480:-1,tile=6x6",
    "-frames:v", "1",
    out,
  ]);
  console.log(`  contact sheet -> ${path.relative(ROOT, out)}`);
}

function analyze(file: string, sheet: boolean): boolean {
  const label = path.basename(file, path.extname(file));
  const p = probe(file);
  console.log(`\n=== ${path.relative(ROOT, file)} ===`);
  console.log(
    `  ${p.width}x${p.height}  ${p.fps.toFixed(0)} fps  ${p.duration.toFixed(2)} s`,
  );

  const motion = motionTrace(file);
  const sharp = sharpnessTrace(file);
  if (motion.length === 0 || sharp.length === 0) {
    console.log("  no frames decoded — skipping");
    return false;
  }

  // --- Motion runs -------------------------------------------------------
  const moves = runs(motion, (v) => v > MOTION_THRESHOLD).filter(
    (r) => r.end > r.start,
  );
  const longestMove = moves.reduce(
    (a, r) => Math.max(a, (r.end - r.start) * 1000),
    0,
  );
  console.log(`\n  motion runs (score > ${MOTION_THRESHOLD}):`);
  for (const r of moves) {
    const ms = (r.end - r.start) * 1000;
    const flag = ms >= REFERENCE.longestMoveMs ? "  <- glide" : "";
    console.log(
      `    ${r.start.toFixed(2)}s -> ${r.end.toFixed(2)}s  ${ms.toFixed(0).padStart(4)} ms  peak ${r.peak.toFixed(2)}${flag}`,
    );
  }

  // --- Frozen frames -----------------------------------------------------
  // Measured on changeTrace, NOT motion: a still camera over a page that is
  // still doing something is not dead air.
  const change = changeTrace(file);
  const frozenFrames = change.filter((s) => s.v < FROZEN_THRESHOLD).length;
  const frozenPct = pct(frozenFrames, change.length);
  const frozenRuns = runs(change, (v) => v < FROZEN_THRESHOLD).filter(
    (r) => r.end - r.start > 0.5,
  );
  const frozenRunS = frozenRuns.reduce((a, r) => a + (r.end - r.start), 0);
  const frozenRunPct = pct(frozenRunS, p.duration);
  const longestFrozen = frozenRuns.reduce(
    (a, r) => Math.max(a, r.end - r.start),
    0,
  );
  console.log(
    `\n  frozen frames: ${frozenFrames}/${change.length} (${frozenPct.toFixed(1)}%)` +
      `   in runs > 0.5s: ${frozenRunS.toFixed(2)}s (${frozenRunPct.toFixed(1)}%)`,
  );
  for (const r of frozenRuns) {
    const s = r.end - r.start;
    const flag = s > REFERENCE.frozenRunS ? "  <- dead" : "";
    console.log(
      `    ${r.start.toFixed(2)}s -> ${r.end.toFixed(2)}s  ${s.toFixed(2)} s frozen${flag}`,
    );
  }

  // --- Sharpness ---------------------------------------------------------
  const med = median(sharp.map((s) => s.v));
  const ratio = sharp.map((s) => ({ t: s.t, v: s.v / med }));
  const window = (from: number, to: number) => {
    const win = ratio.filter((s) => s.t >= from && s.t <= to);
    return win.reduce((a, s) => a + s.v, 0) / Math.max(1, win.length);
  };
  // Sample the blur dip only while the picture is moving — otherwise a sparse
  // end-card reads as "motion blur" when nothing is moving at all.
  const inMotion = ratio.filter((s) =>
    moves.some(
      (r) =>
        r.peak >= BLUR_SAMPLE_THRESHOLD &&
        s.t >= r.start - 0.1 &&
        s.t <= r.end + 0.1,
    ),
  );
  const dip = inMotion.length ? Math.min(...inMotion.map((s) => s.v)) : NaN;
  // Average over half a second rather than one frame, which can land mid-blur.
  const startSharp = window(0, 0.5);
  const endSharp = window(p.duration - 0.5, p.duration);
  const endVsStart = endSharp / (startSharp || 1);
  console.log(
    `\n  sharpness (1.00 = clip median):  start ${startSharp.toFixed(2)}` +
      `   end ${endSharp.toFixed(2)}   end/start ${endVsStart.toFixed(2)}` +
      `   dip during motion ${Number.isNaN(dip) ? "n/a" : dip.toFixed(2)}`,
  );

  // --- Verdict -----------------------------------------------------------
  const checks: Array<[boolean, string]> = [
    [
      longestMove >= REFERENCE.longestMoveMs,
      `camera glides: longest motion run ${longestMove.toFixed(0)} ms (need >= ${REFERENCE.longestMoveMs}; a snap is < 100)`,
    ],
    [
      frozenPct <= REFERENCE.frozenPct,
      `dead air: ${frozenPct.toFixed(1)}% frozen frames (ceiling ${REFERENCE.frozenPct}%) — tighten the flow's pauses`,
    ],
    [
      frozenRunPct <= REFERENCE.frozenRunPct,
      `dead air: ${frozenRunPct.toFixed(1)}% of runtime inside frozen runs (ceiling ${REFERENCE.frozenRunPct}%)`,
    ],
    [
      longestFrozen <= REFERENCE.frozenRunS,
      `dead air: longest frozen run ${longestFrozen.toFixed(2)}s (ceiling ${REFERENCE.frozenRunS}s)`,
    ],
    [
      Number.isNaN(dip) || dip <= REFERENCE.blurDip,
      `motion blur: sharpness dips to ${Number.isNaN(dip) ? "n/a" : dip.toFixed(2)} during moves (need <= ${REFERENCE.blurDip})`,
    ],
    [
      endVsStart >= REFERENCE.endVsStart,
      `returns to base: end/start framing ${endVsStart.toFixed(2)} (need >= ${REFERENCE.endVsStart})`,
    ],
  ];
  console.log("");
  for (const [pass, msg] of checks) console.log(`  [${ok(pass)}] ${msg}`);

  if (sheet) contactSheet(file, label);
  return checks.every(([pass]) => pass);
}

function resolve(arg: string): string {
  if (arg.includes("/") || arg.endsWith(".mp4") || arg.endsWith(".webm")) {
    return path.resolve(ROOT, arg);
  }
  return path.join(ROOT, "out", `${arg}.mp4`);
}

function main() {
  requireFfmpeg();
  const args = process.argv.slice(2);
  const sheet = args.includes("--sheet");
  const targets = args.filter((a) => !a.startsWith("--"));
  const files = (targets.length ? targets : ["agent-demo"]).map(resolve);

  let allPass = true;
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `Missing ${path.relative(ROOT, file)} — render it first (pnpm render <name>).`,
      );
    }
    allPass = analyze(file, sheet) && allPass;
  }
  console.log("");
  if (!allPass) process.exitCode = 1;
}

main();
