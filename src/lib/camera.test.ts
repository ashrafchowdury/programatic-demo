import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_POSE,
  cameraEase,
  carryProgress,
  interpolatePose,
  interpolateVia,
  moveDuration,
  panLimit,
  poseToCss,
} from "./camera";

describe("cameraEase", () => {
  it("keeps the measured Screen Studio-style tail", () => {
    // Doc 1 stacked 12 moves: progress ≈ 0.890 at 0.50 T, settling late and
    // slowly. The reference's 0.190 at 0.10 T is NOT kept — see the next test.
    assert.ok(
      Math.abs(cameraEase(0.5) - 0.89) < 0.06,
      `0.50T = ${cameraEase(0.5)}`,
    );
    assert.ok(cameraEase(0.7) > 0.94, `0.70T = ${cameraEase(0.7)}`);
    assert.ok(cameraEase(0) === 0);
    assert.ok(cameraEase(1) === 1);
  });

  it("starts from rest: slope ~0 at t = 0", () => {
    // The old curve started at slope 1.0 — full average speed on frame one,
    // which read as a lurch and smeared the first frame into stacked copies.
    const slope0 = cameraEase(1e-4) / 1e-4;
    assert.ok(slope0 < 0.02, `start slope ${slope0}`);
    // And the first frame of a typical 17-frame move covers a small share of
    // what the fastest frame does.
    let peak = 0;
    for (let i = 0; i < 17; i++) {
      peak = Math.max(peak, cameraEase((i + 1) / 17) - cameraEase(i / 17));
    }
    const first = cameraEase(1 / 17) / peak;
    assert.ok(first < 0.15, `first frame at ${(first * 100).toFixed(0)}% of peak`);
  });

  it("peaks early and decelerates for the rest of the move", () => {
    let peakAt = 0;
    let peak = 0;
    for (let i = 0; i < 1000; i++) {
      const v = cameraEase((i + 1) / 1000) - cameraEase(i / 1000);
      if (v > peak) {
        peak = v;
        peakAt = i / 1000;
      }
    }
    assert.ok(peakAt > 0.1 && peakAt < 0.3, `peak at ${peakAt}`);
    // Ends at rest too.
    const slope1 = (1 - cameraEase(1 - 1e-4)) / 1e-4;
    assert.ok(slope1 < 0.02, `end slope ${slope1}`);
  });
});

describe("interpolatePose", () => {
  // Screen position of content point p under pose (fit cancels; see frameFor).
  const screenX = (pose: { scale: number; cx: number }, p: number) =>
    (p - pose.cx) * pose.scale;

  it("keeps the punched-at subject still for the whole move", () => {
    // A punch from base about p = 0.85: frameFor puts cx at p - (p - 0.5) / S.
    // Linear mixing only held p still at the endpoints and swung it out and
    // back in between; the move must hold it at every frame.
    const p = 0.85;
    const a = { scale: 1, cx: 0.5, cy: 0.5 };
    const b = { scale: 1.74, cx: p - (p - 0.5) / 1.74, cy: 0.5 };
    const start = screenX(a, p);
    for (let i = 0; i <= 20; i++) {
      const pose = interpolatePose(a, b, i / 20);
      assert.ok(
        Math.abs(screenX(pose, p) - start) < 1e-9,
        `subject drifted at ${i / 20}: ${screenX(pose, p) - start}`,
      );
    }
  });

  it("moves scale in log space", () => {
    const a = { scale: 1, cx: 0.5, cy: 0.5 };
    const b = { scale: 2, cx: 0.5, cy: 0.5 };
    // Halfway in PROGRESS is the geometric mean in scale.
    let t = 0.5;
    for (let i = 0; i < 60; i++) {
      // invert the easing so progress = 0.5 exactly
      t += (0.5 - cameraEase(t)) * 0.5;
    }
    assert.ok(Math.abs(interpolatePose(a, b, t).scale - Math.SQRT2) < 1e-6);
  });

  it("mixes the focal point linearly on a pure pan", () => {
    const a = { scale: 1.5, cx: 0.4, cy: 0.3 };
    const b = { scale: 1.5, cx: 0.6, cy: 0.7 };
    const mid = interpolatePose(a, b, 0.5);
    const p = cameraEase(0.5);
    assert.ok(Math.abs(mid.scale - 1.5) < 1e-12);
    assert.ok(Math.abs((mid.cx - 0.4) / 0.2 - p) < 1e-9);
    assert.ok(Math.abs((mid.cy - 0.3) / 0.4 - p) < 1e-9);
  });

  it("never leaves the pan clamp between two poses inside it", () => {
    // The bound is linear in 1/S and the path is a line in (C, 1/S), so the
    // render-time clamp can never engage mid-move (the D2 swerve).
    const a = { scale: 1, cx: 0.5, cy: 0.5 };
    const b = { scale: 1.74, cx: 0.5 + panLimit(1.74), cy: 0.5 - panLimit(1.74) };
    for (let i = 0; i <= 50; i++) {
      const pose = interpolatePose(a, b, i / 50);
      const lim = panLimit(pose.scale);
      assert.ok(Math.abs(pose.cx - 0.5) <= lim + 1e-12, `cx out at ${i}`);
      assert.ok(Math.abs(pose.cy - 0.5) <= lim + 1e-12, `cy out at ${i}`);
    }
  });
});

describe("carryProgress", () => {
  const slope = (u: number, s: { from: number; to: number }) =>
    (carryProgress(u + 1e-6, s) - carryProgress(u - 1e-6, s)) / 2e-6;

  it("runs 0 to 1 with the slopes it was asked for", () => {
    const s = { from: 0, to: 1.2 };
    assert.equal(carryProgress(0, s), 0);
    assert.ok(Math.abs(carryProgress(1, s) - 1) < 1e-12);
    assert.ok(Math.abs(slope(1e-5, s)) < 1e-3);
    assert.ok(Math.abs(slope(1 - 1e-5, s) - 1.2) < 1e-3);
  });

  it("is monotone for every slope pair under 2", () => {
    for (const from of [0, 0.5, 1, 1.99])
      for (const to of [0, 0.5, 1, 1.99]) {
        let last = 0;
        for (let u = 0; u <= 1; u += 0.01) {
          const e = carryProgress(u, { from, to });
          assert.ok(e >= last - 1e-12 && e <= 1 + 1e-12, `${from},${to} @${u}`);
          last = e;
        }
      }
  });

  it("is only used when asked: interpolatePose keeps CAMERA_BEZIER otherwise", () => {
    const a = { scale: 1.4, cx: 0.45, cy: 0.5 };
    const b = { scale: 1.4, cx: 0.55, cy: 0.5 };
    assert.deepEqual(interpolatePose(a, b, 0.3), interpolatePose(a, b, 0.3, undefined));
    assert.notDeepEqual(
      interpolatePose(a, b, 0.3),
      interpolatePose(a, b, 0.3, { from: 0, to: 1 }),
    );
  });
});

describe("interpolateVia", () => {
  const a = { scale: 1.6, cx: 0.32, cy: 0.35 };
  const b = { scale: 1.6, cx: 0.68, cy: 0.62 };

  it("hits both ends and dips through a middle scale, never to base", () => {
    assert.deepEqual(interpolateVia(a, BASE_POSE, b, 0), a);
    const end = interpolateVia(a, BASE_POSE, b, 1);
    assert.ok(Math.abs(end.scale - b.scale) < 1e-9 && Math.abs(end.cx - b.cx) < 1e-9);
    let min = Infinity;
    for (let i = 0; i <= 100; i++) {
      min = Math.min(min, interpolateVia(a, BASE_POSE, b, i / 100).scale);
    }
    assert.ok(min > 1.1 && min < 1.35, `dipped to ${min}`);
  });

  it("carries its speed through the middle instead of stopping", () => {
    // Two moves via base stop dead at base; one bent move does not.
    const at = (t: number) => interpolateVia(a, BASE_POSE, b, t).cx;
    const midSpeed = (at(0.26) - at(0.24)) / 0.02;
    assert.ok(midSpeed > 0.3, `speed through the middle ${midSpeed}`);
    // …and still starts from rest.
    assert.ok(Math.abs(at(1e-4) - a.cx) / 1e-4 < 0.02);
  });

  it("stays inside the pan clamp", () => {
    for (let i = 0; i <= 100; i++) {
      const pose = interpolateVia(a, BASE_POSE, b, i / 100);
      const lim = panLimit(pose.scale);
      assert.ok(Math.abs(pose.cx - 0.5) <= lim + 1e-12, `cx out at ${i}`);
      assert.ok(Math.abs(pose.cy - 0.5) <= lim + 1e-12, `cy out at ${i}`);
    }
  });
});

describe("poseToCss", () => {
  it("is the identity at base scale", () => {
    const css = poseToCss(BASE_POSE, 0);
    assert.equal(css.scale, 1);
    assert.equal(css.translateX, 0);
    assert.equal(css.translateY, 0);
  });

  it("remaps content Y into the window group when chrome is present", () => {
    const noChrome = poseToCss({ scale: 1.5, cx: 0.5, cy: 0.5 }, 0);
    const chrome = poseToCss({ scale: 1.5, cx: 0.5, cy: 0.5 }, 0.1);
    assert.notEqual(noChrome.translateY, chrome.translateY);
  });

  it("applies the base fit to scale and translate together", () => {
    // cx 0.4 sits inside the edge clamp at this scale (half = 1/3), so it
    // survives untouched and the arithmetic is checkable.
    const css = poseToCss({ scale: 1.5, cx: 0.4, cy: 0.4 }, 0, 0.9);
    assert.ok(Math.abs(css.scale - 1.35) < 1e-9);
    // Translate must carry the same effective scale, or the framed point drifts.
    assert.ok(Math.abs(css.translateX - 1.35 * (0.5 - 0.4)) < 1e-9);
  });

  it("stays continuous as a zoom-out passes through base scale", () => {
    // Regression: expressing pan as a transform-origin needs (0.5 - C*S)/(1 - S),
    // which blows up at S = 1. The last frames of every zoom-out mis-framed
    // against a clamp and then snapped, which read as a shake.
    let prev = poseToCss({ scale: 1.6, cx: 0.35, cy: 0.62 }, 0.034, 0.9);
    for (let i = 1; i <= 200; i++) {
      const S = 1.6 - (0.6 * i) / 200;
      const css = poseToCss({ scale: S, cx: 0.35, cy: 0.62 }, 0.034, 0.9);
      assert.ok(Number.isFinite(css.translateX) && Number.isFinite(css.translateY));
      // No step may exceed a few times the average, i.e. no snap.
      assert.ok(
        Math.abs(css.translateX - prev.translateX) < 0.01,
        `translateX snapped at scale ${S}: ${prev.translateX} -> ${css.translateX}`,
      );
      assert.ok(
        Math.abs(css.translateY - prev.translateY) < 0.01,
        `translateY snapped at scale ${S}: ${prev.translateY} -> ${css.translateY}`,
      );
      prev = css;
    }
    assert.equal(prev.translateX, 0);
    assert.equal(prev.translateY, 0);
  });
});

describe("moveDuration", () => {
  const vp = { width: 1920, height: 1080 };

  it("scales with displacement and keeps zoom-out longer than zoom-in", () => {
    const from = BASE_POSE;
    const to = { scale: 1.55, cx: 0.35, cy: 0.4 };
    const inn = moveDuration(from, to, "in", vp);
    const out = moveDuration(to, from, "out", vp);
    const tiny = moveDuration(
      from,
      { scale: 1.15, cx: 0.5, cy: 0.48 },
      "in",
      vp,
    );
    assert.ok(out > inn, `${out} should be > ${inn}`);
    assert.ok(inn >= 0.55 && inn <= 1.25);
    assert.ok(tiny < inn);
  });
});
