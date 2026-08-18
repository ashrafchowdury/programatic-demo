import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locator } from "playwright";
import {
  css,
  defineFlow,
  runSteps,
  type FlowContext,
  type Step,
  type Target,
} from "./flow";

/** Records what the step runner asked the context to do, in order. */
function recorder() {
  const log: string[] = [];
  const show = (t: Target) =>
    typeof t === "string"
      ? t
      : typeof t === "object" && t !== null && "css" in t
        ? `css(${(t as { css: string }).css})`
        : "<locator>";

  const ctx = {
    moveAndClick: async (t: Target, label?: string, o?: unknown) => {
      log.push(`click ${show(t)} label=${label} opts=${JSON.stringify(o)}`);
    },
    typeInto: async (t: Target, text: string, label?: string) => {
      log.push(`type ${show(t)} "${text}" label=${label}`);
    },
    focus: async (t: Target, label?: string) => {
      log.push(`focus ${show(t)} label=${label}`);
    },
    moveTo: async (t: Target) => {
      log.push(`moveTo ${show(t)}`);
    },
    find: async (name: string) => {
      log.push(`find ${name}`);
      return { __hoisted: name } as unknown as Locator;
    },
    pause: async (ms = 700) => {
      log.push(`pause ${ms}`);
    },
  } as unknown as FlowContext;

  return { ctx, log };
}

describe("runSteps", () => {
  it("runs steps in order and applies `after` as a trailing pause", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [
      { pause: 700 },
      { click: "Save", cluster: "save", after: 900 },
    ]);
    assert.deepEqual(log, [
      "pause 700",
      'click Save label=Save opts={"cluster":"save"}',
      "pause 900",
    ]);
  });

  it("omits the trailing pause when `after` is absent or zero", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ click: "A" }, { click: "B", after: 0 }]);
    assert.equal(
      log.filter((l) => l.startsWith("pause")).length,
      0,
      "a step with no `after` must not insert a beat",
    );
  });

  it("defaults the log label to the target's name", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ click: "AGENTS.md" }]);
    assert.match(log[0], /label=AGENTS\.md/);
  });

  it("lets an explicit label win over the name", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ click: "AGENTS.md", label: "open the file" }]);
    assert.match(log[0], /label=open the file/);
  });

  it("reuses a hoisted name instead of resolving it again", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [
      { hoist: "Save" },
      { click: "AGENTS.md" },
      { click: "Save" },
    ]);
    assert.deepEqual(log, [
      "find Save",
      "click AGENTS.md label=AGENTS.md opts={}",
      // Resolved to the hoisted locator, but still logged under its name.
      "click <locator> label=Save opts={}",
    ]);
  });

  it("does not hoist names it was not asked to", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ hoist: "Save" }, { click: "Cancel" }]);
    assert.match(log[1], /click Cancel/, "unhoisted names resolve inline");
  });

  it("passes css() targets through untouched", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ moveTo: css("#title") }]);
    assert.equal(log[0], "moveTo css(#title)");
  });

  it("carries text and cluster through a type step", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [{ type: "editor", text: "hello", cluster: "write" }]);
    assert.equal(log[0], 'type editor "hello" label=editor');
  });

  it("runs a `do` escape hatch and still honours its `after`", async () => {
    const { ctx, log } = recorder();
    await runSteps(ctx, [
      {
        do: async () => {
          log.push("custom");
        },
        after: 250,
      },
    ]);
    assert.deepEqual(log, ["custom", "pause 250"]);
  });
});

describe("defineFlow", () => {
  const base = { name: "t", viewport: { width: 1, height: 1 } };

  it("compiles steps into a run function", async () => {
    const flow = defineFlow({ ...base, steps: [{ click: "Save" }] });
    assert.equal(typeof flow.run, "function");
    const { ctx, log } = recorder();
    await flow.run(ctx);
    assert.match(log[0], /click Save/);
  });

  it("leaves a hand-written run alone", async () => {
    const run = async () => {};
    assert.equal(defineFlow({ ...base, run }).run, run);
  });

  it("rejects a flow that defines neither", () => {
    assert.throws(
      () => defineFlow({ ...base } as unknown as { name: string } & never),
      /neither steps nor run/,
    );
  });

  it("accepts an empty step list without running anything", async () => {
    const flow = defineFlow({ ...base, steps: [] as Step[] });
    const { ctx, log } = recorder();
    await flow.run(ctx);
    assert.deepEqual(log, []);
  });
});
