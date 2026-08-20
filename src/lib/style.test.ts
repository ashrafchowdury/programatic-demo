import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_STYLE,
  STYLES,
  STYLE_PRESETS,
  isStyle,
  resolvePreset,
  resolveStyle,
  styleProblem,
} from "./style";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("the registry", () => {
  it("has a preset for every style, and no orphans", () => {
    assert.deepEqual(Object.keys(STYLE_PRESETS).sort(), [...STYLES].sort());
  });

  it("gives every preset every field", () => {
    // Structural completeness is what lets a component read a field without
    // asking which style it got. A preset missing one would surface as
    // undefined deep inside a render, which is the failure this catches early.
    for (const name of STYLES) {
      const p = STYLE_PRESETS[name];
      assert.ok(p.look, `${name}: look`);
      assert.ok(p.motionLayer, `${name}: motionLayer`);
      for (const k of ["cadence", "length", "enter", "exit"] as const)
        assert.ok(p.card[k] !== undefined, `${name}: card.${k}`);
      for (const k of ["framing", "chrome", "cursor", "ripple"] as const)
        assert.ok(p.shot[k] !== undefined, `${name}: shot.${k}`);
      for (const k of ["punchScale", "punchS", "leadS", "settleS"] as const)
        assert.ok(typeof p.chip[k] === "number", `${name}: chip.${k}`);
      for (const k of ["tumbleS", "turns"] as const)
        assert.ok(typeof p.bookend[k] === "number", `${name}: bookend.${k}`);
      for (const k of ["leadS", "itemStaggerS"] as const)
        assert.ok(typeof p.recap[k] === "number", `${name}: recap.${k}`);
    }
  });

  it("pairs source and targets — measured, or honestly not", () => {
    // A preset with targets but no source claims a measurement it cannot show;
    // one with a source but no targets wasted the analysis. Either way the
    // provenance is broken, which is how invented numbers get in.
    for (const name of STYLES) {
      const p = STYLE_PRESETS[name];
      assert.equal(
        p.source === null,
        p.targets === null,
        `${name}: source and targets must both be present or both null`,
      );
    }
  });

  it("keeps classic unmeasured on purpose", () => {
    // Guards docs/reel/06-comparison.md §6: classic predates both films, so
    // backfilling Film A's numbers into it is a category error. If a future
    // pass wants to measure it, that needs a film, not a copy.
    assert.equal(STYLE_PRESETS.classic.source, null);
    assert.equal(STYLE_PRESETS.classic.targets, null);
  });
});

describe("measured values trace back to docs/reel", () => {
  it("holds proof's card for 62 frames after the last word", () => {
    // The reference's hardest rule: 62-63f on every sentence card regardless of
    // word count. 2.07s * 30fps = 62.1.
    assert.equal(Math.round(STYLE_PRESETS.proof.card.length.holdS * 30), 62);
  });

  it("fits proof's stagger rather than holding it fixed", () => {
    // Film A compresses the stagger so the last word still lands in time for a
    // constant hold. A fixed cadence would push the cut out on a long card.
    assert.equal(STYLE_PRESETS.proof.card.cadence.kind, "fitted");
    assert.equal(STYLE_PRESETS.classic.card.cadence.kind, "fixed");
  });

  it("slots proof's cards into the reference's 3.2-3.3s band", () => {
    const { minS, maxS } = STYLE_PRESETS.proof.card.length;
    assert.equal(minS, 3.2);
    assert.equal(maxS, 3.3);
    // classic does not clamp — its length follows the copy.
    assert.equal(STYLE_PRESETS.classic.card.length.minS, null);
  });

  it("cuts proof's cards mid-move on both ends", () => {
    // The push envelope is the whole grammar: arrive already moving, leave
    // still moving. A card that entered or left at rest would read as a slide.
    assert.equal(STYLE_PRESETS.proof.card.enter.kind, "push");
    assert.equal(STYLE_PRESETS.proof.card.exit.kind, "push");
  });

  it("keeps the two grammars on opposite motion layers", () => {
    assert.equal(STYLE_PRESETS.proof.motionLayer, "cards");
    assert.notEqual(STYLE_PRESETS.classic.motionLayer, "cards");
  });

  it("locks narration's cards perfectly still", () => {
    // The defining measurement is an ABSENCE: docs/reel/02-motion.md tracks
    // shot 10's text box over 56 frames and finds zero translation. A card that
    // moved even slightly would put this grammar on the wrong motion layer.
    assert.equal(STYLE_PRESETS.narration.card.enter.kind, "none");
    assert.equal(STYLE_PRESETS.narration.card.exit.kind, "none");
    assert.equal(STYLE_PRESETS.narration.motionLayer, "shots");
  });

  it("gives narration no card slot, so length follows the copy", () => {
    // Film A slots every card into 3.2-3.3s; Film B runs 31-89f as the words
    // require. Clamping narration would erase the difference between them.
    assert.equal(STYLE_PRESETS.narration.card.length.minS, null);
    assert.equal(STYLE_PRESETS.narration.card.length.maxS, null);
    assert.notEqual(STYLE_PRESETS.proof.card.length.minS, null);
  });

  it("reproduces Film B's measured 31-89f card band from its own model", () => {
    // The band is a CONSEQUENCE of stagger + hold, not an input. If this drifts
    // outside the reference's range the two numbers have stopped agreeing.
    const { cadence, length } = STYLE_PRESETS.narration.card;
    const cardF = (words: number) =>
      Math.round((Math.max(0, words - 1) * cadence.staggerS + length.holdS) * 30);
    assert.ok(cardF(1) >= 31 && cardF(1) <= 45, `1 word -> ${cardF(1)}f`);
    assert.ok(cardF(10) >= 75 && cardF(10) <= 95, `10 words -> ${cardF(10)}f`);
  });

  it("snaps narration's chip in 3 frames, and does not paste 7.82x", () => {
    // punchS is directly transferable; punchScale is a COMPOSITION target and
    // Film B's 7.82 is a raw pill ratio. Pasting it is the Q4 trap.
    assert.equal(Math.round(STYLE_PRESETS.narration.chip.punchS * 30), 3);
    assert.notEqual(STYLE_PRESETS.narration.chip.punchScale, 7.82);
  });

  it("matches narration's cuts instead of slamming them", () => {
    assert.equal(STYLE_PRESETS.narration.targets?.cutDelta, "matched");
    assert.equal(STYLE_PRESETS.proof.targets?.cutDelta, "slam");
  });
});

describe("resolveStyle", () => {
  it("defaults to classic, so a silent reel renders as it always has", () => {
    // reels/agent-skill.ts and agent-slash-command.ts carry no look field.
    // Any other default silently restyles them.
    assert.equal(resolveStyle({}), "classic");
    assert.equal(DEFAULT_STYLE, "classic");
    assert.equal(STYLE_PRESETS[DEFAULT_STYLE].look, "framed");
  });

  it("reads a legacy fullbleed look as proof", () => {
    assert.equal(resolveStyle({ look: "fullbleed" }), "proof");
    assert.equal(resolveStyle({ look: "framed" }), "classic");
  });

  it("lets an explicit style win over the look", () => {
    assert.equal(resolveStyle({ style: "proof", look: "framed" }), "proof");
    assert.equal(resolveStyle({ style: "classic" }), "classic");
  });

  it("resolvePreset agrees with resolveStyle", () => {
    for (const look of ["framed", "fullbleed"] as const)
      assert.equal(resolvePreset({ look }), STYLE_PRESETS[resolveStyle({ look })]);
  });
});

describe("styleProblem", () => {
  it("accepts absence — the default applies", () => {
    assert.equal(styleProblem({}), null);
  });

  it("rejects a name that is not a style", () => {
    assert.match(String(styleProblem({ style: "kinetic" })), /must be one of/);
    assert.match(String(styleProblem({ style: 7 })), /must be one of/);
  });

  it("allows style and look together — that is the override", () => {
    assert.equal(styleProblem({ style: "proof", look: "framed" }), null);
  });

  it("rejects the one incoherent pair", () => {
    assert.match(
      String(styleProblem({ style: "classic", look: "fullbleed" })),
      /cannot be combined/,
    );
  });

  it("isStyle narrows only real names", () => {
    assert.ok(isStyle("proof"));
    assert.ok(isStyle("narration"));
    assert.ok(!isStyle("kinetic"));
    assert.ok(!isStyle(undefined));
  });
});

describe("no component branches on a style's name", () => {
  // THE LOAD-BEARING TEST. The whole point of a preset registry is that adding
  // a film is one table entry. The moment a component says
  // `if (style === "proof")`, the next style has to touch that component too,
  // and the room stops being a room. Fields are addressable; names are not.
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        files.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));

  it("mentions a style name nowhere but style.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (path.basename(file) === "style.ts") continue;
      const src = fs.readFileSync(file, "utf8");
      for (const name of STYLES) {
        // A quoted style name is the tell. Reading `preset.card` is fine;
        // comparing against "proof" is what this forbids.
        if (new RegExp(`["'\`]${name}["'\`]`).test(src))
          offenders.push(`${path.relative(ROOT, file)} mentions "${name}"`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `style names must stay inside style.ts:\n  ${offenders.join("\n  ")}`,
    );
  });
});
