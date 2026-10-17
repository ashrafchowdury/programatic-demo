import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOUSES } from "../../src/lib/house";
import { speedProblem } from "./brief-io";

const KEYS = ["DEMO_SPEED", "DEMO_SLOWMO", "DEMO_FPS"] as const;
const withEnv = (env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

describe("a house's shoot and render settings", () => {
  it("become the run's environment when unset", () =>
    withEnv({}, () => {
      assert.equal(speedProblem(HOUSES["agenta@3"]), null);
      assert.deepEqual(
        KEYS.map((k) => process.env[k]),
        ["1.25", "3", "60"],
      );
    }));

  it("default to real time at 30fps for a house that names neither", () =>
    withEnv({}, () => {
      assert.equal(speedProblem(HOUSES["agenta@1"]), null);
      assert.deepEqual([process.env.DEMO_SLOWMO, process.env.DEMO_FPS], ["1", "30"]);
    }));

  it("refuse a hand-set value that disagrees", () =>
    withEnv({ DEMO_FPS: "30" }, () => {
      assert.deepEqual(speedProblem(HOUSES["agenta@3"]), {
        path: "house",
        message: "agenta@3 is shot and cut for DEMO_FPS=60, but DEMO_FPS=30 is set. Unset it",
      });
    }));
});
