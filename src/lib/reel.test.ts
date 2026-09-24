import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStyle, STYLE_PRESETS } from "./style";
import type { ClickLog } from "./click-log";
import {
  DEMO_LOOK,
  LOOKS,
  audioProblem,
  clipFrameCount,
  findBeat,
  ignoredClipFields,
  pacing,
  reelCard,
  reelDemo,
  resolveClipRange,
  resolveReel,
  segmentJoins,
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

  it("stays optional on a reel", () => {
    assert.equal(reelProblem(base, 300), null);
  });

  // REGRESSION GUARD. This assertion used to read `DEFAULT_LOOK === "framed"`
  // and was described as "every existing reel keeps the framed treatment" —
  // which stopped being true the moment DEFAULT_STYLE moved to a full-bleed
  // grammar, and the test went on passing because DEFAULT_LOOK was read by
  // nothing. A demo clip silently lost its camera and its backdrop.
  //
  // What actually has to hold is downstream of the constant: whatever grammar a
  // standalone clip renders in, it must be one that runs the camera the click
  // log was recorded for. Assert the resolved preset, not the label.
  it("renders a standalone demo clip in a grammar that runs the camera", () => {
    const shot = STYLE_PRESETS[resolveStyle({ look: DEMO_LOOK })].shot;
    assert.equal(shot.framing, "window");
    assert.equal(shot.zoom, true);
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

// A click log with a repeated label, a unique one, and a shoot-clock offset —
// the three things beat anchors have to get right.
const LOG = {
  name: "demo",
  viewport: { width: 1920, height: 1080 },
  durationMs: 20000,
  offsetMs: 200,
  clicks: [
    { label: "Add provider", tMs: 2700, tDownMs: 2575 },
    { label: "open cadence", tMs: 5000 },
    { label: "Open cadence", tMs: 9000, tDownMs: 8950 },
    { label: "Save", tMs: 12700, tDownMs: 12575 },
  ],
} as unknown as ClickLog;

describe("beat anchors (R7)", () => {
  it("places a beat on its press, on the DEMO clock (speed and offset applied)", () => {
    // 2575 ms on the shoot clock at 1.25x is 2.06 s of demo, less the 0.2 s
    // offset. Reading tMs (2700) or forgetting the speed is the old 25% error.
    const hit = findBeat("Add provider", LOG, 1.25);
    assert.ok("s" in hit);
    assert.ok(Math.abs(hit.s - 1.86) < 1e-9, String(hit.s));
  });

  it("matches labels exactly, ignoring case", () => {
    assert.ok("s" in findBeat("save", LOG, 1));
    assert.ok("problem" in findBeat("Sav", LOG, 1));
  });

  it("refuses an ambiguous label and lists every candidate", () => {
    const r = findBeat("open cadence", LOG, 1);
    assert.ok("problem" in r);
    assert.match(r.problem, /ambiguous — 2 beats/);
    assert.match(r.problem, /#1 at 4\.80s, #2 at 8\.75s/);
    assert.match(r.problem, /"open cadence#2"/);
  });

  it("takes the n-th occurrence with #n", () => {
    const r = findBeat("open cadence#2", LOG, 1);
    assert.ok("s" in r && Math.abs(r.s - 8.75) < 1e-9);
    assert.match(
      (findBeat("open cadence#3", LOG, 1) as { problem: string }).problem,
      /occurs 2 time/,
    );
  });

  it("names near misses when a label is missing", () => {
    const r = findBeat("cadence", LOG, 1);
    assert.ok("problem" in r);
    assert.match(r.problem, /no beat is labelled "cadence"/);
    assert.match(r.problem, /Near misses: "open cadence"/);
  });

  it("resolves from/to beats with signed lead and tail", () => {
    const r = resolveClipRange(
      { fromBeat: "Add provider", leadS: -0.4, toBeat: "Save", tailS: 0.3 },
      LOG,
      1,
    );
    assert.ok(!("problem" in r));
    assert.ok(Math.abs(r.fromS - (2.375 - 0.4)) < 1e-9, String(r.fromS));
    assert.ok(Math.abs(r.toS - (12.375 + 0.3)) < 1e-9, String(r.toS));
  });

  it("frames one action from a single beat plus a tail", () => {
    const r = resolveClipRange({ fromBeat: "Save", leadS: -1, tailS: 0.5 }, LOG, 1);
    assert.ok(!("problem" in r));
    assert.ok(Math.abs(r.toS - r.fromS - 1.5) < 1e-9);
  });

  it("lets plain seconds win and mix with anchors", () => {
    const r = resolveClipRange({ fromBeat: "Save", leadS: -1, toS: 14 }, LOG, 1);
    assert.ok(!("problem" in r) && r.toS === 14);
    assert.deepEqual(resolveClipRange({ fromS: 1, toS: 2 }, LOG, 1), { fromS: 1, toS: 2 });
  });

  it("says what is missing rather than guessing an end", () => {
    const r = resolveClipRange({ fromBeat: "Save" }, LOG, 1);
    assert.match((r as { problem: string }).problem, /toS`, `toBeat` or `tailS/);
    assert.match(
      (resolveClipRange({ leadS: 1, fromS: 2, toS: 3 }, LOG, 1) as { problem: string }).problem,
      /leadS/,
    );
  });

  it("resolves a whole reel and names the failing segment", () => {
    const reel = defineReel({
      name: "cut",
      segments: [card("t"), { clip: { fromBeat: "Add provider", leadS: -0.4, tailS: 1 } }],
    });
    const r = resolveReel(reel, LOG, 1);
    assert.ok("reel" in r);
    const seg = r.reel.segments[1];
    assert.ok(isClip(seg));
    assert.equal(typeof seg.clip.fromS, "number");
    assert.equal("fromBeat" in seg.clip, false, "anchors are spent once resolved");
    assert.equal(reelProblem(r.reel, 600), null);

    const bad = resolveReel(
      defineReel({ name: "cut", segments: [card("t"), { clip: { fromBeat: "Nope", tailS: 1 } }] }),
      LOG,
      1,
    );
    assert.ok("problem" in bad);
    assert.match(bad.problem, /^segment 2 \(clip\) fromBeat: no beat/);
  });

  it("passes a plain-seconds reel through unchanged", () => {
    const r = resolveReel(REEL, LOG, 1.25);
    assert.ok("reel" in r);
    assert.deepEqual(r.reel.segments, REEL.segments);
  });
});

describe("demo (R5)", () => {
  it("defaults to the reel's name", () => {
    assert.equal(reelDemo({ name: "agent-schedule" }), "agent-schedule");
    assert.equal(reelDemo({ name: "agent-schedule-stage", demo: "agent-schedule" }), "agent-schedule");
  });

  it("sizes every card from the DEMO, whatever the card calls itself", () => {
    // A card takes its size from public/<name>.clicks.json and has to match
    // the clips it is concatenated with.
    const c = reelCard(
      { name: "agent-schedule-stage", demo: "agent-schedule", style: "stage" },
      { name: "agent-schedule-stage", headline: "x" },
    );
    assert.equal(c.name, "agent-schedule");
    assert.equal(c.style, "stage");
  });

  it("lets a card keep its own style over the reel's", () => {
    const c = reelCard({ name: "r", style: "proof" }, { name: "r", headline: "x", style: "classic" });
    assert.equal(c.style, "classic");
  });

  it("rejects an empty demo", () => {
    assert.match(String(reelProblem({ ...REEL, demo: "" })), /`demo`/);
  });
});

describe("framing-ignored clip fields (R11)", () => {
  const shot = (style: "classic" | "stage" | "proof" | "ledger") => STYLE_PRESETS[style].shot;

  it("windowed styles cannot crop, plate or freeze", () => {
    const clip = { crop: { k: 1.2 }, pageBg: "#fff", freeze: true, cursor: true, ripple: false };
    assert.deepEqual(ignoredClipFields(clip as never, shot("classic")), ["crop", "pageBg", "freeze"]);
    assert.deepEqual(ignoredClipFields(clip as never, shot("stage")), ["crop", "pageBg", "freeze"]);
  });

  it("drift needs the zoom camera", () => {
    assert.deepEqual(ignoredClipFields({ drift: 0.3 }, shot("classic")), []);
    assert.deepEqual(ignoredClipFields({ drift: 0.3 }, shot("stage")), ["drift"]);
    assert.deepEqual(ignoredClipFields({ drift: 0.3 }, shot("proof")), ["drift"]);
  });

  it("cursor, ripple and push are honoured everywhere", () => {
    for (const s of ["classic", "stage", "proof", "ledger"] as const)
      assert.deepEqual(
        ignoredClipFields({ cursor: true, ripple: true, push: {} } as never, shot(s)),
        [],
        s,
      );
  });

  it("reelProblem names the field and the style", () => {
    const reel = { name: "x", style: "stage", segments: [card("t"), { clip: { fromS: 0, toS: 2, pageBg: "#fff" } }] };
    const p = String(reelProblem(reel, 300));
    assert.match(p, /segment 2 \(clip\) sets `pageBg`/);
    assert.match(p, /"stage" style ignores/);
    assert.equal(reelProblem(reel, 300, 30, { framing: false }), null, "--style demotes it to a warning");
  });

  it("accepts a freeze under a full-bleed style", () => {
    const reel = { name: "x", style: "proof", segments: [card("t"), { clip: { fromS: 0, toS: 2, freeze: true } }] };
    assert.equal(reelProblem(reel, 300), null);
  });
});

describe("segmentJoins / pacing (--check)", () => {
  it("cuts by default and dissolves where a segment asks", () => {
    const segs = [card("a"), { ...clip(0, 1), join: "dissolve" as const }, card("b")];
    assert.deepEqual(segmentJoins(segs, { kind: "cut" }), [6, 0]);
    assert.deepEqual(segmentJoins(segs, { kind: "dissolve", frames: 8 }), [8, 8]);
    assert.deepEqual(
      segmentJoins([card("a"), { ...card("b"), join: "cut" as const }], { kind: "dissolve", frames: 8 }),
      [0],
    );
  });

  it("measures what a style's targets are written in", () => {
    // 4 shots of 90 frames, one 6-frame dissolve: 354 frames = 11.8 s.
    const segs = [card("a"), clip(0, 3), card("b"), clip(3, 6)];
    const p = pacing(segs, [90, 90, 90, 90], [0, 6, 0], 30);
    assert.ok(Math.abs(p.runtimeS - 11.8) < 1e-9);
    assert.ok(Math.abs(p.meanShotS - 2.95) < 1e-9);
    assert.ok(Math.abs(p.cutsPerMin - (3 / 11.8) * 60) < 1e-9);
    assert.equal(p.dissolves, 1);
    assert.equal(p.clipShare, 0.5);
  });
});

describe("aspect + opening pose (R6, R10)", () => {
  it("accepts the three aspects and refuses anything else", () => {
    for (const aspect of ["16:9", "1:1", "9:16"] as const)
      assert.equal(reelProblem({ ...REEL, aspect }), null);
    assert.match(
      reelProblem({ ...REEL, aspect: "4:5" as never }) ?? "",
      /aspect must be one of 16:9, 1:1, 9:16/,
    );
  });

  it("resolves `open.at` from a beat to its control's centre", () => {
    const log = {
      ...LOG,
      clicks: [
        ...LOG.clicks,
        { label: "Create", tMs: 15000, x: 1850, y: 1040, rect: { x: 1804, y: 1014, w: 124, h: 72 } },
      ],
    } as ClickLog;
    const r = resolveReel(
      {
        name: "x",
        segments: [{ clip: { fromS: 1, toS: 2, open: { scale: 1.74, at: "Create" } } }],
      },
      log,
      1,
    );
    assert.ok("reel" in r);
    const seg = r.reel.segments[0];
    assert.ok(isClip(seg));
    assert.equal(seg.clip.open?.scale, 1.74);
    assert.ok(Math.abs(seg.clip.open!.at.x - 1866 / 1920) < 1e-9);
    assert.ok(Math.abs(seg.clip.open!.at.y - 1050 / 1080) < 1e-9);
    // And the resolved reel passes the shape check.
    assert.equal(reelProblem(r.reel), null);
  });

  it("names the beat an opening cannot find, and a bad scale", () => {
    const miss = resolveReel(
      { name: "x", segments: [{ clip: { fromS: 1, toS: 2, open: { scale: 1.5, at: "Nope" } } }] },
      LOG,
      1,
    );
    assert.ok("problem" in miss);
    assert.match(miss.problem, /open\.at: no beat is labelled "Nope"/);
    const bad = resolveReel(
      { name: "x", segments: [{ clip: { fromS: 1, toS: 2, open: { scale: 0.5 } } }] },
      LOG,
      1,
    );
    assert.ok("problem" in bad);
    assert.match(bad.problem, /open\.scale/);
  });

  it("centres an opening with no `at`", () => {
    const r = resolveReel(
      { name: "x", segments: [{ clip: { fromS: 1, toS: 2, open: { scale: 1.3 } } }] },
      LOG,
      1,
    );
    assert.ok("reel" in r);
    const seg = r.reel.segments[0];
    assert.ok(isClip(seg));
    assert.deepEqual(seg.clip.open?.at, { x: 0.5, y: 0.5 });
  });
});
