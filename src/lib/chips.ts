/**
 * Floating annotation chips — the pills a film drops over its footage.
 *
 * AUTHORED, NOT DERIVED, and that is the difference between this and the step
 * HUD. `hudSteps` reads the click log because a step IS a press. A chip names
 * something the footage does not say out loud — "1,327 apps", "every action" —
 * and no recording carries that. The reference's own chips (Recon, Auth Check,
 * Input Fuzzing, Response Analysis) are motion graphics, not UI.
 *
 * ARCHITECTURALLY THIS CANNOT BE A SEGMENT PROP, for the same reason the HUD
 * cannot: a chip spans REEL time, and each segment renders independently and is
 * concatenated. So it is a post-concat overlay pass — one more layer composited
 * onto the finished picture, exactly the shape muxAudio and overlayHud use.
 *
 * AUTHORED AGAINST A SEGMENT, NOT A REEL SECOND. Chips used to be placed in
 * absolute reel seconds, and every timing change upstream — a beat nudge, the
 * stage style's exit overlap (3 frames per clip -> card), a card rewritten one
 * word longer — slid the film under them. Measured on agent-tool: "every
 * action" outlived its shot by 0.7-1.0s and hung pinned over bare cream while
 * the panel slid out beneath it. Now a chip names its shot (`{ segment, atS }`,
 * or `{ segment, beat }` inside a clip), is cut to that shot's VISIBLE span —
 * it has rolled away before the exit moves — and rides the shot's own push, so
 * a panel scaling in carries its chips in with it.
 *
 * Pure: no React, no Remotion, no fs. ChipOverlay.tsx draws these and
 * scripts/lib/reel-cut.ts resolves and places them.
 */
import { pushEnvelope, type PushSpec, type PushTransform } from "./push";

/**
 * A reel position inside one segment — the audio anchor's shape
 * (`{ segment }`, 0-based) with a position within it.
 *
 * - `atS` alone: seconds from the segment's first frame.
 * - `beat`: a click-log beat inside a CLIP (same label matching as `fromBeat`,
 *   `"label#2"` for a repeat), placed on its press; `atS` is then a signed
 *   offset from it.
 */
export type ChipAnchor = { segment: number; atS?: number; beat?: string };

/** A chip as written in reels/<name>.ts. */
export type ReelChipInput = {
  text: string;
  /** Pill CENTRE, 0..1 across the frame. */
  x: number;
  /** Pill CENTRE, 0..1 down the frame. */
  y: number;
  /** Where it appears. A number is a reel second (legacy); prefer an anchor. */
  from: number | ChipAnchor;
  /**
   * Where it leaves. Absent = the end of its segment's visible span, which is
   * what a chip over a shot almost always wants. Clipped to that span when
   * later — a chip cannot outlive its shot.
   */
  to?: number | ChipAnchor;
};

/** The segment's push, so the chip moves with its shot. */
export type ChipRide = {
  /** Reel frame of the segment's first frame. */
  startF: number;
  /** The segment's length in frames — pushEnvelope's `durationInFrames`. */
  frames: number;
  push: PushSpec;
  /** Design px -> output px, as FramedPush's useDesignScale. */
  designScale: number;
};

/** A chip resolved to reel time: what ChipOverlay draws. */
export type ReelChip = {
  text: string;
  x: number;
  y: number;
  /** Reel seconds it appears and disappears. */
  fromS: number;
  toS: number;
  /** 0-based segment it belongs to, when resolved from a reel. */
  segment?: number;
  /** Its shot's push, when the shot moves. */
  ride?: ChipRide;
};

/** One segment, as chip resolution needs to see it. */
export type ChipSegment = {
  /** Reel frame of its first frame, and its length in frames. */
  startF: number;
  frames: number;
  /** The shot's push (sequenced), when it moves. */
  push?: PushSpec;
  /** A clip's demo range; absent on a card. */
  clip?: { fromS: number; toS: number; freeze?: boolean };
};

/**
 * Reel seconds a segment is visibly AT REST: from its first frame to the last
 * frame before its exit starts moving. pushEnvelope moves the shot on frames
 * after `frames - out.frames`, so that frame is the last one at rest.
 */
export function visibleSpan(seg: ChipSegment, fps: number): { fromS: number; toS: number } {
  const out = seg.push?.out;
  const exitF = out && out.axis !== "none" && out.frames > 0 ? out.frames : 0;
  return {
    fromS: seg.startF / fps,
    toS: (seg.startF + Math.max(1, seg.frames - exitF)) / fps,
  };
}

/** What a beat label resolves to: its demo second, or why it cannot. */
export type BeatLookup = (label: string) => { s: number } | { problem: string };

/**
 * Every authored chip, in reel seconds, cut to its shot and riding its push.
 * `notes` says what was clipped, for --check.
 */
export function resolveChips(
  inputs: ReelChipInput[],
  segs: ChipSegment[],
  fps: number,
  beat: BeatLookup,
  designScale: number,
): { chips: ReelChip[]; notes: string[] } | { problem: string } {
  const chips: ReelChip[] = [];
  const notes: string[] = [];
  for (const c of inputs) {
    const at = (a: number | ChipAnchor, edge: string): { s: number; seg: number } | { problem: string } => {
      if (typeof a === "number") {
        // Legacy reel seconds: the chip belongs to the shot playing then. The
        // LATER of two overlapping segments wins, since it is the one arriving.
        let seg = -1;
        segs.forEach((g, i) => {
          if (a >= g.startF / fps && a < (g.startF + g.frames) / fps) seg = i;
        });
        if (seg < 0) return { problem: `chip "${c.text}" ${edge} ${a}s is outside the film` };
        return { s: a, seg };
      }
      const g = segs[a.segment];
      if (!Number.isInteger(a.segment) || !g)
        return { problem: `chip "${c.text}" ${edge} names segment ${a.segment}, out of range (0-${segs.length - 1})` };
      const start = g.startF / fps;
      if (a.beat === undefined) return { s: start + (a.atS ?? 0), seg: a.segment };
      if (!g.clip || g.clip.freeze)
        return { problem: `chip "${c.text}" ${edge} anchors to beat "${a.beat}" in segment ${a.segment}, which is not a playing clip` };
      const hit = beat(a.beat);
      if ("problem" in hit) return { problem: `chip "${c.text}" ${edge}: ${hit.problem}` };
      // The BEAT may sit just outside the range (a press a moment before the
      // cut); the position it and its offset name may not.
      const demoS = hit.s + (a.atS ?? 0);
      if (demoS < g.clip.fromS || demoS >= g.clip.toS)
        return {
          problem:
            `chip "${c.text}" ${edge} lands at demo ${demoS.toFixed(2)}s ("${a.beat}" at ` +
            `${hit.s.toFixed(2)}s ${(a.atS ?? 0) >= 0 ? "+" : ""}${a.atS ?? 0}s), outside segment ` +
            `${a.segment}'s ${g.clip.fromS.toFixed(2)}-${g.clip.toS.toFixed(2)}s`,
        };
      return { s: start + (demoS - g.clip.fromS), seg: a.segment };
    };
    const from = at(c.from, "from");
    if ("problem" in from) return from;
    const g = segs[from.seg];
    const span = visibleSpan(g, fps);
    let toS = span.toS;
    if (c.to !== undefined) {
      const to = at(c.to, "to");
      if ("problem" in to) return to;
      if (to.seg !== from.seg)
        return { problem: `chip "${c.text}" starts in segment ${from.seg} and ends in ${to.seg}; a chip belongs to one shot` };
      if (to.s > span.toS + 1e-9)
        notes.push(`"${c.text}" cut ${(to.s - span.toS).toFixed(2)}s short, to end before segment ${from.seg}'s exit`);
      toS = Math.min(to.s, span.toS);
    }
    const fromS = Math.max(from.s, span.fromS);
    if (!(toS > fromS))
      return {
        problem:
          `chip "${c.text}" resolves to ${fromS.toFixed(2)}-${toS.toFixed(2)}s, empty inside ` +
          `segment ${from.seg}'s visible ${span.fromS.toFixed(2)}-${span.toS.toFixed(2)}s`,
      };
    const moves = g.push && ((g.push.in && g.push.in.axis !== "none") || (g.push.out && g.push.out.axis !== "none"));
    chips.push({
      text: c.text,
      x: c.x,
      y: c.y,
      fromS,
      toS,
      segment: from.seg,
      ...(moves ? { ride: { startF: g.startF, frames: g.frames, push: g.push!, designScale } } : {}),
    });
  }
  return { chips, notes };
}

/** The chip's shot transform at reel frame `frame`: rest when it rides nothing. */
export function chipRideAt(chip: ReelChip, frame: number): PushTransform {
  const r = chip.ride;
  if (!r) return { x: 0, y: 0, scale: 1 };
  return pushEnvelope(frame - r.startF, r.frames, r.push);
}

/** Why a chip cannot be placed, or null when it can. */
export function chipProblem(c: ReelChip, totalS: number): string | null {
  if (!c.text.trim()) return "a chip with no text";
  if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1)
    return `chip "${c.text}" sits at (${c.x}, ${c.y}), outside the frame`;
  if (!(c.toS > c.fromS))
    return `chip "${c.text}" ends at ${c.toS}s, at or before its ${c.fromS}s start`;
  // A chip past the end renders nothing, which is a silent way to lose one.
  if (c.fromS >= totalS)
    return `chip "${c.text}" starts at ${c.fromS}s, past the ${totalS.toFixed(1)}s film`;
  return null;
}

/** Chips visible at reel-second `t`. */
export function chipsAt(chips: ReelChip[], t: number): ReelChip[] {
  return chips.filter((c) => t >= c.fromS && t < c.toS);
}

// ---------------------------------------------------------------------------
// Geometry: the pill's box, and keeping it off the thing being pressed
// ---------------------------------------------------------------------------

/** Frame fraction kept clear at the sides when a chip has to be pulled in. */
export const CHIP_EDGE_FRAC = 0.04;
/** Advance of an average Inter glyph at 500, as a share of the font size. */
const GLYPH_EM = 0.56;
/** Horizontal padding each side, as a share of the pill height. */
export const CHIP_PAD_FRAC = 0.38;

/** The look numbers the box depends on (a subset of AnnotationStyle). */
export type ChipMetrics = { heightFrac: number; capRatio: number };

/**
 * The pill's size in output px. Height is a fraction of the 16:9 cut's height
 * (`designHeight`), so a chip is one pixel size at every aspect; width is
 * estimated from the text, which is what ChipOverlay's pull-in always used.
 */
export function chipSizePx(
  text: string,
  m: ChipMetrics,
  designHeight: number,
): { width: number; height: number; fontSize: number } {
  const height = designHeight * m.heightFrac;
  const fontSize = (height * m.capRatio) / 0.715;
  return { width: text.length * GLYPH_EM * fontSize + 2 * height * CHIP_PAD_FRAC, height, fontSize };
}

/** A pill centre pulled in until the whole pill is inside the frame. */
export function pullInside(x: number, halfW: number): number {
  const lo = CHIP_EDGE_FRAC + halfW;
  const hi = 1 - CHIP_EDGE_FRAC - halfW;
  return lo >= hi ? 0.5 : Math.min(hi, Math.max(lo, x));
}

/** An axis-aligned box in frame fractions. */
export type FrameRect = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (a: FrameRect, b: FrameRect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const boxAt = (x: number, y: number, hw: number, hh: number): FrameRect => ({
  x0: x - hw,
  x1: x + hw,
  y0: y - hh,
  y1: y + hh,
});

/**
 * The chip centre nearest (x, y) whose pill, grown by `pad` on every side,
 * clears every rect in `avoid` and stays inside the frame. Candidates are the
 * four sides of each rect it hits — above, below, left, right — which is the
 * "nearest free side". `clear: false` when no side is free (the pill stays
 * where it was put, and --check says so).
 */
export function dodgeRects(
  x: number,
  y: number,
  half: { w: number; h: number },
  avoid: FrameRect[],
  pad: { x: number; y: number },
): { x: number; y: number; moved: boolean; clear: boolean } {
  const hw = half.w + pad.x;
  const hh = half.h + pad.y;
  const free = (cx: number, cy: number) =>
    cx - half.w >= CHIP_EDGE_FRAC - 1e-9 &&
    cx + half.w <= 1 - CHIP_EDGE_FRAC + 1e-9 &&
    cy - half.h >= 0 &&
    cy + half.h <= 1 &&
    !avoid.some((r) => overlaps(boxAt(cx, cy, hw, hh), r));
  if (free(x, y)) return { x, y, moved: false, clear: true };
  const hits = avoid.filter((r) => overlaps(boxAt(x, y, hw, hh), r));
  const candidates: { x: number; y: number }[] = [];
  for (const r of hits) {
    candidates.push(
      { x, y: r.y0 - hh },
      { x, y: r.y1 + hh },
      { x: r.x0 - hw, y },
      { x: r.x1 + hw, y },
    );
  }
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!free(c.x, c.y)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { ...best, moved: true, clear: true } : { x, y, moved: false, clear: false };
}

/** Does the chip's pill at (x, y) cover any of `rects`? */
export function chipCovers(
  x: number,
  y: number,
  half: { w: number; h: number },
  rects: FrameRect[],
): boolean {
  return rects.some((r) => overlaps(boxAt(x, y, half.w, half.h), r));
}
