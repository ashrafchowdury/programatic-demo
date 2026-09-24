/**
 * Motion forensics for rendered demos and reels.
 *
 * Turns the ad-hoc ffmpeg passes used to diagnose the Screen Studio gap into a
 * repeatable check, so every camera change can be measured instead of eyeballed.
 * It is the instrument the pipeline is judged by: `--json` writes the numbers,
 * `--compare` diffs two of those files.
 *
 * TWO MODES, because a demo and a reel are different films.
 *
 * DEMO (out/demo/*) — one continuous camera over one recording:
 *
 *   1. Camera moves   — block-matched zoom + pan per frame (scripts/lib/
 *                       motion-metrics.ts), so a move has a real velocity.
 *                       Onset jerk: speed on a move's first three frames as a
 *                       share of its peak. Velocity jumps: frame-to-frame
 *                       changes of velocity over MOVES.jump.
 *   2. Settle         — every press in public/<name>.clicks.json mapped to its
 *                       output frame (at DEMO_SPEED / the default, as
 *                       render.ts uses; --speed overrides), and the camera
 *                       speed read there.
 *   3. Sharpness      — mean edge width (ffmpeg `blurdetect`, Marziliano et al.
 *                       2002). See EDGE below for why not edge energy.
 *   4. Blank share    — how much of a zoomed hold is empty page white.
 *   5. Legacy         — the original scdet runs, frozen runs, Laplacian energy
 *                       and their verdicts, unchanged so old numbers still
 *                       compare.
 *
 * REEL (out/reel/*, or --reel) — cards and clips cut together. Measuring a
 * reel as one continuous clip is what produced "sharpness dip 0.00" on a blank
 * cream card, "end/start 10.8", and title-card holds flagged as dead air. So
 * a reel is first cut into segments at hard cuts, dissolves and empty seams;
 * each segment is classed card or footage; motion, sharpness and dead air are
 * measured on footage only; and each boundary is reported with its brightness
 * jump and how long the frame sits empty around it. Totals are set against the
 * style's measured `targets` (src/lib/style.ts).
 *
 * Usage:
 *   pnpm analyze                       # out/demo/agent-demo.mp4
 *   pnpm analyze agent-demo smoke      # bare names: demo first, then reel
 *   pnpm analyze out/reel/harness.mp4  # or pass explicit paths
 *   pnpm analyze --reel path.mp4       # force reel mode (--demo forces demo)
 *   pnpm analyze --sheet agent-demo    # also write a contact sheet PNG
 *   pnpm analyze x --json out.json     # write the numbers (a dir works too:
 *                                      #   <dir>/<feature>-<name>.json)
 *   pnpm -s analyze x --json -         # JSON to stdout, no report (-s: no pnpm noise)
 *   pnpm analyze --compare a.json b.json   # before -> after deltas
 *   pnpm analyze x --speed 1.5         # the speed it was rendered at (default: DEMO_SPEED or 1.25)
 *   pnpm analyze x --style ledger      # override the reel's style
 *
 * NOTE: this needs a SYSTEM ffmpeg (`brew install ffmpeg`), unlike the rest of
 * the pipeline. Remotion's bundled binary is a minimal build with no `scdet`,
 * `signalstats`, `convolution` or `blurdetect` filter, and no encoder for
 * `-f null`. This is a dev-only diagnostic, so the extra dependency stays out
 * of the render path.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { probeVideo, requireFilters, type VideoProbe } from "./lib/ffmpeg";
import { outPathOf } from "./lib/out";
import {
  ANALYSIS_H,
  ANALYSIS_W,
  classifySegment,
  compareSummaries,
  emptyRunAround,
  findBoundaries,
  findEmptySeams,
  findJumps,
  findMoves,
  FrameRecorder,
  MOVES,
  pressFrame,
  SEGMENT,
  type Boundary,
  type FrameRecord,
  type Move,
  type Plane,
} from "./lib/motion-metrics";
import {
  resolveStyle,
  STYLE_PRESETS,
  STYLES,
  type ReelStyle,
} from "../src/lib/style";
import { resolvePlaybackRate, type ClickLog } from "../src/lib/click-log";

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
 * Targets from docs/research (the pipeline motion audit, 24 Sep 2026). These
 * are goals, not reference measurements: the audit's "today" numbers came off
 * the click logs replayed through the camera; these checks read the render.
 */
const AUDIT = {
  /**
   * Speed on a camera move's first frame, as a share of its peak. Audit:
   * 70–92% today off the camera track (bezier(0.2, 0.2, 0.15, 1) starts at
   * slope 1), target < 15%. The render reads lower than the track for the
   * same curve — motion blur averages the first frame over a half-open
   * shutter — so the baselines here are the number to beat, not the audit's.
   */
  onsetShare: 0.15,
  /** Presses landing while the camera moves. Audit: 13 of 129 today, target 0. */
  pressesMidMove: 0,
  /**
   * Near-empty frames either side of a reel boundary. One or two bare frames
   * read as a beat; the audit's "the eye lands on nothing for several frames"
   * is agent-tool's stage seams, which measure 11–13 frames each.
   *
   * KNOWN FALSE POSITIVE: a RECAP card's head. The reference film fails this
   * itself — its recap (f1094) opens on 4 bare frames and then the mark alone
   * for 8 (ink 0.0068–0.0080, under SEGMENT.emptyInk), 12 f by this count,
   * while its five sentence-card heads measure 0–2 f. A proof recap has the
   * same shape (6 bare, mark 0.0057, 14 f — two bare frames long, because
   * BASE's recap.leadS 0.17 is 5.1 frames and the mark is binary, so it lands
   * on frame 6; 0.12 lands it on the film's frame 4). Ink cannot tell that apart
   * from agent-tool's seams — 3 bare frames, then a stage at 0.0045–0.0091 —
   * so the fix belongs in knowing WHICH boundary opens a recap (from the reel
   * spec), not in this number. Until then, a 12 f run at a recap head is the
   * reference's own shape, not a defect.
   */
  emptyRunF: 3,
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
/**
 * MOVING FRAME, the reel definition (docs/reel/02-motion.md): more than 0.2%
 * of pixels change by more than 8/255. Threshold each pixel, then count — an
 * averaged amplitude ranks encoders, not films. This is the metric the style
 * `targets.movingFrac` and `longestStillF` were measured with.
 */
const MOVING_PIXEL = 8;
const MOVING_SHARE = 0.002;
/**
 * EDGE WIDTH (blurdetect), sampled every EDGE_STEP frames at full resolution
 * (6 Hz: blurdetect costs ~35 ms a 2560 frame, the slowest pass here).
 *
 * Why not the old Laplacian energy: energy rewards aliasing. Measured on one
 * agent-tool source frame cropped and upscaled 2.4x to 2560 (the real zoom),
 * full-resolution Laplacian energy scored nearest-neighbour 2.90 against
 * Lanczos 1.31 — the jaggy one "twice as sharp". Mean edge width scored them
 * 3.99 vs 4.07 (a 2% difference) while still separating real blur: the same
 * frame through a sigma-2 Gaussian widened to 5.64. Lower = sharper. It
 * measures the width of edges, not how many there are, so it also does not
 * swing with how much text is in frame the way energy does.
 *
 * No full-reference metric: the render has no pixel-aligned reference (the
 * camera transform moves every frame), and registering one is a bigger
 * instrument than this check needs.
 */
const EDGE_STEP = 5;
/**
 * A hold is at least this long (s) with the camera under MOVES.floor. Zoomed
 * when the camera's integrated scale is at least ZOOMED x the first frame's —
 * every demo opens at base framing. Punch-ins in out/demo are 1.3–2.4x.
 */
const HOLD_MIN_S = 0.5;
/** Frames within which an empty seam merges into a neighbouring cut. */
const SEAM_MERGE_F = 15;
const ZOOMED = 1.15;

type Sample = { t: number; v: number };
type Run = { start: number; end: number; peak: number };
type Probe = VideoProbe;
type Mode = "demo" | "reel";

const execFileP = promisify(execFile);

const run = (bin: string, args: string[]): string =>
  execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Run one ffmpeg filter pass and read back a `metadata=print` dump.
 * Written to a file rather than parsed off stderr so ffmpeg's own logging can't
 * interleave into the numbers. Async so the passes run side by side — each is
 * one full-resolution decode, and they are independent.
 */
async function meter(
  file: string,
  filters: string,
  key: string,
  tag: string,
): Promise<Sample[]> {
  fs.mkdirSync(WORK, { recursive: true });
  // Feature dir + pid in the name: out/demo/x.mp4 and out/reel/x.mp4 share a
  // basename, and two analyses may run at once.
  const dump = path.join(
    WORK,
    `${path.basename(path.dirname(file))}-${path.basename(file)}.${process.pid}.${tag}.txt`,
  );
  await execFileP(
    "ffmpeg",
    [
      "-v", "error", "-y",
      "-i", file,
      "-vf", `${filters},metadata=print:file=${dump}`,
      "-an", "-f", "null", "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );

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
  fs.rmSync(dump, { force: true });
  return out;
}

/**
 * Per-frame CAMERA motion. Scaled to 320px first so codec noise averages out and
 * only whole-frame movement registers — which is exactly what a camera glide is.
 *
 * LEGACY: kept so the original verdicts still compare. The camera's real
 * velocity comes from the frame pass (estimateMotion).
 */
const motionTrace = (file: string) =>
  meter(file, "scale=320:-1,scdet=s=0:threshold=0", "lavfi.scd.score", "scd");

/**
 * Stream raw grey frames of `w` x `h` out of one ffmpeg filter graph.
 * Frames are handed over one at a time and not retained.
 */
function rawFrames(
  file: string,
  graph: string,
  w: number,
  h: number,
  onFrame: (d: Uint8Array) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const size = w * h;
    const proc = spawn(
      "ffmpeg",
      [
        "-v", "error",
        "-i", file,
        "-filter_complex", graph,
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let pending: Buffer = Buffer.alloc(0);
    let count = 0;
    proc.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let off = 0;
      while (pending.length - off >= size) {
        onFrame(new Uint8Array(pending.subarray(off, off + size)));
        count++;
        off += size;
      }
      pending = pending.subarray(off);
    });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(count)
        : reject(new Error(`ffmpeg exited ${code} on ${file}`)),
    );
  });
}

/**
 * Per-frame change at FULL resolution, two signals from one decode:
 *
 *   frozen — no pixel changed by more than 1 level. The dead-air signal.
 *   moving — share of pixels changed by more than MOVING_PIXEL.
 *
 * Why full resolution for "did anything change": scdet runs on a 320px
 * thumbnail, where a typed character is smaller than one pixel — so a 3s
 * stretch of text being typed once scored as perfectly frozen and the dead-air
 * checks reported 42.9% of the clip dead. It was not: three frames a second
 * apart showed "You are an expert PR |", "...analyzing code|", "...providing
 * clear, act|". Holding the camera still through a typing beat is what it is
 * supposed to do, so a thumbnail metric punished the correct behaviour.
 *
 * Each pixel is thresholded at full size FIRST (one new glyph on white reads
 * ~200, a held frame 0–1 of h264 ringing), and only the 0/255 mask is
 * area-downscaled for the trip out of ffmpeg: a 4x4 box holding one set pixel
 * still reads 16, so "any pixel" survives, and the box mean is the pixel
 * share. This replaced `tblend,signalstats` YMAX, which gave the same frozen
 * verdicts at 23 s per 30 s reel against ~2 s here.
 */
async function diffPass(
  file: string,
  n: number,
): Promise<{ frozen: boolean[]; moving: number[] }> {
  const w = ANALYSIS_W;
  const h = ANALYSIS_H;
  const frozen: boolean[] = [];
  const moving: number[] = [];
  const mask = (thr: number) =>
    `lut=y='if(gt(val\\,${thr})\\,255\\,0)',scale=${w}:${h}:flags=area`;
  await rawFrames(
    file,
    "format=gray,tblend=all_mode=difference,split[a][b];" +
      `[a]${mask(MOVING_PIXEL)}[m];[b]${mask(FROZEN_THRESHOLD - 1)}[z];[m][z]vstack`,
    w,
    2 * h,
    (d) => {
      let sum = 0;
      const half = w * h;
      for (let i = 0; i < half; i++) sum += d[i];
      let any = false;
      for (let i = half; i < 2 * half; i++)
        if (d[i]) {
          any = true;
          break;
        }
      moving.push(sum / 255 / half);
      frozen.push(!any);
    },
  );
  // tblend's first output is frame 0 against itself; pad if a build drops it.
  while (moving.length < n) {
    moving.unshift(0);
    frozen.unshift(true);
  }
  return { frozen, moving };
}

/**
 * LEGACY per-frame high-frequency energy: a Laplacian kernel, then mean luma
 * of the edge image. Rewards aliasing — see EDGE_STEP. Kept as a column only.
 */
const sharpnessTrace = (file: string) =>
  meter(
    file,
    "format=gray,scale=640:-1,convolution=" +
      Array(4).fill("0 -1 0 -1 4 -1 0 -1 0").join(":") +
      ",signalstats",
    "lavfi.signalstats.YAVG",
    "lap",
  );

/** Mean edge width every EDGE_STEP frames (lower = sharper). */
const edgeTrace = (file: string) =>
  meter(
    file,
    `select='not(mod(n\\,${EDGE_STEP}))',format=gray,` +
      "blurdetect=block_width=32:block_height=32",
    "lavfi.blur",
    "edge",
  );

// ---------------------------------------------------------------------------
// The frame pass: every frame at ANALYSIS_W x ANALYSIS_H, grey, through the
// camera estimator and the cell stats.
// ---------------------------------------------------------------------------

type FramePass = { recs: FrameRecord[]; l2: Plane[] };

async function framePass(file: string, fps: number): Promise<FramePass> {
  const rec = new FrameRecorder(fps);
  await rawFrames(
    file,
    `scale=${ANALYSIS_W}:${ANALYSIS_H}:flags=area,format=gray`,
    ANALYSIS_W,
    ANALYSIS_H,
    (d) => rec.push({ w: ANALYSIS_W, h: ANALYSIS_H, d }),
  );
  return { recs: rec.recs, l2: rec.l2 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const s = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (nums: number[]): number => {
  const s = nums.filter(Number.isFinite);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
};
const max = (nums: number[]): number => {
  const s = nums.filter(Number.isFinite);
  return s.length ? Math.max(...s) : NaN;
};
const round = (n: number, dp = 3): number =>
  Number.isFinite(n) ? Number(n.toFixed(dp)) : NaN;
const fmt = (n: number, dp = 2): string =>
  Number.isFinite(n) ? n.toFixed(dp) : "n/a";
const pct = (n: number, of: number) => (of === 0 ? 0 : (100 * n) / of);
const ok = (pass: boolean) => (pass ? "ok  " : "FAIL");

/** Index samples by frame number (samples carry pts time). */
const byFrame = (samples: Sample[], fps: number, n: number): number[] => {
  const out = new Array<number>(n).fill(NaN);
  for (const s of samples) {
    const f = Math.round(s.t * fps);
    if (f >= 0 && f < n) out[f] = s.v;
  }
  return out;
};

let quiet = false;
const log = (...a: unknown[]) => {
  if (!quiet) console.log(...a);
};

function contactSheet(file: string, label: string): void {
  fs.mkdirSync(WORK, { recursive: true });
  const out = path.join(WORK, `${label}.sheet.png`);
  run("ffmpeg", [
    "-v", "error", "-y",
    "-i", file,
    "-vf", "fps=2,scale=480:-1,tile=6x6",
    "-frames:v", "1",
    out,
  ]);
  log(`  contact sheet -> ${path.relative(ROOT, out)}`);
}

/** Longest run of consecutive `true`s, and how many there are overall. */
function longestRun(flags: boolean[]): number {
  let best = 0;
  let cur = 0;
  for (const f of flags) {
    cur = f ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Moves, onset shares and velocity jumps over a frame range. */
function cameraReport(
  recs: FrameRecord[],
  from: number,
  to: number,
  skip: (f: number) => boolean,
  fps: number,
) {
  const speed = recs
    .slice(from, to + 1)
    .map((r, i) => (skip(from + i) ? null : r.speed));
  const moves = findMoves(speed).map((m) => ({
    ...m,
    start: m.start + from,
    end: m.end + from,
    peakAt: m.peakAt + from,
  }));
  const models = recs.slice(from, to + 1).map((r) => r.model);
  const jumps = findJumps(models, (i) => skip(from + i)).map((j) => ({
    ...j,
    frame: j.frame + from,
  }));
  const known = speed.filter((s) => s !== null).length;
  return {
    moves,
    jumps,
    coverage: speed.length ? known / speed.length : 1,
    onset1: moves.map((m) => m.onset[0]),
    onset2: moves.map((m) => m.onset[1]),
    fps,
  };
}

function printMoves(moves: Move[], fps: number, indent = "    "): void {
  for (const m of moves) {
    const on = m.onset
      .map((v) => (Number.isFinite(v) ? `${fmt(100 * v, 0)}%` : "n/a").padStart(4))
      .join(" ");
    const flag = m.onset[0] > AUDIT.onsetShare ? "  <- lurch" : "";
    log(
      `${indent}${(m.start / fps).toFixed(2)}s -> ${(m.end / fps).toFixed(2)}s` +
        `  ${String(m.end - m.start + 1).padStart(3)} f  peak ${fmt(m.peak, 1).padStart(5)}` +
        `  onset ${on}${flag}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

type Summary = Record<string, number>;
type Report = {
  file: string;
  mode: Mode;
  probe: Probe;
  summary: Summary;
  details: Record<string, unknown>;
  pass: boolean;
};

function loadLog(name: string): ClickLog | null {
  const p = path.join(ROOT, "public", `${name}.clicks.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ClickLog;
  } catch {
    return null;
  }
}

async function analyzeDemo(
  file: string,
  p: Probe,
  opts: { speed?: number },
): Promise<Report> {
  const [fp, motion, diff, sharp, edge] = await Promise.all([
    framePass(file, p.fps),
    motionTrace(file),
    diffPass(file, p.frames),
    sharpnessTrace(file),
    edgeTrace(file),
  ]);
  const { recs } = fp;
  const n = recs.length;
  const fps = p.fps;

  // --- Camera -------------------------------------------------------------
  const cam = cameraReport(recs, 0, n - 1, () => false, fps);
  log(
    `\n  camera moves (speed > ${MOVES.floor} px@1920/f, peak >= ${MOVES.minPeak}):` +
      `  onset = first 3 frames as % of peak`,
  );
  printMoves(cam.moves, fps);
  log(
    `  velocity jumps > ${MOVES.jump} px@1920/f: ${cam.jumps.length}` +
      (cam.jumps.length
        ? `  (${cam.jumps.slice(0, 8).map((j) => `${(j.frame / fps).toFixed(2)}s ${fmt(j.dv, 0)}`).join(", ")}${cam.jumps.length > 8 ? ", ..." : ""})`
        : ""),
  );
  log(`  estimator coverage: ${fmt(100 * cam.coverage, 1)}% of frames`);

  // Integrated camera scale, relative to the first frame.
  const scale: number[] = [];
  let s = 1;
  for (const r of recs) {
    s *= 1 + (r.model?.a ?? 0);
    scale.push(s);
  }

  // --- Settle before press -----------------------------------------------
  const name = path.basename(file, path.extname(file));
  const clickLog = loadLog(name);
  const presses: Array<{
    label: string;
    frame: number;
    speed: number | null;
  }> = [];
  let playback = NaN;
  let logMatches = false;
  if (clickLog) {
    // The render's speed is not written anywhere in the output, so take what
    // render.ts takes (DEMO_SPEED, else the default). The frame count is only
    // a consistency check: the composition is at least durationMs / speed
    // long (longer when the camera track outlasts the recording — see
    // src/lib/demo-duration.ts), so a SHORTER render means this log is not
    // the one it was rendered from, or it was rendered at another speed.
    playback = opts.speed ?? resolvePlaybackRate(process.env.DEMO_SPEED);
    logMatches =
      p.frames >= Math.ceil((clickLog.durationMs / 1000 / playback) * fps) - 1;
    for (const c of clickLog.clicks) {
      const f = pressFrame(c.tDownMs ?? c.tMs, playback, fps, clickLog.offsetMs);
      if (f < 1 || f >= n) continue;
      const here = [recs[f]?.speed, recs[f + 1]?.speed];
      presses.push({
        label: c.label ?? "",
        frame: f,
        speed: here.some((v) => v == null)
          ? null
          : Math.max(...(here as number[])),
      });
    }
  }
  const midMove = presses.filter((x) => x.speed !== null && x.speed > MOVES.settle);
  const unknownPress = presses.filter((x) => x.speed === null);
  if (clickLog) {
    log(
      `\n  presses (public/${name}.clicks.json at ${playback}x` +
        `${logMatches ? "" : " — WARNING: the render is shorter than this log at this speed; newer log, or pass --speed"}):` +
        ` ${presses.length}, mid-move ${midMove.length}, unknown ${unknownPress.length}`,
    );
    for (const x of [...midMove, ...unknownPress]) {
      log(
        `    ${(x.frame / fps).toFixed(2)}s  f${x.frame}  camera ${x.speed === null ? "n/a" : fmt(x.speed, 1)} px@1920/f  "${x.label}"`,
      );
    }
  } else {
    log(`\n  presses: no public/${name}.clicks.json — settle check skipped`);
  }

  // --- Zoom holds: blank share ---------------------------------------------
  const holds: Array<{ from: number; to: number; scale: number; blank: number }> = [];
  {
    let k = 0;
    while (k < n) {
      const still = (i: number) => recs[i].speed !== null && (recs[i].speed ?? 0) <= MOVES.floor;
      if (!still(k)) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < n && still(e + 1)) e++;
      if ((e - k + 1) / fps >= HOLD_MIN_S) {
        holds.push({
          from: k,
          to: e,
          scale: median(scale.slice(k, e + 1)),
          blank: mean(recs.slice(k, e + 1).map((r) => r.stats.whiteBlank)),
        });
      }
      k = e + 1;
    }
  }
  const zoomed = holds.filter((h) => h.scale >= ZOOMED);
  log(`\n  zoom holds (>= ${HOLD_MIN_S}s, scale >= ${ZOOMED}x): blank page share`);
  for (const h of zoomed) {
    log(
      `    ${(h.from / fps).toFixed(2)}s -> ${(h.to / fps).toFixed(2)}s  ${fmt(h.scale, 2)}x  blank ${fmt(100 * h.blank, 0)}%`,
    );
  }
  if (!zoomed.length) log("    none");

  // --- Sharpness: edge width ---------------------------------------------
  const edgeF = byFrame(edge, fps, n);
  const holdFrames = new Set<number>();
  for (const h of holds) for (let i = h.from; i <= h.to; i++) holdFrames.add(i);
  const moveFrames = new Set<number>();
  for (const m of cam.moves) for (let i = m.start; i <= m.end; i++) moveFrames.add(i);
  const edgeAll = median(edgeF);
  const edgeHold = median(edgeF.filter((_, i) => holdFrames.has(i)));
  const edgeZoom = median(
    edgeF.filter((_, i) => zoomed.some((h) => i >= h.from && i <= h.to)),
  );
  const edgeMove = median(edgeF.filter((_, i) => moveFrames.has(i)));
  log(
    `\n  edge width (px, lower = sharper): all ${fmt(edgeAll)}  holds ${fmt(edgeHold)}` +
      `  zoomed holds ${fmt(edgeZoom)}  during moves ${fmt(edgeMove)}`,
  );

  // --- Moving frames (reel definition, for parity) -------------------------
  const movingF = diff.moving;
  const isMoving = movingF.slice(1).map((v) => v > MOVING_SHARE);
  const movingFrac = isMoving.filter(Boolean).length / Math.max(1, isMoving.length);
  const longestStillF = longestRun(isMoving.map((m) => !m));

  // --- LEGACY: scdet runs, frozen runs, Laplacian energy -------------------
  // Frozen as samples, so the legacy run grouping reads it unchanged.
  const change: Sample[] = diff.frozen.map((z, i) => ({ t: i / fps, v: z ? 0 : 255 }));
  const legacy = legacyChecks(p, motion, change, sharp);

  const onset1Max = max(cam.onset1);
  const checks: Array<[boolean, string]> = [
    ...legacy.checks,
    [
      !(onset1Max > AUDIT.onsetShare),
      `move onset: first frame at up to ${Number.isFinite(onset1Max) ? `${fmt(100 * onset1Max, 0)}%` : "n/a"} of peak speed (need < ${100 * AUDIT.onsetShare}%)`,
    ],
    [
      midMove.length <= AUDIT.pressesMidMove,
      `settle: ${midMove.length}/${presses.length} presses land while the camera moves (> ${MOVES.settle} px@1920/f)`,
    ],
  ];
  log("");
  for (const [pass, msg] of checks) log(`  [${ok(pass)}] ${msg}`);
  log(
    `  [info] velocity jumps ${cam.jumps.length}; zoomed-hold blank share max ` +
      `${fmt(100 * max(zoomed.map((h) => h.blank)), 0)}%; ends at ${fmt(scale[n - 1])}x of start framing`,
  );

  const summary: Summary = {
    durationS: round(p.duration),
    moves: cam.moves.length,
    onset1Median: round(median(cam.onset1)),
    onset1Max: round(onset1Max),
    onset2Median: round(median(cam.onset2)),
    peakSpeedMax: round(max(cam.moves.map((m) => m.peak)), 1),
    velocityJumps: cam.jumps.length,
    estimatorCoverage: round(cam.coverage),
    presses: presses.length,
    pressesMidMove: midMove.length,
    pressesUnknown: unknownPress.length,
    pressSpeedMax: round(max(presses.map((x) => x.speed ?? NaN)), 2),
    zoomedHolds: zoomed.length,
    blankShareZoomedMax: round(max(zoomed.map((h) => h.blank))),
    blankShareZoomedMean: round(mean(zoomed.map((h) => h.blank))),
    endScale: round(scale[n - 1]),
    edgeWidthMedian: round(edgeAll),
    edgeWidthHolds: round(edgeHold),
    edgeWidthZoomedHolds: round(edgeZoom),
    edgeWidthMoves: round(edgeMove),
    movingFrac: round(movingFrac),
    longestStillF,
    ...legacy.summary,
  };
  return {
    file,
    mode: "demo",
    probe: p,
    summary,
    details: {
      playbackSpeed: playback,
      clickLogMatchesRender: clickLog ? logMatches : null,
      moves: cam.moves.map((m) => ({
        startS: round(m.start / fps),
        endS: round(m.end / fps),
        frames: m.end - m.start + 1,
        peak: round(m.peak, 1),
        onset: m.onset.map((v) => round(v)),
      })),
      jumps: cam.jumps.map((j) => ({ t: round(j.frame / fps), dv: round(j.dv, 1) })),
      presses: presses.map((x) => ({
        t: round(x.frame / fps),
        frame: x.frame,
        speed: x.speed === null ? null : round(x.speed, 2),
        label: x.label,
      })),
      zoomedHolds: zoomed.map((h) => ({
        fromS: round(h.from / fps),
        toS: round(h.to / fps),
        scale: round(h.scale),
        blank: round(h.blank),
      })),
    },
    pass: checks.every(([pass]) => pass),
  };
}

/** The original three signals and verdicts, unchanged. */
function legacyChecks(
  p: Probe,
  motion: Sample[],
  change: Sample[],
  sharp: Sample[],
) {
  const moves = runs(motion, (v) => v > MOTION_THRESHOLD).filter(
    (r) => r.end > r.start,
  );
  const longestMove = moves.reduce(
    (a, r) => Math.max(a, (r.end - r.start) * 1000),
    0,
  );
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

  log(
    `\n  legacy: scdet longest run ${longestMove.toFixed(0)} ms; frozen ${frozenPct.toFixed(1)}%` +
      ` (${frozenRunPct.toFixed(1)}% in runs > 0.5s, longest ${longestFrozen.toFixed(2)}s);` +
      ` Laplacian end/start ${endVsStart.toFixed(2)}, dip ${fmt(dip)}`,
  );
  for (const r of frozenRuns) {
    const s = r.end - r.start;
    if (s > REFERENCE.frozenRunS) {
      log(`    ${r.start.toFixed(2)}s -> ${r.end.toFixed(2)}s  ${s.toFixed(2)} s frozen  <- dead`);
    }
  }
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
      `motion blur (legacy energy): sharpness dips to ${fmt(dip)} during moves (need <= ${REFERENCE.blurDip})`,
    ],
    [
      endVsStart >= REFERENCE.endVsStart,
      `returns to base (legacy energy): end/start framing ${endVsStart.toFixed(2)} (need >= ${REFERENCE.endVsStart})`,
    ],
  ];
  return {
    checks,
    summary: {
      legacyLongestMoveMs: round(longestMove, 0),
      legacyFrozenPct: round(frozenPct, 2),
      legacyFrozenRunPct: round(frozenRunPct, 2),
      legacyLongestFrozenS: round(longestFrozen, 2),
      legacyEnergyDip: round(dip),
      legacyEnergyEndVsStart: round(endVsStart),
    },
  };
}

// ---------------------------------------------------------------------------
// Reel mode
// ---------------------------------------------------------------------------

/** The reel's style, read from reels/<name>.ts the way reel.ts resolves it. */
function reelStyle(name: string, override?: string): ReelStyle | null {
  if (override) {
    if (!(STYLES as readonly string[]).includes(override)) {
      throw new Error(`--style ${override}: not one of ${STYLES.join(", ")}`);
    }
    return override as ReelStyle;
  }
  const spec = path.join(ROOT, "reels", `${name}.ts`);
  if (!fs.existsSync(spec)) return null;
  const src = fs.readFileSync(spec, "utf8");
  // Top-level fields of defineReel({...}) sit at two spaces; cards nest deeper.
  const style = src.match(/^ {2}style:\s*"(\w+)"/m)?.[1];
  const look = src.match(/^ {2}look:\s*"(\w+)"/m)?.[1];
  return resolveStyle({
    style: style as ReelStyle | undefined,
    look: look as "framed" | "fullbleed" | undefined,
  });
}

async function analyzeReel(
  file: string,
  p: Probe,
  opts: { style?: string },
): Promise<Report> {
  const [fp, diff, sharp, edge] = await Promise.all([
    framePass(file, p.fps),
    diffPass(file, p.frames),
    sharpnessTrace(file),
    edgeTrace(file),
  ]);
  const { recs } = fp;
  const n = recs.length;
  const fps = p.fps;

  // --- Boundaries + segments ------------------------------------------------
  const joins = findBoundaries(recs, fp.l2);
  const seams = findEmptySeams(recs).filter(
    // An empty seam within half a second of a cut or dissolve is that same
    // transition (a cut onto a card that starts bare), not a second boundary.
    (e) =>
      !joins.some(
        (j) => e.from <= j.to + SEAM_MERGE_F && e.to >= j.from - SEAM_MERGE_F,
      ),
  );
  const bounds: Boundary[] = [...joins, ...seams].sort((a, b) => a.frame - b.frame);
  // Frames belonging to a transition: excluded from motion, stills and moving.
  const inTransition = new Uint8Array(n);
  for (const b of bounds) {
    if (b.kind === "empty") continue;
    for (let i = b.from; i <= b.to; i++) inTransition[i] = 1;
  }

  // Segment edges: a cut starts a segment on its frame; a dissolve splits at
  // its midpoint; an empty seam at its midpoint.
  const edges = [0, ...bounds.map((b) => b.frame), n];
  const segments = edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1] - 1;
    const body = recs.slice(from, to + 1);
    return { from, to, kind: classifySegment(body) };
  });

  const lumaAt = (f: number) => recs[Math.max(0, Math.min(n - 1, f))].stats.meanLuma;
  const cuts = bounds.map((b) => {
    const before = b.kind === "dissolve" ? b.from - 1 : b.frame - 1;
    const after = b.kind === "dissolve" ? b.to : b.frame;
    const emptyRun = emptyRunAround(recs, b.frame);
    return {
      ...b,
      t: b.frame / fps,
      lumaJump: lumaAt(after) - lumaAt(before),
      emptyRun,
      onEmpty:
        recs[Math.max(0, before)].stats.ink <= SEGMENT.emptyInk ||
        recs[Math.min(n - 1, after)].stats.ink <= SEGMENT.emptyInk,
    };
  });

  log(`\n  boundaries: ${cuts.length}  (luma jump = mean luma after - before, 0-255)`);
  for (const c of cuts) {
    const span = c.kind === "dissolve" ? ` ${c.to - c.from + 1}f` : "";
    const flag = c.emptyRun > AUDIT.emptyRunF ? "  <- lands on empty" : "";
    log(
      `    ${c.t.toFixed(2).padStart(6)}s  f${String(c.frame).padEnd(4)} ${(c.kind + span).padEnd(12)}` +
        ` luma ${(c.lumaJump >= 0 ? "+" : "") + fmt(c.lumaJump, 0)}`.padEnd(12) +
        `  empty ${c.emptyRun} f${flag}`,
    );
  }

  // --- Per-segment measurement ----------------------------------------------
  const movingF = diff.moving;
  const edgeF = byFrame(edge, fps, n);
  const sharpF = byFrame(sharp, fps, n);
  const skip = (f: number) => inTransition[f] === 1 || f === 0;

  log(`\n  segments:`);
  const segReports = segments.map((sg, i) => {
    const len = (sg.to - sg.from + 1) / fps;
    const base = { index: i, kind: sg.kind, fromS: sg.from / fps, toS: (sg.to + 1) / fps, lengthS: len };
    if (sg.kind === "card") {
      log(`    #${i} ${(base.fromS).toFixed(2)}s  ${fmt(len)}s  card`);
      return { ...base, cam: null as ReturnType<typeof cameraReport> | null, frozenLongestS: NaN, edge: NaN, energy: NaN };
    }
    // Skip the segment's first frame: its motion is measured against the
    // previous shot.
    const cam = cameraReport(recs, sg.from, sg.to, (f) => skip(f) || f === sg.from, fps);
    const frozen = longestRun(
      diff.frozen.slice(sg.from + 1, sg.to + 1),
    );
    const edgeMed = median(edgeF.slice(sg.from, sg.to + 1));
    const energy = median(sharpF.slice(sg.from, sg.to + 1));
    log(
      `    #${i} ${(base.fromS).toFixed(2)}s  ${fmt(len)}s  footage  moves ${cam.moves.length}` +
        `  jumps ${cam.jumps.length}  frozen max ${fmt(frozen / fps)}s  edge ${fmt(edgeMed)}  energy ${fmt(energy)}`,
    );
    printMoves(cam.moves, fps, "        ");
    return { ...base, cam, frozenLongestS: frozen / fps, edge: edgeMed, energy };
  });

  // --- Totals vs the style's targets ---------------------------------------
  const style = reelStyle(path.basename(file, path.extname(file)), opts.style);
  const targets = style ? STYLE_PRESETS[style].targets : null;
  const minutes = p.duration / 60;
  const hard = cuts.filter((c) => c.kind === "cut").length;
  const dissolves = cuts.filter((c) => c.kind === "dissolve").length;
  const empties = cuts.filter((c) => c.kind === "empty").length;
  const meanShotS = mean(segReports.map((s) => s.lengthS));
  const cutsPerMin = (hard + dissolves) / Math.max(1e-9, minutes);
  // Moving/still on non-transition frames, the docs/reel/02-motion.md chain.
  const counted: boolean[] = [];
  for (let f = 1; f < n; f++) if (!skip(f)) counted.push(movingF[f] > MOVING_SHARE);
  const movingFrac = counted.filter(Boolean).length / Math.max(1, counted.length);
  const longestStillF = longestRun(counted.map((m) => !m));
  const absJump = mean(cuts.filter((c) => c.kind !== "empty").map((c) => Math.abs(c.lumaJump)));

  log(
    `\n  vs style ${style ?? "(unknown: no reels/<name>.ts — pass --style)"}` +
      (targets ? "" : style ? " — this style has no measured targets" : ""),
  );
  const row = (label: string, ours: string, target: string) =>
    log(`    ${label.padEnd(16)} ${ours.padStart(8)}   target ${target}`);
  row("mean shot", `${fmt(meanShotS)}s`, targets ? `${targets.meanShotS}s` : "-");
  row("cuts / min", fmt(cutsPerMin, 1), targets ? String(targets.cutsPerMin) : "-");
  row("moving frames", fmt(movingFrac, 3), targets ? String(targets.movingFrac) : "-");
  row("longest still", `${longestStillF} f`, targets ? `${targets.longestStillF} f` : "-");
  row("mean |luma jump|", fmt(absJump, 0), targets ? targets.cutDelta : "-");
  log(`    (${hard} hard cuts, ${dissolves} dissolves, ${empties} empty seams; seams are not counted as cuts)`);

  const footage = segReports.filter((s) => s.cam);
  const onsets = footage.flatMap((s) => s.cam?.onset1 ?? []);
  const onset1Max = max(onsets);
  const worstEmpty = max(cuts.map((c) => c.emptyRun));
  const longestFrozen = max(footage.map((s) => s.frozenLongestS));
  const checks: Array<[boolean, string]> = [
    [
      !(worstEmpty > AUDIT.emptyRunF),
      `empty frames: longest near-empty run at a boundary ${Number.isFinite(worstEmpty) ? worstEmpty : 0} f (ceiling ${AUDIT.emptyRunF})`,
    ],
    [
      !(onset1Max > AUDIT.onsetShare),
      `footage move onset: first frame at up to ${Number.isFinite(onset1Max) ? `${fmt(100 * onset1Max, 0)}%` : "n/a"} of peak (need < ${100 * AUDIT.onsetShare}%)`,
    ],
    [
      !(longestFrozen > REFERENCE.frozenRunS),
      `dead air in footage: longest frozen run ${fmt(longestFrozen)}s (ceiling ${REFERENCE.frozenRunS}s; cards excluded)`,
    ],
  ];
  log("");
  for (const [pass, msg] of checks) log(`  [${ok(pass)}] ${msg}`);

  const summary: Summary = {
    durationS: round(p.duration),
    segments: segReports.length,
    cards: segReports.filter((s) => s.kind === "card").length,
    footage: footage.length,
    hardCuts: hard,
    dissolves,
    emptySeams: empties,
    meanShotS: round(meanShotS),
    cutsPerMin: round(cutsPerMin, 2),
    movingFrac: round(movingFrac),
    longestStillF,
    meanAbsLumaJump: round(absJump, 1),
    boundariesOnEmpty: cuts.filter((c) => c.onEmpty).length,
    maxEmptyRunF: Number.isFinite(worstEmpty) ? worstEmpty : 0,
    totalEmptyRunF: cuts.reduce((a, c) => a + c.emptyRun, 0),
    footageMoves: footage.reduce((a, s) => a + (s.cam?.moves.length ?? 0), 0),
    footageOnset1Median: round(median(onsets)),
    footageOnset1Max: round(onset1Max),
    footageVelocityJumps: footage.reduce((a, s) => a + (s.cam?.jumps.length ?? 0), 0),
    footageEdgeWidthMedian: round(median(footage.map((s) => s.edge))),
    footageLegacyEnergyMedian: round(median(footage.map((s) => s.energy))),
    footageLongestFrozenS: round(longestFrozen, 2),
  };
  return {
    file,
    mode: "reel",
    probe: p,
    summary,
    details: {
      style,
      targets,
      boundaries: cuts.map((c) => ({
        t: round(c.t),
        frame: c.frame,
        kind: c.kind,
        frames: c.to - c.from + 1,
        lumaJump: round(c.lumaJump, 1),
        onEmpty: c.onEmpty,
        emptyRunF: c.emptyRun,
      })),
      segments: segReports.map((s) => ({
        index: s.index,
        kind: s.kind,
        fromS: round(s.fromS),
        lengthS: round(s.lengthS),
        ...(s.cam
          ? {
              moves: s.cam.moves.map((m) => ({
                startS: round(m.start / fps),
                frames: m.end - m.start + 1,
                peak: round(m.peak, 1),
                onset: m.onset.map((v) => round(v)),
              })),
              velocityJumps: s.cam.jumps.length,
              longestFrozenS: round(s.frozenLongestS, 2),
              edgeWidth: round(s.edge),
              legacyEnergy: round(s.energy),
            }
          : {}),
      })),
    },
    pass: checks.every(([pass]) => pass),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function resolve(arg: string): string {
  if (arg.includes("/") || arg.endsWith(".mp4") || arg.endsWith(".webm")) {
    return path.resolve(ROOT, arg);
  }
  // A bare name is a demo unless only a reel of that name exists — the two
  // share a name by design (a reel is cut FROM the demo it names).
  const demo = outPathOf("demo", `${arg}.mp4`);
  if (fs.existsSync(demo)) return demo;
  const reel = outPathOf("reel", `${arg}.mp4`);
  if (fs.existsSync(reel)) return reel;
  return demo;
}

/** Reel when the file sits under out/reel/ (or any `reel` directory). */
const detectMode = (file: string): Mode =>
  path.basename(path.dirname(file)) === "reel" ? "reel" : "demo";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function compare(a: string, b: string): void {
  const ra = JSON.parse(fs.readFileSync(a, "utf8")) as Report;
  const rb = JSON.parse(fs.readFileSync(b, "utf8")) as Report;
  console.log(`\n=== ${path.basename(a)} -> ${path.basename(b)} (${ra.mode} -> ${rb.mode}) ===`);
  const rows = compareSummaries(ra.summary, rb.summary);
  const w = Math.max(...rows.map((r) => r.key.length));
  for (const r of rows) {
    const d =
      r.delta === null
        ? "(only one side)"
        : r.delta === 0
          ? "="
          : `${r.delta > 0 ? "+" : ""}${fmt(r.delta, 3)}` +
            (r.before ? `  (${r.delta > 0 ? "+" : ""}${fmt((100 * r.delta) / Math.abs(r.before), 0)}%)` : "");
    console.log(
      `  ${r.key.padEnd(w)}  ${String(r.before ?? "-").padStart(9)} -> ${String(r.after ?? "-").padEnd(9)} ${d}`,
    );
  }
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const cmp = args.indexOf("--compare");
  if (cmp >= 0) {
    const [a, b] = args.slice(cmp + 1, cmp + 3);
    if (!a || !b) throw new Error("--compare needs two JSON files: --compare before.json after.json");
    compare(a, b);
    return;
  }
  requireFilters(
    ["scdet", "signalstats", "convolution", "metadata", "blurdetect"],
    "scripts/analyze.ts",
  );
  const jsonOut = flag(args, "--json");
  const speedArg = flag(args, "--speed");
  const styleArg = flag(args, "--style");
  const sheet = args.includes("--sheet");
  const force: Mode | null = args.includes("--reel")
    ? "reel"
    : args.includes("--demo")
      ? "demo"
      : null;
  quiet = jsonOut === "-";
  const targets = args.filter((a) => !a.startsWith("--"));
  const files = (targets.length ? targets : ["agent-demo"]).map(resolve);

  let allPass = true;
  const reports: Report[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `Missing ${path.relative(ROOT, file)} — render it first (pnpm render <name>).`,
      );
    }
    const mode = force ?? detectMode(file);
    const p = probeVideo(file);
    log(`\n=== ${path.relative(ROOT, file)}  [${mode}] ===`);
    log(
      `  ${p.width}x${p.height}  ${p.fps.toFixed(0)} fps  ${p.duration.toFixed(2)} s  ${p.frames} frames`,
    );
    const started = Date.now();
    const report =
      mode === "reel"
        ? await analyzeReel(file, p, { style: styleArg })
        : await analyzeDemo(file, p, {
            speed: speedArg ? Number(speedArg) : undefined,
          });
    log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    if (sheet) contactSheet(file, path.basename(file, path.extname(file)));
    reports.push(report);
    allPass = report.pass && allPass;

    if (jsonOut && jsonOut !== "-") {
      const asDir =
        files.length > 1 ||
        jsonOut.endsWith("/") ||
        (fs.existsSync(jsonOut) && fs.statSync(jsonOut).isDirectory());
      const feature = path.basename(path.dirname(file));
      const dest = asDir
        ? path.join(jsonOut, `${feature}-${path.basename(file, path.extname(file))}.json`)
        : jsonOut;
      fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
      fs.writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
      log(`  json -> ${dest}`);
    }
  }
  if (quiet) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  }
  log("");
  if (!allPass) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
