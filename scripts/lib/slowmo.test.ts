import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSlowmo, toDemoEpoch } from "./footage";

describe("slow-motion shooting", () => {
  it("defaults to real time and refuses nonsense", () => {
    assert.equal(resolveSlowmo(undefined), 1);
    assert.equal(resolveSlowmo(""), 1);
    assert.equal(resolveSlowmo("3"), 3);
    assert.throws(() => resolveSlowmo("0.5"), /DEMO_SLOWMO must be a number from 1 to 8/);
    assert.throws(() => resolveSlowmo("fast"), /DEMO_SLOWMO/);
  });

  it("compresses frame timestamps by K after the clock started, exactly as the clock does", () => {
    const clock = { startEpochMs: 1_000_000, slowmo: 3 };
    // 6 wall seconds after the start is 2 demo seconds after it.
    assert.equal(toDemoEpoch(1006, clock), 1002);
    assert.equal(toDemoEpoch(1000, clock), 1000);
    // The trimmed head before the clock compresses too, which only shortens what is cut away.
    assert.equal(toDemoEpoch(997, clock), 999);
  });

  it("leaves a real-time shoot's timestamps alone", () => {
    assert.equal(toDemoEpoch(1234.5678, { startEpochMs: 1_000_000, slowmo: 1 }), 1234.5678);
  });
});
