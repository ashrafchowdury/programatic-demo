import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCard } from "./intro";
import { type ReelSegment } from "./reel";
import {
  applySequence,
  planSequence,
  STYLE_PRESETS,
  type SequenceSegment,
} from "./style";

const proof = STYLE_PRESETS.proof;
const card = (extra: Record<string, unknown> = {}): SequenceSegment => ({
  card: { ...extra },
});
const clip = (extra: Record<string, unknown> = {}): SequenceSegment => ({
  clip: { ...extra },
});

describe("planSequence: the exit cycle", () => {
  it("cycles the style's card exits in order, and ends the film still", () => {
    const plan = planSequence([card(), card(), card(), card(), card()], proof);
    const [left, up, scale] = proof.sequence.exitCycle;
    assert.deepEqual(
      plan.map((m) => m.exit),
      [left, up, scale, left, { axis: "none", dist: 0, frames: 0 }],
    );
  });

  it("counts only cards, so clips between them do not shift the rhythm", () => {
    const plan = planSequence(
      [card(), clip(), card(), clip(), card(), card()],
      proof,
    );
    assert.deepEqual(
      [plan[0].exit?.axis, plan[2].exit?.axis, plan[4].exit?.axis],
      ["x", "y", "scale"],
    );
    assert.equal(plan[1].exit, undefined, "a clip keeps its own exit");
  });

  it("never overrides a card that authored its exit — it still takes its slot", () => {
    const plan = planSequence(
      [card({ exit: { axis: "none" } }), card(), card()],
      proof,
    );
    assert.equal(plan[0].exit, undefined);
    assert.equal(plan[1].exit?.axis, "y", "slot 1 is still the second exit");
  });

  it("skips recap and chip cards — neither travels on the envelope", () => {
    const plan = planSequence(
      [
        card(),
        card({ items: ["a"] }),
        card({ chip: { label: "Go" } }),
        card(),
        card(),
      ],
      proof,
    );
    assert.equal(plan[1].exit, undefined);
    assert.equal(plan[2].exit, undefined);
    assert.equal(plan[3].exit?.axis, "y");
  });

  it("assigns nothing in a style with no cycle", () => {
    for (const name of ["classic", "ledger", "stage"] as const) {
      const plan = planSequence(
        [card(), clip(), card(), card()],
        STYLE_PRESETS[name],
      );
      assert.deepEqual(plan, [{}, {}, {}, {}], name);
    }
  });
});

describe("planSequence: direction continuity", () => {
  it("enters from the right after a card leaves left", () => {
    const plan = planSequence([card(), clip(), card()], proof);
    const { x } = proof.sequence.continuity ?? { x: { dist: 0, frames: 0 } };
    assert.deepEqual(plan[1].enter, {
      axis: "x",
      dist: x.dist,
      frames: x.frames,
    });
    assert.ok(
      (plan[1].enter?.dist ?? 0) > 0,
      "starts right of rest, moves left",
    );
  });

  it("rises from below after an exit up, and settles from large after a shrink", () => {
    const plan = planSequence([card(), card(), card(), card(), card()], proof);
    assert.equal(plan[2].enter?.axis, "y");
    assert.ok((plan[2].enter?.dist ?? 0) > 0, "after exit up, starts below");
    assert.equal(plan[3].enter?.axis, "scale");
    assert.ok(
      (plan[3].enter?.dist ?? 0) > 0,
      "after shrinking away, starts large",
    );
  });

  it("continues a clip's authored exit into the next card", () => {
    const plan = planSequence(
      [clip({ push: { out: { axis: "y", dist: 80, frames: 12 } } }), card()],
      proof,
    );
    assert.equal(plan[1].enter?.axis, "y");
    assert.ok(
      (plan[1].enter?.dist ?? 0) < 0,
      "after an exit down, starts above",
    );
  });

  it("keeps authored entrances and leaves stills alone", () => {
    const plan = planSequence(
      [
        card(),
        clip({ push: { in: { axis: "y", dist: 60, frames: 12 } } }),
        card(),
        clip({ freeze: true }),
        card(),
      ],
      proof,
    );
    assert.equal(plan[1].enter, undefined);
    assert.equal(plan[3].enter, undefined, "a frozen shot never moves");
    // …and a still hands nothing on: the card after it keeps its own rise.
    assert.equal(plan[4].enter, undefined);
  });

  it("hands nothing on from a non-travelling card", () => {
    const plan = planSequence([card({ items: ["a"] }), card()], proof);
    assert.equal(plan[1].enter, undefined);
  });
});

describe("applySequence", () => {
  it("writes the plan in the shape a reel authors, and copies rather than mutates", () => {
    const segments: SequenceSegment[] = [card(), clip(), card()];
    const before = JSON.stringify(segments);
    const out = applySequence(segments, proof);
    assert.equal(JSON.stringify(segments), before, "input untouched");
    assert.ok("card" in out[0] && out[0].card.exit?.axis === "x");
    assert.ok("clip" in out[1] && out[1].clip.push?.in?.axis === "x");
    assert.equal("clip" in out[1] && out[1].clip.push?.out, undefined);
  });

  it("keeps a shots-layer clip's own exit when it gains an entrance", () => {
    // Setting `push` switches off the style's shot envelope in the cutter, so
    // the envelope's exit has to be carried across explicitly.
    const shots = {
      ...STYLE_PRESETS.stage,
      sequence: STYLE_PRESETS.proof.sequence,
    };
    const out = applySequence([card(), clip(), card()], shots);
    const push = "clip" in out[1] ? out[1].clip.push : undefined;
    assert.equal(push?.in?.axis, "x");
    assert.deepEqual(push?.out, { axis: "y", dist: 1520, frames: 11 });
  });

  it("returns an untouched segment as the same object", () => {
    const segments: SequenceSegment[] = [card({ exit: { axis: "none" } })];
    assert.equal(applySequence(segments, proof)[0], segments[0]);
  });

  it("accepts a reel's own segments and feeds the renderer what it reads", () => {
    // The wiring contract for scripts/reel.ts: ReelSegment in, ReelSegment
    // out, and a card's assigned exit reaches resolveCard's envelope.
    const reel: ReelSegment[] = [
      { card: { name: "x", headline: "One", style: "proof" } },
      { clip: { fromS: 0, toS: 1 } },
      { card: { name: "x", headline: "Two", style: "proof" } },
    ];
    const out: ReelSegment[] = applySequence(reel, proof);
    const first = out[0];
    assert.ok("card" in first);
    assert.deepEqual(
      resolveCard(first.card).push?.out,
      proof.sequence.exitCycle[0],
    );
  });
});
