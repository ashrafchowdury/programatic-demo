import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_LOOK,
  LOOKS,
  audioProblem,
  clipFrameCount,
  clipFrames,
  coldOpenIndex,
  defineReel,
  isCard,
  isClip,
  reelProblem,
  type Reel,
} from "./reel";

const card = (headline: string) => ({ card: { name: "x", headline } });
const clip = (fromS: number, toS: number) => ({ clip: { fromS, toS } });

const REEL: Reel = defineReel({
  name: "agent-skill",
  segments: [
    card("Introducing Skills"),
    clip(0, 3.2),
    card("Ship it"),
    clip(3.2, 7.9),
  ],
});

describe("clipFrames", () => {
  it("treats toS as exclusive so adjacent ranges do not share a frame", () => {
    // Written 0-3.2 and 3.2-7.9, these must not both contain frame 96, or the
    // cut plays that frame twice — a visible stutter at every card boundary.
    const a = clipFrames({ fromS: 0, toS: 3.2 }, 30);
    const b = clipFrames({ fromS: 3.2, toS: 7.9 }, 30);
    assert.deepEqual(a, { first: 0, last: 95 });
    assert.equal(b.first, 96);
    assert.equal(b.first, a.last + 1);
  });

  it("counts frames inclusively at both ends", () => {
    assert.equal(clipFrameCount({ fromS: 0, toS: 3.2 }, 30), 96);
    assert.equal(clipFrameCount({ fromS: 1, toS: 2 }, 30), 30);
  });

  it("never produces an empty range", () => {
    const { first, last } = clipFrames({ fromS: 1, toS: 1.001 }, 30);
    assert.ok(last >= first);
  });
});

describe("isCard / isClip", () => {
  it("splits the segment union", () => {
    assert.equal(REEL.segments.filter(isCard).length, 2);
    assert.equal(REEL.segments.filter(isClip).length, 2);
  });
});

describe("reelProblem", () => {
  it("accepts a well-formed reel", () => {
    assert.equal(reelProblem(REEL, 560), null);
  });

  it("rejects a clip that runs past the end of the demo", () => {
    // The check that earns its keep: without it this surfaces as an ffmpeg
    // failure after every earlier segment has already been rendered.
    const over = { name: "x", segments: [clip(0, 20)] };
    assert.match(reelProblem(over, 560) ?? "", /560 frames/);
    assert.equal(reelProblem(over, 600), null);
  });

  it("rejects clips that go backwards or overlap", () => {
    const back = { name: "x", segments: [clip(5, 8), clip(2, 4)] };
    assert.match(reelProblem(back) ?? "", /before the previous clip/);
    const overlap = { name: "x", segments: [clip(0, 4), clip(3, 6)] };
    assert.match(reelProblem(overlap) ?? "", /before the previous clip/);
  });

  it("rejects a zero-length or inverted range", () => {
    assert.match(
      reelProblem({ name: "x", segments: [clip(3, 3)] }) ?? "",
      /at or before/,
    );
    assert.match(
      reelProblem({ name: "x", segments: [clip(5, 2)] }) ?? "",
      /at or before/,
    );
  });

  it("reports which segment a bad card is in", () => {
    const bad = { name: "x", segments: [clip(0, 1), { card: { name: "y" } }] };
    const problem = reelProblem(bad) ?? "";
    assert.match(problem, /segment 2/);
    assert.match(problem, /headline/);
  });

  it("rejects an empty reel", () => {
    assert.match(
      reelProblem({ name: "x", segments: [] }) ?? "",
      /no `segments`/,
    );
    assert.match(reelProblem(null) ?? "", /not an object/);
  });
});

describe("cold open", () => {
  it("accepts a short leading clip that replays footage a later clip covers", () => {
    // The reel opens on 0.4s of product, then the title card, then the first
    // real clip from 0. Those ranges are deliberately non-monotonic — that is
    // what a flash-forward is — and the ordering rule used to reject it.
    const reel = {
      name: "x",
      segments: [
        clip(0.8, 1.2),
        card("Introducing Skills"),
        clip(0, 3.2),
        card("Next"),
        clip(3.2, 7.9),
      ],
    };
    assert.equal(reelProblem(reel, 560), null);
    assert.equal(coldOpenIndex(reel.segments), 0);
  });

  it("only recognises a cold open when the shape is unmistakable", () => {
    // Recognition, not assertion: the exemption must not become a general
    // escape hatch for out-of-order ranges, which is the only thing the
    // monotonic rule catches. Two clips in a row is a typo, not a tease; and a
    // long leading clip is a scene, so what follows it still has to be in order.
    assert.equal(coldOpenIndex([clip(5, 8), clip(2, 4)]), -1);
    assert.match(
      reelProblem({ name: "x", segments: [clip(5, 8), clip(2, 4)] }) ?? "",
      /before the previous clip/,
    );
    const long = { name: "x", segments: [clip(0, 4), card("t"), clip(2, 6)] };
    assert.equal(coldOpenIndex(long.segments), -1);
    assert.match(reelProblem(long) ?? "", /before the previous clip/);
  });

  it("rejects a drift outside 0..1", () => {
    const bad = {
      name: "x",
      segments: [{ clip: { fromS: 0, toS: 2, drift: 4 } }],
    };
    assert.match(reelProblem(bad) ?? "", /drift/);
  });
});

describe("a frozen shot", () => {
  const still = (fromS: number, toS: number) => ({
    clip: { fromS, toS, freeze: true },
  });

  it("may overlap the clip before it, because it does not play", () => {
    // The harness reel's still: clip 4 runs 8.43-11.67 and the still holds the
    // frame at 14.0 for 95 frames, which needs a range starting inside the
    // clip's. Nothing plays, so nothing can read as a jump cut backwards.
    const reel = {
      name: "x",
      segments: [
        card("t"),
        clip(8.43, 11.67),
        card("payoff"),
        still(10.83, 14.0),
      ],
    };
    assert.equal(reelProblem(reel, 420), null);
  });

  it("may not hold a state the previous clip had already passed", () => {
    // The one thing overlapping must not buy: a still of an EARLIER state plays
    // as the product undoing itself.
    const reel = {
      name: "x",
      segments: [card("t"), clip(8.43, 11.67), still(2.0, 4.0)],
    };
    assert.match(reelProblem(reel, 420) ?? "", /already passed/);
  });

  it("still advances the high-water mark for the clips after it", () => {
    const reel = {
      name: "x",
      segments: [clip(1, 3), card("t"), still(2, 6), card("u"), clip(4, 5)],
    };
    assert.match(reelProblem(reel, 420) ?? "", /before the previous clip/);
  });
});

describe("audioProblem", () => {
  const ok = { src: "audio/bed.mp3", trim: { fromS: 12, toS: 25 } };

  it("accepts a valid audio array and an absent one", () => {
    assert.equal(audioProblem([ok]), null);
    assert.equal(
      reelProblem({ name: "x", segments: [{ clip: { fromS: 0, toS: 2 } }] }, 60),
      null,
    );
  });

  it("requires an array and a src", () => {
    assert.match(audioProblem({} as unknown) ?? "", /must be an array/);
    assert.match(audioProblem([{}]) ?? "", /needs a `src`/);
    assert.match(audioProblem([{ src: "" }]) ?? "", /needs a `src`/);
  });

  it("validates trim ordering and non-negative numbers", () => {
    assert.match(
      audioProblem([{ src: "a.mp3", trim: { fromS: 5, toS: 3 } }]) ?? "",
      /trim.toS/,
    );
    assert.match(
      audioProblem([{ src: "a.mp3", gain: -1 }]) ?? "",
      /`gain`/,
    );
  });

  it("rejects both end and duration, and end before start", () => {
    assert.match(
      audioProblem([{ src: "a.mp3", end: 5, duration: 3 }]) ?? "",
      /both `end` and `duration`/,
    );
    assert.match(
      audioProblem([{ src: "a.mp3", start: 6, end: 4 }]) ?? "",
      /`end` must be after `start`/,
    );
  });

  it("rejects a piece that starts after the reel ends (when total known)", () => {
    // 60 frames @ 30fps = 2s reel; a piece starting at 5s is inaudible.
    assert.match(
      audioProblem([{ src: "a.mp3", start: 5 }], 60, 30) ?? "",
      /after the reel ends/,
    );
    // Without a known total, the start is not bounded.
    assert.equal(audioProblem([{ src: "a.mp3", start: 5 }]), null);
  });

  it("flows through reelProblem for a reel with audio", () => {
    const reel = {
      name: "x",
      segments: [{ clip: { fromS: 0, toS: 2 } }],
      audio: [{ src: "" }],
    };
    assert.match(reelProblem(reel, 60) ?? "", /needs a `src`/);
  });
});

describe("audio anchors + loudness validation (F12/F9)", () => {
  it("accepts a segment anchor for start and rejects an out-of-range one", () => {
    const segs = [{ clip: { fromS: 0, toS: 2 } }, { card: { name: "x", headline: "H" } }];
    assert.equal(
      reelProblem({ name: "x", segments: segs, audio: [{ src: "a.mp3", start: { segment: 1 } }] }, 90),
      null,
    );
    assert.match(
      reelProblem({ name: "x", segments: segs, audio: [{ src: "a.mp3", start: { segment: 5 } }] }, 90) ?? "",
      /5 is out of range/,
    );
    assert.match(
      audioProblem([{ src: "a.mp3", start: { segment: 1.5 } }]) ?? "",
      /integer `segment`/,
    );
  });

  it("validates loudnessLUFS range", () => {
    assert.equal(
      reelProblem({ name: "x", segments: [{ clip: { fromS: 0, toS: 2 } }], loudnessLUFS: -14 }, 90),
      null,
    );
    assert.match(
      reelProblem({ name: "x", segments: [{ clip: { fromS: 0, toS: 2 } }], loudnessLUFS: 5 }, 90) ?? "",
      /loudnessLUFS/,
    );
  });

  const withSfx = (sfx: object) =>
    reelProblem({ name: "x", segments: [{ clip: { fromS: 0, toS: 2 } }], sfx }, 90);

  it("accepts auto-kind sfx cues without atLabels", () => {
    assert.equal(withSfx({ click: { src: "a.wav" }, typing: { src: "b.wav", gain: 0.3 } }), null);
  });

  it("requires a src on an sfx cue", () => {
    assert.match(withSfx({ click: { gain: 0.5 } }) ?? "", /sfx\.click. needs a .src/);
  });

  it("requires atLabels on label-only kinds", () => {
    assert.match(withSfx({ confirm: { src: "c.wav" } }) ?? "", /needs .atLabels/);
    assert.equal(withSfx({ confirm: { src: "c.wav", atLabels: ["Allow all"] } }), null);
  });

  it("rejects an empty or non-string atLabels", () => {
    assert.match(withSfx({ key: { src: "k.wav", atLabels: [] } }) ?? "", /atLabels/);
    assert.match(withSfx({ key: { src: "k.wav", atLabels: [""] } }) ?? "", /atLabels/);
  });
});

describe("reel look", () => {
  const base = {
    name: "smoke",
    segments: [{ clip: { fromS: 0, toS: 1 } }],
  };

  it("defaults to absent, so every existing reel keeps the framed treatment", () => {
    assert.equal(reelProblem(base, 300), null);
    assert.equal(DEFAULT_LOOK, "framed");
  });

  it("accepts both shipped looks", () => {
    for (const look of LOOKS)
      assert.equal(reelProblem({ ...base, look }, 300), null);
  });

  it("rejects an unknown look rather than silently rendering the default", () => {
    assert.match(
      String(reelProblem({ ...base, look: "cinematic" }, 300)),
      /look must be one of/,
    );
  });
});
