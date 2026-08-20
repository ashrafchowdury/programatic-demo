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
    // Step 1 stops at 3 rather than running to step 2 at 5: a card sits at
    // 3-4, and a step line over a statement card labels the wrong thing.
    assert.deepEqual(steps, [
      { index: 1, label: "Add provider", startS: 2, endS: 3 },
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

  it("ends the last step when the footage ends, not when the film does", () => {
    // A step describes the demo, so it must not outlive it. Measured on the
    // ledger cut of agent-schedule: "5 - CREATE SCHEDULE" rode over the blue
    // payoff card AND the closing wordmark, putting a demo label on the brand
    // frame. The final clip here ends at 6 and the film also ends at 6, so use
    // a film that runs past its last clip to see the difference.
    const steps = hudSteps(
      SEGMENTS,
      COUNTS,
      FPS,
      log([{ tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 }]),
      1,
      TOTAL,
    );
    // clip[0,2) is segment 1, spanning reel 1s-3s.
    assert.equal(steps[0].endS, 3);
  });

  it("carries a step across a cut between two adjacent clips", () => {
    // Two takes butted together are one subject, not two. Ending the line at
    // the first take's edge would blink it off mid-sentence.
    const adjacent: ReelSegment[] = [
      { card: { name: "x", headline: "A" } },
      { clip: { fromS: 0, toS: 2 } },
      { clip: { fromS: 2, toS: 4 } },
    ];
    const steps = hudSteps(
      adjacent,
      [30, 60, 60],
      FPS,
      log([{ tMs: 1000, tDownMs: 1000, label: "Add provider", x: 0, y: 0 }]),
      1,
      6,
    );
    // clips span reel 1s-5s as ONE run, so the step holds to 5, not to 3.
    assert.equal(steps[0].endS, 5);
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

  it("draws nothing past the last step's end", () => {
    // This is what keeps the closing cards clean: once the footage is over
    // there is no step current, so the overlay renders empty.
    assert.equal(stepAt(steps, 6), null);
    assert.equal(stepAt(steps, 99), null);
    assert.equal(stepAt(steps, 5.9)?.index, 2);
  });

  it("is empty-safe", () => {
    assert.equal(stepAt([], 3), null);
  });
});

describe("skipLabels", () => {
  const beats = [
    { tMs: 1000, tDownMs: 1000, label: "Add schedule", x: 0, y: 0 },
    { tMs: 1400, tDownMs: 1400, label: "open cadence", x: 0, y: 0 },
    { tMs: 1800, tDownMs: 1800, label: "Daily", x: 0, y: 0 },
  ];

  it("drops plumbing beats and renumbers what is left", () => {
    // The automatic rules cannot tell a story beat from a plumbing one — both
    // are real presses with real labels — because that distinction lives in the
    // script, not in the recording. Renumbering matters: a line reading 1, 3, 4
    // tells the viewer they missed something.
    const steps = hudSteps(SEGMENTS, COUNTS, FPS, log(beats), 1, TOTAL, [], [
      "open cadence",
    ]);
    assert.deepEqual(
      steps.map((s) => `${s.index} ${s.label}`),
      ["1 Add schedule", "2 Daily"],
    );
  });

  it("matches case-insensitively and on substrings", () => {
    const steps = hudSteps(SEGMENTS, COUNTS, FPS, log(beats), 1, TOTAL, [], [
      "CADENCE",
    ]);
    assert.equal(steps.length, 2);
  });

  it("keeps every beat when the list is empty or blank", () => {
    // A blank entry must not match everything — `"".includes` is always true,
    // which would silently empty the HUD.
    assert.equal(hudSteps(SEGMENTS, COUNTS, FPS, log(beats), 1, TOTAL, [], []).length, 3);
    assert.equal(hudSteps(SEGMENTS, COUNTS, FPS, log(beats), 1, TOTAL, [], [""]).length, 3);
  });
});
