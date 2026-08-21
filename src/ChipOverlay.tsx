import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { settle } from "./lib/push";
import { chipsAt, type ReelChip } from "./lib/chips";
import type { AnnotationStyle } from "./lib/style";

/**
 * The floating chips, drawn on nothing.
 *
 * Renders with a TRANSPARENT ground on purpose: scripts/reel.ts composites this
 * onto the finished film with ffmpeg's `overlay`, because a layer that spans
 * segments cannot be baked into any one of them. Same shape as the audio pass
 * and the step HUD.
 *
 * Sized in FRACTIONS of the frame, never in pixels, so one authored placement
 * survives any output size.
 */
export type ChipOverlayProps = {
  chips: ReelChip[];
  style: AnnotationStyle;
  /** Total film length, so the overlay is as long as the picture it rides on. */
  totalS: number;
};

export const ChipOverlay: React.FC<ChipOverlayProps> = ({ chips, style }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const live = chipsAt(chips, t);
  if (live.length === 0) return <AbsoluteFill />;

  const pillH = height * style.heightFrac;

  return (
    <AbsoluteFill>
      {live.map((c) => {
        // A chip UNROLLS in place rather than travelling — see AnnotationStyle
        // for the reference mechanism this replaces and why.
        //
        // `p` is 1 when the pill is fully drawn. The entrance decelerates on
        // the film's own curve; the exit rolls back up faster, because nothing
        // here eases out.
        const inP = 1 - settle((t - c.fromS) / Math.max(style.wipeS, 1e-6));
        const outP = 1 - settle((c.toS - t) / Math.max(style.exitS, 1e-6));
        const p = Math.min(inP, outP);
        // Unrolls FROM the edge nearest its own anchor, so the pill grows away
        // from the frame edge it is pinned to rather than toward it.
        const fromLeft = c.x < 0.5;
        // clip-path, NOT scaleX: a scale would stretch the letterforms as the
        // pill grows and squash them on the way out. Clipping reveals the text
        // at its true width, so the type is correct on every frame.
        const hidden = (1 - p) * 100;
        return (
          <div
            key={`${c.text}-${c.fromS}`}
            style={{
              position: "absolute",
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              // Translate by half the pill's OWN size so x/y mean its centre —
              // which is what an author placing a chip against a panel edge is
              // actually thinking about. A percentage translate resolves
              // against the element, so this needs no measurement.
              transform: `translate(-50%, -50%) scale(${1 + (style.oversize - 1) * (1 - p)})`,
              clipPath: fromLeft
                ? `inset(0 ${hidden}% 0 0)`
                : `inset(0 0 0 ${hidden}%)`,
              height: pillH,
              display: "flex",
              alignItems: "center",
              padding: `0 ${pillH * 0.38}px`,
              background: style.fill,
              color: style.ink,
              borderRadius: pillH * style.radiusFrac,
              // Cap height is the spec, so the nominal size is derived from it
              // through a grotesque's ~0.715 cap ratio.
              fontSize: (pillH * style.capRatio) / 0.715,
              fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
              fontWeight: 500,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {c.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
