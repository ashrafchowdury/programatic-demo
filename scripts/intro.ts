/**
 * The intro half of the pipeline in one command: render the card, concat it
 * onto the already-rendered demo.
 *
 *   pnpm clip <name>     # record -> convert -> render   (unchanged)
 *   pnpm intro <name>    # render:intro -> stitch
 *
 * Deliberately not folded into clip.ts: every existing command keeps a zero
 * diff, and a demo without a storyboard still renders exactly as before.
 *
 * Usage: pnpm intro <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function step(script: string, name: string) {
  console.log(`\n=== ${script} ${name} ===`);
  execFileSync(TSX, [path.join(ROOT, "scripts", script), name], {
    stdio: "inherit",
  });
}

const name = process.argv[2] ?? "smoke";
step("render-intro.ts", name);
step("stitch.ts", name);
console.log(`\nDone. See out/reel/${name}.full.mp4`);
