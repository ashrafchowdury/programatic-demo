import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  applyCaptureEvent,
  applyClusters,
  captureTour,
  flushPending,
  hintsFromSnapshot,
  implicitRole,
  inferClusters,
  isGeneratedId,
  isTypable,
  resolveTourMode,
  type CaptureState,
  type ElementSnapshot,
} from "./tour";

/**
 * Chromium is a genuine dependency of the two `captureTour` tests below, and it
 * is not always present. A slim container has the Playwright package but not the
 * system libraries it links against (libglib-2.0, libnss3, libdbus-1), and
 * installing those needs root — so the browser downloads fine and then refuses
 * to start. That is an environment gap, not a regression in this code, and it
 * should not turn the whole suite red.
 *
 * Memoised, so the probe launch happens at most once per run. It cannot be a
 * top-level await: tsx compiles these tests to CJS, where that is a syntax
 * error.
 *
 * REQUIRE_BROWSER=1 turns the skip back into a failure. Use it anywhere a
 * browser is supposed to exist — a skip that hides a real breakage is worse
 * than the red build it replaced.
 */
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

const snap = (partial: Partial<ElementSnapshot>): ElementSnapshot => ({
  tag: "div",
  role: "",
  name: "",
  ariaLabel: "",
  labelText: "",
  placeholder: "",
  testId: "",
  id: "",
  nameAttr: "",
  text: "",
  type: "",
  contentEditable: false,
  css: "",
  ...partial,
});

describe("resolveTourMode", () => {
  it("treats unset / junk as off", () => {
    assert.equal(resolveTourMode(undefined), "off");
    assert.equal(resolveTourMode(""), "off");
    assert.equal(resolveTourMode("1"), "off");
    assert.equal(resolveTourMode("play"), "off");
  });

  it("accepts capture and replay, case-insensitive", () => {
    assert.equal(resolveTourMode("capture"), "capture");
    assert.equal(resolveTourMode("REPLAY"), "replay");
    assert.equal(resolveTourMode(" Capture "), "capture");
  });
});

describe("hintsFromSnapshot", () => {
  it("ranks role+name first, then placeholder, testid, text, stable id, css", () => {
    const hints = hintsFromSnapshot(
      snap({
        tag: "input",
        role: "searchbox",
        name: "Search models",
        placeholder: "Search",
        testId: "model-search",
        id: "modelSearch",
        text: "Search",
        type: "search",
        css: "form > input.ant-select-selection-search-input",
      }),
    );
    assert.deepEqual(
      hints.map((h) => h.kind),
      ["role", "placeholder", "testid", "text", "css", "css"],
    );
    assert.equal(hints[0]?.by, "role=searchbox name=Search models");
    assert.equal(hints[0]?.role, "searchbox");
    assert.equal(hints[4]?.css, "#modelSearch");
  });

  it("skips generated ids and still keeps a css path", () => {
    const hints = hintsFromSnapshot(
      snap({
        tag: "button",
        role: "button",
        name: "Save",
        id: "radix-:r1:",
        css: "div.ant-form > button.ant-btn",
      }),
    );
    assert.equal(hints[0]?.kind, "role");
    assert.ok(!hints.some((h) => h.by === "#radix-:r1:"));
    assert.ok(hints.some((h) => h.css === "div.ant-form > button.ant-btn"));
  });

  it("uses implicit role from the tag when aria role is missing", () => {
    const hints = hintsFromSnapshot(
      snap({ tag: "button", name: "Commit", text: "Commit" }),
    );
    assert.equal(hints[0]?.kind, "role");
    assert.equal(hints[0]?.role, "button");
    assert.equal(hints[0]?.name, "Commit");
  });
});

describe("implicitRole / isTypable / isGeneratedId", () => {
  it("maps common tags to roles", () => {
    assert.equal(implicitRole({ tag: "a", type: "", role: "" }), "link");
    assert.equal(implicitRole({ tag: "input", type: "search", role: "" }), "searchbox");
    assert.equal(implicitRole({ tag: "input", type: "checkbox", role: "" }), "checkbox");
    assert.equal(implicitRole({ tag: "button", type: "", role: "switch" }), "switch");
  });

  it("treats text fields as typable, not checkboxes or combobox buttons", () => {
    assert.equal(isTypable(snap({ tag: "textarea" })), true);
    assert.equal(isTypable(snap({ tag: "input", type: "text" })), true);
    assert.equal(isTypable(snap({ tag: "div", contentEditable: true })), true);
    assert.equal(isTypable(snap({ tag: "input", type: "checkbox" })), false);
    assert.equal(isTypable(snap({ tag: "button", role: "combobox" })), false);
  });

  it("flags uuid / react / radix ids as generated", () => {
    assert.equal(isGeneratedId("modelSearch"), false);
    assert.equal(isGeneratedId(":r12:"), true);
    assert.equal(isGeneratedId("radix-abc"), true);
    assert.equal(
      isGeneratedId("0192613b-bd8d-7f62-84e5-c4927da38422"),
      true,
    );
  });
});

describe("inferClusters / applyClusters", () => {
  it("starts a new cluster after a gap > 1800ms", () => {
    assert.deepEqual(
      inferClusters([{ tMs: 0 }, { tMs: 400 }, { tMs: 2500 }, { tMs: 2600 }]),
      ["c0", "c0", "c1", "c1"],
    );
  });

  it("does not overwrite an explicit cluster", () => {
    const tour = applyClusters({
      name: "x",
      viewport: { width: 1, height: 1 },
      startUrl: "/",
      steps: [
        {
          kind: "click",
          label: "a",
          hints: [],
          tMs: 0,
          cluster: "keep",
        },
        { kind: "click", label: "b", hints: [], tMs: 4000 },
      ],
    });
    assert.equal(tour.steps[0]?.cluster, "keep");
    assert.equal(tour.steps[1]?.cluster, "c1");
  });
});

describe("applyCaptureEvent", () => {
  const empty = (): CaptureState => ({
    steps: [],
    pending: null,
    stopped: false,
  });

  it("ignores input events on checkboxes", () => {
    const box = snap({ tag: "input", type: "checkbox", role: "checkbox", name: "On" });
    let state = applyCaptureEvent(
      empty(),
      { type: "click", snapshot: box, url: "/" },
      10,
    );
    state = applyCaptureEvent(
      state,
      { type: "input", snapshot: box, value: "on", url: "/" },
      20,
    );
    state = flushPending(state, true);
    assert.equal(state.steps.length, 1);
    assert.equal(state.steps[0]?.kind, "click");
  });

  it("coalesces typing on a field into one type step", () => {
    const field = snap({
      tag: "input",
      type: "search",
      role: "searchbox",
      name: "Search",
      placeholder: "Search",
    });
    let state = applyCaptureEvent(
      empty(),
      { type: "click", snapshot: field, url: "/" },
      10,
    );
    state = applyCaptureEvent(
      state,
      { type: "input", snapshot: field, value: "d", url: "/" },
      20,
    );
    state = applyCaptureEvent(
      state,
      { type: "input", snapshot: field, value: "deepseek", url: "/" },
      40,
    );
    state = applyCaptureEvent(state, { type: "commit", url: "/" }, 80);
    assert.equal(state.steps.length, 2);
    assert.equal(state.steps[0]?.kind, "type");
    assert.equal(state.steps[0]?.text, "deepseek");
    assert.equal(state.steps[1]?.kind, "press");
    assert.equal(state.steps[1]?.key, "Enter");
  });

  it("emits a label hint from an associated <label>", () => {
    const hints = hintsFromSnapshot(
      snap({ tag: "input", type: "password", labelText: "API key", name: "API key" }),
    );
    assert.ok(hints.some((h) => h.kind === "label" && h.name === "API key"));
  });
});

describe("captureTour", () => {
  it("records ranked hints for clicks on the smoke fixture", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const fixture = pathToFileURL(
      path.resolve(import.meta.dirname, "../fixtures/smoke.html"),
    ).href;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    await page.goto(fixture, { waitUntil: "domcontentloaded" });

    try {
      const capturing = captureTour({
        page,
        context,
        name: "smoke-capture-test",
        viewport: { width: 1920, height: 1080 },
        startUrl: page.url(),
      });
      await page.waitForTimeout(250);
      await page.click("#priority");
      await page.waitForTimeout(80);
      await page.click("#opt-high");
      await page.waitForTimeout(80);
      await page.keyboard.press("Escape");
      const tour = await capturing;

      assert.ok(tour.steps.length >= 2, `expected ≥2 steps, got ${tour.steps.length}`);
      assert.equal(tour.steps[0]?.kind, "click");
      assert.ok(
        tour.steps[0]?.hints.some((h) => h.css === "#priority" || h.kind === "role"),
        `first step hints: ${tour.steps[0]?.hints.map((h) => h.by).join(", ")}`,
      );
      assert.ok(
        tour.steps.some((s) =>
          s.hints.some((h) => h.css === "#opt-high" || /high/i.test(h.name ?? h.text ?? "")),
        ),
        "should capture the High option",
      );
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });

  it("captures a picker row that unmounts on pointerdown (no click)", async (t) => {
    const skip = await browserSkipReason();
    if (skip) return t.skip(skip);
    const fixture = pathToFileURL(
      path.resolve(import.meta.dirname, "../fixtures/picker-pointerdown.html"),
    ).href;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    const page = await context.newPage();
    await page.goto(fixture, { waitUntil: "domcontentloaded" });

    try {
      const capturing = captureTour({
        page,
        context,
        name: "picker-pointerdown",
        viewport: { width: 800, height: 600 },
        startUrl: page.url(),
      });
      await page.waitForTimeout(200);
      await page.click("#open");
      await page.waitForTimeout(50);
      await page.click("#keep");
      await page.waitForTimeout(50);
      await page.click("#flash");
      await page.waitForTimeout(80);
      await page.keyboard.press("Escape");
      const tour = await capturing;

      const labels = tour.steps.map((s) => s.label).join(" | ");
      assert.ok(
        tour.steps.some((s) => /openrouter/i.test(s.label)),
        `missing OpenRouter: ${labels}`,
      );
      assert.ok(
        tour.steps.some((s) => /deepseek/i.test(s.label)),
        `missing DeepSeek (pointerdown-unmount): ${labels}`,
      );
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });
});
