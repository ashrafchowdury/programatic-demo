import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { BRANDS } from "./brand";
import { HOUSE_DEFAULT, HOUSES, houseShape, resolveHouse, type House } from "./house";
import { STYLE_PRESETS } from "./style";

/**
 * The published versions, by content hash. Editing a published house fails
 * here on purpose: publish `<brand>@<n+1>` instead, and add its hash.
 */
const PUBLISHED: Record<string, string> = {
  "agenta@1": "ff411421ef76f8d8",
  "agenta-classic@1": "48d2d30e002a2417",
  "agenta@2": "43819b7b3d669dff",
  "agenta@3": "c242ede045a7c5cc",
  "agenta@4": "89c841e6ef27df1f",
  "agenta@5": "3b4a2165b28cba9e",
  "agenta@6": "635543c76ec5dea2",
  "agenta@7": "d847fb5b92a8c3a2",
};

/**
 * Houses being seeded, not yet published: their numbers may still move. One
 * leaves this set, with its hash added above, in the change that freezes it.
 */
const DRAFTS = new Set<string>();

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;

const houseHash = (house: House): string =>
  createHash("sha256").update(JSON.stringify(canonical(house))).digest("hex").slice(0, 16);

describe("house styles", () => {
  it("resolves the default and a pinned version", () => {
    const def = resolveHouse();
    assert.ok(!("problem" in def));
    assert.equal(def.id, "agenta@6");
    assert.equal(def.style, "one-take");
    assert.deepEqual(def.aspects, ["16:9"]);
    const classic = resolveHouse("agenta-classic@1");
    assert.ok(!("problem" in classic));
    assert.equal(classic.style, "classic");
    assert.deepEqual(classic.aspects, ["16:9", "9:16"]);
  });

  it("names the published versions for an unknown one", () => {
    const r = resolveHouse("agenta@9");
    assert.ok("problem" in r);
    assert.equal(r.problem, 'unknown house "agenta@9". Published: agenta@1, agenta-classic@1, agenta@2, agenta@3, agenta@4, agenta@5, agenta@6, agenta@7.');
  });

  it("builds every house on a style that exists", () => {
    for (const house of Object.values(HOUSES))
      assert.ok(house.style in STYLE_PRESETS, `${house.id} names style "${house.style}"`);
  });

  it("points every sound at a committed file", () => {
    for (const house of Object.values(HOUSES)) {
      const { bed, sfx } = house.brand.audio;
      for (const src of [bed.src, ...Object.values(sfx).map((c) => c.src)])
        assert.ok(existsSync(new URL(`../../public/${src}`, import.meta.url)), `${house.id}: public/${src}`);
    }
  });

  it("keeps every published version as it was published", () => {
    const published = Object.keys(HOUSES).filter((id) => !DRAFTS.has(id));
    assert.deepEqual(published.sort(), Object.keys(PUBLISHED).sort());
    for (const id of published)
      assert.equal(houseHash(HOUSES[id]), PUBLISHED[id], `${id} changed after publishing`);
  });

  it("reads a house published before shapes as the beats shape", () => {
    assert.equal(houseShape(HOUSES["agenta@1"]), "beats");
    assert.equal(houseShape(HOUSES["agenta-classic@1"]), "beats");
    assert.equal(houseShape(HOUSES["agenta@2"]), "one-take");
  });

  it("cuts agenta@2 as one take, in the Agenta pack, both aspects", () => {
    const h = HOUSES["agenta@2"];
    assert.equal(h.style, "one-take");
    assert.equal(h.pack, "agenta");
    assert.ok(h.pack && h.pack in BRANDS);
    assert.deepEqual(h.aspects, ["16:9", "9:16"]);
    assert.equal(h.shoot.speed, 1.25);
    assert.equal(h.outro?.max, 3);
  });

  it("shoots agenta@3 in slow motion and renders it at 60fps, otherwise as agenta@2", () => {
    const [two, three] = [HOUSES["agenta@2"], HOUSES["agenta@3"]];
    assert.equal(three.shoot.slowmo, 3);
    assert.equal(three.fps, 60);
    assert.equal(two.shoot.slowmo, undefined);
    assert.equal(two.fps, undefined);
    const { id: _a, shoot: _b, fps: _c, ...rest3 } = three;
    const { id: _d, shoot: _e, fps: _f, ...rest2 } = two;
    assert.deepEqual(rest3, rest2);
  });

  it("renders the default 16:9 only, otherwise as agenta@3", () => {
    const { id: _a, aspects, ...rest4 } = HOUSES["agenta@4"];
    const { id: _b, aspects: _c, ...rest3 } = HOUSES["agenta@3"];
    assert.deepEqual(aspects, ["16:9"]);
    assert.deepEqual(rest4, rest3);
  });

  it("holds agenta@5's app in a window on a pack grey, otherwise as agenta@4", () => {
    const { id: _a, window, ...rest5 } = HOUSES["agenta@5"];
    const { id: _b, ...rest4 } = HOUSES["agenta@4"];
    assert.deepEqual(window, { ground: "neutral-200", camera: "inside" });
    assert.ok(window && window.ground in BRANDS.agenta.colors);
    assert.deepEqual(rest5, rest4);
  });

  it("opens agenta@6 wide on a poster title, otherwise as agenta@5", () => {
    const { id: _a, opening, poster, ...rest6 } = HOUSES["agenta@6"];
    const { id: _b, ...rest5 } = HOUSES["agenta@5"];
    assert.equal(opening, "wide");
    assert.equal(poster, true);
    assert.deepEqual(rest6, rest5);
  });

  it("renders agenta@7 for a sandbox: 1080p, no shutter, the reel only, otherwise as agenta@6", () => {
    const { id: _a, render, ...rest7 } = HOUSES["agenta@7"];
    const { id: _b, ...rest6 } = HOUSES["agenta@6"];
    assert.deepEqual(render, { scale: 0.75, motionBlur: false, standaloneDemo: false, gl: "swiftshader", workers: 1 });
    assert.deepEqual(rest7, rest6);
    assert.equal(HOUSE_DEFAULT, "agenta@6");
  });

  it("is frozen at runtime", () => {
    assert.throws(() => {
      (HOUSES[HOUSE_DEFAULT].cut as { leadS: number }).leadS = 0;
    }, TypeError);
  });
});
