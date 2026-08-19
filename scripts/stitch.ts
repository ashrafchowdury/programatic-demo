/**
 * Concatenates the title card onto the demo.
 *   out/<name>.intro.mp4 + out/<name>.mp4  ->  out/<name>.full.mp4
 *
 * out/<name>.mp4 is never read for anything but its geometry and never moved,
 * so `pnpm analyze <name>` keeps measuring exactly the file it measures today.
 * Do NOT point analyze at the .full file: a title card is a long frozen run by
 * design and would trip the dead-air thresholds for a reason that is not a bug.
 *
 * WHY -c copy AND NOT A RE-ENCODE. Both inputs come out of the same Remotion
 * render with the same flags, so their packets are already compatible and the
 * join lands on the IDR every render starts with. Re-encoding would put a second
 * generation of h264 through the demo body — the half that was tuned at CRF 16
 * and whose banding and sharpness analyze.ts scores against fixed thresholds.
 * Every one of those numbers would move for a reason unrelated to the camera.
 * Set DEMO_STITCH_REENCODE=1 if the two halves ever genuinely diverge.
 *
 * Usage: pnpm stitch <flow-name>   (default: smoke)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { compareStreams, type FileProbe } from "./lib/stitch";
import { outPath, outPathOf } from "./lib/out";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");

const PROBE_KEYS =
  "stream=codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,nb_frames";

function probe(file: string): FileProbe {
  const out = execFileSync(
    REMOTION_BIN,
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      PROBE_KEYS,
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as FileProbe;
}

const frameCount = (p: FileProbe): number | null => {
  const raw = p.streams.find((s) => s.codec_type === "video") as
    | { nb_frames?: string }
    | undefined;
  const n = raw?.nb_frames != null ? Number(raw.nb_frames) : NaN;
  return Number.isFinite(n) ? n : null;
};

function need(file: string, fix: string): void {
  if (!fs.existsSync(file))
    throw new Error(`Missing ${path.relative(ROOT, file)} — ${fix}.`);
}

function main() {
  const name = process.argv[2] ?? "smoke";
  const intro = outPathOf("reel", `${name}.intro.mp4`);
  const demo = outPathOf("demo", `${name}.mp4`);
  need(intro, `run \`pnpm render:intro ${name}\` first`);
  need(demo, `run \`pnpm render ${name}\` first`);

  const introProbe = probe(intro);
  const demoProbe = probe(demo);
  const problems = compareStreams(introProbe, demoProbe);
  if (problems.length)
    throw new Error(
      `Cannot concat ${name}: the two renders do not match.\n  ` +
        problems.join("\n  ") +
        `\n\nBoth files must come from the same encoder settings. Re-render ` +
        `whichever half is stale, or set DEMO_STITCH_REENCODE=1 to transcode.`,
    );

  // Absolute paths, because the demuxer resolves entries relative to the list.
  const listDir = path.join(ROOT, ".diag", "stitch");
  fs.mkdirSync(listDir, { recursive: true });
  const list = path.join(listDir, `${name}.txt`);
  fs.writeFileSync(list, `file '${intro}'\nfile '${demo}'\n`);

  const out = outPath("reel", `${name}.full.mp4`);
  const reencode = process.env.DEMO_STITCH_REENCODE === "1";
  execFileSync(
    REMOTION_BIN,
    [
      "ffmpeg",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      ...(reencode
        ? [
            "-c:v",
            "libx264",
            "-crf",
            "16",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
          ]
        : ["-c", "copy"]),
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );

  const parts = frameCount(introProbe);
  const body = frameCount(demoProbe);
  const joined = frameCount(probe(out));
  if (
    parts != null &&
    body != null &&
    joined != null &&
    joined !== parts + body
  )
    throw new Error(
      `Frame count mismatch: ${parts} + ${body} = ${parts + body}, but ` +
        `${path.relative(ROOT, out)} has ${joined}. The concat dropped frames.`,
    );
  if (parts != null && body != null)
    console.log(`frames     -> ${parts} intro + ${body} demo = ${joined}`);
  if (reencode)
    console.log(`encode     -> re-encoded (DEMO_STITCH_REENCODE=1)`);
  console.log(`full       -> ${path.relative(ROOT, out)}`);
}

main();
