import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brandProblems, frameColorProblem } from "./brand-audit";
import { resolveBrand } from "./brand";
import type { Reel } from "./reel";

const agenta = resolveBrand("agenta");

const reel = (card: Record<string, unknown>, brand: string | null = "agenta"): Reel => ({
  name: "audit",
  style: "one-take",
  ...(brand ? { brand } : {}),
  segments: [{ card: { name: "audit", headline: "Introducing ==Skills==", ...card } }],
});

/** `n` RGB24 pixels of one colour. */
const fill = (n: number, [r, g, b]: number[]): number[] =>
  Array.from({ length: n }, () => [r, g, b]).flat();

describe("reel brand audit, static", () => {
  it("passes a card that resolves entirely to the pack", () => {
    assert.deepEqual(brandProblems(reel({}), agenta), []);
    assert.deepEqual(brandProblems(reel({ background: "plain" }), agenta), []);
    assert.deepEqual(brandProblems(reel({ logo: true, headline: "Agenta" }), agenta), []);
  });

  it("names a custom highlight colour that is not the pack's", () => {
    assert.deepEqual(brandProblems(reel({ headline: "Introducing ==Skills|#ff0000==" }), agenta), [
      { path: "segments[0].headline", message: 'highlight #ff0000 on "Skills" is not an "agenta" colour' },
    ]);
  });

  it("names an unbranded reel's colour and face", () => {
    const problems = brandProblems(reel({}, null), agenta);
    assert.equal(problems[0].path, "brand");
    assert.equal(problems[1].message, 'card renders outside the "agenta" pack');
  });
});

describe("reel brand audit, window", () => {
  it("passes a pack grey and names any other ground", () => {
    assert.deepEqual(brandProblems({ ...reel({}), window: { ground: "#D7D7D7" } }, agenta), []);
    assert.deepEqual(brandProblems({ ...reel({}), window: { ground: "#cccccc" } }, agenta), [
      { path: "window.ground", message: 'window ground #cccccc is not an "agenta" colour' },
    ]);
  });
});

describe("reel brand audit, frames", () => {
  it("passes a frame of pack colours and their anti-aliased blends", () => {
    const smoke = [0xf6, 0xf5, 0xf3];
    const ink = [0x1e, 0x1c, 0x1d];
    const blend = smoke.map((v, i) => Math.round((v + ink[i]) / 2));
    const px = new Uint8Array([...fill(900, smoke), ...fill(80, ink), ...fill(20, blend)]);
    assert.equal(frameColorProblem(px, agenta, 12, 0.005), null);
  });

  it("names an off-brand grey covering more than the allowed share", () => {
    const px = new Uint8Array([...fill(970, [0xf6, 0xf5, 0xf3]), ...fill(30, [0x40, 0x90, 0x40])]);
    const bad = frameColorProblem(px, agenta, 12, 0.005);
    assert.deepEqual(bad, { offShare: 0.03, colour: "#409040" });
  });

  it("lets compression ringing below the share through", () => {
    const px = new Uint8Array([...fill(998, [0xf6, 0xf5, 0xf3]), ...fill(2, [0x40, 0x90, 0x40])]);
    assert.equal(frameColorProblem(px, agenta, 12, 0.005), null);
  });
});
