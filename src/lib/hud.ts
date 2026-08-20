/**
 * The step HUD — a persistent overlay derived from the demo's own click log.
 *
 * monid's film holds a running cost counter and a monospace step line across
 * every change of content, and that is what buys it 22 seconds without a cut:
 * the HUD carries the continuity that cutting would otherwise supply. See
 * docs/design/reels/choreography-references.md §3.
 *
 * WE DERIVE OURS FROM THE CLICK LOG rather than authoring it, for the same
 * reason the SFX are: the timing already exists, it cost nothing to record, and
 * it cannot drift out of sync with a re-shoot. A beat that is worth a tick is
 * usually worth a line.
 *
 * ARCHITECTURALLY THIS CANNOT BE A SEGMENT PROP. A HUD spans segments, and each
 * segment renders independently and is concatenated. So it is a post-concat
 * overlay pass, exactly the shape `muxAudio` already uses for audio — one more
 * layer composited onto the finished picture rather than baked into any part of
 * it.
 *
 * Pure: no Remotion, no ffmpeg, no fs. HudOverlay.tsx draws these, and
 * scripts/reel.ts composites them.
 */
import type { ClickEvent, ClickLog } from "./click-log";
import { isClip, type ReelSegment } from "./reel";
import { segmentBoundsSeconds } from "./reel-audio";

export type HudStep = {
  /** 1-based, as shown. monid numbers its steps and so do we. */
  index: number;
  /** The beat's own label, upper-cased at render time, not here. */
  label: string;
  /** Reel seconds this step becomes current. */
  startS: number;
  /** Reel seconds it stops being current — the next step, or the film's end. */
  endS: number;
};

/**
 * A label worth putting on screen.
 *
 * Beats are labelled for the recorder's benefit, so some are plumbing: a focus
 * with no press behind it, or a bare element name. A step line that narrates
 * every internal move stops reading as a summary, which is the one thing it is
 * for.
 */
function isStepworthy(beat: ClickEvent): boolean {
  if (!beat.label) return false;
  // A real press. `focus()` beats place a camera keyframe without acting, and
  // narrating them would describe something the viewer cannot see happen.
  if (beat.tDownMs == null) return false;
  return beat.label.trim().length > 1;
}

/**
 * Derive the step list from the click log, in reel time.
 *
 * Same mapping the SFX use — a beat at `tMs` lands at demo-second
 * `(tMs/1000)/speed - offset`, and a clip covering `[fromS,toS)` puts it at
 * `segmentStart + (demoSec - fromS)`. Frozen clips and the cold open are
 * skipped for the same reasons they are there: a still has nothing happening on
 * it, and the cold open replays footage a later clip covers.
 *
 * A step runs until the NEXT step starts, so the line always shows what is
 * happening now rather than blinking per beat. The last runs to `totalS`.
 */
export function hudSteps(
  segments: ReelSegment[],
  counts: number[],
  fps: number,
  log: ClickLog,
  speed: number,
  totalS: number,
  overlaps: number[] = [],
): HudStep[] {
  const bounds = segmentBoundsSeconds(counts, fps, overlaps);
  const offsetS = (log.offsetMs ?? 0) / 1000;
  const found: { label: string; startS: number }[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!isClip(seg)) continue;
    if (seg.clip.freeze) continue;
    const { fromS, toS } = seg.clip;
    for (const beat of log.clicks) {
      if (!isStepworthy(beat)) continue;
      const demoSec = (beat.tDownMs ?? beat.tMs) / 1000 / speed - offsetS;
      if (demoSec < fromS || demoSec >= toS) continue;
      found.push({
        label: beat.label as string,
        startS: bounds.startS[i] + (demoSec - fromS),
      });
    }
  }

  found.sort((a, b) => a.startS - b.startS);
  // Two beats can land on the same frame — a label cue and its own press, say.
  // Showing both would flash one for zero seconds.
  const deduped = found.filter(
    (s, i) => i === 0 || s.startS - found[i - 1].startS > 1 / fps,
  );

  return deduped.map((s, i) => ({
    index: i + 1,
    label: s.label,
    startS: s.startS,
    endS: i + 1 < deduped.length ? deduped[i + 1].startS : totalS,
  }));
}

/** Which step is current at reel-second `t`, or null before the first. */
export function stepAt(steps: HudStep[], t: number): HudStep | null {
  for (let i = steps.length - 1; i >= 0; i--)
    if (t >= steps[i].startS) return steps[i];
  return null;
}
