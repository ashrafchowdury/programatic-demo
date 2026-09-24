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
 * any preset could ask for, it runs again at the factor that reaches it, up to
 * the viewport's surface budget (maxScaleFor). Set `scale` in the spec once a
 * shot is settled to skip the second pass.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { buildContext } from "./lib/recorder";
import { runSteps } from "./lib/flow";
import { alphaBoundsInPage, isolateInPage } from "./lib/isolate";
import { dumpVisible, findByName } from "./lib/selectors";
import {
  captureCss,
  isShotRect,
  paddingSides,
  RECT_DRIFT_PX,
  rectDrift,
  shotProblem,
  type ShotRect,
  type ShotSpec,
} from "./lib/shot";
import {
  hasStoredSession,
  mobileEmulation,
  openContext,
  resolveHeadless,
  waitForReady,
} from "./lib/session";
import { DEVICE_SCALE_FACTOR } from "../src/lib/click-log";
import { WINDOW_FIT } from "../src/lib/window";
import {
  captureTargetPx,
  DEFAULT_LOOK,
  MAX_SCALE,
  MAX_UPSCALE,
  maxScaleFor,
  shotPixels,
  viewportFor,
  type Box,
  type ShotMeta,
} from "../src/lib/still";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(ROOT, "public", "shots");
const DIAG = path.join(ROOT, ".diag", "shots");

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
  baseUrl: string,
  mobile: boolean,
): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  if (baseUrl && hasStoredSession(baseUrl))
    return openContext("isolated", { viewport, deviceScaleFactor, baseUrl, mobile });
  const browser = await chromium.launch({ headless: resolveHeadless() });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    ...(mobile ? mobileEmulation() : {}),
  });
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

/**
 * Resolve the spec's region to a viewport-relative box, and say how.
 *
 * Also hands back the locator when the region was an element, because a cutout
 * needs the element itself, not just where it is.
 */
async function resolveRegion(
  page: Page,
  spec: ShotSpec,
): Promise<{ rect: ShotRect; via: string; locator?: Locator }> {
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

  const pad = paddingSides(spec.padding);
  return {
    rect: {
      x: box.x - pad.left,
      y: box.y - pad.top,
      w: box.width + pad.left + pad.right,
      h: box.height + pad.top + pad.bottom,
    },
    via,
    locator,
  };
}

/**
 * Photograph one element alone: isolate it, measure what it painted, crop to
 * exactly that. Returns the crop and the element's border box inside it.
 *
 * Two screenshots. The first is the whole viewport with alpha, taken only to
 * be measured — there is no way to know how far a shadow reaches except by
 * looking — and the second is the tight crop that goes to disk. Both come off
 * the same page state; nothing is re-run between them.
 */
async function shootCutout(
  page: Page,
  locator: Locator,
  spec: ShotSpec,
  scale: number,
): Promise<{ rect: ShotRect; body: Box; clipped: boolean }> {
  const extras = [];
  for (const k of spec.keep ?? []) {
    const handle = await page.locator(k.css).first().elementHandle({ timeout: 5000 }).catch(() => null);
    if (!handle) throw new Error(`keep css(${k.css}) matched nothing on screen`);
    extras.push(handle);
  }
  const { box, clippers } = await locator.evaluate(isolateInPage, extras);
  // The sheet cancels transitions, but give the compositor one frame anyway.
  await page.waitForTimeout(100);

  const full = await page.screenshot({ omitBackground: true, animations: "disabled" });
  const painted = await page.evaluate(alphaBoundsInPage, full.toString("base64"));
  if (!painted) {
    fs.mkdirSync(DIAG, { recursive: true });
    const shot = path.join(DIAG, `${spec.name}-isolated.png`);
    fs.writeFileSync(shot, full);
    throw new Error(
      `region ${spec.name}: the element painted nothing once isolated (hidden, or zero-size?)` +
        ` — see ${path.relative(ROOT, shot)}`,
    );
  }

  // Device px -> CSS px, rounded outward so no painted pixel is lost.
  const raw: ShotRect = {
    x: Math.floor(painted.x / scale),
    y: Math.floor(painted.y / scale),
    w: 0,
    h: 0,
  };
  raw.w = Math.ceil((painted.x + painted.width) / scale) - raw.x;
  raw.h = Math.ceil((painted.y + painted.height) / scale) - raw.y;
  const { rect, clipped } = clampRect(raw, spec.viewport);

  const vp = spec.viewport;
  const edges: string[] = [];
  if (rect.x === 0) edges.push("left");
  if (rect.y === 0) edges.push("top");
  if (rect.x + rect.w >= vp.width) edges.push("right");
  if (rect.y + rect.h >= vp.height) edges.push("bottom");
  if (edges.length)
    console.warn(
      `           !  the element's shadow reaches the viewport's ${edges.join("/")} edge ` +
        `and is cut there — raise \`viewport\` or scroll it further in`,
    );
  // A clipping ancestor cuts a shadow cleanly, so the painted extent simply
  // stops at its edge. Catch that by coincidence rather than by parsing CSS —
  // it also covers filter: drop-shadow, which no box-shadow parser would see.
  const touches = (a: number, b: number) => Math.abs(a - b) <= 1;
  for (const c of clippers) {
    const sides: string[] = [];
    if (touches(rect.x, c.box.x)) sides.push("left");
    if (touches(rect.y, c.box.y)) sides.push("top");
    if (touches(rect.x + rect.w, c.box.x + c.box.width)) sides.push("right");
    if (touches(rect.y + rect.h, c.box.y + c.box.height)) sides.push("bottom");
    if (sides.length)
      console.warn(
        `           !  \`${c.label}\` clips its contents and the shadow stops at its ` +
          `${sides.join("/")} edge — it is cut. Use look: "window", or include that ancestor`,
      );
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS, `${spec.name}.png`),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    omitBackground: true,
    animations: "disabled",
  });
  return {
    rect,
    body: { x: box.x - rect.x, y: box.y - rect.y, width: box.width, height: box.height },
    clipped,
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

type PassResult = { rect: ShotRect; via: string; clipped: boolean; body?: Box };

/** One full browser run: drive the steps, resolve the region, write the PNG. */
async function runPass(
  spec: ShotSpec,
  scale: number,
  probe: boolean,
): Promise<PassResult> {
  const startUrl = spec.startUrl ?? process.env.APP_BASE_URL;
  const { context, close } = await openShotContext(
    spec.viewport,
    scale,
    startUrl ?? "",
    spec.mobile ?? false,
  );
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

    // A region measured before the web fonts land is measured against fallback
    // metrics, and the crop is off by the difference.
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    // Dev overlays, scrollbars, the caret, and whatever the shot hides — gone
    // BEFORE measuring, since hiding a scrollbar or a row can move the region.
    // After the steps, so a toast the steps raised goes too.
    const sheet = captureCss(spec);
    if (sheet) {
      for (const sel of spec.hide ?? []) {
        const n = await page.locator(sel).count().catch(() => -1);
        if (n === 0) console.warn(`           !  hide ${sel} matched nothing on screen`);
        if (n < 0) console.warn(`           !  hide ${sel} is not a valid selector`);
      }
      await page.addStyleTag({ content: sheet });
      await page.waitForTimeout(100);
    }

    const { rect: raw, via, locator } = await resolveRegion(page, spec);
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

    if (spec.look === "cutout") {
      // shotProblem guarantees an element region, so the locator is there.
      const cut = await shootCutout(page, locator!, spec, scale);
      return { ...cut, via };
    }

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SHOTS, `${spec.name}.png`),
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
      // A cutout already shoots this way. Finishes CSS animations and
      // transitions instead of catching them mid-frame.
      animations: "disabled",
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
  // The ceiling is a surface budget, so it depends on the viewport — see
  // maxScaleFor. A 1920x1080 page stops at 4; a tablet page reaches 5.8.
  const maxScale = maxScaleFor(spec.viewport);
  const explicit = forced != null ? Number(forced) : spec.scale;
  if (explicit != null && !(explicit >= 1 && explicit <= maxScale))
    throw new Error(`--scale must be between 1 and ${maxScale} for this viewport`);

  const look = spec.look ?? DEFAULT_LOOK;
  const longEdge = (p: PassResult) =>
    p.body ? Math.max(p.body.width, p.body.height) : Math.max(p.rect.w, p.rect.h);

  let scale = explicit ?? DEVICE_SCALE_FACTOR;
  let pass = await runPass(spec, scale, probe);
  if (probe) return;

  // Native pixels the region needs so no preset ever upscales it. A cutout is
  // judged on its BODY: the shadow around it is not the thing being sized.
  // Known only now: a "fill" bleed's need depends on the region's shape.
  const targetPx = captureTargetPx(look, WINDOW_FIT, {
    ...spec,
    aspect: pass.rect.h / pass.rect.w,
  });

  // Measure, then re-run only if the region came up short. Layout does not move
  // with the scale factor, so the second pass reproduces the first exactly.
  if (explicit == null) {
    const longest = longEdge(pass);
    const needed = Math.min(maxScale, Math.ceil((targetPx / longest) * 10) / 10);
    if (needed > scale) {
      console.log(
        `scale      -> ${scale} gave ${Math.round(longest * scale)}px on the long ` +
          `edge, short of ${targetPx}; re-shooting at ${needed}`,
      );
      scale = needed;
      const first = pass;
      pass = await runPass(spec, scale, false);
      // The re-run is trusted to reproduce the first. Check: the sizing above
      // was computed from pass one, and the PNG comes from pass two.
      const drift = rectDrift(first.rect, pass.rect);
      if (drift > RECT_DRIFT_PX)
        console.warn(
          `           !  the second pass found the region ${drift}px from where the first did ` +
            `(${first.rect.w}x${first.rect.h} at ${first.rect.x},${first.rect.y} -> ` +
            `${pass.rect.w}x${pass.rect.h} at ${pass.rect.x},${pass.rect.y}) — the app reached a ` +
            `different state. Wait for it in \`ready\`, or set \`scale\` to skip the re-run`,
        );
    }
  }

  const meta: ShotMeta = {
    name: spec.name,
    region: { width: pass.rect.w, height: pass.rect.h },
    scale,
    viewport: spec.viewport,
    via: pass.via,
    backdrop: spec.backdrop,
    ...(spec.ground ? { ground: spec.ground } : {}),
    ...(spec.look ? { look: spec.look } : {}),
    ...(spec.fit != null ? { fit: spec.fit } : {}),
    ...(spec.anchor ? { anchor: spec.anchor } : {}),
    ...(spec.inset != null ? { inset: spec.inset } : {}),
    ...(spec.zoom != null ? { zoom: spec.zoom } : {}),
    ...(spec.shadow != null ? { shadow: spec.shadow } : {}),
    ...(spec.upscale != null ? { upscale: spec.upscale } : {}),
    ...(spec.split != null ? { split: spec.split } : {}),
    ...(spec.gutter != null ? { gutter: spec.gutter } : {}),
    ...(pass.body ? { body: pass.body } : {}),
  };
  fs.writeFileSync(
    path.join(SHOTS, `${spec.name}.json`),
    JSON.stringify(meta, null, 2) + "\n",
  );

  const px = shotPixels(meta);
  const longest = Math.round(longEdge(pass) * scale);
  console.log(`look       -> ${look}`);
  console.log(`region     -> ${pass.via} ${pass.rect.w}x${pass.rect.h} css px`);
  if (pass.body)
    console.log(
      `body       -> ${Math.round(pass.body.width)}x${Math.round(pass.body.height)} css px ` +
        `at ${Math.round(pass.body.x)},${Math.round(pass.body.y)} inside the crop`,
    );
  console.log(`captured   -> ${px.width}x${px.height} at scale ${scale}`);
  if (pass.clipped && !pass.body)
    console.warn(
      `           !  the region ran past the viewport and was cropped — ` +
        `raise viewport in shots/${spec.name}.ts`,
    );
  if (longest < targetPx) {
    // Name the fix. The scale that reaches the target is a number; the
    // viewport that can be shot at that scale follows from the surface budget.
    // The best scale is the one that reaches the target, or MAX_SCALE if
    // that is out of reach; the viewport that shoots at it follows from the
    // surface budget. Only worth saying when it beats what was just shot.
    const needScale = Math.ceil((targetPx / longEdge(pass)) * 10) / 10;
    const bestScale = Math.min(MAX_SCALE, needScale);
    const smaller = viewportFor(bestScale, spec.viewport);
    const viewportTip =
      bestScale > scale && smaller.width >= 320
        ? `A viewport of about ${smaller.width}x${smaller.height} can be shot at ${bestScale}x ` +
          `(${Math.round(longEdge(pass) * bestScale)}px${bestScale < needScale ? ", still short" : ""}). `
        : "";
    const stretch = Math.min(MAX_UPSCALE, Math.ceil((targetPx / longest) * 10) / 10);
    const advice =
      viewportTip +
      (pass.body
        ? `\`upscale: ${stretch}\` stretches it that far at render; a larger element or a lower \`fit\` needs neither.`
        : `Shoot a larger region, or a bigger viewport.`);
    console.warn(
      pass.body
        ? `           !  ${longest}px on the body's long edge is under ${targetPx}; it ` +
            `will sit at native size, under \`fit\`. ${advice}`
        : `           !  ${longest}px on the long edge is under ${targetPx}; the ` +
            `composition will upscale it. ${advice}`,
    );
  }
  console.log(`png        -> public/shots/${spec.name}.png`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
