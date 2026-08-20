import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClickEvent, ClickLog } from "./click-log";
import { hudSteps, stepAt } from "./hud";
import type { ReelSegment } from "./reel";

// card(1s) clip[0,2)(2s) card(1s) clip[2,4)(2s) — reel starts 0, 1, 3, 4.
const SEGMENTS: ReelSegment[] = [
  { card: { name: "x", headline: "A" } },
  { clip: { fromS: 0, toS: 2 } },
  { card: { name: "x", headline: "B" } },
  { clip: { fromS: 2, toS: 4 } },
];
const COUNTS = [30, 60, 30, 60];
const FPS = 30;
const TOTAL = 6;

const log = (clicks: ClickEvent[]): ClickLog => ({
  name: "x",
  viewport: { width: 1920, height: 1080 },
  durationMs: 4000,
  clicks,
});

describe("hudSteps", () => {
  it("numbers the beats it finds and runs each until the next", () => {
    // A step that only showed on its own beat would blink. The line has to say
    // what is happening NOW, which means holding until something else does.
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([
        { tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 },
        { tMs: 3000, tDownMs: 3000, label: "Enable harness", x: 0, y: 0 },
      ]),
      1,
      TOTAL,
    );
    assert.deepEqual(steps, [
      { index: 1, label: "Add provider", startS: 2, endS: 5 },
      { index: 2, label: "Enable harness", startS: 5, endS: 6 },
    ]);
  });

  it("skips focus beats, which nothing visible happens on", () => {
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([{ tMs: 1000, label: "hover thing", x: 0, y: 0 }]),
      1,
      TOTAL,
    );
    assert.deepEqual(steps, []);
  });

  it("skips unlabelled and one-character beats", () => {
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([
        { tMs: 1000, tDownMs: 1000, x: 0, y: 0 },
        { tMs: 1500, tDownMs: 1500, label: "x", x: 0, y: 0 },
      ]),
      1,
      TOTAL,
    );
    assert.deepEqual(steps, []);
  });

  it("places nothing inside a frozen clip", () => {
    // Same rule the SFX follow: a still holds one frame, so nothing is pressed
    // on it and narrating a step there describes a picture that is not moving.
    const frozen: ReelSegment[] = [
      SEGMENTS[0],
      SEGMENTS[1],
      SEGMENTS[2],
      { clip: { fromS: 2, toS: 4, freeze: true } },
    ];
    const steps = hudSteps(
      frozen,
      COUNTS,
      FPS,
      log([
        { tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 },
        { tMs: 3000, tDownMs: 3000, label: "Enable harness", x: 0, y: 0 },
      ]),
      1,
      TOTAL,
    );
    assert.equal(steps.length, 1);
    assert.equal(steps[0].label, "Add provider");
  });

  it("collapses two beats landing on the same frame", () => {
    // A label cue and its own press can coincide; showing both flashes one for
    // zero seconds.
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([
        { tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 },
        { tMs: 1010, tDownMs: 1010, label: "Add provider row", x: 0, y: 0 },
      ]),
      1,
      TOTAL,
    );
    assert.equal(steps.length, 1);
  });

  it("respects a dissolve's overlap, like the SFX do", () => {
    // The HUD sits on the dissolved timeline. Using the un-dissolved bounds
    // would drift it later and later behind the footage it describes.
    const beats = log([
      { tMs: 3000, tDownMs: 3000, label: "Enable harness", x: 0, y: 0 },
    ]);
    const cut = hudSteps(SEGMENTS, COUNTS, FPS, beats, 1, TOTAL, [0, 0, 0]);
    const dis = hudSteps(SEGMENTS, COUNTS, FPS, beats, 1, TOTAL, [6, 6, 6]);
    // segment 3 is pulled 3 * 6 frames = 0.6s earlier.
    assert.ok(Math.abs(cut[0].startS - dis[0].startS - 0.6) < 1e-9);
  });

  it("keeps the last step on screen to the end of the film", () => {
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([{ tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 }]),
      1,
      TOTAL,
    );
    assert.equal(steps[0].endS, TOTAL);
  });

  it("scales beat times by the demo speed", () => {
    // The demo is rendered at a playback rate, so a shoot-clock time is not a
    // demo second. Getting this wrong drifts the whole HUD proportionally.
    const beats = log([
      { tMs: 1250, tDownMs: 1250, label: "Add provider", x: 0, y: 0 },
    ]);
    const at1 = hudSteps(SEGMENTS, COUNTS, FPS, beats, 1, TOTAL)[0];
    const at125 = hudSteps(SEGMENTS, COUNTS, FPS, beats, 1.25, TOTAL)[0];
    assert.equal(at1.startS, 2.25);
    assert.equal(at125.startS, 2);
  });
});

describe("stepAt", () => {
  const steps = [
    { index: 1, label: "one", startS: 2, endS: 5 },
    { index: 2, label: "two", startS: 5, endS: 6 },
  ];

  it("shows nothing before the first step", () => {
    // The HUD must not appear over the opening bookend, which has no step to
    // describe and is the shot the viewer arrives on.
    assert.equal(stepAt(steps, 0), null);
    assert.equal(stepAt(steps, 1.9), null);
  });

  it("switches exactly on the boundary", () => {
    assert.equal(stepAt(steps, 2)?.index, 1);
    assert.equal(stepAt(steps, 4.99)?.index, 1);
    assert.equal(stepAt(steps, 5)?.index, 2);
  });

  it("holds the last step past its end rather than blanking", () => {
    assert.equal(stepAt(steps, 99)?.index, 2);
  });

  it("is empty-safe", () => {
    assert.equal(stepAt([], 3), null);
  });
});
