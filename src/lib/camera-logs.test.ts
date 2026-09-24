/**
 * Property tests over every real click log in public/.
 *
 * The unit tests in zoom.test.ts pin hand-made logs at fit 1, and the motion
 * bugs they missed only existed on real footage at WINDOW_FIT, during moves:
 * presses landing mid-glide, zoom-outs leaving an action early, a render clamp
 * that swerved every punch. These replay the actual recordings the way the
 * composition does (speed 1.25, WINDOW_FIT, the drawn chrome) and assert the
 * rules the track promises. public/*.clicks.json is pipeline output and not
 * committed, so on a fresh checkout (or CI) this whole file skips.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { panLimit, contentToWindow, poseToCss } from "./camera";
import {
  ACTION_WATCH_S,
  DEFAULT_PLAYBACK_RATE,
  DESIGN_WIDTH,
  OUTPUT_WIDTH,
  SETTLE_BEFORE_PRESS_S,
  type ClickLog,
} from "./click-log";
import { CHROME_H, WINDOW_FIT } from "./window";
import { buildCameraTrack, sampleTrack, type CameraKey } from "./zoom";

const PUBLIC = path.resolve(import.meta.dirname, "../../public");
const logs: ClickLog[] = fs.existsSync(PUBLIC)
  ? fs
      .readdirSync(PUBLIC)
      .filter((f) => f.endsWith(".clicks.json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(PUBLIC, f), "utf8")))
      .filter((log: ClickLog) => log.clicks?.length > 0)
  : [];

const SPEED = DEFAULT_PLAYBACK_RATE;
const EPS = 1e-6;

/** The chrome fraction DemoClip draws for this log (see useCameraAt). */
const chromeFracOf = (log: ClickLog) => {
  const chromeH = CHROME_H * (OUTPUT_WIDTH / DESIGN_WIDTH);
  const height = OUTPUT_WIDTH * (log.viewport.height / log.viewport.width);
  return chromeH / (height + chromeH);
};

const moving = (a: CameraKey, b: CameraKey) =>
  b.via != null ||
  Math.abs(a.pose.scale - b.pose.scale) > 1e-4 ||
  Math.abs(a.pose.cx - b.pose.cx) > 1e-4 ||
  Math.abs(a.pose.cy - b.pose.cy) > 1e-4;

/** Moving segments as [start, end, zoomsOut]. */
const segments = (keys: CameraKey[]) => {
  const out: { a: number; b: number; out: boolean }[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    if (!moving(keys[i], keys[i + 1])) continue;
    out.push({
      a: keys[i].t,
      b: keys[i + 1].t,
      // A bent move dips toward base on its way, so it counts as leaving.
      out:
        keys[i + 1].via != null ||
        keys[i + 1].pose.scale < keys[i].pose.scale - 1e-3,
    });
  }
  return out;
};

const name = (log: ClickLog) => log.name || "(unnamed)";

describe("camera over every public/*.clicks.json", { skip: logs.length === 0 }, () => {
  const tracks = logs.map((log) => {
    const cf = chromeFracOf(log);
    return {
      log,
      cf,
      keys: buildCameraTrack(log, SPEED, { fit: WINDOW_FIT, chromeFrac: cf }),
    };
  });

  it("settles before every press", () => {
    const late: string[] = [];
    for (const { log, keys } of tracks) {
      const segs = segments(keys);
      for (const c of log.clicks) {
        if (c.zoom === false) continue;
        const press = (c.tDownMs ?? c.tMs) / 1000;
        const s = segs.find((g) => press > g.a + EPS && press < g.b - EPS);
        if (s) late.push(`${name(log)} "${c.label}" +${((s.b - press) / SPEED).toFixed(3)}s`);
      }
    }
    assert.deepEqual(late, [], "camera still moving at mousedown");
  });

  it("aims to settle SETTLE_BEFORE_PRESS_S early where the recording allows", () => {
    // Soft: only counts presses the camera had to reach (a move ends before
    // them) and reports how many miss the full gap. Guards against the
    // deadline silently regressing to "lands exactly on the press".
    let tight = 0;
    let total = 0;
    for (const { log, keys } of tracks) {
      const segs = segments(keys);
      for (const c of log.clicks) {
        if (c.zoom === false) continue;
        const press = (c.tDownMs ?? c.tMs) / 1000;
        const before = segs.filter((g) => g.b <= press + EPS).pop();
        if (!before) continue;
        total++;
        if (press - before.b < SETTLE_BEFORE_PRESS_S * SPEED - 1e-3) tight++;
      }
    }
    assert.ok(tight <= total * 0.1, `${tight}/${total} presses without the settle gap`);
  });

  it("never zooms out of an action before it has finished and been watched", () => {
    const early: string[] = [];
    for (const { log, keys } of tracks) {
      const segs = segments(keys).filter((s) => s.out);
      for (const c of log.clicks) {
        if (c.zoom === false) continue;
        const from = (c.tDownMs ?? c.tMs) / 1000;
        const end = Math.max(c.tMs, c.typeEndMs ?? c.tMs) / 1000;
        const until = end + ACTION_WATCH_S * SPEED;
        const s = segs.find((g) => g.b > from + EPS && g.a < until - 1e-4);
        if (s) {
          early.push(
            `${name(log)} "${c.label}" zoom-out at +${((s.a - end) / SPEED).toFixed(2)}s`,
          );
        }
      }
    }
    assert.deepEqual(early, []);
  });

  it("keeps every keyframe and every in-between pose inside the render clamp", () => {
    // poseToCss's clamp is a safety. If it ever acts, the frame it acts on is
    // a swerve (D2): translate pinned, then released mid-move.
    const bad: string[] = [];
    for (const { log, keys, cf } of tracks) {
      const end = keys[keys.length - 1].t;
      for (let t = 0; t <= end; t += 1 / 120) {
        const pose = sampleTrack(keys, t);
        const g = contentToWindow(pose.cx, pose.cy, cf);
        const lim = panLimit(pose.scale) + 1e-9;
        if (Math.abs(g.cx - 0.5) > lim || Math.abs(g.cy - 0.5) > lim) {
          bad.push(`${name(log)} t=${t.toFixed(3)}`);
          break;
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  it("keeps velocity continuous at WINDOW_FIT across moves", () => {
    // Every move starts and ends at rest, so wherever one move meets a hold
    // or another move, the on-screen speed on both sides of the key is ~0.
    // A step there is a kick (the old curve launched at full average speed)
    // or a dead stop between back-to-back moves.
    const W = OUTPUT_WIDTH;
    const kicks: string[] = [];
    for (const { log, keys, cf } of tracks) {
      const H = OUTPUT_WIDTH * (log.viewport.height / log.viewport.width);
      const edge = (t: number) => {
        const z = poseToCss(sampleTrack(keys, t), cf, WINDOW_FIT);
        return { x: z.translateX * W, y: z.translateY * H, s: z.scale };
      };
      // px per screen frame at 30fps, of the frame edge (translate + growth)
      const dt = SPEED / 30;
      const speedAt = (t: number) => {
        const a = edge(t);
        const b = edge(t + dt / 4);
        return 4 * (Math.hypot(b.x - a.x, b.y - a.y) + (Math.abs(b.s - a.s) * W) / 2);
      };
      let peak = 0;
      for (let t = 0; t < keys[keys.length - 1].t; t += dt) peak = Math.max(peak, speedAt(t));
      for (const k of keys.slice(1, -1)) {
        const before = speedAt(k.t - dt / 4 - 1e-4);
        const after = speedAt(k.t + 1e-4);
        if (Math.max(before, after) > 0.05 * peak) {
          kicks.push(
            `${name(log)} t=${k.t.toFixed(3)}: ${before.toFixed(1)} -> ${after.toFixed(1)} px/f (peak ${peak.toFixed(0)})`,
          );
        }
      }
    }
    assert.deepEqual(kicks, []);
  });

  it("ends every clip at base", () => {
    for (const { log, keys } of tracks) {
      const last = keys[keys.length - 1].pose;
      assert.ok(Math.abs(last.scale - 1) < 1e-9, `${name(log)} ends at ${last.scale}`);
    }
  });
});
