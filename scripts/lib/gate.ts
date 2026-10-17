/**
 * The launch quality gate, as a pure function of `analyze`'s reel totals.
 *
 * A rendered reel fails when a motion metric sits further from its style's
 * `targets` than the house tolerates, when it runs past the house maximum, or
 * when a cap cut more of a clip than the house lets pass unremarked. Each
 * aspect is gated on its own, so a failing 9:16 cannot hide behind a 16:9.
 */
import type { CapNote } from "../../src/lib/compile-brief";
import type { GateMetric, House } from "../../src/lib/house";
import type { GrammarTargets } from "../../src/lib/style";

/** The `summary` block `pnpm analyze --json` writes for a reel. */
export type ReelSummary = { durationS: number } & Record<GateMetric, number>;

export type GateCheck = {
  aspect: string;
  what: string;
  value: number;
  /** null when the style states no target for it. */
  target: number | null;
  tolerance: number | null;
  ok: boolean;
};

export const GATE_METRICS: readonly GateMetric[] = ["meanShotS", "cutsPerMin", "movingFrac", "longestStillF"];

export function gateChecks(
  aspect: string,
  summary: ReelSummary,
  targets: GrammarTargets | null,
  house: House,
  notes: readonly CapNote[],
): GateCheck[] {
  const out: GateCheck[] = GATE_METRICS.map((m) => {
    const target = targets ? targets[m] : null;
    const tolerance = target === null ? null : house.gate.tolerance[m];
    const ok = target === null || Math.abs(summary[m] - target) <= tolerance!;
    return { aspect, what: m, value: summary[m], target, tolerance, ok };
  });
  out.push({
    aspect,
    what: "length",
    value: summary.durationS,
    target: house.maxLengthS,
    tolerance: 0,
    ok: summary.durationS <= house.maxLengthS + 1e-6,
  });
  const worst = notes.reduce((a, n) => Math.max(a, n.cutS), 0);
  out.push({ aspect, what: "capped", value: worst, target: house.gate.capReportS, tolerance: 0, ok: worst <= house.gate.capReportS });
  return out;
}

/** "9:16 movingFrac 0.21 vs target 0.678 ±0.5" for a failed check. */
export function gateLine(c: GateCheck): string {
  const v = Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(3);
  if (c.what === "length") return `${c.aspect} length ${v}s vs house maximum ${c.target}s`;
  if (c.what === "capped") return `${c.aspect} a cap cut ${v}s of a clip; the house allows ${c.target}s`;
  if (c.target === null) return `${c.aspect} ${c.what} ${v} (no target in this style)`;
  return `${c.aspect} ${c.what} ${v} vs target ${c.target} ±${c.tolerance}`;
}
