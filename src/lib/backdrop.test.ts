import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKDROPS,
  DEFAULT_BACKDROP,
  backdropFile,
  backdropProblem,
  isLightBackdrop,
  resolveGround,
  stillBackdropFile,
} from "./backdrop";

describe("backdropFile", () => {
  it("resolves a bare name to the shipped set", () => {
    assert.equal(backdropFile("cobalt"), "backdrops/cobalt.jpg");
  });

  it("falls back to the default when unset or blank", () => {
    assert.equal(backdropFile(), `backdrops/${DEFAULT_BACKDROP}.jpg`);
    assert.equal(backdropFile("  "), `backdrops/${DEFAULT_BACKDROP}.jpg`);
  });

  it("takes anything with an extension as your own file, so custom images need no code", () => {
    assert.equal(backdropFile("mine.jpg"), "backdrops/mine.jpg");
    assert.equal(backdropFile("mine.png"), "backdrops/mine.png");
  });

  it("resolves every shipped backdrop", () => {
    for (const b of BACKDROPS)
      assert.equal(backdropFile(b), `backdrops/${b}.jpg`);
  });
});

describe("backdropProblem", () => {
  it("accepts absence — the default applies", () => {
    assert.equal(backdropProblem(undefined), null);
  });

  it("rejects a path, which would escape public/backdrops/", () => {
    assert.match(String(backdropProblem("../../etc/passwd")), /not a path/);
    assert.match(String(backdropProblem("sub/dir.jpg")), /not a path/);
  });

  it("rejects an empty or non-string name", () => {
    assert.match(String(backdropProblem("")), /non-empty string/);
    assert.match(String(backdropProblem(3)), /non-empty string/);
  });
});

describe("isLightBackdrop", () => {
  it("flags the light ones, because a white rim cannot separate on them", () => {
    assert.equal(isLightBackdrop("canyon"), true);
    assert.equal(isLightBackdrop("glaze"), false);
    assert.equal(isLightBackdrop("unknown"), false);
  });
});

describe("stillBackdropFile", () => {
  it("names the 4K grain-free variant beside the video file", () => {
    assert.equal(stillBackdropFile("cobalt"), "backdrops/cobalt-still.jpg");
    assert.equal(stillBackdropFile(), `backdrops/${DEFAULT_BACKDROP}-still.jpg`);
  });

  it("derives one for a custom file too, whatever its extension", () => {
    assert.equal(stillBackdropFile("mine.png"), "backdrops/mine-still.jpg");
  });
});

describe("resolveGround", () => {
  it("a ground asked for this render wins over everything", () => {
    assert.deepEqual(
      resolveGround({ ground: "#f3f3f3", backdrop: "cobalt", ownGround: "#000000" }),
      { ground: "#f3f3f3", light: true },
    );
  });

  it("a backdrop asked for this render beats the shot's own ground", () => {
    assert.deepEqual(resolveGround({ backdrop: "cobalt", ownGround: "#f3f3f3" }), {
      backdrop: "cobalt",
      light: false,
    });
  });

  it("otherwise the shot's own ground beats every backdrop, the environment's included", () => {
    assert.deepEqual(
      resolveGround({ ownGround: "#111111", ownBackdrop: "chalk", envBackdrop: "mist" }),
      { ground: "#111111", light: false },
    );
  });

  it("the environment's backdrop stands in for the shot's", () => {
    assert.deepEqual(resolveGround({ ownBackdrop: "glaze", envBackdrop: "chalk" }), {
      backdrop: "chalk",
      light: true,
    });
  });

  it("nothing at all is the default image, which is dark", () => {
    assert.deepEqual(resolveGround({}), { backdrop: undefined, light: false });
  });

  it("empty strings count as unset, as a blank env var does", () => {
    assert.deepEqual(resolveGround({ ground: "", envBackdrop: "", ownBackdrop: "mist" }), {
      backdrop: "mist",
      light: true,
    });
  });

  it("transparent is a flat ground, and treated as light", () => {
    assert.equal(resolveGround({ ground: "transparent" }).light, true);
  });
});
