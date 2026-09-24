/**
 * How a reel treats its footage and cards.
 *
 * Its own module so both intro.ts and reel.ts can name it — reel.ts already
 * imports intro.ts for introProblem, so declaring it in either would close a
 * cycle.
 *
 * "framed" is the original: the window floats on a studio backdrop with a corner
 * radius, a rim light and a click-driven zoom camera; cards hold for HOLD_S and
 * leave on a 4% scale push.
 *
 * "fullbleed" is the language measured off the Cursor "Agent UX improvements"
 * film: footage fills the frame edge to edge with no chrome and no zoom track,
 * cards are cut into mid-reveal, and every shot arrives and leaves on the push
 * envelope in src/lib/push.ts.
 */
export const LOOKS = ["framed", "fullbleed"] as const;
export type ReelLook = (typeof LOOKS)[number];

/**
 * The grammar a DemoClip renders in when nothing tells it otherwise.
 *
 * ⚠️ THIS IS NOT `DEFAULT_STYLE`, AND CONFLATING THEM SHIPPED A SILENT WRONG
 * RESULT. They answer different questions:
 *
 *   DEFAULT_STYLE  what a REEL is cut in when it names no grammar
 *   DEMO_LOOK      what a CLIP renders as when rendered on its own
 *
 * A reel is free to have any default — that is an editorial choice about films
 * we have not written yet. A standalone demo clip is not: the entire recorder
 * pipeline exists to produce a click log, buildCameraTrack turns that into a
 * 1.5-1.7x zoom track, and a grammar without a window throws all of it away.
 * `pnpm render <name>` renders the framed window because that IS what a demo is.
 *
 * While DEFAULT_STYLE named a windowed grammar the two agreed by accident and
 * this constant was dead — exported, asserted by one test, read by nothing.
 * Moving the default to a full-bleed grammar then silently dropped the camera
 * and the backdrop from every `pnpm render`, and nothing failed: remotion
 * reported success and wrote a valid mp4. It surfaced through `pnpm analyze`'s
 * camera-glide check and a human looking at frames. Stating the clip grammar
 * here, at the two entry points that render one, is what stops the next
 * editorial change reaching the demos.
 */
export const DEMO_LOOK: ReelLook = "framed";

/** Narrowing guard, so a CLI flag or a hand-written reel cannot smuggle in a
 *  name the preset table has no entry for. */
export function isLook(value: unknown): value is ReelLook {
  return typeof value === "string" && (LOOKS as readonly string[]).includes(value);
}
