/**
 * Cuts a reel: title cards interleaved with ranges of an already-rendered demo.
 *
 *   pnpm reel <name>                 reels/<name>.ts -> out/reel/<name>.mp4
 *   pnpm reel <name> --style=stage   the same cut in another grammar
 *                                    -> out/reel/<name>.stage.mp4
 *                                    It overrides EVERYTHING — the reel's
 *                                    style and look and every card's own —
 *                                    because it is an A/B tool; fields the
 *                                    new grammar cannot honour (crops, chips
 *                                    in a style with no chip look) warn and
 *                                    drop instead of failing.
 *   pnpm reel <name> --aspect=9:16   the same cut, vertical: a moving crop of
 *                                    the footage that follows the clicks
 *                                    -> out/reel/<name>.9x16.mp4 (also 1:1)
 *   pnpm reel <name> --check         resolve beats, print every segment's range,
 *                                    length, first-frame scale, the cut rate
 *                                    against the style's targets and the SFX
 *                                    hits; render nothing
 *
 * The work is in scripts/lib/reel-cut.ts; this file only reads the command
 * line and loads the storyboard.
 *
 * Usage: pnpm reel <name> [--style=<style>] [--aspect=<16:9|1:1|9:16>] [--check]
 *        (default: agent-skill)
 *
 * With no reels/<name>.ts, a brief at reels/<name>.brief.json is validated,
 * compiled under its house and cut once per house aspect (the first is the
 * reel's own, the rest pass --aspect); `--aspect=` cuts only that one. When
 * both exist the .ts wins, with a notice.
 *
 * Output name: out/reel/<name>[.<style>][.<aspect>].mp4 — the style part only
 * for a --style override, the aspect part for anything but 16:9, whether it
 * came from --aspect or the reel's own `aspect`. Each output has its own
 * segment cache under .diag/reel/, so cutting one aspect never evicts another.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Reel } from "../src/lib/reel";
import { ASPECTS, aspectSlug, isAspect, isNativeAspect, type Aspect } from "../src/lib/aspect";
import { briefExists, checkBrief, problemLines } from "./lib/brief-io";
import { isStyle, STYLES } from "../src/lib/style";
import { cutReel } from "./lib/reel-cut";

const ROOT = path.resolve(import.meta.dirname, "..");

/** reels/<name>.ts, else the reel its brief compiles to (with the house's aspects). */
async function loadReel(name: string): Promise<{ reel: Reel; source: string; aspects?: readonly Aspect[] }> {
  const reelPath = path.join(ROOT, "reels", `${name}.ts`);
  if (fs.existsSync(reelPath)) {
    if (briefExists(name))
      console.log(`notice     -> reels/${name}.ts wins; reels/${name}.brief.json is ignored`);
    return { reel: (await import(pathToFileURL(reelPath).href)).default as Reel, source: `reels/${name}.ts` };
  }
  if (!briefExists(name)) throw new Error(`No reel file at reels/${name}.ts, and no brief at reels/${name}.brief.json`);
  const run = await checkBrief(name);
  if (run.problems.length)
    throw new Error(`reels/${name}.brief.json: ${run.problems.length} problem(s)\n${problemLines(run.problems).join("\n")}`);
  if (!run.compiled)
    throw new Error(`reels/${name}.brief.json is valid, but its footage is not recorded: run \`pnpm launch ${name}\`.`);
  console.log(`reel       -> compiled from reels/${name}.brief.json under ${run.house!.id}`);
  return { reel: run.compiled.reel, source: `reels/${name}.brief.json`, aspects: run.house!.aspects };
}

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--")) ?? "agent-skill";
  const rawStyle = args.find((a) => a.startsWith("--style="))?.split("=")[1];
  if (rawStyle != null && !isStyle(rawStyle))
    throw new Error(`Unknown --style=${rawStyle}. Known: ${STYLES.join(", ")}`);
  const rawAspect = args.find((a) => a.startsWith("--aspect="))?.split("=")[1];
  if (rawAspect != null && !isAspect(rawAspect))
    throw new Error(`Unknown --aspect=${rawAspect}. Known: ${ASPECTS.join(", ")}`);
  const unknown = args.filter(
    (a) =>
      a.startsWith("--") &&
      a !== "--check" &&
      !a.startsWith("--style=") &&
      !a.startsWith("--aspect="),
  );
  if (unknown.length) throw new Error(`Unknown flag(s): ${unknown.join(" ")}`);

  const { reel, source, aspects } = await loadReel(name);
  // The reel file names itself: out/reel/<name>.mp4 and the cache dir are built
  // from it. The DEMO it cuts from is a separate field (`demo`).
  if (reel.name !== name)
    throw new Error(`${source} has name "${reel.name}" — it must match the file name.`);

  // A brief renders every house aspect unless one is asked for; a reel file,
  // its own (or the one asked for).
  const passes: (Aspect | undefined)[] = rawAspect || !aspects ? [rawAspect] : aspects.map((a, i) => (i === 0 ? undefined : a));
  for (const asked of passes) {
    // A style override writes beside the reel's own cut, never over it; so does
    // every aspect but 16:9, whichever way it was asked for.
    const aspect = asked ?? (isAspect(reel.aspect) ? reel.aspect : undefined);
    const outBase = [
      name,
      rawStyle,
      aspect && !isNativeAspect(aspect) ? aspectSlug(aspect) : undefined,
    ]
      .filter(Boolean)
      .join(".");
    cutReel(reel, {
      source,
      outBase,
      style: rawStyle,
      aspect: asked,
      check: args.includes("--check"),
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
