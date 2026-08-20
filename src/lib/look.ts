/**
 * How a reel treats its footage and cards.
 *
 * Its own module so both intro.ts and reel.ts can name it — reel.ts already
 * imports intro.ts for introProblem, so declaring it in either would close a
 * cycle.
 *
 * "framed" is the original: the window floats on a studio backdrop with a corner
 * radius, a rim light and a click-driven zoom camera; cards hold for HOLD_S and
 * leave on a 4% scale push. It is the default, so a reel that says nothing
 * renders exactly as it always has.
 *
 * "fullbleed" is the language measured off the Cursor "Agent UX improvements"
 * film: footage fills the frame edge to edge with no chrome and no zoom track,
 * cards are cut into mid-reveal, and every shot arrives and leaves on the push
 * envelope in src/lib/push.ts.
 */
export const LOOKS = ["framed", "fullbleed"] as const;
export type ReelLook = (typeof LOOKS)[number];
export const DEFAULT_LOOK: ReelLook = "framed";
