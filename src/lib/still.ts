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
  /** Cut the still into this many pieces side by side, or "auto". See splitCanvas, resolveSplit. */
  split?: SplitCount;
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
  zoom?: Zoom;
  /**
   * Cutout only: the element's elevation. Absent means "its own shadow if it
   * painted one, else a soft cast one" — see hasOwnShadow. `true` adds the
   * cast shadow regardless. `false` in the SPEC is a capture decision: the
   * element's own box-shadow and drop-shadow are stripped at isolation, so
   * the PNG is flat. `--shadow=false` at render can only drop the cast
   * shadow — whatever the element painted is already in the PNG.
   */
  shadow?: boolean;
  /**
   * Cutout only: how far past native the element may be stretched to reach
   * `fit`, as a factor. 1 (the default) is the rule: never. Up to
   * MAX_UPSCALE for a small element the viewport cannot shoot larger.
   */
  upscale?: number;
  /**
   * Cutout only: the element's border box in CSS px, relative to the PNG's
   * top-left. The PNG is the element's PAINTED extent — shadow included — and a
   * shadow is usually offset downward, so centring the PNG would sit the element
   * visibly high. The composition centres this box and lets the shadow hang.
   */
  body?: Box;
  /**
   * Bleed only: the box to keep in view, CSS px relative to the PNG's
   * top-left. A bleed with a focus centres it on the canvas instead of pinning
   * a corner — the corner is rarely where the point of the screen is. Written
   * by the capture side when the spec names one (`focus: css(...)`, resolved
   * against the region), or given at render as `--focus=x,y` (fractions of
   * the region).
   */
  focus?: Box;
  /**
   * Framing that differs per preset, over the shot's own: a landscape screen
   * that is a window on `wide` and a fill bleed on `story`. A render flag
   * still wins over both. See presetFraming.
   */
  presets?: PresetOverrides;
};

/**
 * The framing knobs one preset may set differently. `look` may move between
 * window and bleed — both frame the same opaque crop — but never to or from a
 * cutout, which is photographed differently.
 */
export type PresetFraming = {
  look?: StillLook;
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: Zoom;
  split?: SplitCount;
  gutter?: number;
};
export type PresetOverrides = Partial<Record<StillPresetId, PresetFraming>>;

/**
 * The framing a preset renders with: the preset's override over the shot's
 * own. Render flags go over this, in render-still. Knobs neither sets are
 * left out, so each layer's defaults still apply below.
 */
export function presetFraming(
  meta: Pick<ShotMeta, "look" | "fit" | "anchor" | "inset" | "zoom" | "split" | "gutter" | "presets">,
  preset: StillPresetId,
): PresetFraming {
  const own: PresetFraming = {
    look: meta.look,
    fit: meta.fit,
    anchor: meta.anchor,
    inset: meta.inset,
    zoom: meta.zoom,
    split: meta.split,
    gutter: meta.gutter,
  };
  const merged = { ...own, ...meta.presets?.[preset] } as Record<string, unknown>;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as PresetFraming;
}

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

/** Named apart from src/lib/look.ts's isLook, which is the REEL's look. */
export const isStillLook = (v: unknown): v is StillLook =>
  typeof v === "string" && (STILL_LOOKS as readonly string[]).includes(v);

/** Look from CLI input. Throws with the list, since that is the fix. */
export function resolveLook(raw?: string | null): StillLook {
  if (raw == null || raw === "") return DEFAULT_LOOK;
  if (isStillLook(raw)) return raw;
  throw new Error(`unknown look "${raw}" — expected one of ${STILL_LOOKS.join(", ")}`);
}

/**
 * Which look a render of this capture uses, given what was asked for.
 *
 * A cutout's PNG is the element with alpha; a window's is an opaque crop. The
 * composition cannot turn one into the other, so a request across that line
 * comes back as a `problem` — with the fix — and the look the capture can
 * actually be framed as. The CLI throws the problem; Studio warns and renders
 * the fallback, because it must still open. One function so the two cannot
 * disagree about where the line is.
 */
export function resolveShotLook(
  meta: Pick<ShotMeta, "name" | "look">,
  asked?: string | null,
): { look: StillLook; problem: string | null } {
  const captured: StillLook = meta.look ?? DEFAULT_LOOK;
  if (asked == null || asked === "") return { look: captured, problem: null };
  const look = resolveLook(asked);
  const name = meta.name;
  if (captured === "cutout" && look !== "cutout")
    return {
      look: captured,
      problem:
        `${name} was captured as a cutout; to frame it as ${look}, set look: "${look}" ` +
        `in shots/${name}.ts and re-run \`pnpm shot ${name}\``,
    };
  if (captured !== "cutout" && look === "cutout")
    return {
      look: captured,
      problem:
        `${name} was captured as a ${captured} crop; a cutout is captured differently — ` +
        `set look: "cutout" in shots/${name}.ts and re-run \`pnpm shot ${name}\``,
    };
  return { look, problem: null };
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
/**
 * Most a cutout may be stretched past native when asked. 1.5 is where a 4x
 * screenshot of UI text still reads as a screenshot rather than as a blur —
 * a bound, not a recommendation; the honest fix is a smaller viewport.
 */
export const MAX_UPSCALE = 1.5;
/** How much larger than windowBox a bleed window is drawn. */
export const BLEED_ZOOM = 1.3;
/**
 * A bleed's zoom: a factor over the fitted window, or "fill" — grow until the
 * window covers the canvas on both axes. Fill is what a landscape screen needs
 * in a portrait or story frame, where any fixed factor either leaves ground
 * showing or overshoots wildly; it depends on the canvas, so it is resolved
 * per preset at render.
 */
export type Zoom = number | "fill";

export const isZoom = (v: unknown): v is Zoom =>
  v === "fill" || (typeof v === "number" && v >= 1);

/** The factor that makes a window of `base` cover `canvas` on both axes. */
export const fillZoom = (base: Canvas, canvas: Canvas): number =>
  Math.max(canvas.width / base.width, canvas.height / base.height);
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

/**
 * The largest viewport of the same shape that could be shot at `scale`.
 *
 * The inverse of maxScaleFor, for the advice a capture gives when an element
 * came up short: "shoot this on a viewport of about W×H". Layout is what a
 * viewport changes, so the answer is a starting point, not a promise — a
 * responsive app may reflow at the smaller size.
 */
export function viewportFor(scale: number, like: Canvas): Canvas {
  const area = SURFACE_BUDGET_PX / (scale * scale);
  const aspect = like.height / like.width;
  const width = Math.floor(Math.sqrt(area / aspect) / 10) * 10;
  return { width, height: Math.round(width * aspect) };
}

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

/**
 * Preset id from CLI input. Throws with the list, since that is the fix.
 * Named apart from src/lib/style.ts's resolvePreset, which is the REEL's.
 */
export function resolveStillPreset(raw?: string | null): StillPresetId {
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
 * Measured off the layout each preset would actually draw, the way the render
 * does it: the window (or a cutout's body) fitted into the canvas — the whole
 * a split lays out across, when there is one — times a bleed's zoom. The
 * largest long edge over every preset is the target.
 *
 * A split used to multiply the single-canvas target by its piece count. That
 * assumed the window could be `count` times wider, which only a region as
 * wide as the whole strip can be; on agents-page portrait --split=3 it asked
 * for ~15.9k px when the layout needed ~5.9k, so every split shot at the
 * viewport's ceiling and still warned it was short.
 *
 * `aspect` (height / width of the region) is known after the first pass,
 * and is used where the canvas shape makes it matter: a split's long strip,
 * and a fill bleed. On one canvas the bound stays the longest edge any region
 * could reach, as it always was — shoot-still passes the PAINTED rect's
 * aspect, which for a cutout is not its body's, and a target a few percent
 * low would sit every cutout just under its `fit`.
 */
export function captureTargetPx(
  look: StillLook,
  windowFit: number,
  opts: {
    fit?: number;
    zoom?: Zoom;
    split?: SplitCount;
    gutter?: number;
    aspect?: number;
    presets?: PresetOverrides;
  } = {},
): number {
  // Each preset with its own override over the shot's knobs. An "auto"
  // split is not resolved here — that needs the whole sidecar — so every
  // count it could pick is sized for; the surface budget caps the excess.
  const need = (id: StillPresetId): number => {
    const o = { look, ...opts, ...opts.presets?.[id] };
    const counts =
      o.split === "auto"
        ? Array.from({ length: AUTO_SPLIT_MAX }, (_, i) => i + 1)
        : [o.split != null && o.split > 1 ? o.split : 1];
    const fit = o.look === "cutout" ? (o.fit ?? CUTOUT_FIT) : windowFit;
    const zoom = o.look === "bleed" ? (o.zoom ?? BLEED_ZOOM) : 1;
    // Without the region's shape a fill zoom cannot be resolved; the default
    // factor stands in, as it always has.
    const factor = (base: Canvas, canvas: Canvas): number =>
      zoom === "fill" ? (opts.aspect ? fillZoom(base, canvas) : BLEED_ZOOM) : zoom;
    return Math.max(
      ...counts.map((count) => {
        const canvas =
          count > 1
            ? splitCanvas(STILL_PRESETS[id], { count, piece: 0, gutter: o.gutter ?? 0 }).canvas
            : STILL_PRESETS[id];
        if (!opts.aspect || (count === 1 && zoom !== "fill")) {
          const edge = Math.max(canvas.width, canvas.height) * fit;
          return edge * factor({ width: edge, height: edge }, canvas);
        }
        const base = windowBox(opts.aspect, canvas, fit);
        return Math.max(base.width, base.height) * factor(base, canvas);
      }),
    );
  };
  return Math.round(Math.max(...STILL_PRESET_IDS.map(need)));
}

/**
 * Top-left of a box of `size` placed on `canvas` at `anchor`.
 *
 * `inset` is a fraction of the canvas's SHORT edge kept clear on each
 * anchored side — "top-left" with 0.06 on 3840x2160 sits 130px in from the
 * left and 130px down from the top. An axis the anchor does not name is
 * centred. A box larger than the canvas simply gets a negative offset on the
 * far side; that is what a bleed is.
 *
 * One margin on both axes, not a fraction of each: per axis, a story frame
 * (2160x3840) got 230px on top and 130px at the side, and a 3-piece portrait
 * split — laid out across 6480x2700 — 390px at the side and 160px on top. A
 * split's canvas is the whole strip, so its short edge is the piece height.
 */
export function anchorBox(
  size: Canvas,
  canvas: Canvas,
  anchor: Anchor,
  inset: number,
): { left: number; top: number } {
  const [v, h] = anchorAxes(anchor);
  const margin = insetPx(canvas, inset);
  const left =
    h === "left"
      ? margin
      : h === "right"
        ? canvas.width - margin - size.width
        : (canvas.width - size.width) / 2;
  const top =
    v === "top"
      ? margin
      : v === "bottom"
        ? canvas.height - margin - size.height
        : (canvas.height - size.height) / 2;
  return { left, top };
}

/** An `inset` fraction in canvas px: the same margin on both axes. See anchorBox. */
export const insetPx = (canvas: Canvas, inset: number): number =>
  Math.min(canvas.width, canvas.height) * inset;

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
  /** Number of pieces. 1 is no cut — how a render says "whole" over a shot that splits. */
  count: number;
  /** Which piece this render is, 0-based. */
  piece: number;
  /** Output px between pieces. */
  gutter: number;
};

export const MAX_SPLIT = 8;

/**
 * A split's piece count, or "auto": as many pieces, up to AUTO_SPLIT_MAX, as
 * the product actually spans on that preset — every piece at least
 * MIN_PIECE_FILL covered. See resolveSplit.
 */
export type SplitCount = number | "auto";

/**
 * The most pieces "auto" will cut. Three is the carousel the references
 * post; past that each piece is a sliver of UI.
 */
export const AUTO_SPLIT_MAX = 3;

/**
 * Least share of a piece the product must cover. A piece under it is ground
 * with an edge of UI: agents-page `wide --split=3` had its third piece at 0%
 * and its second at 25% (the window, height-bound, spans 1.2 of 3 pieces);
 * agents-home-cutout on `square` and `wide` sat at 29% and 16% a piece. The
 * pieces that read — agents-page portrait 3-up, the cutout on story — cover
 * 36-94%.
 */
export const MIN_PIECE_FILL = 0.3;

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
  if (
    v.split !== undefined &&
    v.split !== "auto" &&
    !(Number.isInteger(v.split) && (v.split as number) >= 1 && (v.split as number) <= MAX_SPLIT)
  )
    return `\`split\` must be a whole number from 1 to ${MAX_SPLIT}, or "auto"`;
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
  /** Canvas px per PNG px. Above 1 only by an explicit `upscale`. */
  scale: number;
  /** True when the PNG is drawn at or under native size because `fit` would need more. */
  native: boolean;
  /** True when the draw is stretched past native — an `upscale` was used. */
  stretched: boolean;
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
  opts: { fit?: number; anchor?: Anchor; inset?: number; upscale?: number } = {},
): CutoutLayout {
  const body = meta.body;
  if (!body) throw new Error(`shot "${meta.name}" is not a cutout (no body)`);
  const fit = opts.fit ?? meta.fit ?? CUTOUT_FIT;
  const anchor = opts.anchor ?? meta.anchor ?? "center";
  const inset = opts.inset ?? meta.inset ?? 0;

  const png = shotPixels(meta);
  const bodyPx = { width: body.width * meta.scale, height: body.height * meta.scale };
  const want = windowBox(body.height / body.width, canvas, fit);
  const ceiling = opts.upscale ?? meta.upscale ?? 1;
  const scale = Math.min(ceiling, want.width / bodyPx.width);

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
    native: scale === 1 && want.width / bodyPx.width >= 1,
    stretched: scale > 1,
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
  opts: { zoom?: Zoom; anchor?: Anchor; inset?: number; focus?: Box } = {},
): Box {
  const asked = opts.zoom ?? meta.zoom ?? BLEED_ZOOM;
  const focus = opts.focus ?? meta.focus;
  const anchor = opts.anchor ?? meta.anchor ?? "top-left";
  const inset = opts.inset ?? meta.inset ?? BLEED_INSET;
  const base = windowBox(shotAspect(meta), canvas, windowFit);
  // Fill covers the canvas from the anchored edge; the inset moves it in, so
  // what runs off the far side is exactly the inset's worth.
  const zoom = asked === "fill" ? fillZoom(base, canvas) : asked;
  const size = {
    width: Math.round(base.width * zoom),
    height: Math.round(base.height * zoom),
  };
  const at = focus
    ? focusBox(size, canvas, {
        x: ((focus.x + focus.width / 2) / meta.region.width) * size.width,
        y: ((focus.y + focus.height / 2) / meta.region.height) * size.height,
      }, inset)
    : anchorBox(size, canvas, anchor, inset);
  return { x: Math.round(at.left), y: Math.round(at.top), ...size };
}

/**
 * Top-left of a box of `size` placed so `point` (px inside the box) lands on
 * the canvas centre — then pulled back so no edge comes further in than the
 * inset margin, or the ground would show where the bleed should run off. An
 * axis on which the box is smaller than the canvas is simply centred.
 */
export function focusBox(
  size: Canvas,
  canvas: Canvas,
  point: { x: number; y: number },
  inset: number,
): { left: number; top: number } {
  const margin = insetPx(canvas, inset);
  const axis = (len: number, room: number, at: number): number => {
    if (len <= room) return (room - len) / 2;
    const want = room / 2 - at;
    return Math.min(margin, Math.max(room - margin - len, want));
  };
  return {
    left: axis(size.width, canvas.width, point.x),
    top: axis(size.height, canvas.height, point.y),
  };
}

/**
 * The width, in device px, a feed shows an image at: a phone's feed column.
 * Text size in a still only means something against the size it is SEEN at,
 * and every platform scales a post to its column, whatever its pixel count.
 */
export const FEED_WIDTH = 1080;
/**
 * Below this many feed px per CSS px, UI text stops reading. 13px body text
 * at 0.7x lands at ~9px on a phone, which is the smallest the reference
 * stills ever show; a 1440px-wide 16:9 page in a window on `wide` reaches ~0.64x.
 */
export const MIN_TEXT_SCALE = 0.7;
/**
 * Below this share of the canvas, the product is a small picture on a lot of
 * ground. A 16:9 window in a story frame covers ~23%.
 */
export const MIN_FILL = 0.45;

export type Legibility = {
  /** Feed px per CSS px of the app — 1 is the app at its own size. */
  textScale: number;
  /** Share of the (whole) canvas the product covers, 0-1. */
  fill: number;
};

/**
 * How big the app will read, and how much of the frame it takes, for one
 * render. Both come off the same layout the composition draws.
 *
 * `piece` is the size one posted image is (a split's piece, else the canvas):
 * a feed scales THAT to FEED_WIDTH. `canvas` is what the layout spans.
 */
export function stillLegibility(
  meta: ShotMeta,
  look: StillLook,
  piece: Canvas,
  canvas: Canvas,
  windowFit: number,
  opts: {
    fit?: number;
    anchor?: Anchor;
    inset?: number;
    zoom?: Zoom;
    upscale?: number;
    focus?: Box;
  } = {},
): Legibility {
  const drawn = productBox(meta, look, canvas, windowFit, opts);
  const cssWidth = look === "cutout" && meta.body ? meta.body.width : meta.region.width;
  return {
    textScale: (drawn.width / cssWidth) * (FEED_WIDTH / piece.width),
    fill:
      (overlap(drawn.x, drawn.width, 0, canvas.width) *
        overlap(drawn.y, drawn.height, 0, canvas.height)) /
      (canvas.width * canvas.height),
  };
}

type FramingOpts = {
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: Zoom;
  upscale?: number;
  focus?: Box;
};

/** Length of [a, a+len) inside [from, from+room). */
const overlap = (a: number, len: number, from: number, room: number): number =>
  Math.max(0, Math.min(from + room, a + len) - Math.max(from, a));

/**
 * Where the PRODUCT lands on `canvas`, in canvas px: a cutout's body (not its
 * shadow), a bleed's window, or the centred window. The one box every
 * coverage and edge check measures, off the same layout the composition draws.
 */
export function productBox(
  meta: ShotMeta,
  look: StillLook,
  canvas: Canvas,
  windowFit: number,
  opts: FramingOpts = {},
): Box {
  if (look === "cutout" && meta.body) return cutoutLayout(meta, canvas, opts).body;
  if (look === "bleed") return bleedLayout(meta, canvas, windowFit, opts);
  const box = windowBox(shotAspect(meta), canvas, windowFit);
  return { x: (canvas.width - box.width) / 2, y: (canvas.height - box.height) / 2, ...box };
}

/**
 * Share of each piece of a `count`-piece split the product covers, 0-1, in
 * piece order. The layout spans the whole strip, so a product narrower than
 * the strip leaves the far pieces as ground — see MIN_PIECE_FILL.
 */
export function pieceFills(
  meta: ShotMeta,
  look: StillLook,
  piece: Canvas,
  count: number,
  gutter: number,
  windowFit: number,
  opts: FramingOpts = {},
): number[] {
  const { canvas } = splitCanvas(piece, { count, piece: 0, gutter });
  const box = productBox(meta, look, canvas, windowFit, opts);
  const tall = overlap(box.y, box.height, 0, piece.height);
  return Array.from({ length: count }, (_, i) => {
    const wide = overlap(box.x, box.width, i * (piece.width + gutter), piece.width);
    return (wide * tall) / (piece.width * piece.height);
  });
}

/**
 * How many pieces a preset is cut into. A number is taken as asked, with
 * each piece's coverage reported so a piece of ground can be refused; "auto"
 * is the most pieces, up to AUTO_SPLIT_MAX, that all reach MIN_PIECE_FILL —
 * 1 when even two would not. agents-page's bleed spans ~1.2 pieces of `wide`
 * and ~2.6 of `portrait`, so "auto" cuts it 1 and 3.
 */
export function resolveSplit(
  meta: ShotMeta,
  look: StillLook,
  piece: Canvas,
  asked: SplitCount | undefined,
  gutter: number,
  windowFit: number,
  opts: FramingOpts = {},
): { count: number; fills: number[] } {
  const fills = (n: number) => pieceFills(meta, look, piece, n, gutter, windowFit, opts);
  if (asked === undefined || asked === 1) return { count: 1, fills: fills(1) };
  if (asked !== "auto") return { count: asked, fills: fills(asked) };
  for (let n = AUTO_SPLIT_MAX; n > 1; n--) {
    const f = fills(n);
    if (f.every((v) => v >= MIN_PIECE_FILL)) return { count: n, fills: f };
  }
  return { count: 1, fills: fills(1) };
}

export type Side = "top" | "right" | "bottom" | "left";

/** The sides of `canvas` the box reaches or crosses, within `tol` px. */
export function sidesReached(box: Box, canvas: Canvas, tol = 1): Side[] {
  const sides: Side[] = [];
  if (box.y <= tol) sides.push("top");
  if (box.x + box.width >= canvas.width - tol) sides.push("right");
  if (box.y + box.height >= canvas.height - tol) sides.push("bottom");
  if (box.x <= tol) sides.push("left");
  return sides;
}

/** The sides an anchor pins, e.g. top-left -> top and left; center -> none. */
export function anchoredSides(anchor: Anchor): Side[] {
  const [v, h] = anchorAxes(anchor);
  const sides: Side[] = [];
  if (v !== "center") sides.push(v);
  if (h !== "center") sides.push(h);
  return sides;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Sides a window or cutout reaches that it was not meant to. Neither look
 * bleeds, so the product touching the canvas edge is a crop nobody asked for
 * — agents-home-composer at `fit: 1.35` on `og` filled the card top to bottom
 * and lost its chips. The one exception is a cutout framed past the canvas
 * (`fit` over 1): its far side, opposite the anchor, runs off on purpose.
 */
export function unintendedEdges(
  look: StillLook,
  box: Box,
  canvas: Canvas,
  opts: { fit?: number; anchor?: Anchor } = {},
): Side[] {
  if (look === "bleed") return [];
  const expected =
    look === "cutout" && (opts.fit ?? CUTOUT_FIT) > 1
      ? anchoredSides(opts.anchor ?? "center").map((s) => OPPOSITE[s])
      : [];
  return sidesReached(box, canvas).filter((s) => !expected.includes(s));
}

/**
 * Past this share of the canvas, ground showing on a side a bleed should run
 * off is a floating window, not a bleed. smoke-bleed on story stopped at
 * y=1711 of 3840 — 55% of the frame empty below it.
 */
export const MAX_BLEED_GAP = 0.1;

/**
 * Ground left on the sides a bleed is meant to run off, as a share of that
 * axis — only the sides over MAX_BLEED_GAP. Those are the sides opposite the
 * anchored ones: top-left runs off right and bottom. An axis the anchor
 * centres is not judged when the other is pinned — `left` is a strip run off
 * the right, sitting in the middle — and `center`, or a focus, should run off
 * every side.
 */
export function bleedGaps(
  box: Box,
  canvas: Canvas,
  opts: { anchor?: Anchor; focus?: Box } = {},
): Partial<Record<Side, number>> {
  const pinned = opts.focus ? [] : anchoredSides(opts.anchor ?? "top-left");
  const judged: Side[] = pinned.length
    ? pinned.map((s) => OPPOSITE[s])
    : ["top", "right", "bottom", "left"];
  const gap: Record<Side, number> = {
    top: box.y / canvas.height,
    right: (canvas.width - (box.x + box.width)) / canvas.width,
    bottom: (canvas.height - (box.y + box.height)) / canvas.height,
    left: box.x / canvas.width,
  };
  const out: Partial<Record<Side, number>> = {};
  for (const side of Object.keys(gap) as Side[])
    if (judged.includes(side) && gap[side] > MAX_BLEED_GAP) out[side] = gap[side];
  return out;
}

/**
 * `--focus=x,y` — a point as fractions of the region, 0-1 each — as the
 * zero-size box in the region's CSS px that bleedLayout centres. Throws with
 * the form, since that is the fix.
 */
export function parseFocus(raw: string, region: Canvas): Box {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    throw new Error(`--focus wants x,y as fractions of the region, e.g. 0.7,0.3 — got "${raw}"`);
  return { x: parts[0] * region.width, y: parts[1] * region.height, width: 0, height: 0 };
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
  const framing = framingProblem(meta) ?? splitProblem(meta) ?? presetsProblem(meta);
  if (framing) return framing;
  if (meta.look === "cutout" && meta.body === undefined)
    return "a cutout sidecar must carry a `body` — re-run `pnpm shot`";
  return null;
}

/**
 * Shape check for per-preset framing, shared by the spec and the sidecar.
 * Each override is judged like the shot's own knobs; its look may not cross
 * the cutout line, since the capture decided that.
 */
export function presetsProblem(v: { look?: unknown; presets?: unknown }): string | null {
  if (v.presets === undefined) return null;
  if (typeof v.presets !== "object" || v.presets === null) return "`presets` must be an object";
  const own = v.look ?? DEFAULT_LOOK;
  for (const [id, o] of Object.entries(v.presets as Record<string, unknown>)) {
    if (!isPresetId(id))
      return `\`presets.${id}\` is not a preset — expected one of ${STILL_PRESET_IDS.join(", ")}`;
    if (typeof o !== "object" || o === null) return `\`presets.${id}\` must be an object`;
    const p = o as PresetFraming;
    // A gutter alone is fine here: the shot's own split may be what it spaces.
    const issue = framingProblem(p) ?? splitProblem({ split: p.split });
    if (!issue && p.gutter !== undefined && !(typeof p.gutter === "number" && p.gutter >= 0))
      return `\`presets.${id}\`: \`gutter\` must be a number >= 0`;
    if (issue) return `\`presets.${id}\`: ${issue}`;
    if (p.look !== undefined && (p.look === "cutout") !== (own === "cutout"))
      return `\`presets.${id}.look\` cannot turn a ${own} capture into a ${p.look} — a cutout is photographed differently`;
  }
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
  upscale?: unknown;
  ground?: unknown;
  body?: unknown;
  focus?: unknown;
}): string | null {
  if (v.look !== undefined && !isStillLook(v.look))
    return `\`look\` must be one of ${STILL_LOOKS.join(", ")}`;
  if (v.fit !== undefined && !(typeof v.fit === "number" && v.fit > 0 && v.fit <= MAX_CUTOUT_FIT))
    return `\`fit\` must be a number in (0, ${MAX_CUTOUT_FIT}]`;
  if (v.anchor !== undefined && !isAnchor(v.anchor))
    return `\`anchor\` must be one of ${ANCHORS.join(", ")}`;
  if (v.inset !== undefined && !(typeof v.inset === "number" && v.inset >= 0 && v.inset < 0.5))
    return "`inset` must be a number in [0, 0.5)";
  if (v.zoom !== undefined && !isZoom(v.zoom))
    return "`zoom` must be a number >= 1, or \"fill\"";
  if (v.shadow !== undefined && typeof v.shadow !== "boolean")
    return "`shadow` must be a boolean";
  if (v.upscale !== undefined && !(typeof v.upscale === "number" && v.upscale >= 1 && v.upscale <= MAX_UPSCALE))
    return `\`upscale\` must be a number from 1 to ${MAX_UPSCALE}`;
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
  if (v.focus !== undefined) {
    const f = v.focus as Partial<Box>;
    if (typeof f !== "object" || f === null) return "`focus` must be an object";
    for (const key of ["x", "y", "width", "height"] as const)
      if (typeof f[key] !== "number") return `\`focus.${key}\` must be a number`;
    if (!(f.width! >= 0 && f.height! >= 0)) return "`focus` must not have a negative size";
  }
  return null;
}
