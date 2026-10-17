import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from "remotion";
import { sampleFrames, shutterFraction, SHUTTER_ANGLE } from "./lib/shutter";

/**
 * A camera shutter CENTRED on the frame, drawn in whole groups of 8 samples.
 *
 * Replaces @remotion/motion-blur's CameraMotionBlur, which samples frame
 * +0.50…+0.94 and so draws its subtree ~0.72 frame later than anything outside
 * it — see src/lib/shutter.ts for the measurement and for why the count only
 * moves in whole groups.
 *
 * Compositing is the library's: each sample at `opacity(1/n)` with
 * `plus-lighter`, which sums premultiplied colour and so averages coverage
 * correctly at a moving edge (plain `over` would draw the union of every
 * sample's edge at full opacity). The groups are nested isolated layers, so
 * each flattens to 8 bits on its own before the outer average.
 *
 * Every sample layer is keyed by its slot, so a frame that stays on the same
 * group count re-renders the same <Video> instances at new times rather than
 * mounting new ones. Only the second group mounts and unmounts, and only on
 * frames fast enough to need it.
 */
export const ShutterBlur: React.FC<{
  /** Groups of 8 samples to draw; see groupsFor. */
  groups: number;
  shutterAngle?: number;
  /**
   * `sum` (default): the plus-lighter sum above, right for a subtree with
   * transparent edges, at the cost of N·round(v/N) on every colour: page white
   * renders 248 and a warm grey can land pink (#f2f0ee -> #f5ecef with the
   * product grade). `average`: a running average, sample i drawn OVER the
   * others at opacity 1/(i+1). Identical samples composite exactly (a hold is
   * the picture itself) and a moving frame is off by a level or two, but it is
   * only right when every sample is OPAQUE everywhere, as the app inside a
   * window that does not move is (see DemoClip's `inside` camera).
   */
  blend?: "sum" | "average";
  children: React.ReactNode;
}> = ({ groups, shutterAngle = SHUTTER_ANGLE, blend = "sum", children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const sets = sampleFrames(frame, groups, {
    fraction: shutterFraction(shutterAngle),
    lastFrame: durationInFrames - 1,
  });
  if (blend === "average")
    return (
      <AbsoluteFill>
        {sets.flat().map((t, i) => (
          <AbsoluteFill key={`sample-${i}`} style={i ? { opacity: 1 / (i + 1) } : undefined}>
            <Freeze frame={t}>{children}</Freeze>
          </AbsoluteFill>
        ))}
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {sets.map((times, g) => (
        <AbsoluteFill
          key={`group-${g}`}
          style={{
            mixBlendMode: "plus-lighter",
            filter: `opacity(${1 / sets.length})`,
            isolation: "isolate",
          }}
        >
          {times.map((t, i) => (
            <AbsoluteFill
              key={`sample-${i}`}
              style={{
                mixBlendMode: "plus-lighter",
                filter: `opacity(${1 / times.length})`,
              }}
            >
              <Freeze frame={t}>{children}</Freeze>
            </AbsoluteFill>
          ))}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};
