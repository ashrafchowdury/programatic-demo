import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GROUP_SAMPLES,
  MAX_GROUPS,
  MAX_SAMPLE_STEP_PX,
  cornerTravelPx,
  groupsFor,
  sampleFrames,
  shutterFraction,
} from "./shutter";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("sampleFrames", () => {
  it("centres the shutter on the frame (the D7 fix: mean offset 0, not +0.72)", () => {
    for (const groups of [1, 2]) {
      const all = sampleFrames(100, groups).flat();
      assert.equal(all.length, groups * GROUP_SAMPLES);
      assert.ok(Math.abs(mean(all) - 100) < 1e-9);
    }
  });

  it("spans exactly the open shutter, evenly", () => {
    const all = sampleFrames(50, 1).flat().sort((a, b) => a - b);
    const f = shutterFraction();
    const step = f / GROUP_SAMPLES;
    assert.ok(Math.abs(all[0] - (50 - f / 2 + step / 2)) < 1e-9);
    for (let i = 1; i < all.length; i++)
      assert.ok(Math.abs(all[i] - all[i - 1] - step) < 1e-9);
  });

  it("gives each group the whole shutter, so each group is centred on its own", () => {
    for (const set of sampleFrames(10, 2)) {
      assert.equal(set.length, GROUP_SAMPLES);
      assert.ok(Math.abs(mean(set) - 10) < 0.02);
    }
  });

  it("interleaves groups: two groups together are the even 16-sample spread", () => {
    const two = sampleFrames(20, 2).flat().sort((a, b) => a - b);
    const step = shutterFraction() / (2 * GROUP_SAMPLES);
    for (let i = 1; i < two.length; i++)
      assert.ok(Math.abs(two[i] - two[i - 1] - step) < 1e-9);
  });

  it("never samples before frame 0 or past the last frame", () => {
    assert.ok(sampleFrames(0, 2).flat().every((t) => t >= 0));
    assert.ok(sampleFrames(99, 2, { lastFrame: 99 }).flat().every((t) => t <= 99));
  });
});

describe("groupsFor", () => {
  it("keeps one group (8 samples) on a hold and on slow moves", () => {
    assert.equal(groupsFor(0), 1);
    assert.equal(groupsFor(GROUP_SAMPLES * MAX_SAMPLE_STEP_PX), 1);
  });

  it("adds a group once 8 samples would leave gaps wider than the step", () => {
    assert.equal(groupsFor(GROUP_SAMPLES * MAX_SAMPLE_STEP_PX + 0.1), 2);
  });

  it("caps at MAX_GROUPS however fast the camera runs", () => {
    assert.equal(groupsFor(10_000), MAX_GROUPS);
  });

  it("treats garbage as a hold rather than throwing", () => {
    assert.equal(groupsFor(Number.NaN), 1);
    assert.equal(groupsFor(-5), 1);
  });
});

describe("cornerTravelPx", () => {
  const rest = { scale: 1, translateX: 0, translateY: 0 };

  it("is zero for a still camera", () => {
    assert.equal(cornerTravelPx(rest, rest, 2560, 1440), 0);
  });

  it("measures a pan as the translate times the stage size", () => {
    const panned = { ...rest, translateX: 0.01 };
    assert.ok(Math.abs(cornerTravelPx(rest, panned, 2560, 1440) - 25.6) < 1e-9);
  });

  it("sees a pure zoom at the corners, where the centre does not move", () => {
    const zoomed = { ...rest, scale: 1.1 };
    // Corner moves by (0.05 * 2560, 0.05 * 1440).
    assert.ok(Math.abs(cornerTravelPx(rest, zoomed, 2560, 1440) - Math.hypot(128, 72)) < 1e-9);
  });
});
