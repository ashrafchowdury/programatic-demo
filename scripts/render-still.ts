/**
 * Frame a captured region on the backdrop: public/shots/<name>.png ->
 * out/shots/<name>-<preset>.png.
 *
 * Usage:
 *   pnpm render:still <name>            the default (wide) preset
 *   pnpm render:still <name> og         one named preset
 *   pnpm render:still <name> --all      every preset
 *   pnpm render:still <name> --from shot.png    frame an image you already have
 *
 * The capture is the slow half and it is already done by the time this runs, so
 * re-framing is cheap — iterate on the preset here rather than re-shooting.
 *
 * `--from` skips the capture entirely. The two stages only ever meet at
 * public/shots/<name>.png plus its sidecar, so anything that can produce those
 * two files can use the framing — a screenshot you took by hand, an export from
 * a design tool, a frame someone sent you. The sidecar is written from the
 * image's real dimensions, which keeps the "this will be upscaled" warning
 * honest for imported images too.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isPresetId,
  maxWindowPx,
  resolvePreset,
  shotMetaProblem,
  STILL_PRESET_IDS,
  type StillPresetId,
} from "../src/lib/still";
import { WINDOW_FIT } from "../src/lib/window";
import { outPath, outRel } from "./lib/out";
import { imageSize } from "./lib/image-size";
import type { ShotMeta } from "../src/lib/still";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

const resolveGl = (raw?: string): string =>
  raw != null && raw !== "" ? raw : "angle";

function renderOne(
  name: string,
  preset: StillPresetId,
  backdrop?: string,
): string {
  // An explicit backdrop goes in the filename: rendering the same shot on two
  // backdrops is a normal thing to want, and a shared name would silently leave
  // you with only the last one.
  const suffix = backdrop ? `-${backdrop.replace(/\.[^.]+$/, "")}` : "";
  const out = outPath("still", `${name}-${preset}${suffix}.png`);
  execFileSync(
    REMOTION_BIN,
    [
      "still",
      "Still",
      out,
      `--props=${JSON.stringify({ name, preset, ...(backdrop ? { backdrop } : {}) })}`,
      `--gl=${resolveGl(process.env.DEMO_GL)}`,
    ],
    { stdio: "inherit" },
  );
  return out;
}

/**
 * Adopt an existing image as <name>'s capture, writing the pair the renderer
 * reads. `scale` is 1 and `region` is the image's own pixels: nothing here knows
 * about CSS pixels, and only the ASPECT and the pixel count are used downstream.
 */
function importImage(name: string, from: string): ShotMeta {
  const src = path.resolve(from);
  if (!fs.existsSync(src)) throw new Error(`No image at ${from}`);
  const ext = path.extname(src).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg")
    throw new Error(`--from wants a .png or .jpg, got ${ext || "no extension"}`);

  const size = imageSize(src);
  const dir = path.join(ROOT, "public", "shots");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, `${name}.png`));
  const meta: ShotMeta = {
    name,
    region: size,
    scale: 1,
    viewport: size,
    via: `imported ${path.basename(src)}`,
  };
  fs.writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify(meta, null, 2) + "\n",
  );
  return meta;
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("-"));
  const name = positional[0] ?? "smoke";
  const all = argv.includes("--all");
  const backdrop = argv.find((a) => a.startsWith("--backdrop="))?.split("=")[1];

  const fromFlag = argv.find((a) => a.startsWith("--from="))?.slice("--from=".length)
    ?? (argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : undefined);
  if (fromFlag != null) {
    const meta = importImage(name, fromFlag);
    const longest = Math.max(meta.region.width, meta.region.height);
    console.log(`imported   -> ${meta.region.width}x${meta.region.height} from ${fromFlag}`);
    if (longest < maxWindowPx(WINDOW_FIT))
      console.warn(
        `           !  ${longest}px on the long edge is under ` +
          `${maxWindowPx(WINDOW_FIT)}; the framing will upscale it slightly.`,
      );
  }

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
  const asked = positional.filter((a) => a !== fromFlag)[1];
  if (asked != null && !isPresetId(asked))
    throw new Error(
      `unknown preset "${asked}" — expected one of ${STILL_PRESET_IDS.join(", ")}`,
    );
  const presets: StillPresetId[] = all
    ? [...STILL_PRESET_IDS]
    : [resolvePreset(asked ?? process.env.DEMO_PRESET)];

  for (const preset of presets)
    console.log(`still      -> ${outRel(renderOne(name, preset, backdrop))}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
