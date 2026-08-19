import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PRESET,
  STILL_PRESETS,
  STILL_PRESET_IDS,
  STILL_SHORT_EDGE,
  maxWindowPx,
  resolvePreset,
  shotAspect,
  shotMetaProblem,
  shotPixels,
  windowBox,
  type ShotMeta,
} from "./still";

const FIT = 0.86;
const meta = (over: Partial<ShotMeta> = {}): ShotMeta => ({
  name: "smoke",
  region: { width: 960, height: 540 },
  scale: 2,
  viewport: { width: 1920, height: 1080 },
  ...over,
});

describe("STILL_PRESETS", () => {
  it("uses even dimensions so a downstream ffmpeg pass needs no resize", () => {
    for (const id of STILL_PRESET_IDS) {
      const { width, height } = STILL_PRESETS[id];
      assert.equal(width % 2, 0, `${id} width`);
      assert.equal(height % 2, 0, `${id} height`);
    }
  });

  it("hits the aspect each platform actually expects", () => {
    const aspect = (id: keyof typeof STILL_PRESETS) =>
      STILL_PRESETS[id].width / STILL_PRESETS[id].height;
    assert.equal(aspect("wide"), 16 / 9);
    assert.equal(aspect("square"), 1);
    assert.equal(aspect("portrait"), 4 / 5);
    assert.equal(aspect("story"), 9 / 16);
    // The "1.91:1" in the platform docs is a rounding of 1200x630; match the
    // pixels rather than the rounded ratio.
    assert.deepEqual(STILL_PRESETS.og, { width: 1200 * 2, height: 630 * 2 });
  });

  it("holds the short edge at 2160 so detail per picture is constant", () => {
    for (const id of STILL_PRESET_IDS) {
      if (id === "og") continue; // sized to the link-card box instead.
      const { width, height } = STILL_PRESETS[id];
      assert.equal(Math.min(width, height), STILL_SHORT_EDGE, id);
    }
    assert.deepEqual(STILL_PRESETS[DEFAULT_PRESET], {
      width: 3840,
      height: 2160,
    });
  });
});

describe("resolvePreset", () => {
  it("defaults when nothing is given", () => {
    assert.equal(resolvePreset(), DEFAULT_PRESET);
    assert.equal(resolvePreset(""), DEFAULT_PRESET);
    assert.equal(resolvePreset(null), DEFAULT_PRESET);
  });

  it("names the valid options when it rejects one, since that is the fix", () => {
    assert.throws(() => resolvePreset("twitter"), /wide, og, square/);
  });
});

describe("windowBox", () => {
  it("is width-limited when the region is wider than the canvas", () => {
    // 16:9 region in a 9:16 story frame: width binds, and the result is short.
    const box = windowBox(9 / 16, STILL_PRESETS.story, FIT);
    assert.equal(box.width, Math.round(2160 * FIT));
    assert.ok(box.height < STILL_PRESETS.story.height * FIT);
  });

  it("is height-limited when the region is taller than the canvas", () => {
    // A tall sidebar in a 16:9 frame: height binds, and it must not overflow.
    const box = windowBox(3, STILL_PRESETS.wide, FIT);
    assert.equal(box.height, Math.round(2160 * FIT));
    assert.ok(box.width < STILL_PRESETS.wide.width * FIT);
  });

  it("never exceeds the fit fraction on either axis", () => {
    for (const id of STILL_PRESET_IDS) {
      const canvas = STILL_PRESETS[id];
      for (const aspect of [0.1, 0.5625, 1, 1.5, 4]) {
        const box = windowBox(aspect, canvas, FIT);
        assert.ok(box.width <= Math.round(canvas.width * FIT) + 1, `${id} w`);
        assert.ok(box.height <= Math.round(canvas.height * FIT) + 1, `${id} h`);
      }
    }
  });

  it("preserves the region's aspect, which is the whole job", () => {
    for (const aspect of [0.5625, 1, 2.5]) {
      const box = windowBox(aspect, STILL_PRESETS.square, FIT);
      assert.ok(Math.abs(box.height / box.width - aspect) < 0.002);
    }
  });

  it("collapses to the DemoClip case when region and canvas agree", () => {
    // Matching aspects must shrink both axes by exactly fit — that is what the
    // videos do, and a still of a full viewport has to look identical to them.
    const box = windowBox(2160 / 3840, STILL_PRESETS.wide, FIT);
    assert.deepEqual(box, {
      width: Math.round(3840 * FIT),
      height: Math.round(2160 * FIT),
    });
  });

  it("rejects a degenerate region rather than rendering a zero-size window", () => {
    assert.throws(() => windowBox(0, STILL_PRESETS.wide, FIT), /regionAspect/);
    assert.throws(() => windowBox(1, STILL_PRESETS.wide, 0), /fit/);
  });
});

describe("shotPixels / shotAspect", () => {
  it("reports the PNG's real size, so upscaling cannot be hidden", () => {
    assert.deepEqual(shotPixels(meta()), { width: 1920, height: 1080 });
    assert.deepEqual(shotPixels(meta({ scale: 4 })), {
      width: 3840,
      height: 2160,
    });
  });

  it("reads the aspect off the region, not the pixels", () => {
    assert.equal(shotAspect(meta()), 0.5625);
    assert.equal(shotAspect(meta({ scale: 4 })), 0.5625);
  });
});

describe("shotMetaProblem", () => {
  it("accepts a sidecar the capture stage would write", () => {
    assert.equal(shotMetaProblem(meta()), null);
  });

  it("catches the shapes an older or partial writer would leave", () => {
    assert.match(String(shotMetaProblem(null)), /not an object/);
    assert.match(String(shotMetaProblem({})), /name/);
    assert.match(String(shotMetaProblem(meta({ region: undefined }))), /region/);
    assert.match(String(shotMetaProblem(meta({ scale: 0 }))), /scale/);
    assert.match(
      String(shotMetaProblem(meta({ viewport: { width: 0, height: 9 } }))),
      /viewport\.width/,
    );
  });
});

describe("maxWindowPx", () => {
  it("covers the biggest window any preset can ask for", () => {
    const fit = 0.86;
    const target = maxWindowPx(fit);
    for (const id of STILL_PRESET_IDS) {
      const canvas = STILL_PRESETS[id];
      // Whatever the region's shape, neither window axis may exceed the target
      // — that is what makes "captured at target px" mean "nothing upscales".
      for (const aspect of [0.1, 0.5625, 1, 4]) {
        const box = windowBox(aspect, canvas, fit);
        assert.ok(box.width <= target, `${id} w ${box.width} > ${target}`);
        assert.ok(box.height <= target, `${id} h ${box.height} > ${target}`);
      }
    }
  });
});
