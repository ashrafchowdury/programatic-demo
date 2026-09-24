/**
 * Frame a captured region on the backdrop: public/shots/<name>.png ->
 * out/still/<name>-<preset>.png.
 *
 * Usage:
 *   pnpm render:still <name>            the default (wide) preset
 *   pnpm render:still <name> og         one named preset
 *   pnpm render:still <name> --all      every preset
 *   pnpm render:still <name> --from shot.png    frame an image you already have
 *   pnpm render:still <name> --look=bleed --anchor=bottom-right --zoom=1.5
 *   pnpm render:still <name> story --look=bleed --zoom=fill     cover the frame
 *                                       reframe a window capture without re-shooting
 *
 * Framing flags: --look=window|bleed, --anchor=, --inset=, --zoom= (bleed),
 * --focus=x,y (bleed: centre that point, as fractions of the region),
 * --fit= (cutout), --upscale=1.5 (cutout, stretch past native), --shadow /
 * --shadow=false (cutout: the CAST shadow only), --ground=#f3f3f3 (a flat
 * colour instead of the backdrop image, or "transparent"), --backdrop=<name>.
 * Each overrides the shot's own. A flag the look does not use is warned about
 * and left out of the filename — it changed nothing.
 *
 *   pnpm render:still <name> portrait --split=3 --gutter=8
 *
 * Every flag that changes the picture is appended to the output filename, so
 * two renders of one shot never overwrite each other — DEMO_BACKDROP too,
 * when it is what picked the ground. `--out=<basename>` names the file
 * yourself instead (a split still appends -1ofN).
 *
 * cuts the still into three portrait pieces laid out as one picture — for a
 * carousel or a multi-image post. One file per piece; the layout is shared,
 * so the pieces line up exactly. See splitCanvas in src/lib/still.ts. A cutout is a
 * CAPTURE decision (its PNG carries alpha), so --look cannot turn a window
 * capture into one or a cutout into anything else; it says so and stops.
 *
 * The capture is the slow half and it is already done by the time this runs, so
 * re-framing is cheap — iterate on the preset here rather than re-shooting.
 * It is cheap because the composition is bundled ONCE and one browser renders
 * every preset and piece in turn. It used to spawn `remotion still` per image,
 * each re-bundling from scratch: --all --split=3 was fifteen bundles.
 *
 * Before rendering it says when the result will not read: app text smaller
 * than MIN_TEXT_SCALE of its own size once a feed shrinks the image, or the
 * product covering under MIN_FILL of the frame. See stillLegibility.
 *
 * `--from` skips the capture entirely. The two stages only ever meet at
 * public/shots/<name>.png plus its sidecar, so anything that can produce those
 * two files can use the framing — a screenshot you took by hand, an export from
 * a design tool, a frame someone sent you. The sidecar is written from the
 * image's real dimensions, which keeps the "this will be upscaled" warning
 * honest for imported images too.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bundle } from "@remotion/bundler";
import {
  openBrowser,
  renderStill,
  selectComposition,
  type ChromiumOptions,
} from "@remotion/renderer";
import {
  CUTOUT_FIT,
  cutoutLayout,
  splitCanvas,
  splitProblem,
  framingProblem,
  hasOwnShadow,
  isPresetId,
  maxWindowPx,
  MIN_FILL,
  MIN_TEXT_SCALE,
  parseFocus,
  resolveAnchor,
  resolveShotLook,
  resolveStillPreset,
  shotMetaProblem,
  stillLegibility,
  STILL_PRESET_IDS,
  STILL_PRESETS,
  type Anchor,
  type Box,
  type ShotMeta,
  type StillLook,
  type StillPresetId,
  type Zoom,
} from "../src/lib/still";
import { backdropProblem, resolveGround } from "../src/lib/backdrop";
import { WINDOW_FIT } from "../src/lib/window";
import { outPath, outRel, ROOT } from "./lib/out";
import { imageSize } from "./lib/image-size";
import { resolveGl } from "./lib/remotion";

/** Framing overrides from the command line, passed through to the composition. */
type Framing = {
  ground?: string;
  shadow?: boolean;
  split?: number;
  gutter?: number;
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: Zoom;
  upscale?: number;
  focus?: Box;
};

/**
 * Which looks each knob changes anything in. A flag outside its look is
 * ignored by the composition, so it is warned about and kept out of the
 * filename — `smoke-wide-fit0.5.png` of a window capture is the plain window.
 */
const KNOB_LOOKS: Record<keyof Omit<Framing, "ground" | "split" | "gutter">, StillLook[]> = {
  fit: ["cutout"],
  shadow: ["cutout"],
  upscale: ["cutout"],
  anchor: ["cutout", "bleed"],
  inset: ["cutout", "bleed"],
  zoom: ["bleed"],
  focus: ["bleed"],
};

/** One image to render: a preset, or one piece of a split preset. */
type Job = {
  preset: StillPresetId;
  piece?: { count: number; piece: number; gutter: number };
  out: string;
};

/** `--name=value` from argv, or undefined. */
const flag = (argv: string[], name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** `--name` is true, `--name=false` is false, absent is undefined. */
const boolFlag = (argv: string[], name: string): boolean | undefined => {
  if (argv.includes(`--${name}`)) return true;
  const raw = flag(argv, name);
  if (raw == null) return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`--${name} wants true or false, got "${raw}"`);
};

const numberFlag = (argv: string[], name: string): number | undefined => {
  const raw = flag(argv, name);
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} wants a number, got "${raw}"`);
  return n;
};

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

/** A number as a filename fragment: `0.5`, `1.3`, never `0.30000000000000004`. */
const n = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * The filename suffix for the flags that changed this render. Knobs from the
 * SPEC do not go in — they define the shot's own look, and the plain name is
 * that. Neither does a flag the look ignores; `framing` is already filtered.
 */
function nameSuffix(
  look: StillLook,
  lookAsked: boolean,
  framing: Framing,
  backdropTag: string | undefined,
  /** `--focus` as typed — fractions read better in a name than CSS px. */
  focusTag: string | undefined,
): string {
  return (
    (lookAsked ? `-${look}` : "") +
    (backdropTag ? `-${backdropTag.replace(/\.[^.]+$/, "")}` : "") +
    (framing.ground ? `-${framing.ground.replace(/^#/, "").toLowerCase()}` : "") +
    (framing.fit != null ? `-fit${n(framing.fit)}` : "") +
    (framing.anchor ? `-${framing.anchor}` : "") +
    (focusTag ? `-focus${focusTag.replace(",", "x")}` : "") +
    (framing.inset != null ? `-inset${n(framing.inset)}` : "") +
    (framing.zoom != null ? `-zoom${framing.zoom === "fill" ? "fill" : n(framing.zoom)}` : "") +
    (framing.gutter != null ? `-gutter${n(framing.gutter)}` : "") +
    (framing.shadow != null ? (framing.shadow ? "-shadow" : "-noshadow") : "") +
    (framing.upscale != null ? `-up${n(framing.upscale)}` : "")
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("-"));
  const name = positional[0] ?? "smoke";
  const all = argv.includes("--all");
  const backdropFlag = flag(argv, "backdrop");
  const backdropIssue = backdropProblem(backdropFlag);
  if (backdropIssue) throw new Error(`--backdrop: ${backdropIssue}`);

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

  // The capture decides what the look CAN be; see resolveShotLook.
  const lookFlag = flag(argv, "look");
  const { look, problem: lookIssue } = resolveShotLook(meta, lookFlag);
  if (lookIssue) throw new Error(lookIssue);
  const ownLook: StillLook = meta.look ?? "window";

  const outName = flag(argv, "out")?.replace(/\.png$/, "");
  if (outName != null && (outName === "" || /[/\\]/.test(outName)))
    throw new Error("--out wants a bare filename for out/still/, no path");
  const focusFlag = flag(argv, "focus");
  const framing: Framing = {
    fit: numberFlag(argv, "fit"),
    anchor: flag(argv, "anchor") != null ? resolveAnchor(flag(argv, "anchor")) : undefined,
    inset: numberFlag(argv, "inset"),
    zoom: flag(argv, "zoom") === "fill" ? "fill" : numberFlag(argv, "zoom"),
    focus: focusFlag != null ? parseFocus(focusFlag, meta.region) : undefined,
    shadow: boolFlag(argv, "shadow"),
    ground: flag(argv, "ground"),
    split: numberFlag(argv, "split"),
    gutter: numberFlag(argv, "gutter"),
    upscale: numberFlag(argv, "upscale"),
  };
  for (const key of Object.keys(framing) as (keyof Framing)[])
    if (framing[key] === undefined) delete framing[key];
  const framingIssue = framingProblem(framing) ?? splitProblem(framing);
  if (framingIssue) throw new Error(framingIssue);
  for (const key of Object.keys(KNOB_LOOKS) as (keyof typeof KNOB_LOOKS)[]) {
    if (framing[key] === undefined || KNOB_LOOKS[key].includes(look)) continue;
    console.warn(
      `           !  --${key} does nothing to a ${look}; it applies to ${KNOB_LOOKS[key].join(" and ")} — ignored`,
    );
    delete framing[key];
  }
  // The split and its gutter come from the flag, else the shot.
  const wanted = framing.split ?? meta.split;
  const count = wanted != null && wanted > 1 ? wanted : undefined;
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
    : [resolveStillPreset(asked ?? process.env.DEMO_PRESET)];

  // The ground: the same rule the composition applies. Resolved here and
  // passed down explicitly, so the render cannot depend on which environment
  // variables reach the bundle.
  const envBackdrop = process.env.DEMO_BACKDROP || undefined;
  const ground = resolveGround({
    ground: framing.ground,
    backdrop: backdropFlag,
    ownGround: meta.ground,
    ownBackdrop: meta.backdrop,
    envBackdrop,
  });
  if (backdropFlag && framing.ground)
    console.warn(`           !  --backdrop is ignored: --ground=${framing.ground} replaces the image`);
  // The backdrop goes in the name when THIS render chose it — by flag, or by
  // DEMO_BACKDROP standing in for the shot's. The shot's own does not.
  const backdropTag = ground.ground
    ? undefined
    : (backdropFlag ?? (envBackdrop && envBackdrop !== meta.backdrop ? envBackdrop : undefined));
  if (look === "cutout" && !ground.light)
    console.warn(
      `           !  a cutout's own shadow cannot read on a dark backdrop; it gets a ` +
        `hairline lift instead. For a soft shadow use --ground=#f3f3f3 or a light backdrop.`,
    );
  if (look === "cutout" && framing.shadow === false && hasOwnShadow(meta))
    console.warn(
      `           !  --shadow=false drops only the CAST shadow; this element painted its own, ` +
        `and that is in the PNG. Set shadow: false in shots/${name}.ts and re-run ` +
        `\`pnpm shot ${name}\` to strip it at capture.`,
    );

  const suffix = nameSuffix(
    look,
    lookFlag != null && look !== ownLook,
    framing,
    backdropTag,
    framing.focus ? focusFlag : undefined,
  );
  const jobs: Job[] = [];
  const imported = meta.via?.startsWith("imported ") ?? false;
  const { split: _count, gutter: _gutter, ...knobs } = framing;
  for (const preset of presets) {
    const piece = STILL_PRESETS[preset];
    const whole = count ? splitCanvas(piece, { count, piece: 0, gutter }).canvas : piece;
    if (look === "cutout") {
      const lay = cutoutLayout(meta, whole, framing);
      if (lay.native)
        console.warn(
          `           !  ${preset}: drawn at native size (${lay.img.width}px wide) — ` +
            `the capture is too small to fill \`fit\` without upscaling; --upscale=1.5 would stretch it`,
        );
      if (lay.stretched)
        console.warn(
          `           !  ${preset}: stretched ${lay.scale.toFixed(2)}x past native by \`upscale\` — ` +
            `it will read softer than a native shot`,
        );
      if (lay.overflows && (framing.fit ?? meta.fit ?? CUTOUT_FIT) <= 1)
        console.warn(`           !  ${preset}: the element's shadow runs past the canvas`);
    }
    // Will it read? An imported image's "CSS px" are its pixels, so its text
    // scale means nothing; its fill still does.
    const seen = stillLegibility(meta, look, piece, whole, WINDOW_FIT, knobs);
    const fix =
      look === "window"
        ? "try --look=bleed --zoom=fill, or a tighter region"
        : look === "bleed"
          ? "raise --zoom, or shoot a tighter region"
          : "raise --fit, or shoot on a smaller viewport";
    if (!imported && seen.textScale < MIN_TEXT_SCALE)
      console.warn(
        `           !  ${preset}: app text shows at ${seen.textScale.toFixed(2)}x in a ` +
          `${1080}px feed — 13px reads as ${(13 * seen.textScale).toFixed(1)}px; ${fix}`,
      );
    if (look !== "cutout" && seen.fill < MIN_FILL)
      console.warn(
        `           !  ${preset}: the shot covers ${Math.round(seen.fill * 100)}% of the frame; ${fix}`,
      );

    const base = outName ?? `${name}-${preset}${suffix}`;
    if (!count) {
      jobs.push({ preset, out: outPath("still", `${base}.png`) });
      continue;
    }
    for (let i = 0; i < count; i++)
      jobs.push({
        preset,
        piece: { count, piece: i, gutter },
        out: outPath("still", `${base}-${i + 1}of${count}.png`),
      });
  }

  // Bundle once, open one browser, render every image through both.
  const started = Date.now();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "still-bundle-"));
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "src", "index.ts"),
    outDir,
    // As remotion.config.ts sets it for the CLI; the config file does not
    // apply to the Node APIs.
    rspack: true,
    // public/ holds every demo's mp4; copying it per bundle is most of the cost.
    symlinkPublicDir: true,
  });
  const chromiumOptions: ChromiumOptions = {
    gl: resolveGl(process.env.DEMO_GL) as ChromiumOptions["gl"],
  };
  const browser = await openBrowser("chrome", { chromiumOptions });
  try {
    for (const job of jobs) {
      const inputProps = {
        name,
        preset: job.preset,
        ...knobs,
        look,
        ...(ground.ground ? { ground: ground.ground } : {}),
        ...(ground.backdrop ? { backdrop: ground.backdrop } : {}),
        ...(job.piece ? { split: job.piece } : {}),
      };
      const composition = await selectComposition({
        serveUrl,
        id: "Still",
        inputProps,
        puppeteerInstance: browser,
        chromiumOptions,
        logLevel: "warn",
      });
      await renderStill({
        serveUrl,
        composition,
        output: job.out,
        inputProps,
        puppeteerInstance: browser,
        chromiumOptions,
        overwrite: true,
        logLevel: "warn",
      });
      console.log(`still      -> ${outRel(job.out)}`);
    }
  } finally {
    await browser.close({ silent: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  console.log(
    `rendered   -> ${jobs.length} image${jobs.length === 1 ? "" : "s"} in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
