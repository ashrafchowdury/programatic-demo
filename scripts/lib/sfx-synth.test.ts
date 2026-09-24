import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CEILING_DBTP,
  encodeWav,
  gainToDb,
  renderSfx,
  SAMPLE_RATE,
  SFX_IDS,
  SFX_SPECS,
  truePeak,
} from "./sfx-synth";

describe("renderSfx", () => {
  for (const id of SFX_IDS) {
    it(`${id}: keeps the replaced file's exact length`, () => {
      assert.equal(renderSfx(id).length, SFX_SPECS[id].samples);
    });

    it(`${id}: lands on its spec peak, under the ceiling`, () => {
      const tp = gainToDb(truePeak(renderSfx(id)));
      assert.ok(Math.abs(tp - SFX_SPECS[id].peakDbtp) < 0.05, `${tp} dBTP`);
      assert.ok(tp <= CEILING_DBTP);
    });

    it(`${id}: ends on silence, not a chopped sample`, () => {
      const x = renderSfx(id);
      assert.equal(Math.abs(x[x.length - 1]), 0); // -0 when the faded sample was negative
    });
  }

  it("is deterministic — a re-run writes the same bytes", () => {
    assert.deepEqual(encodeWav(renderSfx("typing")), encodeWav(renderSfx("typing")));
  });
});

describe("truePeak", () => {
  it("finds the inter-sample over a sample peak misses", () => {
    // A sine at fs/4 phased 45deg: every sample sits at +/-0.707, the wave
    // between them reaches 1.
    const x = new Float64Array(512).map((_, i) =>
      Math.sin((Math.PI / 2) * i + Math.PI / 4),
    );
    const sampled = Math.max(...x.map(Math.abs));
    assert.ok(sampled < 0.71);
    assert.ok(truePeak(x) > 0.98, `${truePeak(x)}`);
  });
});

describe("encodeWav", () => {
  it("writes a 48kHz stereo s16 header with the right data size", () => {
    const b = encodeWav(new Float64Array(100));
    assert.equal(b.toString("ascii", 0, 4), "RIFF");
    assert.equal(b.readUInt16LE(22), 2);
    assert.equal(b.readUInt32LE(24), SAMPLE_RATE);
    assert.equal(b.readUInt16LE(34), 16);
    assert.equal(b.readUInt32LE(40), 400);
    assert.equal(b.length, 444);
  });
});
