/**
 * Checks every action in the library against its live surface, without
 * recording: catches UI drift (a renamed button, a moved field) before a
 * launch needs the action.
 *
 *   pnpm actions:check                 every action
 *   pnpm actions:check skills.add ...  only these
 *   pnpm actions:check --include-unrestored
 *                                      also actions whose prepare cannot undo
 *                                      what they change (skipped by default)
 *
 * Per action: the static contract, then a one-action flow composed from its
 * `example` params run in selector-check mode, then its `prepare` again to
 * clean up what the check wrote. Each action reports pass or fail on its own;
 * the exit code is non-zero if any failed.
 */
import "dotenv/config";
import { HOUSES, HOUSE_DEFAULT } from "../src/lib/house";
import {
  actionProblems,
  composeFlow,
  loadRegistry,
  type AnyAction,
} from "./lib/action";
import { recordFlow } from "./lib/record";

type Verdict = { id: string; ok: boolean; skipped?: boolean; why?: string };

async function checkAction(
  action: AnyAction,
  registry: Awaited<ReturnType<typeof loadRegistry>>["registry"],
): Promise<Verdict> {
  const contract = actionProblems(action, registry.surfaces);
  if (contract.length)
    return { id: action.id, ok: false, why: contract.join("; ") };
  const composed = composeFlow(
    `actions-check-${action.id}`,
    {
      surface: action.surface,
      actions: [{ use: action.id, with: action.example }],
    },
    registry,
    HOUSES[HOUSE_DEFAULT],
  );
  if ("problems" in composed)
    return {
      id: action.id,
      ok: false,
      why: composed.problems.map((p) => p.message).join("; "),
    };
  const flow = composed.flow;
  const startUrl = flow.startUrl!;
  // The check drives the product for real, so it writes; prepare undoes it.
  const run = flow.run;
  flow.run = async (ctx) => {
    await run(ctx);
    try {
      await action.prepare({ page: ctx.page, startUrl }, action.example);
    } catch (err) {
      throw new Error(
        `cleanup prepare failed after the check: ${err instanceof Error ? err.message : err}`,
      );
    }
  };
  try {
    const r = await recordFlow(flow, {
      check: true,
      mode: "profile",
      tag: action.id,
    });
    return r.ok
      ? { id: action.id, ok: true }
      : { id: action.id, ok: false, why: r.error?.split("\n")[0] };
  } catch (err) {
    return {
      id: action.id,
      ok: false,
      why: (err instanceof Error ? err.message : String(err)).split("\n")[0],
    };
  }
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const includeUnrestored = process.argv.includes("--include-unrestored");
  const { registry, problems } = await loadRegistry();
  for (const p of problems) console.error(`✗ ${p}`);
  const unknown = wanted.filter((id) => !registry.actions.has(id));
  if (unknown.length)
    throw new Error(
      `Unknown action(s): ${unknown.join(", ")}. Known: ${[...registry.actions.keys()].join(", ")}`,
    );
  const actions = [...registry.actions.values()].filter(
    (a) => !wanted.length || wanted.includes(a.id),
  );

  const verdicts: Verdict[] = [];
  for (const action of actions) {
    if (action.unrestored && !includeUnrestored) {
      verdicts.push({
        id: action.id,
        ok: true,
        skipped: true,
        why: `skipped: it ${action.unrestored}; pass --include-unrestored to check it anyway`,
      });
      continue;
    }
    console.log(`\n=== ${action.id} (surface ${action.surface}) ===`);
    verdicts.push(await checkAction(action, registry));
  }

  console.log("\nactions:check");
  for (const v of verdicts)
    console.log(
      `  ${v.skipped ? "-" : v.ok ? "✓" : "✗"} ${v.id}${v.why ? `: ${v.why}` : ""}`,
    );
  const failed = verdicts.filter((v) => !v.ok).length + problems.length;
  const skipped = verdicts.filter((v) => v.skipped).length;
  console.log(
    failed
      ? `\n${failed} failed.`
      : `\nall ${verdicts.length - skipped} checked passed${skipped ? `; ${skipped} skipped as unrestorable` : ""}.`,
  );
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
