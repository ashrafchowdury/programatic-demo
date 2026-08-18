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
import { DESIGN_WIDTH } from "./lib/click-log";
import { Cursor } from "./Cursor";

const round = (n: number) => Math.round(n);

/**
 * Every length below is written at DESIGN_WIDTH and multiplied by this at render.
 *
 * Without it the design is accidentally pinned to 1080p: raise the output to
 * 2560 and the shadow radii, cursor and corner radius all render at 75% of their
 * tuned size, which reads as a flatter, harder-edged window rather than a
 * higher-resolution one. Scaling them keeps the composition looking identical at
 * any output size — only the rasterisation gets finer.
 */
const useDesignScale = (): number => useVideoConfig().width / DESIGN_WIDTH;

/** macOS titlebar height inside the window group (px at DESIGN_WIDTH). */
const CHROME_H = 38;
/**
 * Base float size of the window on the studio backdrop, before camera zoom.
 *
 * Trades gradient against legibility. The reference clips sit near 0.69, but
 * they frame a far simpler UI — Agenta at 1920px went unreadably small there.
 * 0.86 keeps a clear gradient margin with the app still legible at base scale.
 *
 * Coupled to S_MAX in src/lib/zoom.ts: what the viewer sees is WINDOW_FIT *
 * scale, and the 1080p source starts to soften past ~1.5x. Raise this and lower
 * S_MAX to match, or the zooms quietly start upscaling harder.
 */
const WINDOW_FIT = 0.86;
/** Corner radius of the floating window, shared by the window and its shadow. */
const WINDOW_RADIUS = 14;

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
 * REGENERATING. Source is the Raycast "glaze" wallpaper at 6000x3375. Order
 * matters — blur first (it would destroy grain applied before it), lift the
 * black floor second, grain last:
 *
 *   ffmpeg -i glaze_1.png -vf "scale=2560:1440:flags=lanczos,\
 *     gblur=sigma=16,\
 *     lutrgb=r='10+val*245/255':g='10+val*245/255':b='10+val*245/255',\
 *     noise=alls=12:allf=u" -q:v 2 backdrop.jpg
 *
 * The lut is not cosmetic. The source has YLOW=16, i.e. its whole bottom decile
 * sits on the black floor, and noise on clipped black is half-rectified — it can
 * only swing up. Lifting the floor ten levels first took this image from 137px
 * to 27px. Blur then took it to 12px, which is why sigma 16 is a win twice over.
 *
 * Downscaling alone is NOT enough dither: averaging 6000px into 2560px cuts the
 * source's own grain, and the unprocessed wallpaper measured 1930px.
 */
const BACKDROP_FILE = "backdrop.jpg";

/**
 * Window elevation, as a light rim rather than a cast shadow.
 *
 * ---------------------------------------------------------------------------
 * THE BANDING RULE: A SOFT GRADIENT MUST NOT LIVE INSIDE <CameraMotionBlur>.
 * ---------------------------------------------------------------------------
 * Measured on a still (frame 8, one pixel column just below the window, blue
 * channel):
 *
 *   samples={1}  184 195 198 199 205 205 208 ... 235 237   ~1 level/px, smooth
 *   samples={8}  188 189 197 195 204 203 204 ... 232 232   plateaus, steps of 7
 *
 * CameraMotionBlur renders N copies of its subtree and composites them at
 * fractional opacity. Every composite rounds to 8 bits, so a value that should
 * drift by a fraction of a level per pixel is pinned until it can jump a whole
 * step. Any soft falloff inside that tree is destroyed, at any blur radius.
 * So this lives OUTSIDE the shutter, as a sibling carrying the same camera
 * transform (see DemoClip). The glow below is exactly such a falloff.
 *
 * WHY A RIM AND NOT A SHADOW. A cast shadow works by being darker than what is
 * behind it, and on a near-black backdrop there is nothing darker — the old
 * violet shadow rendered but was invisible, leaving the window a hard white
 * rectangle cut out of the dark. Lifting the edge instead is the device
 * ray.so's dark frames use (Auth0: `0 0 0 1px rgb(255 255 255 / 10%)`).
 *
 * Judge changes from a magnified crop of the window's bottom-left corner; none
 * of this shows up in a scanline diff of the whole frame.
 */
const RimLight: React.FC = () => {
  const k = useDesignScale();
  return (
    <>
      {/* Broad ambient lift: the pool of light the window sits in. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 60 * k,
          background: "rgba(255,255,255,0.10)",
          transform: "translateY(2%) scale(0.97, 0.96)",
          filter: `blur(${90 * k}px)`,
          pointerEvents: "none",
        }}
      />
      {/* Hairline. A 1px step, so the shutter's stacking cannot band it. */}
      <div
        style={{
          position: "absolute",
          inset: -k,
          borderRadius: (WINDOW_RADIUS + 1) * k,
          boxShadow: `0 0 0 ${k}px rgba(255,255,255,0.14)`,
          pointerEvents: "none",
        }}
      />
    </>
  );
};

/**
 * Drawn with <Img>, not a CSS background-image: Remotion blocks the frame until
 * an <Img> has decoded, so it cannot render a frame with the backdrop missing.
 * A CSS background is invisible to that handshake and flickers on cold workers.
 */
const Backdrop: React.FC = () => (
  <AbsoluteFill>
    <Img
      src={staticFile(BACKDROP_FILE)}
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
function useCameraGroup(chrome: boolean, log: ClickLog, speed: number) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const chromeH = CHROME_H * useDesignScale();
  // Fraction of the WINDOW GROUP (chrome + footage) that the chrome occupies —
  // not of the composition. The group is chromeH taller than the frame so the
  // footage keeps its aspect, so the denominator has to include the chrome.
  // Scale cancels here (both terms scale together), which is the point.
  const chromeFrac = chrome ? chromeH / (height + chromeH) : 0;
  const z = zoomAt(frame, fps, log, { chromeFrac, speed, fit: WINDOW_FIT });

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

/** Centres a camera group in the frame. */
const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
    }}
  >
    {children}
  </AbsoluteFill>
);

/**
 * The window's shadow, tracking the camera but drawn outside the shutter.
 * See RimLight for why it cannot live with the window.
 */
const ShadowGroup: React.FC<DemoClipProps> = ({
  log,
  chrome = false,
  speed = 1,
}) => {
  const { style } = useCameraGroup(chrome, log, speed);
  return (
    <Stage>
      <div style={style}>
        <RimLight />
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
}) => {
  const { z, frame, fps, style } = useCameraGroup(chrome, log, speed);
  const k = useDesignScale();
  const trimBefore = log.trimBeforeMs
    ? round((log.trimBeforeMs / 1000) * fps)
    : undefined;
  const hostLabel = name.replace(/-/g, ".");

  return (
    <Stage>
      <div style={style}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: WINDOW_RADIUS * k,
            overflow: "hidden",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            filter: "saturate(1.05) contrast(1.025) brightness(1.01)",
            // Hard edges only: the top inner highlight, and nothing else. The
            // outer hairline that used to sit here was a dark violet, sized to
            // stop white dissolving into a light gradient; against the dark
            // backdrop it read as a seam. Separation is RimLight's job now.
            // Both are 1px steps, which the shutter's 8-bit stacking cannot
            // band — every soft falloff belongs outside the shutter.
            boxShadow: `inset 0 ${k}px 0 rgba(255,255,255,0.9)`,
          }}
        >
          {chrome ? (
            <div
              style={{
                flex: `0 0 ${CHROME_H * k}px`,
                display: "flex",
                alignItems: "center",
                gap: 10 * k,
                padding: `0 ${14 * k}px`,
                background: "linear-gradient(180deg, #fafbfc 0%, #f0f2f5 100%)",
                borderBottom: "1px solid rgba(15, 23, 42, 0.07)",
                boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.6)",
              }}
            >
              <div style={{ display: "flex", gap: 7 * k, flexShrink: 0 }}>
                {(
                  [
                    ["#ff5f57", "#e0443e"],
                    ["#febc2e", "#dea123"],
                    ["#28c840", "#1aab29"],
                  ] as const
                ).map(([fill, rim], i) => (
                  <div
                    key={i}
                    style={{
                      width: 11 * k,
                      height: 11 * k,
                      borderRadius: 99,
                      background: `radial-gradient(circle at 35% 30%, ${fill} 0%, ${rim} 100%)`,
                      boxShadow: `inset 0 0 0 ${0.5 * k}px rgba(0,0,0,0.12)`,
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 22 * k,
                  borderRadius: 7 * k,
                  background: "rgba(15, 23, 42, 0.045)",
                  border: `${k}px solid rgba(15, 23, 42, 0.05)`,
                  color: "rgba(15, 23, 42, 0.42)",
                  fontSize: 11.5 * k,
                  fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                  fontWeight: 450,
                  letterSpacing: "0.01em",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: `0 ${12 * k}px`,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {hostLabel}
              </div>
              <div style={{ width: 52 * k, flexShrink: 0 }} />
            </div>
          ) : null}

          <div
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
              minHeight: 0,
            }}
          >
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
          </div>
        </div>
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
      <Backdrop />
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
