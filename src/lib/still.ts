/**
 * A still: one region of the app, framed on the backdrop, sized for social.
 *
 * The video pipeline can never be 4K. Playwright's screencast is capped at CSS
 * pixels and discards the 2x compositor surface — measured three times, see
 * DEVICE_SCALE_FACTOR in ./click-log. A SCREENSHOT does get that surface, so a
 * still is the one artifact this repo can produce at genuine 4K, and that is
 * the whole reason this module exists.
 *
 * Two halves, either side of a JSON sidecar:
 *   scripts/shoot-still.ts  drives the app and writes public/shots/<name>.png
 *                           plus the ShotMeta below
 *   src/StillShot.tsx       reads the meta, frames the PNG on the backdrop
 *
 * The sidecar plays exactly the role ClickLog plays for video: the capture side
 * records what it actually got, and the render side sizes itself from that
 * rather than from a hardcoded guess.
 *
 * Pure by design: no React, no Remotion, no Playwright. Both sides import it.
 */

/** Canvas dimensions in output pixels. */
export type Canvas = { width: number; height: number };

/**
 * What the capture stage actually got, written beside the PNG.
 *
 * `region` is CSS px and `scale` is device px per CSS px, so the PNG on disk is
 * region * scale. Both are recorded rather than just the pixel size because the
 * ratio is the honesty check: a region captured at scale 2 that needed scale 4
 * is being upscaled by the composition, and only these two numbers together
 * reveal it.
 */
export type ShotMeta = {
  name: string;
  /** The captured region in CSS px, after padding. */
  region: Canvas;
  /** Device pixels per CSS px at capture time. */
  scale: number;
  /** Viewport the app was driven at. Context for debugging, not used to render. */
  viewport: Canvas;
  /** How the region was resolved, for the log line. e.g. `css(#sidebar)`. */
  via?: string;
};

/** Native pixel size of the captured PNG. */
export const shotPixels = (meta: ShotMeta): Canvas => ({
  width: Math.round(meta.region.width * meta.scale),
  height: Math.round(meta.region.height * meta.scale),
});

/** Height / width of the captured region — what the window's shape must be. */
export const shotAspect = (meta: ShotMeta): number =>
  meta.region.height / meta.region.width;

/**
 * Short edge every preset is built around.
 *
 * Sizing on the SHORT edge is what makes the set coherent: hold it at 2160 and
 * `wide` is 4K, `story` is 4K rotated, and a square sits between them — every
 * preset carries the same detail per unit of picture, so the same capture reads
 * equally sharp whichever frame it lands in. Sizing on the long edge instead
 * would quietly halve the resolution of the portrait formats.
 *
 * Even numbers throughout, so any downstream ffmpeg pass accepts them without a
 * resize. `og` is the one exception to both rules — see below.
 */
export const STILL_SHORT_EDGE = 2160;

export type StillPresetId = "wide" | "og" | "square" | "portrait" | "story";

/**
 * Canvas per preset. Dimensions are even so any downstream ffmpeg pass accepts
 * them without a resize, and exact rather than derived from a ratio so the
 * aspect a platform expects is the aspect it gets.
 */
export const STILL_PRESETS: Record<StillPresetId, Canvas> = {
  /** 16:9 — the default, and the aspect the demo videos render at. */
  wide: { width: 3840, height: 2160 },
  /**
   * X, LinkedIn and OpenGraph link cards. Exactly 2x the canonical 1200x630,
   * which is why it does not follow the short-edge rule: link previews are
   * re-encoded to a known box, so matching that box beats maximising pixels.
   */
  og: { width: 2400, height: 1260 },
  /** 1:1 — square feed posts. */
  square: { width: 2160, height: 2160 },
  /** 4:5 — the tallest an Instagram feed post may be. */
  portrait: { width: 2160, height: 2700 },
  /** 9:16 — stories, Reels, Shorts. */
  story: { width: 2160, height: 3840 },
};

export const DEFAULT_PRESET: StillPresetId = "wide";

/**
 * Largest window edge any preset can ask for, in output px.
 *
 * The capture stage sizes its device scale factor against this: shoot enough
 * native pixels to fill the biggest window the region could ever be placed in,
 * and no preset upscales. Derived rather than hardcoded so adding a preset
 * raises the capture target with it, instead of silently rendering soft.
 */
export const maxWindowPx = (fit: number): number =>
  Math.round(
    Math.max(
      ...STILL_PRESET_IDS.map((id) =>
        Math.max(STILL_PRESETS[id].width, STILL_PRESETS[id].height),
      ),
    ) * fit,
  );

export const STILL_PRESET_IDS = Object.keys(STILL_PRESETS) as StillPresetId[];

export const isPresetId = (v: unknown): v is StillPresetId =>
  typeof v === "string" && v in STILL_PRESETS;

/** Preset id from CLI input. Throws with the list, since that is the fix. */
export function resolvePreset(raw?: string | null): StillPresetId {
  if (raw == null || raw === "") return DEFAULT_PRESET;
  if (isPresetId(raw)) return raw;
  throw new Error(
    `unknown preset "${raw}" — expected one of ${STILL_PRESET_IDS.join(", ")}`,
  );
}

/**
 * Size the window so a region of any shape sits inside a canvas of any shape.
 *
 * This is the one piece of geometry a still needs that a clip does not. DemoClip
 * renders the window at the recording's own aspect, so WINDOW_FIT shrinks both
 * axes by the same factor and the margin falls out. Here the region's shape and
 * the canvas's shape are independent — a 16:9 panel may be asked to sit in a
 * 9:16 story frame — so the fit has to be taken on whichever axis binds first.
 *
 * The margin is therefore proportional per axis, not a uniform pixel border.
 * That is deliberate: it is what DemoClip does, and matching the videos is the
 * point of the treatment. A wide region in a tall canvas letterboxes hard, which
 * is honest — the alternative is cropping the thing the user asked to show.
 *
 * @param regionAspect height / width of the captured region.
 * @param fit fraction of the canvas the window may occupy (WINDOW_FIT).
 */
export function windowBox(
  regionAspect: number,
  canvas: Canvas,
  fit: number,
): Canvas {
  if (!(regionAspect > 0)) throw new Error("regionAspect must be > 0");
  if (!(fit > 0)) throw new Error("fit must be > 0");
  let width = canvas.width * fit;
  let height = width * regionAspect;
  const maxHeight = canvas.height * fit;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / regionAspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Stand-in so Studio opens before anything has been shot. */
export function fallbackShotMeta(name: string): ShotMeta {
  return {
    name,
    region: { width: 1920, height: 1080 },
    scale: 2,
    viewport: { width: 1920, height: 1080 },
  };
}

/**
 * Runtime shape check for a sidecar read back off disk.
 *
 * public/shots/ is gitignored pipeline output, so the file the renderer opens
 * was written by a different process — possibly an older version of it. Returns
 * the reason, or null when the meta is usable. Mirrors introProblem's style.
 */
export function shotMetaProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const meta = value as Partial<ShotMeta>;
  if (typeof meta.name !== "string" || meta.name === "")
    return "missing a `name`";
  for (const key of ["region", "viewport"] as const) {
    const box = meta[key];
    if (typeof box !== "object" || box === null)
      return `\`${key}\` must be an object`;
    if (!(typeof box.width === "number" && box.width > 0))
      return `\`${key}.width\` must be a number > 0`;
    if (!(typeof box.height === "number" && box.height > 0))
      return `\`${key}.height\` must be a number > 0`;
  }
  if (!(typeof meta.scale === "number" && meta.scale > 0))
    return "`scale` must be a number > 0";
  return null;
}
