import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chordGlyphs, type KeyEvent } from "./click-log";
import { KEYCAP_HOLD_S, keycapAt } from "../KeycapHUD";

describe("chordGlyphs", () => {
  it("renders the reference's own chord", () => {
    assert.equal(chordGlyphs("Alt+Enter"), "⌥⏎");
  });

  it("keeps modifier order as authored, so it reads like the app's hint", () => {
    assert.equal(chordGlyphs("Meta+Shift+K"), "⌘⇧K");
  });

  it("upper-cases a bare letter and passes through unknown names", () => {
    assert.equal(chordGlyphs("k"), "K");
    assert.equal(chordGlyphs("F5"), "F5");
  });

  it("tolerates spacing around the plus", () => {
    assert.equal(chordGlyphs("Alt + Enter"), "⌥⏎");
  });
});

describe("keycapAt", () => {
  const keys: KeyEvent[] = [
    { tMs: 1000, chord: "Alt+Enter" },
    { tMs: 4000, chord: "Meta+K" },
  ];

  it("shows nothing before the first press", () => {
    assert.equal(keycapAt(keys, 0.5), null);
  });

  it("shows a chord for its hold window and then stops", () => {
    assert.equal(keycapAt(keys, 1.2)?.chord, "Alt+Enter");
    assert.equal(keycapAt(keys, 1 + KEYCAP_HOLD_S - 0.01)?.chord, "Alt+Enter");
    assert.equal(keycapAt(keys, 1 + KEYCAP_HOLD_S + 0.01), null);
  });

  it("replaces rather than stacks when chords overlap", () => {
    const fast: KeyEvent[] = [
      { tMs: 1000, chord: "Alt+Enter" },
      { tMs: 1200, chord: "Meta+K" },
    ];
    assert.equal(keycapAt(fast, 1.3)?.chord, "Meta+K");
  });

  it("ramps in at the start and out at the end of the window", () => {
    const first = keycapAt(keys, 1.001);
    assert.ok(first && first.inP < 0.2, "just-pressed should be arriving");
    const last = keycapAt(keys, 1 + KEYCAP_HOLD_S - 0.01);
    assert.ok(last && last.outP < 0.2, "about to expire should be leaving");
    const mid = keycapAt(keys, 1.5);
    assert.ok(mid && mid.inP === 1 && mid.outP === 1, "mid-hold is fully up");
  });
});
