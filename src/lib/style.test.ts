import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { BACKGROUNDS } from "./intro";
import {
  DEFAULT_STYLE,
  STYLES,
  REFERENCE_FILMS,
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

describe("palettes", () => {
  it("keys grounds by exactly the backgrounds intro.ts ships", () => {
    // style.ts cannot import intro.ts (it sits below it), so GroundKey is
    // re-declared there. This is the only thing keeping the two in step.
    for (const name of STYLES)
      assert.deepEqual(
        Object.keys(STYLE_PRESETS[name].palette).sort(),
        [...BACKGROUNDS].sort(),
        `${name}: palette keys must match BACKGROUNDS`,
      );
  });

  it("assigns narration's grounds by role, not by taste", () => {
    // Film B's code: white narrates, warm grey is the workbench, black is the
    // third-party register. Three DISTINCT grounds — the moment two collapse
    // to the same hex the viewer can no longer read the role off the colour.
    const p = STYLE_PRESETS.narration.palette;
    assert.equal(p.light.ground, "#ffffff");
    assert.equal(p.plain.ground, "#e6e4e0");
    assert.equal(p.plate.ground, "#0a0a0a");
    assert.equal(new Set(Object.values(p).map((g) => g.ground)).size, 3);
  });

  it("keeps proof to one voice plus a light alternative", () => {
    // Film A alternates two grounds to make its ~200-level slams; it has no
    // third role. plate and plain deliberately collapse.
    const p = STYLE_PRESETS.proof.palette;
    assert.equal(p.plate.ground, p.plain.ground);
    assert.notEqual(p.light.ground, p.plate.ground);
  });

  it("gives every ground ink that can actually be read on it", () => {
    // A style whose ink matches its ground renders an invisible card. Cheap to
    // assert, and it is the kind of thing a hand-edited hex gets wrong.
    const lum = (hex: string): number => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) return NaN;
      const n = parseInt(m[1], 16);
      return (
        (0.2126 * ((n >> 16) & 255) +
          0.7152 * ((n >> 8) & 255) +
          0.0722 * (n & 255)) /
        255
      );
    };
    for (const name of STYLES)
      for (const [key, g] of Object.entries(STYLE_PRESETS[name].palette)) {
        const d = Math.abs(lum(g.ground) - lum(g.ink));
        assert.ok(d > 0.5, `${name}.${key}: ground/ink luma gap ${d.toFixed(2)}`);
      }
  });
});

describe("reference films", () => {
  it("points every style-bearing film at a real style", () => {
    for (const f of REFERENCE_FILMS)
      if (f.style !== null)
        assert.ok(STYLE_PRESETS[f.style], `${f.label} -> unknown style`);
  });

  it("keeps Uber measured but unimplemented", () => {
    // The judgement this whole table exists to record. Uber's grammar is a
    // typography engine, not a set of numbers; a preset for it would render a
    // film sharing its palette and nothing that matters. If someone ever adds
    // one, this test should be what stops them doing it by accident.
    const uber = REFERENCE_FILMS.find((f) => f.label.startsWith("Uber"));
    assert.ok(uber);
    assert.equal(uber.style, null);
    assert.match(String(uber.note), /NOT IMPLEMENTABLE/);
    // And it is the outlier that motivates the "type" motion layer.
    assert.ok(uber.movingFrac > 0.8, `moving ${uber.movingFrac}`);
  });

  it("agrees with the targets each style already carries", () => {
    // Two records of one measurement. They drifting apart is how a preset ends
    // up claiming a reference it no longer matches.
    for (const f of REFERENCE_FILMS) {
      if (f.style === null) continue;
      const t = STYLE_PRESETS[f.style].targets;
      assert.ok(t, `${f.label}: style has no targets`);
      assert.equal(t.cutsPerMin, f.cutsPerMin, `${f.label}: cutsPerMin`);
      assert.equal(t.movingFrac, f.movingFrac, `${f.label}: movingFrac`);
      assert.equal(
        STYLE_PRESETS[f.style].source?.loudnessLUFS ?? null,
        f.loudnessLUFS,
        `${f.label}: loudness`,
      );
    }
  });

  it("spans the loudness range that reopened the audio question", () => {
    // Audio was ruled out of presets when two films disagreed. Four films now
    // span >20 LU, which is why it is surfaced as an advisory.
    const l = REFERENCE_FILMS.map((f) => f.loudnessLUFS).filter(
      (x): x is number => x != null,
    );
    assert.ok(Math.max(...l) - Math.min(...l) > 20, `span ${l}`);
    assert.ok(
      REFERENCE_FILMS.some((f) => f.loudnessLUFS === null),
      "one reference ships silent, and that is a finding",
    );
  });
});

describe("type scale", () => {
  it("gives every style a scale whose cap and pitch are consistent", () => {
    for (const name of STYLES) {
      const t = STYLE_PRESETS[name].type;
      // pitch = size * lineHeight, within a pixel of the recorded measurement.
      assert.ok(
        Math.abs(t.sizePx * t.lineHeight - t.pitchPx) < 2,
        `${name}: ${t.sizePx} * ${t.lineHeight} != ${t.pitchPx}`,
      );
      // cap ~0.715 of nominal for a grotesque; loose bound, it only has to
      // catch a transposed or invented number.
      assert.ok(
        Math.abs(t.capPx / t.sizePx - 0.715) < 0.12,
        `${name}: cap ratio ${(t.capPx / t.sizePx).toFixed(2)}`,
      );
    }
  });

  it("opens ledger's line pitch well beyond the others", () => {
    // MEASURED at 2.6x its cap against Film A's 1.65x — what makes a two-line
    // monid card read as two separate statements rather than a wrapped one.
    const led = STYLE_PRESETS.ledger.type;
    assert.ok(led.pitchPx / led.capPx > 2.4, "ledger pitch/cap");
    const pf = STYLE_PRESETS.proof.type;
    assert.ok(pf.pitchPx / pf.capPx < 1.8, "proof pitch/cap");
  });
});

describe("shot motion and bookend length", () => {
  it("gives every shots-layer style something that actually moves", () => {
    // The failure this catches was invisible to every other test and only
    // showed up in a render: narration removed the card motion, supplied no
    // shot motion, and measured 18% moving against a 36.8% target — LESS
    // lively than the grammar it replaced.
    for (const name of STYLES) {
      const p = STYLE_PRESETS[name];
      if (p.motionLayer !== "shots") continue;
      const moves =
        p.shot.enter.kind !== "none" ||
        p.shot.exit.kind !== "none" ||
        p.join.kind === "dissolve";
      assert.ok(moves, `${name}: motionLayer "shots" but nothing on the shots`);
    }
  });

  it("scales narration's shots in, per Film B's measured window", () => {
    // Fit B: 841 -> 941 px over 23 frames, so the shot starts at 0.894 of rest.
    const e = STYLE_PRESETS.narration.shot.enter;
    assert.equal(e.kind, "push");
    if (e.kind !== "push") return;
    assert.equal(e.axis, "scale");
    assert.equal(Math.round((1 + e.dist) * 1000) / 1000, 0.894);
    assert.equal(e.frames, 23);
  });

  it("floors a bookend even where sentences have no clamp", () => {
    // narration refuses to slot its sentences AND insists its sign-off
    // breathes — the two are different questions, which is why they are
    // different fields. Film B: sentences 31-89f, logo card 90f.
    assert.equal(STYLE_PRESETS.narration.card.length.minS, null);
    assert.ok((STYLE_PRESETS.narration.bookend.minS ?? 0) >= 3);
  });

  it("never lets a bookend floor fall below the card floor", () => {
    // A bookend shorter than an ordinary card would read as a mistake.
    for (const name of STYLES) {
      const p = STYLE_PRESETS[name];
      if (p.bookend.minS == null || p.card.length.minS == null) continue;
      assert.ok(
        p.bookend.minS >= p.card.length.minS,
        `${name}: bookend ${p.bookend.minS}s < card ${p.card.length.minS}s`,
      );
    }
  });
});
