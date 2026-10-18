import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Brief } from "./brief";
import type { ClickLog } from "./click-log";
import { FPS } from "./click-log";
import { compileBrief, type Compiled } from "./compile-brief";
import { demoDurationInFrames, demoGeometry } from "./demo-duration";
import { HOUSES } from "./house";
import {
  audioProblem,
  isCard,
  isClip,
  overlapJoins,
  reelProblem,
  resolveReel,
  segmentFrameCounts,
  segmentJoins,
  type ReelClip,
} from "./reel";
import { clickReelTimes } from "./reel-audio";
import { applySequence, STYLE_PRESETS } from "./style";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/${name}.clicks.json`, import.meta.url),
      "utf8",
    ),
  ) as ClickLog;
const BASIC = fixture("brief-basic");
const RESHOOT = fixture("brief-reshoot");
const STAGE = HOUSES["agenta@1"];
const CLASSIC = HOUSES["agenta-classic@1"];

const BRIEF: Brief = {
  version: 1,
  name: "launch",
  demo: "brief-basic",
  source: "reels/launch.post.md",
  title: "Introducing Skills",
  beats: [
    {
      card: "Name it and pick a cadence.",
      show: { from: "name the skill", to: "pick Daily" },
    },
    {
      card: "Write the instructions in Markdown.",
      show: { from: "write SKILL.md" },
    },
  ],
  payoff: { card: "Hit {chip}. It's live.", chip: "Create", text: "Create" },
  signoff: "Agents that learn on the job.",
};

const compiled = (
  brief: Brief = BRIEF,
  log = BASIC,
  house = STAGE,
): Compiled => {
  const r = compileBrief(brief, log, house);
  if ("problems" in r) throw new Error(JSON.stringify(r.problems));
  return r;
};
const resolved = (c: Compiled, log = BASIC, house = STAGE) => {
  const r = resolveReel(c.reel, log, house.shoot.speed);
  if ("problem" in r) throw new Error(r.problem);
  return r.reel;
};
const ranges = (c: Compiled, log = BASIC) =>
  resolved(c, log)
    .segments.filter(isClip)
    .map((s) => [s.clip.fromS, s.clip.toS]);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("compileBrief structure", () => {
  it("cuts title, card, clip, card, clip, payoff card, clip, sign-off", () => {
    const c = compiled();
    assert.deepEqual(
      c.reel.segments.map((s) => (isCard(s) ? "card" : "clip")),
      ["card", "card", "clip", "card", "clip", "card", "clip", "card"],
    );
    assert.deepEqual(c.sources, [
      "title",
      "beats[0].card",
      "beats[0].show",
      "beats[1].card",
      "beats[1].show",
      "payoff.card",
      "payoff.chip",
      "signoff",
    ]);
    assert.equal(c.reel.style, "stage");
    assert.equal(c.reel.demo, "brief-basic");
    const [title, , , , , , , signoff] = c.reel.segments;
    assert.ok(isCard(title) && isCard(signoff));
    assert.equal(title.card.headline, "Introducing Skills");
    assert.equal(title.card.wordmark, "Agenta");
    assert.equal(signoff.card.wordmark, "Agenta");
  });

  it("writes every clip as anchors, never seconds", () => {
    const clips = compiled().reel.segments.filter(isClip);
    for (const { clip } of clips) {
      assert.equal(clip.fromS, undefined);
      assert.equal(clip.toS, undefined);
    }
    assert.deepEqual(
      clips.map(({ clip }) => [
        clip.fromBeat,
        clip.leadS,
        clip.toBeat,
        clip.toEdge,
        clip.tailS,
      ]),
      [
        ["name the skill", -0.2, "pick Daily", undefined, 1.2],
        ["write SKILL.md", -0.2, "write SKILL.md", undefined, 2.7],
        ["Create", -0.2, "Create", undefined, 1.5],
      ],
    );
  });

  it("ends a typing beat on its typing end plus the house tail", () => {
    const brief: Brief = {
      ...BRIEF,
      beats: [
        { card: "Name it.", show: { from: "Add skill", to: "name the skill" } },
        BRIEF.beats![1],
      ],
    };
    const [first] = compiled(brief).reel.segments.filter(isClip);
    assert.equal(first.clip.toBeat, "name the skill");
    assert.equal(first.clip.toEdge, "typeEnd");
    assert.equal(first.clip.tailS, 1.8);
    const [range] = ranges(compiled(brief));
    assert.ok(near(range[1], 5.2712 + 1.8), String(range[1]));
  });

  it("names a repeated label by its occurrence", () => {
    const brief: Brief = {
      ...BRIEF,
      beats: [
        { card: "Open the menu again.", show: { from: "open menu#2" } },
        BRIEF.beats![1],
      ],
    };
    assert.equal(
      compiled(brief).reel.segments.filter(isClip)[0].clip.fromBeat,
      "open menu#2",
    );
  });
});

describe("house rules", () => {
  it("lights every card but the dark sign-off", () => {
    const backgrounds = compiled()
      .reel.segments.filter(isCard)
      .map((s) => s.card.background);
    assert.deepEqual(backgrounds, [
      "light",
      "light",
      "light",
      "light",
      "plain",
    ]);
  });

  it("carries the chip on the payoff card and opens its clip framed on the chip", () => {
    const segs = compiled().reel.segments;
    const card = segs[5];
    const clip = segs[6];
    assert.ok(isCard(card) && isClip(clip));
    assert.deepEqual(card.card.chip, { label: "Create", tone: "dark" });
    assert.deepEqual(clip.clip.open, { scale: 1.6, at: "Create" });
  });

  it("puts the control's text on the pill, never the label", () => {
    const brief: Brief = {
      ...BRIEF,
      beats: [
        BRIEF.beats![0],
        { card: "Open the menu again.", show: { from: "open menu#2" } },
      ],
      payoff: {
        card: "Write {chip}.",
        chip: "write SKILL.md",
        text: "SKILL.md",
      },
    };
    const card = compiled(brief).reel.segments[5];
    assert.ok(isCard(card));
    assert.deepEqual(card.card.chip, { label: "SKILL.md", tone: "dark" });
    const fromCatalog = compileBrief(brief, BASIC, STAGE, "Editor");
    assert.ok(!("problems" in fromCatalog));
    const pill = fromCatalog.reel.segments[5];
    assert.ok(isCard(pill));
    assert.equal(pill.card.chip?.label, "Editor");
    const { text: _t, ...bare } = brief.payoff!;
    const none = compileBrief({ ...brief, payoff: bare }, BASIC, STAGE);
    assert.ok("problems" in none);
    assert.deepEqual(
      none.problems.map((p) => p.path),
      ["payoff.chip"],
    );
  });

  it("reports a clip the typing cap shortened", () => {
    const { notes } = compiled();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].path, "beats[1].show");
    assert.equal(notes[0].cap, "typing");
    assert.ok(near(notes[0].cutS, 15.516 + 1.8 - 12.7), String(notes[0].cutS));
    assert.equal(
      notes[0].message,
      "typing held to the 2.7s typing cap; 4.62s cut",
    );
  });

  it("fails two beats that would overlap, naming both", () => {
    const close = {
      ...BASIC,
      clicks: BASIC.clicks.map((c) =>
        c.label === "pick Daily" ? { ...c, tDownMs: 8050, tMs: 8150 } : c,
      ),
    };
    const brief: Brief = {
      ...BRIEF,
      beats: [
        { card: "Open the menu.", show: { from: "open menu#1" } },
        { card: "Pick a cadence.", show: { from: "pick Daily" } },
      ],
    };
    const r = compileBrief(brief, close, STAGE);
    assert.ok("problems" in r);
    assert.deepEqual(
      r.problems.map((p) => p.path),
      ["beats[1].show"],
    );
    assert.match(
      r.problems[0].message,
      /^beats\[0\]\.show and beats\[1\]\.show compile to overlapping clips/,
    );
  });

  it("fits the bed to the reel and fades it out at the end", () => {
    const c = compiled();
    assert.equal(c.runtimeS, 21.3);
    assert.deepEqual(c.reel.audio, [
      {
        src: "audio/intro.mp3",
        trim: { fromS: 0, toS: c.runtimeS },
        start: 0,
        duration: c.runtimeS,
        gain: 1,
        fadeInS: 0.2,
        fadeOutS: 2.5,
        role: "bed",
      },
    ]);
    assert.equal(c.reel.loudnessLUFS, -14);
    assert.equal(c.reel.duck, true);
  });

  it("lands the confirm on the payoff label", () => {
    const c = compiled();
    assert.deepEqual(c.reel.sfx?.confirm, {
      src: "audio/sfx/confirm.wav",
      gain: 2.5,
      atLabels: ["Create"],
    });
    const reel = resolved(c);
    const preset = STYLE_PRESETS[STAGE.style];
    const segments = applySequence(reel.segments, preset);
    const counts = segmentFrameCounts({ ...reel, segments }, FPS);
    const { joins } = overlapJoins(
      segments,
      segmentJoins(segments, preset.join),
      preset,
    );
    const [hit] = clickReelTimes(
      segments,
      counts,
      FPS,
      BASIC,
      1.25,
      "confirm",
      ["Create"],
      joins,
    );
    const payoffStart =
      counts.slice(0, 6).reduce((a, b) => a + b, 0) -
      joins.slice(0, 6).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(hit - (payoffStart / FPS + 0.2)) < 1 / FPS, `${hit}`);
  });

  it("compiles under the classic house with its drift and holds", () => {
    const c = compiled(BRIEF, BASIC, CLASSIC);
    assert.equal(c.reel.style, "classic");
    assert.deepEqual(
      c.reel.segments.filter(isClip).map((s) => s.clip.drift),
      [1, 1, 1],
    );
    assert.deepEqual(
      c.reel.segments.filter(isCard).map((s) => s.card.holdS),
      [undefined, 0.9, 0.9, 0.5, 1.4],
    );
  });
});

describe("determinism and re-shoots", () => {
  it("compiles the same reel twice", () => {
    assert.deepEqual(compiled(), compiled());
  });

  it("moves every clip by exactly the re-shoot's +1.04s", () => {
    const before = ranges(compiled());
    const after = ranges(compiled(BRIEF, RESHOOT), RESHOOT);
    assert.equal(after.length, before.length);
    after.forEach(([from, to], i) => {
      assert.ok(
        Math.abs(from - before[i][0] - 1.04) < 1e-9,
        `clip ${i} from ${from} vs ${before[i][0]}`,
      );
      assert.ok(
        Math.abs(to - before[i][1] - 1.04) < 1e-9,
        `clip ${i} to ${to} vs ${before[i][1]}`,
      );
    });
  });
});

describe("compiled reels pass the reel checks", () => {
  for (const house of [STAGE, CLASSIC])
    for (const aspect of house.aspects)
      it(`${house.id} at ${aspect}`, () => {
        const c = compiled(BRIEF, BASIC, house);
        const reel = resolved(
          { ...c, reel: { ...c.reel, aspect } },
          BASIC,
          house,
        );
        const total = demoDurationInFrames(
          BASIC,
          house.shoot.speed,
          demoGeometry(BASIC),
          FPS,
        );
        assert.equal(reelProblem(reel, total), null);
        assert.equal(
          audioProblem(reel.audio, undefined, FPS, reel.segments.length),
          null,
        );
        assert.equal(
          reel.segments.filter((s): s is ReelClip => isClip(s)).length,
          3,
        );
      });
});

describe("one-take compilation", () => {
  const ONE_TAKE = HOUSES["agenta@2"];
  const { beats: _b, payoff: _p, signoff: _s, ...COMMON } = BRIEF;
  const ONE: Brief = { ...COMMON, house: "agenta@2", outro: ["Agents that learn on the job."] };
  const take = (log = BASIC, brief: Brief = ONE) => {
    const r = compileBrief(brief, log, ONE_TAKE);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    return r as Compiled;
  };

  it("is title, one clip from the first action to the last, the outro, then the logo", () => {
    const r = take();
    const kinds = r.reel.segments.map((s) => (isCard(s) ? "card" : "clip"));
    assert.deepEqual(kinds, ["card", "clip", "card", "card"]);
    assert.deepEqual(r.sources, ["title", "footage", "outro[0]", "logo"]);
    const clip = r.reel.segments[1] as { clip: Record<string, unknown> };
    assert.deepEqual(
      { from: clip.clip.fromBeat, lead: clip.clip.leadS, to: clip.clip.toBeat, tail: clip.clip.tailS },
      { from: "Add skill", lead: -0.2, to: "Create", tail: 1.2 },
    );
    const logo = r.reel.segments[3] as { card: { logo?: boolean; headline: string } };
    assert.deepEqual([logo.card.logo, logo.card.headline], [true, "Agenta"]);
    assert.equal(r.reel.style, "one-take");
    assert.equal(r.reel.brand, "agenta");
    assert.deepEqual(r.notes, []);
  });

  it("moves the whole take with a re-shoot, and nothing else", () => {
    const a = resolveReel(take(BASIC).reel, BASIC, ONE_TAKE.shoot.speed);
    const b = resolveReel(take(RESHOOT).reel, RESHOOT, ONE_TAKE.shoot.speed);
    assert.ok(!("problem" in a) && !("problem" in b));
    const [ca, cb] = [a, b].map((r) => (r as { reel: { segments: ReelClip[] } }).reel.segments.find(isClip)!.clip);
    assert.equal(Number((cb.fromS - ca.fromS).toFixed(4)), 1.04);
    assert.equal(Number((cb.toS - ca.toS).toFixed(4)), 1.04);
  });

  it("refuses a reel longer than the house allows, before rendering", () => {
    const long = { ...ONE_TAKE, maxLengthS: 10 };
    const r = compileBrief(ONE, BASIC, long);
    assert.ok("problems" in r);
    assert.match(r.problems[0].message, /^the reel runs \d+\.\d\ds, past agenta@2's 10s maximum/);
    assert.equal(r.problems[0].path, "footage");
  });

  it("is deterministic", () => {
    assert.deepEqual(take(), take());
  });

  it("cuts the take after a label, resuming on the next action", () => {
    const r = compileBrief({ ...ONE, cuts: ["Add skill"] }, BASIC, ONE_TAKE);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    const clips = r.reel.segments.filter(isClip) as ReelClip[];
    assert.equal(clips.length, 2);
    assert.deepEqual(r.sources, ["title", "footage[0]", "footage[1]", "outro[0]", "logo"]);
    const resolved = resolveReel(r.reel, BASIC, ONE_TAKE.shoot.speed);
    assert.ok(!("problem" in resolved));
    const [a, b] = (resolved as { reel: { segments: ReelClip[] } }).reel.segments.filter(isClip).map((s) => s.clip);
    assert.ok(a.toS < b.fromS, `${a.toS} then ${b.fromS}`);
    assert.match(String((clips[1].clip as { label?: string }).label), /^name the skill/);
  });

  it("cuts to another recording, with a message card at the cut", () => {
    const log = Object.assign({ ...BASIC }, { scenes: (d: string) => (d === "scene" ? RESHOOT : null) });
    const cuts = [{ after: "Add skill", demo: "scene", line: "Then it does this." }];
    const r = compileBrief({ ...ONE, cuts }, log, ONE_TAKE);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    assert.deepEqual(r.sources, ["title", "footage[0]", "cuts[0].line", "footage[1]", "outro[0]", "logo"]);
    const [first, line, second] = r.reel.segments.slice(1, 4) as { clip?: { demo?: string; fromBeat?: string }; card?: { headline: string } }[];
    assert.equal(first.clip?.demo, undefined);
    assert.equal(line.card?.headline, "Then it does this.");
    assert.equal(second.clip?.demo, "scene");
    assert.equal(second.clip?.fromBeat, "Add skill");
  });

  it("ends a run on its cut's own tail, to cut on the click", () => {
    const r = compileBrief({ ...ONE, cuts: [{ after: "Add skill", tailS: 0.2 }] }, BASIC, ONE_TAKE);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    const [first] = r.reel.segments.filter(isClip) as ReelClip[];
    assert.equal((first.clip as { tailS?: number }).tailS, 0.2);
  });

  it("names a cut's recording that has no click log", () => {
    const r = compileBrief({ ...ONE, cuts: [{ after: "Add skill", demo: "nowhere" }] }, BASIC, ONE_TAKE);
    assert.ok("problems" in r);
    assert.deepEqual(r.problems[0], { path: "cuts[0].demo", message: '"nowhere" has no click log: record and convert it first' });
  });

  it("refuses a cut with nothing to skip before the next action", () => {
    const r = compileBrief({ ...ONE, cuts: ["name the skill"] }, BASIC, ONE_TAKE);
    assert.ok("problems" in r);
    assert.equal(r.problems[0].path, "cuts[0]");
    assert.match(r.problems[0].message, /too closely to cut between them/);
  });

  it("carries agenta@7's render profile onto the reel, and only there", () => {
    const r = compileBrief({ ...ONE, house: "agenta@7" }, BASIC, HOUSES["agenta@7"]);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    assert.deepEqual(r.reel.render, { scale: 0.75, motionBlur: false });
    assert.equal(take().reel.render, undefined);
  });

  it("opens agenta@6 wide, at the footage's start, on a poster title", () => {
    const six = HOUSES["agenta@6"];
    const r = compileBrief({ ...ONE, house: "agenta@6" }, BASIC, six);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    const resolved = resolveReel(r.reel, BASIC, six.shoot.speed);
    assert.ok(!("problem" in resolved));
    const clip = (resolved as { reel: { segments: ReelClip[] } }).reel.segments.find(isClip)!.clip;
    assert.equal(Number(clip.fromS.toFixed(4)), 0.05);
    assert.equal((r.reel.segments[0] as { card: { poster?: boolean } }).card.poster, true);
    assert.equal((take().reel.segments[0] as { card: { poster?: boolean } }).card.poster, undefined);
  });

  it("floats the take in agenta@5's window on the pack's grey, and only there", () => {
    assert.equal(take().reel.window, undefined);
    const r = compileBrief({ ...ONE, house: "agenta@5" }, BASIC, HOUSES["agenta@5"]);
    assert.ok(!("problems" in r), JSON.stringify("problems" in r && r.problems));
    assert.deepEqual(r.reel.window, { ground: "#ebeaea", camera: "inside" });
  });
});
