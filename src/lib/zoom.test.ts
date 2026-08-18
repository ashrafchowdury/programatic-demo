import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_POSE, posesNearlyEqual } from "./camera";
import type { ClickLog } from "./click-log";
import {
  buildCameraTrack,
  clusterize,
  frameFor,
  sampleTrack,
  stickify,
  zoomAt,
} from "./zoom";

const VP = { width: 1920, height: 1080 };

const smokeLog: ClickLog = {
  name: "smoke",
  viewport: VP,
  durationMs: 11561,
  offsetMs: 0,
  clicks: [
    {
      label: "Open priority",
      tMs: 2603,
      tDepartMs: 1800,
      x: 533,
      y: 302,
      rect: { x: 491, y: 289, w: 83, h: 25 },
      cluster: "priority",
    },
    {
      label: "Select High",
      tMs: 4338,
      tDepartMs: 3600,
      x: 571,
      y: 417,
      rect: { x: 498, y: 399, w: 146, h: 36 },
      cluster: "priority",
    },
    {
      label: "Mark week complete",
      tMs: 6854,
      tDepartMs: 6000,
      x: 558,
      y: 612,
      rect: { x: 458, y: 589, w: 200, h: 46 },
      cluster: "done",
    },
  ],
};

const skillsmpLike: ClickLog = {
  name: "skillsmp",
  viewport: VP,
  durationMs: 23325,
  clicks: [
    { tMs: 8073, x: 502, y: 466, cluster: "language" },
    { tMs: 9342, x: 559, y: 586, cluster: "language" },
    { tMs: 11220, x: 502, y: 630, cluster: "domain" },
    { tMs: 12401, x: 503, y: 713, cluster: "domain" },
    { tMs: 14229, x: 502, y: 710, cluster: "category" },
    { tMs: 18041, x: 1122, y: 505, cluster: "payoff" },
  ],
};

describe("stickify", () => {
  it("never merges different explicit cluster ids", () => {
    const groups = clusterize(skillsmpLike.clicks, VP);
    const stuck = stickify(groups, VP);
    assert.equal(stuck.length, 4);
    assert.deepEqual(
      stuck.map((g) => g[0].cluster),
      ["language", "domain", "category", "payoff"],
    );
  });
});

describe("clusterize", () => {
  it("splits one cluster id when its targets are far apart", () => {
    // agent-demo's real defect: a tour-inferred id spanning the model dropdown
    // (top left) and the composer (bottom right).
    const groups = clusterize(
      [
        { tMs: 1000, x: 702, y: 314, cluster: "c1" },
        { tMs: 4000, x: 1308, y: 991, cluster: "c1" },
        { tMs: 6000, x: 1400, y: 1010, cluster: "c1" },
      ],
      VP,
    );
    assert.equal(groups.length, 2, "far-apart targets stayed in one cluster");
    assert.equal(groups[0].length, 1);
    assert.equal(groups[1].length, 2);
  });

  it("keeps a cluster together when its targets are close", () => {
    const groups = clusterize(
      [
        { tMs: 1000, x: 476, y: 159, cluster: "c0" },
        { tMs: 3000, x: 557, y: 236, cluster: "c0" },
      ],
      VP,
    );
    assert.equal(groups.length, 1);
  });
});

describe("frameFor", () => {
  it("does not dead-center the subject", () => {
    const pose = frameFor(
      { tMs: 0, x: 1600, y: 800, rect: { x: 1500, y: 760, w: 200, h: 80 } },
      VP,
      1.6,
    );
    assert.ok(pose.scale >= 1.22 && pose.scale <= 1.6);
    assert.notEqual(Math.round(pose.cx * 100), Math.round((1600 / 1920) * 100));
  });
});

describe("buildCameraTrack", () => {
  it("starts at base and returns to base before the cut", () => {
    const keys = buildCameraTrack(smokeLog);
    assert.equal(keys[0].pose.scale, BASE_POSE.scale);
    const last = keys[keys.length - 1];
    assert.ok(Math.abs(last.t - smokeLog.durationMs / 1000) < 0.05);
    // All four reference clips end at base scale — the highest-confidence
    // finding in the analysis. Never cut while still zoomed in.
    assert.equal(last.pose.scale, BASE_POSE.scale);
    assert.equal(last.pose.cx, BASE_POSE.cx);
  });

  it("holds still at base for a beat before the cut", () => {
    const keys = buildCameraTrack(smokeLog);
    const end = smokeLog.durationMs / 1000;
    const a = sampleTrack(keys, end - 0.3);
    const b = sampleTrack(keys, end);
    assert.equal(a.scale, BASE_POSE.scale);
    assert.equal(b.scale, BASE_POSE.scale);
  });

  it("routes through base instead of panning across the screen", () => {
    // Two clicks in one cluster at opposite corners: the real defect from
    // agent-demo's c1, where the camera swept ~790px in ~620ms.
    const keys = buildCameraTrack({
      name: "wide",
      viewport: VP,
      durationMs: 16000,
      clicks: [
        {
          tMs: 3000,
          tDepartMs: 2000,
          x: 300,
          y: 200,
          rect: { x: 240, y: 170, w: 200, h: 60 },
          cluster: "one",
        },
        {
          tMs: 9000,
          tDepartMs: 8000,
          x: 1700,
          y: 980,
          rect: { x: 1600, y: 950, w: 200, h: 60 },
          cluster: "one",
        },
      ],
    });
    // Between the two beats the camera must pass through base scale.
    const between = keys.filter((k) => k.t > 3 && k.t < 9);
    assert.ok(
      between.some((k) => Math.abs(k.pose.scale - BASE_POSE.scale) < 1e-6),
      "camera panned across the screen instead of pulling back to base",
    );
  });

  it("routes through base between distant clusters even with no room to trail", () => {
    // agent-instructions' real defect: Save (bottom right) then a header (top
    // left) in separate clusters, with the next lead arriving before the
    // minimum hold expires. The old code fell through to a direct pan and swept
    // ~790px across the screen at 1.6x.
    const keys = buildCameraTrack(
      {
        name: "far",
        viewport: VP,
        durationMs: 24000,
        clicks: [
          {
            tMs: 16700,
            tDepartMs: 13350,
            x: 1870,
            y: 1050,
            rect: { x: 1816, y: 1014, w: 112, h: 72 },
            cluster: "save",
          },
          {
            tMs: 21470,
            tDepartMs: 18180,
            x: 320,
            y: 148,
            rect: { x: 249, y: 112, w: 151, h: 72 },
            cluster: "payoff",
          },
        ],
      },
      1.25,
    );
    const between = keys.filter((k) => k.t > 13.5 && k.t < 18.2);
    assert.ok(
      between.some((k) => Math.abs(k.pose.scale - BASE_POSE.scale) < 1e-6),
      "camera swept between clusters instead of pulling back to base",
    );
  });

  it("scales move durations so they land right on screen at speed", () => {
    const fast = buildCameraTrack(smokeLog, 1.25);
    const real = buildCameraTrack(smokeLog, 1);
    const firstMove = (keys: typeof fast) => {
      const i = keys.findIndex((k, n) => n > 0 && k.pose.scale > 1.05);
      return keys[i].t - keys[i - 1].t;
    };
    // The log clock is replayed at `speed`, so a move must be `speed` times
    // longer on that clock to occupy the same wall-clock time on screen.
    const ratio = firstMove(fast) / firstMove(real);
    assert.ok(
      Math.abs(ratio - 1.25) < 0.02,
      `expected 1.25x log-time duration at 1.25x speed, got ${ratio}`,
    );
    // And the on-screen result must sit in the measured 750-1250 ms window.
    const onScreenMs = (firstMove(fast) / 1.25) * 1000;
    assert.ok(
      onScreenMs >= 550 && onScreenMs <= 1250,
      `on-screen zoom-in ${onScreenMs.toFixed(0)}ms outside the reference window`,
    );
  });

  it("holds still after the last click of a cluster", () => {
    const keys = buildCameraTrack(smokeLog);
    const holdStart = 4338 / 1000 + 0.9;
    const holdEnd = 4338 / 1000 + 1.25;
    const a = sampleTrack(keys, holdStart);
    const b = sampleTrack(keys, holdEnd);
    assert.ok(
      Math.abs(a.scale - b.scale) < 0.01,
      `hold drifted ${a.scale} → ${b.scale}`,
    );
    assert.ok(Math.abs(a.cx - b.cx) < 0.01);
  });

  it("starts the first punch near cursor departure, not after the click", () => {
    const keys = buildCameraTrack(smokeLog);
    const onset = keys.find(
      (k) => k.t > 0.05 && Math.abs(k.pose.scale - 1) < 0.02,
    );
    assert.ok(onset);
    assert.ok(onset.t < 2.0, `camera onset at ${onset.t}s, click is 2.603s`);
    assert.ok(onset.t > 1.4, `camera moved too early: ${onset.t}`);
  });

  it("returns a constant pose when there are no zoomable clicks", () => {
    const keys = buildCameraTrack({
      name: "empty",
      viewport: VP,
      durationMs: 4000,
      clicks: [{ tMs: 500, x: 10, y: 10, zoom: false }],
    });
    const a = sampleTrack(keys, 0.2);
    const b = sampleTrack(keys, 3.5);
    assert.equal(a.scale, 1);
    assert.equal(b.scale, 1);
  });
});

describe("zoomAt", () => {
  it("has no origin discontinuity larger than 3% on a single frame during a hold", () => {
    const fps = 30;
    const start = Math.round(4.4 * fps);
    const end = Math.round(5.4 * fps);
    for (let f = start; f < end; f++) {
      const a = zoomAt(f, fps, smokeLog);
      const b = zoomAt(f + 1, fps, smokeLog);
      assert.ok(
        Math.abs(a.translateX - b.translateX) < 0.03,
        `translateX jump at frame ${f}`,
      );
      assert.ok(
        Math.abs(a.translateY - b.translateY) < 0.03,
        `translateY jump at frame ${f}`,
      );
    }
  });
});

describe("typing beats", () => {
  /** One click that types for 4s — the shape of a "write instructions" beat. */
  const typingLog: ClickLog = {
    name: "typing",
    viewport: VP,
    durationMs: 12000,
    offsetMs: 0,
    clicks: [
      {
        label: "write",
        tMs: 2000,
        tDepartMs: 1200,
        typeEndMs: 6000,
        x: 1328,
        y: 149,
        rect: { x: 1005, y: 105, w: 646, h: 72 },
        cluster: "write",
      },
    ],
  };

  /** Same beat with the typing stripped, to isolate what typeEndMs changes. */
  const clickOnlyLog: ClickLog = {
    ...typingLog,
    clicks: [{ ...typingLog.clicks[0], typeEndMs: undefined }],
  };

  const scaleAt = (log: ClickLog, tS: number) =>
    sampleTrack(buildCameraTrack(log), tS).scale;

  it("stays zoomed until the last keystroke", () => {
    // HOLD_MIN_S alone expires at 3.3s; the typing runs to 6s. The camera must
    // not trail away from text that is still being typed — that bug played two
    // thirds of the instructions at base scale.
    for (const t of [3.5, 4.5, 5.5, 5.9]) {
      assert.ok(
        scaleAt(typingLog, t) > BASE_POSE.scale + 0.05,
        `expected to still be zoomed at ${t}s, got ${scaleAt(typingLog, t)}`,
      );
    }
  });

  it("does trail out once typing has finished", () => {
    assert.ok(
      scaleAt(typingLog, 9) < BASE_POSE.scale + 0.05,
      "camera should be back at base well after the last keystroke",
    );
  });

  it("leaves a plain click's hold alone", () => {
    // Without typeEndMs the same beat trails on HOLD_MIN_S as before.
    assert.ok(
      scaleAt(clickOnlyLog, 5.5) < BASE_POSE.scale + 0.05,
      "a click with no typing must not inherit the extended hold",
    );
  });

  it("ends at base either way", () => {
    for (const log of [typingLog, clickOnlyLog]) {
      const keys = buildCameraTrack(log);
      assert.ok(posesNearlyEqual(keys[keys.length - 1].pose, BASE_POSE));
    }
  });
});

describe("frameFor keeps the click in shot", () => {
  const VP2 = { width: 1920, height: 1080 };
  /** Is (x, y) inside the region this pose actually shows? */
  const sees = (
    pose: { scale: number; cx: number; cy: number },
    x: number,
    y: number,
  ) => {
    const half = 1 / (2 * pose.scale);
    const nx = x / VP2.width;
    const ny = y / VP2.height;
    return (
      nx >= pose.cx - half &&
      nx <= pose.cx + half &&
      ny >= pose.cy - half &&
      ny <= pose.cy + half
    );
  };

  it("keeps the click in shot when the framed region cannot fit", () => {
    // The agent-skill bug: Create framed on a full-height drawer. Fitting it
    // would need scale 0.47, S_MIN forced 1.18, and the offset then pushed the
    // button 102px below the frame edge.
    const pose = frameFor(
      { tMs: 0, x: 1866, y: 1058, rect: { x: 1160, y: 0, w: 760, h: 1080 } },
      VP2,
      1.74,
    );
    assert.ok(sees(pose, 1866, 1058), "the clicked button must be on screen");
  });

  it("does NOT surrender the zoom just because the region is oversized", () => {
    // Regression on the over-blunt first fix: bailing to BASE_POSE whenever the
    // framed region did not fit made a subscription demo pull back to the whole
    // app mid-flow, on a beat that had been framing fine at S_MIN.
    const pose = frameFor(
      { tMs: 0, x: 1721, y: 655, rect: { x: 1280, y: 0, w: 640, h: 1080 } },
      VP2,
      1.74,
    );
    assert.notDeepEqual(pose, BASE_POSE, "should still be zoomed in");
    assert.ok(pose.scale > 1.1, `expected a real zoom, got ${pose.scale}`);
    assert.ok(sees(pose, 1721, 655));
  });

  it("keeps a click visible when it sits at the edge of a big framed region", () => {
    // Fits at S_MIN, so this exercises the margin clamp rather than the fallback.
    const pose = frameFor(
      { tMs: 0, x: 1500, y: 880, rect: { x: 300, y: 250, w: 1200, h: 640 } },
      VP2,
      1.74,
    );
    assert.ok(
      sees(pose, 1500, 880),
      `click fell outside the frame: ${JSON.stringify(pose)}`,
    );
  });

  it("still frames ordinary controls off-centre", () => {
    // Regression: the guards must not flatten normal framing back to base.
    const pose = frameFor(
      { tMs: 0, x: 476, y: 223, rect: { x: 273, y: 190, w: 406, h: 66 } },
      VP2,
      1.54,
    );
    assert.ok(pose.scale > 1.2, `expected a real zoom, got ${pose.scale}`);
    assert.ok(sees(pose, 476, 223));
    assert.notDeepEqual(pose, BASE_POSE);
  });

  it("never inverts its clamps at maximum zoom", () => {
    // A tiny target at a corner: half is small, so the margin has to shrink too.
    const pose = frameFor({ tMs: 0, x: 1919, y: 1079 }, VP2, 1.74);
    assert.ok(Number.isFinite(pose.cx) && Number.isFinite(pose.cy));
    assert.ok(pose.cx >= 1 / (2 * pose.scale) - 1e-9);
    assert.ok(pose.cy <= 1 - 1 / (2 * pose.scale) + 1e-9);
  });
});
