/**
 * Regenerate the one *synthesized* reel SFX — `confirm.wav` — into public/audio/sfx/
 * with the system ffmpeg. The rest of the palette (click, typing, pop, key, error)
 * are supplied samples, not generated; see public/audio/sfx/README.md for their
 * provenance. This script only (re)writes confirm.wav, so it never clobbers the
 * provided files.
 *
 *   pnpm exec tsx scripts/gen-sfx.ts
 *
 * confirm = a warm two-note resolve (C5 + a staggered G5) that reads as "done" —
 * the payoff cue. Tweak a number and re-run.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "audio", "sfx");

function main() {
  fs.mkdirSync(DIR, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "sine=frequency=523:duration=0.3",
      "-f", "lavfi", "-i", "sine=frequency=784:duration=0.3",
      "-filter_complex",
      "[0:a]afade=t=in:d=0.01,afade=t=out:st=0.16:d=0.14,volume=0.6[c];" +
        "[1:a]adelay=45|45,afade=t=out:st=0.2:d=0.12,volume=0.45[g];" +
        "[c][g]amix=inputs=2:normalize=0,lowpass=f=6000[out]",
      "-map", "[out]",
      "-ar", "48000",
      "-ac", "2",
      path.join(DIR, "confirm.wav"),
    ],
    { stdio: "ignore" },
  );
  console.log(`sfx        -> ${path.relative(ROOT, DIR)}/confirm.wav`);
}

main();
