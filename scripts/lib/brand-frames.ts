/**
 * The frame half of the reel brand audit: pull sample frames out of every CARD
 * of a rendered reel and check their pixels against the pack (see
 * frameColorProblem in src/lib/brand-audit.ts). Footage is never sampled.
 *
 * Needs system ffmpeg, like the rest of the gate.
 */
import { execFileSync } from "node:child_process";
import { frameColorProblem, type AuditProblem } from "../../src/lib/brand-audit";
import type { BrandPack } from "../../src/lib/brand";
import type { ClickLog } from "../../src/lib/click-log";
import { FPS } from "../../src/lib/click-log";
import { isCard, resolveReel, segmentFrameCounts, type Reel } from "../../src/lib/reel";

/** Sampled at a downscaled width: flat colour fields lose nothing, and it is fast. */
const SAMPLE_W = 480;

export type CardSpan = { index: number; fromS: number; lengthS: number };

/** Each card's span in reel seconds, from the compiled reel's own timeline. */
export function cardSpans(reel: Reel, log: ClickLog, speed: number): CardSpan[] {
  const r = resolveReel(reel, log, speed);
  if ("problem" in r) throw new Error(`brand audit: ${r.problem}`);
  const counts = segmentFrameCounts(r.reel, FPS);
  const out: CardSpan[] = [];
  let at = 0;
  r.reel.segments.forEach((seg, i) => {
    if (isCard(seg)) out.push({ index: i, fromS: at / FPS, lengthS: counts[i] / FPS });
    at += counts[i];
  });
  return out;
}

/**
 * Three instants per card: once the copy has started landing, mid-hold, and
 * just before the cut. Kept clear of both boundaries, where an encoder's
 * keyframe can carry the neighbouring shot's pixels.
 */
const samplesOf = (c: CardSpan): number[] =>
  [0.35, 0.6, 0.88].map((f) => c.fromS + c.lengthS * f);

function frameAt(file: string, tS: number): { pixels: Uint8Array; height: number } {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", tS.toFixed(3), "-i", file, "-frames:v", "1",
     "-vf", `scale=${SAMPLE_W}:-2`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return { pixels: new Uint8Array(buf), height: buf.length / 3 / SAMPLE_W };
}

/** Every card frame that is off brand, as gate problems. Empty = on brand. */
export function auditCardFrames(
  file: string,
  cards: readonly CardSpan[],
  pack: BrandPack,
  tolerance: number,
  maxOffShare: number,
): AuditProblem[] {
  const out: AuditProblem[] = [];
  for (const c of cards)
    for (const t of samplesOf(c)) {
      const { pixels } = frameAt(file, t);
      const bad = frameColorProblem(pixels, pack, tolerance, maxOffShare);
      if (bad)
        out.push({
          path: `segments[${c.index}]`,
          message: `card at ${t.toFixed(2)}s: ${(bad.offShare * 100).toFixed(1)}% of pixels off the "${pack.id}" palette, mostly ${bad.colour}`,
        });
    }
  return out;
}
