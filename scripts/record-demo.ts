/**
 * Records ONE offline/generic flow with Playwright and writes:
 *   recordings/<name>.webm         — the raw screen recording (with fake cursor)
 *   public/<name>.clicks.json      — click log the Remotion composition reads
 *
 * Used for smoke, google-search, and any flow that does not need the Agenta
 * persistent profile. Authenticated demos go through `pnpm record:live <name>`.
 *
 * Usage: pnpm record <flow-name>            (default: smoke)
 *        DEMO_TOUR=capture pnpm record <name>
 *        DEMO_TOUR=replay  pnpm record <name>
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import "dotenv/config";
import {
  CAMERA_LEAD_S,
  type CursorSample,
  DEVICE_SCALE_FACTOR,
  END_TAIL_S,
  ESTABLISH_CUSHION_S,
  LEAD_FALLBACK_S,
  RECORD_SLOW_MO_MS,
} from "../src/lib/click-log";
import type { Flow, ClickEvent } from "./lib/flow";
import {
  resolveCaptureScale,
  scaledViewport,
  captureScaleInitScript,
  OVERFLOW_PROBE,
} from "./lib/capture-scale";
import {
  buildContext,
  CURSOR_INIT_SCRIPT,
  useBakedCursor,
} from "./lib/recorder";
import {
  CAPTURE_DEVICE_SCALE_FACTOR,
  CAPTURE_VIEWPORT,
  captureTour,
  formatTourSummary,
  readTour,
  resolveTourMode,
  runTour,
  writeTour,
} from "./lib/tour";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECORDINGS = path.join(ROOT, "recordings");
const PUBLIC = path.join(ROOT, "public");

/**
 * Drop blank navigation frames before the first zoomable click's lead-in.
 * Adjusts click AND cursor timestamps so Remotion stays in sync with the
 * trimmed video — the drawn pointer shares the click log's clock, so a shift
 * applied to one has to be applied to the other.
 */
function applyFrontTrim(
  clicks: ClickEvent[],
  cursor: CursorSample[],
  durationMs: number,
): {
  clicks: ClickEvent[];
  cursor: CursorSample[];
  durationMs: number;
  trimBeforeMs: number;
} {
  const first = clicks.find((c) => c.zoom !== false);
  if (!first) return { clicks, cursor, durationMs, trimBeforeMs: 0 };

  const departMs = first.tDepartMs ?? first.tMs - LEAD_FALLBACK_S * 1000;
  const tInMs = departMs - CAMERA_LEAD_S * 1000;
  const trimBeforeMs = Math.max(
    0,
    Math.round(tInMs - ESTABLISH_CUSHION_S * 1000),
  );
  if (trimBeforeMs < 80) return { clicks, cursor, durationMs, trimBeforeMs: 0 };

  return {
    trimBeforeMs,
    durationMs: Math.max(1, durationMs - trimBeforeMs),
    clicks: clicks.map((c) => ({
      ...c,
      tMs: Math.max(0, c.tMs - trimBeforeMs),
      tDepartMs:
        c.tDepartMs != null
          ? Math.max(0, c.tDepartMs - trimBeforeMs)
          : undefined,
      tDownMs:
        c.tDownMs != null ? Math.max(0, c.tDownMs - trimBeforeMs) : undefined,
    })),
    // Keep only the last sample from before the cut, so the pointer starts
    // where it actually was rather than piling every trimmed sample onto t=0.
    cursor: dropBefore(cursor, trimBeforeMs).map((s) => ({
      ...s,
      t: Math.max(0, s.t - trimBeforeMs),
    })),
  };
}

function dropBefore(cursor: CursorSample[], tMs: number): CursorSample[] {
  const firstKept = cursor.findIndex((s) => s.t >= tMs);
  if (firstKept <= 0) return cursor;
  return cursor.slice(firstKept - 1);
}

async function main() {
  const name = process.argv[2] ?? "smoke";
  const baseURL = process.env.AGENTA_BASE_URL ?? "http://localhost:3000";
  const tourMode = resolveTourMode(process.env.DEMO_TOUR);

  const flowPath = path.join(ROOT, "flows", `${name}.ts`);
  if (!fs.existsSync(flowPath) && tourMode === "off")
    throw new Error(`No flow file at flows/${name}.ts`);
  const flow: Flow | null = fs.existsSync(flowPath)
    ? ((await import(pathToFileURL(flowPath).href)).default as Flow)
    : null;
  const replayTour = tourMode === "replay" ? readTour(ROOT, name) : null;
  const shootViewport =
    replayTour?.viewport ?? flow?.viewport ?? { width: 1920, height: 1080 };
  // HD capture: physically record larger than the logical layout (CAPTURE_SCALE),
  // never during tour capture. shootViewport stays the LOGICAL size the flow
  // authored against; captureViewport is the PHYSICAL size everything downstream
  // (video, rects, cursor, log.viewport) lives in. See scripts/lib/capture-scale.ts.
  const captureScale =
    tourMode === "capture" ? 1 : resolveCaptureScale(process.env.CAPTURE_SCALE);
  const captureViewport = scaledViewport(shootViewport, captureScale);
  const viewport =
    tourMode === "capture" ? CAPTURE_VIEWPORT : captureViewport;

  fs.mkdirSync(RECORDINGS, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });

  // Headed by default for live sites (Google often challenges headless).
  // Set HEADLESS=1 for offline fixtures (smoke). Capture is always headed.
  const headless =
    tourMode === "capture"
      ? false
      : process.env.HEADLESS === "1" || name === "smoke";

  const browser = await chromium.launch({
    headless,
    slowMo: RECORD_SLOW_MO_MS,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor:
      tourMode === "capture" ? CAPTURE_DEVICE_SCALE_FACTOR : DEVICE_SCALE_FACTOR,
    recordVideo:
      tourMode === "capture"
        ? undefined
        : { dir: RECORDINGS, size: captureViewport },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  // HD zoom+shim must run before any page script, so add it before navigation.
  if (captureScale > 1) {
    await context.addInitScript({
      content: captureScaleInitScript(captureScale, shootViewport),
    });
    console.log(
      `capture    -> ${captureViewport.width}x${captureViewport.height} ` +
        `(logical ${shootViewport.width}x${shootViewport.height} @ zoom ${captureScale})`,
    );
  }
  if (tourMode !== "capture" && useBakedCursor())
    await context.addInitScript({ content: CURSOR_INIT_SCRIPT });

  const page = await context.newPage();

  if (tourMode === "capture") {
    const smokeFixture =
      name === "smoke"
        ? pathToFileURL(
            path.join(ROOT, "scripts", "fixtures", "smoke.html"),
          ).href
        : null;
    const start = process.env.DEMO_TOUR_URL || smokeFixture || baseURL;
    await page.goto(start, { waitUntil: "domcontentloaded" });
    const tour = await captureTour({
      page,
      context,
      name,
      viewport: shootViewport,
      startUrl: page.url(),
    });
    const dest = writeTour(ROOT, tour);
    console.log(
      `tour        -> ${path.relative(ROOT, dest)} (${tour.steps.length} steps)`,
    );
    console.log(formatTourSummary(tour));
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    return;
  }

  const clicks: ClickEvent[] = [];
  const cursor: CursorSample[] = [];
  const startedAt = Date.now();
  const getElapsedMs = () => Date.now() - startedAt;

  const ctx = buildContext(page, baseURL, clicks, getElapsedMs, cursor);

  try {
    // Tiny buffer only — flows wait for paint themselves (no multi-second blank).
    if (replayTour) {
      await page.goto(replayTour.startUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(120);
      await runTour(ctx, replayTour);
    } else {
      if (!flow) throw new Error(`No flow file at flows/${name}.ts`);
      await page.waitForTimeout(120);
      await flow.run(ctx);
    }
    if (captureScale > 1) {
      const o = (await page.evaluate(OVERFLOW_PROBE)) as {
        vOverflow: number;
        hOverflow: number;
      };
      const bad = o.vOverflow > 1.02 || o.hOverflow > 1.02;
      console.log(
        `overflow   -> v=${o.vOverflow} h=${o.hOverflow}` +
          (bad
            ? `  ⚠ app overflows under zoom (vh/vw layout) — HD capture will clip it`
            : `  ✓ layout fits`),
      );
    }
    await page.waitForTimeout(END_TAIL_S * 1000);
  } finally {
    const rawDurationMs = getElapsedMs();
    const video = page.video();
    await context.close(); // flushes the video file
    await browser.close();

    if (video) {
      const src = await video.path();
      const dest = path.join(RECORDINGS, `${name}.webm`);
      fs.renameSync(src, dest);
      console.log(`recording  -> ${path.relative(ROOT, dest)}`);
    }

    const trimmed = applyFrontTrim(clicks, cursor, rawDurationMs);
    if (trimmed.trimBeforeMs > 0) {
      console.log(
        `trim front -> ${trimmed.trimBeforeMs}ms (drop blank navigation)`,
      );
    }

    const log = {
      name,
      // PHYSICAL size — rects, cursor and video are all in this space under zoom.
      viewport: captureViewport,
      durationMs: trimmed.durationMs,
      trimBeforeMs: trimmed.trimBeforeMs || undefined,
      offsetMs: 0,
      // Omitted on the baked-cursor path so Remotion does not draw a second one.
      cursorTrack: useBakedCursor() ? undefined : trimmed.cursor,
      clicks: trimmed.clicks,
    };
    const jsonPath = path.join(PUBLIC, `${name}.clicks.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(log, null, 2) + "\n");
    console.log(
      `click log  -> ${path.relative(ROOT, jsonPath)} (${trimmed.clicks.length} clicks, ` +
        `${useBakedCursor() ? "baked cursor" : `${trimmed.cursor.length} cursor samples`})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
