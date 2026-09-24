import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_POSE, panLimit, posesNearlyEqual } from "./camera";
import type { ClickLog } from "./click-log";
import { WINDOW_FIT } from "./window";
import {
  buildCameraTrack,
  clusterize,
  driftPose,
  frameFor,
  sampleTrack,
  stickify,
  trackDurationMs,
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
    // There is no room for a full trail plus a rest at base before the next
    // press, so the camera makes ONE move that dips through a middle scale
    // (see interpolateVia) — it must still pull most of the way back rather
    // than cross at 1.6x, and it must not leave Save before it was watched.
    let minScale = Infinity;
    for (let t = 16.7; t < 21.47; t += 0.01) {
      minScale = Math.min(minScale, sampleTrack(keys, t).scale);
    }
    assert.ok(
      minScale < 1.3,
      `camera swept between clusters at ${minScale.toFixed(2)}x`,
    );
    const leave = keys.find((k, n) => n > 0 && k.t > 16.7 && !posesNearlyEqual(k.pose, keys[n - 1].pose));
    assert.ok(leave);
    const moveStart = keys[keys.indexOf(leave) - 1].t;
    assert.ok(
      moveStart >= 16.7 + 0.7 * 1.25 - 1e-6,
      `left Save ${((moveStart - 16.7) / 1.25).toFixed(2)}s after the click`,
    );
  });

  it("scales move durations so they land right on screen at speed", () => {
    // Departs early enough that neither speed has to squeeze the move to land
    // before the press (that squeeze is tested separately).
    const roomy: ClickLog = {
      ...smokeLog,
      clicks: [{ ...smokeLog.clicks[0], tDepartMs: 800 }, ...smokeLog.clicks.slice(1)],
    };
    const fast = buildCameraTrack(roomy, 1.25);
    const real = buildCameraTrack(roomy, 1);
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
    // What the viewer sees: the window is drawn at WINDOW_FIT * scale.
    const half = 1 / (2 * WINDOW_FIT * pose.scale);
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

describe("hold drift", () => {
  const SPEED = 1.25;
  const track = buildCameraTrack(smokeLog, SPEED);
  const tAt = (frame: number) => (frame / 30) * SPEED;

  it("is off by default, so pnpm render is untouched", () => {
    // scripts/render.ts passes only {name, speed}. If drift ever defaulted on,
    // every mp4 in out/ would change silently and every cached reel segment
    // would disagree with the code that drew it.
    for (const f of [0, 30, 90, 150, 240]) {
      assert.deepEqual(
        zoomAt(f, 30, smokeLog, { speed: SPEED, fit: 0.86 }),
        zoomAt(f, 30, smokeLog, { speed: SPEED, fit: 0.86, drift: 0 }),
      );
    }
  });

  it("never drifts downward, and never moves the framed point", () => {
    // poseToCss re-clamps cx to [half, 1-half] with half = 1/(2S), and frameFor
    // drives edge targets ONTO that clamp. Scaling up loosens the clamp and
    // moves nothing; scaling down by the same amount tightens it and produces a
    // pan of roughly 24 screen px that nobody authored.
    for (let f = 0; f < 280; f++) {
      const t = tAt(f);
      const plain = sampleTrack(track, t);
      const moved = driftPose(plain, track, t, SPEED, 1);
      assert.ok(moved.scale >= plain.scale, `drifted DOWN at frame ${f}`);
      assert.equal(moved.cx, plain.cx);
      assert.equal(moved.cy, plain.cy);
    }
  });

  it("stays inside the stillness budget and caps itself at S_MAX", () => {
    // A hold still has to READ as still: under 0.01 of scale across any 0.35s
    // window, the same budget this file pins on the track itself. And nothing
    // re-checks S_MAX after frameFor, so the drift has to cap itself or a long
    // hold on an already-tight framing walks past where the source holds up.
    const driftAt = (f: number) => {
      const t = tAt(f);
      const plain = sampleTrack(track, t);
      return driftPose(plain, track, t, SPEED, 1).scale - plain.scale;
    };
    for (let f = 0; f < 280; f++) {
      const a = driftAt(f);
      const b = driftAt(f + Math.round(0.35 * 30));
      assert.ok(
        Math.abs(a - b) < 0.01,
        `drift moved ${Math.abs(a - b)} in 0.35s at frame ${f}`,
      );
      const t = tAt(f);
      const scale = driftPose(sampleTrack(track, t), track, t, SPEED, 1).scale;
      assert.ok(scale <= 1.74 + 1e-9, `drifted past S_MAX at frame ${f}`);
    }
  });

  it("returns to the authored pose at both ends of every hold", () => {
    // Drift lives inside a hold and has to join and leave it with a matched
    // value, or there is a visible kick where the glide hands over.
    for (const key of track) {
      for (const t of [key.t + 1e-6, key.t - 1e-6]) {
        if (t < 0) continue;
        const plain = sampleTrack(track, t);
        const moved = driftPose(plain, track, t, SPEED, 1);
        assert.ok(
          Math.abs(moved.scale - plain.scale) < 1e-5,
          `seam at key t=${key.t}`,
        );
      }
    }
  });
});

describe("the camera and the action agree about time", () => {
  const SPEED = 1.25;
  const segmentsOf = (keys: ReturnType<typeof buildCameraTrack>) =>
    keys
      .slice(1)
      .map((b, i) => ({ a: keys[i], b }))
      .filter(({ a, b }) => b.via || !posesNearlyEqual(a.pose, b.pose));

  it("lands a squeezed in-move before the press, not after it", () => {
    // skillsmp-search's shape: the cursor glides for ~0.6s of recording time,
    // shorter than the camera's own move at 1.25x. The move is shortened (to a
    // floor) so the press lands on a still frame.
    const log: ClickLog = {
      name: "tight",
      viewport: VP,
      durationMs: 9000,
      clicks: [
        {
          tMs: 2700,
          tDownMs: 2600,
          tDepartMs: 2000,
          x: 1500,
          y: 300,
          rect: { x: 1440, y: 280, w: 120, h: 40 },
          cluster: "a",
        },
      ],
    };
    const keys = buildCameraTrack(log, SPEED);
    const move = segmentsOf(keys)[0];
    assert.ok(
      move.b.t <= 2.6 - 0.15 * SPEED + 1e-6,
      `settled at ${move.b.t}, press at 2.6`,
    );
    const onScreen = (move.b.t - move.a.t) / SPEED;
    assert.ok(onScreen >= 0.45 - 1e-6, `squeezed to ${onScreen}s on screen`);
  });

  it("starts early rather than below the floor when the glide is very short", () => {
    const log: ClickLog = {
      name: "tighter",
      viewport: VP,
      durationMs: 9000,
      clicks: [
        { tMs: 2500, tDownMs: 2450, tDepartMs: 2300, x: 1500, y: 300, cluster: "a" },
      ],
    };
    const keys = buildCameraTrack(log, SPEED);
    const move = segmentsOf(keys)[0];
    assert.ok(move.a.t < 2.3, "should borrow from the establish before it");
    assert.ok(move.b.t <= 2.45 - 0.15 * SPEED + 1e-6);
  });

  it("never zooms out of a typing beat before the last keystroke has been watched", () => {
    // agent-instructions' defect: the next cluster's lead-in arrived before the
    // hold expired and "the trail won", zooming out 590ms before the last key.
    const log: ClickLog = {
      name: "type-then-go",
      viewport: VP,
      durationMs: 16000,
      clicks: [
        {
          tMs: 2000,
          tDepartMs: 1200,
          typeEndMs: 7000,
          x: 400,
          y: 200,
          rect: { x: 300, y: 180, w: 300, h: 40 },
          cluster: "write",
        },
        {
          tMs: 8600,
          tDepartMs: 7100,
          x: 1700,
          y: 950,
          rect: { x: 1640, y: 930, w: 120, h: 40 },
          cluster: "save",
        },
      ],
    };
    const keys = buildCameraTrack(log, SPEED);
    const leave = segmentsOf(keys).find(({ a }) => a.t > 2.5);
    assert.ok(leave);
    assert.ok(
      leave.a.t >= 7 + 0.7 * SPEED - 1e-6,
      `left ${((leave.a.t - 7) / SPEED).toFixed(2)}s after the last keystroke`,
    );
    // …and Save still lands on a still frame (the settle gap is what gives).
    const arrive = segmentsOf(keys).find(({ b }) => b.t > leave.a.t);
    assert.ok(arrive && arrive.b.t <= 8.6, `landed ${arrive?.b.t}`);
  });

  it("holds the last beat in full and runs the track past a short recording", () => {
    const log: ClickLog = {
      ...smokeLog,
      durationMs: 7500, // 0.65s after the last click: no room for hold + trail
    };
    const keys = buildCameraTrack(log, SPEED);
    const last = keys[keys.length - 1];
    assert.ok(posesNearlyEqual(last.pose, BASE_POSE), "must still end at base");
    const outStart = segmentsOf(keys).pop()!.a.t;
    assert.ok(outStart >= 6.854 + 1.3 * SPEED - 1e-6, "last hold was cut");
    assert.ok(trackDurationMs(log, SPEED) > log.durationMs);
    assert.equal(trackDurationMs(smokeLog, 1), smokeLog.durationMs);
  });

  it("carries speed through a back-to-back out-and-in instead of stopping at base", () => {
    // Two far clusters with no time for a rest at base: one bent move.
    const log: ClickLog = {
      name: "hop",
      viewport: VP,
      durationMs: 14000,
      clicks: [
        { tMs: 2000, tDepartMs: 1200, x: 300, y: 200, cluster: "a" },
        { tMs: 6000, tDepartMs: 4200, x: 1650, y: 900, cluster: "b" },
      ],
    };
    const keys = buildCameraTrack(log, SPEED);
    const bent = keys.find((k) => k.via);
    assert.ok(bent, "expected a single out-and-in move");
    const i = keys.indexOf(bent);
    const mid = (keys[i - 1].t + bent.t) / 2;
    const a = sampleTrack(keys, mid - 0.01);
    const b = sampleTrack(keys, mid + 0.01);
    assert.ok(Math.abs(b.cx - a.cx) > 1e-3, "camera stopped mid-move");
    assert.ok(Math.min(a.scale, b.scale) > 1.05, "should not reach base");
  });
});

describe("frameFor holds keyframes to the pan clamp", () => {
  it("keeps the window's edges out of shot on a soft punch (the corner case)", () => {
    // At fit 0.86 a punch at S ~1.2 is only 1.03x on screen. Clamped on the
    // pose scale, a left-edge target slid the window until its left edge sat
    // at the base margin with the right 13% cut off.
    const wide = { x: 20, y: 400, w: 1500, h: 60 };
    const pose = frameFor({ tMs: 0, x: 60, y: 430, rect: wide }, VP, 1.74);
    const lim = panLimit(WINDOW_FIT * pose.scale);
    assert.ok(Math.abs(pose.cx - 0.5) <= lim + 1e-9, JSON.stringify(pose));
    assert.ok(Math.abs(pose.cy - 0.5) <= lim + 1e-9, JSON.stringify(pose));
  });

  it("clamps in window-group space when the group has chrome", () => {
    const cf = 0.034;
    const pose = frameFor({ tMs: 0, x: 1900, y: 1070 }, VP, 1.74, {
      chromeFrac: cf,
    });
    const g = cf + pose.cy * (1 - cf);
    assert.ok(Math.abs(g - 0.5) <= panLimit(WINDOW_FIT * pose.scale) + 1e-9);
  });
});

describe("frameFor with a logged content region", () => {
  // gmail-automation's shape: a wide field at the top of a short form on a
  // tall, sparse page. The field alone fits at a soft punch, which leaves most
  // of the frame as empty page below the form.
  const click = {
    tMs: 0,
    x: 960,
    y: 140,
    rect: { x: 700, y: 120, w: 520, h: 48 },
  };
  const content = { x: 700, y: 90, w: 520, h: 420 };
  /** Share of the visible frame that is outside `r`. */
  const blank = (
    pose: { scale: number; cx: number; cy: number },
    r: typeof content,
  ) => {
    const s = WINDOW_FIT * pose.scale;
    const w = VP.width / s;
    const h = VP.height / s;
    const x0 = pose.cx * VP.width - w / 2;
    const y0 = pose.cy * VP.height - h / 2;
    const ix = Math.max(0, Math.min(x0 + w, r.x + r.w) - Math.max(x0, r.x));
    const iy = Math.max(0, Math.min(y0 + h, r.y + r.h) - Math.max(y0, r.y));
    return 1 - (ix * iy) / (w * h);
  };

  it("is unchanged when no content is logged", () => {
    assert.deepEqual(
      frameFor({ ...click, content: undefined }, VP, 1.74),
      frameFor(click, VP, 1.74),
    );
  });

  it("tightens toward the product, within the sharpness ceiling", () => {
    const before = frameFor(click, VP, 1.74);
    const after = frameFor({ ...click, content }, VP, 1.74);
    assert.ok(after.scale > before.scale && after.scale <= 1.74);
    assert.ok(
      blank(after, content) < blank(before, content),
      `blank ${blank(before, content).toFixed(2)} -> ${blank(after, content).toFixed(2)}`,
    );
    // The clicked control is still wholly in shot.
    const half = 1 / (2 * WINDOW_FIT * after.scale);
    assert.ok(click.rect.x / VP.width >= after.cx - half);
    assert.ok((click.rect.x + click.rect.w) / VP.width <= after.cx + half);
    assert.ok(click.rect.y / VP.height >= after.cy - half);
  });

  it("stops at the blank cap instead of cropping into the content", () => {
    // Content already dense enough: no extra zoom.
    const big = { x: 100, y: 60, w: 1700, h: 960 };
    const after = frameFor({ ...click, content: big }, VP, 1.74);
    assert.equal(after.scale, frameFor(click, VP, 1.74).scale);
  });
});
