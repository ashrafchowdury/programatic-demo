import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_POSE, poseToCss } from "./camera";
import {
  DEFAULT_PLAYBACK_RATE,
  DESIGN_WIDTH,
  EMPTY_LOG,
  type ClickLog,
} from "./click-log";
import {
  demoDurationInFrames,
  demoGeometry,
  demoSize,
  footageFrames,
} from "./demo-duration";
import { CHROME_H, WINDOW_FIT } from "./window";
import { zoomAt } from "./zoom";

const FPS = 30;
const SPEED = DEFAULT_PLAYBACK_RATE;
const VP = { width: 1920, height: 1080 };

const clicks: ClickLog["clicks"] = [
  { tMs: 2603, x: 533, y: 302, rect: { x: 491, y: 289, w: 83, h: 25 }, cluster: "a" },
  { tMs: 4338, x: 571, y: 417, rect: { x: 498, y: 399, w: 146, h: 36 }, cluster: "a" },
  { tMs: 6854, x: 558, y: 612, rect: { x: 458, y: 589, w: 200, h: 46 }, cluster: "b" },
];
/** Room after the last click for hold + trail + a beat at base. */
const roomy: ClickLog = { name: "roomy", viewport: VP, durationMs: 11561, offsetMs: 0, clicks };
/** 0.65s after the last click: the camera has to run past the footage. */
const short: ClickLog = { ...roomy, name: "short", durationMs: 7500 };

const atBase = (log: ClickLog, frame: number) => {
  const geom = demoGeometry(log);
  const z = zoomAt(frame, FPS, log, { speed: SPEED, ...geom });
  const base = poseToCss(BASE_POSE, geom.chromeFrac, geom.fit);
  return (
    Math.abs(z.scale - base.scale) < 1e-6 &&
    Math.abs(z.translateX - base.translateX) < 1e-6 &&
    Math.abs(z.translateY - base.translateY) < 1e-6
  );
};

describe("demoDurationInFrames", () => {
  it("is the footage length when the camera fits inside the recording", () => {
    const n = demoDurationInFrames(roomy, SPEED, demoGeometry(roomy), FPS);
    assert.equal(n, footageFrames(roomy, SPEED, FPS));
    assert.equal(n, Math.ceil((roomy.durationMs / 1000 / SPEED) * FPS));
  });

  it("runs past a short recording until the camera is back at base", () => {
    const footage = footageFrames(short, SPEED, FPS);
    const n = demoDurationInFrames(short, SPEED, demoGeometry(short), FPS);
    assert.ok(n > footage, `${n} frames vs ${footage} of footage`);
    // Sized from durationMs, the clip ended zoomed in.
    assert.ok(!atBase(short, footage - 1), "footage ends at base — test log too long");
    assert.ok(atBase(short, n - 1), "last frame is not at base");
  });

  it("shifts by offsetMs, which zoomAt subtracts from the clock", () => {
    const base = demoDurationInFrames(short, SPEED, demoGeometry(short), FPS);
    const late = { ...short, offsetMs: 500 };
    const n = demoDurationInFrames(late, SPEED, demoGeometry(late), FPS);
    assert.ok(Math.abs(n - base - (0.5 / SPEED) * FPS) <= 1, `${n} vs ${base}`);
    assert.ok(atBase(late, n - 1));
  });

  it("never runs shorter than the footage, and handles a log with no clicks", () => {
    assert.equal(demoDurationInFrames(EMPTY_LOG, SPEED, {}, FPS), footageFrames(EMPTY_LOG, SPEED, FPS));
    const early = { ...roomy, offsetMs: -5000 };
    assert.equal(
      demoDurationInFrames(early, SPEED, demoGeometry(early), FPS),
      footageFrames(early, SPEED, FPS),
    );
  });
});

describe("demoGeometry", () => {
  it("is what DemoClip's useCameraAt draws with", () => {
    const { width, height } = demoSize(roomy);
    assert.deepEqual(demoGeometry(roomy), { fit: WINDOW_FIT, chromeFrac: 0 });
    const chromeH = CHROME_H * (width / DESIGN_WIDTH);
    assert.equal(demoGeometry(roomy, true).chromeFrac, chromeH / (height + chromeH));
  });

  it("sizes the composition even, at the recording's aspect", () => {
    assert.deepEqual(demoSize(roomy), { width: 2560, height: 1440 });
    assert.equal(demoSize({ ...roomy, viewport: { width: 1280, height: 721 } }).height % 2, 0);
  });
});
