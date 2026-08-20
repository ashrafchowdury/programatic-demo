import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLD_AFTER_TEXT_S,
  PUSH_REST,
  type PushMove,
  cutsMidMove,
  exitVelocity,
  pushEnvelope,
  pushIn,
  pushOut,
  pushToCss,
  settle,
} from "./push";

/**
 * Remaining distance, in 1920-space px, of shot 3's slide-in (f194-208) in the
 * Cursor reference. Read off per-frame column-profile edge tracking, so each
 * sample carries about +/-2px.
 */
const SHOT3_IN = [
  114, 82, 62, 48, 38, 30, 22, 18, 14, 10, 8, 4, 2, 2, 0,
] as const;

/** Displacement of shot 6's slide-out (f664-678), same method, total 83px. */
const SHOT6_OUT = [
  0, 1, 2, 3, 5, 7, 10, 13, 18, 23, 29, 38, 48, 62, 83,
] as const;

describe("settle", () => {
  it("runs 1 -> 0 and clamps outside the move", () => {
    assert.equal(settle(0), 1);
    assert.equal(settle(1), 0);
    assert.equal(settle(-3), 1);
    assert.equal(settle(9), 0);
  });

  it("is monotonically decreasing — the reference never overshoots", () => {
    let prev = settle(0);
    for (let i = 1; i <= 60; i++) {
      const v = settle(i / 60);
      assert.ok(v <= prev + 1e-9, `rose at u=${i / 60}: ${prev} -> ${v}`);
      prev = v;
    }
  });

  it("has 15.8% of travel left at the halfway frame", () => {
    // The sharpest single constraint in the measured data: shot 6's exit is at
    // 13/83 = 15.7% of its travel halfway through, and this is what pins the
    // exit to being the entrance time-reversed rather than a separate curve.
    assert.ok(Math.abs(settle(0.5) - 0.158) < 0.005, String(settle(0.5)));
  });

  it("front-loads the move — 28% of the distance goes in frame one of 14", () => {
    // This is the part CAMERA_BEZIER gets wrong, and the reason PUSH_BEZIER
    // exists at all.
    assert.ok(Math.abs(1 - settle(1 / 14) - 0.281) < 0.02);
  });
});

describe("pushIn", () => {
  const move: PushMove = { axis: "x", dist: 114, frames: 14 };

  it("reproduces shot 3's measured slide-in within the tracker's tolerance", () => {
    for (const [f, want] of SHOT3_IN.entries()) {
      const got = pushIn(move, f);
      assert.ok(
        Math.abs(got - want) <= 2,
        `f${f}: want ~${want}px, got ${got.toFixed(1)}px`,
      );
    }
  });

  it("holds the per-frame retention ratio near the measured 0.78", () => {
    const ratios: number[] = [];
    for (let f = 0; f < 8; f++) {
      const a = pushIn(move, f);
      const b = pushIn(move, f + 1);
      ratios.push(b / a);
    }
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    assert.ok(Math.abs(mean - 0.78) < 0.06, `mean retention ${mean}`);
  });

  it("lands exactly at rest, so the hold is genuinely still", () => {
    assert.equal(pushIn(move, 14), 0);
    assert.equal(pushIn(move, 99), 0);
  });

  it("returns nothing for a zero-length move rather than dividing by zero", () => {
    assert.equal(pushIn({ axis: "x", dist: 114, frames: 0 }, 3), 0);
  });
});

describe("pushOut", () => {
  const move: PushMove = { axis: "x", dist: 83, frames: 14 };

  it("starts at rest and reaches the authored distance on the cut frame", () => {
    assert.equal(pushOut(move, 0), 0);
    assert.equal(pushOut(move, 14), 83);
  });

  it("tracks shot 6's measured slide-out", () => {
    // Looser than the entrance: the exit is only 83px of travel measured at 2px
    // quantisation, so 10% of travel is the honest bound.
    for (const [g, want] of SHOT6_OUT.entries()) {
      const got = pushOut(move, g);
      assert.ok(
        Math.abs(got - want) <= 8,
        `g${g}: want ~${want}px, got ${got.toFixed(1)}px`,
      );
    }
  });

  it("is the entrance time-reversed, so tuning one cannot desync the other", () => {
    const inMove: PushMove = { axis: "x", dist: 83, frames: 14 };
    for (let g = 0; g <= 14; g++)
      assert.ok(Math.abs(pushOut(move, g) - pushIn(inMove, 14 - g)) < 1e-9);
  });

  it("accelerates — every frame moves further than the last", () => {
    let prev = -1;
    for (let g = 1; g <= 14; g++) {
      const step = pushOut(move, g) - pushOut(move, g - 1);
      assert.ok(step >= prev - 1e-9, `decelerated at g=${g}`);
      prev = step;
    }
  });
});

describe("pushEnvelope", () => {
  const spec = {
    in: { axis: "x", dist: 114, frames: 14 } as PushMove,
    out: { axis: "x", dist: -83, frames: 14 } as PushMove,
  };

  it("is exactly rest with no spec — an unopted reel must not move a pixel", () => {
    assert.deepEqual(pushEnvelope(10, 96, undefined), PUSH_REST);
    assert.deepEqual(pushEnvelope(10, 96, {}), PUSH_REST);
    assert.deepEqual(
      pushEnvelope(10, 96, { in: { axis: "none", dist: 50, frames: 10 } }),
      PUSH_REST,
    );
  });

  it("is dead still through the middle — the film is 79% still", () => {
    for (let f = 14; f <= 96 - 14; f++)
      assert.deepEqual(pushEnvelope(f, 96, spec), PUSH_REST, `moved at f${f}`);
  });

  it("enters from the right and leaves to the left", () => {
    assert.equal(pushEnvelope(0, 96, spec).x, 114);
    assert.ok(pushEnvelope(95, 96, spec).x < 0);
  });

  it("pushes scale as a delta around 1, for the reference's one scale exit", () => {
    const scaleSpec = { out: { axis: "scale", dist: -0.07, frames: 14 } as PushMove };
    assert.equal(pushEnvelope(0, 96, scaleSpec).scale, 1);
    assert.ok(Math.abs(pushEnvelope(96, 96, scaleSpec).scale - 0.93) < 1e-9);
    assert.equal(pushEnvelope(50, 96, scaleSpec).x, 0);
  });

  it("keeps axes independent, so a y entrance can meet an x exit", () => {
    const mixed = {
      in: { axis: "y", dist: 56, frames: 14 } as PushMove,
      out: { axis: "x", dist: -56, frames: 11 } as PushMove,
    };
    assert.equal(pushEnvelope(0, 96, mixed).x, 0);
    assert.equal(pushEnvelope(0, 96, mixed).y, 56);
    assert.ok(pushEnvelope(95, 96, mixed).x < 0);
    assert.equal(pushEnvelope(95, 96, mixed).y, 0);
  });
});

describe("cutsMidMove", () => {
  it("holds for a normal shot, whose exit is truncated by the cut", () => {
    assert.equal(
      cutsMidMove(96, { out: { axis: "x", dist: -83, frames: 14 } }),
      true,
    );
  });

  it("is false with no exit — some cuts in the reference are still-to-still", () => {
    assert.equal(cutsMidMove(96, {}), false);
    assert.equal(
      cutsMidMove(96, { out: { axis: "none", dist: 0, frames: 14 } }),
      false,
    );
  });
});

describe("exitVelocity", () => {
  it("reports the last frame's travel, for seeding a motion-matched cut", () => {
    const v = exitVelocity(96, { out: { axis: "x", dist: -83, frames: 14 } });
    // Still accelerating at the cut: the final frame is the biggest step.
    assert.ok(v < 0, String(v));
    assert.ok(Math.abs(v) > 83 / 14, "final frame should beat the mean step");
  });

  it("is zero when the shot ends still", () => {
    assert.equal(exitVelocity(96, undefined), 0);
    assert.equal(exitVelocity(96, { in: { axis: "x", dist: 10, frames: 5 } }), 0);
  });
});

describe("pushToCss", () => {
  it("emits a translate3d so the push gets its own compositor layer", () => {
    assert.equal(
      pushToCss({ x: 10, y: -4, scale: 0.93 }),
      "translate3d(10px, -4px, 0) scale(0.93)",
    );
  });

  it("scales design px into the composition's pixel space", () => {
    assert.equal(
      pushToCss({ x: 10, y: 0, scale: 1 }, 2),
      "translate3d(20px, 0px, 0) scale(1)",
    );
  });
});

describe("HOLD_AFTER_TEXT_S", () => {
  it("is the measured 62 frames at 30fps, on every card regardless of length", () => {
    assert.equal(Math.round(HOLD_AFTER_TEXT_S * 30), 62);
  });
});
