import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CONCURRENCY,
  laneOf,
  parseConcurrency,
  planLanes,
  runPool,
} from "./batch";
import type { Flow } from "./flow";

const flow = (name: string, mutates?: string): Flow =>
  ({
    name,
    mutates,
    viewport: { width: 1, height: 1 },
    run: async () => {},
  }) as Flow;

describe("laneOf", () => {
  it("defaults to the flow's own name, so a flow never overlaps itself", () => {
    assert.equal(laneOf(flow("a")), "a");
  });

  it("uses the declared resource when flows share state", () => {
    assert.equal(laneOf(flow("a", "pr-reviewer")), "pr-reviewer");
  });
});

describe("planLanes", () => {
  it("gives independent flows a lane each", () => {
    const lanes = planLanes([flow("a"), flow("b"), flow("c")]);
    assert.equal(lanes.length, 3);
    assert.ok(lanes.every((l) => l.length === 1));
  });

  it("serialises flows that write the same thing", () => {
    const lanes = planLanes([
      flow("edit-instructions", "pr-reviewer"),
      flow("edit-model", "pr-reviewer"),
      flow("unrelated"),
    ]);
    assert.equal(lanes.length, 2);
    const shared = lanes.find((l) => l.length === 2)!;
    assert.deepEqual(
      shared.map((f) => f.name),
      ["edit-instructions", "edit-model"],
      "order within a lane is preserved",
    );
  });

  it("puts a repeated flow in one lane rather than racing it", () => {
    const lanes = planLanes([flow("a"), flow("a")]);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0].length, 2);
  });

  it("handles an empty list", () => {
    assert.deepEqual(planLanes([]), []);
  });
});

describe("runPool", () => {
  it("returns results in job order, not completion order", async () => {
    const delays = [30, 1, 20, 2];
    const out = await runPool(
      delays.map((ms, i) => async () => {
        await new Promise((r) => setTimeout(r, ms));
        return i;
      }),
      4,
    );
    assert.deepEqual(out, [0, 1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 9 }, () => async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      }),
      3,
    );
    assert.equal(peak, 3);
  });

  it("runs everything even when the limit exceeds the job count", async () => {
    let done = 0;
    await runPool(
      Array.from({ length: 2 }, () => async () => {
        done++;
      }),
      99,
    );
    assert.equal(done, 2);
  });

  it("treats a limit below 1 as serial rather than hanging", async () => {
    let peak = 0;
    let inFlight = 0;
    await runPool(
      Array.from({ length: 3 }, () => async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      }),
      0,
    );
    assert.equal(peak, 1);
  });

  it("copes with no jobs", async () => {
    assert.deepEqual(await runPool([], 3), []);
  });
});

describe("parseConcurrency", () => {
  it("reads the flag in both spellings", () => {
    assert.equal(parseConcurrency(["--concurrency", "5"]), 5);
    assert.equal(parseConcurrency(["-c", "2"]), 2);
    assert.equal(parseConcurrency(["--concurrency=4"]), 4);
  });

  it("falls back to the default when absent or nonsense", () => {
    assert.equal(parseConcurrency([]), DEFAULT_CONCURRENCY);
    assert.equal(
      parseConcurrency(["--concurrency", "junk"]),
      DEFAULT_CONCURRENCY,
    );
    assert.equal(parseConcurrency(["--concurrency", "0"]), DEFAULT_CONCURRENCY);
  });
});
