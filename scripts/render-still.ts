/**
 * Frame a captured region on the backdrop: public/shots/<name>.png ->
 * out/shots/<name>-<preset>.png.
 *
 * Usage:
 *   pnpm render:still <name>            the default (wide) preset
 *   pnpm render:still <name> og         one named preset
 *   pnpm render:still <name> --all      every preset
 *   pnpm render:still <name> --from shot.png    frame an image you already have
 *   pnpm render:still <name> --look=bleed --anchor=bottom-right --zoom=1.5
 *                                       reframe a window capture without re-shooting
 *
 * Framing flags: --look=window|bleed, --anchor=, --inset=, --zoom= (bleed),
 * --fit= (cutout), --shadow, --ground=#f3f3f3 (a flat colour instead
 * of the backdrop image, or "transparent"). Each overrides the shot's own.
 *
 *   pnpm render:still <name> portrait --split=3 --gutter=8
 *
 * cuts the still into three portrait pieces laid out as one picture — for a
 * carousel or a multi-image post. One render per piece; the layout is shared,
 * so the pieces line up exactly. See splitCanvas in src/lib/still.ts. A cutout is a
 * CAPTURE decision (its PNG carries alpha), so --look cannot turn a window
 * capture into one or a cutout into anything else; it says so and stops.
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
  CUTOUT_FIT,
  cutoutLayout,
  splitCanvas,
  splitProblem,
  framingProblem,
  isPresetId,
  maxWindowPx,
  resolveAnchor,
  resolveLook,
  resolvePreset,
  shotMetaProblem,
  STILL_PRESET_IDS,
  STILL_PRESETS,
  type Anchor,
  type StillLook,
  type StillPresetId,
} from "../src/lib/still";
import { isLightBackdrop, isLightGround } from "../src/lib/backdrop";
import { WINDOW_FIT } from "../src/lib/window";
import { outPath, outRel } from "./lib/out";
import { imageSize } from "./lib/image-size";
import type { ShotMeta } from "../src/lib/still";

/** Framing overrides from the command line, passed through to the composition. */
type Framing = {
  look?: StillLook;
  ground?: string;
  shadow?: boolean;
  split?: number;
  gutter?: number;
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: number;
};

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

const resolveGl = (raw?: string): string =>
  raw != null && raw !== "" ? raw : "angle";

function renderOne(
  name: string,
  preset: StillPresetId,
  look: StillLook,
  framing: Framing,
  backdrop?: string,
  piece?: { count: number; piece: number; gutter: number },
): string {
  // The look, an explicit backdrop and the piece go in the filename: rendering
  // the same shot as a window and as a bleed, or on two backdrops, is a normal
  // thing to want, and a shared name would silently leave you with only the
  // last one.
  const suffix =
    (look === "window" ? "" : `-${look}`) +
    (backdrop ? `-${backdrop.replace(/\.[^.]+$/, "")}` : "") +
    (framing.ground ? `-${framing.ground.replace(/^#/, "").toLowerCase()}` : "") +
    (piece ? `-${piece.piece + 1}of${piece.count}` : "");
  const out = outPath("still", `${name}-${preset}${suffix}.png`);
  const { split: _count, gutter: _gutter, ...rest } = framing;
  const props = {
    name,
    preset,
    ...rest,
    look,
    ...(backdrop ? { backdrop } : {}),
    ...(piece ? { split: piece } : {}),
  };
  execFileSync(
    REMOTION_BIN,
    ["still", "Still", out, `--props=${JSON.stringify(props)}`, `--gl=${resolveGl(process.env.DEMO_GL)}`],
    { stdio: "inherit" },
  );
  return out;
}

/** `--name=value` from argv, or undefined. */
const flag = (argv: string[], name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const numberFlag = (argv: string[], name: string): number | undefined => {
  const raw = flag(argv, name);
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} wants a number, got "${raw}"`);
  return n;
};

/**
 * Which look this render uses, given what was captured and what was asked.
 *
 * A cutout's PNG is the element with alpha; a window's is an opaque crop. The
 * composition cannot turn one into the other, so a request across that line
 * is refused here — with the fix — rather than rendering something that is
 * neither.
 */
function pickLook(meta: ShotMeta, asked: string | undefined, name: string): StillLook {
  const captured: StillLook = meta.look ?? "window";
  if (asked == null) return captured;
  const look = resolveLook(asked);
  if (captured === "cutout" && look !== "cutout")
    throw new Error(
      `${name} was captured as a cutout; to frame it as ${look}, set look: "${look}" ` +
        `in shots/${name}.ts and re-run \`pnpm shot ${name}\``,
    );
  if (captured !== "cutout" && look === "cutout")
    throw new Error(
      `${name} was captured as a ${captured} crop; a cutout is captured differently — ` +
        `set look: "cutout" in shots/${name}.ts and re-run \`pnpm shot ${name}\``,
    );
  return look;
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
  const meta = JSON.parse(fs.readFileSync(json, "utf8")) as ShotMeta;
  const problem = shotMetaProblem(meta);
  if (problem) throw new Error(`public/shots/${name}.json is ${problem}`);

  const look = pickLook(meta, flag(argv, "look"), name);
  const framing: Framing = {
    fit: numberFlag(argv, "fit"),
    anchor: flag(argv, "anchor") != null ? resolveAnchor(flag(argv, "anchor")) : undefined,
    inset: numberFlag(argv, "inset"),
    zoom: numberFlag(argv, "zoom"),
    shadow: argv.includes("--shadow") ? true : undefined,
    ground: flag(argv, "ground"),
    split: numberFlag(argv, "split"),
    gutter: numberFlag(argv, "gutter"),
  };
  for (const key of Object.keys(framing) as (keyof Framing)[])
    if (framing[key] === undefined) delete framing[key];
  const framingIssue = framingProblem(framing) ?? splitProblem(framing);
  if (framingIssue) throw new Error(framingIssue);
  // The split and its gutter come from the flag, else the shot.
  const count = framing.split ?? meta.split;
  const gutter = framing.gutter ?? meta.gutter ?? 0;

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

  const flat = framing.ground ?? (backdrop ? undefined : meta.ground);
  const onLight = flat
    ? isLightGround(flat)
    : isLightBackdrop(backdrop ?? process.env.DEMO_BACKDROP ?? meta.backdrop ?? "");
  if (look === "cutout" && !onLight)
    console.warn(
      `           !  a cutout's own shadow cannot read on a dark backdrop; it gets a ` +
        `hairline lift instead. For a soft shadow use --ground=#f3f3f3 or a light backdrop.`,
    );

  for (const preset of presets) {
    const whole = count
      ? splitCanvas(STILL_PRESETS[preset], { count, piece: 0, gutter }).canvas
      : STILL_PRESETS[preset];
    if (look === "cutout") {
      const lay = cutoutLayout(meta, whole, framing);
      if (lay.native)
        console.warn(
          `           !  ${preset}: drawn at native size (${lay.img.width}px wide) — ` +
            `the capture is too small to fill \`fit\` without upscaling`,
        );
      if (lay.overflows && (framing.fit ?? meta.fit ?? CUTOUT_FIT) <= 1)
        console.warn(`           !  ${preset}: the element's shadow runs past the canvas`);
    }
    if (!count) {
      console.log(`still      -> ${outRel(renderOne(name, preset, look, framing, backdrop))}`);
      continue;
    }
    for (let piece = 0; piece < count; piece++)
      console.log(
        `still      -> ${outRel(renderOne(name, preset, look, framing, backdrop, { count, piece, gutter }))}`,
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
