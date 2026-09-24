import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_POSE, panLimit } from "./camera";
import { openAt, openFrames, openPose, openProblem } from "./open";

const VP = { width: 1920, height: 1080 };
/** Agenta's Create button: bottom-right corner of the footage. */
const CREATE = { x: 1866 / 1920, y: 1050 / 1080 };

describe("openPose", () => {
  it("clamps a corner target where the zoom camera would frame it", () => {
    // agent-skill's own track holds Create at cx = cy = 0.66526 at S 1.737
    // with fit 0.86 — the framing rule on the EFFECTIVE scale. An opening on
    // the same button must land on the same pose, or the match cut jumps.
    const p = openPose({ scale: 1.736842, at: CREATE }, BASE_POSE, (s) => 0.86 * s);
    assert.ok(Math.abs(p.cx - 0.66526) < 1e-4, String(p.cx));
    assert.ok(Math.abs(p.cy - 0.66526) < 1e-4, String(p.cy));
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
