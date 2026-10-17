/**
 * One flow, one shoot. Shared by `record-live.ts` (single) and
 * `record-batch.ts` (many at once), so the two cannot drift.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  END_TAIL_S,
  recordingRate,
  type CursorSample,
  type KeyEvent,
} from "../../src/lib/click-log";
import {
  captureScaleFor,
  enforceCaptureSize,
  naturalOverflow,
  OVERFLOW_PROBE,
  overflowVerdict,
  scaledViewport,
  watchPortals,
  type Overflow,
} from "./capture-scale";
import type { ClickEvent, Flow } from "./flow";
import { flashMarker, openFootage, resolveSlowmo, startClock, type Footage } from "./footage";
import { buildContext, CURSOR_INIT_SCRIPT, useBakedCursor } from "./recorder";
import { resolveCaptureMode } from "./screencast";
import { SelectorError } from "./selectors";
import type { Page } from "playwright";
import type { Footage as BriefFootage } from "../../src/lib/brief";
import { resolveHouse } from "../../src/lib/house";
import { composeFlow, labelMismatch, loadRegistry } from "./action";
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
 * Load `flows/<name>.ts`, or compose the flow from `reels/<name>.brief.json`'s
 * footage when there is no flow file. A hand-written flow always wins.
 */
export async function loadFlow(name: string, say: (m: string) => void = console.log): Promise<Flow> {
  const flowPath = path.join(ROOT, "flows", `${name}.ts`);
  const briefPath = briefFile(name);
  if (fs.existsSync(flowPath)) {
    if (fs.existsSync(briefPath))
      say(`notice     -> flows/${name}.ts wins; the footage in reels/${name}.brief.json is ignored`);
    return (await import(pathToFileURL(flowPath).href)).default as Flow;
  }
  if (!fs.existsSync(briefPath))
    throw new Error(`No flow file at flows/${name}.ts, and no brief at reels/${name}.brief.json`);
  const flow = await composeFromBrief(name);
  say(`flow       -> composed from brief reels/${name}.brief.json`);
  return flow;
}

const briefFile = (name: string) => path.join(ROOT, "reels", `${name}.brief.json`);

/** The flow a brief's footage composes to, or an error listing every problem. */
export async function composeFromBrief(name: string): Promise<Flow> {
  const rel = `reels/${name}.brief.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(briefFile(name), "utf8"));
  } catch (err) {
    throw new Error(`${rel} is not readable JSON: ${err instanceof Error ? err.message : err}`);
  }
  const brief = raw as { footage?: BriefFootage; house?: string };
  if (typeof brief !== "object" || brief === null || typeof brief.footage !== "object" || brief.footage === null)
    throw new Error(`${rel} has no \`footage\` to shoot (a \`demo\` brief cuts an existing recording)`);
  const house = resolveHouse(brief.house);
  if ("problem" in house) throw new Error(`${rel}: house: ${house.problem}`);
  const { registry, problems } = await loadRegistry();
  if (problems.length) throw new Error(`action library: ${problems.join("; ")}`);
  const composed = composeFlow(name, brief.footage, registry, house);
  if ("problems" in composed)
    throw new Error(`${rel}: ${composed.problems.map((p) => `${p.path} ${p.message}`).join("\n  ")}`);
  return composed.flow;
}

/**
 * Reset to the flow's "before" state. Best-effort for a hand-written flow:
 * a throw is logged and the shoot goes on from the current state. A strict
 * flow throws instead, so nothing is filmed from a dirty state.
 */
export async function runPrepare(
  flow: Pick<Flow, "prepare" | "strictPrepare">,
  page: Page,
  say: (m: string) => void,
  warn: (m: string) => void,
): Promise<void> {
  if (!flow.prepare) return;
  try {
    await flow.prepare(page);
    say("prepare    -> reset to the pre-demo state");
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (flow.strictPrepare)
      throw new PrepareError(`prepare    -> FAILED (${why}); strict prepare, so nothing was recorded`);
    warn(`prepare    -> FAILED (${why}); shooting from the current state`);
  }
}

export class PrepareError extends Error {}

/** Where a flow came from, for messages: its file, or the brief it was composed from. */
const flowSource = (flow: Flow): string =>
  flow.declaredLabels ? `the composed flow "${flow.name}"` : `flows/${flow.name}.ts`;

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

  const {
    scale: captureScale,
    allowSoft,
    source: scaleSource,
  } = captureScaleFor(flow.captureScale);
  const captureMode = resolveCaptureMode(process.env.DEMO_CAPTURE);
  // Refuse a capture the render would upscale BEFORE opening a browser — a
  // --check run warns instead, so an author learns it while writing the flow.
  const physical = scaledViewport(flow.viewport, captureScale);
  if (check) {
    try {
      enforceCaptureSize(
        physical,
        flow.viewport,
        captureScale,
        allowSoft ? "1" : undefined,
      );
    } catch (err) {
      warn(`⚠ ${err instanceof Error ? err.message : err}`);
    }
  } else {
    const soft = enforceCaptureSize(
      physical,
      flow.viewport,
      captureScale,
      allowSoft ? "1" : undefined,
    );
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
      `${scaleSource === "flow" ? ", pinned by the flow" : ""}` +
      `${check ? "" : `, ${captureMode}`})`,
  );
  const recStart = Date.now();
  if (useBakedCursor())
    await context.addInitScript({ content: CURSOR_INIT_SCRIPT });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  // Headless can't wait out a login, so don't sit there for five minutes
  // pretending it might: if we land on /auth there is nothing to wait for.
  // 90s, not 30: measured on Agenta v0.122.8, the agent configuration panel
  // took 28s to leave its skeleton, and half the loads missed a 30s wait.
  const headless = resolveHeadless();
  if (!(await waitForReady(page, flow, headless ? 90_000 : undefined))) {
    const shot = path.join(DIAG, `${name}-noready.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const onAuth = page.url().includes("/auth");
    await close();
    throw new Error(
      onAuth
        ? `Not signed in. Run \`pnpm capture:session\` once (that one is headed), then retry.`
        : `${flowSource(flow)} never became ready — see ${path.relative(ROOT, shot)}` +
            (headless
              ? `\nRun with HEADED=1 to watch what the page is doing.`
              : ""),
    );
  }

  // Reset to the "before" state while the clock is still stopped, so the setup
  // lands in the part of the video that gets trimmed away.
  try {
    await runPrepare(flow, page, say, warn);
  } catch (err) {
    await close();
    throw err;
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

  // Slow motion (footage.ts, resolveSlowmo): the page's animations run at 1/K
  // from here, and the clock below runs K times slow to match.
  const slowmo = resolveSlowmo();
  if (slowmo !== 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / slowmo });
    say(`slowmo     -> shooting at 1/${slowmo} speed, timestamps compressed back`);
  }
  const clock = startClock(slowmo);
  const demoStart = Date.now();
  const clicks: ClickEvent[] = [];
  const cursor: CursorSample[] = [];
  const keys: KeyEvent[] = [];
  // Every beat is followed by a probe for popovers the zoom threw off-frame.
  const portals = watchPortals(
    buildContext(
      page,
      startUrl,
      clicks,
      clock.now,
      cursor,
      flow.targets,
      keys,
      // Seed glides and typing from the flow, not the start URL, so a re-shoot
      // against another host or workspace keeps the same pointer paths.
      flow.name,
    ),
    warn,
    captureScale,
  );

  let ok = true;
  let error: string | undefined;
  // Measured while filming, compared once filming has stopped (the natural
  // measurement relayouts the page) — see overflowVerdict.
  let zoomed: Overflow | null = null;
  let natural: Overflow | null = null;
  try {
    await flow.run(portals.ctx);
    if (captureScale > 1)
      zoomed = (await page.evaluate(OVERFLOW_PROBE)) as Overflow;
    await page.waitForTimeout(check ? 200 : END_TAIL_S * 1000 * slowmo);
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    if (err instanceof SelectorError) {
      console.error(
        `${prefix}\nSELECTOR FAILED — ${err.message}\n\n` +
          (flow.declaredLabels
            ? `→ The action's selector has drifted: fix it in actions/, then \`pnpm actions:check\``
            : `→ Name it differently, or add a \`targets\` override in flows/${name}.ts`),
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

  // A composed flow declares its labels: a take that skipped or renamed a step
  // would otherwise cut the wrong footage without a word.
  const mismatch = ok && flow.declaredLabels ? labelMismatch(flow.declaredLabels, clicks) : null;
  if (mismatch) {
    ok = false;
    error = `labels: ${mismatch}`;
    console.error(`${prefix}LABELS DO NOT MATCH THE DECLARATION — ${mismatch}`);
  }

  const durationMs = clock.now();
  await portals.drain();
  /** Only a fallback now — see headTrimMs for why the clock is not trusted. */
  const clockTrimMs = demoStart - recStart;
  // The CDP path stops filming before it calls close, so the relayout is off
  // camera; the Playwright path films until close, so it skips the measurement.
  const closeAfterProbe = async () => {
    if (zoomed && (!footage || captureMode === "cdp"))
      natural = await naturalOverflow(page, flow.viewport).catch(() => null);
    await close();
  };
  const rec = footage
    ? await footage.finish({
        close: closeAfterProbe,
        clock,
        durationMs,
        clockTrimMs,
      })
    : (await closeAfterProbe(), null);
  if (zoomed) {
    const v = overflowVerdict(zoomed, natural);
    (v.bad ? warn : say)(v.line);
  }

  if (check || !rec || mismatch) {
    say(
      ok
        ? "all selectors resolved ✓"
        : mismatch
          ? `label check FAILED ✗ — ${mismatch}${rec ? "; no click log written" : ""}`
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
    // The speed this shoot was paced for, so render can warn on another.
    speed: recordingRate(),
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
