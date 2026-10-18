import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockDiff,
  contiguousRuns,
  decideChunks,
  jumps,
  parsePatch,
  planChunks,
  resolveChunkFrames,
  windowFrames,
  type Range,
} from "./chunks";

describe("planChunks", () => {
  it("cuts on a grid from the range's first frame, the last chunk short", () => {
    assert.deepEqual(planChunks({ first: 10, last: 129 }, 50), [
      { first: 10, last: 59 },
      { first: 60, last: 109 },
      { first: 110, last: 129 },
    ]);
  });

  it("covers every frame exactly once", () => {
    const chunks = planChunks({ first: 0, last: 999 }, 120);
    assert.equal(chunks.reduce((n, c) => n + c.last - c.first + 1, 0), 1000);
    chunks.slice(1).forEach((c, i) => assert.equal(c.first, chunks[i].last + 1));
  });
});

describe("resolveChunkFrames", () => {
  it("defaults to 2s and reads DEMO_CHUNK_S", () => {
    assert.equal(resolveChunkFrames(60), 120);
    assert.equal(resolveChunkFrames(30, "4"), 120);
    assert.throws(() => resolveChunkFrames(30, "0"));
  });
});

describe("contiguousRuns", () => {
  it("groups the needed chunks so each run is one render", () => {
    assert.deepEqual(contiguousRuns([true, true, false, true, false, false, true, true]), [[0, 1], [3], [6, 7]]);
    assert.deepEqual(contiguousRuns([false, false]), []);
  });
});

describe("parsePatch", () => {
  it("reads ranges, single times and m:ss", () => {
    assert.deepEqual(parsePatch("12.4-15"), [{ fromS: 12.4, toS: 15 }]);
    assert.deepEqual(parsePatch("3,1:02-1:05.5"), [
      { fromS: 3, toS: 3 },
      { fromS: 62, toS: 65.5 },
    ]);
  });

  it("refuses what is not a window", () => {
    assert.throws(() => parsePatch("15-12"), /ends before/);
    assert.throws(() => parsePatch("a-b"), /not a time/);
    assert.throws(() => parsePatch("1-2-3"), /from-to/);
  });
});

describe("windowFrames", () => {
  const range = { first: 300, last: 899 };
  it("maps output seconds to composition frames through the range's start", () => {
    // The range starts 5s into the film; 6s-7s of film = 1s-2s into the range.
    assert.deepEqual(windowFrames({ fromS: 6, toS: 7 }, 5, range, 60), { first: 360, last: 420 });
  });

  it("clamps to the range and misses outside it", () => {
    assert.deepEqual(windowFrames({ fromS: 0, toS: 5.5 }, 5, range, 60), { first: 300, last: 330 });
    assert.equal(windowFrames({ fromS: 0, toS: 4 }, 5, range, 60), null);
    assert.equal(windowFrames({ fromS: 16, toS: 20 }, 5, range, 60), null);
  });

  it("a single time still covers its frame", () => {
    assert.deepEqual(windowFrames({ fromS: 6, toS: 6 }, 5, range, 60), { first: 360, last: 360 });
  });
});

describe("decideChunks", () => {
  const chunks: Range[] = [
    { first: 0, last: 9 },
    { first: 10, last: 19 },
    { first: 20, last: 29 },
  ];
  const fileFor = (c: Range) => `new-${c.first}.mp4`;
  const previous = {
    guard: "g",
    chunks: chunks.map((c) => ({ ...c, file: `old-${c.first}.mp4` })),
  };
  const onDisk = (files: string[]) => (f: string) => files.includes(f);

  it("without a patch, renders whatever the current key lacks", () => {
    const plans = decideChunks({ chunks, fileFor, exists: onDisk(["new-10.mp4", "old-0.mp4"]), patch: null, previous, guard: "g" });
    assert.deepEqual(plans.map((p) => p.action), ["render", "reuse", "render"]);
  });

  it("under a patch, keeps the last cut outside the window and renders inside it", () => {
    const exists = onDisk(["old-0.mp4", "old-10.mp4", "old-20.mp4"]);
    const plans = decideChunks({ chunks, fileFor, exists, patch: [{ first: 12, last: 14 }], previous, guard: "g" });
    assert.deepEqual(plans.map((p) => p.action), ["stale", "render", "stale"]);
    assert.equal(plans[0].file, "old-0.mp4");
    assert.equal(plans[1].file, "new-10.mp4");
  });

  it("never patches over a changed guard (a re-shoot, a new size)", () => {
    const exists = onDisk(["old-0.mp4", "old-10.mp4", "old-20.mp4"]);
    const plans = decideChunks({ chunks, fileFor, exists, patch: [{ first: 12, last: 14 }], previous, guard: "other" });
    assert.deepEqual(plans.map((p) => p.action), ["render", "render", "render"]);
  });

  it("prefers a current render over a stale one even outside the window", () => {
    const exists = onDisk(["new-0.mp4", "old-0.mp4", "old-20.mp4"]);
    const plans = decideChunks({ chunks, fileFor, exists, patch: [{ first: 12, last: 14 }], previous, guard: "g" });
    assert.deepEqual(plans.map((p) => p.action), ["reuse", "render", "stale"]);
  });
});

describe("jumps", () => {
  it("flags a seam that moves well past the motion either side", () => {
    assert.equal(jumps({ seam: 0.4, motion: 0.3 }), false); // encoder noise at a clean seam
    assert.equal(jumps({ seam: 2.7, motion: 0.05 }), true); // a cursor half in view, removed
    assert.equal(jumps({ seam: 14, motion: 12 }), false); // a moving cursor moves every pair alike
    assert.equal(jumps({ seam: 20, motion: 0.5 }), true);
  });
});

describe("blockDiff", () => {
  it("sees a small change the whole-frame mean would average away", () => {
    const w = 64;
    const a = Buffer.alloc(w * 64, 255);
    const b = Buffer.from(a);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) b[y * w + x] = 0; // a cursor-sized mark
    assert.ok(blockDiff(a, b, w) > 20, String(blockDiff(a, b, w)));
    assert.equal(blockDiff(a, a, w), 0);
  });
});
