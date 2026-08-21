/**
 * The studio backdrops, chosen by name.
 *
 * A backdrop used to be one baked file. Naming them lets a flow, a shot or a
 * reel say `backdrop: "cobalt"` and get a different look with no code change,
 * which is the point: the treatment is authored per demo, not per release.
 *
 * Every file in public/backdrops/ has been through the same preparation, and
 * that preparation is not cosmetic — see the banding note in src/DemoClip.tsx.
 * A soft ramp banded by h264's deadzone quantiser is the failure mode, and the
 * fix is grain in the SOURCE at full amplitude. Measured on each of these, as
 * the longest identical-colour run on a scanline after an h264 pass: 1px, well
 * under the 97px the old CSS gradient managed. Regenerate with
 * `pnpm backdrop <image> <name>` rather than by hand.
 *
 * Pure: no React, no Remotion. Imported by both sides.
 */

/** Backdrops shipped with the repo. Drop your own in public/backdrops/ too. */
export const BACKDROPS = [
  // --- dark ---------------------------------------------------------------
  /** Near-black with faint light streaks. The original, and the default. */
  "glaze",
  /** The darkest of the set — sparse white filaments on black. */
  "ink",
  /** Blue and magenta folds. */
  "cobalt",
  /** Monochrome folds — the most neutral of the dark set. */
  "graphite",
  /** Red folds, tight and deep. */
  "ember",
  /** Red folds, looser and brighter than ember. */
  "flare",
  /** Teal and coral chromatic split. */
  "prism",
  /** A soft pink and white bloom, the warmest dark option. */
  "bloom",
  /** A magenta ring of light on near-black. */
  "halo",
  /** A low sunset horizon. Has a subject — keep the window off the skyline. */
  "dusk",
  /** A studio-lit object. Also has a subject; the busiest of the set. */
  "studio",
  /** Deep purple with a magenta glow low in the frame. */
  "moonrise",
  // --- light: these get the dark elevation, see LIGHT_BACKDROPS ------------
  /** Soft cream and teal wash. */
  "canyon",
  /** Pale teal and white streaks. */
  "mist",
  /** Near-white with a soft grey ring. The brightest. */
  "chalk",
  /** A smooth cyan-to-lavender wash — the simplest of the light set. */
  "aurora",
] as const;

export type BackdropName = (typeof BACKDROPS)[number];

export const DEFAULT_BACKDROP: BackdropName = "glaze";

/**
 * Backdrops the window's RIM does not read against.
 *
 * Elevation here is a white rim (RimLight), which works by being brighter than
 * what is behind it. On a light backdrop there is nothing to be brighter than,
 * so a white window dissolves into it — the same way the old cast shadow
 * vanished on a near-black one. Listed rather than detected so the render can
 * warn instead of quietly shipping a window with no edge.
 */
export const LIGHT_BACKDROPS: readonly string[] = [
  "canyon",
  "mist",
  "chalk",
  "aurora",
];

export const isLightBackdrop = (name: string): boolean =>
  LIGHT_BACKDROPS.includes(name);

/**
 * Filename for a backdrop, relative to public/.
 *
 * A bare name resolves to the shipped set; anything containing a dot is taken
 * as a filename you dropped in public/backdrops/ yourself, so a custom image
 * needs no code change either.
 */
export function backdropFile(name: string = DEFAULT_BACKDROP): string {
  const trimmed = name.trim();
  if (trimmed === "") return `backdrops/${DEFAULT_BACKDROP}.jpg`;
  return trimmed.includes(".")
    ? `backdrops/${trimmed}`
    : `backdrops/${trimmed}.jpg`;
}

/** Reason a backdrop name is unusable, or null. */
export function backdropProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "")
    return "`backdrop` must be a non-empty string";
  if (/[/\\]/.test(value))
    return "`backdrop` is a name or a filename in public/backdrops/, not a path";
  return null;
}

/**
 * Is this flat ground light enough to need the dark elevation?
 *
 * The image backdrops answer this from a hand-kept list (LIGHT_BACKDROPS),
 * because a photograph's "lightness" is a judgement about where the window
 * sits on it. A flat fill has no such ambiguity, so it is computed: relative
 * luminance over 0.6 gets the cast shadow, the same treatment `chalk` and
 * `mist` get.
 */
export function isLightGround(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}
