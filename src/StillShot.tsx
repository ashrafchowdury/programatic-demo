import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { Backdrop } from "./DemoClip";
import { RimLight, Stage, WindowFrame } from "./WindowFrame";
import { WINDOW_FIT } from "./lib/window";
import { shotAspect, windowBox, type ShotMeta } from "./lib/still";

export type StillShotProps = {
  /** Reads public/shots/<name>.png. */
  name: string;
  /** The sidecar written beside it, supplying the region's shape. */
  meta: ShotMeta;
  /** Fake macOS titlebar, as in DemoClip. Off by default for the same reason. */
  chrome?: boolean;
};

/**
 * One captured region, framed on the backdrop.
 *
 * The same treatment DemoClip gives footage — same backdrop, same window, same
 * rim — over a screenshot instead of a video. That is the point: a still shared
 * next to a clip should look like it came from the same place.
 *
 * Three things are deliberately NOT here:
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
export const StillShot: React.FC<StillShotProps> = ({ name, meta, chrome }) => {
  const { width, height } = useVideoConfig();
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
      <Backdrop />
      {/* Elevation first, as its own layer, exactly as DemoClip stacks it. */}
      <Stage>
        <div style={frame}>
          <RimLight />
        </div>
      </Stage>
      <Stage>
        <div style={frame}>
          <WindowFrame chrome={chrome} hostLabel={name.replace(/-/g, ".")}>
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
