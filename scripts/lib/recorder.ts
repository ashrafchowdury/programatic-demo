import type { Page, Locator, Request } from "playwright";
import {
  DEFAULT_PLAYBACK_RATE,
  DESIGN_WIDTH,
  type CursorSample,
  type KeyEvent,
} from "../../src/lib/click-log";
import { earliestPressMs, poseFor, type Beat, type FramedBeat } from "./camera-room";
import type { ActionOpts, ClickEvent, FlowContext, Target } from "./flow";
import {
  GLIDE_MAX_MS,
  glideTravelMs,
  minJerk,
  planGlide,
  seededRandom,
  typingDelays,
} from "./humanize";
import { findByName, type TargetOverrides } from "./selectors";

/**
 * LEGACY in-page cursor. Injected via context.addInitScript on every navigation
 * to draw a fake pointer plus a mousedown ripple straight into the recorded
 * WebM. Because Playwright's `mouse.move(x, y)` dispatches real mousemove
 * events, it glides with the driver.
 *
 * Superseded by src/Cursor.tsx, which draws the pointer in Remotion from the
 * `cursorTrack` in the click log. That version stays sharp at any zoom (this
 * one is 1x pixels, upscaled with the footage) and moves on the composition's
 * 30fps clock rather than the source's 25fps. Set DEMO_BAKED_CURSOR=1 to fall
 * back to this — useful for debugging what the browser actually did, since it
 * shows the pointer without any Remotion involvement.
 *
 * NOTE: this is a raw JS STRING, not a function. Passing an imported function to
 * addInitScript is unsafe here — tsx/esbuild wraps functions with a `__name(...)`
 * helper (keepNames), and Playwright serializes via `fn.toString()`, so the page
 * would throw `__name is not defined` at document-start and the cursor would
 * silently never appear. A string sidesteps all bundler transforms.
 */
// Hotspot (arrow tip) inside the rendered 48x64 arrow SVG.
const ARROW_HOTX = 2;
const ARROW_HOTY = 2;

/** True when the pointer should be baked into the recording (legacy path). */
export const useBakedCursor = (): boolean =>
  process.env.DEMO_BAKED_CURSOR === "1";

/**
 * Straight-line distance above which the glide overshoots then corrects.
 *
 * DESIGN PX, scaled by captureScaleOf() at use. Like boxOf's thresholds these
 * were tuned at 1920 and the pointer moves in PHYSICAL viewport px, so under
 * CAPTURE_SCALE the same on-screen move covers `scale` times as many of them.
 * Left unscaled, a 2x shoot glided ~2x slower (measured: the Add-Anthropic hop
 * took 799ms at 1x and 1697ms at 2x) and overshot hops that never overshot
 * before — which moved every cursor departure and, through the camera's lead,
 * the whole zoom track.
 */
const OVERSHOOT_THRESHOLD_PX = 500;
/** How far past the target the overshoot reaches, before settling back. */
const OVERSHOOT_PX = 26;
/** Below this the pointer teleports rather than glides. */
const GLIDE_MIN_PX = 6;
/**
 * The most a glide is drawn out to give the camera room, as a fraction of its
 * own natural duration. Past this the pointer hovers on the target instead: a
 * 60px hop stretched to 1.5s reads as a pointer wading through syrup, while a
 * hover on the control reads as "about to click".
 */
const GLIDE_STRETCH = 0.4;
/** How often typing samples the caret (recording ms). */
const CARET_SAMPLE_MS = 250;
/**
 * A request younger than this counts toward "the network is busy". Anything
 * older is a long poll or a stream, which never finishes and would hold every
 * settle to its timeout.
 */
const LONG_REQUEST_MS = 5000;
/** Data requests must be quiet this long before a settle calls the page ready. */
const IDLE_MS = 250;
/**
 * Only a populated region smaller than this share of the viewport is logged as
 * `content`. On a dense page the content IS the viewport and framing toward
 * its centre would drag every zoom off its subject; the rect earns its place
 * only where there is blank page to avoid.
 */
const CONTENT_MAX_SHARE = 0.6;

export const CURSOR_INIT_SCRIPT = `
(() => {
  // Larger macOS-style arrow + strong halo so it stays readable on light UIs.
  var ARROW =
    '<svg width="48" height="64" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1 1 L1 23 L6.5 17.8 L10.2 26.6 L13.7 25 L9.95 16.5 L17 16.3 Z" ' +
    'fill="#111418" stroke="#ffffff" stroke-width="1.85" stroke-linejoin="round" ' +
    'paint-order="stroke"/></svg>';
  var HOTX = ${ARROW_HOTX}, HOTY = ${ARROW_HOTY};
  const mount = () => {
    if (document.getElementById('pw-cursor')) return;
    if (!document.body) return;
    const style = document.createElement('style');
    style.textContent =
      '* { cursor: none !important; } ' +
      '#pw-cursor{position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;' +
      'transform:translate(-300px,-300px);transform-origin:' + HOTX + 'px ' + HOTY + 'px;' +
      'filter:drop-shadow(0 0 0.5px #fff) drop-shadow(0 1px 0 #fff) drop-shadow(0 0 2px #fff) drop-shadow(0 5px 12px rgba(0,0,0,.6));} ' +
      '#pw-cursor svg{display:block;} ' +
      '.pw-ripple{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'border:2px solid rgba(15,23,42,.55);background:rgba(15,23,42,.1);' +
      'pointer-events:none;z-index:2147483646;animation:pw-ripple .35s ease-out forwards;} ' +
      '@keyframes pw-ripple{from{transform:scale(.3);opacity:.85;}to{transform:scale(1.35);opacity:0;}}';
    document.documentElement.appendChild(style);
    const c = document.createElement('div');
    c.id = 'pw-cursor';
    c.innerHTML = ARROW;
    document.body.appendChild(c);
    let x = -300, y = -300;
    const place = (s) => { c.style.transform = 'translate(' + (x - HOTX) + 'px,' + (y - HOTY) + 'px) scale(' + s + ')'; };
    document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(1); }, true);
    document.addEventListener('mousedown', () => {
      place(0.9);
      const r = document.createElement('div');
      r.className = 'pw-ripple';
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 380);
    }, true);
    document.addEventListener('mouseup', () => place(1), true);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`;

/** An element's on-screen rectangle (viewport CSS px). */
type Rect = { x: number; y: number; w: number; h: number };

/** A target with any name already resolved to something addressable. */
type ResolvedTarget = Exclude<Target, string>;

function isPoint(t: Target): t is { x: number; y: number } {
  return (
    typeof t === "object" &&
    t !== null &&
    "x" in t &&
    typeof (t as { x: unknown }).x === "number"
  );
}

function isCss(t: Target): t is { css: string } {
  return (
    typeof t === "object" &&
    t !== null &&
    "css" in t &&
    typeof (t as { css: unknown }).css === "string"
  );
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Resolve a target to its center point AND its bounding rect. The rect lets the
 * Remotion zoom frame the whole element (not stab a single pixel). Point targets
 * get a small synthetic rect so they still have a region to frame.
 *
 * If the target is off-screen, scroll first and wait until it stops moving, so
 * the camera never moves during the scroll and the rect is where it lands.
 */
/**
 * Capture-space scale: every px threshold below was tuned against a 1920 shoot,
 * and a rect is recorded in the PHYSICAL viewport. Under CAPTURE_SCALE that
 * viewport is 2560 or 3840 wide, so a fixed 48px "thin" test silently means a
 * different real-world size and the same control classifies differently.
 *
 * Measured: at 1920 the harness API-key field came back 36px tall, tripped the
 * thin test and was grown to a 72px band; at 3840 the same field measured 72px,
 * missed the test and stayed raw. Halved back it was 36 against 72 — and that
 * one rect moved the camera from 1.494 to 1.285 at that beat. Scaling the
 * thresholds keeps a 1x shoot byte-identical (k = 1) and makes an HD shoot
 * frame the same subject the same way.
 */
const captureScaleOf = (page: Page): number => {
  const vp = page.viewportSize();
  return vp && vp.width > 0 ? vp.width / DESIGN_WIDTH : 1;
};

/** Two reads of one rect within this (px) count as the same. */
const SAME_RECT_PX = 0.5;
const sameBox = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  Math.abs(a.x - b.x) < SAME_RECT_PX &&
  Math.abs(a.y - b.y) < SAME_RECT_PX &&
  Math.abs(a.width - b.width) < SAME_RECT_PX &&
  Math.abs(a.height - b.height) < SAME_RECT_PX;

async function boxOf(
  page: Page,
  target: ResolvedTarget,
): Promise<{ cx: number; cy: number; rect: Rect; loc?: Locator }> {
  const k = captureScaleOf(page);
  if (isPoint(target)) {
    return {
      cx: target.x,
      cy: target.y,
      rect: {
        x: target.x - 60 * k,
        y: target.y - 24 * k,
        w: 120 * k,
        h: 48 * k,
      },
    };
  }
  const loc: Locator = (
    isCss(target) ? page.locator(target.css) : target
  ).first() as Locator;
  await loc.waitFor({ state: "visible", timeout: 20000 });
  await loc.scrollIntoViewIfNeeded();
  // Re-measure until two reads agree. This used to read the box once, straight
  // after scrollIntoViewIfNeeded, and then sleep 450ms if it had moved — but
  // with smooth scrolling (`scroll-behavior: smooth`, or an app that animates
  // its own lists) that read is taken MID-SCROLL, so the pointer glided to
  // where the control was on the way past and the logged rect framed it there.
  // Waiting until the box stops moving covers smooth scroll, a layout that is
  // still settling, and an entrance animation, and costs one ~2-frame read
  // when nothing moves. Bounded (~1.5s) so a perpetually animating element
  // cannot hang the shoot.
  let box = await loc.boundingBox();
  for (let i = 0; i < 40 && box; i++) {
    await page.waitForTimeout(34);
    const again = await loc.boundingBox();
    if (again && sameBox(again, box)) break;
    box = again;
  }
  if (!box)
    throw new Error(
      `No bounding box for target: ${isCss(target) ? target.css : "<locator>"}`,
    );
  // Thin targets (result titles, chips) get expanded so Remotion frames a readable row.
  let rect: Rect = { x: box.x, y: box.y, w: box.width, h: box.height };
  if (rect.h < 48 * k) {
    const targetH = 72 * k;
    const grow = (targetH - rect.h) / 2;
    rect = {
      x: Math.max(0, rect.x - 24 * k),
      y: Math.max(0, rect.y - grow - 8 * k),
      w: rect.w + 48 * k,
      h: targetH,
    };
  }
  return {
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    rect,
    loc,
  };
}

/**
 * The populated region around a target, in the element's CLIENT px, plus the
 * target's own client rect so the caller can map it into the viewport px the
 * click log uses (those differ under the HD root zoom — see capture-scale.ts).
 *
 * HEURISTIC, kept cheap (one evaluate, at most 4000 elements walked):
 *
 *   1. The panel: walk up from the target to the first ancestor that is a
 *      popup (dialog, menu, listbox, a Radix popper), or a scroll container,
 *      form, main, section, aside, article, fieldset, tabpanel or grid that
 *      covers at least 20% of the viewport. Smaller semantic wrappers (a field
 *      group) are skipped: a content rect barely bigger than the target would
 *      tell frameFor to zoom all the way in on every click. Nothing found →
 *      the body.
 *   2. The content: the union of the panel's visible LEAVES — elements with
 *      no element children and some text, plus controls and media (input,
 *      textarea, select, button, contenteditable, img, svg, video, canvas —
 *      counted even when empty, since an empty field is content). Empty decorative
 *      boxes, hidden and transparent elements are skipped, so a full-height
 *      panel background does not count as content but the form inside it does.
 *   3. Clipped to the panel and the viewport.
 *
 * The viewport is passed in rather than read from innerWidth/innerHeight: under
 * the HD root zoom those report the LOGICAL size (capture-scale.ts overrides
 * them) while getBoundingClientRect reports zoomed px, and clipping one against
 * the other cut every content rect off at half the frame. `a.vw`/`a.vh` are
 * Playwright's viewport and `a.bw` the target's Playwright width, which give
 * the viewport in the probe's own px whatever the zoom is.
 *
 * A raw JS string for the same reason as CURSOR_INIT_SCRIPT: a function would
 * be serialised with esbuild's `__name` helper, which the page does not have.
 */
const CONTENT_PROBE = `(el, a) => {
  var tr = el.getBoundingClientRect();
  var k = tr.width > 0 ? a.bw / tr.width : 1;
  var vw = a.vw / k, vh = a.vh / k;
  var POPUP = 'dialog,[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]';
  var PANEL = 'form,main,[role=main],section,aside,article,fieldset,[role=tabpanel],[role=grid]';
  var MEDIA = /^(input|textarea|select|button|img|svg|video|canvas)$/i;
  var panel = null;
  for (var n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.matches(POPUP)) { panel = n; break; }
    var r = n.getBoundingClientRect();
    var cs = getComputedStyle(n);
    var scrolls = /(auto|scroll)/.test(cs.overflowY + ' ' + cs.overflowX) &&
      (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1);
    if ((scrolls || n.matches(PANEL)) && r.width * r.height >= 0.2 * vw * vh) { panel = n; break; }
  }
  panel = panel || document.body;
  var pr = panel.getBoundingClientRect();
  var cl = Math.max(0, pr.left), ct = Math.max(0, pr.top);
  var cr = Math.min(vw, pr.right), cb = Math.min(vh, pr.bottom);
  var l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity, seen = 0;
  var w = document.createTreeWalker(panel, NodeFilter.SHOW_ELEMENT);
  for (var e = w.nextNode(); e && seen < 4000; e = w.nextNode()) {
    seen++;
    var media = MEDIA.test(e.tagName) || e.isContentEditable;
    if (e.childElementCount > 0 && !media) continue;
    if (!media && !(e.textContent || '').trim()) continue;
    var q = e.getBoundingClientRect();
    if (q.width < 2 || q.height < 2) continue;
    if (q.right <= cl || q.left >= cr || q.bottom <= ct || q.top >= cb) continue;
    var s = getComputedStyle(e);
    if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    l = Math.min(l, q.left); t = Math.min(t, q.top);
    rr = Math.max(rr, q.right); b = Math.max(b, q.bottom);
  }
  if (!isFinite(l)) return null;
  l = Math.max(l, cl); t = Math.max(t, ct); rr = Math.min(rr, cr); b = Math.min(b, cb);
  if (rr <= l || b <= t) return null;
  return { content: { x: l, y: t, w: rr - l, h: b - t }, target: { x: tr.left, y: tr.top, w: tr.width, h: tr.height } };
}`;

type ProbeRect = { x: number; y: number; w: number; h: number };

/**
 * An element function built from a source string at RUNTIME, so esbuild never
 * sees it and cannot wrap it in `__name` (see CURSOR_INIT_SCRIPT). Playwright
 * serialises it with toString like any other function.
 */
const pageFn = <T, A = undefined>(src: string) =>
  new Function("el", "a", `return (${src})(el, a);`) as (el: Element, a: A) => T;

/**
 * Map a client-px rect into the viewport px Playwright reports, using the
 * target measured both ways as the reference. Identity at capture scale 1.
 */
const toViewport = (
  r: ProbeRect,
  client: ProbeRect,
  box: { x: number; y: number; w: number; h: number },
): Rect => {
  const kx = client.w > 0 ? box.w / client.w : 1;
  const ky = client.h > 0 ? box.h / client.h : 1;
  return {
    x: box.x + (r.x - client.x) * kx,
    y: box.y + (r.y - client.y) * ky,
    w: r.w * kx,
    h: r.h * ky,
  };
};

/** ClickEvent.content for a target, or undefined when it would not help. */
async function contentOf(page: Page, loc?: Locator): Promise<Rect | undefined> {
  if (!loc) return undefined;
  try {
    const box = await loc.boundingBox();
    const vp = page.viewportSize();
    if (!box || !vp) return undefined;
    const probe = await loc.evaluate(
      pageFn<
        { content: ProbeRect; target: ProbeRect } | null,
        { vw: number; vh: number; bw: number }
      >(CONTENT_PROBE),
      { vw: vp.width, vh: vp.height, bw: box.width },
    );
    if (!probe) return undefined;
    const c = toViewport(probe.content, probe.target, {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
    });
    if (c.w * c.h > CONTENT_MAX_SHARE * vp.width * vp.height) return undefined;
    return c;
  } catch {
    // Best-effort: a detached node or a navigation mid-probe just means no
    // content rect, and framing falls back to the click alone.
    return undefined;
  }
}

/**
 * Where typed text is going, in client px: the caret for a contenteditable
 * (collapsed ranges can measure empty, so fall back to their client rects and
 * then the element), the focused field itself for an input or textarea.
 */
const CARET_PROBE = `(() => {
  var a = document.activeElement;
  if (!a || a === document.body) return null;
  var r = null;
  if (a.isContentEditable) {
    var sel = getSelection();
    if (sel && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      r = range.getBoundingClientRect();
      if (!r || r.height === 0) { var rs = range.getClientRects(); r = rs.length ? rs[rs.length - 1] : null; }
      if (r && r.height === 0) r = null;
    }
  }
  if (!r) r = a.getBoundingClientRect();
  return { x: r.left, y: r.top, w: Math.max(1, r.width), h: r.height };
})()`;

/** A target's client rect (to map probe output; see toViewport). */
const CLIENT_RECT = `(el) => { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }`;

const roundRect = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});

/**
 * Builds the helper set a flow uses. `clicks`, `cursor` and `getElapsedMs` are
 * shared so every logged click and pointer sample is timestamped against the
 * recording start.
 *
 * `seed` makes the pointer's bows, overshoots and typing rhythm reproducible:
 * each action draws from `seed#<index>`, so re-shooting a flow draws the same
 * paths. Pass the flow's name; it defaults to `baseURL`, which is stable per
 * flow too, just less readable.
 */
export function buildContext(
  page: Page,
  baseURL: string,
  clicks: ClickEvent[],
  getElapsedMs: () => number,
  cursor: CursorSample[] = [],
  targets?: TargetOverrides,
  keys: KeyEvent[] = [],
  seed: string = baseURL || "demo",
): FlowContext {
  const pause = (ms = 700) => page.waitForTimeout(ms);
  /** Recording ms per screen ms. Glides and scrolls are authored on screen. */
  const rate = DEFAULT_PLAYBACK_RATE;
  /** Index of the next seeded action — the "step index" in the seed. */
  let actionIndex = 0;
  const nextRandom = (kind: string) => seededRandom(`${seed}#${kind}${actionIndex++}`);

  /**
   * Press a chord and log it, so the full-bleed look can draw a keycap.
   *
   * Logged into its own array rather than into `clicks`: a chord is not a
   * pointer target, and folding it in would give the zoom camera a keyframe
   * with no rect and fire the click SFX detector. See KeyEvent in
   * src/lib/click-log.ts.
   */
  const pressKey: FlowContext["pressKey"] = async (chord, label) => {
    const tMs = getElapsedMs();
    await page.keyboard.press(chord);
    keys.push(label ? { tMs, chord, label } : { tMs, chord });
  };

  const find: FlowContext["find"] = (name) => findByName(page, name, targets);

  /**
   * Turn a name into something boxOf can measure. Everything else passes
   * through untouched, so a flow that already holds a Locator pays nothing.
   */
  const resolve = async (target: Target): Promise<ResolvedTarget> =>
    typeof target === "string" ? await find(target) : target;

  // Track the cursor so each glide starts where the last ended (continuous motion,
  // no jumps between actions). Default to viewport center — always on-screen.
  let last = { x: 960, y: 540 };
  let lastDepartMs = 0;
  /** The last zoomable beat and the pose the camera will give it. */
  let framed: FramedBeat | null = null;

  /** Record where the pointer is, so Remotion can redraw the path as vector. */
  const mark = (x: number, y: number, wheel?: number) => {
    const s: CursorSample = { t: getElapsedMs(), x: Math.round(x), y: Math.round(y) };
    if (wheel) s.wheel = Math.round(wheel);
    cursor.push(s);
  };
  mark(last.x, last.y);

  const viewport = () =>
    page.viewportSize() ?? {
      width: DESIGN_WIDTH * captureScaleOf(page),
      height: Math.round((DESIGN_WIDTH * captureScaleOf(page) * 9) / 16),
    };

  /**
   * Glide to (x, y), then hold `settleMs` before returning.
   *
   * With `beat` — the target about to be pressed — the press is also held back
   * until the camera can arrive unhurried (see camera-room.ts). The glide
   * stretches first, by up to GLIDE_STRETCH of itself; the rest becomes hover.
   * Measured by replaying every public click log through this timing (glides
   * on screen time, presses at earliestPressMs, later beats shifted): camera
   * moves squeezed under 550ms on screen fell from 6/75 to 0/75 (excluding
   * google-search, a log with no departure times), kicks from rest 16 → 5,
   * jerk spikes 51 → 36, worst first-frame share of peak 44% → 26%; the
   * recordings grew 8.9% (7.0% of it the on-screen glide timing alone).
   */
  const glideTo = async (
    x: number,
    y: number,
    settleMs = 220,
    travelMs?: number,
    beat?: Beat,
  ) => {
    const gk = captureScaleOf(page);
    const vp = viewport();
    const dist = Math.hypot(x - last.x, y - last.y);
    lastDepartMs = getElapsedMs();
    const needPressMs = beat
      ? earliestPressMs(beat, lastDepartMs, framed, vp, rate)
      : 0;
    const hold = async () => {
      const ms = Math.max(settleMs, needPressMs - getElapsedMs());
      if (ms > 0) await pause(ms);
    };
    const seedKey = `${seed}#glide${actionIndex++}`;
    if (dist < GLIDE_MIN_PX * gk) {
      last = { x, y };
      mark(x, y);
      await hold();
      return;
    }
    // Overshoot-and-correct on long throws. Humans undershoot small targets and
    // overshoot distant ones, then make a short corrective sub-movement; a path
    // that arrives dead on target every time reads as machine-driven. The
    // reference cursors measure 0.245–0.953 straightness — never a clean 1.0.
    // Threshold and magnitude follow ghost-cursor (>500px, ~120px overshoot),
    // scaled down so the correction stays inside the target. planGlide keeps
    // the overshoot inside the viewport: pushing the pointer off-screen would
    // drop the hover state we are about to click.
    const overshootPx =
      dist > OVERSHOOT_THRESHOLD_PX * gk ? OVERSHOOT_PX * gk : 0;
    const explicit = travelMs != null && travelMs > 0;
    const plan = (ms: number) =>
      planGlide(last, { x, y }, {
        durationMs: ms,
        rand: seededRandom(seedKey),
        overshootPx,
        bounds: vp,
      });
    // ~550 px/s on screen, clamped to the measured 450–1350 ms window, timed on
    // the screen clock — unless the caller asks for a deliberate duration.
    let T = explicit ? travelMs : glideTravelMs(dist / gk, rate);
    let path = plan(T);
    const short = needPressMs - (lastDepartMs + path.durationMs + settleMs);
    if (short > 0 && !explicit) {
      const stretch = Math.min(short, T * GLIDE_STRETCH, GLIDE_MAX_MS * rate - T);
      if (stretch > 0) {
        T += stretch;
        path = plan(T);
      }
    }

    /**
     * Drive the path off the WALL CLOCK, not a fixed step count.
     *
     * The obvious loop — N steps of `mouse.move` then `waitForTimeout(16)` —
     * silently runs long, because each CDP `mouse.move` round-trip costs its own
     * ~20ms that the 16ms sleep does not account for. Measured: a glide asking
     * for 1350ms took 3060ms, so every pointer move in the demo ran at roughly
     * half the intended speed (~250 px/s against a 300–900 px/s reference band)
     * and padded the clip with slow travel. Sampling against elapsed time makes
     * the glide take the time it asks for on any machine, emitting however many
     * samples the round-trip latency allows.
     */
    const glideStart = getElapsedMs();
    for (;;) {
      const ms = Math.min(getElapsedMs() - glideStart, path.durationMs);
      const { x: px, y: py } = path.at(ms);
      // Stamp before the move: getElapsedMs() after awaiting would fold the
      // dispatch latency into the sample time and skew the replayed path.
      mark(px, py);
      await page.mouse.move(px, py);
      if (ms >= path.durationMs) break;
      await page.waitForTimeout(8);
    }

    last = { x, y };
    mark(x, y);
    await hold();
  };

  const logEvent = (
    x: number,
    y: number,
    rect: Rect,
    label?: string,
    opts?: ActionOpts,
    tDownMs?: number,
    content?: Rect,
  ) => {
    const event: ClickEvent = {
      label,
      tMs: getElapsedMs(),
      tDepartMs: lastDepartMs,
      x: Math.round(x),
      y: Math.round(y),
      rect: roundRect(rect),
    };
    // Only real clicks get a press time; `focus()` beats place a zoom keyframe
    // without clicking, and must not draw a ripple.
    if (tDownMs != null) event.tDownMs = tDownMs;
    if (content) event.content = roundRect(content);
    if (opts?.cluster != null) event.cluster = opts.cluster;
    if (opts?.zoom === false) event.zoom = false;
    if (opts?.zoomScale != null) event.zoomScale = opts.zoomScale;
    clicks.push(event);
    if (event.zoom !== false) framed = { event, pose: poseFor(event, viewport()) };
    return event;
  };

  const clickAt = async (
    x: number,
    y: number,
    rect: Rect,
    label?: string,
    opts?: ActionOpts,
    content?: Rect,
  ) => {
    const tDownMs = getElapsedMs();
    await page.mouse.down();
    await pause(80);
    await page.mouse.up();
    return logEvent(x, y, rect, label, opts, tDownMs, content);
  };

  /** What the camera will be asked to frame for this beat. */
  const beatOf = (
    x: number,
    y: number,
    rect: Rect,
    opts?: ActionOpts,
    content?: Rect,
  ): Beat => ({
    x,
    y,
    rect,
    content,
    cluster: opts?.cluster,
    zoom: opts?.zoom,
    zoomScale: opts?.zoomScale,
  });

  const moveTo: FlowContext["moveTo"] = async (target) => {
    const { cx, cy } = await boxOf(page, await resolve(target));
    await glideTo(cx, cy, 120);
  };

  const focus: FlowContext["focus"] = async (target, label, opts) => {
    const point = await boxOf(page, await resolve(target));
    const frameBox = opts?.frame
      ? await boxOf(page, await resolve(opts.frame))
      : point;
    const content = await contentOf(page, point.loc);
    // Honour a slow, deliberate glide and a hover hold, same as moveAndClick.
    await glideTo(
      point.cx,
      point.cy,
      opts?.hoverMs ?? 220,
      opts?.travelMs,
      beatOf(point.cx, point.cy, frameBox.rect, opts, content),
    );
    // Zoom keyframe only — no mouse click (safe for "consequence" holds).
    logEvent(
      point.cx,
      point.cy,
      frameBox.rect,
      label ?? (typeof target === "string" ? target : "focus"),
      opts,
      undefined,
      content,
    );
  };

  const moveAndClick: FlowContext["moveAndClick"] = async (
    target,
    label,
    opts,
  ) => {
    const point = await boxOf(page, await resolve(target));
    const frameBox = opts?.frame
      ? await boxOf(page, await resolve(opts.frame))
      : point;
    const content = await contentOf(page, point.loc);
    // hoverMs is the settle after arriving, before the press — a held hover.
    await glideTo(
      point.cx,
      point.cy,
      opts?.hoverMs ?? 220,
      opts?.travelMs,
      beatOf(point.cx, point.cy, frameBox.rect, opts, content),
    );
    await clickAt(
      point.cx,
      point.cy,
      frameBox.rect,
      label ?? (typeof target === "string" ? target : undefined),
      opts,
      content,
    );
  };

  const typeInto: FlowContext["typeInto"] = async (
    selector,
    text,
    label,
    opts,
  ) => {
    const { cx, cy, rect, loc } = await boxOf(page, await resolve(selector));
    // Same contract as moveAndClick / focus: `frame` decides what the camera
    // holds, the target decides where the pointer goes. Typing used to ignore
    // it, so a field inside a framed panel punched the camera in to the field
    // and back out again — a zoom lurch in the middle of an otherwise still
    // sequence, from an option the flow had already set.
    const frameRect = opts?.frame
      ? (await boxOf(page, await resolve(opts.frame))).rect
      : rect;
    const content = await contentOf(page, loc);
    await glideTo(cx, cy, 220, undefined, beatOf(cx, cy, frameRect, opts, content));
    const event = await clickAt(
      cx,
      cy,
      frameRect,
      label ?? (typeof selector === "string" ? selector : "field"),
      opts,
      content,
    );
    await pause(150);
    // Replace whatever is already in the field (tour replay, leftover composer).
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll);
    await page.keyboard.press("Backspace");

    // Caret samples are probed in client px; map them into the log's viewport
    // px through the field measured both ways (identity at capture scale 1).
    const [client, raw] = loc
      ? await Promise.all([
          loc.evaluate(pageFn<ProbeRect>(CLIENT_RECT)).catch(() => null),
          loc.boundingBox().catch(() => null),
        ])
      : [null, null];
    const toLog = (r: ProbeRect): Rect =>
      client && raw
        ? toViewport(r, client, { x: raw.x, y: raw.y, w: raw.width, h: raw.height })
        : r;
    const caret: NonNullable<ClickEvent["caret"]> = [];
    let lastCaretMs = -Infinity;
    const sampleCaret = async () => {
      lastCaretMs = getElapsedMs();
      const r = (await page.evaluate(CARET_PROBE).catch(() => null)) as ProbeRect | null;
      if (!r) return;
      const v = roundRect(toLog(r));
      caret.push({ tMs: Math.round(lastCaretMs), ...v });
    };

    // Humanised typing: seeded per-key jitter and word-boundary pauses, with
    // the total kept at the old ~33 ms/char (see typingDelays). Keys are placed
    // on an ABSOLUTE schedule, like the glide, so the CDP round trip of each key
    // and each caret probe is absorbed rather than added to the beat.
    //
    // An array types in chunks with a still beat between them. Select-all runs
    // ONCE, before the first chunk — a second one would wipe what came before,
    // which is why this cannot be expressed as two `type` steps.
    const rand = nextRandom("type");
    const chunks = typeof text === "string" ? [text] : text;
    await sampleCaret();
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await pause(opts?.chunkPauseMs ?? 0);
      const chars = [...chunks[i]];
      const delays = typingDelays(chunks[i], rand);
      let due = getElapsedMs();
      for (let j = 0; j < chars.length; j++) {
        due += delays[j];
        const wait = due - getElapsedMs();
        if (wait > 1) await page.waitForTimeout(wait);
        await page.keyboard.type(chars[j]);
        if (getElapsedMs() - lastCaretMs >= CARET_SAMPLE_MS) await sampleCaret();
      }
    }
    await sampleCaret();
    if (caret.length) event.caret = caret;
    // Marks the window where the app's text caret owns the screen, so Remotion
    // can fade the arrow out for it.
    event.typeEndMs = getElapsedMs();
  };

  const scroll: FlowContext["scroll"] = async (dy, opts) => {
    if (opts?.over != null) {
      const { cx, cy } = await boxOf(page, await resolve(opts.over));
      await glideTo(cx, cy, 120);
    }
    if (!dy) return;
    // An eased run of small wheel ticks, not one jump. ~1.6 ms of screen time
    // per px plus a floor, so a 200px nudge takes ~570 ms on screen and a long
    // scroll tops out at 900: a flick of the wrist, not a crawl.
    const spanMs =
      (opts?.durationMs ?? clamp(250 + Math.abs(dy) * 1.6, 350, 900)) * rate;
    const t0 = getElapsedMs();
    let sent = 0;
    for (;;) {
      const p = clamp((getElapsedMs() - t0) / spanMs, 0, 1);
      const want = Math.round(dy * minJerk(p));
      const delta = want - sent;
      if (delta !== 0) {
        mark(last.x, last.y, delta);
        await page.mouse.wheel(0, delta);
        sent = want;
      }
      if (p >= 1) break;
      await page.waitForTimeout(16);
    }
    await scrollStill();
    mark(last.x, last.y);
  };

  /**
   * Wait until the scroll container under the pointer stops moving: two reads
   * of its scroll offset, a couple of frames apart, that agree. The browser can
   * still be animating the last wheel ticks (smooth scrolling) when the loop
   * above returns. Bounded at ~1s.
   */
  const scrollStill = async () => {
    const probe = `(() => {
      var e = document.elementFromPoint(${Math.round(last.x)}, ${Math.round(last.y)});
      for (; e; e = e.parentElement) {
        var cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight) return e.scrollTop;
      }
      return (document.scrollingElement || document.documentElement).scrollTop;
    })()`;
    let prev = await page.evaluate(probe).catch(() => null);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(34);
      const now = await page.evaluate(probe).catch(() => null);
      if (now === prev) return;
      prev = now;
    }
  };

  // Data requests in flight, for settle(). Registered once per context; a
  // stale entry (a request that never reports back) ages out after
  // LONG_REQUEST_MS, so it cannot hold settle() to its timeout forever.
  const inflight = new Map<Request, number>();
  let lastNetMs = Date.now();
  const isData = (r: Request) => {
    const t = r.resourceType();
    return t === "fetch" || t === "xhr" || t === "document";
  };
  page.on("request", (r) => {
    if (!isData(r)) return;
    inflight.set(r, Date.now());
    lastNetMs = Date.now();
  });
  const done = (r: Request) => {
    if (inflight.delete(r)) lastNetMs = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);

  /** Anything interactive the pointer could be hovering or showing a tooltip for. */
  const HOVERABLE =
    "button,a[href],[role=button],[role=menuitem],[role=option],[role=tab],[role=link],[role=checkbox],[role=switch],[title],[aria-describedby],[data-state]";

  const parkPointer = async () => {
    // Drop focus from a clicked control: a tooltip that opens on focus (Radix
    // does) stays up as long as the button keeps focus — which, after a menu
    // closes and hands focus back to its trigger, is until something else is
    // clicked. Text fields keep theirs; they are where typing is about to go.
    await page
      .evaluate(
        `(() => { var a = document.activeElement;
          if (a && a !== document.body && !a.isContentEditable &&
              !/^(input|textarea|select)$/i.test(a.tagName) && a.blur) a.blur(); })()`,
      )
      .catch(() => {});
    const hoveredAt = (x: number, y: number) =>
      `(() => { var e = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
        return !!(e && e.closest(${JSON.stringify(HOVERABLE)})); })()`;
    const box = await page
      .evaluate(
        `(() => { var e = document.elementFromPoint(${Math.round(last.x)}, ${Math.round(last.y)});
          e = e && e.closest(${JSON.stringify(HOVERABLE)});
          if (!e) return null; var r = e.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
      )
      .catch(() => null) as ProbeRect | null;
    if (!box) return;
    // The nearest spot just outside the hovered control that is not itself
    // hoverable — below, above, right, then left of it.
    const k = captureScaleOf(page);
    const gap = 28 * k;
    const vp = viewport();
    const spots = [
      { x: last.x, y: box.y + box.h + gap },
      { x: last.x, y: box.y - gap },
      { x: box.x + box.w + gap, y: last.y },
      { x: box.x - gap, y: last.y },
    ].filter((p) => p.x > 8 && p.y > 8 && p.x < vp.width - 8 && p.y < vp.height - 8);
    for (const p of spots) {
      if (!(await page.evaluate(hoveredAt(p.x, p.y)).catch(() => true))) {
        await glideTo(p.x, p.y, 0);
        return;
      }
    }
  };

  const settle: FlowContext["settle"] = async (opts = {}) => {
    const t0 = Date.now();
    const timeoutMs = opts.timeoutMs ?? 4000;
    const left = () => Math.max(0, timeoutMs - (Date.now() - t0));
    const ready = opts.ready;
    if (typeof ready === "function") {
      while (!(await ready(page).catch(() => false))) {
        if (left() === 0)
          throw new Error(`settle: ready() still false after ${timeoutMs}ms`);
        await page.waitForTimeout(100);
      }
    } else if (ready != null) {
      const r = await resolve(ready);
      if (!isPoint(r))
        await (isCss(r) ? page.locator(r.css) : r)
          .first()
          .waitFor({ state: "visible", timeout: Math.max(1, left()) });
    }
    if (opts.idle !== false) {
      for (;;) {
        const now = Date.now();
        const busy = [...inflight.values()].some((t) => now - t < LONG_REQUEST_MS);
        if (!busy && now - lastNetMs >= IDLE_MS) break;
        if (left() === 0) break; // a busy app is filmed rather than failing the take
        await page.waitForTimeout(50);
      }
    }
    // Let whatever the data changed actually paint before the next beat.
    await page
      .evaluate(
        "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))",
      )
      .catch(() => {});
    if (opts.parkPointer) await parkPointer();
  };

  return {
    page,
    baseURL,
    moveAndClick,
    typeInto,
    moveTo,
    focus,
    find,
    pause,
    pressKey,
    scroll,
    settle,
    page_waitForURL: page.waitForURL.bind(page),
  };
}
