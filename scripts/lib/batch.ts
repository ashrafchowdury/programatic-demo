/**
 * Scheduling for multi-flow shoots. No browser here on purpose — this is the
 * part with the interesting failure modes, so it stays pure and tested.
 */
import type { Flow } from "./flow";

/**
 * The resource a flow competes for.
 *
 * Two demos that write the same thing cannot run at once: `agent-instructions`
 * empties AGENTS.md in `prepare` and then types into it, so a second copy racing
 * it would blank the first one's editor mid-take. Flows declare shared state
 * with `mutates`; anything sharing a key runs in one serial lane.
 *
 * Defaulting to the flow's own name — rather than "no conflict" — means the same
 * flow never overlaps itself, which is the accident most likely to happen by
 * hand. Read-only flows can still be parallelised by giving them a common key
 * only if they genuinely share state; leaving `mutates` unset is the safe path.
 */
export const laneOf = (flow: Flow): string => flow.mutates ?? flow.name;

/**
 * Group flows into serial lanes. Lanes run in parallel; each lane's flows run
 * one after another, in the order given.
 */
export function planLanes(flows: readonly Flow[]): Flow[][] {
  const lanes = new Map<string, Flow[]>();
  for (const flow of flows) {
    const key = laneOf(flow);
    const lane = lanes.get(key);
    if (lane) lane.push(flow);
    else lanes.set(key, [flow]);
  }
  return [...lanes.values()];
}

/**
 * Run jobs with at most `limit` in flight.
 *
 * Results come back in the order the jobs were given, not the order they
 * finished, so a batch report reads the same however the scheduling fell out.
 * A rejecting job rejects the pool — callers that want a full report should
 * catch inside the job and return a result object instead.
 */
export async function runPool<T>(
  jobs: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, jobs.length));
  const results = new Array<T>(jobs.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      results[i] = await jobs[i]();
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/**
 * Default parallelism.
 *
 * Each shoot is a whole Chromium plus a video encoder, so this is bound by
 * memory, not cores — a previous run put 8 browsers up and the machine started
 * OOM-killing renders. Three is comfortable on 16GB. Recording is mostly spent
 * waiting on beats and page settles, so the returns past that are small anyway.
 */
export const DEFAULT_CONCURRENCY = 3;

/** Parse `--concurrency N` / `-c N`, falling back to the default. */
export function parseConcurrency(argv: readonly string[]): number {
  const i = argv.findIndex((a) => a === "--concurrency" || a === "-c");
  if (i >= 0) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  const inline = argv.find((a) => a.startsWith("--concurrency="));
  if (inline) {
    const n = Number(inline.split("=")[1]);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return DEFAULT_CONCURRENCY;
}
