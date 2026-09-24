import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OUTPUT_WIDTH, type ClickLog } from "../../src/lib/click-log";
import { WINDOW_FIT } from "../../src/lib/window";
import { buildCameraTrack, S_MAX } from "../../src/lib/zoom";
import {
  captureSizeProblem,
  DEFAULT_CAPTURE_SCALE,
  enforceCaptureSize,
  minCaptureWidth,
  scaledViewport,
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
