/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

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
Config.overrideBundlerConfig(enableTailwind);
