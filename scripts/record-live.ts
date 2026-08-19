/**
 * Records one authenticated flow against a live app instance.
 *
 * Uses the persistent profile in `.session-profile/`, so it reuses whatever
 * `pnpm capture:session` logged in as. Runs HEADLESS by default — a window that
 * steals focus mid-shoot changes what the page renders, so it is not neutral.
 * Set HEADED=1 to watch a flow fail.
 *
 * It cannot complete a login itself any more, precisely because it is headless:
 * sign in once with `pnpm capture:session`, which is always headed.
 *
 * For several flows at once use `scripts/record-batch.ts`, which cannot use the
 * profile — it holds an exclusive lock — and seeds isolated contexts from
 * `storageState.json` instead.
 *
 * Usage:
 *   pnpm exec tsx scripts/record-live.ts <flow-name>
 *   pnpm exec tsx scripts/record-live.ts <flow-name> --check   # selectors only
 */
import "dotenv/config";
import { loadFlow, recordFlow } from "./lib/record";

async function main() {
  const name = process.argv[2];
  if (!name || name.startsWith("--")) {
    throw new Error("Usage: tsx scripts/record-live.ts <flow-name> [--check]");
  }
  const check = process.argv.includes("--check");
  if (check)
    console.log("— selector check (drives the flow, no video, no artifacts) —");

  const flow = await loadFlow(name);
  const result = await recordFlow(flow, { check, mode: "profile" });
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
