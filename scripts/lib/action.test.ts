import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Page } from "playwright";
import type { ClickLog } from "../../src/lib/click-log";
import { HOUSES } from "../../src/lib/house";
import {
  actionProblems,
  assertDemoOwned,
  catalogLines,
  composeFlow,
  defineAction,
  defineSurface,
  labelMismatch,
  loadRegistry,
  surfaceEnvKey,
  type AnyAction,
  type Registry,
} from "./action";
import type { Flow, FlowContext } from "./flow";
import { runPrepare } from "./record";

const HOUSE = HOUSES["agenta@1"];
const ENV = {
  DEMO_URL_EXAMPLE_SKILLSMP: "test-start",
  DEMO_URL_TEST: "test-start",
};

/** Run a flow against a context that writes down what it was asked to do. */
async function script(flow: Flow): Promise<string[]> {
  const did: string[] = [];
  const log = (verb: string) => async (target: unknown, label?: unknown) => {
    did.push(`${verb} ${label ?? (typeof target === "string" ? target : "?")}`);
  };
  const ctx = {
    moveAndClick: log("click"),
    typeInto: async (target: unknown, _text: unknown, label?: string) =>
      void did.push(`type ${label ?? target}`),
    focus: log("focus"),
    moveTo: log("move"),
    pause: async (ms = 700) => void did.push(`pause ${ms}`),
    pressKey: async (chord: string) => void did.push(`key ${chord}`),
    settle: async () => void did.push("settle"),
    scroll: async () => void did.push("scroll"),
    find: async () => ({}),
    page: {},
  } as unknown as FlowContext;
  await flow.run(ctx);
  return did;
}

/** A test registry: one surface, actions whose prepares write down their order. */
function fixtureRegistry(order: string[]): Registry {
  const surface = defineSurface({
    id: "test",
    viewport: { width: 1280, height: 800 },
    ready: async () => true,
  });
  const make = (id: string, labels: string[], fail = false): AnyAction =>
    defineAction({
      id,
      surface: "test",
      params: { name: { type: "string", maxLength: 20 } },
      labels,
      mutates: id,
      example: { name: "demo" },
      prepare: async () => {
        order.push(id);
        if (fail) throw new Error(`${id} left a row behind`);
      },
      steps: ({ name }) =>
        labels.map((l, i) =>
          i === 0 ? { type: "Name", text: name, label: l } : { click: l },
        ),
    });
  return {
    surfaces: new Map([["test", surface]]),
    actions: new Map(
      [
        make("skills.add", ["Add skill", "Create"]),
        make("tools.add", ["Add tool", "Done"]),
        make("rows.broken", ["Go"], true),
      ].map((a) => [a.id, a]),
    ),
  };
}

const fakePage = {} as Page;

describe("action registry", () => {
  it("loads every committed surface and action, where its id says", async () => {
    const { registry, problems } = await loadRegistry();
    assert.deepEqual(problems, []);
    assert.ok(registry.surfaces.has("example-skillsmp"));
    assert.ok(registry.actions.has("search.query"));
    assert.ok(registry.actions.has("search.filter-domain"));
  });

  it("holds every committed action to its contract", async () => {
    const { registry } = await loadRegistry();
    for (const action of registry.actions.values())
      assert.deepEqual(
        actionProblems(action, registry.surfaces),
        [],
        action.id,
      );
  });

  it("prints an action's id, parameters and labels for the catalog", async () => {
    const { registry } = await loadRegistry();
    assert.deepEqual(
      catalogLines(registry.actions.get("search.filter-domain")!),
      [
        "search.filter-domain  (surface example-skillsmp, mutates example-skillsmp-search)",
        "  with.domain: string, 1-30 chars. a domain the filter lists",
        '  labels: "All domains" → "pick domain" [chip: with.domain]',
        '  example: {"domain":"Development"}',
      ],
    );
  });

  it("derives the env key from the surface id", () => {
    assert.equal(
      surfaceEnvKey("example-skillsmp"),
      "DEMO_URL_EXAMPLE_SKILLSMP",
    );
    assert.equal(surfaceEnvKey("agent"), "DEMO_URL_AGENT");
  });
});

describe("action contract", () => {
  const base = {
    id: "skills.add",
    surface: "test",
    params: { name: { type: "string", maxLength: 20 } } as const,
    labels: ["Add skill", "name the skill"],
    mutates: "skills",
    example: { name: "pr-review-security" },
    prepare: async () => {},
  };

  it("fails a step that logs a label the action did not declare", () => {
    const action = defineAction({
      ...base,
      steps: ({ name }) => [
        { click: "Add skill" },
        { type: "Name", text: name, label: "name it" },
      ],
    });
    const problems = actionProblems(action);
    assert.ok(
      problems.includes(
        'action "skills.add": steps log "name it", which is not a declared label',
      ),
      problems.join("\n"),
    );
  });

  it("types the parameter and keeps the labels whatever it is", async () => {
    const typed: string[] = [];
    const action = defineAction({
      ...base,
      steps: ({ name }) => [
        { click: "Add skill" },
        { type: "Name", text: name, label: "name the skill" },
      ],
    });
    assert.deepEqual(actionProblems(action), []);
    const steps = action.steps({ name: "pr-review-security" });
    for (const s of steps) if ("type" in s) typed.push(String(s.text));
    assert.deepEqual(typed, ["pr-review-security"]);
  });

  it("fails labels that change with the parameters", () => {
    const action = defineAction({
      ...base,
      steps: ({ name }) => [
        { click: "Add skill" },
        {
          type: "Name",
          text: name,
          label: name === "x" ? "short" : "name the skill",
        },
      ],
    });
    assert.ok(
      actionProblems(action).some((p) =>
        p.includes("with minimal params the steps log"),
      ),
    );
  });

  it("fails a control that reads a parameter the schema lacks", () => {
    const action = defineAction({
      ...base,
      labels: [
        "Add skill",
        { label: "name the skill", control: { param: "title" } },
      ],
      steps: ({ name }) => [
        { click: "Add skill" },
        { type: "Name", text: name, label: "name the skill" },
      ],
    });
    assert.deepEqual(actionProblems(action), [
      'action "skills.add": label "name the skill" takes its control text from parameter "title", which the schema does not have',
    ]);
  });

  it("requires the demo prefix on an example that names what the action creates", () => {
    const action = defineAction({
      ...base,
      params: { name: { type: "string", maxLength: 40, creates: true } },
      example: { name: "pr-review-security" },
      steps: ({ name }) => [
        { click: "Add skill" },
        { type: "Name", text: name, label: "name the skill" },
      ],
    });
    assert.deepEqual(actionProblems(action), [
      'action "skills.add": example.name "pr-review-security" names an item the action creates, so it must start with "demo-"',
    ]);
    assert.deepEqual(
      actionProblems({ ...action, example: { name: "demo-pr-security" } }),
      [],
    );
  });

  it("fails an example that breaks its own schema", () => {
    const action = defineAction({
      ...base,
      example: { name: "a-name-far-longer-than-twenty-chars" },
      steps: ({ name }) => [
        { click: "Add skill" },
        { type: "Name", text: name, label: "name the skill" },
      ],
    });
    assert.deepEqual(actionProblems(action), [
      'action "skills.add": example.name must be at most 20 characters, got 35',
    ]);
  });
});

describe("composeFlow", () => {
  const footage = {
    surface: "test",
    actions: [
      { use: "skills.add", with: { name: "a" } },
      { use: "tools.add", with: { name: "b" } },
    ],
  };

  it("prepares in order, establishes once, and puts the house gap between actions", async () => {
    const order: string[] = [];
    const r = composeFlow(
      "launch",
      footage,
      fixtureRegistry(order),
      HOUSE,
      ENV,
    );
    assert.ok("flow" in r);
    await r.flow.prepare!(fakePage);
    assert.deepEqual(order, ["skills.add", "tools.add"]);
    assert.deepEqual(await script(r.flow), [
      "pause 900",
      "type Add skill",
      "click Create",
      "pause 1200",
      "type Add tool",
      "click Done",
    ]);
    assert.equal(r.flow.name, "launch");
    assert.equal(r.flow.startUrl, "test-start");
    assert.equal(r.flow.strictPrepare, true);
    assert.equal(r.flow.mutates, "skills.add+tools.add");
    assert.deepEqual(r.flow.declaredLabels, [
      { label: "Add skill", action: "skills.add" },
      { label: "Create", action: "skills.add" },
      { label: "Add tool", action: "tools.add" },
      { label: "Done", action: "tools.add" },
    ]);
  });

  it("composes the same flow every time", async () => {
    const a = composeFlow("launch", footage, fixtureRegistry([]), HOUSE, ENV);
    const b = composeFlow("launch", footage, fixtureRegistry([]), HOUSE, ENV);
    assert.ok("flow" in a && "flow" in b);
    const data = (f: Flow) => JSON.parse(JSON.stringify(f));
    assert.deepEqual(data(a.flow), data(b.flow));
    assert.deepEqual(await script(a.flow), await script(b.flow));
  });

  it("keeps an action's own viewport", () => {
    const registry = fixtureRegistry([]);
    const wide = {
      ...registry.actions.get("tools.add")!,
      viewport: { width: 1600, height: 900 },
    };
    const own: Registry = {
      ...registry,
      actions: new Map([...registry.actions, ["tools.add", wide]]),
    };
    const r = composeFlow(
      "launch",
      { surface: "test", actions: [{ use: "tools.add", with: { name: "b" } }] },
      own,
      HOUSE,
      ENV,
    );
    assert.ok("flow" in r);
    assert.deepEqual(r.flow.viewport, { width: 1600, height: 900 });
    const mixed = composeFlow("launch", footage, own, HOUSE, ENV);
    assert.deepEqual("problems" in mixed && mixed.problems, [
      {
        path: "footage.actions",
        message:
          "one composed flow films at one size, but these actions differ: skills.add 1280x800, tools.add 1600x900. Split them into separate briefs",
      },
    ]);
  });

  it("names the env key when the surface has no start URL", () => {
    const r = composeFlow("launch", footage, fixtureRegistry([]), HOUSE, {});
    assert.deepEqual("problems" in r && r.problems, [
      {
        path: "footage.surface",
        message:
          'DEMO_URL_TEST is not set. Surface "test" reads its start URL from it; see .env.example.',
      },
    ]);
  });

  it("names the failing action when a strict prepare throws", async () => {
    const order: string[] = [];
    const r = composeFlow(
      "launch",
      {
        surface: "test",
        actions: [
          { use: "skills.add", with: { name: "a" } },
          { use: "rows.broken", with: { name: "b" } },
        ],
      },
      fixtureRegistry(order),
      HOUSE,
      ENV,
    );
    assert.ok("flow" in r);
    await assert.rejects(
      r.flow.prepare!(fakePage),
      /action 2 \(rows\.broken\) prepare failed: rows\.broken left a row behind/,
    );
  });

  it("composes the committed example set", async () => {
    const { registry } = await loadRegistry();
    const r = composeFlow(
      "example",
      {
        surface: "example-skillsmp",
        actions: [
          { use: "search.query", with: { query: "ui design" } },
          { use: "search.filter-domain", with: { domain: "Development" } },
        ],
      },
      registry,
      HOUSE,
      ENV,
    );
    assert.ok("flow" in r);
    assert.deepEqual(
      r.flow.declaredLabels!.map((d) => d.label),
      [
        "Search field",
        "All languages",
        "English",
        "All domains",
        "pick domain",
      ],
    );
  });
});

describe("strict prepare", () => {
  const failing = async () => {
    throw new Error("2 rows left");
  };

  it("aborts a strict flow, naming the failure", async () => {
    const warned: string[] = [];
    await assert.rejects(
      runPrepare(
        { prepare: failing, strictPrepare: true },
        fakePage,
        () => {},
        (m) => void warned.push(m),
      ),
      /prepare {4}-> FAILED \(2 rows left\); strict prepare, so nothing was recorded/,
    );
    assert.deepEqual(warned, []);
  });

  it("logs and carries on for a hand-written flow", async () => {
    const warned: string[] = [];
    await runPrepare(
      { prepare: failing },
      fakePage,
      () => {},
      (m) => void warned.push(m),
    );
    assert.deepEqual(warned, [
      "prepare    -> FAILED (2 rows left); shooting from the current state",
    ]);
  });
});

describe("labelMismatch", () => {
  const log = JSON.parse(
    readFileSync(
      new URL(
        "../../src/lib/__fixtures__/brief-basic.clicks.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ClickLog;
  const declared = log.clicks.map((c) => ({
    label: c.label!,
    action: c.label === "Create" ? "skills.create" : "skills.add",
  }));

  it("passes a take that logged exactly what was declared", () => {
    assert.equal(labelMismatch(declared, log.clicks), null);
  });

  it("names a label the take never logged, and its action", () => {
    const skipped = log.clicks.filter((c) => c.label !== "Create");
    assert.equal(
      labelMismatch(declared, skipped),
      'label 7 "Create" (declared by skills.create) was never logged; the take stopped early or skipped it',
    );
  });

  it("names the first label that differs", () => {
    const renamed = log.clicks.map((c) =>
      c.label === "pick Daily" ? { ...c, label: "pick Weekly" } : c,
    );
    assert.equal(
      labelMismatch(declared, renamed),
      'label 4 should be "pick Daily" (declared by skills.add), but the take logged "pick Weekly"',
    );
  });
});

describe("demo-owned deletion", () => {
  it("lets a prepare delete demo data", () => {
    assert.doesNotThrow(() =>
      assertDemoOwned("demo-morning-audit", "schedule"),
    );
  });

  it("refuses anything without the prefix, naming it", () => {
    assert.throws(() => assertDemoOwned("Morning PR audit", "schedule"), {
      message:
        'refusing to delete schedule "Morning PR audit": it lacks the "demo-" prefix, so it may be real data. Remove it by hand, or give demo data a "demo-" name',
    });
  });
});
