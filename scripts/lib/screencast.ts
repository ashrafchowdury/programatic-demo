/**
 * Capture straight from CDP `Page.startScreencast`, instead of Playwright's
 * `recordVideo`.
 *
 * WHY. Playwright 1.62 pipes the same screencast into ffmpeg with flags it
 * hard-codes (playwright-core coreBundle.js, FfmpegVideoRecorder):
 *
 *   -r 25 -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M
 *
 * One megabit for 1080p is thin; under CAPTURE_SCALE 2 the same megabit covers
 * a 3840x2160 frame. Measured on the smoke fixture at scale 2: 889 kb/s VP8, and
 * convert then re-encoded that at CRF 20 (482 kb/s). Anything that moves blocks
 * up, and the text softens before Remotion ever zooms it. It also quantises the
 * clock to 25fps, which is where the 5:6 judder against the 30fps render came
 * from (see CAPTURE_FPS).
 *
 * WHAT THE COMPOSITOR ACTUALLY DELIVERS. Measured on the smoke fixture, headless
 * Chromium, frames acked on receipt:
 *
 *                         anim fps   scroll fps   idle fps   PNG kB/frame
 *   1920x1080             60         40-46        0          76
 *   3840x2160 (scale 2)   56-58      38-41        0          212
 *
 * JPEG was never faster (q95 54 fps, q100 55 fps at 3840), so there is no
 * throughput to buy with it, and it is lossy: against `page.screenshot()` of
 * the same state, JPEG q95 is 50.1 dB PSNR and q100 51.1 dB, while the
 * screencast PNG is bit-identical (SSIM 1.000, PSNR inf). PNG it is.
 *
 * Idle is ZERO frames: the screencast is damage-driven, so a still page sends
 * nothing at all. The file therefore cannot be made by counting frames; each
 * frame is placed on its own `metadata.timestamp` (the compositor's swap time,
 * epoch seconds, same clock as Date.now()) and HELD until the next one — see
 * holdPlan.
 *
 * WHAT IT DOES NOT CHANGE. The screencast still emits CSS-viewport pixels,
 * whatever deviceScaleFactor or maxWidth say — re-measured here against raw
 * CDP: viewport 1920 @ DSF 2 with maxWidth 3840 still sends 1920x1080 frames.
 * CAPTURE_SCALE (a bigger CSS viewport under root zoom) remains the only way to
 * more pixels, and it does deliver them: a scale-2 frame against a DSF-2
 * screenshot of the 1920 layout (the true device-pixel raster) is SSIM 0.994 /
 * 33.7 dB — the same raster up to sub-pixel layout rounding. DSF itself adds
 * nothing to the frame at scale 2 (DSF 1 vs 2: 92.8 dB, i.e. identical).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CDPSession, Page } from "playwright";
import { BT709_ARGS, X264_BT709_VUI } from "./encode";

export type CaptureMode = "cdp" | "playwright";

/**
 * Which recorder a shoot uses. `cdp` is the default; `DEMO_CAPTURE=playwright`
 * falls back to Playwright's own 1 Mbps VP8 `recordVideo`, kept until the CDP
 * path has been proven on every live flow.
 */
export function resolveCaptureMode(raw?: string): CaptureMode {
  return raw?.trim().toLowerCase() === "playwright" ? "playwright" : "cdp";
}

/**
 * Frame rate of the constant-rate intermediate the frames are laid onto.
 *
 * The render is 30fps and replays the shoot at DEMO_SPEED, so output frame n
 * shows source time n x speed / 30. A source frame lands one-to-one only when
 * the source rate is 30 / speed, and every other pairing skips or repeats.
 * Worst-case error per output frame against an ideal cadence (modelled, same
 * for nearest and floor sampling):
 *
 *   source    1.0x      1.25x (default)   1.5x      2.0x
 *   25fps     33.3ms    38.3ms*           30.0ms    26.7ms     (Playwright)
 *   30fps      0        25.0ms            16.7ms     0
 *   60fps      0         8.3ms             0         0
 *
 *   * 24 of 25 steps are exact and one frame a second is skipped: the "near
 *     perfect at 1.25x" the old 25fps source got by coincidence, and the 5:6
 *     judder (one repeat every sixth frame) it got at 1.0x.
 *
 * 60 is exact at 1.0x, 1.5x and 2x, and at the default 1.25x alternates 2 and 3
 * source frames (±8.3ms) instead of 30fps's 1-1-1-2 stutter. It is also real
 * detail, not interpolation: the compositor delivers 56-60 fps while anything
 * moves (table above), and Remotion's motion blur samples sub-frame times, which
 * a 60fps source actually answers.
 *
 * Held frames cost almost nothing in h264: the smoke intermediate (lossless,
 * 4:4:4, 3840x2160, 60fps, 14.3s) is 32 MB and its converted mp4 580 kB. What a
 * 60fps source costs is decode work in the render, which was NOT measured
 * cleanly (the machine was saturated by parallel renders); DEMO_CAPTURE_FPS=30
 * halves it if a render turns out decode-bound.
 */
export const CAPTURE_FPS = 60;

export function resolveCaptureFps(raw?: string): number {
  const n = raw != null && raw !== "" ? Number(raw) : CAPTURE_FPS;
  if (!Number.isFinite(n) || n < 1) return CAPTURE_FPS;
  return Math.min(Math.round(n), 120);
}

/** One screencast frame, written to disk as it arrived. */
export type ScreencastFrame = {
  /** Absolute path of the PNG. */
  file: string;
  /** Compositor swap time, epoch SECONDS (CDP metadata.timestamp). */
  t: number;
};

export type Screencast = {
  /**
   * Stop capturing, wait for every frame to reach disk, and return them in
   * timestamp order. `stoppedAt` is epoch seconds — the footage holds the last
   * frame up to it, because an idle page sends nothing at the end either.
   */
  stop: () => Promise<{ frames: ScreencastFrame[]; stoppedAt: number }>;
};

/**
 * Start the screencast on `page`, writing each frame to `dir/NNNNNN.png`.
 *
 * Frames are ACKED before anything else is done with them. Chromium keeps only
 * a couple of frames in flight and waits for the ack before capturing the next,
 * so an ack held behind a base64 decode and a disk write caps the rate at
 * however long those take — which at 3840x2160 is most of a frame.
 *
 * `size` is the PHYSICAL viewport (logical x CAPTURE_SCALE); passed as maxWidth/
 * maxHeight so the screencast never downsamples.
 */
export async function startScreencast(
  page: Page,
  dir: string,
  size: { width: number; height: number },
): Promise<Screencast> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const session: CDPSession = await page.context().newCDPSession(page);
  const frames: ScreencastFrame[] = [];
  const writes: Promise<void>[] = [];
  let n = 0;
  let stopped = false;

  session.on("Page.screencastFrame", (e) => {
    session
      .send("Page.screencastFrameAck", { sessionId: e.sessionId })
      .catch(() => {});
    if (stopped) return;
    const file = path.join(dir, `${String(n++).padStart(6, "0")}.png`);
    // metadata.timestamp is optional in the protocol. Receipt time is a few ms
    // late (median 6ms at 1080p, 30ms at 4K) but on the same clock.
    frames.push({ file, t: e.metadata.timestamp ?? Date.now() / 1000 });
    writes.push(fs.promises.writeFile(file, Buffer.from(e.data, "base64")));
  });
  await session.send("Page.startScreencast", {
    format: "png",
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });

  return {
    stop: async () => {
      await session.send("Page.stopScreencast").catch(() => {});
      const stoppedAt = Date.now() / 1000;
      stopped = true;
      await Promise.all(writes);
      await session.detach().catch(() => {});
      return { frames: [...frames].sort((a, b) => a.t - b.t), stoppedAt };
    },
  };
}

/**
 * Lay damage-driven frames onto a constant-rate grid: for output frame i (time
 * t0 + i / fps), the index of the source frame on screen at that moment.
 *
 * Each source frame is placed at the output frame NEAREST its timestamp, then
 * held until a later one replaces it. Several arriving inside one output frame
 * collapse to the last of them (a drop); a gap is filled by the frame before it
 * (a hold) — which is what the screen actually showed, since the screencast only
 * sends on damage. Output frame 0 always shows the first frame.
 *
 * `ts` must be sorted ascending; `t1` is where the footage ends (held to it).
 */
export function holdPlan(
  ts: number[],
  fps: number,
  t0: number,
  t1: number,
): number[] {
  if (ts.length === 0) return [];
  const count = Math.max(1, Math.round((t1 - t0) * fps));
  const plan = new Array<number>(count);
  let k = 0;
  for (let i = 0; i < count; i++) {
    // Advance while the next frame's slot is at or before this one.
    while (k + 1 < ts.length && Math.round((ts[k + 1] - t0) * fps) <= i) k++;
    plan[i] = k;
  }
  return plan;
}

/** Collapse a plan into runs of one source frame held for `frames` outputs. */
export function planRuns(plan: number[]): { src: number; frames: number }[] {
  const runs: { src: number; frames: number }[] = [];
  for (const src of plan) {
    const last = runs[runs.length - 1];
    if (last && last.src === src) last.frames++;
    else runs.push({ src, frames: 1 });
  }
  return runs;
}

/**
 * ffconcat script for a plan: each run is one image with an exact duration, so
 * the decoder reads each PNG once and ffmpeg's CFR output duplicates it.
 *
 * The last entry is listed twice. The concat demuxer does not apply the final
 * `duration` to the stream (nothing follows it to push the timestamp), so
 * without the repeat the file ends a run early (measured: the 4.9s closing
 * hold vanished, 631 frames for a 931-frame plan). The repeat overshoots by its
 * own default duration instead, which muxScreencast cuts with -frames:v.
 */
export function concatScript(
  files: string[],
  plan: number[],
  fps: number,
): string {
  const quote = (f: string) => `'${f.replace(/'/g, "'\\''")}'`;
  const lines = ["ffconcat version 1.0"];
  const runs = planRuns(plan);
  for (const r of runs) {
    lines.push(`file ${quote(files[r.src])}`);
    lines.push(`duration ${(r.frames / fps).toFixed(6)}`);
  }
  if (runs.length) lines.push(`file ${quote(files[runs[runs.length - 1].src])}`);
  return lines.join("\n") + "\n";
}

/**
 * Encoder flags for the intermediate: lossless h264 in 4:4:4, BT.709.
 *
 * Remotion's bundled ffmpeg (the one the pipeline can always rely on) has no
 * libx264rgb, ffv1 or fps filter, so: libx264 at qp 0 after ONE RGB->YUV
 * conversion, tagged so the convert pass reads the matrix it was written in.
 * qp 0 means the only loss before convert is that conversion's rounding.
 * `ultrafast` because this runs once per shoot on 4K frames and qp 0 makes the
 * preset a size/speed trade only — never a quality one.
 */
export const INTERMEDIATE_ARGS = [
  "-c:v",
  "libx264",
  "-qp",
  "0",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv444p",
  ...BT709_ARGS,
  // Primaries and transfer only reach the stream through x264's VUI from an
  // untagged PNG source, on either ffmpeg; see X264_BT709_VUI.
  ...X264_BT709_VUI,
] as const;

/**
 * Mux captured frames into a constant-rate intermediate whose t=0 is the first
 * frame's timestamp. Returns that t0 (epoch seconds) and the frame count.
 *
 * Runs Remotion's BUNDLED ffmpeg so the recorder needs nothing new installed.
 */
export function muxScreencast(opts: {
  frames: ScreencastFrame[];
  stoppedAt: number;
  fps: number;
  size: { width: number; height: number };
  out: string;
  /** Repo root, to find Remotion's bundled ffmpeg. */
  root: string;
}): { t0: number; frames: number; unique: number } {
  const { frames, fps, size, out } = opts;
  if (frames.length === 0) throw new Error("screencast produced no frames");
  const t0 = frames[0].t;
  const plan = holdPlan(
    frames.map((f) => f.t),
    fps,
    t0,
    Math.max(opts.stoppedAt, frames[frames.length - 1].t + 1 / fps),
  );
  const list = path.join(path.dirname(frames[0].file), "frames.ffconcat");
  fs.writeFileSync(
    list,
    concatScript(
      frames.map((f) => f.file),
      plan,
      fps,
    ),
  );
  execFileSync(
    path.join(opts.root, "node_modules", ".bin", "remotion"),
    [
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      // RGB -> YUV in BT.709, limited range, and pinned to the physical size so
      // a stray odd-sized frame (a resize mid-shoot) cannot break the encode.
      "-vf",
      `scale=${size.width}:${size.height}:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
      "-fps_mode",
      "cfr",
      "-r",
      String(fps),
      // The repeated last entry (see concatScript) brings a default duration of
      // its own — measured +10 frames at 60fps on smoke. Cut at the plan's
      // length so the file is exactly as long as the footage.
      "-frames:v",
      String(plan.length),
      ...INTERMEDIATE_ARGS,
      "-an",
      out,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return { t0, frames: plan.length, unique: planRuns(plan).length };
}
