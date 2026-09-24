/**
 * PROOF — Film A's grammar: full-bleed footage between cards, cut
 * metronomically. Shots are static, so the CARDS carry the motion.
 *
 * It IS the base: every mechanic in ../base.ts is measured off this film, so
 * all that is left to say here is which film that was. See docs/reel/cursor/.
 */
import type { StyleOverride } from "../types";

export const proof: StyleOverride = {
  // cursor-agent-ux-imrpovments-intro.mp4 — see REFERENCE_FILMS.
  source: { loudnessLUFS: -31.3 },
  targets: {
    meanShotS: 3.66,
    cutsPerMin: 15.0,
    movingFrac: 0.241,
    longestStillF: 110,
    cutDelta: "slam",
  },
};
