/**
 * The whole pipeline for one offline/generic clip in a single command:
 * record -> convert -> render. Used for `smoke` (and any future flow that
 * goes through `record-demo.ts`).
 *
 * Live product demos:
 *   pnpm record:live <name> && pnpm convert <name> && pnpm render <name>
 *
 * Usage: pnpm clip <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function step(script: string, name: string) {
  console.log(`\n=== ${script} ${name} ===`);
  execFileSync(TSX, [path.join(ROOT, "scripts", script), name], { stdio: "inherit" });
}

if (process.env.DEMO_TOUR === "capture") {
  throw new Error(
    "DEMO_TOUR=capture is record-only. Capture first, then DEMO_TOUR=replay pnpm clip <name>.",
  );
}

const name = process.argv[2] ?? "smoke";
step("record-demo.ts", name);
step("convert.ts", name);
step("render.ts", name);
console.log(`\nDone. See out/${name}.mp4`);
