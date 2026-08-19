import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareStreams, type FileProbe } from "./stitch";

const video = (over: Record<string, unknown> = {}) => ({
  codec_type: "video",
  codec_name: "h264",
  profile: "High",
  level: 50,
  width: 2560,
  height: 1440,
  pix_fmt: "yuv420p",
  r_frame_rate: "30/1",
  ...over,
});

const probe = (...streams: object[]): FileProbe =>
  ({ streams }) as unknown as FileProbe;

describe("compareStreams", () => {
  it("passes two identically encoded renders", () => {
    assert.deepEqual(compareStreams(probe(video()), probe(video())), []);
  });

  it("names both values on a geometry mismatch", () => {
    // The real case this guards: a 1440x820 recording renders 2560x1458, so an
    // intro sized from the wrong click log is off by 18px and concats into a
    // file that plays and then breaks.
    const problems = compareStreams(
      probe(video({ height: 1458 })),
      probe(video()),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /height/);
    assert.match(problems[0], /1458/);
    assert.match(problems[0], /1440/);
  });

  it("flags a frame-rate mismatch", () => {
    const problems = compareStreams(
      probe(video({ r_frame_rate: "30000/1001" })),
      probe(video()),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /r_frame_rate/);
  });

  it("flags an audio track, since both renders pass --muted", () => {
    const problems = compareStreams(
      probe(video(), { codec_type: "audio", codec_name: "aac" }),
      probe(video()),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /audio/);
    assert.match(problems[0], /--muted/);
  });

  it("reports a missing video stream instead of comparing nothing", () => {
    const problems = compareStreams(probe(), probe(video()));
    assert.ok(problems.some((p) => /expected 1 video stream, found 0/.test(p)));
  });
});
