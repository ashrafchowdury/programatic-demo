import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { Backdrop } from "./Backdrop";
import { PRODUCT_GRADE, RimLight, SHADOW_RGB, Stage, WindowFrame } from "./WindowFrame";
import { WINDOW_FIT } from "./lib/window";
import {
  bleedLayout,
  cutoutLayout,
  hasOwnShadow,
  shotAspect,
  splitCanvas,
  windowBox,
  type Anchor,
  type Box,
  type ShotMeta,
  type Split,
  type StillLook,
  type Zoom,
} from "./lib/still";
import { resolveGround } from "./lib/backdrop";
import { DesignWidthContext, useDesignScale } from "./WindowFrame";

export type StillShotProps = {
  /** Reads public/shots/<name>.png. */
  name: string;
  /** The sidecar written beside it, supplying the region's shape. */
  meta: ShotMeta;
  /** Studio backdrop name. See src/lib/backdrop.ts. Defaults to "glaze". */
  backdrop?: string;
  /** Flat ground colour instead of the backdrop image. Wins over `backdrop`. */
  ground?: string;
  /**
   * The image to draw for `backdrop`, under public/ — the 4K grain-free
   * `-still` variant when Root found one (see stillBackdropFile). Absent
   * means the backdrop's own (video) file.
   */
  backdropSrc?: string;
  /** Cutout: cast a soft shadow. Defaults to "only if the element has none". */
  shadow?: boolean;
  /**
   * How to frame it. See STILL_LOOKS. Defaults to the sidecar's, then "window".
   * A cutout can only be rendered as a cutout — its PNG is the element with
   * alpha, not a crop — and Root falls back to the sidecar's look if asked
   * otherwise.
   */
  look?: StillLook;
  /** Framing knobs; each overrides the sidecar's. Which apply depends on `look`. */
  fit?: number;
  anchor?: Anchor;
  inset?: number;
  zoom?: Zoom;
  upscale?: number;
  /** Bleed: the box to centre, CSS px in the region. Overrides the sidecar's. */
  focus?: Box;
  /**
   * Render one piece of a still cut into several. The composition is the
   * PIECE's size; the layout is done across the whole. See splitCanvas.
   */
  split?: Split;
};

/**
 * One captured region, framed on the backdrop.
 *
 * The same treatment DemoClip gives footage — same backdrop, same window, same
 * rim — over a screenshot instead of a video. That is the point: a still shared
 * next to a clip should look like it came from the same place.
 *
 * Four things are deliberately NOT here:
 *
 * 0. No fake macOS titlebar, ever. A still is a picture of the product; the
 *    chrome is a prop from the video grammar and read as clutter on every
 *    still it was tried on. WindowFrame keeps it for clips only.
 *
 * 1. No <CameraMotionBlur>. Nothing moves, so the shutter is pure cost, and it
 *    is destructive to colour. Its absence also lifts the banding rule that
 *    governs DemoClip — soft gradients would be safe in here. RimLight is kept
 *    unchanged anyway, because matching the videos beats a marginally nicer
 *    shadow that only stills would have.
 *
 * 2. No camera pose. The crop already happened, in the browser, at capture time.
 *    Zooming here would upscale a screenshot to show less of it.
 *
 * 3. No S_MAX ceiling. That limit exists in zoom.ts because video footage is
 *    1920px wide and magnifying it softens. A still is captured at whatever
 *    scale it needs, so nothing is being stretched to begin with.
 */
export const StillShot: React.FC<StillShotProps> = (props) => {
  const piece = useVideoConfig();
  if (!props.split) return <StillBody {...props} canvas={piece} />;
  // One piece of a wider layout: lay the whole out at its full width, then
  // show the slice this piece owns. Everything inside positions itself
  // against the nearest positioned ancestor, which is the wide div, so the
  // three bodies below need no idea they are being cut.
  const { canvas, offset } = splitCanvas(piece, props.split);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: -offset,
          top: 0,
          width: canvas.width,
          height: canvas.height,
        }}
      >
        <DesignWidthContext.Provider value={canvas.width}>
          <StillBody {...props} canvas={canvas} />
        </DesignWidthContext.Provider>
      </div>
    </AbsoluteFill>
  );
};

/** The still itself, laid out against `canvas` — the composition, or the whole a split is cut from. */
const StillBody: React.FC<StillShotProps & { canvas: { width: number; height: number } }> = ({
  name,
  meta,
  backdrop,
  backdropSrc,
  ground,
  shadow,
  look,
  fit,
  anchor,
  inset,
  zoom,
  upscale,
  focus,
  canvas,
}) => {
  const { width, height } = canvas;
  const k = useDesignScale();
  // Root has already decided which ground wins; this only asks whether it is
  // light — by measurement for a flat ground, by the hand-kept list for an
  // image — through the same rule DemoClip uses.
  const { light } = resolveGround({ ground, backdrop });
  const resolved = look ?? meta.look ?? "window";
  const ground_ = <Backdrop name={backdrop} ground={ground} file={backdropSrc} />;

  if (resolved === "cutout" && meta.body) {
    const lay = cutoutLayout(meta, { width, height }, { fit, anchor, inset, upscale });
    // Elevation. On a light ground: the element's own shadow if it painted
    // one, else a soft cast shadow so it does not sit like a sticker — both
    // drawn from the alpha, so they follow the exact shape. On a dark ground a
    // dark shadow has nothing darker to be, so it gets RimLight's hairline
    // lift instead, for the same reason RimLight exists.
    //
    // The cast shadow is the window's warm tint (SHADOW_RGB), not a slate of
    // its own, and the image wears the window's grade: a cutout beside a
    // window still, on the same ground, should read as the same product.
    const cast = shadow ?? meta.shadow ?? !hasOwnShadow(meta);
    const elevation = !light
      ? `drop-shadow(0 0 ${k}px rgba(255,255,255,0.14))`
      : cast
        ? `drop-shadow(0 ${18 * k}px ${22 * k}px rgba(${SHADOW_RGB},0.10)) ` +
          `drop-shadow(0 ${2 * k}px ${4 * k}px rgba(${SHADOW_RGB},0.06))`
        : "";
    const filter = `${PRODUCT_GRADE} ${elevation}`.trim();
    return (
      <AbsoluteFill>
        {ground_}
        {/*
          The element alone. Its own shadow and anti-aliased corners are in the
          PNG's alpha, so nothing is drawn AROUND it: no frame, no rim, no
          clip. The grade and the elevation are filters on the image itself —
          see `filter` above.
        */}
        <Img
          src={staticFile(`shots/${name}.png`)}
          style={{
            position: "absolute",
            left: lay.img.x,
            top: lay.img.y,
            width: lay.img.width,
            height: lay.img.height,
            filter,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (resolved === "bleed") {
    // The window look's two layers — rim, then window — at the same box, but
    // that box is larger than the canvas and anchored, so Stage's flex centring
    // cannot place it. Absolute positioning inside a clipping fill instead.
    const box = bleedLayout(meta, { width, height }, WINDOW_FIT, { zoom, anchor, inset, focus });
    const at: React.CSSProperties = {
      position: "absolute",
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    };
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {ground_}
        <div style={at}>
          <RimLight light={light} />
        </div>
        <div style={at}>
          <WindowFrame>
            <Img
              src={staticFile(`shots/${name}.png`)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </WindowFrame>
        </div>
      </AbsoluteFill>
    );
  }
  // The window takes the region's shape, fitted into the preset's canvas on
  // whichever axis binds first — the two aspects are independent here, unlike
  // in a clip where the window always matches the recording. See windowBox.
  const box = windowBox(shotAspect(meta), { width, height }, WINDOW_FIT);
  const frame: React.CSSProperties = {
    width: box.width,
    height: box.height,
    position: "relative",
  };

  return (
    <AbsoluteFill>
      {ground_}
      {/* Elevation first, as its own layer, exactly as DemoClip stacks it. */}
      <Stage>
        <div style={frame}>
          <RimLight light={light} />
        </div>
      </Stage>
      <Stage>
        <div style={frame}>
          <WindowFrame>
            {/*
              `cover`, not `fill`: windowBox preserves the region's aspect, but
              it rounds to whole pixels, and `fill` would turn that half-pixel
              into a real (if tiny) stretch of the thing we went to some trouble
              to capture sharply. Any crop from `cover` is sub-pixel.
            */}
            <Img
              src={staticFile(`shots/${name}.png`)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </WindowFrame>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};
