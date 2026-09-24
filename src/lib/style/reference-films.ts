/**
 * Every reference film we have measured, including the ones no style implements.
 *
 * Separate from the presets on purpose. A film here is a MEASUREMENT; a style
 * is something we can build. Uber sits in this table and nowhere else, because
 * its grammar is a typography engine rather than a set of numbers — see
 * docs/reel/design/choreography-references.md §4. Recording it keeps the
 * measurements addressable without implying a preset that would render a film
 * nobody chose.
 *
 * Nothing renders from this table. style.test.ts reads it, to keep each
 * style's `source` and `targets` agreeing with the film they claim.
 */
import type { ReelStyle } from "./types";

export const REFERENCE_FILMS: {
  file: string;
  label: string;
  style: ReelStyle | null;
  durationS: number;
  shots: number;
  movingFrac: number;
  cutsPerMin: number;
  loudnessLUFS: number | null;
  note?: string;
}[] = [
  {
    file: "cursor-agent-ux-imrpovments-intro.mp4",
    label: "Cursor — Agent UX improvements",
    style: "proof",
    durationS: 43.87,
    shots: 12,
    movingFrac: 0.241,
    cutsPerMin: 15.0,
    loudnessLUFS: -31.3,
  },
  {
    file: "cursor_origin_intro.mp4",
    label: "Cursor — origin (Film B)",
    // WAS "narration", UNTIL THAT PRESET WAS MERGED INTO `ledger`.
    //
    // The two were 79% identical across 85 comparable fields — same
    // motionLayer, same look, same isolate framing, same still cards, and the
    // SAME card timing, because ledger's tail was carried from this film in the
    // first place (monid never cuts between cards, so there was no boundary to
    // measure one against). Only two of the eighteen differences were
    // mechanism, and `ledger` kept its own on both:
    //
    //   join        this film CUTS;    ledger dissolves over 6 frames
    //   shot.enter  this film pushes   ledger holds still
    //               scale -0.106 / 23f
    //
    // The rest were surface, and are recorded here rather than lost:
    //
    //   type      72px / 1.194 line-height / 0em tracking, cap 52 on pitch 86
    //   palette   plate #0a0a0a on #ffffff · plain #e6e4e0 · light #ffffff
    //   bookend   minS 3.0
    //   chip      punch 0.1s (3 frames), lead 0.03, settle 0.03, after 0.03 —
    //             a SNAP, not Film A's 13-frame push. Its raw pill ratio of
    //             7.82x is NOT a punch scale: punchScale is a composition
    //             target, and pasting a ratio into it is the Q4 trap.
    //   targets   mean shot 1.817s · 31.1 cuts/min · 36.8% moving · still 75f
    //
    // `style: null` is the honest value now: this film is MEASURED, and no
    // preset reproduces it. Re-adding it means re-adding a preset, and the
    // numbers above are what it would need.
    style: null,
    durationS: 30.9,
    shots: 17,
    movingFrac: 0.368,
    cutsPerMin: 31.1,
    loudnessLUFS: null,
  },
  {
    file: "monid-claude-for-prospecting.mp4",
    label: "monid — Claude for prospecting",
    style: "ledger",
    durationS: 34.633,
    shots: 5,
    movingFrac: 0.261,
    cutsPerMin: 6.9,
    loudnessLUFS: -14.5,
    note: "Delivered mislabelled as a Replit film. Its persistent HUD is unbuilt.",
  },
  {
    file: "Replit Replit X.mp4",
    label: "Replit — launch film",
    style: "stage",
    durationS: 42.048,
    // SECTIONS, not shots: the film has no hard cuts at all. See presets/stage.
    shots: 9,
    movingFrac: 0.678,
    cutsPerMin: 0,
    loudnessLUFS: -14.0,
  },
  {
    file: "uber-base-icon-system.mp4",
    label: "Uber — A new icon system",
    style: null,
    durationS: 40.768,
    shots: 11,
    movingFrac: 0.812,
    cutsPerMin: 14.7,
    loudnessLUFS: -8.2,
    note:
      "NOT IMPLEMENTABLE as a preset. Kinetic typography — glyphs transform " +
      "continuously along curved baselines, as outlines, as ghost stacks — so " +
      "its motion sits on neither the cards nor the shots but on the TYPE, a " +
      "layer no preset can express. Its transferable findings (75px cap, exact " +
      "#000/#FFF grounds) are taken without it.",
  },
];
