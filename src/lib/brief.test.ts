import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  briefLabels,
  briefProblems,
  chipText,
  copyProblems,
  copyWords,
  labelLines,
  type Brief,
  type BriefContext,
  type CatalogAction,
  type Catalog,
  type Problem,
} from "./brief";
import type { ClickLog } from "./click-log";
import { HOUSES } from "./house";

const CATALOG: Catalog = {
  surfaces: new Map([
    ["agent", {}],
    ["other", {}],
  ]),
  actions: new Map(
    (<CatalogAction[]>[
      {
        id: "skills.add",
        surface: "agent",
        params: { name: { type: "string", maxLength: 20 } },
        labels: [
          "Add skill",
          "name the skill",
          "describe the skill",
          "write SKILL.md",
          { label: "Create", control: "Create" },
        ],
      },
      {
        id: "tools.add",
        surface: "agent",
        params: {},
        labels: ["Add tool", "Done"],
      },
      {
        id: "chat.open",
        surface: "other",
        params: {},
        labels: ["Open chat"],
      },
    ]).map((a) => [a.id, a] as const),
  ),
};

const BASIC = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/brief-basic.clicks.json", import.meta.url),
    "utf8",
  ),
) as ClickLog;

const POSTS: Record<string, string> = {
  "reels/launch.post.md": "We shipped skills.",
  "reels/blank.post.md": "  \n",
};
const CTX: BriefContext = {
  catalog: CATALOG,
  readSource: (p) => POSTS[p] ?? null,
};

const VALID = {
  version: 1,
  name: "launch",
  // The beats shape, pinned: the default house (agenta@2) cuts one take.
  house: "agenta@1",
  source: "reels/launch.post.md",
  footage: {
    surface: "agent",
    actions: [{ use: "skills.add", with: { name: "pr-review" } }],
  },
  title: "Introducing Skills",
  beats: [
    {
      card: "Name it and say when.",
      show: { from: "Add skill", to: "describe the skill" },
    },
    {
      card: "Write the instructions in Markdown.",
      show: { from: "write SKILL.md" },
    },
  ],
  payoff: { card: "Hit {chip}. It's live.", chip: "Create" },
  signoff: "Agents that learn on the job.",
};

const brief = (patch: Record<string, unknown>) => ({ ...VALID, ...patch });
const paths = (ps: Problem[]) => ps.map((p) => p.path);
const one = (ps: Problem[], path: string) => {
  const hit = ps.filter((p) => p.path === path);
  assert.equal(
    hit.length,
    1,
    `expected one problem at ${path}, got ${JSON.stringify(ps)}`,
  );
  return hit[0].message;
};

describe("brief shape", () => {
  it("passes a minimal brief with footage, with nothing recorded", () => {
    assert.deepEqual(briefProblems(VALID, CTX), []);
  });

  it("needs exactly one of footage or demo", () => {
    assert.equal(
      one(
        briefProblems(brief({ demo: "agent-skill" }), { ...CTX, log: BASIC }),
        "footage",
      ),
      "and `demo` are both set; exactly one is required (footage to shoot, or a recorded demo to cut)",
    );
    const { footage: _f, ...neither } = VALID;
    assert.equal(
      one(briefProblems(neither, CTX), ""),
      "needs exactly one of `footage` (actions to shoot) or `demo` (a recorded demo to cut)",
    );
  });

  it("rejects an unknown field, naming its path and the allowed fields", () => {
    const ps = briefProblems(
      brief({ beats: [VALID.beats[0], { ...VALID.beats[1], holdS: 2 }] }),
      CTX,
    );
    assert.deepEqual(ps, [
      {
        path: "beats[1].holdS",
        message: "is not a brief field. Allowed here: card, show",
      },
    ]);
  });

  it("requires the source post to exist and hold text", () => {
    assert.equal(
      one(briefProblems(brief({ source: "reels/foo.post.md" }), CTX), "source"),
      "names reels/foo.post.md, which does not exist. Save the post there verbatim",
    );
    assert.equal(
      one(
        briefProblems(brief({ source: "reels/blank.post.md" }), CTX),
        "source",
      ),
      "names reels/blank.post.md, which is empty",
    );
  });

  it("checks the name against the file", () => {
    assert.equal(
      one(briefProblems(VALID, { ...CTX, fileName: "other" }), "name"),
      'is "launch" but the file is reels/other.brief.json',
    );
  });

  it("names the published houses for an unknown one", () => {
    assert.equal(
      one(briefProblems(brief({ house: "agenta@99" }), CTX), "house"),
      'unknown house "agenta@99". Published: agenta@1, agenta-classic@1, agenta@2, agenta@3, agenta@4, agenta@5, agenta@6, agenta@7.',
    );
  });
});

describe("footage against the action library", () => {
  const footage = (actions: unknown[], surface = "agent") =>
    brief({ footage: { surface, actions } });

  it("lists the surface's actions for an unknown one", () => {
    assert.equal(
      one(
        briefProblems(footage([{ use: "skills.remove", with: {} }]), CTX),
        "footage.actions[0].use",
      ),
      'unknown action "skills.remove". Actions on agent: skills.add, tools.add',
    );
  });

  it("names an action's own surface", () => {
    assert.equal(
      one(
        briefProblems(footage([{ use: "chat.open", with: {} }]), CTX),
        "footage.actions[0].use",
      ),
      '"chat.open" runs on surface "other", not "agent"',
    );
  });

  it("checks every parameter rule", () => {
    const ps = briefProblems(footage([{ use: "skills.add", with: {} }]), CTX);
    assert.equal(
      one(ps, "footage.actions[0].with.name"),
      "is required (string, 1-20 chars)",
    );
    const typed = briefProblems(
      footage([{ use: "skills.add", with: { name: 3, colour: "red" } }]),
      CTX,
    );
    assert.equal(
      one(typed, "footage.actions[0].with.name"),
      "must be a string, got number",
    );
    assert.equal(
      one(typed, "footage.actions[0].with.colour"),
      "is not a parameter of this action. Allowed: name",
    );
    const long = briefProblems(
      footage([{ use: "skills.add", with: { name: "x".repeat(21) } }]),
      CTX,
    );
    assert.equal(
      one(long, "footage.actions[0].with.name"),
      "must be at most 20 characters, got 21",
    );
  });
});

describe("copy and beats against the house", () => {
  it("caps the beat count", () => {
    const beats = [
      "Add skill",
      "name the skill",
      "describe the skill",
      "write SKILL.md",
      "Create",
      "Create",
    ].map((from, i) => ({
      card: "Write the instructions in Markdown.",
      show: { from: i === 5 ? "Create" : from },
    }));
    assert.equal(
      one(briefProblems(brief({ beats, payoff: undefined }), CTX), "beats"),
      "has 6 beat(s); agenta@1 takes 2-5",
    );
  });

  it("names a card that is too long, its count and the range", () => {
    const beats = [
      {
        card: "This card goes on for far more words than any card should.",
        show: { from: "Add skill" },
      },
      VALID.beats[1],
    ];
    assert.equal(
      one(briefProblems(brief({ beats }), CTX), "beats[0].card"),
      "has 12 words; a beat card under agenta@1 takes 2-7",
    );
  });

  it("refuses emphasis under a style that renders none", () => {
    const proofHouse = {
      ...HOUSES["agenta@1"],
      id: "test@1",
      style: "proof" as const,
    };
    assert.deepEqual(
      copyProblems(
        "Meet ==Skills== today",
        "beat",
        "beats[0].card",
        proofHouse,
      ),
      [
        {
          path: "beats[0].card",
          message:
            'uses ==emphasis==, which the "proof" style of test@1 renders as plain ink. Remove the markers',
        },
      ],
    );
    assert.deepEqual(
      copyProblems(
        "Meet ==Skills== today",
        "beat",
        "beats[0].card",
        HOUSES["agenta@1"],
      ),
      [],
    );
  });

  it("quotes a banned word and where it is", () => {
    assert.equal(
      one(
        briefProblems(brief({ signoff: "Seamless agents, every day." }), CTX),
        "signoff",
      ),
      'uses the banned word "seamless". Say what the feature does instead',
    );
  });

  it("counts words as a viewer reads them", () => {
    assert.deepEqual(copyWords("One search. ==1,327|#f0f05a== apps."), [
      "One",
      "search.",
      "1,327",
      "apps.",
    ]);
    assert.deepEqual(copyWords("Model, tools, permissions — one command."), [
      "Model,",
      "tools,",
      "permissions",
      "one",
      "command.",
    ]);
  });
});

describe("labels", () => {
  it("lists near misses for an unknown label", () => {
    const beats = [
      { ...VALID.beats[0], show: { from: "Add skil" } },
      VALID.beats[1],
    ];
    assert.equal(
      one(briefProblems(brief({ beats }), CTX), "beats[0].show.from"),
      'no label "Add skil". Near misses: "Add skill"',
    );
  });

  it("lists every label when nothing is near", () => {
    const beats = [
      { ...VALID.beats[0], show: { from: "Zebra" } },
      VALID.beats[1],
    ];
    assert.equal(
      one(briefProblems(brief({ beats }), CTX), "beats[0].show.from"),
      'no label "Zebra". Available: "Add skill", "name the skill", "describe the skill", "write SKILL.md", "Create"',
    );
  });

  it("refuses an ambiguous label and lists each occurrence", () => {
    const demo = brief({
      footage: undefined,
      demo: "brief-basic",
      payoff: { ...VALID.payoff, text: "Create" },
      beats: [
        { card: "Open the menu twice.", show: { from: "open menu" } },
        {
          card: "Write the instructions in Markdown.",
          show: { from: "write SKILL.md" },
        },
      ],
    });
    const { footage: _f, ...cut } = demo;
    assert.equal(
      one(briefProblems(cut, { ...CTX, log: BASIC }), "beats[0].show.from"),
      '"open menu" is ambiguous; it occurs 2 times: "open menu#1" at 6.40s, "open menu#2" at 8.80s. Name one',
    );
    const named = {
      ...cut,
      beats: [{ ...cut.beats[0], show: { from: "open menu#2" } }, cut.beats[1]],
    };
    assert.deepEqual(briefProblems(named, { ...CTX, log: BASIC }), []);
  });

  it("names both beats when they are out of order", () => {
    const beats = [
      VALID.beats[1],
      { ...VALID.beats[0], show: { from: "name the skill" } },
    ];
    assert.equal(
      one(briefProblems(brief({ beats }), CTX), "beats[1].show.from"),
      '"name the skill" comes at or before the last label of beats[0]; beats must follow the footage in order',
    );
  });

  it("refuses a payoff chip at or before the last beat's labels", () => {
    const ps = briefProblems(
      brief({
        payoff: { card: "Hit {chip}. It's live.", chip: "write SKILL.md" },
      }),
      CTX,
    );
    assert.deepEqual(
      ps.filter((p) => p.path === "payoff.chip").map((p) => p.message),
      [
        '"write SKILL.md" is at or before the last beat\'s last label, so the payoff clip would replay earlier footage. Name an action after it',
        '"write SKILL.md" declares no control text, so the pill would read the label. Chips can name: "Create"',
      ],
    );
  });

  it("names the chip token when the payoff lacks it", () => {
    assert.equal(
      one(
        briefProblems(
          brief({ payoff: { card: "Hit Create. It's live.", chip: "Create" } }),
          CTX,
        ),
        "payoff.card",
      ),
      "must contain the chip token {chip} exactly once (found 0); it is where the payoff's control lands",
    );
  });

  it("asks for a demo's click log", () => {
    const { footage: _f, ...cut } = brief({ demo: "agent-skill" });
    assert.equal(
      one(briefProblems(cut, CTX), "demo"),
      'has no click log at public/agent-skill.clicks.json. Record and convert "agent-skill" first',
    );
  });
});

describe("reporting", () => {
  it("reports several problems in one pass", () => {
    const beats = [
      {
        card: "This card goes on for far more words than any card should.",
        show: { from: "Add skil" },
      },
      VALID.beats[1],
    ];
    assert.deepEqual(paths(briefProblems(brief({ beats }), CTX)), [
      "beats[0].card",
      "beats[0].show.from",
    ]);
  });
});

describe("briefLabels", () => {
  it("lists footage labels with their actions", () => {
    const labels = briefLabels(
      {
        footage: {
          surface: "agent",
          actions: [
            { use: "tools.add", with: {} },
            { use: "skills.add", with: { name: "x" } },
          ],
        },
      },
      CATALOG,
      1.25,
    );
    assert.deepEqual(labels.slice(0, 3), [
      { label: "Add tool", action: "tools.add" },
      { label: "Done", action: "tools.add" },
      { label: "Add skill", action: "skills.add" },
    ]);
  });

  it("lists a demo's labels with press and typing end, numbering repeats", () => {
    assert.deepEqual(labelLines(briefLabels({ log: BASIC }, CATALOG, 1.25)), [
      '  "Add skill"  @1.49s',
      '  "name the skill"  @4.54s, types to 5.27s',
      '  "open menu#1"  @6.40s',
      '  "pick Daily"  @7.60s',
      '  "open menu#2"  @8.80s',
      '  "write SKILL.md"  @10.00s, types to 15.52s',
      '  "Create"  @18.06s',
    ]);
  });
});

describe("payoff controls", () => {
  it("refuses a chip whose label declares no control", () => {
    const beats = [
      VALID.beats[0],
      {
        card: "Write the instructions in Markdown.",
        show: { from: "write SKILL.md#1" },
      },
    ];
    const footage = {
      surface: "agent",
      actions: [
        { use: "skills.add", with: { name: "a" } },
        { use: "tools.add", with: {} },
      ],
    };
    assert.equal(
      one(
        briefProblems(
          brief({
            footage,
            beats,
            payoff: { card: "Hit {chip}.", chip: "Done" },
          }),
          CTX,
        ),
        "payoff.chip",
      ),
      '"Done" declares no control text, so the pill would read the label. Chips can name: "Create"',
    );
  });

  it("asks a demo brief for the control's text", () => {
    const { footage: _f, ...cut } = brief({
      demo: "brief-basic",
      beats: [
        { card: "Add a skill.", show: { from: "Add skill" } },
        {
          card: "Write the instructions in Markdown.",
          show: { from: "write SKILL.md" },
        },
      ],
    });
    assert.equal(
      one(briefProblems(cut, { ...CTX, log: BASIC }), "payoff.text"),
      "is required for a demo brief: the control's on-screen text, which the pill shows",
    );
    assert.deepEqual(
      briefProblems(
        { ...cut, payoff: { ...VALID.payoff, text: "Create" } },
        { ...CTX, log: BASIC },
      ),
      [],
    );
  });

  it("keeps payoff.text off a footage brief", () => {
    assert.equal(
      one(
        briefProblems(
          brief({ payoff: { ...VALID.payoff, text: "Create" } }),
          CTX,
        ),
        "payoff.text",
      ),
      "is only for a demo brief; with footage the pill's text comes from the action's declared control",
    );
  });

  it("reads the pill's text off the declaration, with the footage's params", () => {
    const catalog: Catalog = {
      surfaces: new Map([["site", {}]]),
      actions: new Map([
        [
          "search.filter-domain",
          {
            id: "search.filter-domain",
            surface: "site",
            params: { domain: { type: "string", maxLength: 30 } },
            labels: [
              "All domains",
              { label: "pick domain", control: { param: "domain" } },
            ],
          },
        ],
      ]),
    };
    const footage = {
      surface: "site",
      actions: [
        { use: "search.filter-domain", with: { domain: "Development" } },
      ],
    };
    assert.equal(
      chipText(
        {
          ...VALID,
          footage,
          payoff: { card: "Pick {chip}.", chip: "pick domain" },
        } as Brief,
        catalog,
      ),
      "Development",
    );
    assert.equal(
      chipText(
        {
          ...(VALID as Brief),
          footage: undefined,
          demo: "d",
          payoff: { card: "x {chip}", chip: "Create", text: "Create" },
        } as Brief,
        catalog,
      ),
      "Create",
    );
  });
});

describe("one-take briefs", () => {
  const { beats: _b, payoff: _p, signoff: _s, ...COMMON } = VALID;
  const ONE = { ...COMMON, house: "agenta@2", outro: ["Agents that learn on the job."] };

  it("passes title, footage and one outro line", () => {
    assert.deepEqual(briefProblems(ONE, CTX), []);
  });

  it("refuses beats under a one-take house, naming the shape", () => {
    assert.match(
      one(briefProblems({ ...ONE, beats: VALID.beats }, CTX), "beats"),
      /^is not taken by agenta@2: its shape is one-take, .* closes on `outro` lines/,
    );
  });

  it("states the count and the limit for too many closing lines", () => {
    const outro = ["Agents that learn.", "On the job.", "Every day.", "For everyone."];
    assert.equal(one(briefProblems({ ...ONE, outro }, CTX), "outro"), "has 4 lines; agenta@2 takes 1-3");
  });

  it("checks each outro line as copy", () => {
    assert.match(one(briefProblems({ ...ONE, outro: ["A seamless way to ship."] }, CTX), "outro[0]"), /banned word "seamless"/);
  });

  it("refuses an outro under a beats house", () => {
    assert.match(one(briefProblems(brief({ outro: ["Done."] }), CTX), "outro"), /is for a one-take house/);
  });

  it("takes cuts on the take's labels, in order, never after its last action", () => {
    assert.deepEqual(briefProblems({ ...ONE, cuts: ["describe the skill"] }, CTX), []);
    assert.match(one(briefProblems({ ...ONE, cuts: ["Publish"] }, CTX), "cuts[0]"), /Publish/);
    assert.match(
      one(briefProblems({ ...ONE, cuts: ["describe the skill", "Add skill"] }, CTX), "cuts[1]"),
      /comes before the cut ahead of it/,
    );
    assert.match(one(briefProblems({ ...ONE, cuts: [] }, CTX), "cuts"), /must list the labels/);
    assert.match(one(briefProblems(brief({ cuts: ["Add skill"] }), CTX), "cuts"), /is for a one-take house/);
  });

  it("checks a cut's recording and reads its line as a closing line", () => {
    assert.match(
      one(briefProblems({ ...ONE, cuts: [{ after: "Add skill", demo: "nowhere" }] }, CTX), "cuts[0].demo"),
      /has no click log at public\/nowhere\.clicks\.json/,
    );
    assert.match(
      one(briefProblems({ ...ONE, cuts: [{ after: "Add skill", line: "A seamless handoff." }] }, CTX), "cuts[0].line"),
      /banned word "seamless"/,
    );
    assert.match(one(briefProblems({ ...ONE, cuts: [{ after: "Add skill", at: 1 }] }, CTX), "cuts[0].at"), /./);
    assert.match(one(briefProblems({ ...ONE, cuts: [{ after: "Add skill", tailS: 9 }] }, CTX), "cuts[0].tailS"), /0-3/);
  });
});

describe("accent words", () => {
  const { beats: _b, payoff: _p, signoff: _s, ...COMMON } = VALID;
  const ONE = { ...COMMON, house: "agenta@2", outro: ["Agents that learn on the job."] };

  it("lets the Agenta pack set one word in its accent face", () => {
    assert.deepEqual(briefProblems({ ...ONE, title: "Introducing ^^Skills^^" }, CTX), []);
  });

  it("refuses a second accent word, naming the one-word limit", () => {
    assert.equal(
      one(briefProblems({ ...ONE, title: "Introducing ^^agent skills^^" }, CTX), "title"),
      "sets 2 words in the accent face; agenta@2's PP Mondwest takes at most 1 per card",
    );
  });

  it("refuses accent markup where the house has no pack", () => {
    assert.match(one(briefProblems(brief({ title: "Introducing ^^Skills^^" }), CTX), "title"), /agenta@1 has no accent face/);
  });
});
