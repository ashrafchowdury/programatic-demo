/**
 * Generate the reel interaction-SFX stock into public/audio/sfx/ with the system
 * ffmpeg, so the sound palette works without hunting for sample files. Every
 * sound is synthesized (deterministic, no licensing, tweak a number and re-run) —
 * swap in real .wav samples any time; the reel just references the paths.
 *
 *   pnpm exec tsx scripts/gen-sfx.ts
 *
 * The palette is spec'd by trigger + sonic target + synthesis parameters (see the
 * table below). Run `scripts/build-sfx-preview.ts` after this to get a page you
 * can listen through. Also writes manifest.json (name/tier/trigger/character/gain)
 * so the preview sheet and, later, Reel.sfx stay in sync with one source of truth.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "audio", "sfx");

type Sound = {
  /** File stem (also the palette id). */
  id: string;
  /** Tier 1 = auto-placeable off the click log; Tier 2 = needs a labeled beat. */
  tier: 1 | 2;
  /** What event in the reel fires it. */
  trigger: string;
  /** The sonic goal in words — what it should feel like. */
  character: string;
  /** Suggested default level in a reel (linear). */
  gain: number;
  /** lavfi source(s); each becomes one `-f lavfi -i` input. */
  inputs: string[];
  /** filter_complex ending in [out]; inputs are [0:a], [1:a], … */
  filter: string;
};

/**
 * The stock palette. The through-line: a click and the thing it opens are two
 * different sounds (click.primary → pop.open ~120ms later), which is what makes
 * an interaction read as real instead of a flat tick.
 */
const PALETTE: Sound[] = [
  {
    id: "click-primary",
    tier: 1,
    trigger: "a confirming click (submit, “Allow all”)",
    character: "soft rounded tock — low-mid body + faint high tick, no clack",
    gain: 0.5,
    inputs: ["sine=frequency=210:duration=0.08", "sine=frequency=900:duration=0.05"],
    filter:
      "[0:a]afade=t=out:st=0.005:d=0.075,volume=0.9[b];" +
      "[1:a]afade=t=out:st=0.003:d=0.045,volume=0.4[t];" +
      "[b][t]amix=inputs=2:normalize=0,lowpass=f=3000[out]",
  },
  {
    id: "click-secondary",
    tier: 1,
    trigger: "a navigation click (browsing, drilling in)",
    character: "lighter, higher, quieter sibling of primary",
    gain: 0.35,
    inputs: ["sine=frequency=760:duration=0.045"],
    filter: "[0:a]afade=t=out:st=0.003:d=0.042,lowpass=f=4500[out]",
  },
  {
    id: "keystroke",
    tier: 1,
    trigger: "each character in a typing run (pitch-jittered when placed)",
    character: "dry membrane tap — mostly noise, a hint of thump; not a typewriter",
    gain: 0.3,
    inputs: ["anoisesrc=d=0.035:c=pink:a=0.7", "sine=frequency=180:duration=0.03"],
    filter:
      "[0:a]highpass=f=700,lowpass=f=5000,afade=t=out:st=0.004:d=0.03[n];" +
      "[1:a]afade=t=out:st=0.003:d=0.027,volume=0.5[k];" +
      "[n][k]amix=inputs=2:normalize=0[out]",
  },
  {
    id: "pop-open",
    tier: 1,
    trigger: "a popover / submenu appearing after a click",
    character: "short pitched bloop, fast attack, rising pitch bend",
    gain: 0.4,
    // Linear chirp 320→760 Hz: phase = 2π·(f0·t + (f1−f0)/(2T)·t²).
    inputs: [
      "aevalsrc='sin(2*PI*(320*t + (760-320)/(2*0.11)*t*t))':d=0.11:channel_layout=mono",
    ],
    filter: "[0:a]afade=t=in:d=0.006,afade=t=out:st=0.05:d=0.06,lowpass=f=4000[out]",
  },
  {
    id: "whoosh-in",
    tier: 1,
    trigger: "camera zoom-in / push",
    character: "filtered-air swell that rises into the move",
    gain: 0.45,
    inputs: ["anoisesrc=d=0.33:c=pink:a=0.8"],
    filter:
      "[0:a]highpass=f=350,lowpass=f=5500,afade=t=in:d=0.24,afade=t=out:st=0.27:d=0.06[out]",
  },
  {
    id: "whoosh-out",
    tier: 1,
    trigger: "camera trail-back / pull-out",
    character: "same air, falling envelope — reads as reverse of whoosh-in",
    gain: 0.45,
    inputs: ["anoisesrc=d=0.33:c=pink:a=0.8"],
    filter:
      "[0:a]highpass=f=350,lowpass=f=5500,afade=t=in:d=0.04,afade=t=out:st=0.09:d=0.24[out]",
  },
  {
    id: "confirm-success",
    tier: 2,
    trigger: "the payoff action (author-placed)",
    character: "warm two-note resolve (C5 + a staggered G5) — marks “done”",
    gain: 0.5,
    inputs: ["sine=frequency=523:duration=0.3", "sine=frequency=784:duration=0.3"],
    filter:
      "[0:a]afade=t=in:d=0.01,afade=t=out:st=0.16:d=0.14,volume=0.6[c];" +
      "[1:a]adelay=45|45,afade=t=out:st=0.2:d=0.12,volume=0.45[g];" +
      "[c][g]amix=inputs=2:normalize=0,lowpass=f=6000[out]",
  },
  {
    id: "hover-tick",
    tier: 2,
    trigger: "cursor landing on a target (off by default — easy to overdo)",
    character: "near-subliminal high tick",
    gain: 0.2,
    inputs: ["sine=frequency=2100:duration=0.014"],
    filter: "[0:a]afade=t=out:st=0.002:d=0.012,volume=0.6[out]",
  },
];

function synth(s: Sound) {
  const args = ["-y"];
  for (const inp of s.inputs) args.push("-f", "lavfi", "-i", inp);
  args.push(
    "-filter_complex",
    s.filter,
    "-map",
    "[out]",
    "-ar",
    "48000",
    "-ac",
    "2",
    path.join(DIR, `${s.id}.wav`),
  );
  execFileSync("ffmpeg", args, { stdio: "ignore" });
}

function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const s of PALETTE) synth(s);

  const manifest = PALETTE.map(({ inputs: _i, filter: _f, ...meta }) => meta);
  fs.writeFileSync(
    path.join(DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(
    `sfx        -> ${path.relative(ROOT, DIR)}/{${PALETTE.map((s) => s.id).join(",")}}.wav (+ manifest.json)`,
  );
}

main();
