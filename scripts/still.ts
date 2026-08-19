/**
 * Both halves of a still in one command: shoot -> frame.
 *
 * Usage:
 *   pnpm still <name>          the default (wide) preset
 *   pnpm still <name> og       one preset
 *   pnpm still <name> --all    every preset
 *
 * Once a shot is settled you will usually want the halves separately: the
 * capture drives a browser and the framing does not, so re-running
 * `pnpm render:still` alone is the fast way to try another aspect.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

/**
 * Run one stage, inheriting its output.
 *
 * The child has already printed whatever went wrong, so a failure exits with
 * its code rather than rethrowing — execFileSync's error is a Node object dump
 * (pid, stdout: null, ...) that buries the real message under a stack trace.
 */
function step(script: string, args: string[]) {
  console.log(`\n=== ${script} ${args.join(" ")} ===`);
  try {
    execFileSync(TSX, [path.join(ROOT, "scripts", script), ...args], {
      stdio: "inherit",
    });
  } catch (err) {
    process.exit((err as { status?: number }).status ?? 1);
  }
}

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith("-")) ?? "smoke";
const rest = argv.filter((a) => a !== name);

step("shoot-still.ts", [name]);
step("render-still.ts", [name, ...rest]);
console.log(`\nDone. See out/shots/${name}-*.png`);
