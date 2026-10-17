/**
 * The footage side of a shoot, shared by every recorder so their clocks cannot
 * drift apart: start capturing, fire the sync marker, start the demo clock,
 * and at the end turn whatever was captured into `recordings/<name>.<ext>` plus
 * the head trim that lines it up with the click log.
 *
 * Two capture paths (see scripts/lib/screencast.ts): CDP frames with real
 * timestamps (default, `.mkv`), or Playwright's `recordVideo` (`.webm`) behind
 * DEMO_CAPTURE=playwright.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import {
  muxScreencast,
  resolveCaptureFps,
  startScreencast,
  type CaptureMode,
  type Screencast,
} from "./screencast";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIAG = path.join(ROOT, ".diag");

/**
 * How long the sync marker is held on screen.
 *
 * Playwright records at 25fps, so a frame is 40ms. 160ms guarantees at least
 * two whole frames land in the file even if the flash straddles frame
 * boundaries, which is what makes detection robust rather than lucky. (The CDP
 * intermediate is 60fps, where it is ~10 frames.)
 */
const FLASH_MS = 160;
/**
 * Marker colour. Saturated magenta, NOT black.
 *
 * Black was the obvious choice and the wrong one: "darkest run in the file" is a
 * guess about what an app will never do, and apps do go black — a video player,
 * a dark-mode screen, a modal scrim, a still-painting frame. Picking the last
 * dark run would then trim to the wrong place with no way to tell.
 */
const FLASH_COLOUR = "#ff00ff";
/**
 * Minimum per-pixel saturation across the WHOLE frame, above which the frame can
 * only be the marker.
 *
 * SATMIN is the discriminator that makes this safe. Real UI always contains some
 * neutral pixel — white, grey, black text — so its SATMIN sits at ~0 no matter
 * how colourful the rest is. Only a frame that is entirely saturated colour
 * clears this bar, and full-screen magenta measures ~147.
 */
const FLASH_SATMIN = 60;
/** Luma spread allowed within the marker; VP8 will not keep a fill perfectly flat. */
const FLASH_FLAT = 24;
/**
 * How far the detected marker may sit from the duration estimate before it is
 * rejected. The estimate is only ever off by ~0.5-0.8s, so anything outside this
 * is not the marker and we would rather fall back loudly than trim to garbage.
 */
const FLASH_WINDOW_MS = 2500;
/**
 * How far the marker may disagree with the frame timestamps before the
 * timestamps are distrusted. They agree to within a frame when both work (see
 * Footage.finish); a gap bigger than this means one clock is broken, and the
 * marker — a picture in the footage itself — is the one that cannot be.
 */
const SYNC_DISAGREE_MS = 100;

/**
 * Paint a full-screen marker, hold it, remove it. The demo clock starts the
 * instant it clears.
 *
 * This is a clapperboard, and it exists because BOTH ends of the recording are
 * unmeasurable from the driver side. Playwright does not say when the screencast
 * actually started (it lags the context opening), nor when it stopped (it keeps
 * capturing into browser teardown). Every attempt to infer the head from
 * timestamps has been wrong in one direction or the other:
 *
 *   demoStart - recStart      over-trimmed by the capture-start lag (~0.83s)
 *   videoDuration - duration  over-trimmed by the teardown tail (~0.46s)
 *
 * Both put actions BEFORE the click that caused them, and both were intermittent
 * because the lag varies per run — which is what made them so slippery. A marker
 * in the footage removes the guess: the first frame after the flash IS the
 * demo's first frame, whatever the driver clock thought.
 *
 * On the CDP path the frames carry their own swap times, so the head is known
 * exactly and the marker becomes a cross-check (SYNC_DISAGREE_MS).
 *
 * Passed as a raw string, not a function — see CURSOR_INIT_SCRIPT for why
 * bundler name-wrapping breaks page-side functions.
 */
export async function flashMarker(page: Page): Promise<void> {
  await page.evaluate(`(function(){
    var d = document.createElement('div');
    d.id = '__demo_sync_marker';
    d.style.cssText = 'position:fixed;inset:0;background:${FLASH_COLOUR};z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(d);
  })()`);
  await page.waitForTimeout(FLASH_MS);
  await page.evaluate(`(function(){
    var d = document.getElementById('__demo_sync_marker');
    if (d) d.remove();
  })()`);
}

/**
 * Find the marker in the recording and return the video time just after it.
 *
 * Three independent conditions have to hold, so that a frame of app content can
 * never be mistaken for the marker:
 *
 *   1. SATMIN >= FLASH_SATMIN — every pixel in the frame is saturated colour.
 *      Real UI always has a neutral pixel somewhere, so this alone is close to
 *      decisive.
 *   2. YMAX - YMIN <= FLASH_FLAT — the frame is a flat fill, not a picture.
 *   3. within FLASH_WINDOW_MS of the duration estimate — the marker sits at the
 *      head/demo boundary by construction, and the estimate locates that to
 *      within a second even though it cannot pin it down exactly.
 *
 * Returns null when ffmpeg is missing or nothing qualifies, so callers fall back
 * rather than fail. Needs a SYSTEM ffmpeg — Remotion's bundled build has no
 * signalstats filter (and its 1x1 PNG path returns a constant, so pixel readback
 * is not an alternative either).
 */
export function markerTrimMs(file: string, expectedMs: number): number | null {
  // `metadata=print` logs to stderr at INFO level, so `-v error` silences it and
  // reading stdout gets nothing — which is exactly how this failed the first
  // time. Write to a file instead, as scripts/analyze.ts does.
  const dump = path.join(DIAG, `${path.basename(file)}.sync.txt`);
  let out = "";
  try {
    fs.mkdirSync(DIAG, { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        // Only the head can hold the marker (FLASH_WINDOW_MS), so stop reading
        // past it, and measure a thumbnail: a flat fill stays flat and UI keeps
        // its neutral pixels at any size. Scanning every frame of a 60fps
        // 3840x2160 intermediate at full size cost ~40s of CPU per shoot.
        "-t",
        String((expectedMs + FLASH_WINDOW_MS + 1000) / 1000),
        "-i",
        file,
        "-vf",
        // No format=gray here — the whole point is the CHROMA.
        `scale=640:-2,signalstats,metadata=print:file=${dump}`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    out = fs.readFileSync(dump, "utf8");
  } catch {
    return null;
  }

  type Frame = { t: number; satMin: number; yMin: number; yMax: number };
  const frames: Frame[] = [];
  let cur: Partial<Frame> = {};
  const flush = () => {
    if (
      cur.t != null &&
      cur.satMin != null &&
      cur.yMin != null &&
      cur.yMax != null
    )
      frames.push(cur as Frame);
    cur = {};
  };
  for (const line of out.split("\n")) {
    const pts = line.match(/pts_time:([\d.]+)/);
    if (pts) {
      flush();
      cur = { t: Number(pts[1]) };
      continue;
    }
    const m = line.match(/lavfi\.signalstats\.(SATMIN|YMIN|YMAX)=([\d.]+)/);
    if (!m) continue;
    const v = Number(m[2]);
    if (m[1] === "SATMIN") cur.satMin = v;
    else if (m[1] === "YMIN") cur.yMin = v;
    else cur.yMax = v;
  }
  flush();
  if (frames.length === 0) return null;

  const isMarker = (f: Frame) =>
    f.satMin >= FLASH_SATMIN && f.yMax - f.yMin <= FLASH_FLAT;

  // Scan for every qualifying run, then keep the one nearest the estimate.
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (!isMarker(frames[i])) continue;
    let j = i;
    while (j + 1 < frames.length && isMarker(frames[j + 1])) j++;
    // One stray frame is a transition, not a marker.
    if (j - i + 1 >= 2 && frames[j + 1]) runs.push({ start: i, end: j });
    i = j;
  }
  if (runs.length === 0) return null;

  let best: { at: number; off: number } | null = null;
  for (const r of runs) {
    const at = Math.round(frames[r.end + 1].t * 1000);
    const off = Math.abs(at - expectedMs);
    if (!best || off < best.off) best = { at, off };
  }
  if (!best || best.off > FLASH_WINDOW_MS) return null;
  return best.at;
}

/** Duration of a recording in ms, via Remotion's bundled ffprobe. */
function videoDurationMs(file: string): number | null {
  try {
    const out = execFileSync(
      path.join(ROOT, "node_modules", ".bin", "remotion"),
      [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const s = Number(out.trim());
    return Number.isFinite(s) && s > 0 ? s * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * LAST-RESORT head estimate for the Playwright path, used only when the marker
 * cannot be read.
 *
 * Better than the wall clock it replaced (`demoStart - recStart`, which
 * over-trimmed by the ~0.83s capture-start lag), but still wrong: it assumes
 * recording stops when the demo clock does, and it does not. The browser keeps
 * capturing into teardown, so that tail is charged to the head and the clip is
 * over-trimmed. Measured on agent-icon: 0.46s of over-trim, constant across all
 * seven clicks, putting every action before the click that caused it. The tail
 * varies per run — agent-instructions showed ~0 — which is why the bug looked
 * intermittent.
 *
 * Prefer markerTrimMs. This exists so a machine without ffmpeg still produces a
 * clip, not because the number is trustworthy.
 */
function headTrimMs(
  file: string,
  durationMs: number,
  fallbackMs: number,
): number {
  const total = videoDurationMs(file);
  if (total == null) return fallbackMs;
  return Math.max(0, Math.round(total - durationMs));
}

/**
 * The demo clock. `now()` is whole ms since start on performance.now(), which
 * is monotonic — Date.now() can step under an NTP correction mid-shoot, and a
 * step lands straight in the click log (audit L5). `startEpochMs` is the wall
 * time sampled at the same instant, the one number that relates this clock to
 * the compositor's frame timestamps (which are wall time).
 */
export type DemoClock = {
  now: () => number;
  startEpochMs: number;
  /** The slow-motion factor the shoot runs at; see resolveSlowmo. 1 = real time. */
  slowmo: number;
};

/**
 * SLOW-MOTION SHOOTING. The capture's frame RATE is bounded by what headless
 * Chromium can encode, not by the page: measured on the same flow back to back,
 * a 3840x2160 capture got 355 distinct frames where 1920x1080 got 814, and on a
 * loaded machine the 4K take of skills-launch held its frames for an irregular
 * 16/50 ms, which is the judder on every drawer, menu and keystroke.
 *
 * So shoot the demo K times slower and keep the pixels: the page's animations
 * run at 1/K (CDP Animation.setPlaybackRate), every pause, glide, keystroke and
 * scroll takes K times as long, and the demo clock and the frame timestamps are
 * divided by K before anything is written. The click log and the video come
 * out exactly as a real-time shoot would, with K times the frames per second
 * of footage. Nothing downstream (convert, render, the compiler, houses) knows.
 *
 * What it does not slow: JS timers and network. A load or a debounce plays K
 * times faster on screen, which shortens waits rather than adding judder.
 */
export function resolveSlowmo(raw: string | undefined = process.env.DEMO_SLOWMO): number {
  if (raw == null || raw.trim() === "") return 1;
  const k = Number(raw);
  if (!Number.isFinite(k) || k < 1 || k > 8)
    throw new Error(`DEMO_SLOWMO must be a number from 1 to 8 (got ${JSON.stringify(raw)})`);
  return k;
}

export function startClock(slowmo = 1): DemoClock {
  const startEpochMs = Date.now();
  const p0 = performance.now();
  return { now: () => Math.round((performance.now() - p0) / slowmo), startEpochMs, slowmo };
}

/** A wall-clock epoch second, as the demo clock sees it: compressed by K after the clock started. */
export const toDemoEpoch = (t: number, clock: Pick<DemoClock, "startEpochMs" | "slowmo">): number => {
  const e = clock.startEpochMs / 1000;
  return clock.slowmo === 1 ? t : e + (t - e) / clock.slowmo;
};

export type FootageResult = {
  /** recordings/<name>.mkv (CDP) or .webm (Playwright). */
  file: string;
  /** Video time of demo t=0. */
  trimBeforeMs: number;
  /** One line for the shoot log, already worded. */
  sync: string;
  /** True when the sync is a guess the user should know about. */
  unsure: boolean;
};

export type Footage = {
  mode: CaptureMode;
  /**
   * Close the browser (via `close`) and write the recording. `durationMs` is
   * the demo clock at the end; `clockTrimMs` the driver-side fallback for the
   * Playwright path.
   */
  finish: (o: {
    close: () => Promise<void>;
    clock: DemoClock;
    durationMs: number;
    clockTrimMs: number;
  }) => Promise<FootageResult>;
};

/**
 * Start capturing `page`. Call it as late as possible on the CDP path — the
 * frames before the marker are trimmed away anyway — but before the settle
 * wait, so the marker has footage on both sides. On the Playwright path the
 * video has been running since the page opened; this only remembers it.
 */
export async function openFootage(
  page: Page,
  o: {
    mode: CaptureMode;
    name: string;
    dir: string;
    size: { width: number; height: number };
  },
): Promise<Footage> {
  if (o.mode === "playwright") {
    const video = page.video();
    return {
      mode: o.mode,
      finish: async ({ close, durationMs, clockTrimMs }) => {
        await close(); // flushes the video file
        if (!video) throw new Error("recordVideo was not enabled on this context");
        const dest = path.join(o.dir, `${o.name}.webm`);
        fs.renameSync(await video.path(), dest);
        const estimate = headTrimMs(dest, durationMs, clockTrimMs);
        const marked = markerTrimMs(dest, estimate);
        return {
          file: dest,
          trimBeforeMs: marked ?? estimate,
          unsure: marked == null,
          sync:
            marked != null
              ? `marker at ${(marked / 1000).toFixed(2)}s ` +
                `(estimate would have been ${(estimate / 1000).toFixed(2)}s)`
              : `NO MARKER FOUND; using the duration estimate. ` +
                `Actions may appear before their clicks — install ffmpeg (\`brew install ffmpeg\`).`,
        };
      },
    };
  }

  const framesDir = path.join(o.dir, `${o.name}.frames`);
  const cast: Screencast = await startScreencast(page, framesDir, o.size);
  return {
    mode: o.mode,
    finish: async ({ close, clock }) => {
      // Stop BEFORE teardown: the footage ends when we say, not whenever the
      // browser gets round to closing — the Playwright path's ~0.46s tail.
      const cast_ = await cast.stop();
      await close();
      // A slow-motion shoot's frames, back on the demo clock's time (see
      // resolveSlowmo): the same compression the click log got.
      const frames = cast_.frames.map((f) => ({ ...f, t: toDemoEpoch(f.t, clock) }));
      const stoppedAt = toDemoEpoch(cast_.stoppedAt, clock);
      const fps = resolveCaptureFps(process.env.DEMO_CAPTURE_FPS);
      const dest = path.join(o.dir, `${o.name}.mkv`);
      const mux = muxScreencast({
        frames,
        stoppedAt,
        fps,
        size: o.size,
        out: dest,
        root: ROOT,
      });
      if (process.env.DEMO_KEEP_FRAMES !== "1")
        fs.rmSync(framesDir, { recursive: true, force: true });

      // Exact: the video's t=0 is the first frame's swap time, and the demo
      // clock's wall time was sampled with it.
      const stamped = Math.max(
        0,
        Math.round(clock.startEpochMs - mux.t0 * 1000),
      );
      const marked = markerTrimMs(dest, stamped);
      const stats =
        `${frames.length} frames -> ${mux.frames} @ ${fps}fps ` +
        `(${mux.unique} distinct)`;
      if (marked == null)
        return {
          file: dest,
          trimBeforeMs: stamped,
          unsure: false,
          sync:
            `frame timestamps at ${(stamped / 1000).toFixed(3)}s, ${stats}; ` +
            `marker not read (no system ffmpeg?) — timestamps do not need it`,
        };
      const off = marked - stamped;
      if (Math.abs(off) > SYNC_DISAGREE_MS)
        return {
          file: dest,
          trimBeforeMs: marked,
          unsure: true,
          sync:
            `⚠ frame timestamps (${(stamped / 1000).toFixed(3)}s) and marker ` +
            `(${(marked / 1000).toFixed(3)}s) disagree by ${off}ms; using the ` +
            `marker. ${stats}`,
        };
      return {
        file: dest,
        trimBeforeMs: stamped,
        unsure: false,
        sync:
          `frame timestamps at ${(stamped / 1000).toFixed(3)}s ` +
          `(marker agrees, ${off >= 0 ? "+" : ""}${off}ms), ${stats}`,
      };
    },
  };
}
