import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OUTPUT_WIDTH } from "../../src/lib/click-log";
import { WINDOW_FIT } from "../../src/lib/window";
import {
  cameraScaleCeiling,
  captureSizeProblem,
  DEFAULT_CAPTURE_SCALE,
  enforceCaptureSize,
  minCaptureWidth,
  scaledViewport,
} from "./capture-scale";

const HD = { width: 1920, height: 1080 };

describe("capture floor (D6)", () => {
  it("reads the camera ceiling off the track builder", () => {
    // S_MAX in src/lib/zoom.ts. If this moves, the floor moves with it.
    assert.equal(cameraScaleCeiling(), 1.74);
  });

  it("is the app's width at full zoom: 2560 x 0.86 x 1.74", () => {
    assert.equal(minCaptureWidth(), Math.ceil(OUTPUT_WIDTH * WINDOW_FIT * 1.74));
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
      captureSizeProblem({ width: 1280, height: 720 }, { width: 1280, height: 720 }, 1)!,
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
