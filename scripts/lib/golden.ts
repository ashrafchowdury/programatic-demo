/**
 * Golden comparisons, pure: a compiled reel against the hand-cut reel it
 * replaces, and a composed take against the hand flow's take.
 *
 * Measured in two halves on purpose. Cut parity compiles against the HAND
 * flow's click log, so a pacing difference in an action cannot hide a compiler
 * regression; footage parity compares the logs alone.
 */
import { beatDemoS, isClip, type ReelSegment } from "../../src/lib/reel";
import type { ClickLog } from "../../src/lib/click-log";

/** Tolerances, each with the basis the report prints beside it. */
export const TOLERANCE = {
  pressS: {
    value: 0.3,
    basis: "about 10x the measured re-shoot spread (~0.03s)",
  },
  startS: { value: 0.35, basis: "the spread of hand clip leads on stage" },
  endS: {
    value: 0.75,
    basis: "hand ends follow the camera settling, not a beat",
  },
} as const;

/** How much worse than the hand cut a metric may get, per `analyze` total. */
export const METRIC_TOLERANCE: Record<
  string,
  { value: number; basis: string }
> = {
  meanShotS: { value: 0.6, basis: "one card's length either way" },
  cutsPerMin: { value: 6, basis: "two boundaries in a 20s film" },
  movingFrac: { value: 0.1, basis: "ten points of moving frames" },
  longestStillF: { value: 15, basis: "half a second at 30 fps" },
  footageLongestFrozenS: {
    value: 0.5,
    basis: "half a second of dead air in footage",
  },
};

export type Kind = "card" | "clip";
export const structureOf = (segments: readonly ReelSegment[]): Kind[] =>
  segments.map((s) => (isClip(s) ? "clip" : "card"));

export type Range = { fromS: number; toS: number };
export const clipRanges = (segments: readonly ReelSegment[]): Range[] =>
  segments
    .filter(isClip)
    .map((s) => ({ fromS: s.clip.fromS, toS: s.clip.toS }));

/** A compiled clip, with the press of the first beat it shows. */
export type CompiledClip = Range & { firstBeatS: number; label: string };

export type RangeRow = {
  /** 1-based, in the compiled reel. */
  clip: number;
  label: string;
  /** 1-based hand clip that shows this clip's first beat, or null. */
  hand: number | null;
  compiled: Range;
  handRange: Range | null;
  /** null where the edge is not compared: inside a hand clip, or a deliberate edit. */
  dStart: number | null;
  dEnd: number | null;
  deliberate: string | null;
  ok: boolean;
  note: string | null;
};

export type ClipComparison = {
  rows: RangeRow[];
  unshown: number[];
  ok: boolean;
};

/**
 * Compiled clips against hand clips, in order, by the beats they show.
 *
 * Each compiled clip pairs with the hand clip whose range holds its first
 * beat's press (or starts within the start tolerance after it). Where one hand clip holds several compiled clips, only its
 * outer edges are compared (the first clip's start, the last one's end): the
 * hand reel made no cut inside it, so the compiled cuts there are shape, not
 * range. A compiled clip whose first beat no hand clip shows fails, and so
 * does a hand clip no compiled clip pairs with.
 */
export function compareClips(
  compiled: readonly CompiledClip[],
  hand: readonly Range[],
  deliberate: Record<number, string> = {},
): ClipComparison {
  const pair = compiled.map((c) => {
    // A hand cut can enter a hair after the press it shows (agent-tool's
    // second clip starts 0.06s after "search 1327 apps"), so the start edge
    // gets the start tolerance; a press inside a clip still wins.
    const inside = hand.findIndex(
      (h) => h.fromS - 1e-9 <= c.firstBeatS && c.firstBeatS < h.toS,
    );
    const near = hand.findIndex(
      (h) =>
        h.fromS - TOLERANCE.startS.value - 1e-9 <= c.firstBeatS &&
        c.firstBeatS < h.toS,
    );
    const j = inside >= 0 ? inside : near;
    return j >= 0 ? j : null;
  });
  const rows = compiled.map((c, i): RangeRow => {
    const j = pair[i];
    const why = deliberate[i + 1] ?? null;
    const base = {
      clip: i + 1,
      label: c.label,
      hand: j === null ? null : j + 1,
      compiled: { fromS: c.fromS, toS: c.toS },
      deliberate: why,
    };
    if (j === null)
      return {
        ...base,
        handRange: null,
        dStart: null,
        dEnd: null,
        ok: false,
        note: `no hand clip shows "${c.label}"`,
      };
    const h = hand[j];
    const first = pair.indexOf(j) === i;
    const last = pair.lastIndexOf(j) === i;
    const dStart = first && !why ? c.fromS - h.fromS : null;
    const dEnd = last && !why ? c.toS - h.toS : null;
    const ok =
      (dStart === null || Math.abs(dStart) <= TOLERANCE.startS.value + 1e-9) &&
      (dEnd === null || Math.abs(dEnd) <= TOLERANCE.endS.value + 1e-9);
    const inner = [!first && "start", !last && "end"].filter(Boolean);
    const note = inner.length
      ? `${inner.join(" and ")} inside hand clip ${j + 1}, which has no cut there`
      : null;
    return { ...base, handRange: h, dStart, dEnd, ok, note };
  });
  const unshown = hand
    .map((_, j) => j)
    .filter((j) => !pair.includes(j))
    .map((j) => j + 1);
  return { rows, unshown, ok: rows.every((r) => r.ok) && unshown.length === 0 };
}

export const lengthOk = (compiledS: number, maxS: number) =>
  compiledS <= maxS + 1e-9;

export type FootageParity = {
  labelsEqual: boolean;
  firstDiff: string | null;
  rows: {
    label: string;
    goldenS: number;
    handS: number;
    d: number;
    ok: boolean;
  }[];
  ok: boolean;
};

/** A composed take against the hand take: same labels, presses within ±0.3s after aligning the first. */
export function footageParity(
  golden: ClickLog,
  hand: ClickLog,
  speed: number,
): FootageParity {
  const g = golden.clicks.filter((c) => c.label);
  const h = hand.clicks.filter((c) => c.label);
  const gl = g.map((c) => c.label!);
  const hl = h.map((c) => c.label!);
  const n = Math.max(gl.length, hl.length);
  let firstDiff: string | null = null;
  for (let i = 0; i < n && firstDiff === null; i++)
    if (gl[i] !== hl[i])
      firstDiff = `label ${i + 1}: composed "${gl[i] ?? "(none)"}" vs hand "${hl[i] ?? "(none)"}"`;
  const rows: FootageParity["rows"] = [];
  if (firstDiff === null && g.length) {
    const g0 = beatDemoS(g[0], golden, speed);
    const h0 = beatDemoS(h[0], hand, speed);
    g.forEach((c, i) => {
      const goldenS = beatDemoS(c, golden, speed) - g0;
      const handS = beatDemoS(h[i], hand, speed) - h0;
      const d = goldenS - handS;
      rows.push({
        label: c.label!,
        goldenS,
        handS,
        d,
        ok: Math.abs(d) <= TOLERANCE.pressS.value + 1e-9,
      });
    });
  }
  return {
    labelsEqual: firstDiff === null,
    firstDiff,
    rows,
    ok: firstDiff === null && rows.every((r) => r.ok),
  };
}

export type MetricRow = {
  metric: string;
  compiled: number;
  hand: number;
  target: number | null;
  worseBy: number;
  tolerance: number;
  ok: boolean;
};

/**
 * No metric worse than the hand cut by more than its tolerance. "Worse" is
 * further from the style's target where it has one, else any difference.
 */
export function compareMetrics(
  compiled: Record<string, number>,
  hand: Record<string, number>,
  targets: Record<string, number | string> | null,
): MetricRow[] {
  return Object.entries(METRIC_TOLERANCE).map(([metric, tol]) => {
    const target =
      targets && typeof targets[metric] === "number"
        ? (targets[metric] as number)
        : null;
    const worseBy =
      target === null
        ? Math.abs(compiled[metric] - hand[metric])
        : Math.abs(compiled[metric] - target) - Math.abs(hand[metric] - target);
    return {
      metric,
      compiled: compiled[metric],
      hand: hand[metric],
      target,
      worseBy,
      tolerance: tol.value,
      ok: worseBy <= tol.value + 1e-9,
    };
  });
}
