import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { DESIGN_WIDTH } from "./lib/click-log";
import { CHROME_H, WINDOW_RADIUS } from "./lib/window";

/**
 * The floating window, and the light around it.
 *
 * Extracted from DemoClip so a still can wear the same frame. Nothing here
 * knows what is inside the window — DemoClip passes a <Video>, StillShot passes
 * an <Img> — which is the entire reason the split exists: the treatment IS the
 * product's visual identity, and two copies of it would drift.
 *
 * The pieces are separate because they sit on opposite sides of the motion
 * shutter. See RimLight for why that is not negotiable.
 */

/**
 * Every length below is written at DESIGN_WIDTH and multiplied by this at render.
 *
 * Without it the design is accidentally pinned to 1080p: raise the output to
 * 2560 and the shadow radii, cursor and corner radius all render at 75% of their
 * tuned size, which reads as a flatter, harder-edged window rather than a
 * higher-resolution one. Scaling them keeps the composition looking identical at
 * any output size — only the rasterisation gets finer.
 */
export const useDesignScale = (): number => useVideoConfig().width / DESIGN_WIDTH;

/** Centres a camera group in the frame. */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
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
export const RimLight: React.FC<{ light?: boolean }> = ({ light = false }) => {
  const k = useDesignScale();
  // On a LIGHT backdrop the white lift below has nothing to be brighter than,
  // so the window dissolves into the ground — the mirror of the cast shadow
  // that vanished on near-black. Cast a soft dark shadow instead. Safe because
  // this renders OUTSIDE the shutter; only gradients INSIDE it band.
  if (light)
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 60 * k,
            background: "rgba(30,20,10,0.30)",
            transform: "translateY(2.5%) scale(0.97, 0.96)",
            filter: `blur(${90 * k}px)`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: -k,
            borderRadius: (WINDOW_RADIUS + 1) * k,
            boxShadow: `0 0 0 ${k}px rgba(15,23,42,0.16)`,
            pointerEvents: "none",
          }}
        />
      </>
    );
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
 * The window itself: a rounded, clipped box with an optional macOS titlebar.
 *
 * `children` fill the content area below the chrome — footage in a clip, a
 * screenshot in a still. Only HARD edges live in here (the 1px inset highlight,
 * the titlebar's 1px border), because in a clip this subtree renders inside
 * <CameraMotionBlur>, where every soft falloff bands. See RimLight.
 */
export const WindowFrame: React.FC<{
  chrome?: boolean;
  /** Text for the fake URL pill. Only read when `chrome` is on. */
  hostLabel?: string;
  children: React.ReactNode;
}> = ({ chrome = false, hostLabel = "", children }) => {
  const k = useDesignScale();
  return (
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
        {children}
      </div>
    </div>
  );
};
