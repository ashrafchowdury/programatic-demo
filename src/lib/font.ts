/**
 * Register the faces the styles ask for, before the first frame is drawn.
 *
 * WHY THIS IS NOT A `<link>` OR AN `@font-face` RULE. Remotion renders frames
 * deterministically and does not wait for the network between them, so a face
 * that arrives late is simply absent from the early frames and present in the
 * later ones — the same card rendered twice in one film. `delayRender` is the
 * only thing that holds the renderer until the file is actually usable.
 *
 * The file is VENDORED at public/fonts rather than fetched from a CDN, so a
 * render is reproducible offline and cannot change under us when the CDN does.
 * Inter is licensed under the SIL Open Font License, which permits that.
 *
 * Idempotent: Remotion mounts compositions more than once, and registering the
 * same family twice throws. Calling this repeatedly is safe.
 */
import { continueRender, delayRender, staticFile } from "remotion";

/** Family name the presets reference. Must match TypeStyle.fontFamily exactly. */
export const INTER_FAMILY = "Inter";

let started = false;

export function loadFonts(): void {
  // Guard on the module, not on document.fonts: the check has to be cheap
  // enough to sit at the top of a component body that runs every frame.
  if (started) return;
  started = true;
  // No FontFace API means a non-browser bundling pass, where there is nothing
  // to load and nothing to wait for.
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;

  const handle = delayRender(`loading ${INTER_FAMILY}`);
  const face = new FontFace(
    INTER_FAMILY,
    `url(${staticFile("fonts/inter-latin-wght-normal.woff2")}) format("woff2")`,
    // The vendored file is the VARIABLE cut, so one registration covers every
    // weight the presets use. Declaring the full axis range is what stops the
    // browser synthesising a fake bold over the regular master.
    { weight: "100 900", style: "normal", display: "block" },
  );

  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch(() => {
      // Deliberately NOT fatal. Every stack that names Inter also names the
      // legacy fallback, so a failed load degrades to the old face instead of
      // hanging the render or drawing blank boxes.
      continueRender(handle);
    });
}
