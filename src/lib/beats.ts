/**
 * Beat-snapped cuts (audit R9): find the onsets in a reel's music bed, then
 * nudge each card's length by a frame or two so the cut out of it lands on one.
 *
 * A cut that lands on a beat reads as MOTIVATED — the edit and the music agree
 * about when something happens — and one that misses by a few frames reads as
 * loose even when nobody could say why. Our cards are sized by their copy
 * (introTiming), so without this every cut lands wherever the words happened to
 * finish.
 *
 * Deliberately small. Onsets come from an energy flux (a rise in short-time
 * log energy that stands above its own neighbourhood), not a tempo tracker:
 * a cut wants the nearest audible hit, not the bar line, and a flux finds the
 * hits of a percussive bed without aubio or a model. The nudge is capped at
 * ±2 frames (±67 ms at 30 fps) — enough to reach a beat from anywhere in a
 * 1/15 s window, small enough that no card's reading time changes visibly.
 *
 * Pure: samples in, seconds out. scripts/lib/beats.ts decodes the bed and
 * caches the onsets; scripts/lib/reel-cut.ts applies the nudges.
 */

/** Analysis hop and window, in seconds. 10 ms is a third of a frame. */
const HOP_S = 0.01;
const WIN_S = 0.02;
/** A flux peak must beat its local mean by this many local deviations. */
const THRESHOLD_K = 1.5;
/** Neighbourhood for that mean and deviation, each side. */
const LOCAL_S = 0.25;
/** Two onsets closer than this are one hit (a flam, a sample's own attack). */
const MIN_GAP_S = 0.1;
/**
 * And it must rise at least this far in one hop, in log10 power (0.1 = 1 dB).
 * The relative test alone fires on stationary noise, whose 20 ms energy
 * wanders by a few tenths of a dB and always has SOME local maximum above
 * mean + 1.5 sd.
 */
const MIN_RISE = 0.1;

/**
 * Onset times, in seconds from the first sample, of a mono signal.
 *
 * Energy is taken in dB-like log units with a floor 60 dB under the signal's
 * mean power, so near-silence does not turn its own noise into onsets.
 */
export function onsetTimes(samples: Float32Array, rate: number): number[] {
  const hop = Math.max(1, Math.round(rate * HOP_S));
  const win = Math.max(hop, Math.round(rate * WIN_S));
  const frames = Math.floor((samples.length - win) / hop) + 1;
  if (frames < 3) return [];
  let total = 0;
  for (let i = 0; i < samples.length; i++) total += samples[i] * samples[i];
  const floor = (total / samples.length) * 1e-6 + 1e-12;

  const energy = new Float64Array(frames);
  for (let k = 0; k < frames; k++) {
    let e = 0;
    for (let i = k * hop; i < k * hop + win; i++) e += samples[i] * samples[i];
    energy[k] = Math.log10(e / win + floor);
  }
  const flux = new Float64Array(frames);
  for (let k = 1; k < frames; k++) flux[k] = Math.max(0, energy[k] - energy[k - 1]);

  const reach = Math.max(1, Math.round(LOCAL_S / HOP_S));
  const gap = Math.round(MIN_GAP_S / HOP_S);
  const out: number[] = [];
  // A window starting at k*hop first holds a hit when its END reaches it, so
  // the hit sits a window later than the frame's start; minus half a hop for
  // where inside that hop it began.
  const at = (k: number) => (k * hop + win - hop / 2) / rate;
  let lastK = -Infinity;
  for (let k = 1; k < frames - 1; k++) {
    if (!(flux[k] >= MIN_RISE) || flux[k] < flux[k - 1] || flux[k] < flux[k + 1]) continue;
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let j = Math.max(1, k - reach); j <= Math.min(frames - 1, k + reach); j++) {
      sum += flux[j];
      sq += flux[j] * flux[j];
      n++;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    if (flux[k] <= mean + THRESHOLD_K * sd) continue;
    if (k - lastK < gap) {
      // Keep the stronger of two hits inside one gap.
      if (flux[k] > flux[lastK]) {
        out[out.length - 1] = at(k);
        lastK = k;
      }
      continue;
    }
    out.push(at(k));
    lastK = k;
  }
  return out;
}

/** The onset nearest `t`, or null for an empty list. */
export function nearestOnset(onsets: readonly number[], t: number): number | null {
  let best: number | null = null;
  for (const o of onsets) if (best == null || Math.abs(o - t) < Math.abs(best - t)) best = o;
  return best;
}

/** Most a card may grow or shrink to reach a beat, in frames. */
export const SNAP_MAX_F = 2;

export type BeatCut = {
  /** The card whose end this cut is. */
  segment: number;
  /** Reel second of the cut after snapping. */
  cutS: number;
  /** Nearest onset, or null when the bed has none. */
  beatS: number | null;
  /** Frames the card was lengthened (+) or shortened (-). */
  nudgeF: number;
  /** Cut minus beat, in frames, after the nudge. */
  offF: number | null;
};

/**
 * Nudge each card so the cut out of it lands on the nearest onset.
 *
 * Greedy in film order, because every nudge moves every later cut: card i is
 * snapped against the bounds its predecessors' nudges produced. The cut is
 * where the NEXT segment starts, plus half its join — the frame a viewer calls
 * the cut on a blended boundary. The last segment has no cut after it.
 *
 * `onsetsAt` maps the current segment bounds (reel seconds) to onset times,
 * so a bed whose `start` is anchored to a segment moves with the nudges.
 * `canNudge` says whether card i can take `d` frames (a card with no hold to
 * give cannot shorten). Returns the new counts and one BeatCut per card cut.
 */
export function snapCardCuts(
  isCardAt: (i: number) => boolean,
  counts: readonly number[],
  joins: readonly number[],
  fps: number,
  onsetsAt: (bounds: { startS: number[]; durS: number[] }) => readonly number[],
  canNudge: (i: number, d: number) => boolean = () => true,
  maxF = SNAP_MAX_F,
): { counts: number[]; cuts: BeatCut[] } {
  const out = [...counts];
  const cuts: BeatCut[] = [];
  const starts = () => {
    const s: number[] = [];
    let acc = 0;
    for (let i = 0; i < out.length; i++) {
      if (i > 0) acc -= joins[i - 1] ?? 0;
      s.push(acc / fps);
      acc += out[i];
    }
    return s;
  };
  for (let i = 0; i < out.length - 1; i++) {
    if (!isCardAt(i)) continue;
    const s = starts();
    const onsets = onsetsAt({ startS: s, durS: out.map((c) => c / fps) });
    const cut = s[i + 1] + (joins[i] ?? 0) / 2 / fps;
    const beat = nearestOnset(onsets, cut);
    let d = 0;
    if (beat != null) {
      const want = Math.round((beat - cut) * fps);
      if (Math.abs(want) <= maxF && canNudge(i, want)) d = want;
    }
    out[i] += d;
    const cutS = cut + d / fps;
    cuts.push({
      segment: i,
      cutS,
      beatS: beat,
      nudgeF: d,
      offF: beat == null ? null : (cutS - beat) * fps,
    });
  }
  return { counts: out, cuts };
}
