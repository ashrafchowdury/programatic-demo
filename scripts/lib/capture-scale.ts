/**
 * HD capture: record at a LARGER physical viewport while the app still lays out
 * as if at its logical size, so every element rasterises with more pixels.
 *
 * WHY THIS EXISTS. `Page.startScreencast` emits CSS-viewport pixels, and
 * `deviceScaleFactor` never reaches it (measured three times — see the
 * DEVICE_SCALE_FACTOR note in src/lib/click-log.ts). So the ONLY way to put more
 * pixels into the recording is to enlarge the CSS viewport itself. Enlarging it
 * naked would just show more of the page; the trick is to also apply a root
 * `zoom` equal to the enlargement, which scales every element back up so the
 * SAME layout fills the bigger frame — now at higher resolution.
 *
 * Measured on the smoke fixture, comparing at matched display size: capturing at
 * 2560 with zoom 1.333 carried +108% edge energy in the app region over the
 * 1920 capture upscaled. This is REAL detail, not the upscaling a bigger render
 * gives — the source pixels genuinely exist.
 *
 * TWO THINGS THE ZOOM BREAKS, and how this handles them:
 *
 *  1. `window.innerWidth/innerHeight` still report the PHYSICAL size, so apps
 *     that size panes off them overflow. The init script shims both getters to
 *     the logical size. (Also visualViewport, which modern apps prefer.)
 *
 *  2. CSS `vh`/`vw` resolve against the physical viewport and are THEN zoomed, so
 *     `100vh` comes out `scale`x too tall. There is no JS fix — `vh` is a CSS
 *     primitive. An app whose shell is built on `vh` will overflow by exactly
 *     `scale`, and HD capture is not usable for it without per-app CSS
 *     counter-scaling. Confirmed on a real app's login page (overflowed 1.333x).
 *     The recorder logs the measured overflow so a bad target is obvious.
 *
 * Everything downstream (click rects, cursor track, log.viewport, the video)
 * lives in the PHYSICAL space and stays internally consistent — under `zoom`,
 * getBoundingClientRect returns zoomed coordinates and Playwright's mouse moves
 * in the same viewport pixels, so no coordinate conversion is needed.
 */

export type Size = { width: number; height: number };

/**
 * Parse the CAPTURE_SCALE env knob. 1 = today's behaviour (no HD). Values above
 * ~2 buy little and cost a lot (the source app is the limit), so it is clamped.
 */
export function resolveCaptureScale(raw?: string): number {
  const n = raw != null && raw !== "" ? Number(raw) : 1;
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.min(n, 2);
}

/** Physical capture size for a logical viewport at `scale`, rounded even for h264. */
export function scaledViewport(logical: Size, scale: number): Size {
  const even = (n: number) => Math.round((n * scale) / 2) * 2;
  return { width: even(logical.width), height: even(logical.height) };
}

/**
 * Init script (as a STRING — esbuild's CJS transform rewrites arrow functions,
 * so a function value serialises to something the browser cannot run). Shims the
 * logical-size getters and applies the root zoom, re-applying across early
 * paints in case the app resets documentElement style on mount.
 */
export function captureScaleInitScript(scale: number, logical: Size): string {
  return `
    (() => {
      var LW = ${logical.width}, LH = ${logical.height}, Z = ${scale};
      try {
        Object.defineProperty(window, "innerWidth",  { get: function () { return LW; }, configurable: true });
        Object.defineProperty(window, "innerHeight", { get: function () { return LH; }, configurable: true });
      } catch (e) {}
      try {
        if (window.visualViewport) {
          Object.defineProperty(window.visualViewport, "width",  { get: function () { return LW; }, configurable: true });
          Object.defineProperty(window.visualViewport, "height", { get: function () { return LH; }, configurable: true });
        }
      } catch (e) {}
      var apply = function () {
        var d = document.documentElement;
        if (d) d.style.zoom = String(Z);
      };
      apply();
      document.addEventListener("DOMContentLoaded", apply);
      window.addEventListener("load", apply);
      var n = 0;
      var tick = function () { apply(); if (++n < 30) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })();
  `;
}

/**
 * Vertical/horizontal overflow the layout shows at capture time. ~1.0 is clean;
 * a value near `scale` means the app is built on `vh`/`vw` and HD capture will
 * clip it. Run inside page.evaluate.
 */
export const OVERFLOW_PROBE = `(() => {
  var d = document.documentElement;
  return {
    vOverflow: +(d.scrollHeight / d.clientHeight).toFixed(3),
    hOverflow: +(d.scrollWidth / d.clientWidth).toFixed(3),
  };
})()`;
