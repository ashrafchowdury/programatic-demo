import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANCHORS,
  BLEED_ZOOM,
  CUTOUT_FIT,
  DEFAULT_PRESET,
  STILL_PRESETS,
  STILL_PRESET_IDS,
  STILL_SHORT_EDGE,
  anchorBox,
  bleedLayout,
  captureTargetPx,
  cutoutLayout,
  framingProblem,
  hasOwnShadow,
  maxScaleFor,
  maxWindowPx,
  splitCanvas,
  splitProblem,
  viewportFor,
  fillZoom,
  MAX_UPSCALE,
  resolveAnchor,
  resolveLook,
  resolveStillPreset,
  resolveShotLook,
  isStillLook,
  focusBox,
  parseFocus,
  stillLegibility,
  FEED_WIDTH,
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

describe("resolveStillPreset", () => {
  it("defaults when nothing is given", () => {
    assert.equal(resolveStillPreset(), DEFAULT_PRESET);
    assert.equal(resolveStillPreset(""), DEFAULT_PRESET);
    assert.equal(resolveStillPreset(null), DEFAULT_PRESET);
  });

  it("names the valid options when it rejects one, since that is the fix", () => {
    assert.throws(() => resolveStillPreset("twitter"), /wide, og, square/);
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

describe("resolveLook / resolveAnchor", () => {
  it("defaults to window and center", () => {
    assert.equal(resolveLook(undefined), "window");
    assert.equal(resolveLook(""), "window");
    assert.equal(resolveAnchor(null), "center");
  });

  it("rejects an unknown value with the list", () => {
    assert.throws(() => resolveLook("card"), /window, cutout, bleed/);
    assert.throws(() => resolveAnchor("middle"), /top-left/);
  });
});

describe("captureTargetPx", () => {
  it("leaves the window target exactly where it was", () => {
    assert.equal(captureTargetPx("window", FIT), maxWindowPx(FIT));
  });

  it("asks a bleed for zoom times more and a cutout for its fit", () => {
    assert.equal(captureTargetPx("bleed", FIT), maxWindowPx(FIT * BLEED_ZOOM));
    assert.equal(captureTargetPx("bleed", FIT, { zoom: 2 }), maxWindowPx(FIT * 2));
    assert.equal(captureTargetPx("cutout", FIT), maxWindowPx(CUTOUT_FIT));
    assert.equal(captureTargetPx("cutout", FIT, { fit: 0.5 }), maxWindowPx(0.5));
  });
});

describe("anchorBox", () => {
  const canvas = { width: 1000, height: 500 };
  const size = { width: 200, height: 100 };

  it("centres on any axis the anchor does not name", () => {
    assert.deepEqual(anchorBox(size, canvas, "center", 0), { left: 400, top: 200 });
    assert.deepEqual(anchorBox(size, canvas, "top", 0), { left: 400, top: 0 });
    assert.deepEqual(anchorBox(size, canvas, "left", 0), { left: 0, top: 200 });
  });

  it("keeps inset clear on the anchored sides only", () => {
    assert.deepEqual(anchorBox(size, canvas, "top-left", 0.1), { left: 50, top: 50 });
    assert.deepEqual(anchorBox(size, canvas, "bottom-right", 0.1), {
      left: 1000 - 50 - 200,
      top: 500 - 50 - 100,
    });
    assert.deepEqual(anchorBox(size, canvas, "right", 0.1), { left: 750, top: 200 });
  });

  it("insets the same px on both axes, off the short edge, on any canvas shape", () => {
    const tiny = { width: 10, height: 10 };
    // A story frame: 0.06 per axis used to be 130px at the side, 230px on top.
    const story = anchorBox(tiny, STILL_PRESETS.story, "top-left", 0.06);
    assert.equal(story.left, story.top);
    assert.equal(Math.round(story.left), 130);
    // A 3-piece portrait split lays out across 6480x2700: 390 vs 162 before.
    const whole = splitCanvas(STILL_PRESETS.portrait, { count: 3, piece: 0, gutter: 0 }).canvas;
    const split = anchorBox(tiny, whole, "bottom-right", 0.06);
    assert.equal(whole.width - split.left - tiny.width, whole.height - split.top - tiny.height);
    assert.equal(Math.round(whole.height - split.top - tiny.height), 162);
  });

  it("places every anchor inside the canvas when the box fits", () => {
    for (const a of ANCHORS) {
      const { left, top } = anchorBox(size, canvas, a, 0.05);
      assert.ok(left >= 0 && left + size.width <= canvas.width, a);
      assert.ok(top >= 0 && top + size.height <= canvas.height, a);
    }
  });

  it("lets an oversized box run off the far side", () => {
    const big = { width: 1300, height: 600 };
    const { left, top } = anchorBox(big, canvas, "top-left", 0.06);
    assert.equal(left, 30);
    assert.equal(top, 30);
    assert.ok(left + big.width > canvas.width);
    assert.ok(top + big.height > canvas.height);
  });
});

describe("cutoutLayout", () => {
  // A 400x200 element whose shadow reaches 20px each side and 60px below.
  const cut = (over: Partial<ShotMeta> = {}): ShotMeta =>
    meta({
      look: "cutout",
      region: { width: 440, height: 280 },
      scale: 4,
      body: { x: 20, y: 20, width: 400, height: 200 },
      ...over,
    });
  const canvas = { width: 3840, height: 2160 };

  it("centres the BODY, not the png, so the shadow hangs below", () => {
    const lay = cutoutLayout(cut(), canvas);
    assert.equal(lay.body.x + lay.body.width / 2, canvas.width / 2);
    assert.equal(lay.body.y + lay.body.height / 2, canvas.height / 2);
    // The png extends further below the body than above it.
    const above = lay.body.y - lay.img.y;
    const below = lay.img.y + lay.img.height - (lay.body.y + lay.body.height);
    assert.ok(below > above);
  });

  it("fits the body to CUTOUT_FIT of the canvas", () => {
    const lay = cutoutLayout(cut(), canvas);
    // 400x200 body at scale 4 is 1600px; fit 0.62 of 3840 wide is 2380 -> scale up? No:
    // never upscale. 1600 < 2380 so it sits native.
    assert.equal(lay.native, true);
    assert.equal(lay.scale, 1);
    assert.equal(lay.body.width, 1600);
  });

  it("scales DOWN when the capture is bigger than the fit, never up", () => {
    const lay = cutoutLayout(cut({ scale: 4, body: { x: 20, y: 20, width: 1000, height: 200 } , region: { width: 1040, height: 280 } }), canvas);
    assert.equal(lay.native, false);
    assert.ok(lay.scale < 1);
    assert.equal(Math.round(lay.body.width), Math.round(canvas.width * CUTOUT_FIT));
    const up = cutoutLayout(cut({ scale: 1 }), canvas);
    assert.equal(up.scale, 1);
  });

  it("draws a native placement at exact png pixels on integer offsets", () => {
    const lay = cutoutLayout(cut(), canvas);
    assert.equal(lay.img.width, 440 * 4);
    assert.equal(lay.img.height, 280 * 4);
    assert.equal(lay.img.x, Math.round(lay.img.x));
    assert.equal(lay.img.y, Math.round(lay.img.y));
  });

  it("honours anchor and inset, and reports overflow", () => {
    // 15% of 2160 is 324px clear below the body — and beside it; the shadow needs 240.
    const lay = cutoutLayout(cut(), canvas, { anchor: "bottom-right", inset: 0.15 });
    assert.equal(lay.body.x + lay.body.width, canvas.width - 324);
    assert.equal(lay.body.y + lay.body.height, canvas.height - 324);
    assert.equal(lay.overflows, false);
    const off = cutoutLayout(cut(), canvas, { anchor: "bottom", inset: 0 });
    assert.equal(off.overflows, true, "the shadow below the body runs off the canvas");
  });

  it("frames past the canvas when fit is over 1, still without upscaling", () => {
    // 1000px body at scale 4 = 4000px; fit 1.4 of 3840 wants 5376 -> capped native.
    const wide = cut({ scale: 4, body: { x: 20, y: 20, width: 1000, height: 200 }, region: { width: 1040, height: 280 } });
    const lay = cutoutLayout(wide, canvas, { fit: 1.4, anchor: "left", inset: 0.05 });
    assert.equal(lay.scale, 1);
    assert.equal(lay.body.x, canvas.height * 0.05);
    assert.ok(lay.body.x + lay.body.width > canvas.width, "runs off the right");
    assert.equal(lay.overflows, true);
    // With the pixels to spare it is scaled DOWN to the asked size.
    const big = cut({ scale: 4, body: { x: 20, y: 20, width: 1800, height: 200 }, region: { width: 1840, height: 280 } });
    const fit = cutoutLayout(big, canvas, { fit: 1.4, anchor: "left" });
    assert.equal(Math.round(fit.body.width), Math.round(canvas.width * 1.4));
  });

  it("refuses a sidecar with no body", () => {
    assert.throws(() => cutoutLayout(meta(), canvas), /not a cutout/);
  });
});

describe("bleedLayout", () => {
  const canvas = STILL_PRESETS.wide;

  it("is the fitted window, zoomed, anchored top-left by default", () => {
    const base = windowBox(shotAspect(meta()), canvas, FIT);
    const box = bleedLayout(meta(), canvas, FIT);
    assert.equal(box.width, Math.round(base.width * BLEED_ZOOM));
    assert.equal(box.height, Math.round(base.height * BLEED_ZOOM));
    assert.ok(box.x > 0 && box.y > 0);
    assert.ok(box.x + box.width > canvas.width, "runs off the right");
    assert.ok(box.y + box.height > canvas.height, "runs off the bottom");
  });

  it("takes the sidecar's framing, and lets a call override it", () => {
    const fromMeta = bleedLayout(meta({ zoom: 1.5, anchor: "bottom-right" }), canvas, FIT);
    const explicit = bleedLayout(meta(), canvas, FIT, { zoom: 1.5, anchor: "bottom-right" });
    assert.deepEqual(fromMeta, explicit);
    assert.ok(fromMeta.x < 0, "anchored right, so it runs off the left");
  });
});

describe("framingProblem", () => {
  it("accepts nothing set, and every field at a sane value", () => {
    assert.equal(framingProblem({}), null);
    assert.equal(
      framingProblem({ look: "bleed", fit: 0.5, anchor: "top", inset: 0.1, zoom: 1.3 }),
      null,
    );
  });

  it("names the bad field", () => {
    assert.match(framingProblem({ look: "card" })!, /`look`/);
    assert.match(framingProblem({ fit: 0 })!, /`fit`/);
    assert.match(framingProblem({ fit: 2.5 })!, /`fit`/);
    assert.match(framingProblem({ anchor: "middle" })!, /`anchor`/);
    assert.match(framingProblem({ inset: 0.5 })!, /`inset`/);
    assert.match(framingProblem({ zoom: 0.9 })!, /`zoom`/);
    assert.match(framingProblem({ body: { x: 0, y: 0, width: 0, height: 1 } })!, /`body`/);
  });
});

describe("shotMetaProblem with looks", () => {
  it("reads a sidecar from before looks existed as a window", () => {
    assert.equal(shotMetaProblem(meta()), null);
    assert.equal(meta().look, undefined);
  });

  it("requires a cutout to carry its body", () => {
    assert.match(shotMetaProblem(meta({ look: "cutout" }))!, /body/);
    assert.equal(
      shotMetaProblem(meta({ look: "cutout", body: { x: 1, y: 1, width: 10, height: 10 } })),
      null,
    );
  });
});

describe("maxScaleFor", () => {
  it("is the measured 1920x1080x4 surface, and scales with the viewport", () => {
    assert.equal(maxScaleFor({ width: 1920, height: 1080 }), 4);
    assert.equal(maxScaleFor({ width: 820, height: 1180 }), 5.8);
    assert.equal(maxScaleFor({ width: 960, height: 540 }), 8, "hard cap");
    assert.equal(maxScaleFor({ width: 7680, height: 4320 }), 1);
  });
});

describe("hasOwnShadow", () => {
  it("reads the shadow's reach off the painted extent around the body", () => {
    const base = meta({ look: "cutout", region: { width: 440, height: 280 } });
    assert.equal(hasOwnShadow({ ...base, body: { x: 20, y: 20, width: 400, height: 200 } }), true);
    assert.equal(hasOwnShadow({ ...base, region: { width: 402, height: 202 }, body: { x: 1, y: 1, width: 400, height: 200 } }), false);
    assert.equal(hasOwnShadow(meta()), false);
  });
});

describe("framingProblem ground", () => {
  it("wants a six-digit hex", () => {
    assert.equal(framingProblem({ ground: "#F3F3F3" }), null);
    assert.match(framingProblem({ ground: "grey" })!, /`ground`/);
    assert.match(framingProblem({ ground: "#fff" })!, /`ground`/);
  });
});

describe("splitCanvas", () => {
  const piece = { width: 2160, height: 2700 };

  it("lays out across count pieces plus the gutters between them", () => {
    const { canvas } = splitCanvas(piece, { count: 3, piece: 0, gutter: 8 });
    assert.deepEqual(canvas, { width: 2160 * 3 + 16, height: 2700 });
  });

  it("offsets each piece by a piece and a gutter, so the gutter is skipped", () => {
    assert.equal(splitCanvas(piece, { count: 3, piece: 0, gutter: 8 }).offset, 0);
    assert.equal(splitCanvas(piece, { count: 3, piece: 1, gutter: 8 }).offset, 2168);
    assert.equal(splitCanvas(piece, { count: 3, piece: 2, gutter: 8 }).offset, 4336);
    // The last piece ends exactly at the canvas edge.
    const { canvas, offset } = splitCanvas(piece, { count: 3, piece: 2, gutter: 8 });
    assert.equal(offset + piece.width, canvas.width);
  });

  it("with no gutter the pieces tile the canvas", () => {
    const { canvas, offset } = splitCanvas(piece, { count: 2, piece: 1, gutter: 0 });
    assert.equal(canvas.width, 4320);
    assert.equal(offset, 2160);
  });
});

describe("splitProblem", () => {
  it("wants a whole count of at least two, and a gutter only with a split", () => {
    assert.equal(splitProblem({}), null);
    assert.equal(splitProblem({ split: 3, gutter: 8 }), null);
    assert.equal(splitProblem({ split: 1 }), null, "1 is whole");
    assert.match(splitProblem({ split: 0 })!, /`split`/);
    assert.match(splitProblem({ split: 2.5 })!, /`split`/);
    assert.match(splitProblem({ split: 9 })!, /`split`/);
    assert.match(splitProblem({ split: 2, gutter: -1 })!, /`gutter`/);
    assert.match(splitProblem({ gutter: 8 })!, /needs a `split`/);
  });
});

describe("captureTargetPx with a split", () => {
  it("asks for what the per-piece layout draws, not count times one canvas", () => {
    // agents-page, 16:9, --split=3: used to ask 3x maxWindowPx (~9.9k px at
    // this fit), and so always shot at the viewport's ceiling.
    const target = captureTargetPx("window", FIT, { split: 3, gutter: 8, aspect: 9 / 16 });
    // Whatever preset binds, it is the largest window any split canvas holds.
    const expected = Math.max(
      ...STILL_PRESET_IDS.map((id) => {
        const whole = splitCanvas(STILL_PRESETS[id], { count: 3, piece: 0, gutter: 8 }).canvas;
        const w = windowBox(9 / 16, whole, FIT);
        return Math.max(w.width, w.height);
      }),
    );
    assert.equal(target, expected);
    assert.ok(target < maxWindowPx(FIT) * 3 * 0.65, `${target} is well under the old ask`);
  });

  it("stays the conservative longest-edge bound before the region's shape is known", () => {
    const whole = splitCanvas(STILL_PRESETS.wide, { count: 2, piece: 0, gutter: 0 }).canvas;
    assert.equal(captureTargetPx("cutout", FIT, { split: 2 }), Math.round(whole.width * CUTOUT_FIT));
  });

  it("changes nothing on one canvas", () => {
    assert.equal(captureTargetPx("window", FIT, { split: 1, aspect: 1 }), maxWindowPx(FIT));
    assert.equal(captureTargetPx("window", FIT, { aspect: 1 }), maxWindowPx(FIT));
  });
});

describe("resolveShotLook", () => {
  const window = { name: "s" };
  const cutout = { name: "s", look: "cutout" as const };

  it("is the captured look when nothing is asked", () => {
    assert.deepEqual(resolveShotLook(window), { look: "window", problem: null });
    assert.deepEqual(resolveShotLook(cutout, ""), { look: "cutout", problem: null });
  });

  it("reframes a window capture as a bleed, and back", () => {
    assert.deepEqual(resolveShotLook(window, "bleed"), { look: "bleed", problem: null });
    assert.deepEqual(resolveShotLook({ name: "s", look: "bleed" }, "window"), {
      look: "window",
      problem: null,
    });
  });

  it("refuses across the capture line with the fix, and falls back to what was captured", () => {
    const a = resolveShotLook(cutout, "window");
    assert.equal(a.look, "cutout");
    assert.match(a.problem!, /captured as a cutout.*pnpm shot s/);
    const b = resolveShotLook(window, "cutout");
    assert.equal(b.look, "window");
    assert.match(b.problem!, /captured differently/);
  });

  it("throws on a look that does not exist", () => {
    assert.throws(() => resolveShotLook(window, "poster"), /unknown look/);
    assert.equal(isStillLook("poster"), false);
  });
});

describe("focus", () => {
  it("centres the focus point when the box is larger than the canvas", () => {
    const canvas = { width: 1000, height: 500 };
    const at = focusBox({ width: 2000, height: 1000 }, canvas, { x: 1000, y: 500 }, 0);
    assert.deepEqual(at, { left: -500, top: -250 });
  });

  it("pulls back rather than show ground inside the inset", () => {
    const canvas = { width: 1000, height: 500 };
    // Focus in the top-left corner: centring would drag the box in past the edge.
    const at = focusBox({ width: 2000, height: 1000 }, canvas, { x: 0, y: 0 }, 0.1);
    assert.deepEqual(at, { left: 50, top: 50 });
    const far = focusBox({ width: 2000, height: 1000 }, canvas, { x: 2000, y: 1000 }, 0.1);
    assert.equal(far.left + 2000, 1000 - 50);
    assert.equal(far.top + 1000, 500 - 50);
  });

  it("centres an axis the box does not cover", () => {
    const at = focusBox({ width: 2000, height: 300 }, { width: 1000, height: 500 }, { x: 0, y: 0 }, 0);
    assert.equal(at.top, 100);
  });

  it("drives a bleed when set, instead of the anchor", () => {
    const canvas = STILL_PRESETS.wide;
    const m = meta({ focus: { x: 576, y: 324, width: 0, height: 0 } });
    const box = bleedLayout(m, canvas, FIT, { zoom: 2, inset: 0 });
    // 60% across and down the region lands on the canvas centre.
    assert.ok(Math.abs(box.x + box.width * 0.6 - canvas.width / 2) <= 1);
    assert.ok(Math.abs(box.y + box.height * 0.6 - canvas.height / 2) <= 1);
  });

  it("parses --focus as fractions of the region", () => {
    assert.deepEqual(parseFocus("0.5,0.25", { width: 960, height: 540 }), {
      x: 480,
      y: 135,
      width: 0,
      height: 0,
    });
    assert.throws(() => parseFocus("2,0", { width: 1, height: 1 }), /fractions/);
    assert.throws(() => parseFocus("0.5", { width: 1, height: 1 }), /fractions/);
  });

  it("is validated in a sidecar", () => {
    assert.equal(framingProblem({ focus: { x: 1, y: 2, width: 0, height: 0 } }), null);
    assert.match(framingProblem({ focus: { x: 1 } })!, /`focus.y`/);
  });
});

describe("stillLegibility", () => {
  it("reads a 1440px page in a window on wide as too small for a feed", () => {
    const page = meta({ region: { width: 1440, height: 900 } });
    const wide = STILL_PRESETS.wide;
    const l = stillLegibility(page, "window", wide, wide, FIT);
    const box = windowBox(900 / 1440, wide, FIT);
    assert.equal(l.textScale, (box.width / 1440) * (FEED_WIDTH / wide.width));
    assert.ok(l.textScale < 0.7);
  });

  it("measures how little of a story frame a landscape window covers", () => {
    const story = STILL_PRESETS.story;
    const l = stillLegibility(meta(), "window", story, story, FIT);
    assert.ok(l.fill > 0.2 && l.fill < 0.3, String(l.fill));
    // A fill bleed covers it all.
    const b = stillLegibility(meta(), "bleed", story, story, FIT, { zoom: "fill", inset: 0 });
    assert.ok(b.fill > 0.99);
    assert.ok(b.textScale > l.textScale);
  });

  it("scales text by the piece a feed shows, not the whole a split spans", () => {
    const piece = STILL_PRESETS.square;
    const whole = splitCanvas(piece, { count: 2, piece: 0, gutter: 0 }).canvas;
    const l = stillLegibility(meta(), "window", piece, whole, FIT);
    const box = windowBox(shotAspect(meta()), whole, FIT);
    assert.equal(l.textScale, (box.width / 960) * (FEED_WIDTH / piece.width));
  });

  it("judges a cutout on its body", () => {
    const m = meta({
      look: "cutout",
      scale: 4,
      region: { width: 400, height: 300 },
      body: { x: 20, y: 20, width: 360, height: 240 },
    });
    const wide = STILL_PRESETS.wide;
    const l = stillLegibility(m, "cutout", wide, wide, FIT);
    const lay = cutoutLayout(m, wide);
    assert.equal(l.textScale, (lay.body.width / 360) * (FEED_WIDTH / wide.width));
  });
});

describe("framingProblem ground transparent", () => {
  it("accepts transparent as a ground", () => {
    assert.equal(framingProblem({ ground: "transparent" }), null);
  });
});

describe("viewportFor", () => {
  it("inverts maxScaleFor, keeping the shape", () => {
    const vp = viewportFor(4, { width: 1920, height: 1080 });
    assert.equal(vp.width, 1920);
    assert.equal(vp.height, 1080);
    const small = viewportFor(8, { width: 1920, height: 1080 });
    assert.equal(small.width, 960);
    assert.ok(Math.abs(maxScaleFor(small) - 8) < 0.15);
  });
});

describe("cutoutLayout upscale", () => {
  const cut = meta({
    look: "cutout",
    region: { width: 440, height: 280 },
    scale: 4,
    body: { x: 20, y: 20, width: 400, height: 200 },
  });
  const canvas = { width: 3840, height: 2160 };

  it("never stretches by default, and stretches only to the asked ceiling", () => {
    const plain = cutoutLayout(cut, canvas);
    assert.equal(plain.scale, 1);
    assert.equal(plain.native, true);
    assert.equal(plain.stretched, false);
    const up = cutoutLayout(cut, canvas, { upscale: 1.5 });
    assert.ok(up.scale > 1 && up.scale <= 1.5);
    assert.equal(up.stretched, true);
    assert.equal(up.native, false);
  });

  it("caps the knob at MAX_UPSCALE", () => {
    assert.match(framingProblem({ upscale: MAX_UPSCALE + 0.1 })!, /`upscale`/);
    assert.equal(framingProblem({ upscale: 1.5 }), null);
  });
});

describe("bleedLayout fill", () => {
  it("covers the canvas on both axes for a landscape region in a story frame", () => {
    const story = STILL_PRESETS.story;
    const box = bleedLayout(meta(), story, FIT, { zoom: "fill", anchor: "top-left", inset: 0 });
    assert.ok(box.width >= story.width, "covers the width");
    assert.ok(box.height >= story.height, "covers the height");
    // And no wider than it must be: the binding axis is exact.
    assert.ok(Math.abs(box.height - story.height) <= 1);
  });

  it("fillZoom is the larger of the two ratios", () => {
    assert.equal(fillZoom({ width: 100, height: 50 }, { width: 200, height: 300 }), 6);
  });

  it("is accepted as a zoom, and a capture bounds it across presets", () => {
    assert.equal(framingProblem({ zoom: "fill" }), null);
    assert.match(framingProblem({ zoom: "big" })!, /`zoom`/);
    const withAspect = captureTargetPx("bleed", FIT, { zoom: "fill", aspect: 9 / 16 });
    const fixed = captureTargetPx("bleed", FIT, { zoom: 1.3 });
    assert.ok(withAspect > fixed, "a 16:9 region filling a story frame needs far more");
  });
});
