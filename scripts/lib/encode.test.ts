import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliveryProblems,
  overlayArgs,
  VIDEO_ENCODE_ARGS,
  type DeliveryStream,
} from "./encode";

const good: DeliveryStream = {
  codec_type: "video",
  codec_name: "h264",
  profile: "High",
  width: 2560,
  height: 1440,
  pix_fmt: "yuv420p",
  r_frame_rate: "30/1",
  color_space: "bt709",
  color_transfer: "bt709",
  color_primaries: "bt709",
};
const aac: DeliveryStream = { codec_type: "audio", codec_name: "aac", sample_rate: "48000" };
const want = { width: 2560, height: 1440, fps: 30, sampleRate: 48000 };

describe("deliveryProblems (R1/R2/X3)", () => {
  it("passes a High 4:2:0 BT.709 film with 48 kHz audio", () => {
    assert.deepEqual(deliveryProblems([good, aac], want), []);
  });

  it("rejects what the xfade pass actually wrote", () => {
    // Measured on out/reel/agent-schedule.mp4 before the fix.
    const bad: DeliveryStream = {
      ...good,
      profile: "High 4:4:4 Predictive",
      pix_fmt: "yuv444p",
      color_space: undefined,
      color_transfer: undefined,
      color_primaries: undefined,
    };
    const p = deliveryProblems([bad, { ...aac, sample_rate: "96000" }], want);
    assert.ok(p.some((l) => /4:4:4/.test(l)));
    assert.ok(p.some((l) => /pix_fmt yuv444p/.test(l)));
    assert.ok(p.some((l) => /color_space untagged/.test(l)));
    assert.ok(p.some((l) => /96000 Hz/.test(l)));
  });

  it("checks frame rate and size", () => {
    const p = deliveryProblems([{ ...good, r_frame_rate: "25/1", width: 1920 }, aac], want);
    assert.equal(p.length, 2);
  });

  it("a silent film must have no audio, a sounded one exactly one track", () => {
    assert.deepEqual(deliveryProblems([good], { ...want, sampleRate: null }), []);
    assert.equal(deliveryProblems([good, aac], { ...want, sampleRate: null }).length, 1);
    assert.equal(deliveryProblems([good], want).length, 1);
  });
});

describe("overlayArgs", () => {
  it("re-encodes with the shared flags, not x264's defaults", () => {
    const a = overlayArgs("/in.mp4", "/hud.mov", "/out.mp4");
    const i = a.indexOf("-c:v");
    assert.deepEqual(a.slice(i, i + VIDEO_ENCODE_ARGS.length), VIDEO_ENCODE_ARGS);
    assert.equal(a[a.indexOf("-pix_fmt") + 1], "yuv420p");
    assert.equal(a[a.indexOf("-colorspace") + 1], "bt709");
    assert.equal(a[a.length - 1], "/out.mp4");
  });
});
