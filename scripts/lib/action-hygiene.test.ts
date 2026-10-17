/**
 * actions/ and surfaces/ are committed, so they must never name an account:
 * start URLs, hosts and ids come from the environment (DEMO_URL_<SURFACE>).
 * This scans every file in both and fails on a URL, a hostname, or an
 * id-shaped literal, naming the file and line.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const RULES: { what: string; re: RegExp }[] = [
  { what: "a URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/i },
  { what: "a hostname", re: /\b(?:[a-z0-9-]+\.)+(?:com|ai|io|net|org|dev|app|co|cloud|so|sh|xyz|me|tech)\b/i },
  { what: "a UUID", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { what: "a long hex id", re: /\b[0-9a-f]{24,}\b/i },
  {
    what: "a base62 token",
    re: /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]{20,}\b/,
  },
];

/** `file:line: <what> "<match>"` for every account-shaped literal in `text`. */
function findings(file: string, text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const { what, re } of RULES) {
      const m = re.exec(line);
      if (m) out.push(`${file}:${i + 1}: ${what} "${m[0]}"`);
    }
  });
  return out;
}

const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? filesUnder(p) : [p];
      })
    : [];

describe("action and surface hygiene", () => {
  it("keeps URLs, hosts and account ids out of actions/ and surfaces/", () => {
    const files = [...filesUnder(path.join(ROOT, "actions")), ...filesUnder(path.join(ROOT, "surfaces"))];
    assert.ok(files.length > 0, "no action or surface files found");
    const hits = files.flatMap((f) => findings(path.relative(ROOT, f), fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits, [], `account-specific literals:\n  ${hits.join("\n  ")}`);
  });

  it("catches each shape, and passes product copy and code", () => {
    assert.deepEqual(findings("a.ts", 'const u = "https://eu.cloud.agenta.ai/w/1";'), [
      'a.ts:1: a URL "https://eu.cloud.agenta.ai/w/1"',
      'a.ts:1: a hostname "eu.cloud.agenta.ai"',
    ]);
    assert.deepEqual(findings("a.ts", "\n// app 0f8b2c1e-1d2a-4b3c-9d8e-7f6a5b4c3d2e"), [
      'a.ts:2: a UUID "0f8b2c1e-1d2a-4b3c-9d8e-7f6a5b4c3d2e"',
    ]);
    assert.deepEqual(findings("a.ts", 'id: "6650f1c2e4b0a9d8c7b6a5f4"'), ['a.ts:1: a long hex id "6650f1c2e4b0a9d8c7b6a5f4"']);
    assert.deepEqual(findings("a.ts", 'token: "sk9QwErTy7UiOp3AsDfGh"'), ['a.ts:1: a base62 token "sk9QwErTy7UiOp3AsDfGh"']);
    assert.deepEqual(
      findings("a.ts", 'example: { name: "pr-review-security" }, id: "skills.add", type: "SKILL.md", env: DEMO_URL_AGENT'),
      [],
    );
  });
});
