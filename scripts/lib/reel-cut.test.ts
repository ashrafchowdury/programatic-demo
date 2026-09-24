import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_LOG } from "../../src/lib/click-log";
import { resolveStyle, resolveStylePreset, STYLE_PRESETS } from "../../src/lib/style";
import { isCard, type Reel, type ResolvedReel } from "../../src/lib/reel";
import { clipProps, restyle, type Prepared } from "./reel-cut";

/** A prepared one-clip reel, as prepare() would hand it to clipProps. */
function prepared(reel: Omit<ResolvedReel, "name" | "segments">): Prepared {
  const r: ResolvedReel = {
    name: "x",
    segments: [{ clip: { fromS: 0, toS: 2 } }],
    ...reel,
  };
  const style = resolveStyle(r);
  return {
    reel: r,
    demo: "x",
    preset: STYLE_PRESETS[style],
    style,
    log: EMPTY_LOG,
    speed: 1.25,
    counts: [60],
    joins: [],
    blends: [],
    beats: null,
    ignored: new Map(),
    aspect: undefined,
    chips: [],
    chipNotes: { info: [], warn: [] },
  };
}

describe("clipProps — the style reaches every clip (review 2)", () => {
  it("passes the RESOLVED style on the windowed path", () => {
    // `look: "framed"` resolves to classic. The windowed branch passed neither
    // look nor style, and DemoClip resolved the empty props to DEFAULT_STYLE —
    // proof, full-bleed — so the reel's cards were framed and its clips not.
    const props = clipProps(prepared({ look: "framed" }), 0);
    assert.equal(props.style, "classic");
    assert.equal(resolveStylePreset(props).shot.framing, "window");
  });

  it("passes it when the reel names nothing at all", () => {
    const props = clipProps(prepared({}), 0);
    assert.equal(props.style, resolveStyle({}));
  });

  it("passes it on the full-bleed path too, where look used to carry it", () => {
    const props = clipProps(prepared({ look: "fullbleed" }), 0);
    assert.equal(props.style, "proof");
    assert.equal(props.look, undefined);
  });
});

describe("restyle — --style overrides every level (review 2)", () => {
  const reel: Reel = {
    name: "x",
    style: "proof",
    look: "fullbleed",
    segments: [
      { card: { name: "x", headline: "Pinned", style: "ledger" } },
      { card: { name: "x", headline: "Legacy", look: "framed" } },
      { card: { name: "x", headline: "Plain" } },
      { clip: { fromS: 0, toS: 1 } },
    ],
  };

  it("drops a card's own style and look, so the A/B is one grammar", () => {
    const out = restyle(reel, "stage");
    assert.equal(out.style, "stage");
    assert.equal(out.look, undefined);
    for (const seg of out.segments)
      if (isCard(seg)) {
        assert.equal(seg.card.style, undefined, seg.card.headline);
        assert.equal(seg.card.look, undefined, seg.card.headline);
      }
    // Untouched segments are passed through, not copied.
    assert.equal(out.segments[2], reel.segments[2]);
    assert.equal(out.segments[3], reel.segments[3]);
    // And the authored reel is not mutated.
    assert.equal((reel.segments[0] as { card: { style?: string } }).card.style, "ledger");
  });
});
