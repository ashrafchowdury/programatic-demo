import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCameraTrack } from "../../src/lib/zoom";
import type { ClickEvent, ClickLog } from "../../src/lib/click-log";
import { earliestPressMs, poseFor, type FramedBeat } from "./camera-room";

const VP = { width: 1920, height: 1080 };
const RATE = 1.25;

/** Shortest camera move in a track, on SCREEN seconds. */
function shortestMove(log: ClickLog): number {
  const keys = buildCameraTrack(log, RATE);
  let min = Infinity;
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i].pose;
    const b = keys[i + 1].pose;
    const moved =
      Math.abs(a.scale - b.scale) > 1e-3 ||
      Math.abs(a.cx - b.cx) > 1e-3 ||
      Math.abs(a.cy - b.cy) > 1e-3;
    if (moved) min = Math.min(min, (keys[i + 1].t - keys[i].t) / RATE);
  }
  return min;
}

const field = { x: 1400, y: 820, rect: { x: 1300, y: 796, w: 200, h: 48 } };

describe("earliestPressMs", () => {
  it("asks nothing for a beat that does not zoom", () => {
    assert.equal(earliestPressMs({ ...field, zoom: false }, 1000, null, VP), 0);
  });

  it("gives an opening punch its full in-move", () => {
    // Pressed as early as the old glide allowed (~600ms after departure), the
    // track squeezes the punch to its floor. Pressed at earliestPressMs, it
    // does not.
    const depart = 1000;
    const need = earliestPressMs({ ...field, cluster: "a" }, depart, null, VP, RATE);
    const at = (press: number): ClickLog => ({
      name: "t",
      viewport: VP,
      durationMs: press + 6000,
      clicks: [
        { ...field, cluster: "a", tDepartMs: depart, tDownMs: press, tMs: press + 80 },
      ],
    });
    assert.ok(shortestMove(at(depart + 600)) < 0.5, "control: not squeezed");
    assert.ok(shortestMove(at(Math.ceil(need))) >= 0.55 - 1e-3);
  });

  it("asks nothing when the camera already holds the click in shot", () => {
    const first: ClickEvent = { ...field, cluster: "form", tMs: 2000, tDownMs: 1920 };
    const prev: FramedBeat = { event: first, pose: poseFor(first, VP) };
    const next = { ...field, x: field.x + 10, cluster: "form" };
    assert.equal(earliestPressMs(next, 2600, prev, VP, RATE), 0);
  });

  it("waits out the previous action's watch before a pan", () => {
    const first: ClickEvent = {
      x: 300,
      y: 200,
      rect: { x: 250, y: 180, w: 100, h: 40 },
      cluster: "form",
      tMs: 2000,
      tDownMs: 1920,
      typeEndMs: 4000,
    };
    const prev: FramedBeat = { event: first, pose: poseFor(first, VP) };
    const need = earliestPressMs({ ...field, cluster: "form" }, 3000, prev, VP, RATE);
    // Not before typing ended + the 0.7s watch (on the recording clock).
    assert.ok(need > 4000 + 700 * RATE);
  });
});
