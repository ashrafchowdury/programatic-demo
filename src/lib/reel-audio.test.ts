import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClickEvent } from "./click-log";
import {
  AUDIO_FILTERS,
  buildAudioMux,
  clickReelTimes,
  clipLabelWarnings,
  cueHits,
  missingAudioFilters,
  resolveAnchor,
  resolvePiece,
  SAMPLE_RATE,
  segmentBoundsSeconds,
  sfxProblem,
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
    assert.match(
      on.filter,
      /loudnorm=I=-14:TP=-1\.5:LRA=11,aresample=48000,apad\[aout\]/,
    );
  });

  it("delivers 48 kHz: resamples after loudnorm and pins -ar (R2)", () => {
    // loudnorm oversamples to 192 kHz and hands that on; the AAC encoder then
    // wrote 96 kHz. Four of five reels with sound shipped that way.
    const on = buildAudioMux([p], ["/a.mp3"], "/v.mp4", { loudnessLUFS: -14 });
    const ar = on.mapArgs.indexOf("-ar");
    assert.ok(ar >= 0);
    assert.equal(on.mapArgs[ar + 1], String(SAMPLE_RATE));
    assert.equal(SAMPLE_RATE, 48000);
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

  it("maps a click's press-time to reel-time inside its clip", () => {
    // reel starts: card 0-1, clip1 1-3, card 3-4, clip3 4-6. The sound lands on
    // tDownMs (950, 2950), not the beat anchor tMs — see beatTimeMs.
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, log, 1, "click"),
      [1.95, 4.95],
    );
  });

  it("places a click on the PRESS, not the beat anchor", () => {
    // A beat whose anchor trails its mousedown by 200ms must sound on the
    // mousedown: demo 1.0 -> reel 2.0. Anchoring on tMs would give reel 2.2,
    // which reads as the tick lagging the ripple.
    const l = { ...log, clicks: [{ tMs: 1200, tDownMs: 1000, x: 0, y: 0 }] };
    assert.deepEqual(clickReelTimes(segments, counts, 30, l, 1, "click"), [2]);
  });

  it("falls back to tMs when a click has no tDownMs recorded", () => {
    // Older logs have no mousedown. beatMatches keeps such beats out of "click",
    // but a label cue can still target them, and it must not crash or drift.
    const l = { ...log, clicks: [{ tMs: 1000, label: "Allow all", x: 0, y: 0 }] };
    assert.deepEqual(
      clickReelTimes(segments, counts, 30, l, 1, "confirm", ["allow all"]),
      [2],
    );
  });

  it("places no SFX inside a frozen clip", () => {
    // A freeze clip holds ONE frame, so nothing in it is pressed — but its
    // range still spans live footage. Same segments, but clip3 is frozen: its
    // beat (reel 4.95) must vanish while clip1's survives.
    const frozen = [
      segments[0],
      segments[1],
      segments[2],
      { clip: { fromS: 2, toS: 4, freeze: true } },
    ];
    assert.deepEqual(
      clickReelTimes(frozen, counts, 30, log, 1, "click"),
      [1.95],
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
    assert.match(filter, /\[bed\]\[leadScPad\]sidechaincompress=/);
    assert.match(filter, /\[ducked\]\[leadMix\]amix=inputs=2/);
  });

  it("pads the sidechain so short SFX cannot truncate the bed", () => {
    // sidechaincompress ends with its SHORTEST input. Leads are 0.2-0.3s SFX, so
    // an unpadded sidechain cuts the music off at the last tick — the harness cut
    // lost 13.5s of its 30s that way. The pad must be on the sidechain copy ONLY;
    // padding leadMix too would leave the final mix with no end.
    const { filter } = buildAudioMux(
      [piece("bed", 0), piece("sfx", 1)],
      ["bed.mp3", "tick.wav"],
      "v.mp4",
      { duck: true },
    );
    assert.match(filter, /\[leadSc\]apad\[leadScPad\]/);
    assert.doesNotMatch(filter, /\[leadMix\]apad/);
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

describe("clickReelTimes in a dissolving reel (R3)", () => {
  // card(1s) clip[0,2) card(1s) clip[2,4), joined by 6-frame dissolves.
  const segments = [
    { card: { name: "x", headline: "A" } },
    { clip: { fromS: 0, toS: 2 } },
    { card: { name: "x", headline: "B" } },
    { clip: { fromS: 2, toS: 4 } },
  ];
  const counts = [30, 60, 30, 60];
  const overlaps = [6, 6, 6];
  const log = {
    name: "x",
    viewport: { width: 1920, height: 1080 },
    durationMs: 4000,
    // One press at the very first frame of each clip.
    clicks: [
      { tMs: 0, tDownMs: 0, x: 0, y: 0 },
      { tMs: 2000, tDownMs: 2000, x: 0, y: 0 },
    ],
  };

  it("lands each press on its clip's DISSOLVED start", () => {
    const bounds = segmentBoundsSeconds(counts, 30, overlaps);
    const t = clickReelTimes(segments, counts, 30, log, 1, "click", undefined, overlaps);
    // A press on a clip's first frame sounds exactly where that clip begins.
    assert.deepEqual(t, [bounds.startS[1], bounds.startS[3]]);
    // 1s - 6f = 0.8s; 4s - 18f = 3.4s.
    assert.deepEqual(t.map((x) => Number(x.toFixed(6))), [0.8, 3.4]);
  });

  it("drifts late by the sum of the joins when the overlaps are left out", () => {
    // What the mux did before: 200 ms late on the first clip, 600 ms on the
    // second — the drift grows with every dissolve.
    const late = clickReelTimes(segments, counts, 30, log, 1, "click");
    const right = clickReelTimes(segments, counts, 30, log, 1, "click", undefined, overlaps);
    assert.deepEqual(
      late.map((x, i) => Number((x - right[i]).toFixed(6))),
      [0.2, 0.6],
    );
  });
});

describe("sfxProblem — cues that would place nothing (R4)", () => {
  const log = {
    name: "x",
    viewport: { width: 1920, height: 1080 },
    durationMs: 30000,
    clicks: [
      { tMs: 2000, tDownMs: 1900, label: "Add schedule", x: 0, y: 0 },
      { tMs: 14000, tDownMs: 13900, label: "Claude Code", x: 0, y: 0 },
      { tMs: 22950, tDownMs: 22856, label: "Create schedule", x: 0, y: 0 },
    ],
  };
  const segments = [
    { card: { name: "x", headline: "A" } },
    { clip: { fromS: 1, toS: 10 } },
    { clip: { fromS: 12.5, toS: 15.6, freeze: true } },
    { clip: { fromS: 17.6, toS: 19.9, label: "create it" } },
  ];

  it("passes when every cue hits a playing clip", () => {
    assert.equal(
      sfxProblem(segments, { confirm: { src: "c.wav", atLabels: ["Add schedule"] } }, log, 1),
      null,
    );
  });

  it("names the cue, the label, where it is and the clip ranges when it misses", () => {
    // The press is at 22.86s, the last clip ends at 19.9s.
    const m = sfxProblem(
      segments,
      { confirm: { src: "c.wav", atLabels: ["Create schedule"] } },
      log,
      1,
    );
    assert.ok(m);
    assert.match(m, /sfx\.confirm/);
    assert.match(m, /"Create schedule" at demo 22\.86s/);
    assert.match(m, /#3 \[17\.60-19\.90\)/);
  });

  it("counts a label inside a freeze clip as a miss, and says freeze", () => {
    // A press inside the held still plays no sound.
    const m = sfxProblem(segments, { confirm: { src: "c.wav", atLabels: ["claude code"] } }, log, 1);
    assert.ok(m);
    assert.match(m, /#2 \[12\.50-15\.60\) freeze/);
  });

  it("says when no beat carries the label at all", () => {
    const m = sfxProblem(segments, { error: { src: "e.wav", atLabels: ["Nope"] } }, log, 1);
    assert.match(m ?? "", /no beat in the click log has that label/);
  });

  it("flags a detector cue with nothing to detect", () => {
    const m = sfxProblem(segments, { typing: { src: "t.wav" } }, log, 1);
    assert.match(m ?? "", /sfx\.typing` matches no beat/);
  });

  it("agrees with cueHits, which is what the mux places from", () => {
    assert.equal(cueHits(segments, log, 1, "confirm", ["Create schedule"]).length, 0);
    assert.equal(cueHits(segments, log, 1, "confirm", ["Add schedule"]).length, 1);
  });
});

describe("clipLabelWarnings (R4)", () => {
  const log = {
    name: "x",
    viewport: { width: 1920, height: 1080 },
    durationMs: 30000,
    clicks: [
      { tMs: 9600, tDownMs: 9507, label: "Daily", x: 0, y: 0 },
      { tMs: 17180, tDownMs: 17091, label: "write the message", x: 0, y: 0 },
    ],
  };

  it("is quiet when the label shares a word with a beat in range", () => {
    const segs = [{ clip: { fromS: 8, toS: 11, label: "make it daily" } }];
    assert.deepEqual(clipLabelWarnings(segs, log, 1), []);
  });

  it("warns, listing what the clip actually plays, when nothing matches", () => {
    const segs = [{ clip: { fromS: 17.6, toS: 19.9, label: "create it" } }];
    // tDownMs 17.091 is BEFORE 17.6, so the clip plays no labelled beat.
    assert.deepEqual(clipLabelWarnings(segs, log, 1), [
      'clip #0 "create it" [17.60-19.90) plays no labelled beat — check the range',
    ]);
    const wide = [{ clip: { fromS: 17, toS: 19.9, label: "create it" } }];
    assert.match(clipLabelWarnings(wide, log, 1)[0], /plays "write the message"/);
  });

  it("skips freeze clips and unlabelled clips", () => {
    const segs = [
      { clip: { fromS: 17, toS: 19.9, label: "create it", freeze: true } },
      { clip: { fromS: 20, toS: 21 } },
    ];
    assert.deepEqual(clipLabelWarnings(segs, log, 1), []);
  });
});
