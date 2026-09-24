import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORRECTION_AT,
  GLIDE_MAX_MS,
  GLIDE_MIN_MS,
  glideEase,
  glideTravelMs,
  minJerk,
  planGlide,
  seededRandom,
  TYPE_MEAN_MS,
  typingDelays,
  type GlidePlan,
} from "./humanize";

/** Pointer speed (px/ms) sampled every `dt` ms across a plan. */
function speeds(plan: GlidePlan, dt = 2): number[] {
  const out: number[] = [];
  for (let ms = 0; ms < plan.durationMs; ms += dt) {
    const a = plan.at(ms);
    const b = plan.at(ms + dt);
    out.push(Math.hypot(b.x - a.x, b.y - a.y) / dt);
  }
  return out;
}

const FROM = { x: 100, y: 100 };
const FAR = { x: 1500, y: 700 };

describe("seededRandom", () => {
  it("repeats for a seed and differs across seeds", () => {
    const a = seededRandom("flow#glide3");
    const b = seededRandom("flow#glide3");
    const c = seededRandom("flow#glide4");
    const xs = [a(), a(), a()];
    assert.deepEqual(xs, [b(), b(), b()]);
    assert.notDeepEqual(xs, [c(), c(), c()]);
    for (const x of xs) assert.ok(x >= 0 && x < 1);
  });
});

describe("glideEase", () => {
  it("is minimum-jerk: rests at both ends", () => {
    assert.equal(minJerk(0), 0);
    assert.equal(minJerk(1), 1);
    const v0 = (glideEase(0.01) - glideEase(0)) / 0.01;
    const v1 = (glideEase(1) - glideEase(0.99)) / 0.01;
    assert.ok(v0 < 0.05, `start speed ${v0}`);
    assert.ok(v1 < 0.05, `end speed ${v1}`);
  });

  it("peaks before the midpoint: a longer deceleration than acceleration", () => {
    let peak = 0;
    let at = 0;
    for (let i = 0; i < 1000; i++) {
      const t = i / 1000;
      const v = glideEase(t + 0.001) - glideEase(t);
      if (v > peak) {
        peak = v;
        at = t;
      }
    }
    assert.ok(at > 0.38 && at < 0.46, `peak at ${at}`);
  });
});

describe("glideTravelMs", () => {
  it("times the glide on SCREEN: the recording clock is scaled by the rate", () => {
    assert.ok(Math.abs(glideTravelMs(550, 1) - 1000) < 1e-9);
    assert.ok(Math.abs(glideTravelMs(550, 1.25) - 1250) < 1e-9);
    assert.equal(glideTravelMs(10, 1.25), GLIDE_MIN_MS * 1.25);
    assert.equal(glideTravelMs(5000, 1.25), GLIDE_MAX_MS * 1.25);
  });
});

describe("planGlide", () => {
  it("has a single bell-shaped speed profile on a plain glide", () => {
    const plan = planGlide(FROM, { x: 700, y: 400 }, {
      durationMs: 800,
      rand: seededRandom("bell"),
    });
    const v = speeds(plan);
    const peakAt = v.indexOf(Math.max(...v));
    // Rises to one peak, then falls — no plateau, no second hump.
    for (let i = 1; i <= peakAt; i++)
      assert.ok(v[i] >= v[i - 1] - 1e-6, `dip on the way up at ${i}`);
    for (let i = peakAt + 1; i < v.length; i++)
      assert.ok(v[i] <= v[i - 1] + 1e-6, `bump on the way down at ${i}`);
    assert.ok(v[0] < 0.05 * v[peakAt], "starts from rest");
    assert.ok(v[v.length - 1] < 0.05 * v[peakAt], "arrives at rest");
    // The camera curve this replaced peaked at 0.21 T and crept after it.
    const frac = (peakAt * 2) / plan.durationMs;
    assert.ok(frac > 0.35 && frac < 0.5, `peak at ${frac} T`);
  });

  it("lands exactly on target, overshoot or not", () => {
    for (const overshootPx of [0, 26]) {
      const plan = planGlide(FROM, FAR, {
        durationMs: 1200,
        rand: seededRandom("land"),
        overshootPx,
      });
      assert.deepEqual(plan.at(plan.durationMs), FAR);
    }
  });

  it("overshoots, then corrects without stopping first", () => {
    const d = Math.hypot(FAR.x - FROM.x, FAR.y - FROM.y);
    const ux = (FAR.x - FROM.x) / d;
    const uy = (FAR.y - FROM.y) / d;
    for (const seed of ["a", "b", "c", "d"]) {
      for (const T1 of [700, 1100, 1700]) {
        const plan = planGlide(FROM, FAR, {
          durationMs: T1,
          rand: seededRandom(seed),
          overshootPx: 26,
        });
        let past = 0;
        for (let ms = 0; ms <= plan.durationMs; ms += 2) {
          const p = plan.at(ms);
          past = Math.max(past, (p.x - FAR.x) * ux + (p.y - FAR.y) * uy);
        }
        assert.ok(past > 5, `${seed}/${T1}: no visible overshoot (${past}px)`);

        // The old correction started from zero velocity: the pointer stopped on
        // the overshoot point, then set off again. Through the whole turn —
        // from the correction's launch until it is nearly done — speed must
        // stay clear of zero.
        const v = speeds(plan);
        const peak = Math.max(...v);
        const c0 = CORRECTION_AT * T1;
        const turnEnd = plan.durationMs - 0.25 * (plan.durationMs - c0);
        let min = Infinity;
        for (let ms = 0.5 * T1; ms < turnEnd; ms += 2)
          min = Math.min(min, v[Math.floor(ms / 2)]);
        assert.ok(min > 0.01 * peak, `${seed}/${T1}: dips to ${min / peak} of peak`);
      }
    }
  });

  it("is deterministic for a seed and varies the bow across seeds", () => {
    const mid = (seed: string) =>
      planGlide(FROM, FAR, { durationMs: 1000, rand: seededRandom(seed) }).at(500);
    assert.deepEqual(mid("demo#glide2"), mid("demo#glide2"));
    // Bow side and size are seeded: across seeds the midpoint lands on both
    // sides of the straight line, by different amounts.
    const d = Math.hypot(FAR.x - FROM.x, FAR.y - FROM.y);
    const nx = -(FAR.y - FROM.y) / d;
    const ny = (FAR.x - FROM.x) / d;
    const offs = Array.from({ length: 16 }, (_, i) => {
      const p = mid(`s${i}`);
      return (p.x - FROM.x) * nx + (p.y - FROM.y) * ny;
    });
    assert.ok(offs.some((o) => o > 0) && offs.some((o) => o < 0), "one side only");
    const mags = new Set(offs.map((o) => Math.round(Math.abs(o))));
    assert.ok(mags.size > 8, "bow is a constant fraction");
  });

  it("keeps the overshoot inside the viewport", () => {
    const edge = { x: 1915, y: 540 };
    const plan = planGlide({ x: 200, y: 540 }, edge, {
      durationMs: 1000,
      rand: seededRandom("edge"),
      overshootPx: 26,
      bounds: { width: 1920, height: 1080 },
    });
    for (let ms = 0; ms <= plan.durationMs; ms += 5)
      assert.ok(plan.at(ms).x <= 1919 + 1e-6);
  });
});

describe("typingDelays", () => {
  const TEXT = "Answer the message in one line, then stop.";

  it("keeps the beat's length: sums to length x mean", () => {
    const d = typingDelays(TEXT, seededRandom("t"));
    const sum = d.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - TEXT.length * TYPE_MEAN_MS) < 1e-6);
    assert.equal(d.length, TEXT.length);
  });

  it("is not a metronome, and pauses at word boundaries", () => {
    const d = typingDelays(TEXT, seededRandom("t"));
    assert.ok(new Set(d.map((x) => Math.round(x))).size > 8, "every key the same");
    const starts: number[] = [];
    const inside: number[] = [];
    [...TEXT].forEach((ch, i) => {
      if (i > 0 && TEXT[i - 1] === " " && ch !== " ") starts.push(d[i]);
      else inside.push(d[i]);
    });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(mean(starts) > 2 * mean(inside), "no reach for the next word");
  });

  it("is deterministic for a seed", () => {
    assert.deepEqual(
      typingDelays(TEXT, seededRandom("x")),
      typingDelays(TEXT, seededRandom("x")),
    );
    assert.deepEqual(typingDelays("", seededRandom("x")), []);
  });
});
