/**
 * Regenerate the whole reel SFX palette into public/audio/sfx/ — every sound
 * synthesized from scratch by scripts/lib/sfx-synth.ts, so the files are
 * original works with no third-party licence. Deterministic: a re-run with no
 * code change writes byte-identical files.
 *
 *   pnpm exec tsx scripts/gen-sfx.ts            # all six
 *   pnpm exec tsx scripts/gen-sfx.ts click pop  # just these
 *
 * Lengths and loudness are pinned to the files they replaced (see SFX_SPECS), so a
 * regenerate never moves a reel's timing or its tuned SFX gains. Tweak a voice
 * in sfx-synth.ts and re-run; `build-sfx-preview.ts` makes a listen-through.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  encodeWav,
  gainToDb,
  renderSfx,
  SAMPLE_RATE,
  SFX_IDS,
  truePeak,
  type SfxId,
} from "./lib/sfx-synth";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "audio", "sfx");

function main() {
  const asked = process.argv.slice(2);
  const bad = asked.filter((a) => !(SFX_IDS as readonly string[]).includes(a));
  if (bad.length)
    throw new Error(`unknown sfx: ${bad.join(", ")} (have ${SFX_IDS.join(", ")})`);
  const ids = (asked.length ? asked : SFX_IDS) as readonly SfxId[];

  fs.mkdirSync(DIR, { recursive: true });
  for (const id of ids) {
    const mono = renderSfx(id);
    const file = path.join(DIR, `${id}.wav`);
    fs.writeFileSync(file, encodeWav(mono));
    const dur = (mono.length / SAMPLE_RATE).toFixed(3);
    const tp = gainToDb(truePeak(mono)).toFixed(1);
    console.log(
      `sfx        -> ${path.relative(ROOT, file).padEnd(30)} ${dur}s  ${tp} dBTP`,
    );
  }
}

main();
