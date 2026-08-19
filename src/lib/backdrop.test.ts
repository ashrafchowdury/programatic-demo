import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKDROPS,
  DEFAULT_BACKDROP,
  backdropFile,
  backdropProblem,
  isLightBackdrop,
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
