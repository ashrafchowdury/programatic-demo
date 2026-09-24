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
 * THREE THINGS THE ZOOM BREAKS. Two are handled here; the third is a reason
 * not to raise the scale on a given app at all:
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
 *  3. FLOATING PORTALS CAN LAND OFF-SCREEN, and the overflow probe does not see
 *     it. A popover positioned by a computed offset — Radix/floating-ui reading
 *     getBoundingClientRect, which under `zoom` already returns zoomed pixels —
 *     has the root zoom applied to that offset a SECOND time. Measured on the
 *     agenta schedule drawer's cadence popover: 586px wide at scale 1, 2344px
 *     at scale 2 (should be 1172) and 5274px at x6462 of a 5760-wide viewport
 *     at scale 3, i.e. entirely outside the frame. The dropdown menu's items go
 *     the same way and Playwright refuses to click them ("element is outside of
 *     the viewport").
 *
 *     There is no fix on this side; it needs the app to position portals in a
 *     way that survives a root zoom. What matters here is that it is INVISIBLE
 *     to the checks above: vOverflow and hOverflow both read 1.000, the page
 *     lays out perfectly, and anything positioned by CSS inset — a full-height
 *     drawer, a modal — is pixel-correct at every scale. So a probe that opens
 *     the drawer and measures it will report that HD capture works on an app
 *     where the demo's own popovers are gone. Open every popover the flow
 *     touches and check its box is inside the viewport before trusting a scale.
 *
 * Everything downstream (click rects, cursor track, log.viewport, the video)
 * lives in the PHYSICAL space and stays internally consistent — under `zoom`,
 * getBoundingClientRect returns zoomed coordinates and Playwright's mouse moves
 * in the same viewport pixels, so no coordinate conversion is needed.
 */

import { OUTPUT_WIDTH } from "../../src/lib/click-log";
import { WINDOW_FIT } from "../../src/lib/window";
import { S_MAX } from "../../src/lib/zoom";

export type Size = { width: number; height: number };

/**
 * Scale a shoot uses when CAPTURE_SCALE is not set.
 *
 * 2 after measurement. `Page.startScreencast` caps the source at the CSS
 * viewport, so at scale 1 every camera zoom above 1 / WINDOW_FIT upscales and
 * the app text softens exactly when the camera pushes in. Recording at 2 puts a
 * 3840x2160 source behind the 1920 layout, which clears the 2560 render with
 * room to spare — nothing is upscaled even at S_MAX. Measured end to end on the
 * whole record -> convert -> render pipeline, same 2560x1440 output both times:
 *   smoke (offline fixture)    1920 -> 3840 source   +49% edge energy at the zoom hold
 *   agent-instructions (live)  1920 -> 3840 source   +36% mean over the typing hold
 * The source genuinely carries the extra pixels; this is the same real detail as
 * the +108% edge-energy measurement above, not the upscaling a bigger render gives.
 *
 * TWO FLOWS MUST STILL RECORD WITH CAPTURE_SCALE=1, for reasons documented in
 * their own flow files — the root zoom breaks them and no env default can know
 * that (there is no per-flow scale yet, so it has to be set on the command):
 *   - agent-schedule: its cadence popover is positioned by a computed offset and
 *     lands off-screen under the zoom (see note 3 above). Playwright then cannot
 *     click it and the flow FAILS — loudly, but only on re-record.
 *   - agent-tool: full-viewport stage framing, where HD capture trades against
 *     the look the flow is tuned for (see flows/agent-tool.ts).
 * Re-record those two with
 *   `CAPTURE_SCALE=1 DEMO_ALLOW_SOFT_CAPTURE=1 pnpm record:live <name>`
 * — the second variable is needed because a 1920 capture is below
 * minCaptureWidth, which the recorders now refuse by default.
 */
export const DEFAULT_CAPTURE_SCALE = 2;

/**
 * Parse the CAPTURE_SCALE env knob.
 *
 * The ceiling used to be 2, on the reasoning that "the source app is the limit".
 * That is not true of a DOM app: the root zoom makes it re-rasterise text and
 * vector chrome at whatever scale it is given, so detail keeps arriving. What IS
 * true is that the cost is quadratic in pixels and the app composites slower, so
 * the ceiling is a budget, not a physical limit. Raised to 4 and measured per
 * shoot — the recorder logs the overflow and the beat times, which is what
 * actually tells you whether a scale worked on a given target.
 */
export const MAX_CAPTURE_SCALE = 4;

/**
 * Narrowest source that is never upscaled on screen: the render draws the app
 * at OUTPUT_WIDTH x WINDOW_FIT at base and camera-zooms up to the ceiling, so
 * at S_MAX the app's width in output pixels is 2560 x 0.86 x 1.74 = 3831.
 * Below that the camera magnifies pixels that do not exist, and every demo is
 * as sharp as whatever viewport its flow happened to use — the audit found
 * public/*.mp4 anywhere from 1280x720 to 3840x2160 for one 2560x1440 output.
 *
 * Measured, smoke fixture, SSIM (Y) against a geometry-matched truth — the same
 * layout rasterised at twice the capture (DSF 2 screenshot), Lanczos-scaled to
 * the size the viewer sees; the capture scaled the way the renderer does
 * (bilinear):
 *
 *                        base (2202px wide)    S_MAX (3830px, 2560x1440 crop)
 *   scale 1 (1920)       0.99811               0.99518
 *   scale 2 (3840)       0.99946               0.99915
 *
 * i.e. 1-SSIM falls 3.5x at base and 5.7x at the zoom hold, and the difference
 * is plain side by side. Compare against a truth of the SAME layout: the root
 * zoom shifts sub-pixel geometry (smoke's shell overflows 1.044 under it), and
 * scored against the 1x layout's truth scale 2 came out WORSE (0.98659 at
 * S_MAX) purely on misregistration — the trap edge energy was blind to and
 * SSIM is over-sensitive to.
 */
export function minCaptureWidth(
  outputWidth = OUTPUT_WIDTH,
  fit = WINDOW_FIT,
  // The camera's deepest zoom, imported so a retune in zoom.ts moves the
  // capture floor with it. capture-scale.test.ts checks the track builder
  // really reaches it.
  ceiling = S_MAX,
): number {
  return Math.ceil(outputWidth * fit * ceiling);
}

/**
 * Escape hatch for a capture below minCaptureWidth. Set it for the flows that
 * cannot take the root zoom (see DEFAULT_CAPTURE_SCALE) — they then record,
 * soft, and say so.
 */
export const ALLOW_SOFT_CAPTURE_ENV = "DEMO_ALLOW_SOFT_CAPTURE";

/**
 * Why a physical capture size is too small for the render, or null when it is
 * big enough. Pure: callers decide whether to throw or warn.
 */
export function captureSizeProblem(
  physical: Size,
  logical: Size,
  scale: number,
  minWidth = minCaptureWidth(),
): string | null {
  if (physical.width >= minWidth) return null;
  const need = Math.ceil((minWidth / logical.width) * 100) / 100;
  return (
    `capture ${physical.width}x${physical.height} is narrower than the ` +
    `${minWidth}px the render needs at full zoom (${OUTPUT_WIDTH} x ` +
    `${WINDOW_FIT} x S_MAX), so the camera would upscale the app by ` +
    `${(minWidth / physical.width).toFixed(2)}x. ` +
    `Record at CAPTURE_SCALE>=${need} (now ${scale}), or set ` +
    `${ALLOW_SOFT_CAPTURE_ENV}=1 if this flow cannot take the zoom.`
  );
}

/**
 * Enforce the capture floor: throws unless ALLOW_SOFT_CAPTURE_ENV is set, in
 * which case it returns the warning for the caller to print. Null when fine.
 */
export function enforceCaptureSize(
  physical: Size,
  logical: Size,
  scale: number,
  env: string | undefined = process.env[ALLOW_SOFT_CAPTURE_ENV],
): string | null {
  const problem = captureSizeProblem(physical, logical, scale);
  if (!problem) return null;
  if (env === "1") return `⚠ SOFT CAPTURE — ${problem}`;
  throw new Error(problem);
}

export function resolveCaptureScale(raw?: string): number {
  const n = raw != null && raw !== "" ? Number(raw) : DEFAULT_CAPTURE_SCALE;
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.min(n, MAX_CAPTURE_SCALE);
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
