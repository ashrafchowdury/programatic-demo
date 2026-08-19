/**
 * Shoot several flows at once.
 *
 * The persistent profile can only be held by one browser, so the batch does the
 * one thing that needs it — proving the session is live and re-exporting
 * `storageState.json` — serially up front, then fans out into isolated contexts
 * that share nothing.
 *
 * Flows that write the same app state are grouped into a serial lane (see
 * `mutates` on Flow); lanes run in parallel, up to --concurrency.
 *
 * Usage:
 *   pnpm record:batch agent-instructions slash-commands
 *   pnpm record:batch --all
 *   pnpm record:batch a b c --concurrency 2
 *   pnpm record:batch a b --check      # selectors only, no video
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { laneOf, parseConcurrency, planLanes, runPool } from "./lib/batch";
import type { Flow } from "./lib/flow";
import { loadFlow, recordFlow, type RecordResult } from "./lib/record";
import { refreshSession } from "./lib/session";

const ROOT = path.resolve(import.meta.dirname, "..");
const FLOWS = path.join(ROOT, "flows");

/** Every flow that a batch can drive: it must know where to start. */
async function liveFlowNames(): Promise<string[]> {
  const names = fs
    .readdirSync(FLOWS)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".selectors.ts"))
    .map((f) => f.replace(/\.ts$/, ""));
  const out: string[] = [];
  for (const n of names) {
    const flow = await loadFlow(n).catch(() => null);
    if (flow?.startUrl) out.push(n);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const concurrency = parseConcurrency(argv);
  const all = argv.includes("--all");

  const names = all
    ? await liveFlowNames()
    : argv.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a));

  if (names.length === 0) {
    throw new Error(
      "Usage: tsx scripts/record-batch.ts <flow...> | --all [--concurrency N] [--check]",
    );
  }

  const flows: Flow[] = [];
  for (const n of names) flows.push(await loadFlow(n));

  const missing = flows.filter((f) => !f.startUrl && !process.env.APP_BASE_URL);
  if (missing.length) {
    throw new Error(
      `These flows have no startUrl, so a batch cannot drive them: ` +
        `${missing.map((f) => f.name).join(", ")}. Record them individually.`,
    );
  }

  const lanes = planLanes(flows);
  const width = Math.min(concurrency, lanes.length);
  console.log(
    `${flows.length} flow(s) in ${lanes.length} lane(s), ${width} at a time` +
      (check ? " (selector check)" : ""),
  );
  for (const lane of lanes.filter((l) => l.length > 1)) {
    console.log(
      `  serial lane "${laneOf(lane[0])}": ${lane.map((f) => f.name).join(" -> ")}`,
    );
  }

  // Serial, and before anything else: needs the profile lock every isolated
  // worker is about to do without, and fails loudly if we are not signed in.
  console.log(
    "session    -> refreshing storageState.json from .session-profile",
  );
  await refreshSession(flows[0]);

  const started = Date.now();
  const results = await runPool(
    lanes.map((lane) => async () => {
      const out: RecordResult[] = [];
      for (const flow of lane) {
        try {
          out.push(
            await recordFlow(flow, { check, mode: "isolated", tag: flow.name }),
          );
        } catch (err) {
          out.push({
            name: flow.name,
            ok: false,
            durationMs: 0,
            clicks: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return out;
    }),
    width,
  );

  const flat = results.flat();
  const failed = flat.filter((r) => !r.ok);
  console.log(
    `\n${flat.length - failed.length}/${flat.length} ok in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  for (const r of flat) {
    console.log(
      `  ${r.ok ? "✓" : "✗"} ${r.name}` +
        (r.ok
          ? ` (${(r.durationMs / 1000).toFixed(1)}s, ${r.clicks} clicks)`
          : ` — ${r.error}`),
    );
  }
  if (!check && failed.length === 0) {
    console.log(
      `\nNext: ${flat.map((r) => `pnpm convert ${r.name} && pnpm render ${r.name}`).join("\n      ")}`,
    );
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
