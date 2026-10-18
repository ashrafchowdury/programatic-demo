/**
 * Renders the DemoClip composition for <name> to MP4.
 *   out/demo/<name>.mp4    — h264, for docs / general use
 *
 * The composition reads public/<name>.clicks.json (via calculateMetadata) for its
 * size, duration, and zoom keyframes, so we only pass the name.
 *
 * Rendered in chunks under .diag/demo/<name>/ (scripts/lib/chunks.ts), so a
 * re-render reuses every chunk whose inputs did not change.
 *
 * Usage: pnpm render <flow-name>   (default: smoke)
 *        pnpm render <flow-name> --patch=12.4-15
 *          re-render only that window (demo seconds; comma-separate several),
 *          keeping the last render's chunks everywhere else
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FPS,
  resolvePlaybackRate,
  speedMismatch,
  type ClickLog,
} from "../src/lib/click-log";
import { DEMO_LOOK, isLook, LOOKS } from "../src/lib/look";
import { isStyle, resolveStylePreset, STYLES } from "../src/lib/style";
import { demoDurationInFrames, demoGeometry } from "../src/lib/demo-duration";
import { buildCameraTrack } from "../src/lib/zoom";
import {
  patchFlag,
  readManifest,
  renderChunked,
  seamReport,
  windowFrames,
  writeManifest,
  type Manifest,
  type Range,
} from "./lib/chunks";
import { outPath, outRel } from "./lib/out";
import { digest, footageDigest, segmentSourceDigest } from "./lib/reel-cache";
import { resolveConcurrency, resolveGl } from "./lib/remotion";

const ROOT = path.resolve(import.meta.dirname, "..");
// Renderer flags (GPU rasteriser, worker count, CRF, --muted) and the
// measurements behind them live in scripts/lib/remotion.ts, shared with the reel.

function main() {
  const name = process.argv[2] ?? "smoke";
  const json = path.join(ROOT, "public", `${name}.clicks.json`);
  if (!fs.existsSync(json)) {
    throw new Error(
      `Missing ${path.relative(ROOT, json)} — record + convert ${name} first.`,
    );
  }
  const src = path.join(ROOT, "public", `${name}.mp4`);
  if (!fs.existsSync(src))
    throw new Error(
      `Missing ${path.relative(ROOT, src)} — run \`pnpm convert ${name}\` first.`,
    );

  const out = outPath("demo", `${name}.mp4`);
  const speed = resolvePlaybackRate(process.env.DEMO_SPEED);
  const log = JSON.parse(fs.readFileSync(json, "utf8")) as ClickLog;
  // The recorder paces glides, hovers and the camera's room before each press
  // for the speed it was told (DEMO_SPEED at record time, logged as `speed`).
  // Rendering at another one still produces a clip — just a mistimed one.
  const mismatch = speedMismatch(log, speed);
  if (mismatch) console.warn(`\n  ⚠️  ${mismatch}\n`);
  const concurrency = resolveConcurrency(process.env.DEMO_CONCURRENCY);
  const gl = resolveGl(process.env.DEMO_GL);
  // A name here beats the one recorded in the click log, so a demo can be
  // re-framed on another backdrop without re-recording it.
  const backdrop = process.argv
    .slice(2)
    .find((a) => a.startsWith("--backdrop="))
    ?.split("=")[1];
  // Motion grammar, STATED rather than inherited. A demo clip is the framed
  // window with the click-log camera running — that is what the recorder shot
  // it for — so this passes DEMO_LOOK instead of letting DemoClip fall through
  // to whatever a reel's DEFAULT_STYLE happens to be. See src/lib/look.ts for
  // what falling through cost.
  //
  // `--style=` still wins, and suppresses the default look so the two cannot
  // fight: naming a grammar is an instruction, and an instruction beats a
  // default. `--look=` overrides on its own terms.
  //
  // Both are VALIDATED here. An unrecognised name used to travel all the way
  // into the Remotion props, where resolveStyle hands it back unchecked and the
  // preset lookup yields undefined — a typo deserves a sentence, not a stack.
  const flag = (prefix: string): string | undefined =>
    process.argv
      .slice(2)
      .find((a) => a.startsWith(prefix))
      ?.split("=")[1];
  const rawStyle = flag("--style=");
  if (rawStyle != null && !isStyle(rawStyle))
    throw new Error(`Unknown --style=${rawStyle}. Known: ${STYLES.join(", ")}`);
  const rawLook = flag("--look=");
  if (rawLook != null && !isLook(rawLook))
    throw new Error(`Unknown --look=${rawLook}. Known: ${LOOKS.join(", ")}`);
  const style = rawStyle;
  const look = rawLook ?? (style ? undefined : DEMO_LOOK);
  // SAY WHAT GRAMMAR THIS IS, BEFORE SPENDING MINUTES ON IT. The failure this
  // guards against produced a valid mp4 and a success message — the only signal
  // was the picture. A grammar with no window drops the camera and the backdrop,
  // so if the click log carries a zoom track and the grammar will not run it,
  // that is almost certainly wrong and says so out loud.
  const shot = resolveStylePreset({ ...(look ? { look } : {}), ...(style ? { style } : {}) }).shot;
  const camera = shot.framing === "window" && shot.zoom;
  console.log(
    `grammar    -> ${style ?? look ?? DEMO_LOOK} · ${shot.framing} · camera ${camera ? "on" : "OFF"}`,
  );
  if (!camera) {
    // Count zoomed keys, not keys: every track has its two base keys (start
    // and end) even with no clicks, so "has keys" fired on every flat render.
    const zooms = buildCameraTrack(log, speed, demoGeometry(log)).filter(
      (k) => k.pose.scale > 1 + 1e-3,
    ).length;
    if (zooms > 0)
      console.warn(
        `\n  ⚠️  ${name} has a camera track (${zooms} zoomed keys) and this grammar will not run it.\n` +
          `      The clip will render flat, with no zoom and no backdrop, and nothing\n` +
          `      downstream will fail. Pass --look=framed if that is not what you meant.\n`,
      );
  }
  const props = {
    name,
    speed,
    // DEMO_FPS=60: the bundle cannot read it, so the rate rides in the props.
    ...(FPS !== 30 ? { fps: FPS } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(look ? { look } : {}),
    ...(style ? { style } : {}),
  };
  // The same length Root.tsx's calculateMetadata gives the composition.
  const range = { first: 0, last: demoDurationInFrames(log, speed, demoGeometry(log), FPS) - 1 };
  const patch = patchFlag(process.argv.slice(2));
  if (patch)
    console.log(`patch      -> ${patch.map((w) => `${w.fromS.toFixed(2)}-${w.toS.toFixed(2)}s`).join(", ")}`);
  const dir = path.join(ROOT, ".diag", "demo", name);
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set<string>();
  const manifest = readManifest(dir);
  const next: Manifest = {};
  const footage = footageDigest(name);
  const res = renderChunked({
    id: "DemoClip",
    props,
    range,
    dir,
    name: "demo",
    key: digest({ props, footage, src: segmentSourceDigest("clip") }),
    guard: digest({ footage, fps: FPS }),
    fps: FPS,
    patch: patch ? patch.map((w) => windowFrames(w, 0, range, FPS)).filter((r): r is Range => r != null) : null,
    manifest,
    nextManifest: next,
    keep,
  });
  seamReport(res.file, res.patchedEdges, 0, (f) => f / FPS);
  writeManifest(dir, next, keep);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(res.file, out);
  // Earlier renders of this demo only; the output is one file per name.
  for (const stale of fs.readdirSync(dir)) if (!keep.has(stale)) fs.rmSync(path.join(dir, stale));
  const kept = res.plans.filter((p) => p.action === "stale").length;
  if (speed !== 1) console.log(`speed      -> ${speed}×`);
  if (concurrency != null) console.log(`workers    -> ${concurrency}`);
  console.log(`gl         -> ${gl}`);
  console.log(`mp4        -> ${outRel(out)}`);
  if (kept)
    console.log(`patched    -> ${kept} chunk(s) kept from an earlier render; render again without --patch for a clean one`);
}

main();
