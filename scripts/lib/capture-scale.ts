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
 *     `100vh` comes out `scale`x too tall. An app whose shell is built on `vh`
 *     overflows by exactly `scale` — measured 1.333 on this repo's harness
 *     target, whose shell is Tailwind `h-screen` on top of an antd layout chain.
 *
 *     There is no way to redefine what `vh` MEANS, but the rules that use it can
 *     be rewritten: `rewriteViewportUnits` below walks every same-origin
 *     stylesheet and replaces `Nvh`/`Nvw` (and the dvh/svh/lvh variants) with the
 *     equivalent px against the LOGICAL viewport. That covers compiled utility
 *     classes and CSS-in-JS alike, which is what a selector allowlist could not:
 *     pinning html/body/.h-screen by hand fixed three elements and left the four
 *     antd wrappers behind it still at physical height.
 *
 *     The recorder still logs the measured overflow, so a target this does not
 *     rescue is still obvious.
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
      // Rewrite Nvh/Nvw against the LOGICAL viewport. Runs over every rule of
      // every same-origin sheet; cross-origin sheets throw on .cssRules and are
      // skipped (they cannot be read, and a CDN reset sheet is not what sizes an
      // app shell). Sheets are marked so re-entry is cheap when CSS-in-JS adds
      // more, which antd does on almost every interaction.
      var UNIT = /([-+]?[0-9]*\\.?[0-9]+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\\b/g;
      var toPx = function (text) {
        return text.replace(UNIT, function (_, n, unit) {
          var base = unit.charAt(unit.length - 1) === "h" ? LH : LW;
          return (parseFloat(n) / 100) * base + "px";
        });
      };
      var seen = 0;
      var rewrite = function () {
        var sheets = document.styleSheets;
        if (sheets.length === seen) return;
        seen = sheets.length;
        for (var i = 0; i < sheets.length; i++) {
          var rules;
          try { rules = sheets[i].cssRules; } catch (e) { continue; }
          if (!rules) continue;
          for (var j = 0; j < rules.length; j++) {
            var st = rules[j].style;
            if (!st) continue;
            for (var k = 0; k < st.length; k++) {
              var prop = st[k];
              var val = st.getPropertyValue(prop);
              if (val.indexOf("v") === -1) continue;
              var next = toPx(val);
              if (next !== val) st.setProperty(prop, next, st.getPropertyPriority(prop));
            }
          }
        }
      };
      var apply = function () {
        var d = document.documentElement;
        if (d) d.style.zoom = String(Z);
        try { rewrite(); } catch (e) {}
      };
      apply();
      document.addEventListener("DOMContentLoaded", apply);
      window.addEventListener("load", apply);
      var n = 0;
      var tick = function () { apply(); if (++n < 30) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      // CSS-in-JS keeps injecting sheets long after load; the sheet-count
      // guard makes the re-scan a length comparison until one appears.
      setInterval(apply, 250);
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
