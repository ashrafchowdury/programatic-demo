/**
 * Renders the Intro composition for <name> to MP4.
 *   out/<name>.intro.mp4   — the title card, ready to concat onto the demo
 *
 * The storyboard is loaded HERE, in Node, and passed through --props. It is not
 * imported by the composition: intros/*.ts are per-account files ignored by git
 * (like flows/*.ts), so a static import in src/Root.tsx would fail to resolve on
 * any clone that does not have them. Node can import a path that may not exist;
 * a bundler cannot.
 *
 * Encoder flags are copied from render.ts deliberately. scripts/stitch.ts joins
 * the two files with `-c copy`, which requires them to agree on codec, profile,
 * level, pixel format and frame rate — matching flags is what makes that true.
 *
 * Usage: pnpm render:intro <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { introProblem, type IntroStoryboard } from "../src/lib/intro";
import { outPath, outRel } from "./lib/out";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

/**
 * Load a storyboard by name. A plain `.json` is preferred over `.ts`, so a card
 * can be authored — by hand or by an agent — as data with no code:
 *
 *   intros/<name>.json   { "name": "...", "headline": "Make it *bold*", ... }
 *   intros/<name>.ts     export default defineIntro({ ... })
 *
 * Both go through introProblem, which is the only shape check these files get —
 * tsc never sees intros/*, they are gitignored per-account files. The headline
 * carries its own inline styling (see parseHeadline), so JSON needs no schema
 * beyond the string.
 */
async function loadIntro(name: string): Promise<IntroStoryboard> {
  const jsonPath = path.join(ROOT, "intros", `${name}.json`);
  const tsPath = path.join(ROOT, "intros", `${name}.ts`);

  let loaded: unknown;
  let source: string;
  if (fs.existsSync(jsonPath)) {
    source = `intros/${name}.json`;
    try {
      loaded = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (err) {
      throw new Error(
        `${source} is not valid JSON: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else if (fs.existsSync(tsPath)) {
    source = `intros/${name}.ts`;
    loaded = (await import(pathToFileURL(tsPath).href)).default;
  } else {
    throw new Error(
      `No intro file at intros/${name}.json or intros/${name}.ts — copy ` +
        `intros/smoke.ts (or write a ${name}.json) and edit the copy.`,
    );
  }

  // tsc never sees these files, so this is the only shape check they get.
  const problem = introProblem(loaded);
  if (problem) throw new Error(`${source} is ${problem}.`);
  const intro = loaded as IntroStoryboard;
  if (intro.name !== name)
    throw new Error(
      `${source} has name "${intro.name}" — it must match the file name, ` +
        `since every output path is built from it.`,
    );
  return intro;
}

function resolveGl(raw?: string): string {
  return raw != null && raw !== "" ? raw : "angle";
}

function resolveConcurrency(raw?: string): number | null {
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return null;
}

async function main() {
  const name = process.argv[2] ?? "smoke";
  const intro = await loadIntro(name);

  // Needed for the SIZE only — the card shows no footage. The demo renders at
  // OUTPUT_WIDTH x the recording's aspect, and the concat needs an exact match,
  // so the card has to read the same log to learn the same aspect.
  const json = path.join(ROOT, "public", `${name}.clicks.json`);
  if (!fs.existsSync(json))
    throw new Error(
      `Missing ${path.relative(ROOT, json)} — the card takes its size from the ` +
        `recording, so record + convert ${name} first.`,
    );

  const out = outPath("reel", `${name}.intro.mp4`);
  const concurrency = resolveConcurrency(process.env.DEMO_CONCURRENCY);
  const gl = resolveGl(process.env.DEMO_GL);
  execFileSync(
    REMOTION_BIN,
    [
      "render",
      "Intro",
      out,
      `--props=${JSON.stringify({ intro })}`,
      "--crf=16",
      `--gl=${gl}`,
      ...(concurrency != null ? [`--concurrency=${concurrency}`] : []),
      "--muted",
    ],
    { stdio: "inherit" },
  );
  console.log(`intro      -> ${outRel(out)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
