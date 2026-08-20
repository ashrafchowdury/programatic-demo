import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildXfadeFilter,
  dissolvedFrameCount,
  dissolvedStarts,
  joinable,
  MIN_JOIN_F,
} from "./xfade";
import { segmentBoundsSeconds } from "../../src/lib/reel-audio";

// Three 30-frame segments at 30fps joined by monid's measured 6-frame dissolve.
const COUNTS = [30, 30, 30];
const FPS = 30;
const OVERLAP = [6, 6];

describe("dissolvedFrameCount", () => {
  it("loses one overlap per join, not per segment", () => {
    // 90 raw, two joins, 6 frames each -> 78. Counting per segment instead
    // would give 72 and every downstream second would be wrong.
    assert.equal(dissolvedFrameCount(COUNTS, OVERLAP), 78);
  });

  it("is the plain sum when nothing dissolves", () => {
    assert.equal(dissolvedFrameCount(COUNTS, [0, 0]), 90);
    assert.equal(dissolvedFrameCount([30], []), 30, "one segment has no join");
    assert.equal(dissolvedFrameCount([], []), 0);
  });
});

describe("dissolvedStarts", () => {
  it("pulls each segment earlier by every join before it", () => {
    // f0, then 30-6=24, then 60-12=48 — the drift is cumulative, which is the
    // part that bites: segment 3 is out by TWO overlaps, not one.
    assert.deepEqual(dissolvedStarts(COUNTS, FPS, OVERLAP), [0, 0.8, 1.6]);
  });

  it("matches a plain concat when the overlap is zero", () => {
    assert.deepEqual(dissolvedStarts(COUNTS, FPS, [0, 0]), [0, 1, 2]);
  });

  it("keeps the last start inside the shortened film", () => {
    // A start past the end would place an SFX after the picture had finished.
    const starts = dissolvedStarts(COUNTS, FPS, OVERLAP);
    const total = dissolvedFrameCount(COUNTS, OVERLAP) / FPS;
    assert.ok(starts[starts.length - 1] < total);
  });
});

describe("buildXfadeFilter", () => {
  it("chains N-1 nodes and names the last one [v]", () => {
    const f = buildXfadeFilter(COUNTS, FPS, OVERLAP);
    assert.equal(f.split(";").length, 2);
    assert.ok(f.endsWith("[v]"), f);
    assert.match(f, /^\[0:v\]\[1:v\]xfade/);
    // The middle node feeds the next one rather than the output.
    assert.match(f, /\[x1\];\[x1\]\[2:v\]xfade/);
  });

  it("offsets each fade on the ACCUMULATED chain, not the raw segment", () => {
    // First join starts at 1.0 - 0.2 = 0.8s. Second at 0.8 + 30/30 - 0.2 = 1.6s.
    // Using the raw segment start (2.0 - 0.2 = 1.8) is the natural mistake and
    // plays the second dissolve 0.2s late.
    const f = buildXfadeFilter(COUNTS, FPS, OVERLAP);
    const offsets = [...f.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(offsets, [0.8, 1.6]);
  });

  it("agrees with dissolvedStarts on where each join lands", () => {
    // The two are used in different places — one drives the picture, the other
    // places SFX — so they drifting apart is the bug worth guarding.
    const f = buildXfadeFilter(COUNTS, FPS, OVERLAP);
    const offsets = [...f.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
    const starts = dissolvedStarts(COUNTS, FPS, OVERLAP);
    for (let i = 0; i < offsets.length; i++)
      assert.equal(offsets[i], starts[i + 1], `join ${i + 1}`);
  });

  it("emits the fade duration in seconds, not frames", () => {
    assert.match(buildXfadeFilter(COUNTS, FPS, OVERLAP), /duration=0\.2/);
  });

  it("is empty for a single segment — nothing to join", () => {
    assert.equal(buildXfadeFilter([30], FPS, OVERLAP), "");
  });

  it("handles uneven segments", () => {
    const f = buildXfadeFilter([96, 99, 126], FPS, OVERLAP);
    const offsets = [...f.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
    // 96/30 - 0.2 = 3.0, then 3.0 + 99/30 - 0.2 = 6.1
    assert.deepEqual(offsets, [3, 6.1]);
  });
});

describe("the picture and the audio agree", () => {
  it("dissolvedStarts matches segmentBoundsSeconds for the same overlap", () => {
    // Two implementations of one shift, in two modules that cannot import each
    // other (src/lib vs scripts/lib). This is the only thing holding them
    // together, and the failure it prevents is silent: SFX drifting later and
    // later behind the footage they belong to.
    for (const counts of [[30, 30, 30], [96, 99, 126, 96], [50]])
      for (const o of [0, 6, 12]) {
        const overlap = counts.slice(1).map(() => o);
        assert.deepEqual(
          dissolvedStarts(counts, FPS, overlap),
          segmentBoundsSeconds(counts, FPS, overlap).startS,
          `counts=${counts} overlap=${o}`,
        );
      }
  });
});

describe("selective dissolves", () => {
  it("blends only the joins that ask for it", () => {
    // The reference dissolves 2 of ~4 boundaries. Blending all of them
    // cross-fades cards into live UI, which is what the first ledger cut of
    // harness looked like.
    const f = buildXfadeFilter([30, 30, 30], FPS, [0, 6]);
    const durs = [...f.matchAll(/duration=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(durs, [0, 0.2]);
  });

  it("counts only the frames the blended joins actually eat", () => {
    // 90 raw, one 6-frame join -> 84. Charging for both would report 78 and
    // the frame-count check would then reject a correct render.
    assert.equal(dissolvedFrameCount([30, 30, 30], [0, 6]), 84);
  });

  it("shifts starts by the joins BEFORE each segment, not a flat multiple", () => {
    // segment 1 loses nothing, segment 2 loses the 6-frame join before it.
    assert.deepEqual(dissolvedStarts([30, 30, 30], FPS, [0, 6]), [0, 1, 1.8]);
  });

  it("still agrees with the audio bounds when joins differ", () => {
    for (const overlaps of [[0, 6], [6, 0], [3, 9], [0, 0]])
      assert.deepEqual(
        dissolvedStarts([30, 30, 30], FPS, overlaps),
        segmentBoundsSeconds([30, 30, 30], FPS, overlaps).startS,
        `overlaps=${overlaps}`,
      );
  });
});

describe("MIN_JOIN_F", () => {
  it("never emits a zero-duration fade", () => {
    // xfade=duration=0 does not butt two shots together, it degenerates and
    // silently drops everything before it in the chain. Measured: an 897-frame
    // film with two zero joins rendered as 556 — exactly its longest segment.
    const f = buildXfadeFilter([30, 30, 30], FPS, joinable([0, 6]));
    const durs = [...f.matchAll(/duration=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.ok(
      durs.every((d) => d > 0),
      `zero-duration fade in ${f}`,
    );
  });

  it("charges the frame count for the minimum it actually used", () => {
    // The filter and the arithmetic read the SAME clamped list, or the render
    // is rejected as a frame-count mismatch — which is how this was found.
    const joins = joinable([0, 6]);
    assert.deepEqual(joins, [MIN_JOIN_F, 6]);
    assert.equal(dissolvedFrameCount([30, 30, 30], joins), 90 - MIN_JOIN_F - 6);
  });

  it("leaves a real dissolve alone", () => {
    assert.deepEqual(joinable([6, 6]), [6, 6]);
  });
});
