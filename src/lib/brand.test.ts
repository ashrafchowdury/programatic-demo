import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBrand,
  brandFaceFiles,
  brandHexes,
  brandProblem,
  resolveBrand,
  STYLE_CAP_RATIO,
} from "./brand";
import { parseHeadline } from "./intro";
import { resolveStylePreset, STYLE_PRESETS } from "./style";

const agenta = resolveBrand("agenta");

describe("brand packs", () => {
  it("names the packs that exist when asked for one that does not", () => {
    assert.equal(brandProblem("acme"), 'unknown brand "acme". Known: agenta');
    assert.equal(brandProblem("agenta"), null);
  });

  it("maps every card ground to the Agenta kit's colours", () => {
    const p = applyBrand(STYLE_PRESETS["one-take"], agenta);
    assert.equal(p.palette.light.ground, "#f6f5f3");
    assert.equal(p.palette.light.ink, "#1e1c1d");
    assert.equal(p.palette.plain.ground, "#181010");
    assert.equal(p.palette.plain.ink, "#f6f5f3");
    assert.deepEqual(p.palette.light.highlight, { fill: "#f2f25c", ink: "#1e1c1d" });
    assert.equal(p.shot.ground, "#f6f5f3");
  });

  it("uses the kit's #1E1C1D for text and logo, not the website's #242424", () => {
    assert.ok(!brandHexes(agenta).includes("#242424"));
    assert.equal(agenta.colors.black, "#1e1c1d");
  });

  it("puts the logo for each ground's tone on that ground", () => {
    const p = applyBrand(STYLE_PRESETS["one-take"], agenta);
    assert.equal(p.palette.light.logo, "brand/agenta/logos/logo-light.svg");
    assert.equal(p.palette.plain.logo, "brand/agenta/logos/logo-dark-accent.svg");
  });

  it("keeps the style's cap height in the new face", () => {
    const base = STYLE_PRESETS["one-take"];
    const p = applyBrand(base, agenta);
    assert.equal(p.type.sizePx, Math.round(base.type.sizePx * (STYLE_CAP_RATIO / 0.68)));
    assert.match(p.type.fontFamily, /^"GT Alpina", /);
    assert.match(p.type.accentFamily ?? "", /^"PP Mondwest", /);
  });

  it("changes only the look: motion, layout and timing stay the style's", () => {
    const base = STYLE_PRESETS["one-take"];
    const p = applyBrand(base, agenta);
    assert.deepEqual(p.card, base.card);
    assert.deepEqual({ ...p.shot, ground: null }, { ...base.shot, ground: null });
    assert.deepEqual(p.sequence, base.sequence);
    assert.equal(p.type.lineHeight, base.type.lineHeight);
  });

  it("leaves a photographic shot ground to the style", () => {
    assert.equal(applyBrand(STYLE_PRESETS.classic, agenta).shot.ground, null);
  });

  it("resolves an unbranded reel to exactly the style's preset", () => {
    for (const style of Object.keys(STYLE_PRESETS) as (keyof typeof STYLE_PRESETS)[])
      assert.equal(resolveStylePreset({ style }), STYLE_PRESETS[style]);
  });

  it("serves only the licensed faces from public/brand; Inter is vendored", () => {
    assert.deepEqual(brandFaceFiles(agenta), [
      { family: "GT Alpina", url: "brand/agenta/fonts/GT-Alpina-Light.woff2", weight: 300 },
      { family: "PP Mondwest", url: "brand/agenta/fonts/PPMondwest-Regular.otf", weight: 400 },
    ]);
  });

  it("reads ^^word^^ as the accent face", () => {
    assert.deepEqual(parseHeadline("Build ^^LLMOps^^ together"), [
      { text: "Build" },
      { text: "LLMOps", style: { accent: true } },
      { text: "together" },
    ]);
  });
});
