import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aspectFramePoint,
  aspectMagnification,
  aspectSize,
  aspectSlug,
  aspectUpscale,
  clampView,
  cropPoint,
  cropRect,
  followAt,
  followReport,
  followTrack,
  footageBounds,
  isAspect,
  plateTransform,
  visibleHalf,
} from "./aspect";
import type { ClickLog } from "./click-log";
import { SHARPNESS_CEILING } from "./crop";

const NATIVE = { width: 2560, height: 1440 };

describe("aspect sizes", () => {
  it("keeps the short side, and native is untouched", () => {
    assert.equal(aspectSize(NATIVE), NATIVE);
    assert.equal(aspectSize(NATIVE, "16:9"), NATIVE);
    assert.deepEqual(aspectSize(NATIVE, "9:16"), { width: 1440, height: 2560 });
    assert.deepEqual(aspectSize(NATIVE, "1:1"), { width: 1440, height: 1440 });
  });

  it("names files and validates", () => {
    assert.equal(aspectSlug("9:16"), "9x16");
    assert.ok(isAspect("1:1"));
    assert.ok(!isAspect("4:5"));
  });

  it("prices the footage as the table in aspect.ts says", () => {
    const v = aspectSize(NATIVE, "9:16");
    assert.ok(Math.abs(aspectMagnification(NATIVE, v) - 16 / 9) < 1e-9);
    // 3840 capture: 1.19, under the ceiling. 1920: 2.37, over it.
    assert.ok(Math.abs(aspectUpscale(3840, NATIVE, v) - 1.185) < 1e-3);
    assert.ok(aspectUpscale(3840, NATIVE, v) < SHARPNESS_CEILING);
    assert.ok(aspectUpscale(1920, NATIVE, v) > SHARPNESS_CEILING);
    // 1:1 is exactly as sharp as 16:9.
    const sq = aspectSize(NATIVE, "1:1");
    assert.equal(aspectUpscale(3840, NATIVE, sq), 2560 / 3840);
  });

  it("sees a sixth of the plate either side at 9:16, all of its height", () => {
    const h = visibleHalf(aspectSize(NATIVE, "9:16"), NATIVE);
    assert.ok(Math.abs(h.x - 0.158) < 1e-3);
    assert.equal(h.y, 0.5);
  });
});

describe("crop mapping", () => {
  const crop = { k: 1.28, cx: 0.5, cy: 0.5, dx: -0.14, dy: 0 };
  it("maps footage points through the crop and bounds the footage", () => {
    assert.ok(Math.abs(cropPoint({ x: 1, y: 0.5 }, crop).x - 1.0) < 1e-9);
    const b = footageBounds(crop);
    assert.equal(b.x1, 1);
    assert.equal(b.x0, 0);
  });

  it("keeps a view's edges inside the footage", () => {
    const half = { x: 0.158, y: 0.5 };
    const b = { x0: 0, x1: 1, y0: 0, y1: 1 };
    assert.equal(clampView({ scale: 1, cx: 0.99, cy: 0.5 }, half, b).cx, 1 - 0.158);
    // Magnified 2x, it may go twice as close to the edge.
    assert.equal(clampView({ scale: 2, cx: 0.99, cy: 0.5 }, half, b).cx, 1 - 0.079);
    assert.equal(clampView({ scale: 2, cx: 0.99, cy: 0.9 }, half, b).cy, 0.75);
  });
});

describe("followTrack", () => {
  // Two targets at opposite sides of a 1920 page; the pointer glides between.
  const log: ClickLog = {
    name: "t",
    viewport: { width: 1920, height: 1080 },
    durationMs: 6000,
    offsetMs: 0,
    clicks: [
      { label: "left", tMs: 1500, tDepartMs: 800, tDownMs: 1450, x: 300, y: 500, rect: { x: 250, y: 480, w: 100, h: 40 } },
      { label: "right", tMs: 4000, tDepartMs: 3000, tDownMs: 3950, x: 1650, y: 500, rect: { x: 1600, y: 480, w: 100, h: 40 } },
    ],
    cursorTrack: [
      { t: 0, x: 960, y: 900 },
      { t: 800, x: 960, y: 900 },
      { t: 1400, x: 300, y: 500 },
      { t: 3000, x: 300, y: 500 },
      { t: 3900, x: 1650, y: 500 },
      { t: 6000, x: 1650, y: 500 },
    ],
  };
  const spec = { fps: 30, speed: 1, frames: 180, half: { x: 0.158, y: 0.5 } };

  it("opens on the first target and lands on each before its press", () => {
    const f = followTrack(log, spec);
    // Leaning toward the first target (0.156) as far as the pointer, parked
    // mid-page at 0.5, allows: FOLLOW_MARGIN in from the crop's edge.
    assert.ok(Math.abs(followAt(f, 0).x - (0.5 - 0.158 * 0.75)) < 1e-3, String(followAt(f, 0).x));
    // Right target at 1650/1920 = 0.859, clamped at 1 - 0.158.
    assert.ok(Math.abs(followAt(f, Math.round(3.95 * 30)).x - (1 - 0.158)) < 0.01);
    assert.ok(Math.abs(followAt(f, Math.round(1.45 * 30)).x - 0.1719) < 0.02);
  });

  it("keeps the pointer inside the crop at every press, and moves smoothly", () => {
    const r = followReport(log, spec, { first: 0, last: 179 }, 2560, 16 / 9);
    assert.ok(r.outside < 0.05, String(r.outside));
    const f = followTrack(log, spec);
    for (const t of [1.45, 3.95]) {
      const c = followAt(f, Math.round(t * 30)).x;
      const p = (t < 2 ? 300 : 1650) / 1920;
      assert.ok(Math.abs(p - c) <= 0.158, `${t}: ${p} vs ${c}`);
    }
    // Continuous: no frame jumps more than a tenth of the plate.
    for (let i = 1; i < 180; i++)
      assert.ok(Math.abs(f.x[i] - f.x[i - 1]) < 0.1, `frame ${i}`);
  });

  it("holds the centre with no clicks", () => {
    const f = followTrack({ ...log, clicks: [], cursorTrack: undefined }, spec);
    assert.equal(followAt(f, 90).x, 0.5);
  });
});

describe("aspectFramePoint", () => {
  const plate = NATIVE;
  const frame = { width: 1440, height: 2560 };
  const s = 2560 / 1440;

  it("puts the view's centre on the frame's centre", () => {
    const p = aspectFramePoint({ x: 0.3, y: 0.6 }, { scale: 1.2, cx: 0.3, cy: 0.6 }, plate, s, frame);
    assert.ok(Math.abs(p.x - 0.5) < 1e-12 && Math.abs(p.y - 0.5) < 1e-12);
  });

  it("agrees with plateTransform, which draws the plate", () => {
    // plateTransform slides the plate by tx and scales it about its centre; a
    // plate point q then sits at centre + tx + (q - 0.5) * plate * m.
    const view = { scale: 1.1, cx: 0.7, cy: 0.45 };
    const [tx, ty, m] = plateTransform(view, plate, s).match(/-?[\d.]+(e-?\d+)?/g)!.map(Number);
    const q = { x: 0.85, y: 0.2 };
    const want = {
      x: 0.5 + (tx + (q.x - 0.5) * plate.width * m) / frame.width,
      y: 0.5 + (ty + (q.y - 0.5) * plate.height * m) / frame.height,
    };
    const got = aspectFramePoint(q, view, plate, s, frame);
    assert.ok(Math.abs(got.x - want.x) < 1e-9, `${got.x} vs ${want.x}`);
    assert.ok(Math.abs(got.y - want.y) < 1e-9, `${got.y} vs ${want.y}`);
  });
});

describe("cropRect", () => {
  it("maps both corners through the crop", () => {
    const crop = { k: 2, cx: 0.5, cy: 0.5, dx: 0.1, dy: 0 };
    const r = cropRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, crop);
    const want = { x: 0.6, y: 0.5, w: 0.2, h: 0.2 };
    for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(r[k] - want[k]) < 1e-9, k);
    const id = cropRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    assert.ok(Math.abs(id.w - 0.3) < 1e-12 && id.x === 0.1 && Math.abs(id.h - 0.4) < 1e-12);
  });
});
