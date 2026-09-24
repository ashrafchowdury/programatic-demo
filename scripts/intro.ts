/**
 * A single title card, rendered as a one-card reel.
 *
 *   intros/<name>.json | intros/<name>.ts  ->  out/reel/<name>.intro.mp4
 *
 * This used to be two steps and a second grammar: `render:intro` drew the card
 * and `stitch` glued it onto the whole classic demo with `-c copy`, so a proof
 * card sat in front of a framed film. Both are retired. A card is a reel with
 * one segment, and going through the reel pipeline gives it the same encoder
 * flags, cache, style handling and delivery check as every other film.
 *
 * For the old stitched output (card + the whole demo), write a reel:
 *
 *   segments: [{ card: { ...the intro } }, { clip: { fromS: 0, toS: <demo s> } }]
 *
 * The storyboard is loaded HERE, in Node, and passed through --props. It is not
 * imported by the composition: intros/*.ts are per-account files ignored by git
 * (like flows/*.ts), so a static import in src/Root.tsx would fail to resolve on
 * any clone that does not have them.
 *
 * Usage: pnpm intro <name> [--style=<style>] [--check]   (default: smoke)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { introProblem, type IntroStoryboard } from "../src/lib/intro";
import { isStyle, STYLES } from "../src/lib/style";
import { cutReel } from "./lib/reel-cut";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Load a storyboard by name. A plain `.json` is preferred over `.ts`, so a card
 * can be authored — by hand or by an agent — as data with no code:
 *
 *   intros/<name>.json   { "name": "...", "headline": "Make it *bold*", ... }
 *   intros/<name>.ts     export default defineIntro({ ... })
 *
 * Both go through introProblem, which is the only shape check these files get —
 * tsc never sees intros/*, they are gitignored per-account files.
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

  const problem = introProblem(loaded);
  if (problem) throw new Error(`${source} is ${problem}.`);
  const intro = loaded as IntroStoryboard;
  if (intro.name !== name)
    throw new Error(
      `${source} has name "${intro.name}" — it must match the file name, ` +
        `since the output path and the card's size (public/<name>.clicks.json) ` +
        `are built from it.`,
    );
  return intro;
}

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--")) ?? "smoke";
  const rawStyle = args.find((a) => a.startsWith("--style="))?.split("=")[1];
  if (rawStyle != null && !isStyle(rawStyle))
    throw new Error(`Unknown --style=${rawStyle}. Known: ${STYLES.join(", ")}`);
  const intro = await loadIntro(name);
  cutReel(
    { name, segments: [{ card: intro }] },
    {
      source: `intros/${name}`,
      outBase: rawStyle ? `${name}.intro.${rawStyle}` : `${name}.intro`,
      style: rawStyle,
      check: args.includes("--check"),
    },
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
