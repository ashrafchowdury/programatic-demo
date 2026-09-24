import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPTURE_FPS,
  concatScript,
  holdPlan,
  planRuns,
  resolveCaptureFps,
  resolveCaptureMode,
} from "./screencast";

describe("resolveCaptureMode", () => {
  it("defaults to CDP frames", () => {
    assert.equal(resolveCaptureMode(undefined), "cdp");
    assert.equal(resolveCaptureMode(""), "cdp");
    assert.equal(resolveCaptureMode("cdp"), "cdp");
  });

  it("keeps Playwright's recorder behind DEMO_CAPTURE=playwright", () => {
    assert.equal(resolveCaptureMode("playwright"), "playwright");
    assert.equal(resolveCaptureMode(" Playwright "), "playwright");
  });
});

describe("resolveCaptureFps", () => {
  it("defaults, rounds and rejects junk", () => {
    assert.equal(resolveCaptureFps(undefined), CAPTURE_FPS);
    assert.equal(resolveCaptureFps("30"), 30);
    assert.equal(resolveCaptureFps("29.97"), 30);
    assert.equal(resolveCaptureFps("0"), CAPTURE_FPS);
    assert.equal(resolveCaptureFps("abc"), CAPTURE_FPS);
  });
});

describe("holdPlan", () => {
  const fps = 10; // 100ms slots keep the arithmetic readable

  it("holds a frame across an idle gap — the screencast sends nothing then", () => {
    // Two frames 0.5s apart, footage 1s long.
    assert.deepEqual(holdPlan([100, 100.5], fps, 100, 101), [
      0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
    ]);
  });

  it("places each frame at the NEAREST output slot", () => {
    // 0.14s rounds to slot 1, 0.16s to slot 2.
    assert.deepEqual(holdPlan([0, 0.14], fps, 0, 0.4), [0, 1, 1, 1]);
    assert.deepEqual(holdPlan([0, 0.16], fps, 0, 0.4), [0, 0, 1, 1]);
  });

  it("keeps the LAST of several frames landing in one slot", () => {
    // Three frames inside slot 2: the screen ended that slot on frame 3.
    assert.deepEqual(holdPlan([0, 0.18, 0.2, 0.22], fps, 0, 0.5), [
      0, 0, 3, 3, 3,
    ]);
  });

  it("shows the first frame at slot 0 even when it is late", () => {
    assert.deepEqual(holdPlan([0.03, 0.3], fps, 0, 0.5), [0, 0, 0, 1, 1]);
  });

  it("lays 60fps motion onto 60fps one-to-one", () => {
    const ts = Array.from({ length: 60 }, (_, i) => 5 + i / 60 + 0.002);
    assert.deepEqual(
      holdPlan(ts, 60, 5, 6),
      ts.map((_, i) => i),
    );
  });

  it("is empty without frames and at least one frame long otherwise", () => {
    assert.deepEqual(holdPlan([], fps, 0, 1), []);
    assert.deepEqual(holdPlan([0], fps, 0, 0), [0]);
  });
});

describe("planRuns / concatScript", () => {
  it("collapses holds into one entry with an exact duration", () => {
    assert.deepEqual(planRuns([0, 0, 0, 1, 2, 2]), [
      { src: 0, frames: 3 },
      { src: 1, frames: 1 },
      { src: 2, frames: 2 },
    ]);
    const script = concatScript(["a.png", "b.png", "c.png"], [0, 0, 0, 1, 2, 2], 60);
    assert.equal(
      script,
      [
        "ffconcat version 1.0",
        "file 'a.png'",
        "duration 0.050000",
        "file 'b.png'",
        "duration 0.016667",
        "file 'c.png'",
        "duration 0.033333",
        // Repeated so the concat demuxer honours the last duration.
        "file 'c.png'",
        "",
      ].join("\n"),
    );
  });

  it("quotes paths with a single quote in them", () => {
    assert.match(concatScript(["it's.png"], [0], 30), /file 'it'\\''s\.png'/);
  });
});
