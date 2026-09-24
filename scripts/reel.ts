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
 * Output name: out/reel/<name>[.<style>][.<aspect>].mp4 — the style part only
 * for a --style override, the aspect part for anything but 16:9, whether it
 * came from --aspect or the reel's own `aspect`. Each output has its own
 * segment cache under .diag/reel/, so cutting one aspect never evicts another.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Reel } from "../src/lib/reel";
import { ASPECTS, aspectSlug, isAspect, isNativeAspect } from "../src/lib/aspect";
import { isStyle, STYLES } from "../src/lib/style";
import { cutReel } from "./lib/reel-cut";

const ROOT = path.resolve(import.meta.dirname, "..");

async function loadReel(name: string): Promise<Reel> {
  const reelPath = path.join(ROOT, "reels", `${name}.ts`);
  if (!fs.existsSync(reelPath)) throw new Error(`No reel file at reels/${name}.ts`);
  return (await import(pathToFileURL(reelPath).href)).default as Reel;
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

  const reel = await loadReel(name);
  // The reel file names itself: out/reel/<name>.mp4 and the cache dir are built
  // from it. The DEMO it cuts from is a separate field (`demo`).
  if (reel.name !== name)
    throw new Error(`reels/${name}.ts has name "${reel.name}" — it must match the file name.`);

  // A style override writes beside the reel's own cut, never over it; so does
  // every aspect but 16:9, whichever way it was asked for.
  const aspect = rawAspect ?? (isAspect(reel.aspect) ? reel.aspect : undefined);
  const outBase = [
    name,
    rawStyle,
    aspect && !isNativeAspect(aspect) ? aspectSlug(aspect) : undefined,
  ]
    .filter(Boolean)
    .join(".");
  cutReel(reel, {
    source: `reels/${name}.ts`,
    outBase,
    style: rawStyle,
    aspect: rawAspect,
    check: args.includes("--check"),
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
