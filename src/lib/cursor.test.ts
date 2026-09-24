import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURSOR_FADE_S,
  HAND_HOLD_S,
  type ClickEvent,
  type CursorSample,
} from "./click-log";
import { cursorAt, cursorKind, cursorOpacity, samplePath } from "./cursor";

const track: CursorSample[] = [
  { t: 0, x: 100, y: 100 },
  { t: 500, x: 300, y: 200 },
  { t: 1000, x: 500, y: 400 },
];

describe("samplePath", () => {
  it("holds the ends outside the recorded range", () => {
    assert.deepEqual(samplePath(track, -5), { x: 100, y: 100 });
    assert.deepEqual(samplePath(track, 99), { x: 500, y: 400 });
  });

  it("interpolates between samples", () => {
    assert.deepEqual(samplePath(track, 0.25), { x: 200, y: 150 });
    assert.deepEqual(samplePath(track, 0.75), { x: 400, y: 300 });
  });

  it("returns null for an empty track", () => {
    assert.equal(samplePath([], 1), null);
  });
});

describe("cursorAt", () => {
  it("holds perfectly still between glides", () => {
    // No idle tremor: the reference cursors do not wobble, and a synthetic one
    // reads as a bug. Past the end of the track the pointer must not move.
    const first = cursorAt(track, [], 2)!;
    for (let f = 1; f < 60; f++) {
      const s = cursorAt(track, [], 2 + f / 30)!;
      assert.equal(s.x, first.x);
      assert.equal(s.y, first.y);
    }
  });

  it("is deterministic", () => {
    const a = cursorAt(track, [], 2.5)!;
    const b = cursorAt(track, [], 2.5)!;
    assert.deepEqual(a, b);
  });

  it("ripples and squashes on mousedown, not on focus beats", () => {
    const clicks = [
      { tMs: 600, x: 300, y: 200, tDownMs: 500 },
      { tMs: 900, x: 400, y: 300 }, // focus beat: no tDownMs, no ripple
    ];
    const during = cursorAt(track, clicks, 0.55)!;
    assert.ok(during.ripple !== null && during.ripple > 0);
    assert.ok(during.squash < 1, "no squash on mousedown");

    const after = cursorAt(track, clicks, 1.2)!;
    assert.equal(after.ripple, null);
    assert.equal(after.squash, 1);

    // The focus beat at 900ms must not have produced its own ripple.
    assert.equal(cursorAt(track, clicks, 0.95)!.ripple, null);
  });

  it("returns null when there is no recorded track", () => {
    assert.equal(cursorAt([], [], 1), null);
  });
});

describe("cursorOpacity", () => {
  // typeInto beat: clicked at 500ms, finished typing at 3000ms.
  const typing = [{ tMs: 500, x: 300, y: 200, tDownMs: 450, typeEndMs: 3000 }];

  it("hides the arrow while the app's text caret is up", () => {
    assert.equal(cursorOpacity(typing, 1.5), 0);
    assert.equal(cursorOpacity(typing, 2.9), 0);
  });

  it("is fully visible well outside the typing window", () => {
    assert.equal(cursorOpacity(typing, 0.1), 1);
    assert.equal(cursorOpacity(typing, 4.0), 1);
  });

  it("fades rather than pops at both edges", () => {
    const out = cursorOpacity(typing, 0.45 + CURSOR_FADE_S / 2);
    const back = cursorOpacity(typing, 3.0 + CURSOR_FADE_S / 2);
    for (const v of [out, back]) {
      assert.ok(v > 0 && v < 1, `expected a partial fade, got ${v}`);
    }
  });

  it("starts the fade at the press, not before it", () => {
    // Pressed at 450ms: the arrow is whole until then and gone one fade later.
    assert.equal(cursorOpacity(typing, 0.44), 1);
    assert.equal(cursorOpacity(typing, 0.45), 1);
    assert.ok(cursorOpacity(typing, 0.45 + CURSOR_FADE_S) < 1e-9);
  });

  it("falls back to tMs for a typing beat logged without a press", () => {
    const old = [{ tMs: 500, x: 1, y: 1, typeEndMs: 3000 }];
    assert.equal(cursorOpacity(old, 0.5), 1);
    assert.ok(cursorOpacity(old, 0.5 + CURSOR_FADE_S) < 1e-9);
  });

  it("leaves plain clicks alone", () => {
    const clicks = [{ tMs: 500, x: 1, y: 1, tDownMs: 450 }];
    assert.equal(cursorOpacity(clicks, 0.5), 1);
  });
});

describe("cursorKind", () => {
  // The hand tracks real hover: pointer while inside a clickable element's box,
  // arrow otherwise. The subtlety is the interaction WINDOW — a rect is only
  // hoverable while its element is on screen (tDepartMs until just after the
  // press), so a since-closed menu's stale box does not relight the hand as the
  // pointer passes back over that spot.
  const rect = { x: 100, y: 100, w: 120, h: 40 };
  const inside = { x: 150, y: 120 };
  const outside = { x: 600, y: 600 };
  // Window: [tDepartMs/1000, tDownMs/1000 + HAND_HOLD_S] = [1.5, 2.0 + HOLD].
  const click: ClickEvent = {
    tMs: 2000,
    tDepartMs: 1500,
    tDownMs: 2000,
    x: 150,
    y: 120,
    rect,
  };

  it("is a hand while hovering the control before the press", () => {
    assert.equal(cursorKind([click], 1.7, inside), "pointer");
  });

  it("is an arrow when the pointer is off the control but still in-window", () => {
    assert.equal(cursorKind([click], 1.7, outside), "arrow");
  });

  it("does not relight over a stale rect once the element is gone", () => {
    const afterWindow = 2000 / 1000 + HAND_HOLD_S + 0.5;
    assert.equal(cursorKind([click], afterWindow, inside), "arrow");
  });

  it("never shows a hand on a typing beat, even hovering its box", () => {
    const type: ClickEvent = { ...click, typeEndMs: 5000 };
    assert.equal(cursorKind([type], 1.7, inside), "arrow");
  });

  it("falls back to the window alone when a click carries no rect", () => {
    const noRect: ClickEvent = { tMs: 2000, tDepartMs: 1500, tDownMs: 2000, x: 0, y: 0 };
    assert.equal(cursorKind([noRect], 1.7, outside), "pointer");
    assert.equal(cursorKind([noRect], 5.0, inside), "arrow");
  });
});

describe("pointer timing on the screen clock", () => {
  // tS is the log's clock, which a render replays at `speed`; every window is
  // a screen duration, so on the log clock it must be `speed` times longer.
  const clicks: ClickEvent[] = [{ tMs: 600, x: 300, y: 200, tDownMs: 500 }];

  it("stretches the ripple and squash by the speed", () => {
    // RIPPLE_S (0.35) on screen is 0.4375 s of log time at 1.25x.
    assert.equal(cursorAt(track, clicks, 0.5 + 0.4, 1)!.ripple, null);
    const at125 = cursorAt(track, clicks, 0.5 + 0.4, 1.25)!;
    assert.ok(at125.ripple !== null && Math.abs(at125.ripple - 0.4 / 0.4375) < 1e-9);
    // Same screen instant, same progress, whatever the speed.
    const r1 = cursorAt(track, clicks, 0.5 + 0.1, 1)!.ripple!;
    const r15 = cursorAt(track, clicks, 0.5 + 0.15, 1.5)!.ripple!;
    assert.ok(Math.abs(r1 - r15) < 1e-9);
    // Squash (0.12 s) is over at 0.13 s realtime, still on at 1.25x.
    assert.equal(cursorAt(track, clicks, 0.5 + 0.13, 1)!.squash, 1);
    assert.ok(cursorAt(track, clicks, 0.5 + 0.13, 1.25)!.squash < 1);
  });

  it("stretches the caret fade by the speed", () => {
    const typing: ClickEvent[] = [
      { tMs: 500, x: 0, y: 0, tDownMs: 450, typeEndMs: 3000 },
    ];
    const speed = 1.25;
    const halfway = 0.45 + (CURSOR_FADE_S * speed) / 2;
    assert.ok(Math.abs(cursorOpacity(typing, halfway, speed) - 0.5) < 1e-9);
    assert.ok(cursorOpacity(typing, 0.45 + CURSOR_FADE_S, speed) > 0.1);
    assert.ok(cursorOpacity(typing, 0.45 + CURSOR_FADE_S * speed, speed) < 1e-9);
  });

  it("stretches the fallback hand window by the speed", () => {
    const noRect: ClickEvent = { tMs: 1600, x: 0, y: 0, tDownMs: 1500 };
    const past = 1.5 + HAND_HOLD_S + 0.02;
    assert.equal(cursorKind([noRect], past, { x: 0, y: 0 }, 1), "arrow");
    assert.equal(cursorKind([noRect], past, { x: 0, y: 0 }, 1.25), "pointer");
  });
});
