import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { stepAt, type HudStep } from "./lib/hud";

/**
 * The step HUD, drawn on nothing.
 *
 * Renders with a TRANSPARENT ground on purpose: scripts/reel.ts composites this
 * onto the finished film with ffmpeg's `overlay`, because a layer that spans
 * segments cannot be baked into any one of them. Same shape as the audio pass.
 *
 * Why Remotion and not `drawtext`: this ffmpeg build has no drawtext (it needs
 * libfreetype), so burning text in was never an option — and rendering it here
 * gets the repo's own type and palette instead of whatever font ffmpeg found.
 *
 * The design is monid's, measured in choreography-references.md §3: small
 * monospace, letterspaced, sitting above the picture rather than in it. Its
 * job is to say what is happening now, so it holds a step until the next one
 * rather than blinking per beat.
 */
export type HudOverlayProps = {
  steps: HudStep[];
  /** Ink colour, from the style's palette. */
  ink: string;
  /** Total film length, so the last step can hold to the end. */
  totalS: number;
  /**
   * The film's size, when it is not 2560x1440 — src/Root.tsx sizes the
   * composition from it. A square or vertical reel passes its own.
   */
  size?: { width: number; height: number };
  /**
   * The width the 16:9 cut of this film has. Type is sized against it, so the
   * line is the same pixel size in every aspect. Absent = the frame's width.
   */
  designWidth?: number;
};

/** Fraction of frame height the line sits from the top. */
const TOP_FRAC = 0.072;
/**
 * Type size as a fraction of the 16:9 frame's width (`designWidth`), so it
 * survives any output size and any aspect.
 */
const SIZE_FRAC = 0.0135;
/** Seconds a step takes to fade in. Short — it is a label, not a reveal. */
const FADE_S = 0.18;

export const HudOverlay: React.FC<HudOverlayProps> = ({
  steps,
  ink,
  designWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const step = stepAt(steps, t);
  if (!step) return <AbsoluteFill />;

  // Fade on the STEP's own clock, so every step arrives the same way no matter
  // where it falls in the film.
  const since = t - step.startS;
  const opacity = Math.max(0, Math.min(1, since / FADE_S));
  const size = (designWidth ?? width) * SIZE_FRAC;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: `${TOP_FRAC * 100}%`,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: size * 0.9,
          opacity,
          color: ink,
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
          fontSize: size,
          fontWeight: 500,
          // Wide tracking is what makes a short monospace line read as a label
          // rather than as body text.
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ opacity: 0.55 }}>{step.index}</span>
        <span style={{ opacity: 0.55 }}>·</span>
        <span>{step.label}</span>
      </div>
    </AbsoluteFill>
  );
};
