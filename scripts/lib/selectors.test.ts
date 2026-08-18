import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locator, Page } from "playwright";
import {
  autoCandidates,
  candidatesFor,
  type TargetOverrides,
} from "./selectors";

/**
 * Playwright locators are lazy builders, so the ladder can be inspected without
 * a browser: record what each factory was asked for and assert on the recipe.
 */
type Call = { fn: string; arg: unknown; opts?: unknown };

function stubPage(): { page: Page; calls: Call[] } {
  const calls: Call[] = [];
  const loc = (fn: string, arg: unknown, opts?: unknown): Locator => {
    calls.push({ fn, arg, opts });
    return {
      filter: (o: unknown) => loc(`${fn}.filter`, arg, o),
      locator: (a: unknown) => loc(`${fn}.locator`, a),
      last: () => loc(`${fn}.last`, arg),
      first: () => loc(`${fn}.first`, arg),
    } as unknown as Locator;
  };
  const page = {
    getByRole: (r: string, o?: unknown) => loc("getByRole", r, o),
    getByLabel: (a: unknown) => loc("getByLabel", a),
    getByPlaceholder: (a: unknown) => loc("getByPlaceholder", a),
    getByTestId: (a: unknown) => loc("getByTestId", a),
    getByText: (a: unknown) => loc("getByText", a),
    locator: (a: unknown) => loc("locator", a),
  } as unknown as Page;
  return { page, calls };
}

describe("autoCandidates", () => {
  it("puts exact interactive-role matches before any contains match", () => {
    const { page } = stubPage();
    const by = autoCandidates(page, "Save").map((c) => c.by);
    const firstExact = by.findIndex((b) => b.startsWith("role=button"));
    const firstLoose = by.findIndex((b) => b.startsWith("control containing"));
    const bareText = by.findIndex((b) => b === 'text "Save"');
    assert.ok(firstExact >= 0 && firstLoose > firstExact);
    assert.equal(bareText, by.length - 1, "bare text must be the last resort");
  });

  it("probes button and link before the rarer roles", () => {
    const { page } = stubPage();
    const by = autoCandidates(page, "Go").map((c) => c.by);
    assert.equal(by[0], 'role=button name="Go"');
    assert.equal(by[1], 'role=link name="Go"');
  });

  it("matches an exact name but not a longer one that contains it", () => {
    const { page, calls } = stubPage();
    autoCandidates(page, "Save");
    const exact = calls.find((c) => c.fn === "getByRole")!.opts as {
      name: RegExp;
    };
    assert.ok(exact.name.test("Save"));
    assert.ok(exact.name.test("save"), "names are case-insensitive");
    assert.ok(!exact.name.test("Save and close"));
  });

  it("matches a name embedded in a longer row on the contains rung", () => {
    const { page, calls } = stubPage();
    autoCandidates(page, "AGENTS.md");
    const filtered = calls.find((c) => c.fn === "locator.filter")!.opts as {
      hasText: RegExp;
    };
    // The clickable row reads "AGENTS.md Markdown · empty Empty file".
    assert.ok(filtered.hasText.test("AGENTS.md Markdown · empty Empty file"));
  });

  it("escapes regex metacharacters in names", () => {
    const { page, calls } = stubPage();
    autoCandidates(page, "AGENTS.md");
    const exact = calls.find((c) => c.fn === "getByRole")!.opts as {
      name: RegExp;
    };
    // Unescaped, the "." would match any character.
    assert.ok(exact.name.test("AGENTS.md"));
    assert.ok(!exact.name.test("AGENTSXmd"));
  });

  it("never produces an empty ladder", () => {
    const { page } = stubPage();
    assert.ok(autoCandidates(page, "x").length > 5);
  });
});

describe("candidatesFor", () => {
  const overrides: TargetOverrides = {
    editor: (p) => [
      { by: ".editor-input", locator: p.locator(".editor-input") },
    ],
  };

  it("prefers a flow's override over the generated ladder", () => {
    const { page } = stubPage();
    const c = candidatesFor(page, "editor", overrides);
    assert.equal(c.length, 1);
    assert.equal(c[0].by, ".editor-input");
  });

  it("falls back to the ladder for names with no override", () => {
    const { page } = stubPage();
    const c = candidatesFor(page, "Save", overrides);
    assert.ok(c.length > 1);
    assert.equal(c[0].by, 'role=button name="Save"');
  });

  it("generates the ladder when a flow declares no overrides at all", () => {
    const { page } = stubPage();
    assert.deepEqual(
      candidatesFor(page, "Save").map((c) => c.by),
      autoCandidates(page, "Save").map((c) => c.by),
    );
  });
});
