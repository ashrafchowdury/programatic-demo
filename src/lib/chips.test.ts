import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipProblem, chipsAt, type ReelChip } from "./chips";

const chip = (o: Partial<ReelChip> = {}): ReelChip => ({
  text: "1,327 apps",
  x: 0.5,
  y: 0.5,
  fromS: 1,
  toS: 3,
  ...o,
});

describe("chipProblem", () => {
  it("accepts a chip inside the frame and inside the film", () => {
    assert.equal(chipProblem(chip(), 10), null);
  });

  it("rejects a chip placed outside the frame", () => {
    // Renders nothing at all, so without this the loss is silent and only
    // visible by watching the finished film.
    assert.match(chipProblem(chip({ x: 1.4 }), 10) ?? "", /outside the frame/);
    assert.match(chipProblem(chip({ y: -0.1 }), 10) ?? "", /outside the frame/);
  });

  it("rejects a chip that starts after the film ends", () => {
    // Same silent-loss failure, and the render costs a minute before anyone
    // would notice the chip never appeared.
    assert.match(chipProblem(chip({ fromS: 40, toS: 42 }), 30) ?? "", /past the/);
  });

  it("rejects a zero-length or reversed window", () => {
    assert.ok(chipProblem(chip({ fromS: 3, toS: 3 }), 10));
    assert.ok(chipProblem(chip({ fromS: 4, toS: 2 }), 10));
  });

  it("rejects a chip with no text", () => {
    assert.ok(chipProblem(chip({ text: "   " }), 10));
  });

  it("allows the frame edges themselves", () => {
    // 0 and 1 are legal placements — the reference straddles its panel edges.
    assert.equal(chipProblem(chip({ x: 0, y: 1 }), 10), null);
  });
});

describe("chipsAt", () => {
  const a = chip({ text: "a", fromS: 0, toS: 2 });
  const b = chip({ text: "b", fromS: 1, toS: 4 });

  it("returns every chip live at once", () => {
    // The reference carries FOUR at f645, so overlap is the normal case.
    assert.deepEqual(chipsAt([a, b], 1.5).map((c) => c.text), ["a", "b"]);
  });

  it("is half-open, so a chip ending where another starts does not flicker", () => {
    assert.deepEqual(chipsAt([a, b], 0).map((c) => c.text), ["a"]);
    assert.deepEqual(chipsAt([a, b], 2).map((c) => c.text), ["b"]);
  });

  it("is empty outside every window", () => {
    assert.deepEqual(chipsAt([a, b], 9), []);
    assert.deepEqual(chipsAt([], 1), []);
  });
});
