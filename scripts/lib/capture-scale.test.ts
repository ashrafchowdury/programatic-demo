import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { OUTPUT_WIDTH, type ClickLog } from "../../src/lib/click-log";
import { WINDOW_FIT } from "../../src/lib/window";
import { buildCameraTrack, S_MAX } from "../../src/lib/zoom";
import {
  captureScaleFor,
  captureScaleInitScript,
  captureSizeProblem,
  DEFAULT_CAPTURE_SCALE,
  enforceCaptureSize,
  minCaptureWidth,
  naturalOverflow,
  OVERFLOW_PROBE,
  overflowVerdict,
  PORTAL_PROBE,
  portalWarning,
  scaledViewport,
  type Overflow,
  type PortalProblem,
} from "./capture-scale";

const HD = { width: 1920, height: 1080 };

describe("capture floor (D6)", () => {
  it("floors at a ceiling the track builder actually reaches", () => {
    // Pin-sized clicks far enough apart to be separate beats let every punch
    // reach its ceiling. If a clamp elsewhere stopped the camera short of
    // S_MAX, the floor would be pricing a zoom that never happens.
    const pin = (tMs: number, x: number) => ({
      tMs,
      x,
      y: 540,
      rect: { x: x - 4, y: 536, w: 8, h: 8 },
    });
    const log: ClickLog = {
      name: "ceiling",
      viewport: HD,
      durationMs: 40_000,
      offsetMs: 0,
      clicks: [pin(2_000, 900), pin(14_000, 300), pin(26_000, 1500)],
    };
    const deepest = Math.max(...buildCameraTrack(log).map((k) => k.pose.scale));
    assert.equal(deepest, S_MAX);
    assert.equal(S_MAX, 1.74);
  });

  it("is the app's width at full zoom: 2560 x 0.86 x 1.74", () => {
    assert.equal(
      minCaptureWidth(),
      Math.ceil(OUTPUT_WIDTH * WINDOW_FIT * 1.74),
    );
    assert.equal(minCaptureWidth(), 3831);
  });

  it("passes the default: 1920 at scale 2 clears it", () => {
    const physical = scaledViewport(HD, DEFAULT_CAPTURE_SCALE);
    assert.equal(captureSizeProblem(physical, HD, DEFAULT_CAPTURE_SCALE), null);
  });

  it("names the scale that would fix a soft capture", () => {
    const msg = captureSizeProblem(HD, HD, 1);
    assert.ok(msg);
    assert.match(msg, /CAPTURE_SCALE>=2/);
    assert.match(msg, /DEMO_ALLOW_SOFT_CAPTURE=1/);
    // 1280x720 — the smallest capture the audit found — needs 3x.
    assert.match(
      captureSizeProblem(
        { width: 1280, height: 720 },
        { width: 1280, height: 720 },
        1,
      )!,
      /CAPTURE_SCALE>=3/,
    );
  });

  it("refuses by default and warns when overridden", () => {
    assert.throws(() => enforceCaptureSize(HD, HD, 1, undefined), /narrower/);
    assert.match(enforceCaptureSize(HD, HD, 1, "1")!, /SOFT CAPTURE/);
    assert.equal(
      enforceCaptureSize(scaledViewport(HD, 2), HD, 2, undefined),
      null,
    );
  });
});

// ---- the root zoom, in a real browser ---------------------------------------

/** Same memoised probe as tour.test.ts: skip, not fail, without a Chromium. */
let browserProbe: Promise<string | false> | null = null;
function browserSkipReason(): Promise<string | false> {
  browserProbe ??= (async () => {
    if (process.env.REQUIRE_BROWSER === "1") return false;
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      return false;
    } catch (err) {
      const first =
        err instanceof Error ? err.message.split("\n")[0] : String(err);
      return `no usable Chromium: ${first}`;
    }
  })();
  return browserProbe;
}

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "../fixtures/capture-scale.html"),
).href;
const CASES = [
  "media",
  "nested",
  "bp",
  "mm",
  "inserted",
  "replaced",
  "inline",
  "inlinejs",
  "adopted",
  "shadow",
  "portal",
  "mark",
];
type Box = { x: number; y: number; width: number; height: number };

/** Open the fixture at `scale` and return each case's box in LOGICAL px. */
async function layoutAt(
  browser: Browser,
  scale: number,
  geometry = true,
): Promise<{
  boxes: Record<string, Box>;
  page: Page;
  close: () => Promise<void>;
}> {
  const context = await browser.newContext({
    viewport: scaledViewport(HD, scale),
  });
  if (scale > 1)
    await context.addInitScript({
      content: captureScaleInitScript(scale, HD, geometry),
    });
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await page.waitForFunction("window.__ready === true");
  // A click the page places a marker at from MouseEvent.clientX/Y.
  await page.mouse.click(700 * scale, 300 * scale);
  const boxes: Record<string, Box> = {};
  for (const id of CASES) {
    // boundingBox goes over CDP, so it is the true on-screen box whatever
    // the page's own geometry APIs report.
    const b = await page.locator(`#${id}`).boundingBox();
    assert.ok(b, `#${id} has no box at scale ${scale}`);
    boxes[id] = {
      x: b.x / scale,
      y: b.y / scale,
      width: b.width / scale,
      height: b.height / scale,
    };
  }
  return { boxes, page, close: () => context.close() };
}

describe("captureScaleInitScript (capture-scale.html fixture)", () => {
  it("lays every viewport-relative case out at scale 2 as at scale 1", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const browser = await chromium.launch({ headless: true });
    try {
      const one = await layoutAt(browser, 1);
      const two = await layoutAt(browser, 2);
      await one.close();
      await two.close();
      for (const id of CASES) {
        const a = one.boxes[id];
        const b = two.boxes[id];
        // 1 logical px: text line boxes round differently at 2x.
        for (const k of ["x", "y", "width", "height"] as const)
          assert.ok(
            Math.abs(a[k] - b[k]) <= 1,
            `#${id}.${k}: ${a[k]} at scale 1, ${b[k]} at scale 2`,
          );
      }
    } finally {
      await browser.close();
    }
  });

  it("without the geometry shim, a portal placed from getBoundingClientRect lands 2x off", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const browser = await chromium.launch({ headless: true });
    try {
      const raw = await layoutAt(browser, 2, false);
      await raw.close();
      // The double offset the shim exists to remove: trigger at 640,520+40.
      assert.equal(raw.boxes.portal.x, 1280);
      assert.equal(raw.boxes.mark.x, 1395);
    } finally {
      await browser.close();
    }
  });

  it("answers the recorder's own evaluations with native, zoomed geometry", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const browser = await chromium.launch({ headless: true });
    try {
      const two = await layoutAt(browser, 2);
      try {
        const r = (await two.page.evaluate(
          `(() => { var r = document.getElementById("trigger").getBoundingClientRect();
            var hit = document.elementFromPoint(${730 * 2}, ${540 * 2});
            return { x: r.left, w: r.width, hit: hit && hit.id }; })()`,
        )) as { x: number; w: number; hit: string };
        assert.deepEqual(r, { x: 1280, w: 360, hit: "trigger" });
        // locator.evaluate too: a function, not a string.
        const w = await two.page
          .locator("#trigger")
          .evaluate((el) => el.getBoundingClientRect().width);
        assert.equal(w, 360);
      } finally {
        await two.close();
      }
    } finally {
      await browser.close();
    }
  });
});

describe("overflowVerdict (D-overflow)", () => {
  it("does not warn on a page that overflows as much at scale 1", () => {
    // smoke.html: min-height:100vh body plus a collapsing margin.
    const smoke = { vOverflow: 1.044, hOverflow: 1 };
    assert.equal(overflowVerdict(smoke, smoke).bad, false);
    // ...which the bare threshold used to flag on every shoot.
    assert.equal(overflowVerdict(smoke, null).bad, true);
  });

  it("warns when the zoom adds overflow the page does not have", () => {
    const v = overflowVerdict(
      { vOverflow: 2, hOverflow: 1 },
      { vOverflow: 1, hOverflow: 1 },
    );
    assert.equal(v.bad, true);
    assert.match(v.line, /2\.000x/);
  });

  it("measures the natural size by unzooming the live page", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: scaledViewport(HD, 2),
      });
      await context.addInitScript({ content: captureScaleInitScript(2, HD) });
      const page = await context.newPage();
      await page.goto(
        pathToFileURL(
          path.resolve(import.meta.dirname, "../fixtures/smoke.html"),
        ).href,
      );
      const zoomed = (await page.evaluate(OVERFLOW_PROBE)) as Overflow;
      const natural = await naturalOverflow(page, HD);
      assert.ok(natural);
      assert.equal(page.viewportSize()?.width, HD.width);
      assert.equal(overflowVerdict(zoomed, natural).bad, false);
      await context.close();
    } finally {
      await browser.close();
    }
  });
});

describe("PORTAL_PROBE", () => {
  it("flags floating popovers wider than or outside the frame, once each", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: HD });
      await page.setContent(`<!doctype html><body style="margin:0">
        <div data-radix-popper-content-wrapper style="position:fixed;left:1700px;top:100px;width:600px;height:200px">
          <div role="menu" style="width:100%;height:100%"></div></div>
        <div class="ant-dropdown" style="position:absolute;left:0;top:0;width:2500px;height:40px"></div>
        <div role="dialog" style="position:fixed;left:100px;top:100px;width:400px;height:300px"></div>
        <div role="menu" style="position:fixed;left:3000px;top:0;width:100px;height:100px;display:none"></div>
        <div role="listbox" style="margin-top:2000px;height:400px"></div>
      </body>`);
      const found = (await page.evaluate(
        `(${PORTAL_PROBE})(${JSON.stringify({ vw: HD.width, vh: HD.height })})`,
      )) as PortalProblem[];
      assert.deepEqual(
        found.map((f) => [f.selector, f.why]),
        [
          ["[data-radix-popper-content-wrapper]", "outside the viewport"],
          [".ant-dropdown", "wider than the viewport"],
        ],
      );
      assert.match(
        portalWarning(found[0], `click "Cadence"`, HD, 2),
        /PORTAL OUTSIDE THE VIEWPORT after click "Cadence".*600x200 at \(1700, 100\).*captureScale: 1/,
      );
    } finally {
      await browser.close();
    }
  });
});

describe("captureScaleFor (per-flow pin)", () => {
  it("defaults to DEFAULT_CAPTURE_SCALE and refuses soft capture", () => {
    assert.deepEqual(captureScaleFor(undefined, {}), {
      scale: DEFAULT_CAPTURE_SCALE,
      allowSoft: false,
      source: "default",
    });
  });

  it("takes the flow's pin, and a pin may record soft", () => {
    assert.deepEqual(captureScaleFor(1, {}), {
      scale: 1,
      allowSoft: true,
      source: "flow",
    });
    // The pin is what enforceCaptureSize is then told: warn, not throw.
    assert.match(enforceCaptureSize(HD, HD, 1, "1")!, /SOFT CAPTURE/);
  });

  it("lets CAPTURE_SCALE override the pin", () => {
    assert.deepEqual(captureScaleFor(1, { CAPTURE_SCALE: "2" }), {
      scale: 2,
      allowSoft: false,
      source: "env",
    });
    assert.equal(
      captureScaleFor(1, { CAPTURE_SCALE: "1", DEMO_ALLOW_SOFT_CAPTURE: "1" })
        .allowSoft,
      true,
    );
  });
});
