/**
 * One flow, one shoot. Shared by `record-live.ts` (single) and
 * `record-batch.ts` (many at once), so the two cannot drift.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { END_TAIL_S, type CursorSample } from "../../src/lib/click-log";
import { OVERFLOW_PROBE, resolveCaptureScale } from "./capture-scale";
import type { ClickEvent, Flow } from "./flow";
import { buildContext, CURSOR_INIT_SCRIPT, useBakedCursor } from "./recorder";
import { SelectorError } from "./selectors";
import {
  openContext,
  resolveHeadless,
  waitForReady,
  type SessionMode,
} from "./session";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RECORDINGS = path.join(ROOT, "recordings");
const PUBLIC = path.join(ROOT, "public");
const DIAG = path.join(ROOT, ".diag");

export type RecordOptions = {
  /** Drive the flow without writing video or a click log. */
  check?: boolean;
  /** Which auth strategy to use. Batches must use "isolated". */
  mode?: SessionMode;
  /** Prefixes every line, so interleaved batch output stays readable. */
  tag?: string;
};

export type RecordResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  clicks: number;
  error?: string;
};

/**
 * How long the sync marker is held on screen.
 *
 * Playwright records at 25fps, so a frame is 40ms. 160ms guarantees at least
 * two whole frames land in the file even if the flash straddles frame
 * boundaries, which is what makes detection robust rather than lucky.
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
 * Passed as a raw string, not a function — see CURSOR_INIT_SCRIPT for why
 * bundler name-wrapping breaks page-side functions.
 */
async function flashMarker(page: Page): Promise<void> {
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
function markerTrimMs(file: string, expectedMs: number): number | null {
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
        "-i",
        file,
        "-vf",
        // No format=gray here — the whole point is the CHROMA.
        `signalstats,metadata=print:file=${dump}`,
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
 * LAST-RESORT head estimate, used only when the marker cannot be read.
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

/** Load `flows/<name>.ts`. */
export async function loadFlow(name: string): Promise<Flow> {
  const flowPath = path.join(ROOT, "flows", `${name}.ts`);
  if (!fs.existsSync(flowPath))
    throw new Error(`No flow file at flows/${name}.ts`);
  return (await import(pathToFileURL(flowPath).href)).default as Flow;
}

export async function recordFlow(
  flow: Flow,
  opts: RecordOptions = {},
): Promise<RecordResult> {
  const { check = false, mode = "profile" } = opts;
  const name = flow.name;
  const prefix = opts.tag ? `[${opts.tag}] ` : "";
  const say = (m: string) => console.log(prefix + m);
  const warn = (m: string) => console.warn(prefix + m);

  const startUrl = flow.startUrl ?? process.env.APP_BASE_URL;
  if (!startUrl)
    throw new Error(
      `flows/${name}.ts has no startUrl and APP_BASE_URL is not set.`,
    );

  for (const d of [RECORDINGS, PUBLIC, DIAG])
    fs.mkdirSync(d, { recursive: true });

  const captureScale = resolveCaptureScale(process.env.CAPTURE_SCALE);
  const { context, close, physicalViewport } = await openContext(mode, {
    viewport: flow.viewport,
    baseUrl: startUrl,
    recordVideo: check ? undefined : { dir: RECORDINGS, size: flow.viewport },
    captureScale,
  });
  if (captureScale > 1)
    console.log(
      `capture    -> ${physicalViewport.width}x${physicalViewport.height} ` +
        `(logical ${flow.viewport.width}x${flow.viewport.height} @ zoom ${captureScale})`,
    );
  const recStart = Date.now();
  if (useBakedCursor())
    await context.addInitScript({ content: CURSOR_INIT_SCRIPT });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  // Headless can't wait out a login, so don't sit there for five minutes
  // pretending it might: if we land on /auth there is nothing to wait for.
  const headless = resolveHeadless();
  if (!(await waitForReady(page, flow, headless ? 30_000 : undefined))) {
    const shot = path.join(DIAG, `${name}-noready.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const onAuth = page.url().includes("/auth");
    await close();
    throw new Error(
      onAuth
        ? `Not signed in. Run \`pnpm capture:session\` once (that one is headed), then retry.`
        : `flows/${name}.ts never became ready — see ${path.relative(ROOT, shot)}` +
            (headless
              ? `\nRun with HEADED=1 to watch what the page is doing.`
              : ""),
    );
  }

  // Reset to the "before" state while the clock is still stopped, so the setup
  // lands in the part of the video that gets trimmed away.
  if (flow.prepare) {
    try {
      await flow.prepare(page);
      say("prepare    -> reset to the pre-demo state");
    } catch (err) {
      warn(
        `prepare    -> FAILED (${err instanceof Error ? err.message : err}); shooting from the current state`,
      );
    }
  }

  // Let the first paint settle so the opening frames are not mid-layout.
  await page.waitForTimeout(600);

  // Clapperboard. Everything from here is the demo; the flash itself lands in
  // the trimmed head, so it never reaches the final clip.
  if (!check) await flashMarker(page);

  const demoStart = Date.now();
  const clicks: ClickEvent[] = [];
  const cursor: CursorSample[] = [];
  const ctx = buildContext(
    page,
    startUrl,
    clicks,
    () => Date.now() - demoStart,
    cursor,
    flow.targets,
  );

  let ok = true;
  let error: string | undefined;
  try {
    await flow.run(ctx);
    if (captureScale > 1) {
      const o = (await page.evaluate(OVERFLOW_PROBE)) as {
        vOverflow: number;
        hOverflow: number;
      };
      const bad = o.vOverflow > 1.02 || o.hOverflow > 1.02;
      say(
        `overflow   -> v=${o.vOverflow} h=${o.hOverflow}` +
          (bad
            ? `  ⚠ app overflows under zoom (vh/vw layout) — HD capture will clip it`
            : `  ✓ layout fits`),
      );
    }
    await page.waitForTimeout(check ? 200 : END_TAIL_S * 1000);
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    if (err instanceof SelectorError) {
      console.error(
        `${prefix}\nSELECTOR FAILED — ${err.message}\n\n` +
          `→ Name it differently, or add a \`targets\` override in flows/${name}.ts`,
      );
    } else {
      console.error(`${prefix}Demo step failed:`, err);
    }
    await page
      .screenshot({ path: path.join(DIAG, `${name}-fail.png`) })
      .catch(() => {});
    fs.writeFileSync(
      path.join(DIAG, `${name}-fail.html`),
      await page.content().catch(() => ""),
    );
  }

  const durationMs = Date.now() - demoStart;
  /** Only a fallback now — see headTrimMs for why the clock is not trusted. */
  const clockTrimMs = demoStart - recStart;
  const video = page.video();
  await close();

  if (check) {
    say(
      ok
        ? "all selectors resolved ✓"
        : `selector check FAILED ✗ — see ${path.relative(ROOT, DIAG)}/${name}-fail.png`,
    );
    return { name, ok, durationMs, clicks: clicks.length, error };
  }

  let trimBeforeMs = clockTrimMs;
  if (video) {
    const src = await video.path();
    const dest = path.join(RECORDINGS, `${name}.webm`);
    fs.renameSync(src, dest);
    const estimate = headTrimMs(dest, durationMs, clockTrimMs);
    const marked = markerTrimMs(dest, estimate);
    trimBeforeMs = marked ?? estimate;
    say(`recording  -> recordings/${name}.webm`);
    say(
      marked != null
        ? `sync       -> marker at ${(marked / 1000).toFixed(2)}s ` +
            `(estimate would have been ${(estimate / 1000).toFixed(2)}s)`
        : `sync       -> NO MARKER FOUND; using the duration estimate. ` +
            `Actions may appear before their clicks — install ffmpeg (\`brew install ffmpeg\`).`,
    );
  }
  const log = {
    name,
    // PHYSICAL size (logical × captureScale) so the log matches the video.
    viewport: physicalViewport,
    durationMs,
    trimBeforeMs,
    offsetMs: 0,
    // Omitted on the baked-cursor path so Remotion does not draw a second one.
    cursorTrack: useBakedCursor() ? undefined : cursor,
    clicks,
  };
  fs.writeFileSync(
    path.join(PUBLIC, `${name}.clicks.json`),
    JSON.stringify(log, null, 2) + "\n",
  );
  say(
    `click log  -> public/${name}.clicks.json (${clicks.length} clicks, ` +
      `${cursor.length} cursor samples, trim ${(trimBeforeMs / 1000).toFixed(1)}s)`,
  );
  return { name, ok, durationMs, clicks: clicks.length, error };
}
