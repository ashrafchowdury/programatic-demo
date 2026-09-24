/**
 * The reel's audio pass: mix `reel.audio` and the click-log SFX onto the
 * finished picture, and report the result's loudness.
 *
 * Runs on the SYSTEM ffmpeg (the bundled Remotion build has no audio filters)
 * and stream-copies the video, so it adds no picture generation. The filter
 * graph itself is pure and tested — src/lib/reel-audio.ts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ClickLog } from "../../src/lib/click-log";
import {
  SFX_KINDS,
  type ReelAudioPiece,
  type ResolvedReel,
} from "../../src/lib/reel";
import {
  AUDIO_FILTERS,
  buildAudioMux,
  clickReelTimes,
  resolvePiece,
  segmentBoundsSeconds,
  type ResolvedPiece,
} from "../../src/lib/reel-audio";
import { mediaDurationS, requireFilters } from "./ffmpeg";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Does this reel ask for any sound at all? */
export const reelHasAudio = (reel: ResolvedReel): boolean =>
  (Array.isArray(reel.audio) && reel.audio.length > 0) || reel.sfx != null;

/**
 * Every audio file the reel names that is not on disk, as one sentence — or
 * null. Checked BEFORE any render: a missing bed used to surface only after
 * every segment had been drawn.
 */
export function missingAudio(reel: ResolvedReel): string | null {
  const srcs = [
    ...(reel.audio ?? []).map((p) => p.src),
    ...SFX_KINDS.flatMap((k) => (reel.sfx?.[k] ? [reel.sfx[k]!.src] : [])),
  ];
  const missing = [...new Set(srcs)].filter(
    (s) => !fs.existsSync(path.join(ROOT, "public", s)),
  );
  if (!missing.length) return null;
  return (
    `names audio that is not on disk: ${missing.map((m) => `public/${m}`).join(", ")}. ` +
    "The committed stock is public/audio/ (intro.mp3, sfx/*.wav) — add the file " +
    "there or remove the piece."
  );
}

/**
 * Mix onto `videoOnly`, writing `out`. `joins` must be the list the picture was
 * joined with: the bounds are the DISSOLVED ones, or every tick fires
 * progressively later than the footage it belongs to (scripts/lib/xfade.ts).
 *
 * Returns false — and copies the silent cut to `out` — when nothing audible
 * resolved.
 */
export function muxAudio(
  reel: ResolvedReel,
  videoOnly: string,
  out: string,
  totalReelS: number,
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  joins: number[],
): boolean {
  requireFilters(AUDIO_FILTERS, "Reel audio");
  const bounds = segmentBoundsSeconds(counts, fps, joins);
  const resolved: ResolvedPiece[] = [];
  const paths: string[] = [];
  const durCache = new Map<string, number>();

  const add = (piece: ReelAudioPiece) => {
    const abs = path.join(ROOT, "public", piece.src);
    if (!fs.existsSync(abs))
      throw new Error(`Missing audio file ${path.relative(ROOT, abs)} (src "${piece.src}").`);
    let dur = durCache.get(abs);
    if (dur == null) {
      dur = mediaDurationS(abs);
      durCache.set(abs, dur);
    }
    const r = resolvePiece(piece, totalReelS, dur, bounds);
    if (r.durationS > 0) {
      resolved.push(r);
      paths.push(abs);
    }
  };

  // Authored music/voice pieces.
  for (const piece of reel.audio ?? []) add(piece);

  // SFX from the click log — each matching beat becomes an "sfx" piece. Kinds in
  // SFX_LABEL_KINDS place only via atLabels; the rest use their built-in detector.
  if (reel.sfx) {
    for (const kind of SFX_KINDS) {
      const cue = reel.sfx[kind];
      if (!cue) continue;
      for (const t of clickReelTimes(
        reel.segments,
        counts,
        fps,
        log,
        speed,
        kind,
        cue.atLabels,
        // The same joins as `bounds` above. Without them every tick landed the
        // sum of the dissolves before it late — 33-333 ms on agent-schedule.
        joins,
      ))
        add({ src: cue.src, start: t, gain: cue.gain, fadeOutS: cue.fadeOutS, role: "sfx" });
    }
  }

  if (resolved.length === 0) {
    fs.copyFileSync(videoOnly, out);
    return false;
  }
  const { inputs, filter, mapArgs } = buildAudioMux(resolved, paths, videoOnly, {
    loudnessLUFS: reel.loudnessLUFS,
    duck: reel.duck,
  });
  execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, ...mapArgs, out], {
    stdio: "inherit",
  });
  const sfx = resolved.filter((r) => r.role === "sfx").length;
  console.log(
    `audio      -> ${resolved.length} piece(s) mixed` +
      (sfx ? ` (${sfx} sfx)` : "") +
      (reel.duck ? " · ducked" : "") +
      (reel.loudnessLUFS != null ? ` @ ${reel.loudnessLUFS} LUFS` : ""),
  );
  return true;
}

/**
 * Print the cut's loudness beside its style's reference. ADVISORY — it sets
 * nothing.
 *
 * Audio deliberately stays per-reel: a style that silently mutes or un-mutes a
 * film is a nasty surprise. But the four references span 23 LU — Film B ships
 * silent, Film A sits at -31.3, monid at -14.5, Uber at a brick-walled -8.2 —
 * so "is this reel in the right register for the grammar it is cut in" is a
 * real question that used to have no answer at all.
 *
 * Never throws. A missing ffmpeg or an unreadable file costs an advisory line,
 * not a render.
 */
export function reportLoudness(ref: number | null, file: string | null): void {
  if (!file) {
    if (ref != null)
      console.log(`loudness   -> this reel is SILENT; its reference sits at ${ref} LUFS`);
    return;
  }
  let measured: number | null = null;
  try {
    // ebur128 writes its summary to STDERR, not stdout — execFileSync returns
    // only stdout, so reading that gets an empty string and silently no line.
    const r = spawnSync(
      "ffmpeg",
      ["-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    // ebur128 prints a RUNNING integrated value every frame and the true one
    // only in its Summary. The first match is the pre-roll (-70.0, i.e.
    // silence); take the last.
    const all = [...(r.stderr ?? "").matchAll(/I:\s*(-?[0-9.]+)\s*LUFS/g)];
    if (all.length) measured = Number(all[all.length - 1][1]);
  } catch {
    return;
  }
  if (measured == null) return;
  if (ref == null) {
    console.log(`loudness   -> ${measured.toFixed(1)} LUFS (no reference)`);
    return;
  }
  const d = measured - ref;
  const how = Math.abs(d) < 1 ? "on reference" : `${d > 0 ? "+" : ""}${d.toFixed(1)} LU`;
  console.log(`loudness   -> ${measured.toFixed(1)} LUFS · reference ${ref} · ${how}`);
}
