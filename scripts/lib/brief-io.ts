/**
 * Briefs on disk: read one, check it against the house, the action library and
 * its click log, and compile it. Shared by `pnpm brief`, `pnpm reel`'s brief
 * fallback, `pnpm launch` and the golden harness, so all four agree on what a
 * valid brief is.
 */
import { setOutputFps } from "../../src/lib/click-log";
import * as fs from "node:fs";
import * as path from "node:path";
import { briefProblems, chipText, type Brief, type Problem } from "../../src/lib/brief";
import type { ClickLog } from "../../src/lib/click-log";
import { compileBrief, type Compiled } from "../../src/lib/compile-brief";
import { resolveHouse, type House } from "../../src/lib/house";
import type { ReelClickLog } from "../../src/lib/reel";
import { loadRegistry, type Registry } from "./action";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** `foo` -> reels/foo.brief.json; a path ending in .brief.json is taken as given. */
export function briefFile(arg: string): { file: string; byName: boolean } {
  return arg.endsWith(".brief.json")
    ? { file: path.resolve(ROOT, arg), byName: false }
    : { file: path.join(ROOT, "reels", `${arg}.brief.json`), byName: true };
}

export const briefExists = (name: string): boolean => fs.existsSync(briefFile(name).file);

export const clickLogFile = (demo: string) => path.join(ROOT, "public", `${demo}.clicks.json`);

export function readClickLog(demo: string): ClickLog | undefined {
  const file = clickLogFile(demo);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as ClickLog) : undefined;
}

/**
 * `log` carrying the click logs of the recordings a brief's cuts resume in
 * (BriefCut.demo), as `scenes`. Unrecorded ones read as null, which the brief
 * check names.
 */
export function withScenes(log: ClickLog, cuts: unknown): ReelClickLog {
  const names = Array.isArray(cuts)
    ? cuts.flatMap((c) => (typeof c === "object" && c !== null && typeof (c as { demo?: unknown }).demo === "string" ? [(c as { demo: string }).demo] : []))
    : [];
  if (!names.length) return log;
  const logs = new Map(names.map((n) => [n, readClickLog(n) ?? null]));
  return Object.assign(log, { scenes: (d: string) => logs.get(d) ?? null });
}

export type BriefRun = {
  file: string;
  /** Present once the brief has no problems. */
  brief?: Brief;
  house?: House;
  registry?: Registry;
  /** The demo's click log, when it is recorded. */
  log?: ClickLog;
  /** Present once the brief compiles against its log. */
  compiled?: Compiled;
  problems: Problem[];
};

/**
 * Read, validate and (when its footage is recorded) compile a brief.
 * Records and renders nothing.
 */
export async function checkBrief(arg: string, opts: { log?: ClickLog } = {}): Promise<BriefRun> {
  const { file, byName } = briefFile(arg);
  const rel = path.relative(ROOT, file);
  if (!fs.existsSync(file)) return { file, problems: [{ path: "", message: `no brief at ${rel}` }] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { file, problems: [{ path: "", message: `${rel} is not valid JSON: ${err instanceof Error ? err.message : err}` }] };
  }
  const { registry, problems: libProblems } = await loadRegistry();
  const run: BriefRun = { file, registry, problems: libProblems.map((m) => ({ path: "actions", message: m })) };
  const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Brief>;
  const demo = typeof fields.demo === "string" ? fields.demo : typeof fields.name === "string" ? fields.name : undefined;
  run.log = opts.log ?? (demo ? readClickLog(demo) : undefined);
  if (run.log) run.log = withScenes(run.log, fields.cuts);
  run.problems.push(
    ...briefProblems(raw, {
      catalog: registry,
      log: fields.demo !== undefined ? run.log : undefined,
      readSource: (p) => {
        const abs = path.resolve(ROOT, p);
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, "utf8") : null;
      },
      ...(byName ? { fileName: path.basename(file, ".brief.json") } : {}),
    }),
  );
  if (run.problems.length) return run;
  run.brief = raw as Brief;
  run.house = resolveHouse(run.brief.house) as House;
  const speed = speedProblem(run.house);
  if (speed) {
    run.problems.push(speed);
    return run;
  }
  if (!run.log) return run;
  const compiled = compileBrief(run.brief, run.log, run.house, chipText(run.brief, registry));
  if ("problems" in compiled) run.problems.push(...compiled.problems);
  else run.compiled = compiled;
  return run;
}

/**
 * The house paces the shoot and the cut for one playback speed, and the render
 * reads it from DEMO_SPEED. Unset, it is set to the house's; set to anything
 * else, that is a problem rather than a film cut at the wrong rate.
 */
export function speedProblem(house: House): Problem | null {
  // The house's shoot and render settings become the run's environment, so the
  // recorder (DEMO_SLOWMO), the render subprocesses (DEMO_FPS) and this
  // process's own cut (setOutputFps) all read the same numbers. A value set by
  // hand that disagrees is a problem, not a silent override.
  for (const [key, want] of [
    ["DEMO_SPEED", house.shoot.speed],
    ["DEMO_SLOWMO", house.shoot.slowmo ?? 1],
    ["DEMO_FPS", house.fps ?? 30],
  ] as const) {
    const raw = process.env[key];
    if (raw === undefined || raw === "") process.env[key] = String(want);
    else if (Number(raw) !== want)
      return {
        path: "house",
        message: `${house.id} is shot and cut for ${key}=${want}, but ${key}=${raw} is set. Unset it`,
      };
  }
  setOutputFps(house.fps ?? 30);
  // A render profile's machine settings are defaults, not requirements: an
  // agent on a bigger sandbox may raise the workers or keep a GPU.
  if (house.render) {
    if (!process.env.DEMO_GL) process.env.DEMO_GL = house.render.gl;
    if (!process.env.DEMO_CONCURRENCY) process.env.DEMO_CONCURRENCY = String(house.render.workers);
  }
  return null;
}

export const problemLines = (problems: readonly Problem[]): string[] =>
  problems.map((p) => `  ✗ ${p.path ? `${p.path}: ` : ""}${p.message}`);
