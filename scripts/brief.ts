/**
 * Validate and compile a reel brief, and list what a brief can use.
 *
 *   pnpm brief <name>                   validate reels/<name>.brief.json, compile it
 *                                       against its click log when recorded, and
 *                                       print the reel's --check report plus its
 *                                       length against the house maximum
 *   pnpm brief <name> --json            the same as one JSON object, nothing else
 *   pnpm brief <name> --emit [--force]  also write reels/<name>.ts, to hand-tune
 *                                       the cut; refuses to overwrite unless forced
 *   pnpm brief --actions [surface]      surfaces, and each action's params and labels
 *   pnpm brief --labels <demo>          a recorded demo's labels, with press and
 *                                       typing-end times
 *
 * A path ending in .brief.json works in place of <name>. Records and renders
 * nothing; exits non-zero on any problem.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { briefLabels, labelLines } from "../src/lib/brief";
import { HOUSE_DEFAULT, HOUSES } from "../src/lib/house";
import { catalogLines, loadRegistry, surfaceEnvKey } from "./lib/action";
import { checkBrief, problemLines, readClickLog, ROOT, type BriefRun } from "./lib/brief-io";
import { cutReel } from "./lib/reel-cut";

const s2 = (x: number) => x.toFixed(2);

async function listActions(surface?: string) {
  const { registry, problems } = await loadRegistry();
  for (const p of problems) console.error(`✗ ${p}`);
  const surfaces = [...registry.surfaces.values()].filter((s) => !surface || s.id === surface);
  if (surface && !surfaces.length)
    throw new Error(`Unknown surface "${surface}". Known: ${[...registry.surfaces.keys()].join(", ")}`);
  for (const s of surfaces) {
    console.log(`surface ${s.id}  (start URL from ${surfaceEnvKey(s.id)}, ${s.viewport.width}x${s.viewport.height})`);
    for (const a of registry.actions.values())
      if (a.surface === s.id) console.log(catalogLines(a).map((l) => `  ${l}`).join("\n"));
    console.log("");
  }
}

function listLabels(demo: string) {
  const log = readClickLog(demo);
  if (!log) throw new Error(`No click log at public/${demo}.clicks.json — record and convert "${demo}" first.`);
  const speed = HOUSES[HOUSE_DEFAULT].shoot.speed;
  console.log(`labels in public/${demo}.clicks.json (demo seconds at ${speed}x):`);
  console.log(labelLines(briefLabels({ log }, { surfaces: new Map(), actions: new Map() }, speed)).join("\n"));
}

function emitSource(run: BriefRun): string {
  const rel = path.relative(ROOT, run.file);
  return (
    `/**\n` +
    ` * Emitted by \`pnpm brief --emit\` from ${rel} under house ${run.house!.id}.\n` +
    ` * Hand edits here win: \`pnpm reel ${run.brief!.name}\` renders this file while it\n` +
    ` * exists and ignores the brief. Delete it to go back to the brief.\n` +
    ` */\n` +
    `import { defineReel } from "../src/lib/reel";\n\n` +
    `export default defineReel(${JSON.stringify(run.compiled!.reel, null, 2)});\n`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const known = ["--json", "--emit", "--force", "--actions", "--labels"];
  const unknown = [...flags].filter((f) => !known.includes(f));
  if (unknown.length) throw new Error(`Unknown flag(s): ${unknown.join(" ")}`);
  const target = args.find((a) => !a.startsWith("--"));

  if (flags.has("--actions")) return listActions(target);
  if (flags.has("--labels")) {
    if (!target) throw new Error("Usage: pnpm brief --labels <demo>");
    return listLabels(target);
  }
  if (!target) throw new Error("Usage: pnpm brief <name> [--json] [--emit [--force]] | --actions [surface] | --labels <demo>");

  const run = await checkBrief(target);
  const c = run.compiled;
  const house = run.house;
  const tooLong = c && house && c.runtimeS > house.maxLengthS;

  if (flags.has("--json")) {
    console.log(
      JSON.stringify(
        {
          ok: run.problems.length === 0 && !tooLong,
          file: path.relative(ROOT, run.file),
          house: house?.id ?? null,
          problems: run.problems,
          compiled: c
            ? { runtimeS: c.runtimeS, maxLengthS: house!.maxLengthS, notes: c.notes, sources: c.sources, reel: c.reel }
            : null,
          recorded: Boolean(run.log),
        },
        null,
        2,
      ),
    );
  } else if (run.problems.length) {
    console.error(`${path.relative(ROOT, run.file)}: ${run.problems.length} problem(s)`);
    console.error(problemLines(run.problems).join("\n"));
  } else {
    const b = run.brief!;
    console.log(`brief      -> ${path.relative(ROOT, run.file)} · house ${house!.id} · ${b.footage ? `footage on ${b.footage.surface}` : `demo ${b.demo}`}`);
    if (!c) {
      const byName = path.relative(ROOT, run.file) === `reels/${b.name}.brief.json`;
      console.log(
        `valid. Its footage is not recorded yet, so nothing is compiled` +
          (byName ? `: \`pnpm launch ${b.name}\` (or \`pnpm record:live ${b.name}\`) records it.` : "."),
      );
    } else {
      cutReel(c.reel, { source: path.relative(ROOT, run.file), outBase: b.name, check: true });
      console.log(`length     -> ${s2(c.runtimeS)}s (house maximum ${house!.maxLengthS}s)${tooLong ? "  ✗ TOO LONG" : ""}`);
      for (const n of c.notes) console.log(`cap        -> ${n.path}: ${n.message}`);
      console.log(`aspects    -> ${house!.aspects.join(", ")}`);
    }
  }
  if (run.problems.length || tooLong) {
    process.exitCode = 1;
    return;
  }

  if (flags.has("--emit")) {
    if (!c) throw new Error("Nothing to emit: the brief's footage is not recorded yet.");
    const out = path.join(ROOT, "reels", `${run.brief!.name}.ts`);
    if (fs.existsSync(out) && !flags.has("--force")) {
      console.error(`reels/${run.brief!.name}.ts exists; not overwriting it. Pass --force to replace it.`);
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(out, emitSource(run));
    console.log(`emitted    -> reels/${run.brief!.name}.ts`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
