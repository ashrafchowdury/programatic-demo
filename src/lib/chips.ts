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
 * cannot: a chip is placed in REEL time, and each segment renders independently
 * and is concatenated. So it is a post-concat overlay pass — one more layer
 * composited onto the finished picture, exactly the shape muxAudio and
 * overlayHud already use.
 *
 * Pure: no React, no Remotion, no fs. ChipOverlay.tsx draws these and
 * scripts/reel.ts composites them.
 */

/** A chip's placement, as fractions of the frame. */
export type ReelChip = {
  text: string;
  /** Pill CENTRE, 0..1 across the frame. */
  x: number;
  /** Pill CENTRE, 0..1 down the frame. */
  y: number;
  /** Reel seconds it appears and disappears. */
  fromS: number;
  toS: number;
};

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
