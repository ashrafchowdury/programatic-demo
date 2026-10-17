import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOUSES } from "../../src/lib/house";
import { STYLE_PRESETS } from "../../src/lib/style";
import { gateChecks, gateLine, type ReelSummary } from "./gate";

const STAGE = HOUSES["agenta@1"];
const TARGETS = STYLE_PRESETS.stage.targets;
const WITHIN: ReelSummary = { durationS: 22, meanShotS: 2.9, cutsPerMin: 18, movingFrac: 0.5, longestStillF: 40 };

describe("launch gate", () => {
  it("passes a reel within every tolerance", () => {
    assert.deepEqual(
      gateChecks("16:9", WITHIN, TARGETS, STAGE, []).filter((c) => !c.ok),
      [],
    );
  });

  it("names the metric, both values and the tolerance when one is out", () => {
    const failed = gateChecks("9:16", { ...WITHIN, movingFrac: 0.1 }, TARGETS, STAGE, []).filter((c) => !c.ok);
    assert.deepEqual(failed.map(gateLine), ["9:16 movingFrac 0.100 vs target 0.678 ±0.5"]);
  });

  it("fails a reel past the house maximum, and a clip capped past the reportable amount", () => {
    const failed = gateChecks(
      "16:9",
      { ...WITHIN, durationS: 31.5 },
      TARGETS,
      STAGE,
      [{ path: "beats[1].show", cap: "typing", cutS: 4.5, message: "typing held" }],
    ).filter((c) => !c.ok);
    assert.deepEqual(failed.map(gateLine), [
      "16:9 length 31.500s vs house maximum 30s",
      "16:9 a cap cut 4.500s of a clip; the house allows 4s",
    ]);
  });

  it("gates only length and caps for a style with no targets", () => {
    const checks = gateChecks("16:9", { ...WITHIN, movingFrac: 0.01 }, null, HOUSES["agenta-classic@1"], []);
    assert.deepEqual(checks.filter((c) => !c.ok), []);
    assert.equal(checks.find((c) => c.what === "movingFrac")?.target, null);
  });
});
