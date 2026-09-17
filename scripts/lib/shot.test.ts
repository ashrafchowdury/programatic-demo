import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { css } from "./flow";
import { paddingSides, shotProblem, type ShotSpec } from "./shot";

const spec = (over: Partial<ShotSpec> = {}): ShotSpec => ({
  name: "x",
  viewport: { width: 1920, height: 1080 },
  region: css(".app"),
  ...over,
});

describe("shotProblem", () => {
  it("accepts the shapes the smoke shots use", () => {
    assert.equal(shotProblem(spec()), null);
    assert.equal(shotProblem(spec({ look: "cutout", backdrop: "chalk" })), null);
    assert.equal(
      shotProblem(spec({ look: "bleed", anchor: "top-left", padding: 0 })),
      null,
    );
    assert.equal(shotProblem(spec({ region: { x: 0, y: 0, w: 10, h: 10 } })), null);
  });

  it("refuses a cutout that has no element to isolate", () => {
    assert.match(shotProblem(spec({ look: "cutout", region: undefined }))!, /region/);
    assert.match(
      shotProblem(spec({ look: "cutout", region: { x: 0, y: 0, w: 10, h: 10 } }))!,
      /not a rect/,
    );
    assert.equal(shotProblem(spec({ look: "cutout", region: "Save" })), null);
  });

  it("caps scale by the viewport's surface budget", () => {
    assert.equal(shotProblem(spec({ scale: 4 })), null);
    assert.match(shotProblem(spec({ scale: 5 }))!, /between 1 and 4/);
    assert.equal(shotProblem(spec({ scale: 5.8, viewport: { width: 820, height: 1180 } })), null);
  });

  it("takes extra elements to keep, for cutouts only", () => {
    assert.equal(shotProblem(spec({ look: "cutout", keep: [css(".sub")] })), null);
    assert.match(shotProblem(spec({ keep: [css(".sub")] }))!, /only applies/);
    assert.match(shotProblem(spec({ look: "cutout", keep: ["x" as never] }))!, /`keep`/);
  });

  it("takes a split and its gutter", () => {
    assert.equal(shotProblem(spec({ split: 3, gutter: 8 })), null);
    assert.match(shotProblem(spec({ split: 0 }))!, /`split`/);
  });

  it("validates the framing fields through the shared check", () => {
    assert.match(shotProblem(spec({ look: "card" as never }))!, /`look`/);
    assert.match(shotProblem(spec({ zoom: 0.5 }))!, /`zoom`/);
    assert.match(shotProblem(spec({ anchor: "middle" as never }))!, /`anchor`/);
  });
});

describe("paddingSides", () => {
  it("spreads a number to four sides and fills a partial object with the default", () => {
    assert.deepEqual(paddingSides(24), { top: 24, right: 24, bottom: 24, left: 24 });
    assert.deepEqual(paddingSides({ top: 0 }), { top: 0, right: 16, bottom: 16, left: 16 });
    assert.deepEqual(paddingSides(undefined), { top: 16, right: 16, bottom: 16, left: 16 });
  });

  it("is validated per side", () => {
    assert.equal(shotProblem(spec({ padding: { top: 0, bottom: 40 } })), null);
    assert.match(shotProblem(spec({ padding: { top: -1 } }))!, /padding\.top/);
    assert.match(shotProblem(spec({ padding: "x" as never }))!, /`padding`/);
  });
});
