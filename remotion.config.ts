/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// Rasterise on the real GPU. This composition is dominated by
// <CameraMotionBlur>, which composites `samples` full-size copies per frame —
// software rasterising that cost roughly 10x more on a real demo (see
// scripts/render.ts for the measurements, and for the thermal caveat). Set here as well as in render.ts so Studio scrubbing gets it
// too. Override with DEMO_GL=swiftshader where there is no usable GPU — it is a
// compatibility fallback rather than a fast one (`swangle` fails outright here).
Config.setChromiumOpenGlRenderer(
  (process.env.DEMO_GL as Parameters<typeof Config.setChromiumOpenGlRenderer>[0]) ??
    "angle",
);
// PNG frames = lossless capture (crisper, no JPEG mush) for a less "dull" result.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
// BT.709, tagged. Remotion 4's "default" matrixes RGB->YUV as BT.601 and writes
// no tags, while browsers, QuickTime and every upload path read untagged HD as
// BT.709. Measured on a flat #f0f05a pill (the Agenta mark), decoded the way a
// player does: BT.601/untagged showed #f2e753 (Y'CbCr 207/62/139); BT.709 shows
// #f0f05a exactly (213/62/134). Every later ffmpeg pass (xfade, the overlays, a
// re-encoding stitch) re-states it via scripts/lib/encode.ts BT709_ARGS.
Config.setColorSpace("bt709");
// ...and make the tags stick. Remotion passes -color_primaries/-color_trc, but
// its own `zscale` sets only the matrix on the frames, and the frame properties
// win: the file came out bt709/unknown/unknown. Naming primaries and transfer
// on the zscale (in == out, so no conversion — tags only) fixes that for every
// codec, ProRes overlays included. Anything else passes through untouched.
const ZSCALE_709 = "zscale=matrix=709:matrixin=709:range=limited";
// A chunked render (scripts/lib/chunks.ts) sets DEMO_KEYFRAME_EVERY so an IDR
// lands on every chunk boundary, counted from the render's first frame; the
// chunks are then cut out of it by stream copy. `-g` cannot promise that: x264
// restarts its GOP at every scene-cut keyframe, so the grid would drift.
const KEYFRAME_EVERY = Number(process.env.DEMO_KEYFRAME_EVERY ?? "");
Config.overrideFfmpegCommand(({ args }) => {
  const out = args.map((a) =>
    a === ZSCALE_709
      ? `${a}:primaries=709:primariesin=709:transfer=709:transferin=709`
      : a,
  );
  if (KEYFRAME_EVERY >= 1 && out.includes("libx264"))
    out.splice(out.length - 1, 0, "-force_key_frames", `expr:eq(mod(n,${KEYFRAME_EVERY}),0)`);
  return out;
});
