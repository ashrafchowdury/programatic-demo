import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nearestOnset, onsetTimes, snapCardCuts } from "./beats";

/** A 22.05 kHz signal: quiet noise with a 30 ms decaying burst at each `at`. */
function clicks(at: number[], lengthS: number, rate = 22050): Float32Array {
  const x = new Float32Array(Math.round(lengthS * rate));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.002;
  for (const t of at)
    for (let i = 0; i < 0.03 * rate; i++) {
      const k = Math.round(t * rate) + i;
      if (k < x.length) x[k] += rnd() * 0.8 * Math.exp(-i / (0.008 * rate));
    }
  return x;
}

describe("onsetTimes (R9)", () => {
  it("finds every hit of a steady beat to within a hop", () => {
    // 113 bpm, the tempo public/audio/intro.mp3 measures at (0.531 s apart).
    const at = Array.from({ length: 8 }, (_, i) => 0.3 + i * 0.531);
    const found = onsetTimes(clicks(at, 5), 22050);
    assert.equal(found.length, at.length, found.join(" "));
    found.forEach((t, i) => assert.ok(Math.abs(t - at[i]) <= 0.02, `${t} vs ${at[i]}`));
  });

  it("finds nothing in steady noise or silence", () => {
    assert.deepEqual(onsetTimes(clicks([], 3), 22050), []);
    assert.deepEqual(onsetTimes(new Float32Array(22050), 22050), []);
  });
});

describe("snapCardCuts (R9)", () => {
  // card 30f, clip 60f, card 30f, clip 60f at 30 fps — cuts at 1.0, 3.0, 4.0, 6.0.
  const counts = [30, 60, 30, 60];
  const isCard = (i: number) => i % 2 === 0;

  it("nudges each card by at most 2 frames onto the nearest onset", () => {
    // A beat 2f after the first cut (1.0 -> 1.066) and one at 4.0, which the
    // first nudge has pushed the second cut 2f past (4.066) — both reachable.
    const { counts: out, cuts } = snapCardCuts(isCard, counts, [], 30, () => [1.066, 4.0]);
    assert.deepEqual(out, [32, 60, 28, 60]);
    assert.deepEqual(cuts.map((c) => c.nudgeF), [2, -2]);
    for (const c of cuts) assert.ok(Math.abs(c.offF!) <= 0.5, JSON.stringify(c));
  });

  it("leaves a card alone when the nearest beat is out of reach", () => {
    const { counts: out, cuts } = snapCardCuts(isCard, counts, [], 30, () => [1.5]);
    assert.deepEqual(out.slice(0, 1), [30]);
    assert.ok(Math.abs(cuts[0].offF! - -15) < 1e-9);
  });

  it("measures a blended cut from the middle of its join, and asks canNudge", () => {
    // A 6-frame overlap after card 0: the cut reads at start(1) + 3f = 0.9 s.
    const { cuts } = snapCardCuts(isCard, counts, [6, 0, 0], 30, () => [0.9], () => false);
    assert.equal(cuts[0].nudgeF, 0);
    assert.ok(Math.abs(cuts[0].cutS - 0.9) < 1e-9);
  });

  it("re-places the onsets after every nudge, for an anchored bed", () => {
    // A bed placed relative to segment 2 moves with card 0's nudge: card 0
    // reaches its beat at 1.05 by +2f, and card 2 then sees segment 2 start
    // at 92f, not 90.
    const seen: number[] = [];
    snapCardCuts(isCard, counts, [], 30, (b) => (seen.push(b.startS[2]), [b.startS[2] - 1.95]));
    assert.deepEqual(seen.map((s) => Math.round(s * 30)), [90, 92]);
  });
});

describe("nearestOnset", () => {
  it("picks the closest, and null for none", () => {
    assert.equal(nearestOnset([1, 2, 3], 2.4), 2);
    assert.equal(nearestOnset([], 1), null);
  });
});
