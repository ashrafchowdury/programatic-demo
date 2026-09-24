import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clusterGapMs,
  HOLD_MIN_S,
  logMsToDemoS,
  recordingRate,
  speedMismatch,
  TRAIL_CEILING_S,
} from "./click-log";

describe("logMsToDemoS", () => {
  it("inverts DemoClip's clock: log = demo * speed - offset", () => {
    for (const speed of [1, 1.25, 1.5, 2])
      for (const offsetMs of [0, 500, -300]) {
        const tMs = 4000;
        const demoS = logMsToDemoS(tMs, { offsetMs }, speed);
        // What DemoClip computes for the log time at that demo second.
        const logS = demoS * speed - offsetMs / 1000;
        assert.ok(Math.abs(logS - tMs / 1000) < 1e-9, `${speed} ${offsetMs}`);
      }
  });

  it("divides the offset by the speed too", () => {
    // The ad-hoc form `t / speed - offset` is 100 ms off here.
    assert.ok(Math.abs(logMsToDemoS(4000, { offsetMs: 500 }, 1.25) - 3.6) < 1e-9);
    assert.equal(logMsToDemoS(4000, {}, 1.25), 3.2);
  });
});

describe("speedMismatch", () => {
  it("is silent when the speeds agree or the log predates `speed`", () => {
    assert.equal(speedMismatch({ name: "a", speed: 1.5 }, 1.5), null);
    assert.equal(speedMismatch({ name: "a" }, 2), null);
  });

  it("names both speeds and the fix", () => {
    const w = speedMismatch({ name: "agent-skill", speed: 1.5 }, 1.25)!;
    assert.match(w, /agent-skill/);
    assert.match(w, /1\.5x/);
    assert.match(w, /1\.25x/);
    assert.match(w, /1\.20x their intended length/);
    assert.match(w, /DEMO_SPEED=1\.5/);
  });
});

describe("clusterGapMs", () => {
  it("puts the screen-second hold + trail on the recording clock", () => {
    const screen = (HOLD_MIN_S + TRAIL_CEILING_S) * 1000;
    assert.equal(clusterGapMs(1), Math.round(screen));
    assert.equal(clusterGapMs(1.25), Math.round(screen * 1.25));
    assert.equal(clusterGapMs(1.5), Math.round(screen * 1.5));
    assert.equal(clusterGapMs(), clusterGapMs(1.25));
  });
});

describe("recordingRate", () => {
  it("reads DEMO_SPEED through render's resolver", () => {
    const was = process.env.DEMO_SPEED;
    try {
      process.env.DEMO_SPEED = "1.5";
      assert.equal(recordingRate(), 1.5);
      process.env.DEMO_SPEED = "nonsense";
      assert.equal(recordingRate(), 1.25);
      delete process.env.DEMO_SPEED;
      assert.equal(recordingRate(), 1.25);
    } finally {
      if (was == null) delete process.env.DEMO_SPEED;
      else process.env.DEMO_SPEED = was;
    }
  });
});
