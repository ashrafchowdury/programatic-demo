import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPONENT_FILL,
  SHARPNESS_CEILING,
  cropClipPath,
  cropUpscale,
  resolveCrop,
  type CropRect,
} from "./crop";

/**
 * The settings drawer in the harness footage: the right quarter of a 3840-wide
 * capture, per the recorded click rects (x 2880-3840). Every number below is
 * checked against this, because it is the shape that motivated the module.
 */
const DRAWER: CropRect = { x: 0.75, y: 0.7, w: 0.25, h: 0.3 };

/** Where content fraction `p` lands after a resolved crop, in frame fractions. */
const project = (
  p: number,
  crop: { k: number; c: number; d: number },
): number => crop.c + (p - crop.c) * crop.k + crop.d;

describe("resolveCrop", () => {
  it("passes a camera crop through, filling in the defaults", () => {
    assert.deepEqual(resolveCrop({ k: 1.28, cx: 0.5, cy: 0.5, dx: -0.14 }), {
      k: 1.28,
      cx: 0.5,
      cy: 0.5,
      dx: -0.14,
      dy: 0,
    });
    assert.deepEqual(resolveCrop({}), { k: 1, cx: 0.5, cy: 0.5, dx: 0, dy: 0 });
    assert.equal(resolveCrop(undefined), undefined);
  });

  it("scales a rect so its longer side fills `fill`", () => {
    const r = resolveCrop({ rect: DRAWER, fill: 0.78 });
    assert.ok(r);
    // h is the longer side here (0.30 against 0.25), so it sets the scale.
    assert.equal(round(r.k), 2.6);
    assert.equal(round(DRAWER.h * r.k), 0.78);
    // And the width follows: 25% of the frame at 2.6x is 65%, which is the
    // hard ceiling this footage allows. See FILL in reels/harness.ts.
    assert.equal(round(DRAWER.w * r.k), 0.65);
  });

  it("defaults the fill to COMPONENT_FILL", () => {
    const r = resolveCrop({ rect: DRAWER });
    assert.ok(r);
    assert.equal(round(DRAWER.h * r.k), COMPONENT_FILL);
  });

  it("lands the rect's centre on the frame's centre, both axes", () => {
    const r = resolveCrop({ rect: DRAWER, fill: 0.78 });
    assert.ok(r);
    const x = { k: r.k, c: r.cx, d: r.dx };
    const y = { k: r.k, c: r.cy, d: r.dy };
    assert.equal(round(project(DRAWER.x + DRAWER.w / 2, x)), 0.5);
    assert.equal(round(project(DRAWER.y + DRAWER.h / 2, y)), 0.5);
    // Edges land symmetrically about it.
    assert.equal(round(project(DRAWER.x, x)), round(0.5 - 0.65 / 2));
    assert.equal(round(project(DRAWER.x + DRAWER.w, x)), round(0.5 + 0.65 / 2));
  });

  it("ignores k/dx once a rect is given", () => {
    const withCamera = resolveCrop({
      rect: DRAWER,
      fill: 0.78,
      k: 1.28,
      dx: -0.14,
      cx: 0.2,
    });
    assert.deepEqual(withCamera, resolveCrop({ rect: DRAWER, fill: 0.78 }));
  });

  it("fits a WIDE rect on its width, so the whole component stays on screen", () => {
    const wide: CropRect = { x: 0.1, y: 0.4, w: 0.8, h: 0.2 };
    const r = resolveCrop({ rect: wide, fill: 0.85 });
    assert.ok(r);
    assert.equal(round(wide.w * r.k), 0.85);
    assert.ok(wide.h * r.k < 0.85);
  });
});

describe("cropClipPath", () => {
  it("insets to the rect, in untransformed content percentages", () => {
    // top 70%, right 0% (the drawer is flush to the viewport edge),
    // bottom 0%, left 75%.
    assert.equal(
      cropClipPath({ rect: DRAWER }),
      "inset(70.0000% 0.0000% 0.0000% 75.0000%)",
    );
  });

  it("is off without a rect, and opt-out-able with one", () => {
    assert.equal(cropClipPath(undefined), undefined);
    assert.equal(cropClipPath({ k: 1.28, cx: 0.5, cy: 0.5 }), undefined);
    assert.equal(cropClipPath({ rect: DRAWER, isolate: false }), undefined);
  });
});

describe("cropUpscale", () => {
  it("reports the harness framing at the sharpness ceiling, not over it", () => {
    const up = cropUpscale({ rect: DRAWER, fill: 0.78 }, 3840, 2560);
    assert.equal(round(up), 1.7333);
    assert.ok(up < SHARPNESS_CEILING);
  });

  it("shows why COMPONENT_FILL is unaffordable on a 3840 capture", () => {
    // 0.85 fill is 2.27x — this is the number that says "re-shoot", and it is
    // the whole reason FILL in reels/harness.ts is 0.78.
    const up = cropUpscale({ rect: DRAWER }, 3840, 2560);
    assert.ok(up > SHARPNESS_CEILING);
    assert.equal(round(up), 1.8889);
  });

  it("comes back under the ceiling at CAPTURE_SCALE=3", () => {
    assert.ok(cropUpscale({ rect: DRAWER }, 5760, 2560) < SHARPNESS_CEILING);
  });

  it("is 1 when there is no crop", () => {
    assert.equal(cropUpscale(undefined, 3840, 2560), 1);
  });
});

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
