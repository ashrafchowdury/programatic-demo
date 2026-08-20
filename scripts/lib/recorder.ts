import type { Page, Locator } from "playwright";
import { cameraEase } from "../../src/lib/camera";
import { DESIGN_WIDTH, type CursorSample, type KeyEvent } from "../../src/lib/click-log";
import type { ActionOpts, ClickEvent, FlowContext, Target } from "./flow";
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
/** Mean glide speed in design px per ms (~550 px/s at DESIGN_WIDTH). */
const GLIDE_PX_PER_MS = 0.55;
/** Below this the pointer teleports rather than glides. */
const GLIDE_MIN_PX = 6;

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
 * If the target is off-screen, scroll first and wait so the camera never moves
 * during the scroll.
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

async function boxOf(
  page: Page,
  target: ResolvedTarget,
): Promise<{ cx: number; cy: number; rect: Rect }> {
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
  const before = await loc.boundingBox();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box)
    throw new Error(
      `No bounding box for target: ${isCss(target) ? target.css : "<locator>"}`,
    );
  if (before && Math.hypot(box.x - before.x, box.y - before.y) > 8 * k) {
    await page.waitForTimeout(450);
  }
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
  };
}

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
 */
export function buildContext(
  page: Page,
  baseURL: string,
  clicks: ClickEvent[],
  getElapsedMs: () => number,
  cursor: CursorSample[] = [],
  targets?: TargetOverrides,
  keys: KeyEvent[] = [],
): FlowContext {
  const pause = (ms = 700) => page.waitForTimeout(ms);

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

  /** Record where the pointer is, so Remotion can redraw the path as vector. */
  const mark = (x: number, y: number) => {
    cursor.push({ t: getElapsedMs(), x: Math.round(x), y: Math.round(y) });
  };
  mark(last.x, last.y);

  const glideTo = async (
    x: number,
    y: number,
    settleMs = 220,
    travelMs?: number,
  ) => {
    const gk = captureScaleOf(page);
    const dist = Math.hypot(x - last.x, y - last.y);
    lastDepartMs = getElapsedMs();
    if (dist < GLIDE_MIN_PX * gk) {
      last = { x, y };
      mark(x, y);
      if (settleMs > 0) await pause(settleMs);
      return;
    }
    // ~550 px/s mean, clamped to the measured 450–1350 ms travel window — unless
    // the caller asks for a deliberate duration (a slow, felt move).
    const durationMs =
      travelMs != null && travelMs > 0
        ? travelMs
        : clamp(dist / (GLIDE_PX_PER_MS * gk), 450, 1350);
    const nx = -(y - last.y) / dist;
    const ny = (x - last.x) / dist;
    const side = (x - last.x) * (y - last.y) >= 0 ? 1 : -1;
    const bulge = side * dist * 0.1;
    const from = { ...last };

    // Overshoot-and-correct on long throws. Humans undershoot small targets and
    // overshoot distant ones, then make a short corrective sub-movement; a path
    // that arrives dead on target every time reads as machine-driven. The
    // reference cursors measure 0.245–0.953 straightness — never a clean 1.0.
    // Threshold and magnitude follow ghost-cursor (>500px, ~120px overshoot),
    // scaled down so the correction stays inside the target.
    // Clamped to the viewport: overshooting a target near an edge would push
    // the pointer off-screen and drop the hover state we are about to click.
    const vp = page.viewportSize();
    const overshooting = dist > OVERSHOOT_THRESHOLD_PX * gk;
    const aimX = overshooting
      ? clamp(x + ((x - from.x) / dist) * OVERSHOOT_PX * gk, 1, (vp?.width ?? x) - 1)
      : x;
    const aimY = overshooting
      ? clamp(
          y + ((y - from.y) / dist) * OVERSHOOT_PX * gk,
          1,
          (vp?.height ?? y) - 1,
        )
      : y;
    const cpx = (from.x + aimX) / 2 + nx * bulge;
    const cpy = (from.y + aimY) / 2 + ny * bulge;

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
    const travel = async (
      fromMs: number,
      spanMs: number,
      at: (p: number) => { px: number; py: number },
    ) => {
      for (;;) {
        const p01 = clamp((getElapsedMs() - fromMs) / spanMs, 0, 1);
        const { px, py } = at(cameraEase(p01));
        // Stamp before the move: getElapsedMs() after awaiting would fold the
        // dispatch latency into the sample time and skew the replayed path.
        mark(px, py);
        await page.mouse.move(px, py);
        if (p01 >= 1) return;
        await page.waitForTimeout(8);
      }
    };

    const glideStart = getElapsedMs();
    await travel(glideStart, durationMs, (p) => {
      const u = 1 - p;
      return {
        px: u * u * from.x + 2 * u * p * cpx + p * p * aimX,
        py: u * u * from.y + 2 * u * p * cpy + p * p * aimY,
      };
    });

    if (overshooting) {
      // Settle back onto the target. Short and eased, like a real correction.
      const correctStart = getElapsedMs();
      await travel(correctStart, 130, (p) => ({
        px: aimX + (x - aimX) * p,
        py: aimY + (y - aimY) * p,
      }));
    }

    last = { x, y };
    mark(x, y);
    if (settleMs > 0) await pause(settleMs);
  };

  const logEvent = (
    x: number,
    y: number,
    rect: Rect,
    label?: string,
    opts?: ActionOpts,
    tDownMs?: number,
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
    if (opts?.cluster != null) event.cluster = opts.cluster;
    if (opts?.zoom === false) event.zoom = false;
    if (opts?.zoomScale != null) event.zoomScale = opts.zoomScale;
    clicks.push(event);
    return event;
  };

  const clickAt = async (
    x: number,
    y: number,
    rect: Rect,
    label?: string,
    opts?: ActionOpts,
  ) => {
    const tDownMs = getElapsedMs();
    await page.mouse.down();
    await pause(80);
    await page.mouse.up();
    return logEvent(x, y, rect, label, opts, tDownMs);
  };

  const moveTo: FlowContext["moveTo"] = async (target) => {
    const { cx, cy } = await boxOf(page, await resolve(target));
    await glideTo(cx, cy, 120);
  };

  const focus: FlowContext["focus"] = async (target, label, opts) => {
    const point = await boxOf(page, await resolve(target));
    const frameBox = opts?.frame
      ? await boxOf(page, await resolve(opts.frame))
      : point;
    // Honour a slow, deliberate glide and a hover hold, same as moveAndClick.
    await glideTo(point.cx, point.cy, opts?.hoverMs ?? 220, opts?.travelMs);
    // Zoom keyframe only — no mouse click (safe for "consequence" holds).
    logEvent(
      point.cx,
      point.cy,
      frameBox.rect,
      label ?? (typeof target === "string" ? target : "focus"),
      opts,
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
    // hoverMs is the settle after arriving, before the press — a held hover.
    await glideTo(point.cx, point.cy, opts?.hoverMs ?? 220, opts?.travelMs);
    await clickAt(
      point.cx,
      point.cy,
      frameBox.rect,
      label ?? (typeof target === "string" ? target : undefined),
      opts,
    );
  };

  const typeInto: FlowContext["typeInto"] = async (
    selector,
    text,
    label,
    opts,
  ) => {
    const { cx, cy, rect } = await boxOf(page, await resolve(selector));
    // Same contract as moveAndClick / focus: `frame` decides what the camera
    // holds, the target decides where the pointer goes. Typing used to ignore
    // it, so a field inside a framed panel punched the camera in to the field
    // and back out again — a zoom lurch in the middle of an otherwise still
    // sequence, from an option the flow had already set.
    const frameRect = opts?.frame
      ? (await boxOf(page, await resolve(opts.frame))).rect
      : rect;
    await glideTo(cx, cy);
    const event = await clickAt(
      cx,
      cy,
      frameRect,
      label ?? (typeof selector === "string" ? selector : "field"),
      opts,
    );
    await pause(150);
    // Replace whatever is already in the field (tour replay, leftover composer).
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll);
    await page.keyboard.press("Backspace");
    // Faster than "hunt-and-peck" so typing is not the longest dead beat.
    //
    // An array types in chunks with a still beat between them. Select-all runs
    // ONCE, before the first chunk — a second one would wipe what came before,
    // which is why this cannot be expressed as two `type` steps.
    const chunks = typeof text === "string" ? [text] : text;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await pause(opts?.chunkPauseMs ?? 0);
      await page.keyboard.type(chunks[i], { delay: 30 });
    }
    // Marks the window where the app's text caret owns the screen, so Remotion
    // can fade the arrow out for it.
    event.typeEndMs = getElapsedMs();
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
    page_waitForURL: page.waitForURL.bind(page),
  };
}
