import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { backdropFile } from "./lib/backdrop";

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
 *
 * A STILL does not want any of this: it is a PNG, with no quantiser to beat,
 * and it draws the file 1.5-2.7x larger than it was made, where the grain
 * turns into a grid. It uses the `-still` variant instead — see
 * stillBackdropFile in src/lib/backdrop.ts.
 */

/**
 * Drawn with <Img>, not a CSS background-image: Remotion blocks the frame until
 * an <Img> has decoded, so it cannot render a frame with the backdrop missing.
 * A CSS background is invisible to that handshake and flickers on cold workers.
 */
export const Backdrop: React.FC<{
  name?: string;
  ground?: string | null;
  /**
   * An exact file under public/ to draw instead of `name`'s — how a still
   * asks for the 4K grain-free variant (stillBackdropFile) once it has
   * checked the variant exists. The clips never pass it.
   */
  file?: string;
}> = ({ name, ground, file }) =>
  // A FLAT ground short-circuits the image entirely. Not a 1x1 image stretched
  // to frame: an <Img> costs a decode and a texture upload per frame, and the
  // encoder treats a real gradient and a solid fill very differently — a solid
  // fill is what lets the whole ground sit in one macroblock run.
  ground ? (
    <AbsoluteFill style={{ backgroundColor: ground }} />
  ) : (
    <AbsoluteFill>
      <Img
        src={staticFile(file ?? backdropFile(name))}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
