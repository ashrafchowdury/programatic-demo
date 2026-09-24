import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinishArgs,
  buildJoinFilter,
  dissolvedFrameCount,
  dissolvedStarts,
  runs,
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

describe("buildJoinFilter (dissolves)", () => {
  it("chains N-1 nodes and names the last one [v]", () => {
    const f = buildJoinFilter(COUNTS, FPS, OVERLAP);
    const fades = f.split(";").filter((n) => n.includes("xfade"));
    assert.equal(fades.length, 2);
    assert.ok(f.endsWith("[v]"), f);
    assert.match(fades[0], /^\[r0\]\[r1\]xfade/);
    // The middle node feeds the next one rather than the output.
    assert.match(f, /\[x1\];\[x1\]\[r2\]xfade/);
  });

  it("offsets each fade on the ACCUMULATED chain, not the raw segment", () => {
    // First join starts at 1.0 - 0.2 = 0.8s. Second at 0.8 + 30/30 - 0.2 = 1.6s.
    // Using the raw segment start (2.0 - 0.2 = 1.8) is the natural mistake and
    // plays the second dissolve 0.2s late.
    const f = buildJoinFilter(COUNTS, FPS, OVERLAP);
    const offsets = [...f.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(offsets, [0.8, 1.6]);
  });

  it("agrees with dissolvedStarts on where each join lands", () => {
    // The two are used in different places — one drives the picture, the other
    // places SFX — so they drifting apart is the bug worth guarding.
    const f = buildJoinFilter(COUNTS, FPS, OVERLAP);
    const offsets = [...f.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
    const starts = dissolvedStarts(COUNTS, FPS, OVERLAP);
    for (let i = 0; i < offsets.length; i++)
      assert.equal(offsets[i], starts[i + 1], `join ${i + 1}`);
  });

  it("emits the fade duration in seconds, not frames", () => {
    assert.match(buildJoinFilter(COUNTS, FPS, OVERLAP), /duration=0\.2/);
  });

  it("passes a single segment through — nothing to join", () => {
    assert.equal(buildJoinFilter([30], FPS, []), "[0:v]null[v]");
  });

  it("handles uneven segments", () => {
    const f = buildJoinFilter([96, 99, 126], FPS, OVERLAP);
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
    const f = buildJoinFilter([30, 30, 30], FPS, [0, 6]);
    const durs = [...f.matchAll(/duration=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(durs, [0.2], f);
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

describe("cuts inside a dissolving film (R16)", () => {
  it("groups cut-joined segments into runs", () => {
    assert.deepEqual(runs(3, [0, 6]), [[0, 1], [2]]);
    assert.deepEqual(runs(4, [6, 0, 0]), [[0], [1, 2, 3]]);
    assert.deepEqual(runs(3, [0, 0]), [[0, 1, 2]]);
    assert.deepEqual(runs(1, []), [[0]]);
  });

  it("never hands xfade a zero-duration fade", () => {
    // xfade=duration=0 does not butt two shots together, it degenerates and
    // silently drops everything before it in the chain. Measured: an 897-frame
    // film with two zero joins rendered as 556 — exactly its longest segment.
    const f = buildJoinFilter([30, 30, 30, 30], FPS, [0, 6, 0]);
    const durs = [...f.matchAll(/duration=([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(durs, [0.2], f);
  });

  it("puts every run on one timebase before xfade sees it", () => {
    // concat outputs 1/1000000, a lone segment 1/90000, and xfade refuses the
    // pair — the first mixed smoke reel failed exactly there.
    const f = buildJoinFilter([30, 30, 30], FPS, [0, 6]);
    assert.match(f, /\[2:v\]settb=AVTB\[r1\]/);
  });

  it("joins a cut with concat, so the incoming shot keeps its first frame", () => {
    // The old chain clamped every cut to a one-frame xfade, which ate that
    // frame. Concat is frame-exact: a cut costs nothing.
    const f = buildJoinFilter([30, 30, 30], FPS, [0, 6]);
    assert.match(f, /^\[0:v\]\[1:v\]concat=n=2:v=1:a=0,settb=AVTB\[r0\]/);
    assert.equal(dissolvedFrameCount([30, 30, 30], [0, 6]), 84);
  });

  it("offsets a dissolve after a cut run on the run's full length", () => {
    // Run [0,1] is 60 frames = 2.0s; the 6-frame dissolve starts at 1.8s.
    const f = buildJoinFilter([30, 30, 30], FPS, [0, 6]);
    assert.match(f, /\[r0\]\[r1\]xfade=transition=fade:duration=0\.2:offset=1\.8\[v\]$/);
    assert.equal(1.8, dissolvedStarts([30, 30, 30], FPS, [0, 6])[2]);
  });

  it("is a plain concat for an all-cut film with a layer", () => {
    const f = buildJoinFilter([30, 30], FPS, [0], 1);
    assert.equal(f, "[0:v][1:v]concat=n=2:v=1:a=0,settb=AVTB[r0];[r0][2:v]overlay=format=auto[v]");
  });
});

describe("overlay layers (R15)", () => {
  it("composites every layer in the same graph, last on top", () => {
    const f = buildJoinFilter([30, 30], FPS, [6], 2);
    const nodes = f.split(";");
    assert.equal(nodes.length, 5);
    assert.match(nodes[2], /xfade/);
    assert.equal(nodes[3], "[x1][2:v]overlay=format=auto[o0]");
    assert.equal(nodes[4], "[o0][3:v]overlay=format=auto[v]");
  });

  it("overlays a single segment without joining anything", () => {
    assert.equal(buildJoinFilter([30], FPS, [], 1), "[0:v][1:v]overlay=format=auto[v]");
  });
});

describe("buildFinishArgs (R1)", () => {
  const args = buildFinishArgs(["/a.mp4", "/b.mp4"], [60, 60], 30, [6], ["/hud.mov"], "/out.mp4");
  const flag = (k: string) => args[args.indexOf(k) + 1];

  it("encodes 4:2:0 h264 at the segments' CRF, not ffmpeg's defaults", () => {
    // Without these the pass wrote High 4:4:4 Predictive at CRF 23.
    assert.equal(flag("-c:v"), "libx264");
    assert.equal(flag("-crf"), "16");
    assert.equal(flag("-pix_fmt"), "yuv420p");
  });

  it("tags BT.709 on all three axes", () => {
    assert.equal(flag("-colorspace"), "bt709");
    assert.equal(flag("-color_primaries"), "bt709");
    assert.equal(flag("-color_trc"), "bt709");
    assert.equal(flag("-color_range"), "tv");
  });

  it("wires parts then layers as inputs and the filter's [v] as the output", () => {
    assert.deepEqual(args.slice(0, 7), ["-y", "-i", "/a.mp4", "-i", "/b.mp4", "-i", "/hud.mov"]);
    assert.equal(flag("-filter_complex"), buildJoinFilter([60, 60], 30, [6], 1));
    assert.equal(flag("-map"), "[v]");
    assert.equal(args[args.length - 1], "/out.mp4");
  });
});
