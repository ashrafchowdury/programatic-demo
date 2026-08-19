import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClickEvent } from "./click-log";
import {
  AUDIO_FILTERS,
  buildAudioMux,
  clickReelTimes,
  missingAudioFilters,
  resolveAnchor,
  resolvePiece,
  segmentBoundsSeconds,
} from "./reel-audio";

describe("resolvePiece", () => {
  it("applies a source trim and clamps the piece to the reel length", () => {
    // 60s source, use 12-25s, on a 20s reel starting at 0.
    const r = resolvePiece(
      { src: "a.mp3", trim: { fromS: 12, toS: 25 } },
      20,
      60,
    );
    assert.equal(r.sourceFromS, 12);
    assert.equal(r.availS, 13); // 25 - 12
    assert.equal(r.durationS, 13); // fits inside the 20s reel
  });

  it("clamps the on-timeline length to the room left after `start`", () => {
    // availS 13 but only 5s of reel remain after start=15.
    const r = resolvePiece(
      { src: "a.mp3", trim: { fromS: 12, toS: 25 }, start: 15 },
      20,
      60,
    );
    assert.equal(r.startS, 15);
    assert.equal(r.durationS, 5);
  });

  it("uses the whole file when no trim is given", () => {
    const r = resolvePiece({ src: "a.mp3" }, 30, 8);
    assert.equal(r.sourceFromS, 0);
    assert.equal(r.availS, 8);
    assert.equal(r.durationS, 8);
  });

  it("honours `end` and `duration`, never outlasting the source without pad", () => {
    // duration 10 but source only has 4s and no pad -> 4s.
    const noPad = resolvePiece({ src: "a.mp3", duration: 10 }, 30, 4);
    assert.equal(noPad.durationS, 4);
    // pad fills the requested 10s with silence.
    const padded = resolvePiece({ src: "a.mp3", duration: 10, pad: true }, 30, 4);
    assert.equal(padded.durationS, 10);
    // `end` is measured from start.
    const byEnd = resolvePiece({ src: "a.mp3", start: 2, end: 5 }, 30, 60);
    assert.equal(byEnd.durationS, 3);
  });

  it("clamps fades to the piece length", () => {
    const r = resolvePiece(
      { src: "a.mp3", trim: { fromS: 0, toS: 2 }, fadeInS: 5, fadeOutS: 5 },
      30,
      60,
    );
    assert.equal(r.durationS, 2);
    assert.equal(r.fadeInS, 2);
    assert.equal(r.fadeOutS, 2);
  });
});

describe("buildAudioMux", () => {
  const p = (over = {}) => ({
    src: "a.mp3",
    sourceFromS: 12,
    availS: 13,
    startS: 0,
    durationS: 13,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    pad: false,
    role: "lead" as const,
    crossfadePrevS: 0,
    ...over,
  });

  it("puts the video first and trims each source at the input level", () => {
    const { inputs } = buildAudioMux([p()], ["/abs/a.mp3"], "/v.mp4");
    assert.deepEqual(inputs, [
      "-i",
      "/v.mp4",
      "-ss",
      "12",
      "-t",
      "13",
      "-i",
      "/abs/a.mp3",
    ]);
  });

  it("copies video, encodes aac, and makes the video authoritative", () => {
    const { mapArgs } = buildAudioMux([p()], ["/a.mp3"], "/v.mp4");
    const s = mapArgs.join(" ");
    assert.match(s, /-map 0:v/);
    assert.match(s, /-map \[aout\]/);
    assert.match(s, /-c:v copy/);
    assert.match(s, /-c:a aac/);
    assert.match(s, /-shortest/);
  });

  it("a single piece is padded to the video, not amixed", () => {
    const { filter } = buildAudioMux([p({ startS: 0 })], ["/a.mp3"], "/v.mp4");
    assert.match(filter, /\[a0\]apad\[aout\]/);
    assert.doesNotMatch(filter, /amix/);
    // start 0 -> no adelay
    assert.doesNotMatch(filter, /adelay/);
  });

  it("emits gain/fades/delay only when they do work, with all-channel delay", () => {
    const { filter } = buildAudioMux(
      [p({ startS: 2.5, gain: 0.5, fadeInS: 0.8, fadeOutS: 1.5 })],
      ["/a.mp3"],
      "/v.mp4",
    );
    assert.match(filter, /volume=0\.5/);
    assert.match(filter, /afade=t=in:st=0:d=0\.8/);
    assert.match(filter, /afade=t=out:st=11\.5:d=1\.5/); // 13 - 1.5
    assert.match(filter, /adelay=2500:all=1/); // 2.5s, all channels
  });

  it("mixes multiple pieces with normalize=0 and no dropout swell", () => {
    const { filter } = buildAudioMux(
      [p(), p({ startS: 6 })],
      ["/a.mp3", "/b.mp3"],
      "/v.mp4",
    );
    assert.match(
      filter,
      /\[a0\]\[a1\]amix=inputs=2:normalize=0:dropout_transition=0\[m\];\[m\]apad\[aout\]/,
    );
  });

  it("normalises sample rate and layout on every piece", () => {
    const { filter } = buildAudioMux([p()], ["/a.mp3"], "/v.mp4");
    assert.match(filter, /aresample=48000/);
    assert.match(filter, /aformat=sample_fmts=fltp:channel_layouts=stereo/);
  });
});

describe("missingAudioFilters", () => {
  it("lists filters absent from an ffmpeg -filters dump", () => {
    const full = AUDIO_FILTERS.map((f) => ` T.. ${f}  desc`).join("\n");
    assert.deepEqual(missingAudioFilters(full), []);
    const noMix = full.replace(/\bamix\b/g, "xxxx");
    assert.deepEqual(missingAudioFilters(noMix), ["amix"]);
    assert.deepEqual(missingAudioFilters(""), [...AUDIO_FILTERS]);
  });
});

describe("segment anchors (F12)", () => {
  // 3 segments of 1s, 2s, 1.5s at 30fps.
  const bounds = segmentBoundsSeconds([30, 60, 45], 30);

  it("prefix-sums frame counts into reel-second boundaries", () => {
    assert.deepEqual(bounds.startS, [0, 1, 3]);
    assert.deepEqual(bounds.durS, [1, 2, 1.5]);
  });

  it("resolves a number straight through and an anchor to a boundary", () => {
    assert.equal(resolveAnchor(4.2, bounds), 4.2);
    assert.equal(resolveAnchor({ segment: 2 }, bounds), 3); // start of seg 2
    assert.equal(resolveAnchor({ segment: 1, edge: "end" }, bounds), 3); // 1 + 2
    // Out-of-range clamps rather than throwing.
    assert.equal(resolveAnchor({ segment: 9 }, bounds), 3);
  });

  it("resolvePiece places a piece at an anchored start", () => {
    const r = resolvePiece(
      { src: "a.mp3", start: { segment: 2 }, trim: { fromS: 0, toS: 5 } },
      10,
      60,
      bounds,
    );
    assert.equal(r.startS, 3);
    assert.equal(r.durationS, 5);
  });
});

describe("loudness (F9)", () => {
  const p = {
    src: "a.mp3",
    sourceFromS: 0,
    availS: 5,
    startS: 0,
    durationS: 5,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    pad: false,
    role: "lead" as const,
    crossfadePrevS: 0,
  };

  it("appends loudnorm before apad only when a target is given", () => {
    const off = buildAudioMux([p], ["/a.mp3"], "/v.mp4");
    assert.doesNotMatch(off.filter, /loudnorm/);
    const on = buildAudioMux([p], ["/a.mp3"], "/v.mp4", { loudnessLUFS: -14 });
    assert.match(on.filter, /loudnorm=I=-14:TP=-1\.5:LRA=11,apad\[aout\]/);
  });
});

describe("clickReelTimes (F13 auto-SFX)", () => {
  // card(1s) clip[0,2)(2s) card(1s) clip[2,4)(2s) — reel starts 0,1,3,5.
  const segments = [
    { card: { name: "x", headline: "A" } },
    { clip: { fromS: 0, toS: 2 } },
    { card: { name: "x", headline: "B" } },
    { clip: { fromS: 2, toS: 4 } },
  ];
  const counts = [30, 60, 30, 60];
  const log = {
    name: "x",
    viewport: { width: 1920, height: 1080 },
    durationMs: 4000,
    clicks: [
      { tMs: 1000, tDownMs: 950, x: 0, y: 0 }, // demo 1.0, clip1 start 1 -> reel 2.0
      { tMs: 1500, x: 0, y: 0 }, // focus beat, no tDownMs -> not a click
      { tMs: 3000, tDownMs: 2950, x: 0, y: 0 }, // demo 3.0, clip3 start 4 -> reel 5.0
    ],
  };

  it("maps a click's demo-time to reel-time inside its clip", () => {
    // reel starts: card 0-1, clip1 1-3, card 3-4, clip3 4-6.
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, log, 1, "click"),
      [2, 5],
    );
  });

  it("excludes focus beats (no tDownMs) from clicks", () => {
    // the tMs:1500 beat would land at reel 2.5 if counted — it must not be.
    assert.ok(
      !clickReelTimes(segments, counts, 30, log, 1, "click").includes(2.5),
    );
  });

  it("skips beats outside every clip range", () => {
    const outside = {
      ...log,
      clicks: [{ tMs: 9000, tDownMs: 8950, x: 0, y: 0 }], // demo 9s, no clip covers it
    };
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, outside, 1, "click"),
      [],
    );
  });

  // clip1 covers demo [0,2), starts at reel 1s (speed 1).
  const typed = (clicks: ClickEvent[]) => ({ ...log, clicks });

  it("typing fires as a bed only for a real string (span >= 500ms)", () => {
    const l = typed([
      { tMs: 500, typeEndMs: 1300, x: 0, y: 0 }, // span 800 -> typing
      { tMs: 100, typeEndMs: 300, x: 0, y: 0 }, // span 200 -> not typing
    ]);
    // long span at demo 0.5 -> reel 1.5; short one excluded.
    assert.deepEqual(clickReelTimes(segments, counts, 30, l, 1, "typing"), [1.5]);
  });

  it("pop fires ~120ms after any typed input, long or short", () => {
    const l = typed([{ tMs: 500, typeEndMs: 1300, x: 0, y: 0 }]);
    // typeEndMs 1300 + 120 = 1420ms -> demo 1.42 -> reel 2.42.
    assert.deepEqual(clickReelTimes(segments, counts, 30, l, 1, "pop"), [2.42]);
  });

  it("click excludes typing beats (press that is also a typed run)", () => {
    const l = typed([{ tMs: 500, tDownMs: 450, typeEndMs: 1300, x: 0, y: 0 }]);
    assert.deepEqual(clickReelTimes(segments, counts, 30, l, 1, "click"), []);
  });

  it("label kinds fire on matching beat labels, at the press", () => {
    const l = typed([
      { tMs: 1000, tDownMs: 1000, label: "click Allow all", x: 0, y: 0 },
      { tMs: 1600, tDownMs: 1550, label: "hover model", x: 0, y: 0 },
    ]);
    // "Allow all" beat press at demo 1.0 -> reel 2.0; the other label doesn't match.
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, l, 1, "confirm", ["allow all"]),
      [2],
    );
  });

  it("label matching is case-insensitive and substring", () => {
    const l = typed([{ tMs: 1000, tDownMs: 1000, label: "Press ENTER now", x: 0, y: 0 }]);
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, l, 1, "key", ["enter"]),
      [2],
    );
  });
});

describe("ducking (F11)", () => {
  const piece = (role: "bed" | "lead" | "sfx", j: number) => ({
    src: `${j}.mp3`,
    sourceFromS: 0,
    availS: 5,
    startS: 0,
    durationS: 5,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    pad: false,
    role,
    crossfadePrevS: 0,
  });

  it("compresses beds by the lead sidechain when duck is on", () => {
    const { filter } = buildAudioMux(
      [piece("bed", 0), piece("sfx", 1)],
      ["/0.mp3", "/1.mp3"],
      "/v.mp4",
      { duck: true },
    );
    assert.match(filter, /asplit\[leadSc\]\[leadMix\]/);
    assert.match(filter, /\[bed\]\[leadSc\]sidechaincompress=/);
    assert.match(filter, /\[ducked\]\[leadMix\]amix=inputs=2/);
  });

  it("does not duck when there is no bed or no lead", () => {
    const noBed = buildAudioMux(
      [piece("lead", 0), piece("sfx", 1)],
      ["/0.mp3", "/1.mp3"],
      "/v.mp4",
      { duck: true },
    );
    assert.doesNotMatch(noBed.filter, /sidechaincompress/);
  });
});

describe("crossfade (F10)", () => {
  const p = (over = {}) => ({
    src: "x.mp3",
    sourceFromS: 0,
    availS: 8,
    startS: 0,
    durationS: 8,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    pad: false,
    role: "lead" as const,
    crossfadePrevS: 0,
    ...over,
  });

  it("joins a crossfade group with acrossfade and places it as one stream", () => {
    const { filter } = buildAudioMux(
      [p(), p({ crossfadePrevS: 1.5, startS: 8 })],
      ["/a.mp3", "/b.mp3"],
      "/v.mp4",
    );
    // The two pieces are combined, not amixed as separate streams.
    assert.match(filter, /acrossfade=d=1\.5/);
    assert.match(filter, /\[s0\]/); // one placed group stream
    assert.doesNotMatch(filter, /\[a0\]\[a1\]amix/); // not two independent streams
  });

  it("leaves a non-crossfaded neighbour independent", () => {
    const { filter } = buildAudioMux(
      [p(), p({ crossfadePrevS: 1 }), p({ startS: 12 })],
      ["/a.mp3", "/b.mp3", "/c.mp3"],
      "/v.mp4",
    );
    // group [0,1] -> [s0]; piece 2 -> [a2]; final amix of the two streams.
    assert.match(filter, /acrossfade=d=1/);
    assert.match(filter, /\[s0\]\[a2\]amix=inputs=2/);
  });
});
