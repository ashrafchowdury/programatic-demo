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
import { BASE_POSE, poseToCss } from "./lib/camera";
import { footageFrames } from "./lib/demo-duration";
import { CHROME_H, WINDOW_FIT } from "./lib/window";
import { resolveGround } from "./lib/backdrop";
import { Backdrop } from "./Backdrop";
import { Cursor } from "./Cursor";
import { ShutterBlur } from "./ShutterBlur";
import { cornerTravelPx, groupsFor, shutterFraction } from "./lib/shutter";
import { RimLight, Stage, useDesignScale, WindowFrame } from "./WindowFrame";
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
import { resolveStylePreset, type ReelStyle } from "./lib/style";

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
  /**
   * Visual treatment. Absent or "framed" keeps every prop above meaningful and
   * renders exactly as before; "fullbleed" ignores `chrome`, `drift` and
   * `backdrop` and takes the `crop`/`push` path instead.
   */
  look?: ReelLook;
  /** Choreography grammar; supersedes `look`. See src/lib/style.ts. */
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
};

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
  /** The style's shot group, for its float size and whether the camera runs. */
  shot: { windowFit: number | null; zoom: boolean },
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
  const fit = shot.windowFit ?? WINDOW_FIT;
  const poseAt = (frame: number) =>
    shot.zoom
      ? zoomAt(frame, fps, log, { chromeFrac, speed, fit, drift })
      : // A CONSTANT POSE. Not `zoomAt` with the drift zeroed — that still
        // tracks the pointer and magnifies on every press. This holds the panel
        // at `fit` for the whole shot, so the only thing that moves it is its
        // own envelope.
        poseToCss(BASE_POSE, chromeFrac, fit);
  return { poseAt, chromeH };
}

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
  shot: { windowFit: number | null; zoom: boolean },
) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { poseAt, chromeH } = useCameraAt(chrome, log, speed, drift, shot);
  const z = poseAt(frame);

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
  const { style } = useCameraGroup(chrome, log, speed, drift, resolveStylePreset(props).shot);
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
  // The style's own pointer settings unless the clip overrides them. The demo
  // grammar says cursor + ripple, so every demo renders exactly as before; the
  // flat-ground grammar says no ripple, which its reels asked for and never got.
  const cursor = props.cursor ?? shot.cursor;
  const ripple = props.ripple ?? shot.ripple;
  const { z, frame, fps, style } = useCameraGroup(chrome, log, speed, drift, shot);
  const trimBefore = log.trimBeforeMs
    ? round((log.trimBeforeMs / 1000) * fps)
    : undefined;
  const hostLabel = name.replace(/-/g, ".");
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;

  return (
    <Stage>
      <div style={style}>
        <WindowFrame chrome={chrome} hostLabel={hostLabel}>
          <HeldFootage log={log} speed={speed}>
            <Video
              src={staticFile(`${name}.mp4`)}
              trimBefore={trimBefore}
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
              cameraScale={z.scale}
              ripple={ripple}
            />
          ) : null}
        </WindowFrame>
      </div>
    </Stage>
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
const FullBleedClip: React.FC<DemoClipProps> = ({
  name,
  log,
  speed = 1,
  crop,
  push,
  range,
  pageBg = "#fcfcfc",
  cursor = false,
  ripple,
  freeze = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const designScale = useDesignScale();

  const first = range?.first ?? 0;
  const shotFrames = range ? range.last - range.first + 1 : durationInFrames;
  const envelope = pushEnvelope(frame - first, shotFrames, push);

  const trimBefore = log.trimBeforeMs
    ? round((log.trimBeforeMs / 1000) * fps)
    : undefined;
  // Same time base the cursor uses, so a keycap and a pointer cannot disagree
  // about when a beat happened.
  const timeS = (frame / fps) * speed - (log.offsetMs ?? 0) / 1000;
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
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: pageBg }}>
      <AbsoluteFill
        style={{
          transform: pushToCss(envelope, designScale),
          willChange: "transform",
        }}
      >
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
              cameraScale={resolved?.k ?? 1}
              ripple={ripple ?? false}
            />
          </AbsoluteFill>
        ) : null}
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
        {shot.zoom ? (
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
