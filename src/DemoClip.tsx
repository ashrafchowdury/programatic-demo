import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { zoomAt, type ClickLog } from "./lib/zoom";
import { CHROME_H, WINDOW_FIT } from "./lib/window";
import { backdropFile, isLightBackdrop } from "./lib/backdrop";
import { Cursor } from "./Cursor";
import { RimLight, Stage, useDesignScale, WindowFrame } from "./WindowFrame";

const round = (n: number) => Math.round(n);

export type DemoClipProps = {
  name: string;
  log: ClickLog;
  /**
   * Fake macOS titlebar above the footage (part of the camera target).
   * Off by default — the reference clips float bare rounded content on the
   * gradient, and a fake titlebar with a fake hostname reads as decoration.
   */
  chrome?: boolean;
  /** Composition vs shoot. 1 = realtime; 1.25 / 1.5 / 2 = faster. */
  speed?: number;
  /**
   * Slow push inside long holds, 0..1. Off unless a reel storyboard asks.
   *
   * scripts/render.ts does not pass it, so out/<name>.mp4 is unaffected — see
   * driftPose in src/lib/zoom.ts, which returns its argument by reference when
   * this is unset.
   */
  drift?: number;
  /**
   * Which studio backdrop to float the window on. A name from BACKDROPS, or a
   * filename you dropped in public/backdrops/. Defaults to "glaze".
   */
  backdrop?: string;
};

/**
 * Studio backdrop: a pre-rendered image, not CSS.
 *
 * WHY AN IMAGE. Everything drawn as a CSS gradient has to survive h264 at CRF
 * 16, and near-black gradients do not. Measured as the longest run of
 * pixel-identical colour on a backdrop scanline after encoding (2560px wide):
 *
 *   this file                                  12px
 *   the violet CSS gradient this replaced      97px
 *   ray.so Prisma  (linear-gradient, near-black)  360px
 *   ray.so Stripe / AWS (flat #0a2540 / #151D26)  2560px — the whole scanline
 *
 * The mechanism is the dither. A soft ramp only avoids banding if noise breaks
 * it up, and the old `feTurbulence` overlay ran at opacity 0.035 — calibrated
 * for a Y=200 backdrop. On a dark one h264 discards it, and the encoder's
 * deadzone quantiser then flattens what is left. Worse, WEAK noise is actively
 * worse than none: measured on this same image, grain 4 gave 160px against 112px
 * for no grain at all, because the encoder quantises faint noise into blocks.
 * There is a threshold near grain 8 below which nothing survives.
 *
 * Baking sidesteps all of it. The grain is in the source at full amplitude, so
 * the encoder must spend bits on it. It is also nearly free per-frame: the
 * backdrop never moves, so after the I-frame every P-frame sees zero residual.
 *
 * REGENERATING. `pnpm backdrop <image> <name>` does all of this and reports the
 * banding measurement. Order matters and the script keeps it: blur first (it
 * would destroy grain applied before it), lift the black floor only if the
 * source is clipped (`--lift`), grain last.
 *
 * Downscaling alone is NOT enough dither: averaging 6000px into 2560px cuts the
 * source's own grain, and the unprocessed wallpaper measured 1930px.
 */


/**
 * Drawn with <Img>, not a CSS background-image: Remotion blocks the frame until
 * an <Img> has decoded, so it cannot render a frame with the backdrop missing.
 * A CSS background is invisible to that handshake and flickers on cold workers.
 */
export const Backdrop: React.FC<{ name?: string }> = ({ name }) => (
  <AbsoluteFill>
    <Img
      src={staticFile(backdropFile(name))}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </AbsoluteFill>
);

/**
 * Camera pose for this frame, plus the wrapper style that positions the window
 * group under it. Shared by the shadow group and the window group so the two
 * stay locked together despite living on opposite sides of the shutter.
 *
 * Must be called inside each of them rather than lifted to DemoClip:
 * CameraMotionBlur re-renders its subtree at offset frames, and only a
 * useCurrentFrame() call *inside* that subtree sees the offset.
 */
/**
 * `drift` is read HERE and nowhere else, on purpose. ShadowGroup and WindowGroup
 * both go through this hook, so they cannot disagree about the camera. If one
 * group read the prop and the other did not, the shadow would separate from the
 * window by up to a few percent of scale during a long hold — a halo that only
 * appears on drifting clips, so a smoke test would never catch it. The parameter
 * is required rather than defaulted so tsc forces both call sites to change.
 */
function useCameraGroup(
  chrome: boolean,
  log: ClickLog,
  speed: number,
  drift: number | undefined,
) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const chromeH = CHROME_H * useDesignScale();
  // Fraction of the WINDOW GROUP (chrome + footage) that the chrome occupies —
  // not of the composition. The group is chromeH taller than the frame so the
  // footage keeps its aspect, so the denominator has to include the chrome.
  // Scale cancels here (both terms scale together), which is the point.
  const chromeFrac = chrome ? chromeH / (height + chromeH) : 0;
  const z = zoomAt(frame, fps, log, {
    chromeFrac,
    speed,
    fit: WINDOW_FIT,
    drift,
  });

  const style: React.CSSProperties = {
    width: "100%",
    // Grow by the chrome strip so the footage area below it is exactly the
    // recorded aspect. At height:100% the chrome ate 38px from a 1080px box and
    // `objectFit: fill` stretched 1920x1080 into 1920x1042 — a silent 3.5%
    // vertical squash over the whole clip.
    height: `calc(100% + ${chrome ? chromeH : 0}px)`,
    // Pan is a translate about the group's centre, not a moving
    // transform-origin — see poseToCss. Percentages resolve against this
    // element's own size, which is what poseToCss returns fractions of.
    transform: `translate(${z.translateX * 100}%, ${z.translateY * 100}%) scale(${z.scale})`,
    position: "relative",
    willChange: "transform",
  };
  return { z, frame, fps, style };
}

/**
 * The window's shadow, tracking the camera but drawn outside the shutter.
 * See RimLight for why it cannot live with the window.
 */
const ShadowGroup: React.FC<DemoClipProps> = ({
  log,
  chrome = false,
  speed = 1,
  drift,
  backdrop,
}) => {
  const { style } = useCameraGroup(chrome, log, speed, drift);
  return (
    <Stage>
      <div style={style}>
        <RimLight light={isLightBackdrop(backdrop ?? "")} />
      </div>
    </Stage>
  );
};

/**
 * Window + footage. Must call useCurrentFrame() itself (via useCameraGroup) so
 * CameraMotionBlur can sample neighbouring frames with a real camera pose on
 * each sample.
 */
const WindowGroup: React.FC<DemoClipProps> = ({
  name,
  log,
  chrome = false,
  speed = 1,
  drift,
}) => {
  const { z, frame, fps, style } = useCameraGroup(chrome, log, speed, drift);
  const trimBefore = log.trimBeforeMs
    ? round((log.trimBeforeMs / 1000) * fps)
    : undefined;
  const hostLabel = name.replace(/-/g, ".");

  return (
    <Stage>
      <div style={style}>
        <WindowFrame chrome={chrome} hostLabel={hostLabel}>
          <Video
            src={staticFile(`${name}.mp4`)}
            trimBefore={trimBefore}
            playbackRate={speed}
            objectFit="fill"
            style={{ width: "100%", height: "100%" }}
          />
          {/*
            Drawn over the footage, inside the camera transform. No-ops on
            logs without a cursorTrack — those have the pointer baked into the
            recording already.
          */}
          <Cursor
            log={log}
            timeS={(frame / fps) * speed - (log.offsetMs ?? 0) / 1000}
            cameraScale={z.scale}
          />
        </WindowFrame>
      </div>
    </Stage>
  );
};

/**
 * Flat footage + one camera over the whole floating window.
 *
 * The zoom transform is applied to the *entire window group* (chrome + page +
 * shadow) — not just the video layer — so the composition behaves like a
 * Screen Studio camera over a recording, not a scaled live DOM region.
 */
export const DemoClip: React.FC<DemoClipProps> = (props) => {
  const chrome = props.chrome === true;

  return (
    <AbsoluteFill>
      <Backdrop name={props.backdrop} />
      {/*
        Shadow first, and deliberately NOT inside the shutter below: stacking
        semi-transparent copies quantises a soft gradient into rings. It carries
        the same camera transform, so it still tracks the window exactly.
      */}
      <ShadowGroup {...props} chrome={chrome} />
      {/*
        Always-on shutter. Still holds sample identical poses so they stay sharp;
        toggling `samples` mid-clip remounts <Video>. Keep samples low — the
        effect is destructive to colors.
      */}
      <CameraMotionBlur shutterAngle={180} samples={8}>
        <WindowGroup {...props} chrome={chrome} />
      </CameraMotionBlur>
    </AbsoluteFill>
  );
};
