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
  /** Studio backdrop name for this shot. See src/lib/backdrop.ts. */
  backdrop?: string;
  /** Flat ground colour (#rrggbb, or "transparent") instead of a backdrop image. Wins over `backdrop`. */
  ground?: string;
  /** Cut the still into this many pieces side by side. See splitCanvas. */
  split?: number;
  /** Output px left unrendered between pieces — the platform's gutter. */
  gutter?: number;
  /**
   * How the region was captured, and so how it must be framed. Absent means
   * "window" — every sidecar written before looks existed is a window capture.
   */
  look?: StillLook;
  /** Framing knobs, authored in the spec. Which ones apply depends on `look`. */
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: number;
  /**
   * Cutout only: cast a soft shadow under the element. Absent means "when the
   * element brought none of its own" — see hasOwnShadow.
   */
  shadow?: boolean;
  /**
   * Cutout only: the element's border box in CSS px, relative to the PNG's
   * top-left. The PNG is the element's PAINTED extent — shadow included — and a
   * shadow is usually offset downward, so centring the PNG would sit the element
   * visibly high. The composition centres this box and lets the shadow hang.
   */
  body?: Box;
};

/** An axis-aligned box, in whatever unit the caller says. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * The three ways a still can be framed. Named so a shot can ask for one.
 *
 *   window  the crop inside the floating window frame — the default, and the
 *           treatment the clips use
 *   cutout  the element ALONE, with its own shadow and transparent edges, on the
 *           backdrop. A capture-time decision: the PNG is different (alpha)
 *   bleed   the window, larger than the canvas and anchored to an edge so it
 *           runs off. A render-time decision over a window capture
 */
export const STILL_LOOKS = ["window", "cutout", "bleed"] as const;
export type StillLook = (typeof STILL_LOOKS)[number];
export const DEFAULT_LOOK: StillLook = "window";

export const isLook = (v: unknown): v is StillLook =>
  typeof v === "string" && (STILL_LOOKS as readonly string[]).includes(v);

/** Look from CLI input. Throws with the list, since that is the fix. */
export function resolveLook(raw?: string | null): StillLook {
  if (raw == null || raw === "") return DEFAULT_LOOK;
  if (isLook(raw)) return raw;
  throw new Error(`unknown look "${raw}" — expected one of ${STILL_LOOKS.join(", ")}`);
}

/** Where an anchored box sits on the canvas. */
export const ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export type Anchor = (typeof ANCHORS)[number];

export const isAnchor = (v: unknown): v is Anchor =>
  typeof v === "string" && (ANCHORS as readonly string[]).includes(v);

export function resolveAnchor(raw?: string | null): Anchor {
  if (raw == null || raw === "") return "center";
  if (isAnchor(raw)) return raw;
  throw new Error(`unknown anchor "${raw}" — expected one of ${ANCHORS.join(", ")}`);
}

/**
 * Fraction of the canvas a cutout's BODY may occupy, on whichever axis binds.
 *
 * A touch under WINDOW_FIT: the references sit a component at 75-90% of the
 * frame — the product is the picture, the ground is a margin, not a set.
 */
export const CUTOUT_FIT = 0.8;
/**
 * A cutout may be framed LARGER than the canvas — `fit: 1.4` with
 * `anchor: "left"` runs a composer off the right edge, which is how the
 * reference stills crop into a component rather than presenting it whole.
 * Still never upscaled: the capture has to have the pixels, or it sits native.
 */
export const MAX_CUTOUT_FIT = 2;
/** How much larger than windowBox a bleed window is drawn. */
export const BLEED_ZOOM = 1.3;
/** Fraction of the canvas edge kept clear on a bleed's anchored side(s). */
export const BLEED_INSET = 0.06;

/**
 * Largest device scale factor a viewport may be shot at.
 *
 * The limit is the compositor SURFACE, not the factor: 1920x1080 at 4 (a 33
 * megapixel surface) is where Chromium was measured to still rasterise
 * cleanly, and that is the budget. A smaller viewport can therefore go higher
 * — a tablet-shaped 820x1180 page reaches 5.8 — which is what lets a 260px
 * popover fill a frame at native pixels instead of sitting small. Tenths, so
 * the budget is actually used; Chromium takes fractional factors as a matter
 * of course (every 1.25x Windows laptop). Hard-capped at MAX_SCALE regardless.
 */
export const SURFACE_BUDGET_PX = 1920 * 1080 * 4 * 4;
export const MAX_SCALE = 8;

export function maxScaleFor(viewport: Canvas): number {
  const byArea = Math.sqrt(SURFACE_BUDGET_PX / (viewport.width * viewport.height));
  return Math.max(1, Math.min(MAX_SCALE, Math.floor(byArea * 10) / 10));
}

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

/**
 * Native pixels the capture must reach so no preset upscales it, per look.
 *
 * The window target is unchanged from before looks existed. A bleed draws the
 * window `zoom` times larger, so it needs that many more pixels; a cutout is
 * placed at CUTOUT_FIT (or the spec's own `fit`), so it needs fewer.
 */
export function captureTargetPx(
  look: StillLook,
  windowFit: number,
  opts: { fit?: number; zoom?: number; split?: number } = {},
): number {
  // A split lays out across `count` pieces, so the window can be that much wider.
  const pieces = opts.split ?? 1;
  if (look === "cutout") return maxWindowPx(opts.fit ?? CUTOUT_FIT) * pieces;
  if (look === "bleed") return maxWindowPx(windowFit * (opts.zoom ?? BLEED_ZOOM)) * pieces;
  return maxWindowPx(windowFit) * pieces;
}

/**
 * Top-left of a box of `size` placed on `canvas` at `anchor`.
 *
 * `inset` is a fraction of the canvas edge kept clear on each anchored side —
 * "top-left" with 0.06 sits 6% in from the left and 6% down from the top. An
 * axis the anchor does not name is centred. A box larger than the canvas
 * simply gets a negative offset on the far side; that is what a bleed is.
 */
export function anchorBox(
  size: Canvas,
  canvas: Canvas,
  anchor: Anchor,
  inset: number,
): { left: number; top: number } {
  const [v, h] = anchorAxes(anchor);
  const left =
    h === "left"
      ? canvas.width * inset
      : h === "right"
        ? canvas.width - canvas.width * inset - size.width
        : (canvas.width - size.width) / 2;
  const top =
    v === "top"
      ? canvas.height * inset
      : v === "bottom"
        ? canvas.height - canvas.height * inset - size.height
        : (canvas.height - size.height) / 2;
  return { left, top };
}

const anchorAxes = (
  anchor: Anchor,
): ["top" | "center" | "bottom", "left" | "center" | "right"] => {
  const v = anchor.startsWith("top")
    ? "top"
    : anchor.startsWith("bottom")
      ? "bottom"
      : "center";
  const h = anchor.endsWith("left")
    ? "left"
    : anchor.endsWith("right")
      ? "right"
      : "center";
  return [v, h];
};

/**
 * A still cut into pieces, for a carousel or a multi-image post.
 *
 * The composition is laid out ONCE across a canvas `count` pieces wide, and
 * each piece is a window onto it: the same layout, translated. So the cut is
 * exact by construction — no image is ever sliced — and every look works
 * inside it unchanged, because they only ever asked for a canvas.
 *
 * `gutter` is the strip between pieces that no piece renders. A platform
 * draws its own gap between the images it lays side by side; leaving that
 * much of the composition out is what makes a line continue straight across
 * the gap instead of jogging at it. Zero for a swipe carousel, where the
 * pieces butt together.
 */
export type Split = {
  /** Number of pieces, 2 or more. */
  count: number;
  /** Which piece this render is, 0-based. */
  piece: number;
  /** Output px between pieces. */
  gutter: number;
};

export const MAX_SPLIT = 8;

/** The whole canvas a split lays out across, and where this piece's window starts. */
export function splitCanvas(
  piece: Canvas,
  split: Split,
): { canvas: Canvas; offset: number } {
  const { count, gutter } = split;
  return {
    canvas: { width: piece.width * count + gutter * (count - 1), height: piece.height },
    offset: split.piece * (piece.width + gutter),
  };
}

/** Reason a split is unusable, or null. */
export function splitProblem(v: { split?: unknown; gutter?: unknown }): string | null {
  if (v.split !== undefined && !(Number.isInteger(v.split) && (v.split as number) >= 2 && (v.split as number) <= MAX_SPLIT))
    return `\`split\` must be a whole number from 2 to ${MAX_SPLIT}`;
  if (v.gutter !== undefined && !(typeof v.gutter === "number" && v.gutter >= 0))
    return "`gutter` must be a number >= 0";
  if (v.gutter !== undefined && v.split === undefined) return "`gutter` needs a `split`";
  return null;
}

/**
 * Did the captured element paint a shadow of its own?
 *
 * The PNG is the painted extent and `body` the border box, so their difference
 * is exactly the shadow's reach. A hairline border anti-aliases into one extra
 * pixel, so anything under 3 css px on every side counts as none — and the
 * composition casts one instead, or the element sits on the ground like a
 * sticker.
 */
export function hasOwnShadow(meta: ShotMeta): boolean {
  const b = meta.body;
  if (!b) return false;
  const reach = Math.max(
    b.x,
    b.y,
    meta.region.width - (b.x + b.width),
    meta.region.height - (b.y + b.height),
  );
  return reach >= 3;
}

export type CutoutLayout = {
  /** Where to draw the PNG, in canvas px. */
  img: Box;
  /** Where the element's border box lands, in canvas px. */
  body: Box;
  /** Canvas px per PNG px. Never above 1. */
  scale: number;
  /** True when the PNG is drawn pixel-for-pixel because `fit` would upscale it. */
  native: boolean;
  /**
   * True when the painted extent (shadow) runs past the canvas. Expected when
   * `fit` is over 1 — that is the point — a warning sign otherwise.
   */
  overflows: boolean;
};

/**
 * Place a cutout: the BODY is fitted to `fit` of the canvas and anchored; the
 * PNG is positioned so its body lands there and its shadow hangs around it.
 *
 * The one rule is never to upscale. A screenshot is captured at the scale the
 * fit asked for; if it still came up short (small element, MAX_SCALE reached)
 * it is drawn at 1:1 rather than stretched, and `native` says so. Offsets are
 * rounded to whole canvas px so a 1:1 draw is pixel-exact.
 */
export function cutoutLayout(
  meta: ShotMeta,
  canvas: Canvas,
  opts: { fit?: number; anchor?: Anchor; inset?: number } = {},
): CutoutLayout {
  const body = meta.body;
  if (!body) throw new Error(`shot "${meta.name}" is not a cutout (no body)`);
  const fit = opts.fit ?? meta.fit ?? CUTOUT_FIT;
  const anchor = opts.anchor ?? meta.anchor ?? "center";
  const inset = opts.inset ?? meta.inset ?? 0;

  const png = shotPixels(meta);
  const bodyPx = { width: body.width * meta.scale, height: body.height * meta.scale };
  const want = windowBox(body.height / body.width, canvas, fit);
  const scale = Math.min(1, want.width / bodyPx.width);

  const placed = { width: bodyPx.width * scale, height: bodyPx.height * scale };
  const at = anchorBox(placed, canvas, anchor, inset);
  const left = Math.round(at.left - body.x * meta.scale * scale);
  const top = Math.round(at.top - body.y * meta.scale * scale);
  const img = {
    x: left,
    y: top,
    width: scale === 1 ? png.width : png.width * scale,
    height: scale === 1 ? png.height : png.height * scale,
  };
  return {
    img,
    body: {
      x: left + body.x * meta.scale * scale,
      y: top + body.y * meta.scale * scale,
      ...placed,
    },
    scale,
    native: scale === 1,
    overflows:
      img.x < 0 ||
      img.y < 0 ||
      img.x + img.width > canvas.width ||
      img.y + img.height > canvas.height,
  };
}

/**
 * Place a bleed: the window at `zoom` times its fitted size, anchored so it
 * runs off the canvas on the far side(s). Same window geometry as the window
 * look, just bigger and moved; the Stage's overflow clips the rest.
 */
export function bleedLayout(
  meta: ShotMeta,
  canvas: Canvas,
  windowFit: number,
  opts: { zoom?: number; anchor?: Anchor; inset?: number } = {},
): Box {
  const zoom = opts.zoom ?? meta.zoom ?? BLEED_ZOOM;
  const anchor = opts.anchor ?? meta.anchor ?? "top-left";
  const inset = opts.inset ?? meta.inset ?? BLEED_INSET;
  const base = windowBox(shotAspect(meta), canvas, windowFit);
  const size = {
    width: Math.round(base.width * zoom),
    height: Math.round(base.height * zoom),
  };
  const at = anchorBox(size, canvas, anchor, inset);
  return { x: Math.round(at.left), y: Math.round(at.top), ...size };
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
  const framing = framingProblem(meta) ?? splitProblem(meta);
  if (framing) return framing;
  if (meta.look === "cutout" && meta.body === undefined)
    return "a cutout sidecar must carry a `body` — re-run `pnpm shot`";
  return null;
}

/**
 * Shape check for the look and framing fields, shared with the spec check in
 * scripts/lib/shot.ts so a bad value is rejected before the browser run, and
 * again when a sidecar is read back. Every field is optional; only a present
 * one is judged. Whether a cutout carries its body is the sidecar's own check.
 */
export function framingProblem(v: {
  look?: unknown;
  fit?: unknown;
  anchor?: unknown;
  inset?: unknown;
  zoom?: unknown;
  shadow?: unknown;
  ground?: unknown;
  body?: unknown;
}): string | null {
  if (v.look !== undefined && !isLook(v.look))
    return `\`look\` must be one of ${STILL_LOOKS.join(", ")}`;
  if (v.fit !== undefined && !(typeof v.fit === "number" && v.fit > 0 && v.fit <= MAX_CUTOUT_FIT))
    return `\`fit\` must be a number in (0, ${MAX_CUTOUT_FIT}]`;
  if (v.anchor !== undefined && !isAnchor(v.anchor))
    return `\`anchor\` must be one of ${ANCHORS.join(", ")}`;
  if (v.inset !== undefined && !(typeof v.inset === "number" && v.inset >= 0 && v.inset < 0.5))
    return "`inset` must be a number in [0, 0.5)";
  if (v.zoom !== undefined && !(typeof v.zoom === "number" && v.zoom >= 1))
    return "`zoom` must be a number >= 1";
  if (v.shadow !== undefined && typeof v.shadow !== "boolean")
    return "`shadow` must be a boolean";
  if (
    v.ground !== undefined &&
    !(typeof v.ground === "string" && (v.ground === "transparent" || /^#[0-9a-f]{6}$/i.test(v.ground)))
  )
    return "`ground` must be a hex colour like #f3f3f3, or \"transparent\"";
  if (v.body !== undefined) {
    const b = v.body as Partial<Box>;
    if (typeof b !== "object" || b === null) return "`body` must be an object";
    for (const key of ["x", "y", "width", "height"] as const)
      if (typeof b[key] !== "number") return `\`body.${key}\` must be a number`;
    if (!(b.width! > 0 && b.height! > 0)) return "`body` must have a positive size";
  }
  return null;
}
