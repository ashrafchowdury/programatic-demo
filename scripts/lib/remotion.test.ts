import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderArgs, resolveConcurrency, resolveGl } from "./remotion";

describe("renderArgs", () => {
  it("honours DEMO_CONCURRENCY for every render, the reel's included", () => {
    // The reel's segment renders used to spell their own flags and dropped it.
    const args = renderArgs("DemoClip", "/o.mp4", { name: "x" }, {}, { DEMO_CONCURRENCY: "2" });
    assert.ok(args.includes("--concurrency=2"), args.join(" "));
    assert.equal(renderArgs("DemoClip", "/o.mp4", {}, {}, {}).some((a) => a.startsWith("--concurrency")), false);
  });

  it("scales the output only when asked", () => {
    assert.ok(renderArgs("DemoClip", "/o.mp4", {}, { scale: 0.75 }, {}).includes("--scale=0.75"));
    assert.equal(renderArgs("DemoClip", "/o.mp4", {}, { scale: 1 }, {}).some((a) => a.startsWith("--scale")), false);
    assert.equal(renderArgs("DemoClip", "/o.mp4", {}, {}, {}).some((a) => a.startsWith("--scale")), false);
  });

  it("renders h264 at CRF 16 on the GPU, muted", () => {
    const args = renderArgs("Intro", "/o.mp4", {}, {}, {});
    assert.deepEqual(args.slice(0, 3), ["render", "Intro", "/o.mp4"]);
    assert.ok(args.includes("--crf=16"));
    assert.ok(args.includes("--gl=angle"));
    assert.ok(args.includes("--muted"));
  });

  it("passes the frame range inclusively", () => {
    const args = renderArgs("DemoClip", "/o.mp4", {}, { frames: { first: 30, last: 89 } }, {});
    assert.ok(args.includes("--frames=30-89"));
  });

  it("keeps the alpha on an overlay layer", () => {
    const args = renderArgs("HudOverlay", "/o.mov", {}, { codec: "prores4444" }, {});
    assert.ok(args.includes("--pixel-format=yuva444p10le"));
    assert.equal(args.includes("--crf=16"), false);
  });
});

describe("resolveGl / resolveConcurrency", () => {
  it("defaults to angle and to Remotion's own worker count", () => {
    assert.equal(resolveGl(undefined), "angle");
    assert.equal(resolveGl("swiftshader"), "swiftshader");
    assert.equal(resolveConcurrency(undefined), null);
    assert.equal(resolveConcurrency("0"), null);
    assert.equal(resolveConcurrency("3.7"), 3);
  });
});
