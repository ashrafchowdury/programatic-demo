import React from "react";
import {
  AbsoluteFill,
  Freeze,
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
import { pushEnvelope, pushToCss, type PushSpec } from "./lib/push";
import {
  cropClipPath,
  resolveCrop,
  type CropSpec,
  type ResolvedCrop,
} from "./lib/crop";
import { KeycapHUD } from "./KeycapHUD";
import type { ReelLook } from "./lib/look";
import { resolvePreset, type ReelStyle } from "./lib/style";

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
   * Draw the synthetic pointer. Defaults on for "framed", OFF for "fullbleed" —
   * the reference film has no cursor anywhere and announces interaction with a
   * keycap instead.
   */
  cursor?: boolean;
  /**
   * Draw the pointer's click ripple.
   *
   * Defaults ON for "framed" and OFF for "fullbleed". The reference films draw
   * no ripple and full-bleed reproduces them; framed predates the reference and
   * every demo cut so far carries one, so flipping it there would silently
   * restyle the whole back catalogue. See src/Cursor.tsx.
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
  ripple,
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
            ripple={ripple ?? true}
          />
        </WindowFrame>
      </div>
    </Stage>
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
    <Video
      src={staticFile(`${name}.mp4`)}
      trimBefore={trimBefore}
      playbackRate={speed}
      objectFit="cover"
      style={{ width: "100%", height: "100%" }}
    />
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
      </AbsoluteFill>
      {cursor && !freeze ? (
        /*
          The crop again, on a layer of its own — NOT the push wrapper above.
          The pointer has to survive two contradictory pulls: it must land on
          the control it is pressing, which means sharing the footage's crop,
          but it must not ride the push envelope, for the same reason the keycap
          below does not.
          Nesting it under the crop is also what makes CURSOR_SCALE_EXP mean
          what it says. The wrapper multiplies the arrow by k and <Cursor>
          divides by k^(1 - exp), leaving k^exp — the sub-linear growth the
          framed look already gets from living inside its camera transform. As a
          bare sibling the multiply was missing and the arrow SHRANK as the crop
          tightened.
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
      {/*
        Outside the push wrapper above, deliberately: the reference's keycap
        holds a fixed frame position while the footage slides under it.
      */}
      {log.keys?.length ? <KeycapHUD keys={log.keys} timeS={timeS} /> : null}
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
  if (resolvePreset(props).shot.framing !== "window")
    return <FullBleedClip {...props} />;

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
