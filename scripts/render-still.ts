/**
 * Frame a captured region on the backdrop: public/shots/<name>.png ->
 * out/shots/<name>-<preset>.png.
 *
 * Usage:
 *   pnpm render:still <name>            the default (wide) preset
 *   pnpm render:still <name> og         one named preset
 *   pnpm render:still <name> --all      every preset
 *
 * The capture is the slow half and it is already done by the time this runs, so
 * re-framing is cheap — iterate on the preset here rather than re-shooting.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isPresetId,
  resolvePreset,
  shotMetaProblem,
  STILL_PRESET_IDS,
  type StillPresetId,
} from "../src/lib/still";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

const resolveGl = (raw?: string): string =>
  raw != null && raw !== "" ? raw : "angle";

function renderOne(name: string, preset: StillPresetId): string {
  const out = path.join(ROOT, "out", "shots", `${name}-${preset}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(
    REMOTION_BIN,
    [
      "still",
      "Still",
      out,
      `--props=${JSON.stringify({ name, preset })}`,
      `--gl=${resolveGl(process.env.DEMO_GL)}`,
    ],
    { stdio: "inherit" },
  );
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("-"));
  const name = positional[0] ?? "smoke";
  const all = argv.includes("--all");

  const png = path.join(ROOT, "public", "shots", `${name}.png`);
  const json = path.join(ROOT, "public", "shots", `${name}.json`);
  if (!fs.existsSync(png))
    throw new Error(
      `Missing public/shots/${name}.png — run \`pnpm shot ${name}\` first.`,
    );
  if (!fs.existsSync(json))
    throw new Error(
      `Missing public/shots/${name}.json — the sidecar carries the region's ` +
        `shape. Re-run \`pnpm shot ${name}\`.`,
    );
  const problem = shotMetaProblem(JSON.parse(fs.readFileSync(json, "utf8")));
  if (problem) throw new Error(`public/shots/${name}.json is ${problem}`);

  // A second positional is a preset; reject a typo here rather than silently
  // rendering the default, which looks like the flag was ignored.
  const asked = positional[1];
  if (asked != null && !isPresetId(asked))
    throw new Error(
      `unknown preset "${asked}" — expected one of ${STILL_PRESET_IDS.join(", ")}`,
    );
  const presets: StillPresetId[] = all
    ? [...STILL_PRESET_IDS]
    : [resolvePreset(asked ?? process.env.DEMO_PRESET)];

  for (const preset of presets)
    console.log(`still      -> ${path.relative(ROOT, renderOne(name, preset))}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
