import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_POSE, panLimit } from "./camera";
import { beatRect, OPEN_MARGIN, openAt, openFrames, openPose, openProblem } from "./open";

const VP = { width: 1920, height: 1080 };
/** Agenta's Create button: bottom-right corner of the footage. */
const CREATE = { x: 1866 / 1920, y: 1050 / 1080 };

describe("openPose", () => {
  /** The window camera's framing: pose scale S shows content at 0.86 * S. */
  const WINDOW = { viewScale: (s: number) => 0.86 * s };
  /** Create's recorded rect: 1804,1014 124x72 — past the footage's corner. */
  const CREATE_RECT = { x: 1804 / 1920, y: 1014 / 1080, w: 124 / 1920, h: 72 / 1080 };

  it("centres the target as far as the render's pan clamp allows", () => {
    // The old rule clamped on the EFFECTIVE scale (cx = 0.66526), the zoom
    // camera's keyframe rule, which left Create on the frame's corner, half
    // cut off. The render clamp is panLimit on the pose scale: 0.5 + 0.2126.
    const p = openPose({ scale: 1.736842, at: CREATE, rect: CREATE_RECT }, BASE_POSE, WINDOW);
    assert.equal(p.scale, 1.736842);
    assert.ok(Math.abs(p.cx - (0.5 + panLimit(1.736842))) < 1e-9, String(p.cx));
    // Create's centre now lands 0.888 across the frame, not on its edge.
    const frameX = 0.5 + (CREATE.x - p.cx) * 0.86 * p.scale;
    assert.ok(frameX < 0.9 && frameX > 0.85, String(frameX));
  });

  it("centres exactly when the clamp does not bind", () => {
    const p = openPose({ scale: 1.5, at: { x: 0.6, y: 0.45 } }, BASE_POSE, WINDOW);
    assert.equal(p.cx, 0.6);
    assert.equal(p.cy, 0.45);
  });

  it("steps down to the largest scale that keeps the target inside with a margin", () => {
    // A wide control asked for at 3x: its 0.4-wide box needs the frame's
    // half-width less the margin, 0.45 / s, to reach 0.2 — so s <= 2.25.
    const rect = { x: 0.3, y: 0.45, w: 0.4, h: 0.1 };
    const p = openPose({ scale: 3, at: { x: 0.5, y: 0.5 }, rect }, BASE_POSE);
    assert.ok(p.scale <= 2.25 + 1e-9 && p.scale > 2.24, String(p.scale));
    assert.ok((0.5 - OPEN_MARGIN) / p.scale >= 0.2 - 1e-9);
  });

  it("never has to shrink for a corner target on the window path", () => {
    // Past the window edge the render clamp shows backdrop: at the clamp the
    // frame's far edge is 1 + (1 / (2 * 0.86) - 0.5) / S of the picture, and
    // less the margin that is still 1 + 0.023 / S — beyond the footage at any
    // scale. So Create keeps the full asked-for scale, even at the maximum.
    const p = openPose({ scale: 4, at: CREATE, rect: CREATE_RECT }, BASE_POSE, WINDOW);
    assert.equal(p.scale, 4);
  });

  it("only ever pushes in", () => {
    const running = { scale: 1.6, cx: 0.5, cy: 0.5 };
    assert.equal(openPose({ scale: 1.2, at: { x: 0.5, y: 0.5 } }, running).scale, 1.6);
  });

  it("keeps the frame edge inside the picture at its own scale by default", () => {
    const p = openPose({ scale: 2, at: { x: 1, y: 0 } }, BASE_POSE);
    assert.equal(p.cx, 0.5 + panLimit(2));
    assert.equal(p.cy, 0.5 - panLimit(2));
  });
});

describe("beatRect", () => {
  it("reads the control's box in footage fractions", () => {
    const r = beatRect({ tMs: 0, x: 10, y: 10, rect: { x: 192, y: 108, w: 96, h: 54 } }, VP);
    assert.deepEqual(r, { x: 0.1, y: 0.1, w: 0.05, h: 0.05 });
    assert.equal(beatRect({ tMs: 0, x: 10, y: 10 }, VP), undefined);
  });
});

describe("openAt / openFrames", () => {
  const start = { scale: 1.74, cx: 0.66, cy: 0.66 };
  it("starts on the opening and hands over exactly on the last frame", () => {
    assert.deepEqual(openAt(start, BASE_POSE, 0, 20), start);
    assert.equal(openAt(start, BASE_POSE, 20, 20), BASE_POSE);
    const mid = openAt(start, BASE_POSE, 10, 20);
    assert.ok(mid.scale < 1.74 && mid.scale > 1);
  });

  it("takes the camera's own move time unless one is authored", () => {
    const own = openFrames({ scale: 1.74, at: CREATE }, start, BASE_POSE, VP, 1.25, 30);
    // A zoom-out: moveDuration clamps it to 650-1450ms on screen.
    assert.ok(own >= 20 && own <= 44, String(own));
    assert.equal(
      openFrames({ scale: 1.74, at: CREATE, settleS: 0.5 }, start, BASE_POSE, VP, 1.25, 30),
      15,
    );
  });
});

describe("openProblem", () => {
  it("accepts a beat or a point, and refuses nonsense", () => {
    assert.equal(openProblem({ scale: 1.74, at: "Create" }), null);
    assert.equal(openProblem({ scale: 1.2, at: { x: 0.2, y: 0.9 } }), null);
    assert.match(openProblem({ scale: 0.9 }) ?? "", /open\.scale/);
    assert.match(openProblem({ scale: 1.2, at: { x: 2, y: 0 } }) ?? "", /open\.at/);
    assert.match(openProblem({ scale: 1.2, settleS: -1 }) ?? "", /settleS/);
  });
});
