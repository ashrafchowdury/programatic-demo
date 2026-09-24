/**
 * The onsets in a reel's music bed, decoded once and cached (audit R9).
 *
 * The detector is pure (src/lib/beats.ts); this decodes the bed's trimmed
 * range to mono 22.05 kHz floats on the SYSTEM ffmpeg and caches the answer
 * under .diag/beats/, keyed by the file's bytes, the range and the
 * detector's own source — so `--check` after the first run costs nothing and a
 * retuned detector re-detects.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { onsetTimes } from "../../src/lib/beats";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RATE = 22050;

/** Onsets in SOURCE seconds of `file`, within [fromS, fromS + durS). */
export function bedOnsets(file: string, fromS: number, durS: number): number[] {
  const key = createHash("sha1")
    .update(fs.readFileSync(file))
    .update(`${fromS}|${durS}|${RATE}`)
    .update(fs.readFileSync(path.join(ROOT, "src", "lib", "beats.ts")))
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(ROOT, ".diag", "beats");
  const cache = path.join(dir, `${key}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8")) as number[];

  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(fromS), "-t", String(durS), "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (r.status !== 0 || !r.stdout)
    throw new Error(`Could not decode ${path.relative(ROOT, file)} for beat detection: ${r.stderr}`);
  const buf = r.stdout as Buffer;
  // Copied into its own buffer: a Float32Array view needs 4-byte alignment.
  const samples = new Float32Array(buf.length >> 2);
  new Uint8Array(samples.buffer).set(buf.subarray(0, samples.length * 4));
  const onsets = onsetTimes(samples, RATE).map((t) => Number((t + fromS).toFixed(4)));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(onsets));
  return onsets;
}
