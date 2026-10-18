import React from "react";
import {
  AbsoluteFill,
  Freeze,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import { zoomAt, type ClickLog } from "./lib/zoom";
import {
  BASE_POSE,
  groupToContentY,
  poseToCss,
  type CameraPose,
} from "./lib/camera";
import { demoSize, footageFrames } from "./lib/demo-duration";
import { CHROME_H, WINDOW_FIT } from "./lib/window";
import { resolveGround } from "./lib/backdrop";
import { Backdrop } from "./Backdrop";
import { Cursor } from "./Cursor";
import { ShutterBlur } from "./ShutterBlur";
import { cornerTravelPx, groupsFor, shutterFraction } from "./lib/shutter";
import {
  DesignWidthContext,
  RimLight,
  Stage,
  useDesignScale,
  WindowFrame,
} from "./WindowFrame";
import { pushEnvelope, pushToCss, type PushSpec } from "./lib/push";
import {
  cropClipPath,
  resolveCrop,
  type CropSpec,
  type ResolvedCrop,
} from "./lib/crop";
import {
  KeycapHUD,
  KEYCAP_BOTTOM_FRAMED,
  KEYCAP_SCALE_FRAMED,
  KEYCAP_GROUND_FRAMED,
} from "./KeycapHUD";
import type { ReelLook } from "./lib/look";
import {
  resolveStylePreset,
  type ReelStyle,
  type ShotStyle,
  type WindowSpec,
} from "./lib/style";
import {
  aspectMagnification,
  cachedFollow,
  clampView,
  coverScale,
  cropPoint,
  cropRect,
  followAt,
  footageBounds,
  isNativeAspect,
  plateTransform,
  visibleHalf,
  type Aspect,
  type Size,
  type View,
} from "./lib/aspect";
import { openAt, openFrames, openPose, type ResolvedOpen } from "./lib/open";

/**
 * Where the footage starts, in frames of SOURCE time at the composition fps —
 * fractional on purpose. The recorder measures trimBeforeMs to the ms and
 * every click time is relative to it; rounding it to a whole 30fps frame put
 * the footage up to 16.7ms off the cursor, ripples and camera (measured on the
 * 20 logs in public/: mean 7.6ms, max 13.3ms). <Video> takes a fractional
 * trimBefore: @remotion/media seeks to t * rate + trimBefore / fps, and the
 * <OffthreadVideo> fallback's Sequence offset is linear in it too.
 */
const trimFrames = (log: ClickLog, fps: number): number | undefined =>
  log.trimBeforeMs ? (log.trimBeforeMs / 1000) * fps : undefined;

export type DemoClipProps = {
  name: string;
  /** Output frame rate (DEMO_FPS); absent = FPS. Read by src/Root.tsx. */
  fps?: number;
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
   * scripts/render.ts does not pass it, so out/demo/<name>.mp4 is unaffected — see
   * driftPose in src/lib/zoom.ts, which returns its argument by reference when
   * this is unset.
   */
  drift?: number;
  /**
   * Which studio backdrop to float the window on. A name from BACKDROPS, or a
   * filename you dropped in public/backdrops/. Defaults to "glaze".
   */
  backdrop?: string;
  /**
   * Visual treatment. Absent or "framed" keeps every prop above meaningful and
   * renders exactly as before; "fullbleed" ignores `chrome`, `drift` and
   * `backdrop` and takes the `crop`/`push` path instead.
   */
  look?: ReelLook;
  /** Choreography grammar; supersedes `look`. See src/lib/style.ts. */
  /** A brand pack id (src/lib/brand.ts): the window's flat ground comes from it. */
  brand?: string;
  /** The reel's window, over the style and the brand: its ground and where its camera works. */
  window?: WindowSpec;
  /**
   * The camera shutter. false: every frame is drawn once, at its own time, for
   * a machine without a GPU (a house's render.motionBlur). Absent = on.
   */
  motionBlur?: boolean;
  style?: ReelStyle;
  /**
   * Static framing for the full-bleed look. Either a camera (`k` about
   * `cx`/`cy`, then `dx`/`dy`) or a component box (`rect` + `fill`, which
   * derives all four) — see src/lib/crop.ts for which to reach for.
   *
   * Deliberately NOT animated. The reference film picks one framing per shot and
   * never moves it — measured, the gap between tracked edges is identical on the
   * first and last frame of every shot. That is also why transform-origin is
   * safe here where poseToCss avoids it: the singularity at scale 1 only shows
   * up when the scale is changing.
   */
  crop?: CropSpec;
  /** Entrance/exit push envelope. Full-bleed only; absent = no move. */
  push?: PushSpec;
  /**
   * Absolute frame range this render covers, so the push knows where the shot
   * starts and ends. reel.ts passes the same numbers it gives `--frames`.
   * Absent = the whole composition.
   */
  range?: { first: number; last: number };
  /** Colour behind the plate, if the crop leaves any gap. */
  pageBg?: string;
  /**
   * Draw the synthetic pointer. Honoured on BOTH paths.
   *
   * Framed: absent = the style's `shot.cursor` (on for every windowed style).
   * Full-bleed: absent = OFF — the reference film has no cursor anywhere and
   * announces interaction with a keycap instead.
   */
  cursor?: boolean;
  /**
   * Draw the pointer's click ripple. Honoured on BOTH paths.
   *
   * Framed: absent = the style's `shot.ripple` — ON for the zoom-camera
   * grammar, which predates the reference and whose every demo cut carries one
   * (flipping it would silently restyle the back catalogue), OFF for the
   * flat-ground one, whose preset asks for none. Full-bleed:
   * absent = OFF; the reference films draw no ripple. See src/Cursor.tsx.
   */
  ripple?: boolean;
  /**
   * Hold this shot's LAST frame for the shot's whole length: a still.
   *
   * The reference film gives one shot in eleven this treatment — 95 frames on
   * which not a single pixel crosses the motion threshold, placed immediately
   * before the recap. It is the film's held breath, and it is what stops a
   * metronomic cut rate reading as a conveyor belt.
   *
   * `range` supplies the length and the picture: the frames are counted from
   * `first`..`last` as usual, and every one of them shows `last`. That is why
   * this is a boolean and not a timestamp — a still of a range's final state
   * cannot drift out of sync with the range.
   *
   * Full-bleed only, and it suppresses the pointer: a cursor sitting on a
   * frozen frame reads as a dropped render, not as a hold.
   */
  freeze?: boolean;
  /**
   * Output aspect. Absent or "16:9" renders the footage's own shape, exactly as
   * before; "1:1" and "9:16" render a moving crop of it that follows the
   * clicks. The composition's SIZE comes from this too (src/Root.tsx). See
   * src/lib/aspect.ts.
   */
  aspect?: Aspect;
  /**
   * The first frame's framing, eased into the style's own over the camera's
   * move time. Needs `range` to know where the shot starts. See src/lib/open.ts.
   */
  open?: ResolvedOpen;
};

/** The opening, with the frame its shot starts on, or undefined. */
const openOf = (
  props: DemoClipProps,
): { pose: ResolvedOpen; first: number } | undefined =>
  props.open ? { pose: props.open, first: props.range?.first ?? 0 } : undefined;

/** A CSS camera state back to the content-space pose poseToCss made it from. */
const cssToPose = (
  z: { scale: number; translateX: number; translateY: number },
  chromeFrac: number,
  fit: number,
): CameraPose => ({
  scale: z.scale / fit,
  cx: 0.5 - z.translateX / z.scale,
  cy: groupToContentY(0.5 - z.translateY / z.scale, chromeFrac),
});

/**
 * The camera, as a function of frame, for the window group. Shared by the
 * shadow group, the window group and the shutter's sample-count decision, so
 * all three read one camera.
 *
 * `drift` is read HERE and nowhere else, on purpose. ShadowGroup and WindowGroup
 * both go through this hook, so they cannot disagree about the camera. If one
 * group read the prop and the other did not, the shadow would separate from the
 * window by up to a few percent of scale during a long hold — a halo that only
 * appears on drifting clips, so a smoke test would never catch it. The parameter
 * is required rather than defaulted so tsc forces every call site to change.
 */
function useCameraAt(
  chrome: boolean,
  log: ClickLog,
  speed: number,
  drift: number | undefined,
  /** The style's shot group, for its float size, whether the camera runs and where. */
  shot: CameraShot,
  /**
   * The clip's opening pose and the frame its shot starts on. Read HERE for the
   * same reason `drift` is: the shadow, the window and the shutter must all
   * see one camera, or the shadow separates from the window on the opening.
   */
  open: { pose: ResolvedOpen; first: number } | undefined,
) {
  const { fps, height } = useVideoConfig();
  const chromeH = CHROME_H * useDesignScale();
  // Fraction of the WINDOW GROUP (chrome + footage) that the chrome occupies —
  // not of the composition. The group is chromeH taller than the frame so the
  // footage keeps its aspect, so the denominator has to include the chrome.
  // Scale cancels here (both terms scale together), which is the point.
  const chromeFrac = chrome ? chromeH / (height + chromeH) : 0;
  // The style's float size, falling back to the constant every framed reel
  // rendered against before `windowFit` was wired through.
  const windowFit = shot.windowFit ?? WINDOW_FIT;
  // Under an `inside` camera the window holds at its fit and the camera works
  // within it, so it is framed for a window that IS its whole view (fit 1)
  // with focus framing (FrameGeometry.focus): typing punches on its field, a
  // panel that opens is shown whole. The app is magnified windowFit x S.
  const inside = shot.camera === "inside";
  const fit = inside ? 1 : windowFit;
  const held = poseToCss(BASE_POSE, chromeFrac, windowFit);
  const styleAt = (frame: number) =>
    shot.zoom
      ? zoomAt(frame, fps, log, { chromeFrac, speed, fit, drift, ...(inside ? { focus: true } : {}) })
      : // A CONSTANT POSE. Not `zoomAt` with the drift zeroed — that still
        // tracks the pointer and magnifies on every press. This holds the panel
        // at `fit` for the whole shot, so the only thing that moves it is its
        // own envelope.
        poseToCss(BASE_POSE, chromeFrac, fit);
  // The window's pose, and the app's within it (null: the app moves with the
  // window). Either way exactly one of them carries the camera.
  const split = (
    cameraAt: (frame: number) => CssPose,
  ): {
    poseAt: (frame: number) => CssPose;
    innerAt: ((frame: number) => CssPose) | null;
    chromeH: number;
  } =>
    inside
      ? { poseAt: () => held, innerAt: cameraAt, chromeH }
      : { poseAt: cameraAt, innerAt: null, chromeH };
  if (!open) return split(styleAt);
  // The opening, eased into the style's own camera. CENTRED on its target
  // within the render's own pan clamp (poseToCss: panLimit on the pose scale),
  // not the keyframes' tighter effective-scale rule, which put a corner control
  // on the frame's corner. The window shows content at fit * S of the frame,
  // which is what the target's margin is judged against. See openPose.
  const running0 = cssToPose(styleAt(open.first), chromeFrac, fit);
  const start = openPose(open.pose, running0, { viewScale: (s) => fit * s });
  const frames = openFrames(open.pose, start, running0, log.viewport, speed, fps);
  const cameraAt = (frame: number) =>
    frame - open.first >= frames
      ? styleAt(frame)
      : poseToCss(
          openAt(
            start,
            cssToPose(styleAt(frame), chromeFrac, fit),
            frame - open.first,
            frames,
          ),
          chromeFrac,
          fit,
        );
  return split(cameraAt);
}

/** What the camera reads off a style's shot group. */
type CameraShot = Pick<ShotStyle, "windowFit" | "zoom" | "camera">;
type CssPose = ReturnType<typeof poseToCss>;

/** A CSS camera pose as a transform: pan about the centre, then scale. See poseToCss. */
const poseTransform = (z: CssPose): string =>
  `translate(${z.translateX * 100}%, ${z.translateY * 100}%) scale(${z.scale})`;

/**
 * Camera pose for this frame, plus the wrapper style that positions the window
 * group under it. Shared by the shadow group and the window group so the two
 * stay locked together despite living on opposite sides of the shutter.
 *
 * Must be called inside each of them rather than lifted to DemoClip:
 * ShutterBlur re-renders its subtree at sample times, and only a
 * useCurrentFrame() call *inside* that subtree sees them.
 */
function useCameraGroup(
  chrome: boolean,
  log: ClickLog,
  speed: number,
  drift: number | undefined,
  shot: CameraShot,
  open: { pose: ResolvedOpen; first: number } | undefined,
) {
  const frame = useCurrentFrame();
  const { poseAt, innerAt, chromeH } = useCameraAt(chrome, log, speed, drift, shot, open);
  const z = poseAt(frame);
  const inner = innerAt ? innerAt(frame) : null;

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
    transform: poseTransform(z),
    position: "relative",
    willChange: "transform",
  };
  return { z, inner, style };
}

/**
 * The footage, holding its LAST frame once the recording runs out.
 *
 * The composition can run past the recording so the camera lands back at base
 * (src/lib/demo-duration.ts). What <Video> draws past its end is undocumented:
 * @remotion/media 4.0.506 clamps a late timestamp to the last sample of the
 * keyframe bank it lands in, and returns `null` — a cleared canvas, a blank
 * window — when it finds no bank. So the clock is pinned instead: past the
 * last frame inside the recording, the child sees that frame. No black, no
 * loop, whatever the decoder does. Reads useCurrentFrame() itself so it nests
 * under the shutter's and the full-bleed still's own <Freeze>.
 */
const HeldFootage: React.FC<{
  log: ClickLog;
  speed: number;
  children: React.ReactNode;
}> = ({ log, speed, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const last = footageFrames(log, speed, fps) - 1;
  return (
    <Freeze frame={last} active={frame > last}>
      {children}
    </Freeze>
  );
};

/**
 * The window's shadow, tracking the camera but drawn outside the shutter.
 * See RimLight for why it cannot live with the window.
 */
const ShadowGroup: React.FC<DemoClipProps> = (props) => {
  const { log, chrome = false, speed = 1, drift, backdrop } = props;
  const { style } = useCameraGroup(
    chrome,
    log,
    speed,
    drift,
    resolveStylePreset(props).shot,
    openOf(props),
  );
  // The preset's flat ground, when it has one, wins over the backdrop image.
  // See resolveGround for the one rule every composition shares.
  const { light } = resolveGround({
    ground: resolveStylePreset(props).shot.ground,
    ownBackdrop: backdrop,
  });
  return (
    // Unclipped: a push that scales the panel scales this box too, and its edge
    // would cut the shadow's blur flat. See Stage.
    <Stage clip={false}>
      <div style={style}>
        <RimLight light={light} />
      </div>
    </Stage>
  );
};

/**
 * Window + footage. Must call useCurrentFrame() itself (via useCameraGroup) so
 * ShutterBlur can sample neighbouring frames with a real camera pose on each
 * sample.
 */
const WindowGroup: React.FC<DemoClipProps> = (props) => {
  const { name, log, chrome = false, speed = 1, drift } = props;
  const { shot } = resolveStylePreset(props);
  const { z, inner, style } = useCameraGroup(
    chrome,
    log,
    speed,
    drift,
    shot,
    openOf(props),
  );
  const hostLabel = name.replace(/-/g, ".");
  return (
    <Stage>
      <div style={style}>
        <WindowFrame chrome={chrome} hostLabel={hostLabel}>
          {inner ? <InsideShutter {...props} /> : <AppLayer {...props} cameraScale={z.scale} />}
        </WindowFrame>
      </div>
    </Stage>
  );
};

/**
 * The footage and the pointer, as the camera's subject. Reads useCurrentFrame()
 * itself so a shutter sample sees its own time.
 */
const AppLayer: React.FC<DemoClipProps & { cameraScale: number }> = (props) => {
  const { name, log, speed = 1, cameraScale } = props;
  const { shot } = resolveStylePreset(props);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The style's own pointer settings unless the clip overrides them. The demo
  // grammar says cursor + ripple, so every demo renders exactly as before; the
  // flat-ground grammar says no ripple, which its reels asked for and never got.
  const cursor = props.cursor ?? shot.cursor;
  const ripple = props.ripple ?? shot.ripple;
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
  return (
    <>
      <HeldFootage log={log} speed={speed}>
        <Video
          src={staticFile(`${name}.mp4`)}
          trimBefore={trimFrames(log, fps)}
          playbackRate={speed}
          objectFit="fill"
          style={{ width: "100%", height: "100%" }}
        />
      </HeldFootage>
      {/*
        Drawn over the footage, inside the camera transform. No-ops on
        logs without a cursorTrack — those have the pointer baked into the
        recording already.
      */}
      {cursor ? (
        <Cursor
          log={log}
          timeS={timeS}
          cameraScale={cameraScale}
          ripple={ripple}
          speed={speed}
        />
      ) : null}
    </>
  );
};

/**
 * The `inside` camera's shutter: around the app alone, inside a window that
 * holds still. Every sample is the opaque app filling the window, so it can
 * AVERAGE its samples (see ShutterBlur's `blend`) instead of summing them: a
 * hold renders the footage's own colours, where the summed shutter rounds every
 * channel to a multiple of 8 and turned the app's warm greys pink.
 */
const InsideShutter: React.FC<DemoClipProps> = (props) => {
  const { log, chrome = false, speed = 1, drift } = props;
  const { shot } = resolveStylePreset(props);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { innerAt } = useCameraAt(chrome, log, speed, drift, shot, openOf(props));
  const half = shutterFraction() / 2;
  // The app's corners travel across a window held at its fit.
  const k = shot.windowFit ?? WINDOW_FIT;
  const travel = innerAt
    ? cornerTravelPx(innerAt(Math.max(0, frame - half)), innerAt(frame + half), width * k, height * k)
    : 0;
  if (props.motionBlur === false) return <InsideApp {...props} />;
  return (
    <ShutterBlur groups={groupsFor(travel)} blend="average">
      <InsideApp {...props} />
    </ShutterBlur>
  );
};

/** One sample of the app under the `inside` camera. */
const InsideApp: React.FC<DemoClipProps> = (props) => {
  const { log, chrome = false, speed = 1, drift } = props;
  const { shot } = resolveStylePreset(props);
  const frame = useCurrentFrame();
  const { poseAt, innerAt } = useCameraAt(chrome, log, speed, drift, shot, openOf(props));
  if (!innerAt) return null;
  const inner = innerAt(frame);
  return (
    // Laid out at the window group's own size, so the pose's percentages mean
    // what they mean on the window group.
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: poseTransform(inner),
        willChange: "transform",
      }}
    >
      <AppLayer {...props} cameraScale={poseAt(frame).scale * inner.scale} />
    </div>
  );
};

/**
 * Keyboard hint for the framed look, drawn OUTSIDE the shutter.
 *
 * It used to sit in WindowGroup as a Stage sibling, which kept it off the camera
 * transform but not out of the shutter: every one of the 8 samples drew it, at
 * 1/8 opacity with plus-lighter, over a translucent ground — the stacked-soft-
 * composite banding the rule in src/WindowFrame.tsx forbids. Its own frame clock
 * is `frame` itself, which the centred shutter's samples average to, so the pill
 * and the footage agree about when a chord was pressed.
 *
 * Frame-fixed, but KEYCAP_BOTTOM_FRAMED is tuned to land it INSIDE the window's
 * lower edge at the resting framing, not down on the backdrop. No-ops until a
 * flow records a chord.
 */
const FramedKeycap: React.FC<DemoClipProps> = ({ log, speed = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!log.keys?.length) return null;
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
  return (
    <KeycapHUD
      keys={log.keys}
      timeS={timeS}
      speed={speed}
      bottom={KEYCAP_BOTTOM_FRAMED}
      scale={KEYCAP_SCALE_FRAMED}
      ground={KEYCAP_GROUND_FRAMED}
    />
  );
};

/**
 * The window group under a centred shutter, with as many samples as this
 * frame's camera speed needs.
 *
 * The count is decided HERE, outside the samples, from the camera the samples
 * will draw: how far the window's fastest corner travels while the shutter is
 * open. See groupsFor for why it moves in whole groups of 8.
 */
const ShutteredWindow: React.FC<DemoClipProps> = (props) => {
  const { log, chrome = false, speed = 1, drift } = props;
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { poseAt, chromeH } = useCameraAt(
    chrome,
    log,
    speed,
    drift,
    resolveStylePreset(props).shot,
    openOf(props),
  );
  const half = shutterFraction() / 2;
  const travel = cornerTravelPx(
    poseAt(Math.max(0, frame - half)),
    poseAt(frame + half),
    width,
    height + (chrome ? chromeH : 0),
  );
  return (
    <ShutterBlur groups={groupsFor(travel)}>
      <WindowGroup {...props} />
    </ShutterBlur>
  );
};

/**
 * The static crop, as a CSS transform.
 *
 * Pan THEN scale, as two independent knobs. Origin-scale alone cannot frame an
 * off-centre component: a point at content fraction p lands at cx + (p - cx)k,
 * so at the k≈1.25 our source resolution allows, the furthest anything can move
 * is ~6% of frame width. The reference's crops are strong magnifications where
 * that is enough; ours are not, so the translate is what actually does the
 * framing.
 *
 * A FUNCTION, not an inline style, because two layers must carry the identical
 * transform — the footage and the pointer. <Cursor> positions its hotspot in
 * percentages of its own parent, so the only thing that maps a viewport
 * coordinate onto the cropped footage is its parent carrying this exact
 * transform. Inline it in one place and the arrow silently drifts off its
 * target by the pan distance.
 */
const cropToCss = (
  crop: ResolvedCrop | undefined,
): React.CSSProperties | undefined =>
  crop
    ? {
        transform: `translate(${crop.dx * 100}%, ${crop.dy * 100}%) scale(${crop.k})`,
        transformOrigin: `${crop.cx * 100}% ${crop.cy * 100}%`,
      }
    : undefined;

/**
 * The full-bleed treatment: one static crop of the footage filling the frame,
 * moved only by the push envelope.
 *
 * What is deliberately absent is the whole point — no window frame, no corner
 * radius, no rim light, no backdrop plate and no zoom track. Measured off the
 * reference film: all four frame corners sample the app's own page background,
 * and no shot changes scale between its first and last frame.
 *
 * No CameraMotionBlur either. The fastest measured move in the reference is
 * ~34px/frame, an order below where a shutter earns its render cost, and the
 * blur is destructive to flat UI colour (see the banding note in WindowFrame).
 */
const FullBleedClip: React.FC<DemoClipProps> = (props) => {
  const { log, speed = 1, crop, push, range, pageBg = "#fcfcfc", open } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const designScale = useDesignScale();

  const first = range?.first ?? 0;
  const shotFrames = range ? range.last - range.first + 1 : durationInFrames;
  const envelope = pushEnvelope(frame - first, shotFrames, push);

  // Same time base the cursor uses, so a keycap and a pointer cannot disagree
  // about when a beat happened.
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
  const k = resolveCrop(crop)?.k ?? 1;

  let picture = <CroppedFootage {...props} timeS={timeS} cameraScale={k} />;
  if (open) {
    // The opening, as a camera over the CROPPED frame: `scale` is in the crop's
    // own units, so the push past the crop is scale / k, about the opening
    // point wherever the crop put it. poseToCss's clamp keeps the frame edge
    // inside the picture. A layer only when there is an opening, so every clip
    // without one renders exactly as it did.
    const resolved = resolveCrop(crop);
    const start = openPose(
      {
        ...open,
        scale: open.scale / k,
        at: cropPoint(open.at, resolved),
        ...(open.rect ? { rect: cropRect(open.rect, resolved) } : {}),
      },
      BASE_POSE,
    );
    const frames = openFrames(open, start, BASE_POSE, log.viewport, speed, fps);
    const css = poseToCss(openAt(start, BASE_POSE, frame - first, frames), 0, 1);
    picture = (
      <AbsoluteFill
        style={{
          transform: `translate(${css.translateX * 100}%, ${css.translateY * 100}%) scale(${css.scale})`,
        }}
      >
        <CroppedFootage {...props} timeS={timeS} cameraScale={k * css.scale} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: pageBg }}>
      <AbsoluteFill
        style={{
          transform: pushToCss(envelope, designScale),
          willChange: "transform",
        }}
      >
        {picture}
      </AbsoluteFill>
      {/*
        Outside the push wrapper above, deliberately: the reference's keycap
        holds a fixed frame position while the footage slides under it.
      */}
      {log.keys?.length ? (
        <KeycapHUD keys={log.keys} timeS={timeS} speed={speed} />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * The full-bleed picture: the footage under its static crop, and the pointer
 * under the same crop. Two sibling layers, no wrapper of its own, so it drops
 * into the native frame and into an aspect plate alike.
 *
 * `cameraScale` is every magnification ABOVE the pointer — the crop's k, and
 * at another aspect the plate's cover and the follow's zoom — which <Cursor>
 * counter-scales to k^CURSOR_SCALE_EXP.
 */
const CroppedFootage: React.FC<
  DemoClipProps & { timeS: number; cameraScale: number }
> = ({
  name,
  log,
  speed = 1,
  crop,
  range,
  cursor = false,
  ripple,
  freeze = false,
  timeS,
  cameraScale,
}) => {
  const { fps } = useVideoConfig();
  const trimBefore = trimFrames(log, fps);
  const resolved = resolveCrop(crop);
  // The clip-path rides on the SAME layers as the transform, and both the
  // footage and the pointer get it: an arrow travelling outside the framed
  // component would otherwise glide across a flat ground with no UI under it.
  const clipPath = cropClipPath(crop);
  const cropStyle = { ...cropToCss(resolved), ...(clipPath ? { clipPath } : {}) };

  const footage = (
    <HeldFootage log={log} speed={speed}>
      <Video
        src={staticFile(`${name}.mp4`)}
        trimBefore={trimBefore}
        playbackRate={speed}
        objectFit="cover"
        style={{ width: "100%", height: "100%" }}
      />
    </HeldFootage>
  );

  return (
    <>
      <AbsoluteFill style={cropStyle}>
        {/*
          <Freeze> pins the child's clock, which is the only thing that
          reaches <Video> — there is no "show frame N" prop to set. Wrapping
          the footage alone (rather than the whole shot) keeps the push
          envelope live above it, so a still can still be authored to arrive
          on a move if a reel ever wants that. This one does not.
        */}
        {freeze && range ? (
          <Freeze frame={range.last}>{footage}</Freeze>
        ) : (
          footage
        )}
      </AbsoluteFill>
      {cursor && !freeze ? (
        /*
          The crop again, on a layer of its own, INSIDE the push wrapper. The
          pointer is part of the picture: it has to land on the control it is
          pressing, so it shares the footage's crop AND its push. It used to
          sit outside the push like the keycap, and for the 12-15 frames at
          each end of a shot the UI slid up to 114 px under a pointer that
          stayed put — an arrow skating off its target. Only the keycap is a
          caption; only the keycap holds still.
          Nesting it under the crop is also what makes CURSOR_SCALE_EXP mean
          what it says. The wrapper multiplies the arrow by k and <Cursor>
          divides by k^(1 - exp), leaving k^exp — the sub-linear growth the
          framed look already gets from living inside its camera transform. As
          a bare sibling the multiply was missing and the arrow SHRANK as the
          crop tightened.
        */
        <AbsoluteFill style={cropStyle}>
          <Cursor
            log={log}
            timeS={timeS}
            cameraScale={cameraScale}
            ripple={ripple ?? false}
            speed={speed}
          />
        </AbsoluteFill>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Other aspects: a moving crop of the footage (src/lib/aspect.ts)
// ---------------------------------------------------------------------------

/**
 * The view of the plate at this frame: the follow's centre, the zoom camera's
 * magnification past what the aspect already gives, and the opening eased
 * into both. Clamped so the plate always covers `box`.
 *
 * WHY THE CAMERA ONLY LENDS ITS SCALE. The zoom track is framed for a 16:9
 * window: frameFor pulls a subject near an edge toward the centre so the
 * window's edge stays out of shot. A narrow crop needs the opposite — the
 * subject itself — so the centre comes from the click rects (followTrack) and
 * the camera contributes only how tight it is. And only past the aspect's own
 * magnification: a 9:16 crop is already 1.78x the 16:9 picture, more than
 * every punch but S_MAX's 1.74, so at 9:16 the camera's job is to follow and at
 * 1:1 (1.00x) it punches as it always has.
 */
function useAspectView(
  props: DemoClipProps,
  box: Size,
  crop: ReturnType<typeof resolveCrop>,
  /** The style camera's pose scale at a frame; 1 = no camera. */
  cameraScale: (frame: number) => number,
): { view: View; s: number; plate: Size } {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const { log, speed = 1, open, range, freeze } = props;
  const plate = demoSize(log);
  const s = coverScale(box, plate);
  const mag = aspectMagnification(plate, { width, height });
  const half = visibleHalf(box, plate);
  const follow = cachedFollow(log, {
    fps,
    speed,
    frames: durationInFrames,
    half,
    crop,
  });
  const running = (f: number): View => {
    const c = followAt(follow, f);
    return { scale: Math.max(1, cameraScale(f) / mag), cx: c.x, cy: c.y };
  };
  // A still holds its last frame; the crop holds with it.
  const f = freeze && range ? range.last : frame;
  let view = running(f);
  if (open) {
    const first = range?.first ?? 0;
    const k = crop?.k ?? 1;
    const run0 = running(first);
    const p = cropPoint(open.at, crop);
    // An opening's scale is in the 16:9 framing's units; the aspect and the
    // crop already supply mag * k of it.
    const start = {
      scale: Math.max(1, open.scale / (mag * k), run0.scale),
      cx: p.x,
      cy: p.y,
    };
    const frames = openFrames(open, start, run0, log.viewport, speed, fps);
    view = openAt(start, view, f - first, frames);
  }
  return { view: clampView(view, half, footageBounds(crop)), s, plate };
}

/**
 * The 16:9 plate, centred in its parent and moved by `transform`. Whatever is
 * inside is laid out exactly as the native cut lays it out.
 */
const PlateView: React.FC<{
  plate: Size;
  transform: string;
  children: React.ReactNode;
}> = ({ plate, transform, children }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        width: plate.width,
        height: plate.height,
        transform,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
);

/** Full-bleed at another aspect: the frame IS the box. */
const AspectBleed: React.FC<DemoClipProps> = (props) => {
  const { log, speed = 1, crop, push, range, pageBg = "#fcfcfc" } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const designScale = useDesignScale();
  const first = range?.first ?? 0;
  const shotFrames = range ? range.last - range.first + 1 : durationInFrames;
  const envelope = pushEnvelope(frame - first, shotFrames, push);
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
  const resolved = resolveCrop(crop);
  const { view, s, plate } = useAspectView(props, { width, height }, resolved, () => 1);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: pageBg }}>
      <AbsoluteFill
        style={{
          transform: pushToCss(envelope, designScale),
          willChange: "transform",
        }}
      >
        <PlateView plate={plate} transform={plateTransform(view, plate, s)}>
          <CroppedFootage
            {...props}
            timeS={timeS}
            cameraScale={(resolved?.k ?? 1) * s * view.scale}
          />
        </PlateView>
      </AbsoluteFill>
      {log.keys?.length ? (
        <KeycapHUD keys={log.keys} timeS={timeS} speed={speed} />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * A windowed style at another aspect: the window takes the frame's shape.
 *
 * THE FRAMING CHOICE. The window stays `windowFit` of the frame on both axes,
 * exactly the rule it follows at 16:9 — so at 9:16 it is a tall panel, and the
 * footage inside is a moving crop of the recording at full panel height. The
 * alternatives, by the arithmetic at 1440x2560: the whole 16:9 window fitted
 * to the frame's width is 1238x696 — 23% of the frame, its UI at 0.56x the
 * 16:9 cut's size; a square 1238 window still leaves 58% of the frame to the
 * backdrop. The panel
 * keeps the grammar — ground, rim light, rounded window, the style's own push —
 * and gives the product the frame.
 *
 * No shutter: its job is the zoom camera's fast punches, and here the camera
 * only lends magnification to a crop that moves at follow speed (see
 * useAspectView). No chrome either; a reel never draws it.
 */
const AspectWindow: React.FC<DemoClipProps> = (props) => {
  const { name, log, speed = 1, drift } = props;
  const { shot } = resolveStylePreset(props);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fit = shot.windowFit ?? WINDOW_FIT;
  const box = { width: width * fit, height: height * fit };
  const { view, s, plate } = useAspectView(props, box, undefined, (f) =>
    shot.zoom ? zoomAt(f, fps, log, { speed, fit, drift }).scale / fit : 1,
  );
  const { light } = resolveGround({ ground: shot.ground, ownBackdrop: props.backdrop });
  const cursor = props.cursor ?? shot.cursor;
  const ripple = props.ripple ?? shot.ripple;
  const trimBefore = trimFrames(log, fps);
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
  const panel: React.CSSProperties = {
    position: "absolute",
    width: box.width,
    height: box.height,
    left: (width - box.width) / 2,
    top: (height - box.height) / 2,
  };
  return (
    <AbsoluteFill>
      <Backdrop name={props.backdrop} ground={shot.ground} />
      <FramedPush {...props}>
        <div style={panel}>
          <RimLight light={light} />
        </div>
        <div style={panel}>
          <WindowFrame>
            <PlateView plate={plate} transform={plateTransform(view, plate, s)}>
              <HeldFootage log={log} speed={speed}>
                <Video
                  src={staticFile(`${name}.mp4`)}
                  trimBefore={trimBefore}
                  playbackRate={speed}
                  objectFit="fill"
                  style={{ width: "100%", height: "100%" }}
                />
              </HeldFootage>
              {cursor ? (
                <Cursor
                  log={log}
                  timeS={timeS}
                  cameraScale={s * view.scale}
                  ripple={ripple}
                  speed={speed}
                />
              ) : null}
            </PlateView>
          </WindowFrame>
        </div>
        <FramedKeycap {...props} />
      </FramedPush>
    </AbsoluteFill>
  );
};

/**
 * Any aspect but the footage's own. Everything under it is laid out against
 * the NATIVE width (DesignWidthContext), so the pointer, the keycap, the window
 * radius and every push distance are the same pixel size as in the 16:9 cut —
 * the frame is only taller or narrower.
 */
const AspectClip: React.FC<DemoClipProps> = (props) => {
  const { shot } = resolveStylePreset(props);
  return (
    <DesignWidthContext.Provider value={demoSize(props.log).width}>
      {shot.framing === "window" ? (
        <AspectWindow {...props} />
      ) : (
        <AspectBleed {...props} />
      )}
    </DesignWidthContext.Provider>
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

  // Dispatch before anything else: the full-bleed path shares no layer with the
  // framed one, so branching here keeps each readable instead of threading
  // conditionals through Stage, WindowFrame and the shutter.
  //
  // On the style's FRAMING, not its name — so a future grammar picks a path by
  // saying which framing it uses. `isolate` (src/lib/crop.ts) renders down the
  // full-bleed path too: it is a crop with a clip-path, not a third layer stack.
  // Another aspect is a moving crop of the footage, windowed or not, and
  // shares no layer with either native path. Native renders exactly as before.
  if (!isNativeAspect(props.aspect)) return <AspectClip {...props} />;
  const { shot } = resolveStylePreset(props);
  if (shot.framing !== "window") return <FullBleedClip {...props} />;

  return (
    <AbsoluteFill>
      {/*
        The ground does NOT move. Only the panel does — which is the whole
        point of a flat-ground grammar: the stage stays put and elements enter
        and leave it. So the backdrop sits outside the push wrapper below.
      */}
      <Backdrop name={props.backdrop} ground={resolveStylePreset(props).shot.ground} />
      <FramedPush {...props}>
        {/*
          Shadow first, and deliberately NOT inside the shutter below: stacking
          semi-transparent copies quantises a soft gradient into rings. It carries
          the same camera transform, so it still tracks the window exactly.
        */}
        <ShadowGroup {...props} chrome={chrome} />
        {/*
          The shutter, but ONLY when there is a camera to blur.

          ShutterBlur renders N copies of its subtree and composites them at
          fractional opacity, and every composite rounds to 8 bits — the
          banding measurement in src/WindowFrame.tsx is the same mechanism. When
          the style's camera is off (`shot.zoom: false`) every one of those 8
          samples is the SAME pose, so the blur cannot smear anything and all it
          contributes is eight rounds of quantisation over a picture that is
          already being upscaled. A camera-less shot's only movement is its
          enter/exit envelope, and that is applied by FramedPush OUTSIDE this
          subtree, so it is unaffected either way.

          Kept on through holds for every camera style: it samples identical
          poses there, but dropping to one sample would change the picture's
          quantisation and the first moving frame would flash (see groupsFor).
          The count only grows, a whole group at a time, on fast frames.
        */}
        {/*
          An `inside` camera keeps its own shutter, around the app alone
          (InsideShutter): the window does not move, so it needs none.
        */}
        {shot.zoom && shot.camera !== "inside" && props.motionBlur !== false ? (
          <ShutteredWindow {...props} chrome={chrome} />
        ) : (
          <WindowGroup {...props} chrome={chrome} />
        )}
        <FramedKeycap {...props} />
      </FramedPush>
    </AbsoluteFill>
  );
};

/**
 * The entrance/exit envelope, for the FRAMED path.
 *
 * `push` used to be full-bleed only, because the only grammar that moved its
 * shots was full-bleed. The Replit grammar moves a WINDOWED panel across a flat
 * ground and never cuts: its seams work by the panel clearing frame entirely so
 * that the cut lands on bare ground. That needs the envelope on this side too.
 *
 * RENDERS NOTHING WHEN THERE IS NO PUSH. `pushEnvelope` returns PUSH_REST for an
 * absent spec, and an identity transform still creates a stacking context and a
 * compositing layer — enough to shift sub-pixel rounding. Returning the children
 * untouched is what keeps every framed reel that predates this byte-identical.
 */
const FramedPush: React.FC<DemoClipProps & { children: React.ReactNode }> = ({
  push,
  range,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const designScale = useDesignScale();
  if (!push) return <>{children}</>;
  const first = range?.first ?? 0;
  const shotFrames = range ? range.last - range.first + 1 : durationInFrames;
  const envelope = pushEnvelope(frame - first, shotFrames, push);
  return (
    <AbsoluteFill style={{ transform: pushToCss(envelope, designScale) }}>
      {children}
    </AbsoluteFill>
  );
};
