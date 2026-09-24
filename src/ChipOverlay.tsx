import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { pushToCss, settle } from "./lib/push";
import { chipRideAt, chipsAt, chipSizePx, pullInside, type ReelChip } from "./lib/chips";
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
  /** The film's size, when it is not 2560x1440. See HudOverlayProps. */
  size?: { width: number; height: number };
  /**
   * The 16:9 cut's height. The pill is sized against it, so a chip is the same
   * pixel size at every aspect — 7.3% of a 2560-tall vertical frame would be a
   * 187px slab. Absent = the frame's height, which is the native case; present
   * (any other aspect, even 1:1 whose height matches) also pulls a chip that
   * would hang off the frame back inside it.
   */
  designHeight?: number;
};

export const ChipOverlay: React.FC<ChipOverlayProps> = ({
  chips,
  style,
  designHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const live = chipsAt(chips, t);
  if (live.length === 0) return <AbsoluteFill />;

  // At another aspect a placement authored against a 16:9 panel edge can hang
  // off a narrower frame, so the pill's centre is pulled in until the whole
  // pill fits, from an estimate of its width. Native placements are the
  // author's and are left exactly where they were put.
  // (scripts/lib/reel-cut.ts has usually placed it already — off the press
  // targets too — so this is a no-op there; it guards a hand-built layer.)
  const centreX = (c: ReelChip): number => {
    if (designHeight == null) return c.x;
    const { width: w } = chipSizePx(c.text, style, designHeight);
    return pullInside(c.x, w / 2 / width);
  };

  const { height: pillH, fontSize } = chipSizePx("", style, designHeight ?? height);

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
        // The chip RIDES ITS SHOT: the same envelope, CSS and origin as
        // FramedPush, so a panel scaling in carries its chips with it and one
        // sliding out would take them along. Rest (no ride) adds no layer.
        const ride = c.ride ? chipRideAt(c, frame) : null;
        const pill = (
          <div
            style={{
              position: "absolute",
              left: `${centreX(c) * 100}%`,
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
              fontSize,
              fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
              fontWeight: 500,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {c.text}
          </div>
        );
        const key = `${c.text}-${c.fromS}`;
        return ride && c.ride ? (
          <AbsoluteFill key={key} style={{ transform: pushToCss(ride, c.ride.designScale) }}>
            {pill}
          </AbsoluteFill>
        ) : (
          <React.Fragment key={key}>{pill}</React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};
