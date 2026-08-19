/**
 * Photograph one region of the app: shots/<name>.ts -> public/shots/<name>.png.
 *
 * Usage:
 *   pnpm shot <name>            capture
 *   pnpm shot <name> --probe    write a coordinate grid instead, to pick a rect
 *   pnpm shot <name> --scale=4  force the device scale factor
 *
 * WHY THIS CAN BE 4K WHEN THE VIDEO CANNOT
 * Playwright's screencast emits CSS-viewport pixels and discards the 2x
 * compositor surface (measured three times — see DEVICE_SCALE_FACTOR). A
 * screenshot is rasterised from that surface, so it keeps every pixel. At a
 * 1920x1080 viewport with deviceScaleFactor 2 a screenshot really is 3840x2160.
 *
 * WHY THE SCALE IS CHOSEN BY RE-RUNNING RATHER THAN BY OVERRIDING
 * deviceScaleFactor only takes effect at context creation. Raising it later over
 * CDP (Emulation.setDeviceMetricsOverride) changes window.devicePixelRatio and
 * nothing else: Playwright re-applies its OWN device-metrics override inside
 * every screenshot call, so the request is silently discarded and the PNG comes
 * back at the original scale. Measured — 1200x800 at both 2 and 4.
 *
 * What that leaves is choosing the factor up front, which is safe: layout is
 * byte-identical at 1/2/3/4 (same innerWidth, same bounding boxes) because the
 * factor only changes rasterisation. So the first pass shoots at the usual 2 and
 * measures what the region came out to; if that fell short of the biggest window
 * any preset could ask for, it runs again at the factor that reaches it. Set
 * `scale` in the spec once a shot is settled to skip the second pass.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { buildContext } from "./lib/recorder";
import { runSteps } from "./lib/flow";
import { dumpVisible, findByName } from "./lib/selectors";
import {
  isShotRect,
  shotProblem,
  SHOT_PADDING,
  type ShotRect,
  type ShotSpec,
} from "./lib/shot";
import { hasStoredSession, openContext, resolveHeadless, waitForReady } from "./lib/session";
import { DEVICE_SCALE_FACTOR } from "../src/lib/click-log";
import { WINDOW_FIT } from "../src/lib/window";
import { maxWindowPx, shotPixels, type ShotMeta } from "../src/lib/still";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "public", "shots");
const DIAG = path.join(ROOT, ".diag", "shots");

/** Native pixels a region needs so no preset ever upscales it. */
const TARGET_PX = maxWindowPx(WINDOW_FIT);
/** Chromium rasterises fine at 4; beyond that the surface gets unreasonable. */
const MAX_SCALE = 4;

async function loadShot(name: string): Promise<ShotSpec> {
  const file = path.join(ROOT, "shots", `${name}.ts`);
  if (!fs.existsSync(file))
    throw new Error(
      `No shot file at shots/${name}.ts — copy shots/smoke.ts and edit it.`,
    );
  const spec = (await import(pathToFileURL(file).href)).default as ShotSpec;
  const problem = shotProblem(spec);
  if (problem) throw new Error(`shots/${name}.ts is ${problem}`);
  return spec;
}

/**
 * A logged-in context when a session has been captured, a plain one otherwise.
 *
 * Shots of a public page (or the offline fixture) must not require anyone to run
 * `pnpm capture:session` first, and shots of a private app must not silently
 * shoot a login screen. Deciding on the stored session covers both without a
 * spec field to get wrong.
 */
async function openShotContext(
  viewport: { width: number; height: number },
  deviceScaleFactor: number,
): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  if (hasStoredSession())
    return openContext("isolated", { viewport, deviceScaleFactor });
  const browser = await chromium.launch({ headless: resolveHeadless() });
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  return { context, close: () => browser.close() };
}

/** Round a box outward to whole pixels and clamp it inside the viewport. */
function clampRect(
  r: ShotRect,
  vp: { width: number; height: number },
): { rect: ShotRect; clipped: boolean } {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(vp.width, Math.ceil(r.x + r.w));
  const bottom = Math.min(vp.height, Math.ceil(r.y + r.h));
  const rect = { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
  const clipped =
    Math.ceil(r.x + r.w) > vp.width || Math.ceil(r.y + r.h) > vp.height;
  return { rect, clipped };
}

/** Resolve the spec's region to a viewport-relative box, and say how. */
async function resolveRegion(
  page: Page,
  spec: ShotSpec,
): Promise<{ rect: ShotRect; via: string }> {
  const vp = spec.viewport;
  const region = spec.region;
  if (region === undefined)
    return { rect: { x: 0, y: 0, w: vp.width, h: vp.height }, via: "viewport" };

  if (typeof region === "object" && isShotRect(region))
    return { rect: region, via: `rect ${region.w}x${region.h}` };

  const locator =
    typeof region === "string"
      ? await findByName(page, region, spec.targets)
      : page.locator(region.css).first();
  const via = typeof region === "string" ? `name "${region}"` : `css(${region.css})`;

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  // Let any scroll-triggered animation land before measuring, or the box is
  // read mid-transition and the crop lands off the element.
  await page.waitForTimeout(350);
  const box = await locator.boundingBox();
  if (!box)
    throw new Error(`region ${via} resolved but has no bounding box (hidden?)`);

  const pad = spec.padding ?? SHOT_PADDING;
  return {
    rect: { x: box.x - pad, y: box.y - pad, w: box.width + pad * 2, h: box.height + pad * 2 },
    via,
  };
}

/** Grid overlay for --probe. Injected after the steps, never during a capture. */
const GRID = (step: number) => `
(() => {
  const id = "__shot_grid__";
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;" +
    "font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace";
  const line = (css) => {
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;" + css;
    host.appendChild(d);
    return d;
  };
  const label = (text, css) => {
    const d = line(css + ";color:#fff;background:rgba(220,38,38,.9);padding:1px 3px");
    d.textContent = text;
  };
  for (let x = ${step}; x < innerWidth; x += ${step}) {
    const major = x % (${step} * 5) === 0;
    line("left:" + x + "px;top:0;bottom:0;width:1px;background:rgba(220,38,38," +
      (major ? ".55" : ".22") + ")");
    if (major) label(String(x), "left:" + (x + 2) + "px;top:2px");
  }
  for (let y = ${step}; y < innerHeight; y += ${step}) {
    const major = y % (${step} * 5) === 0;
    line("top:" + y + "px;left:0;right:0;height:1px;background:rgba(220,38,38," +
      (major ? ".55" : ".22") + ")");
    if (major) label(String(y), "top:" + (y + 2) + "px;left:2px");
  }
  document.body.appendChild(host);
  return true;
})()`;

type PassResult = { rect: ShotRect; via: string; clipped: boolean };

/** One full browser run: drive the steps, resolve the region, write the PNG. */
async function runPass(
  spec: ShotSpec,
  scale: number,
  probe: boolean,
): Promise<PassResult> {
  const startUrl = spec.startUrl ?? process.env.APP_BASE_URL;
  const { context, close } = await openShotContext(spec.viewport, scale);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    if (startUrl) await page.goto(startUrl, { waitUntil: "domcontentloaded" });

    const headless = resolveHeadless();
    if (!(await waitForReady(page, spec, headless ? 30_000 : undefined))) {
      fs.mkdirSync(DIAG, { recursive: true });
      const shot = path.join(DIAG, `${spec.name}-noready.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      // A stale storageState lands on the login page, which is by far the most
      // common way this fails. Say so, rather than blaming the spec.
      const onAuth = page.url().includes("/auth");
      throw new Error(
        onAuth
          ? `Not signed in — the stored session has expired.\n` +
            `Run \`pnpm capture:session\` (that one is headed) and log in, then retry.`
          : `shots/${spec.name}.ts never became ready — see ${path.relative(ROOT, shot)}` +
            (headless ? `\nRun with HEADED=1 to watch what the page is doing.` : ""),
      );
    }

    if (spec.prepare) {
      try {
        await spec.prepare(page);
      } catch (err) {
        console.warn(
          `prepare    -> FAILED (${err instanceof Error ? err.message : err}); shooting anyway`,
        );
      }
    }
    await page.waitForTimeout(600);

    if (spec.steps?.length) {
      // The same helpers a flow gets. The click log and cursor track are
      // throwaway — a still wants the STATE the steps produce, not their timing
      // — and the baked cursor stays off, so no pointer is drawn.
      //
      // The CLOCK is not throwaway. glideTo drives the pointer off elapsed time
      // and loops until it reaches 1, so a stub returning a constant never
      // terminates. It must be a real monotonic clock even though nothing reads
      // what it stamps.
      const t0 = Date.now();
      const ctx = buildContext(
        page,
        startUrl ?? "",
        [],
        () => Date.now() - t0,
        [],
        spec.targets,
      );
      await runSteps(ctx, spec.steps);
      await page.waitForTimeout(400);
    }

    const { rect: raw, via } = await resolveRegion(page, spec);
    const { rect, clipped } = clampRect(raw, spec.viewport);

    if (probe) {
      await page.evaluate(GRID(100));
      fs.mkdirSync(DIAG, { recursive: true });
      const out = path.join(DIAG, `${spec.name}.probe.png`);
      await page.screenshot({ path: out });
      console.log(`\nprobe      -> ${path.relative(ROOT, out)} (100px grid)`);
      console.log(`region     -> ${via} at ${rect.x},${rect.y} ${rect.w}x${rect.h}`);
      console.log(`\nvisible elements:\n${await dumpVisible(page)}`);
      return { rect, via, clipped };
    }

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SHOTS, `${spec.name}.png`),
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    });
    return { rect, via, clipped };
  } finally {
    await close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const name = argv.find((a) => !a.startsWith("-"));
  if (!name) throw new Error("Usage: pnpm shot <name> [--probe] [--scale=N]");
  const probe = argv.includes("--probe");
  const forced = argv.find((a) => a.startsWith("--scale="))?.split("=")[1];

  const spec = await loadShot(name);
  const explicit = forced != null ? Number(forced) : spec.scale;
  if (explicit != null && !(explicit >= 1 && explicit <= MAX_SCALE))
    throw new Error(`--scale must be between 1 and ${MAX_SCALE}`);

  let scale = explicit ?? DEVICE_SCALE_FACTOR;
  let pass = await runPass(spec, scale, probe);
  if (probe) return;

  // Measure, then re-run only if the region came up short. Layout does not move
  // with the scale factor, so the second pass reproduces the first exactly.
  if (explicit == null) {
    const longest = Math.max(pass.rect.w, pass.rect.h);
    const needed = Math.min(MAX_SCALE, Math.ceil(TARGET_PX / longest));
    if (needed > scale) {
      console.log(
        `scale      -> ${scale} gave ${Math.round(longest * scale)}px on the long ` +
          `edge, short of ${TARGET_PX}; re-shooting at ${needed}`,
      );
      scale = needed;
      pass = await runPass(spec, scale, false);
    }
  }

  const meta: ShotMeta = {
    name: spec.name,
    region: { width: pass.rect.w, height: pass.rect.h },
    scale,
    viewport: spec.viewport,
    via: pass.via,
  };
  fs.writeFileSync(
    path.join(SHOTS, `${spec.name}.json`),
    JSON.stringify(meta, null, 2) + "\n",
  );

  const px = shotPixels(meta);
  const longest = Math.max(px.width, px.height);
  console.log(`region     -> ${pass.via} ${pass.rect.w}x${pass.rect.h} css px`);
  console.log(`captured   -> ${px.width}x${px.height} at scale ${scale}`);
  if (pass.clipped)
    console.warn(
      `           !  the region ran past the viewport and was cropped — ` +
        `raise viewport in shots/${spec.name}.ts`,
    );
  if (longest < TARGET_PX)
    console.warn(
      `           !  ${longest}px on the long edge is under ${TARGET_PX}; the ` +
        `composition will upscale it. Shoot a larger region, or a bigger viewport.`,
    );
  console.log(`png        -> public/shots/${spec.name}.png`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
