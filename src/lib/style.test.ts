import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { BACKGROUNDS } from "./intro";
import {
  DEFAULT_STYLE,
  FONT_STACK_LEGACY,
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

  it("locks ledger's cards perfectly still", () => {
    // The defining measurement is an ABSENCE: docs/reel/02-motion.md tracks
    // Film B's shot 10 text box over 56 frames and finds zero translation. A
    // card that moved even slightly would put this grammar on the wrong motion
    // layer.
    //
    // Asserted on `ledger` because it absorbed the `narration` preset — these
    // are the values the two shared, and they are why the merge was possible.
    assert.equal(STYLE_PRESETS.ledger.card.enter.kind, "none");
    assert.equal(STYLE_PRESETS.ledger.card.exit.kind, "none");
    assert.equal(STYLE_PRESETS.ledger.motionLayer, "shots");
  });

  it("gives ledger no card slot, so length follows the copy", () => {
    // Film A slots every card into 3.2-3.3s; Film B runs 31-89f as the words
    // require. Clamping this would erase the difference between the two.
    assert.equal(STYLE_PRESETS.ledger.card.length.minS, null);
    assert.equal(STYLE_PRESETS.ledger.card.length.maxS, null);
    assert.notEqual(STYLE_PRESETS.proof.card.length.minS, null);
  });

  it("reproduces Film B's measured 31-89f card band from its own model", () => {
    // The band is a CONSEQUENCE of stagger + hold, not an input. If this drifts
    // outside the reference's range the two numbers have stopped agreeing.
    // On `ledger`, which carries Film B's card model verbatim — monid never
    // cuts between cards, so it had no tail of its own to measure and this is
    // where its 1.16s hold came from.
    const { cadence, length } = STYLE_PRESETS.ledger.card;
    // Narrowing rather than casting: if this is ever re-cut as a typewriter the
    // test stops compiling, which is the correct outcome — a per-character
    // grammar has no word band to reproduce.
    assert.notEqual(cadence.kind, "typed", "ledger schedules words");
    const staggerS = cadence.kind === "typed" ? 0 : cadence.staggerS;
    const cardF = (words: number) =>
      Math.round((Math.max(0, words - 1) * staggerS + length.holdS) * 30);
    assert.ok(cardF(1) >= 31 && cardF(1) <= 45, `1 word -> ${cardF(1)}f`);
    assert.ok(cardF(10) >= 75 && cardF(10) <= 95, `10 words -> ${cardF(10)}f`);
  });

  it("snaps ledger's chip in 3 frames, and does not paste 7.82x", () => {
    // punchS is directly transferable; punchScale is a COMPOSITION target and
    // Film B's 7.82 is a raw pill ratio. Pasting it is the Q4 trap.
    assert.equal(Math.round(STYLE_PRESETS.ledger.chip.punchS * 30), 3);
    assert.notEqual(STYLE_PRESETS.ledger.chip.punchScale, 7.82);
  });

  it("matches ledger's cuts instead of slamming them", () => {
    assert.equal(STYLE_PRESETS.ledger.targets?.cutDelta, "matched");
    assert.equal(STYLE_PRESETS.proof.targets?.cutDelta, "slam");
  });
});

describe("resolveStyle", () => {
  it("defaults to proof, and that RESTYLES a silent reel", () => {
    // This used to assert "classic", on the grounds that
    // reels/agent-skill.ts and agent-slash-command.ts carry no look field and
    // any other default silently restyles them. It does restyle them — that was
    // the decision, not an accident. Both moved from the framed window to
    // full-bleed, and a reel that must not move now has to pin `look: "framed"`.
    assert.equal(resolveStyle({}), "proof");
    assert.equal(DEFAULT_STYLE, "proof");
    assert.equal(STYLE_PRESETS[DEFAULT_STYLE].look, "fullbleed");
  });

  it("still honours an explicitly named framed look", () => {
    // The half that must NOT move. While the default was "classic", `framed`
    // could fall through to it and mean the right thing; now falling through
    // would resolve an explicit framed request to a full-bleed grammar, so
    // resolveStyle maps both looks by name.
    assert.equal(resolveStyle({ look: "framed" }), "classic");
    assert.equal(STYLE_PRESETS[resolveStyle({ look: "framed" })].look, "framed");
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
    assert.ok(isStyle("ledger"));
    // "narration" was MERGED INTO ledger. A reel still naming it must fail
    // validation loudly rather than silently resolving to the default.
    assert.ok(!isStyle("narration"));
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

  it("gives ledger two grounds — cream and one accent, monid's own scheme", () => {
    // ⚠️ THIS TEST USED TO ASSERT FILM B's THREE-GROUND CODE — white narrates,
    // warm grey is the workbench, black is the third-party register — on the
    // `narration` preset. That preset was merged into ledger, and ledger keeps
    // monid's palette, which has no third register. So the role-assignment
    // scheme is no longer implemented by anything; it is recorded on the
    // cursor_origin_intro entry in REFERENCE_FILMS.
    //
    // What IS still worth guarding is that ledger's own scheme stays coherent:
    // one ground for everything, plus a single saturated accent for the payoff.
    const p = STYLE_PRESETS.ledger.palette;
    assert.equal(p.plain.ground, p.light.ground, "one working ground");
    assert.notEqual(p.plate.ground, p.plain.ground, "the accent must differ");
    assert.equal(new Set(Object.values(p).map((g) => g.ground)).size, 2);
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

  it("sets ledger's leading for a wrapped sentence, not the reference's pitch", () => {
    // monid MEASURES 2.6x cap (pitch 181 on cap 70), and we deliberately do
    // not use it: that openness works because each monid line is its own
    // statement, where our copy is one sentence that wraps, and an open pitch
    // put a hole through the middle of it.
    //
    // This guards the departure in BOTH directions — a revert to 1.85 and an
    // over-correction into cramped setting are equally wrong — because the
    // number is authored rather than measured, so nothing else would catch it
    // drifting.
    const led = STYLE_PRESETS.ledger.type;
    assert.ok(
      led.lineHeight > 1.15 && led.lineHeight < 1.45,
      `ledger lineHeight ${led.lineHeight}`,
    );
    assert.ok(led.pitchPx < 181, "ledger pitch is below monid's measured 181");
    const pf = STYLE_PRESETS.proof.type;
    assert.ok(pf.pitchPx / pf.capPx < 1.8, "proof pitch/cap");
  });

  it("keeps the pre-font-field styles on the face they shipped with", () => {
    // The face is the one type field that can fail SILENTLY: name a family
    // nothing loads and the browser falls back without complaint, which is
    // exactly the state the ledger cards were in before font.ts existed.
    //
    // Named explicitly rather than "everything except ledger": a new style is
    // FREE to pick a face, and a test that forbids it would have to be edited
    // every time one is added — which is how a guard stops guarding.
    for (const name of ["classic", "proof"] as const)
      assert.equal(
        STYLE_PRESETS[name].type.fontFamily,
        FONT_STACK_LEGACY,
        `${name} shipped before TypeStyle.fontFamily and must not move`,
      );
  });

  it("only names a face src/lib/font.ts actually loads", () => {
    // A family nothing registers falls back silently, and then the measured
    // cap and pitch stop meaning anything. font.ts loads exactly one file.
    const loaded = fs.readFileSync(
      path.join(process.cwd(), "src/lib/font.ts"),
      "utf8",
    );
    for (const name of STYLES) {
      const stack = STYLE_PRESETS[name].type.fontFamily;
      const first = stack.split(",")[0].trim().replace(/^"|"$/g, "");
      if (stack === FONT_STACK_LEGACY) continue;
      assert.ok(
        loaded.includes(`"${first}"`) || loaded.includes(`= "${first}"`),
        `${name} names "${first}", which font.ts does not load`,
      );
    }
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

  it("holds ledger's shots still, which is where it PARTS from Film B", () => {
    // ⚠️ THIS TEST USED TO ASSERT FILM B's SHOT ENTRANCE — 841 -> 941px over 23
    // frames, i.e. starting at 0.894 of rest — on the `narration` preset.
    //
    // It is one of exactly TWO mechanism differences that survived the merge
    // into ledger (the other is cut vs dissolve), and ledger kept monid's:
    // the shot does not move. Film B's measured push is recorded on the
    // cursor_origin_intro entry in REFERENCE_FILMS, so re-adding that preset is
    // a data change rather than a re-measurement.
    assert.equal(STYLE_PRESETS.ledger.shot.enter.kind, "none");
    assert.equal(STYLE_PRESETS.ledger.join.kind, "dissolve");
  });

  it("floors a bookend even where sentences have no clamp", () => {
    // A grammar can refuse to slot its SENTENCES and still insist its sign-off
    // breathes — two different questions, which is why they are two fields.
    // Film B: sentences 31-89f, logo card 90f.
    //
    // Asserted as "a floor exists" rather than against a specific number: the
    // number is per-style (ledger 2.2s, stage 3.0s because its mark performs
    // alone first), and pinning one here made the test about that style rather
    // than about the rule.
    for (const name of ["ledger", "stage"] as const) {
      assert.equal(STYLE_PRESETS[name].card.length.minS, null, name);
      assert.ok((STYLE_PRESETS[name].bookend.minS ?? 0) > 0, name);
    }
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
