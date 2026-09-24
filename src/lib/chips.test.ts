import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chipCovers,
  chipProblem,
  chipRideAt,
  chipsAt,
  chipSizePx,
  dodgeRects,
  pullInside,
  resolveChips,
  visibleSpan,
  type ChipSegment,
  type ReelChip,
} from "./chips";

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

/**
 * agent-tool's shape, at 30 fps: card, a stage clip that scales in over 11
 * frames and slides out over its last 11, then a card overlapping its exit.
 */
const STAGE_PUSH = {
  in: { axis: "scale" as const, dist: -0.2, frames: 11 },
  out: { axis: "y" as const, dist: 1520, frames: 11 },
};
const SEGS: ChipSegment[] = [
  { startF: 0, frames: 90 },
  { startF: 90, frames: 147, push: STAGE_PUSH, clip: { fromS: 5.5, toS: 10.4 } },
  { startF: 234, frames: 60 },
];
const BEATS: Record<string, number> = { "github app": 7.28, done: 11.63 };
const beat = (l: string) =>
  l.toLowerCase() in BEATS ? { s: BEATS[l.toLowerCase()] } : { problem: `no beat "${l}"` };
const resolve = (inputs: Parameters<typeof resolveChips>[0]) => {
  const r = resolveChips(inputs, SEGS, 30, beat, 4 / 3);
  if ("problem" in r) throw new Error(r.problem);
  return r;
};

describe("resolveChips — chips belong to a shot", () => {
  it("ends at the last frame before the exit moves, by default", () => {
    // 90 + 147 - 11 = 226: frame 226 is the last at rest, so the chip is gone
    // by 226/30 and never hangs over a panel sliding out.
    const [c] = resolve([{ text: "a", x: 0.5, y: 0.9, from: { segment: 1, atS: 1 } }]).chips;
    assert.equal(c.fromS, 4);
    assert.equal(c.toS, 226 / 30);
    assert.deepEqual(visibleSpan(SEGS[1], 30), { fromS: 3, toS: 226 / 30 });
  });

  it("places a beat anchor on its press, on the clip's own clock", () => {
    // GitHub at demo 7.28 is 1.78s into a clip that starts at demo 5.5.
    const [c] = resolve([
      { text: "a", x: 0.5, y: 0.9, from: { segment: 1, beat: "GitHub app", atS: 0.2 } },
    ]).chips;
    assert.ok(Math.abs(c.fromS - (3 + 1.78 + 0.2)) < 1e-9, String(c.fromS));
  });

  it("follows its shot when the film before it moves", () => {
    // The drift this replaced: a card two frames longer moves the clip, and a
    // chip in reel seconds stays behind.
    const moved = SEGS.map((g, i) => (i === 0 ? g : { ...g, startF: g.startF + 2 }));
    moved[0] = { ...moved[0], frames: 92 };
    const r = resolveChips(
      [{ text: "a", x: 0.5, y: 0.9, from: { segment: 1, atS: 1 } }],
      moved,
      30,
      beat,
      1,
    );
    assert.ok(!("problem" in r));
    if (!("problem" in r)) assert.equal(r.chips[0].fromS, 4 + 2 / 30);
  });

  it("cuts an authored end that runs into the exit, and says so", () => {
    const r = resolve([
      { text: "a", x: 0.5, y: 0.9, from: { segment: 1, atS: 1 }, to: { segment: 1, atS: 4.8 } },
    ]);
    assert.equal(r.chips[0].toS, 226 / 30);
    assert.match(r.notes[0], /cut .* short/);
  });

  it("rides the shot's push, and nothing on a still card", () => {
    const r = resolve([
      { text: "a", x: 0.5, y: 0.9, from: { segment: 1, atS: 0 } },
      { text: "b", x: 0.5, y: 0.9, from: { segment: 2, atS: 0.2 } },
    ]);
    assert.deepEqual(r.chips[0].ride, { startF: 90, frames: 147, push: STAGE_PUSH, designScale: 4 / 3 });
    assert.equal(r.chips[1].ride, undefined);
    // On the shot's first frame the chip is scaled with the panel; at rest, not.
    assert.ok(Math.abs(chipRideAt(r.chips[0], 90).scale - 0.8) < 1e-9);
    assert.deepEqual(chipRideAt(r.chips[0], 150), { x: 0, y: 0, scale: 1 });
  });

  it("accepts legacy reel seconds, owned by the shot playing then", () => {
    const [c] = resolve([{ text: "a", x: 0.5, y: 0.9, from: 4, to: 7.6 }]).chips;
    assert.equal(c.segment, 1);
    assert.equal(c.toS, 226 / 30);
  });

  it("refuses anchors that cannot be placed", () => {
    const bad = (inputs: Parameters<typeof resolveChips>[0]) => {
      const r = resolveChips(inputs, SEGS, 30, beat, 1);
      return "problem" in r ? r.problem : "";
    };
    assert.match(bad([{ text: "a", x: 0, y: 0, from: { segment: 9 } }]), /out of range/);
    assert.match(bad([{ text: "a", x: 0, y: 0, from: { segment: 0, beat: "Done" } }]), /not a playing clip/);
    // Done is pressed at 11.63, past the clip's 10.4 end.
    assert.match(bad([{ text: "a", x: 0, y: 0, from: { segment: 1, beat: "Done" } }]), /outside segment 1/);
    assert.match(
      bad([{ text: "a", x: 0, y: 0, from: { segment: 1, atS: 1 }, to: { segment: 2, atS: 1 } }]),
      /one shot/,
    );
    assert.match(bad([{ text: "a", x: 0, y: 0, from: { segment: 1, atS: 5 } }]), /empty/);
  });
});

describe("chip geometry", () => {
  it("sizes the pill against the 16:9 height at every aspect", () => {
    const a = chipSizePx("every action", { heightFrac: 0.073, capRatio: 0.58 }, 1440);
    assert.ok(Math.abs(a.height - 105.12) < 1e-9);
    assert.ok(a.width > 400 && a.width < 700, String(a.width));
  });

  it("pulls a centre in until the pill fits", () => {
    assert.equal(pullInside(0.95, 0.2), 0.76);
    assert.equal(pullInside(0.5, 0.6), 0.5);
  });

  it("moves a chip off a press target to the nearest free side", () => {
    // The 9:16 agent-tool case: "every action" over the Done button.
    const half = { w: 0.2, h: 0.02 };
    const done = { x0: 0.7, y0: 0.9, x1: 0.85, y1: 0.925 };
    assert.ok(chipCovers(0.68, 0.915, half, [done]));
    const d = dodgeRects(0.68, 0.915, half, [done], { x: 0.01, y: 0.01 });
    assert.ok(d.moved && d.clear);
    assert.ok(!chipCovers(d.x, d.y, half, [done]));
    // Below it is nearer than above or beside it.
    assert.ok(d.y > 0.925, String(d.y));
  });

  it("stays put when nothing is covered, and reports when no side is free", () => {
    const half = { w: 0.1, h: 0.1 };
    assert.deepEqual(dodgeRects(0.5, 0.5, half, [], { x: 0, y: 0 }), { x: 0.5, y: 0.5, moved: false, clear: true });
    const wall = { x0: 0, y0: 0, x1: 1, y1: 1 };
    const d = dodgeRects(0.5, 0.5, half, [wall], { x: 0, y: 0 });
    assert.equal(d.clear, false);
  });
});
