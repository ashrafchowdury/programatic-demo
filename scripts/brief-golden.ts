/**
 * The golden harness: rebuild the hand-made launches from actions and briefs,
 * and measure them against the originals.
 *
 *   pnpm brief:golden --check   structure, clip ranges and length; compiles
 *                               against the hand flows' click logs. Records and
 *                               renders nothing.
 *   pnpm brief:golden --cut     also renders each compiled reel and its hand
 *                               reel, and compares `analyze` metrics. No record.
 *   pnpm brief:golden           also records each brief's footage through its
 *                               actions and compares the take with the hand
 *                               flow's (footage parity). Needs the live app.
 *
 * The golden set is reels/golden/<launch>.golden.json, each naming its brief,
 * hand flow, hand reel and deliberate edits. Hand reels in a style no house is
 * built on are listed as unsupported. Writes
 * docs/reel/design/compiler-validation.md (keeping everything below its
 * hand-written marker) and exits non-zero if any supported launch fails.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chipText, type Brief } from "../src/lib/brief";
import type { ClickLog } from "../src/lib/click-log";
import { compileBrief, timeline } from "../src/lib/compile-brief";
import { HOUSES, type House } from "../src/lib/house";
import {
  findBeat,
  isClip,
  resolveReel,
  type Reel,
  type ResolvedReel,
} from "../src/lib/reel";
import { resolveStyle, STYLE_PRESETS } from "../src/lib/style";
import { composeFlow } from "./lib/action";
import { checkBrief, problemLines, readClickLog, ROOT } from "./lib/brief-io";
import {
  clipRanges,
  compareClips,
  compareMetrics,
  footageParity,
  lengthOk,
  METRIC_TOLERANCE,
  structureOf,
  TOLERANCE,
  type ClipComparison,
  type CompiledClip,
  type FootageParity,
  type MetricRow,
} from "./lib/golden";
import { recordFlow } from "./lib/record";
import { cutReel } from "./lib/reel-cut";

type Mode = "check" | "cut" | "full";

type Golden = {
  launch: string;
  /** reels/golden/<launch>.brief.json, relative to the repo. */
  brief: string;
  handFlow: string;
  handReel: string;
  /** 1-based compiled clip -> why it departs from the hand range on purpose. */
  deliberate?: Record<string, string>;
};

type Result = {
  golden: Golden;
  house: string;
  problems: string[];
  /** Information only: the compiler keeps one shape, the hand reels each have their own. */
  shape?: { compiled: string[]; hand: string[]; same: boolean };
  clips?: ClipComparison;
  length?: { compiledS: number; handS: number; maxS: number; ok: boolean };
  metrics?: MetricRow[];
  footage?: FootageParity;
  ok: boolean;
};

const GOLDEN_DIR = path.join(ROOT, "reels", "golden");
const REPORT = path.join(
  ROOT,
  "docs",
  "reel",
  "design",
  "compiler-validation.md",
);
const MARKER =
  "<!-- hand-written below this line is kept across golden runs -->";
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const s2 = (x: number) => x.toFixed(2);
const sgn = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

async function importReel(name: string): Promise<Reel> {
  return (
    await import(pathToFileURL(path.join(ROOT, "reels", `${name}.ts`)).href)
  ).default as Reel;
}

function resolved(reel: Reel, log: ClickLog, house: House): ResolvedReel {
  const r = resolveReel(reel, log, house.shoot.speed);
  if ("problem" in r) throw new Error(`${reel.name}: ${r.problem}`);
  return r.reel;
}

/** analyze's reel totals. Its own footage checks may fail; only a missing file is an error. */
function analyzeSummary(
  file: string,
  json: string,
  style: string,
): Record<string, number> {
  fs.rmSync(json, { force: true });
  try {
    execFileSync(
      TSX,
      [
        path.join(ROOT, "scripts", "analyze.ts"),
        file,
        "--reel",
        "--style",
        style,
        "--json",
        json,
      ],
      { stdio: "inherit" },
    );
  } catch {
    if (!fs.existsSync(json))
      throw new Error(`analyze wrote no measurement for ${file}`);
  }
  return JSON.parse(fs.readFileSync(json, "utf8")).summary as Record<
    string,
    number
  >;
}

async function runOne(golden: Golden, mode: Mode): Promise<Result> {
  const run = await checkBrief(golden.brief);
  const result: Result = {
    golden,
    house: run.house?.id ?? "?",
    problems: [],
    ok: false,
  };
  if (run.problems.length) {
    result.problems.push(
      `brief does not validate:\n${problemLines(run.problems).join("\n")}`,
    );
    return result;
  }
  const brief = run.brief!;
  const house = run.house!;
  const handLog = readClickLog(golden.handFlow);
  if (!handLog) {
    result.problems.push(
      `no hand click log at public/${golden.handFlow}.clicks.json`,
    );
    return result;
  }

  // Cut parity: compile against the HAND take.
  const { footage: _footage, demo: _demo, ...copy } = brief;
  const asCut = {
    ...copy,
    name: `golden-${golden.launch}`,
    demo: golden.handFlow,
  } as Brief;
  const compiled = compileBrief(
    asCut,
    handLog,
    house,
    chipText(brief, run.registry!),
  );
  if ("problems" in compiled) {
    result.problems.push(
      `does not compile against the hand log:\n${problemLines(compiled.problems).join("\n")}`,
    );
    return result;
  }
  const handReel = await importReel(golden.handReel);
  const mine = resolved(compiled.reel, handLog, house);
  const theirs = resolved(handReel, handLog, house);
  const cs = structureOf(mine.segments);
  const hs = structureOf(theirs.segments);
  result.shape = { compiled: cs, hand: hs, same: cs.join() === hs.join() };
  const deliberate = Object.fromEntries(
    Object.entries(golden.deliberate ?? {}).map(([k, v]) => [Number(k), v]),
  );
  const authored = compiled.reel.segments.filter(isClip);
  const clips: CompiledClip[] = clipRanges(mine.segments).map((r, i) => {
    const hit = findBeat(
      authored[i].clip.fromBeat!,
      handLog,
      house.shoot.speed,
    );
    if ("problem" in hit) throw new Error(`${golden.launch}: ${hit.problem}`);
    return {
      ...r,
      firstBeatS: hit.s,
      label: authored[i].clip.label ?? `clip ${i + 1}`,
    };
  });
  result.clips = compareClips(clips, clipRanges(theirs.segments), deliberate);
  const compiledS = timeline(mine).runtimeS;
  const handS = timeline(theirs).runtimeS;
  result.length = {
    compiledS,
    handS,
    maxS: house.maxLengthS,
    ok: lengthOk(compiledS, house.maxLengthS),
  };

  if (mode !== "check") {
    const outBase = `golden-${golden.launch}`;
    cutReel(compiled.reel, { source: golden.brief, outBase });
    cutReel(handReel, {
      source: `reels/${golden.handReel}.ts`,
      outBase: golden.handReel,
    });
    const diag = path.join(ROOT, ".diag", "golden");
    fs.mkdirSync(diag, { recursive: true });
    const a = analyzeSummary(
      `out/reel/${outBase}.mp4`,
      path.join(diag, `${outBase}.json`),
      house.style,
    );
    const b = analyzeSummary(
      `out/reel/${golden.handReel}.mp4`,
      path.join(diag, `${golden.handReel}.json`),
      resolveStyle(handReel),
    );
    const targets = STYLE_PRESETS[resolveStyle(handReel)].targets as Record<
      string,
      number | string
    > | null;
    result.metrics = compareMetrics(a, b, targets);
  }

  if (mode === "full") {
    const composed = composeFlow(
      `golden-${golden.launch}`,
      brief.footage!,
      run.registry!,
      house,
    );
    if ("problems" in composed) {
      result.problems.push(
        `does not compose: ${composed.problems.map((p) => p.message).join("; ")}`,
      );
    } else {
      const take = await recordFlow(composed.flow, { mode: "profile" }).catch(
        (e: Error) => ({ ok: false, error: e.message }),
      );
      const goldenLog = readClickLog(`golden-${golden.launch}`);
      if (!take.ok || !goldenLog)
        result.problems.push(
          `recording failed: ${take.error?.split("\n")[0] ?? "no click log"}`,
        );
      else
        result.footage = footageParity(goldenLog, handLog, house.shoot.speed);
    }
  }

  result.ok =
    result.problems.length === 0 &&
    result.clips.ok &&
    result.length.ok &&
    (result.metrics?.every((m) => m.ok) ?? true) &&
    (result.footage?.ok ?? true);
  return result;
}

/** Hand reels whose style no house is built on: listed, never compared. */
async function unsupported(
  goldens: Golden[],
): Promise<{ name: string; style: string }[]> {
  const housed = new Set(Object.values(HOUSES).map((h) => h.style));
  const covered = new Set(goldens.map((g) => g.handReel));
  const out: { name: string; style: string }[] = [];
  for (const f of fs
    .readdirSync(path.join(ROOT, "reels"))
    .filter((f) => f.endsWith(".ts"))
    .sort()) {
    const name = f.replace(/\.ts$/, "");
    if (covered.has(name)) continue;
    const reel = await importReel(name).catch(() => null);
    if (
      !reel ||
      fs
        .readFileSync(path.join(ROOT, "reels", f), "utf8")
        .includes("Emitted by `pnpm brief --emit`")
    )
      continue;
    const style = resolveStyle(reel);
    if (!housed.has(style)) out.push({ name, style });
  }
  return out;
}

function report(
  results: Result[],
  skipped: { name: string; style: string }[],
  mode: Mode,
): string {
  const L: string[] = [];
  L.push("# Compiler validation", "");
  L.push(
    "Written by `pnpm brief:golden" +
      (mode === "full" ? "" : ` --${mode}`) +
      "`. Each hand-made launch is",
    "rebuilt from a brief and measured against the original. Cut parity compiles",
    "against the hand flow's click log and compares clips in order, by the beats",
    "they show, plus length against the house maximum and (cut mode) metrics;",
    "footage parity compares a composed take with the hand take. Segment shapes",
    "are listed as information only: the compiler keeps one shape. See",
    "`openspec/changes/post-to-reel-compiler/design.md` §12.",
    "",
  );
  L.push(
    `Mode: **${mode}** (${mode === "check" ? "clip ranges, length" : mode === "cut" ? "plus rendered metrics" : "plus recorded footage"}).`,
    "",
  );
  L.push(
    "Houses: " +
      Object.values(HOUSES)
        .map((h) => `\`${h.id}\` (${h.style})`)
        .join(", ") +
      ".",
    "",
  );
  L.push(
    "| launch | house | clips in tolerance | length (house max) | metrics | footage | shape | result |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of results) {
    const okRanges = r.clips
      ? `${r.clips.rows.filter((x) => x.ok).length}/${r.clips.rows.length}${r.clips.unshown.length ? `, hand ${r.clips.unshown.join(", ")} unshown` : ""}`
      : "n/a";
    const len = r.length
      ? `${s2(r.length.compiledS)}s (${r.length.maxS}s)`
      : "n/a";
    const met = r.metrics
      ? `${r.metrics.filter((m) => m.ok).length}/${r.metrics.length}`
      : "not run";
    const foot = r.footage ? (r.footage.ok ? "pass" : "fail") : "not run";
    L.push(
      `| ${r.golden.launch} | ${r.house} | ${okRanges} | ${len}${r.length && !r.length.ok ? " ✗" : ""} | ${met} | ${foot} | ${r.shape ? (r.shape.same ? "same" : "differs (info)") : "n/a"} | **${r.ok ? "pass" : "fail"}** |`,
    );
  }
  L.push("");
  if (skipped.length) {
    L.push(
      "Unsupported in this version (no house is built on their style):",
      "",
    );
    for (const s of skipped)
      L.push(
        `- \`${s.name}\` (\`${s.style}\`): the compiler emits \`classic\` and \`stage\` reels only; \`${s.style}\` needs crop or push derivation, which is out of scope.`,
      );
    L.push("");
  }
  L.push("Tolerances:", "");
  for (const [k, t] of Object.entries(TOLERANCE))
    L.push(`- ${k}: ±${t.value}s. ${t.basis}.`);
  L.push("- length: at most the house maximum.");
  for (const [k, t] of Object.entries(METRIC_TOLERANCE))
    L.push(
      `- metric ${k}: no worse than the hand cut by more than ${t.value}. ${t.basis}.`,
    );
  L.push("");

  for (const r of results) {
    L.push(`## ${r.golden.launch}`, "");
    L.push(
      `Brief \`${r.golden.brief}\` under \`${r.house}\`; hand flow \`${r.golden.handFlow}\`, hand reel \`reels/${r.golden.handReel}.ts\`.`,
      "",
    );
    for (const p of r.problems) L.push("```", p, "```", "");
    if (r.clips) {
      L.push(
        "| clip | shows | compiled (demo s) | hand clip | hand (demo s) | Δ start | Δ end | ok |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const x of r.clips.rows)
        L.push(
          `| ${x.clip} | ${x.label} | ${s2(x.compiled.fromS)}-${s2(x.compiled.toS)} | ${x.hand ?? "none"} | ${x.handRange ? `${s2(x.handRange.fromS)}-${s2(x.handRange.toS)}` : "-"} | ${x.dStart === null ? "-" : sgn(x.dStart)} | ${x.dEnd === null ? "-" : sgn(x.dEnd)} | ${x.deliberate ? `deliberate: ${x.deliberate}` : x.ok ? (x.note ? `yes (${x.note})` : "yes") : `**no**${x.note ? ` (${x.note})` : ""}`} |`,
        );
      if (r.clips.unshown.length)
        L.push(
          "",
          `Hand clip(s) ${r.clips.unshown.join(", ")} show no beat the brief shows: **fail**.`,
        );
      L.push("");
    }
    if (r.length)
      L.push(
        `Length ${s2(r.length.compiledS)}s against the house maximum ${r.length.maxS}s: ${r.length.ok ? "within" : "**over**"}. (Hand reel: ${s2(r.length.handS)}s, for information.)`,
        "",
      );
    if (r.shape) {
      L.push(
        `Shape (information, never a failure): ${r.shape.same ? "the same" : "different"}.`,
        "",
      );
      L.push(
        `- compiled: ${r.shape.compiled.join(" · ")}`,
        `- hand: ${r.shape.hand.join(" · ")}`,
        "",
      );
    }
    if (r.metrics) {
      L.push(
        "| metric | compiled | hand | target | worse by | tolerance | ok |",
        "| --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const m of r.metrics)
        L.push(
          `| ${m.metric} | ${m.compiled.toFixed(3)} | ${m.hand.toFixed(3)} | ${m.target ?? "-"} | ${m.worseBy.toFixed(3)} | ${m.tolerance} | ${m.ok ? "yes" : "**no**"} |`,
        );
      L.push("");
    }
    if (r.footage) {
      L.push(
        `Footage parity: labels ${r.footage.labelsEqual ? "equal" : `differ (${r.footage.firstDiff})`}.`,
        "",
      );
      if (r.footage.rows.length) {
        L.push(
          "| label | composed (s from first) | hand | Δ | ok |",
          "| --- | --- | --- | --- | --- |",
        );
        for (const x of r.footage.rows)
          L.push(
            `| ${x.label} | ${s2(x.goldenS)} | ${s2(x.handS)} | ${sgn(x.d)} | ${x.ok ? "yes" : "**no**"} |`,
          );
        L.push("");
      }
    }
  }
  return L.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const mode: Mode = args.includes("--check")
    ? "check"
    : args.includes("--cut")
      ? "cut"
      : "full";
  const files = fs.existsSync(GOLDEN_DIR)
    ? fs
        .readdirSync(GOLDEN_DIR)
        .filter((f) => f.endsWith(".golden.json"))
        .sort()
    : [];
  if (!files.length)
    throw new Error(`No golden set: reels/golden/*.golden.json is empty.`);
  const goldens = files.map(
    (f) =>
      JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as Golden,
  );
  const results: Result[] = [];
  for (const g of goldens) {
    console.log(`\n=== golden ${g.launch} (${mode}) ===`);
    results.push(await runOne(g, mode));
  }
  const skipped = await unsupported(goldens);

  const kept =
    fs.existsSync(REPORT) && fs.readFileSync(REPORT, "utf8").includes(MARKER)
      ? fs.readFileSync(REPORT, "utf8").split(MARKER)[1]
      : "\n\n## Seed log\n\nEach change to a house seed, and the golden result that justified it.\n";
  fs.writeFileSync(
    REPORT,
    `${report(results, skipped, mode)}\n${MARKER}${kept}`,
  );

  console.log(`\ngolden (${mode})`);
  for (const r of results)
    console.log(
      `  ${r.ok ? "✓" : "✗"} ${r.golden.launch} (${r.house})${r.problems.length ? `: ${r.problems[0].split("\n")[0]}` : ""}`,
    );
  for (const s of skipped)
    console.log(`  - ${s.name}: unsupported (${s.style})`);
  console.log(`report     -> ${path.relative(ROOT, REPORT)}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
