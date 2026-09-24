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
 * THREE THINGS THE ZOOM BREAKS, all handled here — the third only as far as
 * an offline fixture can prove, so it is also probed on every shoot:
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
 *     be rewritten: captureScaleInitScript walks every same-origin stylesheet
 *     (and inline style) and replaces `Nvh`/`Nvw` (and the dvh/svh/lvh
 *     variants) with the equivalent px against the LOGICAL viewport. That covers compiled utility
 *     classes and CSS-in-JS alike, which is what a selector allowlist could not:
 *     pinning html/body/.h-screen by hand fixed three elements and left the four
 *     antd wrappers behind it still at physical height.
 *
 *     The recorder still logs the measured overflow against the page's natural
 *     overflow (overflowVerdict), so a target this does not rescue is obvious.
 *
 *  3. FLOATING PORTALS LANDED OFF-SCREEN, and the overflow probe does not see
 *     it. A popover positioned by a computed offset — Radix/floating-ui reading
 *     getBoundingClientRect, which under `zoom` returns zoomed pixels — had the
 *     root zoom applied to that offset a SECOND time. Measured on the agenta
 *     schedule drawer's cadence popover: 586px wide at scale 1, 2344px at scale
 *     2 (should be 1172) and 5274px at x6462 of a 5760-wide viewport at scale 3,
 *     i.e. entirely outside the frame, and Playwright refused to click its items
 *     ("element is outside of the viewport").
 *
 *     The init script now divides the page's client-space geometry back to
 *     logical px, so that round trip closes (see captureScaleInitScript; the
 *     offline repro is scripts/fixtures/capture-scale.html). It is still
 *     INVISIBLE to the overflow probe — vOverflow and hOverflow read 1.000
 *     either way — so the recorders also run a portal probe after every beat
 *     (watchPortals) and warn when a popover is wider than the frame or pokes
 *     out of it. Read those warnings before trusting a scale on a new app.
 *
 * Everything downstream (click rects, cursor track, log.viewport, the video)
 * lives in the PHYSICAL space and stays internally consistent — Playwright's
 * mouse moves in viewport pixels, and the recorder's own page.evaluate probes
 * still see zoomed getBoundingClientRect (the shim answers them natively), so
 * no coordinate conversion is needed.
 */

import type { Page } from "playwright";
import { OUTPUT_WIDTH } from "../../src/lib/click-log";
import { WINDOW_FIT } from "../../src/lib/window";
import { S_MAX } from "../../src/lib/zoom";
import type { FlowContext } from "./flow";

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
 * TWO FLOWS WERE RECORDED WITH CAPTURE_SCALE=1, for reasons documented in
 * their own flow files:
 *   - agent-schedule: its cadence popover is positioned by a computed offset and
 *     landed off-screen under the zoom (see note 3 above), so Playwright could
 *     not click it. The geometry shim should now fix this; re-record it at the
 *     default scale and read the portal probe's output before trusting it.
 *   - agent-tool: full-viewport stage framing, where HD capture trades against
 *     the look the flow is tuned for (see flows/agent-tool.ts).
 * A flow pins its own scale with `captureScale: 1` in defineFlow (see
 * captureScaleFor), which also allows the soft capture; CAPTURE_SCALE on the
 * command line still overrides the pin.
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

/**
 * The scale a shoot records at, and whether it may record soft.
 *
 * CAPTURE_SCALE wins when set; otherwise the flow's own `captureScale` pin;
 * otherwise DEFAULT_CAPTURE_SCALE. A pin is the flow saying it cannot take the
 * default zoom — which is what ALLOW_SOFT_CAPTURE_ENV says on the command line
 * — so a pinned flow records below the floor with a warning instead of
 * refusing, and nobody has to remember the two variables on re-record.
 */
export function captureScaleFor(
  pin: number | undefined,
  env: Record<string, string | undefined> = process.env,
): { scale: number; allowSoft: boolean; source: "env" | "flow" | "default" } {
  const raw = env.CAPTURE_SCALE;
  const source =
    raw != null && raw !== "" ? "env" : pin != null ? "flow" : "default";
  const scale = resolveCaptureScale(
    source === "env" ? raw : source === "flow" ? String(pin) : undefined,
  );
  const allowSoft = env[ALLOW_SOFT_CAPTURE_ENV] === "1" || source === "flow";
  return { scale, allowSoft, source };
}

/** Physical capture size for a logical viewport at `scale`, rounded even for h264. */
export function scaledViewport(logical: Size, scale: number): Size {
  const even = (n: number) => Math.round((n * scale) / 2) * 2;
  return { width: even(logical.width), height: even(logical.height) };
}

/**
 * Set to 1 to keep the page's own geometry APIs native under the zoom (see
 * captureScaleInitScript) — the escape hatch if the coordinate shim ever
 * breaks an app that worked without it.
 */
export const NATIVE_GEOMETRY_ENV = "DEMO_NATIVE_GEOMETRY";

/**
 * Init script (as a STRING — esbuild's CJS transform rewrites arrow functions,
 * so a function value serialises to something the browser cannot run). Applies
 * the root zoom, re-applying across early paints in case the app resets
 * documentElement style on mount, and makes the page see the LOGICAL viewport
 * everywhere it can look:
 *
 *  - innerWidth/innerHeight and visualViewport report the logical size.
 *  - Every Nvh/Nvw (and dvh/svh/lvh, vmin/vmax) in the page's CSS becomes px
 *    against the logical viewport — in every rule, however deeply nested
 *    (@media, @supports, @layer, @container, CSS nesting, @keyframes,
 *    @import), in constructed and adopted sheets, in shadow roots and in
 *    inline style attributes. Changes are caught as they happen, not polled:
 *    insertRule/replace/replaceSync are wrapped (CSS-in-JS in "speedy" mode
 *    inserts into a sheet that already exists, so the old sheet-COUNT guard
 *    never saw it), and a MutationObserver sees new <style>/<link> elements,
 *    <style> text being replaced and style attributes being written.
 *  - Width/height media queries (in sheets and through matchMedia) are scaled
 *    by the zoom, so a breakpoint between the logical and the physical width
 *    does not trip. Media queries evaluate against the PHYSICAL viewport:
 *    measured, `matchMedia("(min-width: 3000px)")` matches at 1920 x 2.
 *
 *  - Client-space geometry is divided back to logical px (unless `geometry` is
 *    false, see NATIVE_GEOMETRY_ENV). Measured on Chromium 151 with a zoom-2
 *    root, a box at left:100px width:200px:
 *
 *      API                                               reports
 *      getBoundingClientRect / getClientRects / Range    200, 400 (zoomed)
 *      MouseEvent clientX/pageX/offsetX, elementFromPoint zoomed
 *      scrollX/scrollY/scrollTo, root clientHeight/scrollHeight  zoomed
 *      offsetLeft/offsetWidth, getComputedStyle, element scrollTop  100, 200
 *      ResizeObserver contentRect                        200
 *
 *    i.e. the page gets two coordinate systems, and any script that reads one
 *    and writes the other lands `scale` x off. That is exactly how floating
 *    portals broke (note 3 above): floating-ui reads the trigger's
 *    getBoundingClientRect (zoomed) and writes it as a CSS translate, which the
 *    zoom scales AGAIN. With the zoomed group divided by the zoom the page
 *    lives in one system — logical CSS px — and every such round trip closes.
 *    Measured on scripts/fixtures/capture-scale.html: the Radix-style popover
 *    at 1280,1128 (logical, want 640,568) before, at 640,568 after.
 *
 *    The RECORDER still needs zoomed px (click rects, the pointer park), so the
 *    shim answers natively when the direct caller is a Playwright evaluation —
 *    `page.evaluate` / `locator.evaluate` code shows up in the stack as
 *    "eval at evaluate (:N" with no URL, which no app script can. Playwright's
 *    own actionability and boundingBox run in its utility world or over CDP
 *    and never see the shim at all. Synthetic (untrusted) mouse events keep the
 *    numbers they were built with. The stack check is the cost: measured
 *    4-6 us per getBoundingClientRect against 0.3-0.6 us native (two runs,
 *    loaded machine), i.e. ~0.5 ms of a frame for a page that measures 100
 *    boxes per frame.
 *
 *    Not covered: IntersectionObserver entry rects (zoomed; only their ratios
 *    are usually read), screen.*, and devicePixelRatio, which stays 1 — a
 *    canvas sized from logical px is drawn at logical resolution and upscaled.
 *
 * `window.__demoCaptureScale.unzoom()` drops the zoom and restores every
 * media query it scaled, for naturalOverflow.
 */
export function captureScaleInitScript(
  scale: number,
  logical: Size,
  geometry = process.env[NATIVE_GEOMETRY_ENV] !== "1",
): string {
  return `
    (() => {
      if (window.__demoCaptureScale) return;
      var LW = ${logical.width}, LH = ${logical.height}, Z = ${scale}, GEOM = ${geometry};
      // The zoom the page is wearing: Z while filming, 1 after unzoom().
      var K = Z;
      var api = { scale: Z, paused: false };
      try { Object.defineProperty(window, "__demoCaptureScale", { value: api }); } catch (e) {}
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

      // ---- viewport units -> logical px -------------------------------------
      var UNIT = /([-+]?[0-9]*\\.?[0-9]+)(dvh|svh|lvh|dvw|svw|lvw|vmin|vmax|vh|vw)\\b/g;
      var HAS_UNIT = /[0-9](dvh|svh|lvh|dvw|svw|lvw|vmin|vmax|vh|vw)\\b/;
      var toPx = function (text) {
        return text.replace(UNIT, function (_, n, unit) {
          var base = unit === "vmin" ? Math.min(LW, LH)
            : unit === "vmax" ? Math.max(LW, LH)
            : unit.charAt(unit.length - 1) === "h" ? LH : LW;
          return (parseFloat(n) / 100) * base + "px";
        });
      };
      var fixDecl = function (st) {
        for (var k = 0; k < st.length; k++) {
          var prop = st[k];
          var val = st.getPropertyValue(prop);
          if (val.indexOf("v") === -1) continue;
          var next = toPx(val);
          if (next !== val) st.setProperty(prop, next, st.getPropertyPriority(prop));
        }
      };
      // Width/height media features by the zoom, em/rem at the initial 16px.
      var MEDIA_LEN = /([0-9]*\\.?[0-9]+)(px|rem|em)\\b/g;
      var scaleMedia = function (text, z) {
        if (z === 1 || !/(width|height)/.test(text)) return text;
        return text.replace(MEDIA_LEN, function (_, n, unit) {
          return parseFloat(n) * (unit === "px" ? 1 : 16) * z + "px";
        });
      };
      var mediaDone = new WeakSet(), scaledMedia = [];
      var fixMedia = function (owner, list) {
        if (api.paused || !list || mediaDone.has(owner)) return;
        mediaDone.add(owner);
        var t = list.mediaText, n = scaleMedia(t, Z);
        if (n !== t) { list.mediaText = n; scaledMedia.push([list, t]); }
      };
      var counts = new WeakMap();
      var walk = function (rules) {
        for (var i = 0; i < rules.length; i++) {
          var r = rules[i];
          if (!r) continue;
          if (r.style) fixDecl(r.style);
          if (r.media) fixMedia(r, r.media);
          if (r.styleSheet) fixSheet(r.styleSheet);
          // @media, @supports, @layer, @container, @keyframes, nested rules.
          if (r.cssRules) walk(r.cssRules);
        }
      };
      var fixSheet = function (s) {
        // Cross-origin sheets throw on .cssRules; they cannot be read, and a CDN
        // reset sheet is not what sizes an app shell.
        var rules;
        try { rules = s.cssRules; } catch (e) { return; }
        if (!rules) return;
        if (s.media) fixMedia(s, s.media);
        walk(rules);
        counts.set(s, rules.length);
      };
      var roots = [document];
      var scanSheets = function (list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
          var s = list[i], len;
          try { len = s.cssRules.length; } catch (e) { continue; }
          if (counts.get(s) !== len) fixSheet(s);
        }
      };
      var scan = function () {
        for (var i = 0; i < roots.length; i++) {
          scanSheets(roots[i].styleSheets);
          scanSheets(roots[i].adoptedStyleSheets);
        }
      };
      var fixInline = function (el) {
        var a = el.getAttribute && el.getAttribute("style");
        if (a && HAS_UNIT.test(a)) fixDecl(el.style);
      };
      var INLINE = '[style*="vh"],[style*="vw"],[style*="vmin"],[style*="vmax"]';
      var fixTree = function (n) {
        fixInline(n);
        if (n.querySelectorAll) {
          var els = n.querySelectorAll(INLINE);
          for (var i = 0; i < els.length; i++) fixInline(els[i]);
        }
      };
      var pending = false;
      var later = function () {
        if (pending) return;
        pending = true;
        // A microtask, so the rewrite lands before the next paint.
        Promise.resolve().then(function () { pending = false; try { scan(); } catch (e) {} });
      };
      var mo = new MutationObserver(function (muts) {
        // The first record is the parser inserting <html>: zoom it before any
        // page script can measure it.
        if (!api.paused && document.documentElement && !document.documentElement.style.zoom)
          document.documentElement.style.zoom = String(Z);
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i], t = m.target;
          if (m.type === "attributes") { fixInline(t); continue; }
          if (m.type === "characterData") {
            if (t.parentNode && t.parentNode.nodeName === "STYLE") later();
            continue;
          }
          if (t.nodeName === "STYLE") later();
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.nodeName === "STYLE" || n.nodeName === "LINK" ||
                (n.querySelector && n.querySelector("style,link"))) later();
            fixTree(n);
          }
        }
      });
      var observe = function (root) {
        mo.observe(root, { subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ["style"] });
      };
      observe(document);
      document.addEventListener("load", function (e) {
        if (e.target && e.target.nodeName === "LINK") later();
      }, true);
      var after = function (proto, name, fn) {
        if (!proto || !Object.prototype.hasOwnProperty.call(proto, name)) return;
        var orig = proto[name];
        proto[name] = function () {
          var ret = orig.apply(this, arguments);
          try { fn(this, ret); } catch (e) {}
          return ret;
        };
      };
      after(CSSStyleSheet.prototype, "insertRule", function (s, i) {
        if (!counts.has(s)) return fixSheet(s);
        walk([s.cssRules[i]]);
        counts.set(s, s.cssRules.length);
      });
      after(CSSStyleSheet.prototype, "addRule", function (s) { fixSheet(s); });
      after(CSSStyleSheet.prototype, "replaceSync", function (s) { fixSheet(s); });
      after(CSSStyleSheet.prototype, "replace", function (s, p) {
        if (p && p.then) p.then(function () { fixSheet(s); });
      });
      if (window.CSSGroupingRule)
        after(CSSGroupingRule.prototype, "insertRule", function (r, i) { walk([r.cssRules[i]]); });
      after(CSSStyleRule.prototype, "insertRule", function (r, i) { walk([r.cssRules[i]]); });
      after(Element.prototype, "attachShadow", function (_, root) {
        roots.push(root);
        observe(root);
      });
      var mm = window.matchMedia;
      if (mm) window.matchMedia = function (q) { return mm.call(window, scaleMedia(String(q), K)); };

      // ---- client-space geometry -> logical px -----------------------------
      if (GEOM) {
        // True when the shim's direct caller is a Playwright evaluation. Four
        // frames: this, off(), the shim, its caller.
        var PW = /eval at evaluate \\(:[0-9]/;
        var native = function () {
          var lim = Error.stackTraceLimit, s;
          Error.stackTraceLimit = 4;
          try { s = new Error().stack; } finally { Error.stackTraceLimit = lim; }
          return typeof s === "string" && PW.test(s);
        };
        // Also native until the zoom is actually on: a parser-blocking script
        // can run before documentElement exists to carry it.
        var zoomed = function () {
          var d = document.documentElement;
          return !!d && d.style.zoom === String(Z);
        };
        var off = function () { return K === 1 || !zoomed() || native(); };
        var rect = function (r) { return new DOMRect(r.x / K, r.y / K, r.width / K, r.height / K); };
        var rects = function (l) {
          var a = [];
          for (var i = 0; i < l.length; i++) a.push(rect(l[i]));
          a.item = function (i) { return this[i] || null; };
          return a;
        };
        var wrap = function (proto, name, conv) {
          if (!proto || !Object.prototype.hasOwnProperty.call(proto, name)) return;
          var o = proto[name];
          proto[name] = function () {
            var r = o.apply(this, arguments);
            return off() ? r : conv(r);
          };
        };
        wrap(Element.prototype, "getBoundingClientRect", rect);
        wrap(Element.prototype, "getClientRects", rects);
        wrap(Range.prototype, "getBoundingClientRect", rect);
        wrap(Range.prototype, "getClientRects", rects);
        var getter = function (obj, prop, when) {
          var d = obj && Object.getOwnPropertyDescriptor(obj, prop);
          if (!d || !d.get) return;
          Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: d.enumerable,
            get: function () {
              var v = d.get.call(this);
              return !when(this) || off() ? v : v / K;
            },
            set: d.set && function (v) { d.set.call(this, !when(this) || off() ? v : v * K); },
          });
        };
        var always = function () { return true; };
        var trusted = function (e) { return e.isTrusted; };
        ["clientX", "clientY", "x", "y", "pageX", "pageY", "offsetX", "offsetY"].forEach(function (p) {
          getter(MouseEvent.prototype, p, trusted);
        });
        ["scrollX", "scrollY", "pageXOffset", "pageYOffset"].forEach(function (p) { getter(window, p, always); });
        if (window.VisualViewport)
          ["offsetLeft", "offsetTop", "pageLeft", "pageTop"].forEach(function (p) {
            getter(VisualViewport.prototype, p, always);
          });
        // The root scroller's metrics are viewport metrics, so zoomed too;
        // every other element's client/scroll sizes are already logical.
        var isRoot = function (el) {
          return el === document.documentElement && document.compatMode === "CSS1Compat";
        };
        ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight", "scrollTop", "scrollLeft"].forEach(function (p) {
          getter(Element.prototype, p, isRoot);
        });
        var point = function (proto, name) {
          if (!proto || !Object.prototype.hasOwnProperty.call(proto, name)) return;
          var o = proto[name];
          proto[name] = function (x, y) {
            if (off()) return o.apply(this, arguments);
            var a = Array.prototype.slice.call(arguments);
            a[0] = x * K; a[1] = y * K;
            return o.apply(this, a);
          };
        };
        ["elementFromPoint", "elementsFromPoint", "caretRangeFromPoint", "caretPositionFromPoint"].forEach(function (n) {
          point(Document.prototype, n);
          point(window.ShadowRoot && ShadowRoot.prototype, n);
        });
        var scroller = function (obj, name, when) {
          var o = obj && obj[name];
          if (typeof o !== "function") return;
          obj[name] = function (a, b) {
            if (!when(this) || off()) return o.apply(this, arguments);
            if (a && typeof a === "object") {
              var opt = {};
              for (var k in a) opt[k] = a[k];
              if (opt.left != null) opt.left *= K;
              if (opt.top != null) opt.top *= K;
              return o.call(this, opt);
            }
            return o.call(this, a * K, b * K);
          };
        };
        ["scrollTo", "scroll", "scrollBy"].forEach(function (n) {
          scroller(window, n, always);
          scroller(Element.prototype, n, isRoot);
        });
      }

      api.unzoom = function () {
        api.paused = true;
        K = 1;
        var d = document.documentElement;
        if (d) d.style.zoom = "";
        for (var i = 0; i < scaledMedia.length; i++) {
          try { scaledMedia[i][0].mediaText = scaledMedia[i][1]; } catch (e) {}
        }
      };
      var apply = function () {
        if (api.paused) return;
        var d = document.documentElement;
        if (d && d.style.zoom !== String(Z)) d.style.zoom = String(Z);
        try { scan(); } catch (e) {}
      };
      apply();
      document.addEventListener("DOMContentLoaded", function () {
        apply();
        if (document.documentElement) fixTree(document.documentElement);
      });
      window.addEventListener("load", apply);
      var n = 0;
      var tick = function () { apply(); if (++n < 30) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      // A safety net only: every path above is event-driven, and with per-sheet
      // rule counts a scan that finds nothing new is one length read per sheet.
      setInterval(apply, 250);
    })();
  `;
}

export type Overflow = { vOverflow: number; hOverflow: number };

/**
 * Vertical/horizontal overflow the layout shows at capture time: document
 * scroll size over viewport size. Run inside page.evaluate. On its own it
 * cannot tell a vh/vw bug from a page that simply scrolls — compare it to
 * naturalOverflow with overflowVerdict.
 */
export const OVERFLOW_PROBE = `(() => {
  var d = document.documentElement;
  return {
    vOverflow: +(d.scrollHeight / d.clientHeight).toFixed(3),
    hOverflow: +(d.scrollWidth / d.clientWidth).toFixed(3),
  };
})()`;

/**
 * The same page's overflow with no zoom at the LOGICAL viewport — what the
 * layout would be at scale 1. It relayouts the page, so call it only once
 * nothing is being filmed (after the screencast has stopped). Null when the
 * page was never zoomed.
 */
export async function naturalOverflow(
  page: Page,
  logical: Size,
): Promise<Overflow | null> {
  const unzoomed = await page.evaluate(
    `!!(window.__demoCaptureScale && (window.__demoCaptureScale.unzoom(), true))`,
  );
  if (!unzoomed) return null;
  await page.setViewportSize(logical);
  await page.evaluate(
    `new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); })`,
  );
  return (await page.evaluate(OVERFLOW_PROBE)) as Overflow;
}

/**
 * How far the zoomed layout overflows BEYOND what the page does naturally, so
 * an ordinary scrolling page does not warn. The smoke fixture read v=1.044
 * against a bare 1.02 threshold on every shoot — its body is min-height:100vh
 * plus a collapsing margin, which overflows exactly as much at scale 1.
 * Without a natural measurement (the Playwright capture path) it falls back to
 * the bare ratio and says so.
 */
export function overflowVerdict(
  zoomed: Overflow,
  natural: Overflow | null,
): { bad: boolean; line: string } {
  const base = natural ?? { vOverflow: 1, hOverflow: 1 };
  const v = zoomed.vOverflow / base.vOverflow;
  const h = zoomed.hOverflow / base.hOverflow;
  const bad = v > 1.02 || h > 1.02;
  const vs = natural
    ? ` (natural ${natural.vOverflow} / ${natural.hOverflow})`
    : ` (natural size not measured)`;
  return {
    bad,
    line:
      `overflow   -> v=${zoomed.vOverflow} h=${zoomed.hOverflow}${vs}` +
      (bad
        ? `  ⚠ app overflows under zoom ${v.toFixed(3)}x / ${h.toFixed(3)}x ` +
          `beyond its natural layout (vh/vw it could not rewrite?) — HD capture will clip it`
        : `  ✓ layout fits`),
  };
}

/** Roots a floating popover renders into, across Radix, shadcn and antd. */
export const PORTAL_ROOTS = [
  "[data-radix-popper-content-wrapper]",
  "[data-slot=popover-content]",
  ".ant-dropdown",
  ".ant-select-dropdown",
  "[role=menu]",
  "[role=listbox]",
  "[role=dialog]",
];

export type PortalProblem = {
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  why: "wider than the viewport" | "outside the viewport";
};

/**
 * Every visible, floating (fixed/absolute, itself or an ancestor) popover
 * root that is wider than the viewport or pokes out of it, in the page's
 * native client px — which under the zoom is the recording's px, since a
 * Playwright evaluation sees native geometry. Outermost roots only, so a menu
 * inside its popper wrapper is reported once. `a` is the viewport as
 * Playwright reports it. Raw string for the same reason as CURSOR_INIT_SCRIPT.
 */
export const PORTAL_PROBE = `(a) => {
  var sels = ${JSON.stringify(PORTAL_ROOTS)};
  var floating = function (e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var p = getComputedStyle(n).position;
      if (p === "fixed" || p === "absolute") return true;
    }
    return false;
  };
  var found = [];
  for (var i = 0; i < sels.length; i++) {
    var els = document.querySelectorAll(sels[i]);
    for (var j = 0; j < els.length; j++) {
      var e = els[j], r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      var s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) continue;
      if (!floating(e)) continue;
      var why = r.width > a.vw + 1 ? "wider than the viewport"
        : r.left < -1 || r.top < -1 || r.right > a.vw + 1 || r.bottom > a.vh + 1 ? "outside the viewport"
        : null;
      if (why) found.push({ el: e, selector: sels[i], why: why,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
    }
  }
  return found
    .filter(function (f) { return !found.some(function (g) { return g !== f && g.el.contains(f.el); }); })
    .map(function (f) { return { selector: f.selector, why: f.why, rect: f.rect }; });
}`;

/** The warning for one probe result, worded for the shoot log. */
export function portalWarning(
  p: PortalProblem,
  after: string,
  viewport: Size,
  scale: number,
): string {
  const { x, y, w, h } = p.rect;
  return (
    `⚠ PORTAL ${p.why.toUpperCase()} after ${after}: ${p.selector} ` +
    `${w}x${h} at (${x}, ${y}) in a ${viewport.width}x${viewport.height} frame` +
    (scale > 1
      ? ` — the zoom may be double-applying its position; pin captureScale: 1 in the flow if it stays off-frame`
      : ``)
  );
}

/** How long after a beat the portal probe looks: popovers animate in first. */
const PORTAL_PROBE_DELAY_MS = 350;

/**
 * Wrap a flow context so every click, typing, focus and key beat is followed
 * by a portal probe — fired PORTAL_PROBE_DELAY_MS later and NOT awaited, so it
 * never adds to the shoot's timing. Each distinct problem is warned once.
 * Await `drain()` before the page closes.
 */
export function watchPortals(
  ctx: FlowContext,
  warn: (m: string) => void,
  scale: number,
): { ctx: FlowContext; drain: () => Promise<void> } {
  const { page } = ctx;
  const pending = new Set<Promise<void>>();
  const seen = new Set<string>();
  const probe = (after: string) => {
    const p = new Promise<void>((r) => setTimeout(r, PORTAL_PROBE_DELAY_MS))
      .then(async () => {
        const vp = page.viewportSize();
        if (!vp || page.isClosed()) return;
        const found = (await page.evaluate(
          `(${PORTAL_PROBE})(${JSON.stringify({ vw: vp.width, vh: vp.height })})`,
        )) as PortalProblem[];
        for (const f of found) {
          const key = `${f.selector}|${f.why}|${f.rect.w}x${f.rect.h}`;
          if (seen.has(key)) continue;
          seen.add(key);
          warn(portalWarning(f, after, vp, scale));
        }
      })
      // Navigation or teardown mid-probe: nothing to measure.
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  };
  const name = (t: unknown, label?: string) =>
    JSON.stringify(label ?? (typeof t === "string" ? t : "(target)"));
  const probed =
    <A extends unknown[]>(
      fn: (...a: A) => Promise<void>,
      what: (...a: A) => string,
    ) =>
    async (...a: A) => {
      await fn(...a);
      probe(what(...a));
    };
  return {
    ctx: {
      ...ctx,
      moveAndClick: probed(ctx.moveAndClick, (t, l) => `click ${name(t, l)}`),
      typeInto: probed(ctx.typeInto, (t, _x, l) => `typing ${name(t, l)}`),
      focus: probed(ctx.focus, (t, l) => `focus ${name(t, l)}`),
      pressKey: probed(ctx.pressKey, (k) => `key ${JSON.stringify(k)}`),
    },
    drain: async () => {
      await Promise.all([...pending]);
    },
  };
}
