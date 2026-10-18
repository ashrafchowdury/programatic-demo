/**
 * Brief to finished, gated reels in one command.
 *
 *   pnpm launch <name>                 every stage, in order
 *   pnpm launch <name> --from <stage>  resume, reusing what earlier stages wrote
 *   pnpm launch <name> --from render-reel --patch=12.4-15
 *                                      re-render only that window of the reel
 *                                      (reel seconds), keeping the last cut's
 *                                      chunks elsewhere — scripts/lib/chunks.ts
 *
 * Stages: validate → compose → check → record → convert → render-demo →
 * compile → render-reel → gate. A `demo` brief skips compose through
 * render-demo as satisfied and cuts from that demo. The run stops at the first
 * failure, and out/launch/<name>/status.json is rewritten after every stage
 * with its state, times, outputs and problems (in the brief validator's
 * path-and-sentence form), so an agent or a person knows where it stopped and
 * where to resume.
 *
 * No approval mid-run, and nothing is posted anywhere: on success it prints
 * the reel paths, the brief's copy and the gate results, for a person to
 * approve or reject from that output alone.
 *
 * The stages call what the single commands call: the recorder, the reel cutter
 * and the compiler in-process; convert, render and analyze as the scripts
 * themselves, as `pnpm clip` does.
 */
import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { aspectSlug, isNativeAspect, type Aspect } from "../src/lib/aspect";
import { chipText, type Problem } from "../src/lib/brief";
import { compileBrief, type Compiled } from "../src/lib/compile-brief";
import { STYLE_PRESETS } from "../src/lib/style";
import { composeFlow } from "./lib/action";
import { checkBrief, clickLogFile, problemLines, readClickLog, ROOT, withScenes, type BriefRun } from "./lib/brief-io";
import type { Flow } from "./lib/flow";
import { gateChecks, gateLine, type GateCheck, type ReelSummary } from "./lib/gate";
import { auditCardFrames, cardSpans } from "./lib/brand-frames";
import { brandProblems } from "../src/lib/brand-audit";
import { resolveBrand } from "../src/lib/brand";
import { outPathOf } from "./lib/out";
import { recordFlow } from "./lib/record";
import { patchFlag, type PatchWindow } from "./lib/chunks";
import { cutReel } from "./lib/reel-cut";

const STAGES = [
  "validate",
  "compose",
  "check",
  "record",
  "convert",
  "render-demo",
  "compile",
  "render-reel",
  "gate",
] as const;
type StageName = (typeof STAGES)[number];

type StageState = "passed" | "failed" | "skipped" | "reused";
type StageRecord = {
  state: StageState;
  startedAt?: string;
  endedAt?: string;
  outputs?: Record<string, unknown>;
  problems?: Problem[];
  note?: string;
};
type Status = {
  name: string;
  briefVersion: number | null;
  house: string | null;
  from: StageName;
  ok: boolean | null;
  stages: Partial<Record<StageName, StageRecord>>;
};

type Ctx = {
  name: string;
  /** --patch windows for render-reel, in reel seconds. */
  patch: PatchWindow[] | null;
  run: BriefRun;
  /** The demo the reels cut from: the brief's `demo`, else its own name. */
  demo: string;
  shoots: boolean;
  flow?: Flow;
  compiled?: Compiled;
  reels: { aspect: Aspect; file: string }[];
};

type Outcome = { outputs?: Record<string, unknown>; problems?: Problem[]; skip?: string };

const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const rel = (f: string) => path.relative(ROOT, f);
const fail = (path: string, message: string): Outcome => ({ problems: [{ path, message }] });

/** Files a stage reads that an earlier stage writes: what --from must find on disk. */
const NEEDS: Partial<Record<StageName, { file: (c: Ctx) => string[]; madeBy: StageName }[]>> = {
  convert: [{ file: (c) => [`recordings/${c.demo}.mkv`, `recordings/${c.demo}.webm`], madeBy: "record" }],
  "render-demo": [{ file: (c) => [`public/${c.demo}.mp4`], madeBy: "convert" }],
  compile: [{ file: (c) => [rel(clickLogFile(c.demo))], madeBy: "record" }],
  "render-reel": [
    {
      // Only a house that renders the standalone demo needs it: the reel checks
      // its clip ranges against that file's frame count.
      file: (c) => (c.run.house?.render?.standaloneDemo === false ? [] : [`out/demo/${c.demo}.mp4`]),
      madeBy: "render-demo",
    },
  ],
  gate: [{ file: (c) => reelFiles(c).map((r) => rel(r.file)), madeBy: "render-reel" }],
};

const reelFiles = (c: Ctx) =>
  (c.run.house?.aspects ?? []).map((aspect) => ({
    aspect,
    file: outPathOf("reel", `${[c.name, isNativeAspect(aspect) ? undefined : aspectSlug(aspect)].filter(Boolean).join(".")}.mp4`),
  }));

/**
 * Run a script the way its pnpm command does. Its output streams through as
 * usual; on failure the problem carries its last error lines, so status.json
 * says why without the terminal scrollback.
 */
async function script(file: string, args: string[]): Promise<Outcome | null> {
  const tail: string[] = [];
  const keep = (chunk: Buffer, out: NodeJS.WriteStream) => {
    out.write(chunk);
    for (const l of chunk.toString().split("\n").map((x) => x.trim()))
      if (l && !/^Rendered \d+\/\d+/.test(l)) tail.push(l);
    tail.splice(0, Math.max(0, tail.length - 200));
  };
  const code = await new Promise<number | string>((resolve) => {
    const child = spawn(TSX, [path.join(ROOT, "scripts", file), ...args], { stdio: ["inherit", "pipe", "pipe"], env: process.env });
    child.stdout.on("data", (c: Buffer) => keep(c, process.stdout));
    child.stderr.on("data", (c: Buffer) => keep(c, process.stderr));
    child.on("close", (status, signal) => resolve(status ?? signal ?? "unknown"));
  });
  if (code === 0) return null;
  const errors = tail.filter((l) => /error|failed|crash|missing|closed/i.test(l));
  const why = (errors.length ? errors : tail).slice(-4).join(" | ");
  return fail("", `scripts/${file} ${args.join(" ")} exited ${code}: ${why}`);
}

/** console.log captured while `fn` runs, so a --check report can be kept. */
function captured(fn: () => void): string {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = log;
  }
  return lines.join("\n") + "\n";
}

const STAGE_RUN: Record<StageName, (c: Ctx, dir: string) => Promise<Outcome>> = {
  validate: async (c) => {
    if (c.run.problems.length) return { problems: c.run.problems };
    const b = c.run.brief!;
    return { outputs: { brief: rel(c.run.file), house: c.run.house!.id, footage: c.shoots, demo: c.demo, source: b.source } };
  },

  compose: async (c) => {
    if (!c.shoots) return { skip: `demo brief: cuts the recorded "${c.demo}"` };
    const r = composeFlow(c.name, c.run.brief!.footage!, c.run.registry!, c.run.house!);
    if ("problems" in r) return { problems: r.problems };
    c.flow = r.flow;
    return {
      outputs: {
        surface: c.run.brief!.footage!.surface,
        actions: c.run.brief!.footage!.actions.map((a) => a.use),
        labels: r.flow.declaredLabels!.map((d) => d.label),
      },
    };
  },

  check: async (c) => {
    if (!c.shoots) return { skip: "demo brief" };
    const r = await recordFlow(c.flow!, { check: true, mode: "profile" }).catch((e: Error) => ({ ok: false, error: e.message }));
    return r.ok ? { outputs: { selectors: "all resolved" } } : fail("footage", `selector check: ${(r.error ?? "failed").split("\n")[0]}`);
  },

  record: async (c) => {
    if (!c.shoots) return { skip: "demo brief" };
    // Strict: prepare (which also undoes what check wrote) must verify, and the
    // take's labels must match the declaration, or nothing is kept.
    const r = await recordFlow(c.flow!, { check: false, mode: "profile" }).catch((e: Error) => ({ ok: false, error: e.message, clicks: 0 }));
    if (!r.ok) return fail("footage", `record: ${(r.error ?? "failed").split("\n")[0]}`);
    return { outputs: { clickLog: rel(clickLogFile(c.demo)), clicks: r.clicks } };
  },

  convert: async (c) => {
    if (!c.shoots) return { skip: "demo brief" };
    return (await script("convert.ts", [c.demo])) ?? { outputs: { mp4: `public/${c.demo}.mp4` } };
  },

  "render-demo": async (c) => {
    if (!c.shoots) return { skip: "demo brief" };
    if (c.run.house!.render?.standaloneDemo === false)
      return { skip: `${c.run.house!.id} renders the reel only` };
    return (await script("render.ts", [c.demo])) ?? { outputs: { demo: `out/demo/${c.demo}.mp4` } };
  },

  compile: async (c, dir) => {
    const log = withScenes(readClickLog(c.demo)!, c.run.brief!.cuts);
    const r = compileBrief(c.run.brief!, log, c.run.house!, chipText(c.run.brief!, c.run.registry!));
    if ("problems" in r) return { problems: r.problems };
    c.compiled = r;
    const report = captured(() => cutReel(r.reel, { source: rel(c.run.file), outBase: c.name, check: true }));
    fs.writeFileSync(path.join(dir, "check.txt"), report);
    fs.writeFileSync(path.join(dir, "reel.json"), JSON.stringify(r.reel, null, 2) + "\n");
    return {
      outputs: {
        runtimeS: r.runtimeS,
        segments: r.reel.segments.length,
        caps: r.notes.map((n) => `${n.path}: ${n.message}`),
        check: rel(path.join(dir, "check.txt")),
      },
    };
  },

  "render-reel": async (c) => {
    c.reels = [];
    for (const { aspect, file } of reelFiles(c)) {
      try {
        cutReel(c.compiled!.reel, {
          source: rel(c.run.file),
          outBase: path.basename(file, ".mp4"),
          patch: c.patch,
          ...(aspect === c.run.house!.aspects[0] ? {} : { aspect }),
          ...(c.run.house!.render?.standaloneDemo === false ? { standaloneDemo: false } : {}),
        });
      } catch (err) {
        return fail("", `render ${aspect}: ${err instanceof Error ? err.message : err}`);
      }
      c.reels.push({ aspect, file });
    }
    // The poster: the reel's first frame (the built title) as an image, for a
    // platform that takes a custom thumbnail. Only a house that builds one.
    const posters: string[] = [];
    if (c.run.house!.poster)
      for (const { file } of c.reels) {
        const poster = file.replace(/\.mp4$/, ".poster.jpg");
        execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-q:v", "2", poster]);
        posters.push(rel(poster));
      }
    return { outputs: { reels: c.reels.map((r) => rel(r.file)), ...(posters.length ? { posters } : {}) } };
  },

  gate: async (c, dir) => {
    const house = c.run.house!;
    const targets = STYLE_PRESETS[house.style].targets;
    const checks: GateCheck[] = [];
    const analyzeOwn: Record<string, boolean | null> = {};
    for (const { aspect, file } of reelFiles(c)) {
      const json = path.join(dir, `analyze.${aspectSlug(aspect)}.json`);
      fs.rmSync(json, { force: true });
      // analyze exits non-zero on its own footage checks; the gate is the
      // house's, so only a missing measurement fails here.
      await script("analyze.ts", [rel(file), "--reel", "--style", house.style, "--json", rel(json)]);
      if (!fs.existsSync(json)) return fail(`gate.${aspect}`, `analyze wrote no measurement for ${rel(file)}`);
      const measured = JSON.parse(fs.readFileSync(json, "utf8")) as { summary: ReelSummary; pass?: boolean };
      checks.push(...gateChecks(aspect, measured.summary, targets, house, c.compiled!.notes));
      analyzeOwn[aspect] = measured.pass ?? null;
    }
    const failed = checks.filter((k) => !k.ok);
    const problems = failed.map((k) => ({ path: `gate.${k.aspect}.${k.what}`, message: gateLine(k) }));
    // The brand audit, on a branded house only: the static half on the
    // compiled reel, then the frame half on every rendered aspect's cards.
    let brand: { static: number; frames: Record<string, number> } | undefined;
    if (house.pack) {
      const pack = resolveBrand(house.pack);
      const reel = c.compiled!.reel;
      const statics = brandProblems(reel, pack);
      problems.push(...statics.map((p) => ({ path: `gate.brand.${p.path}`, message: p.message })));
      const spans = cardSpans(reel, withScenes(readClickLog(c.demo)!, c.run.brief!.cuts), house.shoot.speed);
      const frames: Record<string, number> = {};
      const tol = house.gate.brand ?? { tolerance: 12, maxOffShare: 0.005 };
      for (const { aspect, file } of reelFiles(c)) {
        const off = auditCardFrames(file, spans, pack, tol.tolerance, tol.maxOffShare);
        frames[aspect] = off.length;
        problems.push(...off.map((p) => ({ path: `gate.brand.${aspect}.${p.path}`, message: p.message })));
      }
      brand = { static: statics.length, frames };
    }
    return {
      outputs: { checks, analyzeOwnChecks: analyzeOwn, ...(brand ? { brand } : {}) },
      ...(problems.length ? { problems } : {}),
    };
  },
};

function writeStatus(dir: string, status: Status) {
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status, null, 2) + "\n");
}

/** The first missing file a resumed run needs, as a refusal naming the stage that makes it. */
function missingInput(c: Ctx, from: StageName): Problem | null {
  const start = STAGES.indexOf(from);
  for (const stage of STAGES.slice(start)) {
    for (const need of NEEDS[stage] ?? []) {
      const madeEarlier = STAGES.indexOf(need.madeBy) < start;
      const satisfiedElsewhere = !c.shoots && STAGES.indexOf(need.madeBy) <= STAGES.indexOf("render-demo");
      if (!madeEarlier && !satisfiedElsewhere) continue;
      const files = need.file(c);
      const ok = stage === "convert" ? files.some((f) => fs.existsSync(path.join(ROOT, f))) : files.every((f) => fs.existsSync(path.join(ROOT, f)));
      if (!ok)
        return {
          path: stage,
          message: `needs ${files.join(" or ")}, which is missing. Run from "${need.madeBy}"${
            !c.shoots && satisfiedElsewhere ? ` (record and render the demo "${c.demo}")` : ""
          }`,
        };
    }
  }
  return null;
}

async function launch(name: string, from: StageName = "validate", patch: PatchWindow[] | null = null): Promise<boolean> {
  const dir = path.join(ROOT, "out", "launch", name);
  fs.mkdirSync(dir, { recursive: true });
  const prior: Status | null = fs.existsSync(path.join(dir, "status.json"))
    ? (JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")) as Status)
    : null;

  const run = await checkBrief(name);
  const raw = run.brief;
  const ctx: Ctx = {
    name,
    patch,
    run,
    demo: raw?.demo ?? name,
    shoots: Boolean(raw?.footage),
    reels: [],
  };
  const status: Status = {
    name,
    briefVersion: raw?.version ?? null,
    house: run.house?.id ?? null,
    from,
    ok: null,
    stages: {},
  };

  // Validation runs on every resume: every later stage reads the brief.
  if (from !== "validate" && run.problems.length) {
    status.stages.validate = { state: "failed", problems: run.problems };
    status.ok = false;
    writeStatus(dir, status);
    console.error(`launch ${name}: the brief does not validate\n${problemLines(run.problems).join("\n")}`);
    return false;
  }
  if (from !== "validate") {
    const missing = missingInput(ctx, from);
    if (missing) {
      status.stages[from] = { state: "failed", problems: [missing] };
      status.ok = false;
      writeStatus(dir, status);
      console.error(`launch ${name} --from ${from}: refused. ${missing.path} ${missing.message}`);
      return false;
    }
    // A resume recomposes and recompiles in memory: both are pure and cheap.
    if (ctx.shoots && STAGES.indexOf(from) <= STAGES.indexOf("record")) await STAGE_RUN.compose(ctx, dir);
    if (STAGES.indexOf(from) > STAGES.indexOf("compile")) await STAGE_RUN.compile(ctx, dir);
  }

  for (const stage of STAGES) {
    if (STAGES.indexOf(stage) < STAGES.indexOf(from)) {
      status.stages[stage] = { ...(prior?.stages[stage] ?? {}), state: "reused" };
      continue;
    }
    const startedAt = new Date().toISOString();
    console.log(`\n=== launch ${name}: ${stage} ===`);
    let outcome: Outcome;
    try {
      outcome = await STAGE_RUN[stage](ctx, dir);
    } catch (err) {
      outcome = fail("", err instanceof Error ? err.message : String(err));
    }
    const endedAt = new Date().toISOString();
    const failed = Boolean(outcome.problems?.length);
    status.stages[stage] = {
      state: outcome.skip ? "skipped" : failed ? "failed" : "passed",
      startedAt,
      endedAt,
      ...(outcome.outputs ? { outputs: outcome.outputs } : {}),
      ...(outcome.problems?.length ? { problems: outcome.problems } : {}),
      ...(outcome.skip ? { note: outcome.skip } : {}),
    };
    writeStatus(dir, status);
    if (failed) {
      status.ok = false;
      writeStatus(dir, status);
      console.error(`\nlaunch ${name}: ${stage} FAILED\n${problemLines(outcome.problems!).join("\n")}`);
      console.error(`status     -> ${rel(path.join(dir, "status.json"))}`);
      return false;
    }
  }
  status.ok = true;
  writeStatus(dir, status);
  summary(ctx, status, dir);
  return true;
}

function summary(c: Ctx, status: Status, dir: string) {
  const b = c.run.brief!;
  console.log(`\nlaunch ${c.name}: passed · house ${c.run.house!.id}`);
  for (const r of reelFiles(c)) {
    console.log(`reel       -> ${rel(r.file)}  (${r.aspect})`);
    if (c.run.house?.poster) console.log(`poster     -> ${rel(r.file.replace(/\.mp4$/, ".poster.jpg"))}`);
  }
  console.log(`\ntitle      ${b.title}`);
  b.beats?.forEach((beat, i) => console.log(`beat ${i + 1}     ${beat.card}`));
  if (b.payoff) console.log(`payoff     ${b.payoff.card.replace("{chip}", `[${b.payoff.chip}]`)}`);
  if (b.signoff) console.log(`signoff    ${b.signoff}`);
  b.outro?.forEach((line, i) => console.log(`outro ${i + 1}    ${line}`));
  const checks = (status.stages.gate?.outputs?.checks ?? []) as GateCheck[];
  console.log(`\ngate`);
  for (const k of checks) console.log(`  ${k.ok ? "✓" : "✗"} ${gateLine(k)}`);
  console.log(`\nstatus     -> ${rel(path.join(dir, "status.json"))}`);
}

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--from");
  const fromArg = args.includes("--from") ? args[args.indexOf("--from") + 1] : args.find((a) => a.startsWith("--from="))?.split("=")[1];
  if (!name) throw new Error(`Usage: pnpm launch <name> [--from <stage>]   stages: ${STAGES.join(", ")}`);
  if (fromArg !== undefined && !(STAGES as readonly string[]).includes(fromArg))
    throw new Error(`Unknown stage "${fromArg}". Stages: ${STAGES.join(", ")}`);
  const patch = patchFlag(args);
  // A patch is a window of the REEL. Stages before compile re-shoot or
  // re-render the demo, which a reel-time window cannot address, and new
  // footage voids every chunk a patch would keep anyway.
  if (patch && (fromArg == null || STAGES.indexOf(fromArg as StageName) < STAGES.indexOf("compile")))
    throw new Error("--patch applies to the reel: resume with --from render-reel (or compile) --patch=<from>-<to>");
  const ok = await launch(name, (fromArg as StageName | undefined) ?? "validate", patch);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
