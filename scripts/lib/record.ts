/**
 * One flow, one shoot. Shared by `record-live.ts` (single) and
 * `record-batch.ts` (many at once), so the two cannot drift.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  END_TAIL_S,
  type CursorSample,
  type KeyEvent,
} from "../../src/lib/click-log";
import {
  enforceCaptureSize,
  OVERFLOW_PROBE,
  resolveCaptureScale,
  scaledViewport,
} from "./capture-scale";
import type { ClickEvent, Flow } from "./flow";
import { flashMarker, openFootage, startClock, type Footage } from "./footage";
import { buildContext, CURSOR_INIT_SCRIPT, useBakedCursor } from "./recorder";
import { resolveCaptureMode } from "./screencast";
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
  const captureMode = resolveCaptureMode(process.env.DEMO_CAPTURE);
  // Refuse a capture the render would upscale BEFORE opening a browser — a
  // --check run warns instead, so an author learns it while writing the flow.
  const physical = scaledViewport(flow.viewport, captureScale);
  if (check) {
    try {
      enforceCaptureSize(physical, flow.viewport, captureScale);
    } catch (err) {
      warn(`⚠ ${err instanceof Error ? err.message : err}`);
    }
  } else {
    const soft = enforceCaptureSize(physical, flow.viewport, captureScale);
    if (soft) warn(soft);
  }
  const { context, close, physicalViewport } = await openContext(mode, {
    viewport: flow.viewport,
    baseUrl: startUrl,
    // Only the Playwright fallback records through the context; the CDP path
    // attaches its own screencast once the page is ready (openFootage).
    recordVideo:
      check || captureMode !== "playwright"
        ? undefined
        : { dir: RECORDINGS, size: flow.viewport },
    captureScale,
  });
  say(
    `capture    -> ${physicalViewport.width}x${physicalViewport.height} ` +
      `(logical ${flow.viewport.width}x${flow.viewport.height} @ zoom ${captureScale}` +
      `${check ? "" : `, ${captureMode}`})`,
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

  // Footage starts here, not at context open: everything before the marker is
  // trimmed anyway, and a login wait would otherwise be minutes of frames.
  const footage: Footage | null = check
    ? null
    : await openFootage(page, {
        mode: captureMode,
        name,
        dir: RECORDINGS,
        size: physicalViewport,
      });

  // Let the first paint settle so the opening frames are not mid-layout.
  await page.waitForTimeout(600);

  // Clapperboard. Everything from here is the demo; the flash itself lands in
  // the trimmed head, so it never reaches the final clip.
  if (footage) await flashMarker(page);

  const clock = startClock();
  const demoStart = Date.now();
  const clicks: ClickEvent[] = [];
  const cursor: CursorSample[] = [];
  const keys: KeyEvent[] = [];
  const ctx = buildContext(
    page,
    startUrl,
    clicks,
    clock.now,
    cursor,
    flow.targets,
    keys,
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

  const durationMs = clock.now();
  /** Only a fallback now — see headTrimMs for why the clock is not trusted. */
  const clockTrimMs = demoStart - recStart;
  const rec = footage
    ? await footage.finish({ close, clock, durationMs, clockTrimMs })
    : (await close(), null);

  if (check || !rec) {
    say(
      ok
        ? "all selectors resolved ✓"
        : `selector check FAILED ✗ — see ${path.relative(ROOT, DIAG)}/${name}-fail.png`,
    );
    return { name, ok, durationMs, clicks: clicks.length, error };
  }

  const trimBeforeMs = rec.trimBeforeMs;
  say(`recording  -> ${path.relative(ROOT, rec.file)}`);
  (rec.unsure ? warn : say)(`sync       -> ${rec.sync}`);
  const log = {
    name,
    // PHYSICAL size (logical × captureScale) so the log matches the video.
    viewport: physicalViewport,
    durationMs,
    trimBeforeMs,
    offsetMs: 0,
    backdrop: flow.backdrop,
    // Omitted on the baked-cursor path so Remotion does not draw a second one.
    cursorTrack: useBakedCursor() ? undefined : cursor,
    clicks,
    // Omitted when a flow pressed nothing, so a mouse-driven recording writes
    // exactly the log it always has.
    ...(keys.length ? { keys } : {}),
  };
  fs.writeFileSync(
    path.join(PUBLIC, `${name}.clicks.json`),
    JSON.stringify(log, null, 2) + "\n",
  );
  say(
    `click log  -> public/${name}.clicks.json (${clicks.length} clicks, ` +
      `${cursor.length} cursor samples, ${keys.length} keys, ` +
      `trim ${(trimBeforeMs / 1000).toFixed(1)}s)`,
  );
  return { name, ok, durationMs, clicks: clicks.length, error };
}
