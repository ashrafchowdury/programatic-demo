/**
 * Cuts a reel: title cards interleaved with ranges of an already-rendered demo.
 *
 *   pnpm reel <name>                 reels/<name>.ts -> out/reel/<name>.mp4
 *   pnpm reel <name> --style=stage   the same cut in another grammar
 *                                    -> out/reel/<name>.stage.mp4
 *   pnpm reel <name> --check         resolve beats, print every segment's range,
 *                                    length, the cut rate against the style's
 *                                    targets and the SFX hits; render nothing
 *
 * The work is in scripts/lib/reel-cut.ts; this file only reads the command
 * line and loads the storyboard.
 *
 * Usage: pnpm reel <name> [--style=<style>] [--check]   (default: agent-skill)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Reel } from "../src/lib/reel";
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
  const unknown = args.filter(
    (a) => a.startsWith("--") && a !== "--check" && !a.startsWith("--style="),
  );
  if (unknown.length) throw new Error(`Unknown flag(s): ${unknown.join(" ")}`);

  const reel = await loadReel(name);
  // The reel file names itself: out/reel/<name>.mp4 and the cache dir are built
  // from it. The DEMO it cuts from is a separate field (`demo`).
  if (reel.name !== name)
    throw new Error(`reels/${name}.ts has name "${reel.name}" — it must match the file name.`);

  cutReel(reel, {
    source: `reels/${name}.ts`,
    // A style override writes beside the reel's own cut, never over it.
    outBase: rawStyle ? `${name}.${rawStyle}` : name,
    style: rawStyle,
    check: args.includes("--check"),
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
