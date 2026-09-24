/**
 * The in-page half of a cutout: leave one element painting, then measure what
 * it painted.
 *
 * Both functions run INSIDE the page through Playwright's evaluate, so they
 * are closure-free — no imports, no outer variables — and the types are the
 * DOM's, not Node's. Nothing here is unit-tested for that reason; the smoke
 * shots exercise it end to end.
 *
 * WHY THEY ARE BUILT WITH `new Function`
 * Playwright serialises a page function with `toString()`, and tsx/esbuild
 * wraps every named function in a `__name(...)` helper that does not exist in
 * the page (see recorder.ts for the same trap). The rest of this repo passes
 * page code as string IIFEs, but these two need an ARGUMENT — the element, the
 * PNG — and Playwright only calls a string's result when it was handed a real
 * function. A function constructed at runtime from source is both: esbuild
 * never sees its body, and `toString()` returns it verbatim.
 *
 * WHY VISIBILITY AND NOT DISPLAY
 * `display: none` removes a box from layout, and everything else would reflow
 * around the hole — the element would be photographed in a place it never sits.
 * `visibility: hidden` keeps every box exactly where it is and paints nothing
 * for it: no background, border, shadow or text. It inherits, and a descendant
 * may override it, which is exactly the lever: hide everything, then show the
 * target and whatever inside it was visible to begin with. An intentionally
 * hidden tooltip inside the target stays hidden because it was never marked.
 *
 * WHY THE ROOT BACKGROUND NEEDS ITS OWN RULE
 * The canvas is painted from the root (or body) background regardless of any
 * box's visibility — Blink propagates it. So the sheet clears both explicitly;
 * omitBackground on the screenshot then leaves genuine alpha behind the element.
 *
 * WHY TRANSITIONS ARE KILLED
 * `visibility` is animatable. A `transition: all .3s` keeps an element painting
 * for the whole ramp after it is set hidden, and a screenshot taken inside that
 * window catches it half-gone.
 *
 * WHY THE HOVERED ELEMENT STAYS HIT-TESTABLE
 * A hidden box is not hit-tested, so hiding the page changes which element is
 * under the pointer, and Chromium then dispatches the boundary events
 * (mouseout/leave) on its next deferred fake mouse move. Anything open on
 * hover — a submenu, a tooltip, a hover card — closes on that event and the
 * screenshot finds nothing. Measured: the same submenu survived at 2x and
 * vanished at 4x, purely because the larger screenshot took longer than the
 * timer. So the deepest `:hover` element, when it is not part of what is
 * kept, is left visible at opacity 0: it paints nothing and still hit-tests,
 * so the pointer target never changes and no event fires.
 *
 * WHY TRANSLUCENT FILLS ARE FLATTENED
 * Design systems paint surfaces as tints — `bg-muted/50`, a 4% black hover — that
 * only look right over the page behind them. Take the page away and a grey
 * input card becomes frosted glass with the backdrop showing through. So every
 * shown element whose background has 0 < alpha < 1 gets that colour composited
 * over whatever was behind it in the page (its nearest opaque ancestor, else
 * the page ground) and set opaque, parents before children so a tint over a
 * tint resolves in order. A box with NO fill but a visible border or shadow is
 * a surface too — the page showed through it and read as its fill — so it gets
 * the ground colour outright. Gradients and backdrop-filter are left alone.
 *
 * Only what the PAGE showed through is replaced. When something inside the
 * kept subtree already paints an opaque fill behind a box — a bordered header
 * inside a white menu — that fill survives isolation and the box is left as it
 * was. Filling it anyway paints a square over a parent that rounds its corners
 * without clipping (no overflow:hidden), and the corners poke out.
 * shots/smoke-popover.ts is the offline check for that and for oklch() fills.
 */

export type IsolateResult = {
  /** The kept elements' border box (their union), CSS px, viewport-relative. */
  box: { x: number; y: number; width: number; height: number };
  /**
   * Every ancestor that clips its subtree's paint (overflow, clip-path,
   * contain), with its padding box. A shadow that reaches one of these edges
   * has been cut by it, and the capture side says so.
   */
  clippers: {
    label: string;
    box: { x: number; y: number; width: number; height: number };
  }[];
};

export const isolateInPage = new Function(
  "el",
  "extras",
  `
  const rect = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
  const visible = (n) => getComputedStyle(n).visibility === "visible";
  // Every root kept: the element, plus any the shot named alongside it — a
  // popover with its submenu, a menu with the control it opened from.
  const roots = [el, ...(extras || [])];

  // Judge visibility BEFORE the sheet goes in, or everything reads hidden.
  const show = roots.flatMap((r) => [r, ...Array.from(r.querySelectorAll("*"))]).filter(visible);

  // Flatten translucent fills over what was behind them, while it is still there.
  // Computed colours keep their authored space: oklch(), oklab(), color(),
  // hsl() come back as written, not as rgb(). The rgb() form is read directly;
  // anything else is painted into a 1x1 canvas and read back as sRGB bytes,
  // which is Chromium's own conversion (gamut-clipped, alpha to 1/255).
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  probe.canvas.width = probe.canvas.height = 1;
  const parse = (c) => {
    if (!c) return null;
    const m = /^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)$/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    // An invalid colour leaves fillStyle unchanged; a sentinel tells the two apart.
    probe.fillStyle = "#010203";
    probe.fillStyle = c;
    if (probe.fillStyle === "#010203" && !/^#010203$/i.test(c)) return null;
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => Math.round(top[i] * a + under[i] * (1 - a)));
  };
  // The colour behind an element: nearest ancestor with any fill, else white.
  const ground = (n) => {
    for (let a = n.parentElement; a; a = a.parentElement) {
      const c = parse(getComputedStyle(a).backgroundColor);
      if (c && c[3] > 0) return c[3] < 1 ? [...over(c, [255, 255, 255]), 1] : c;
    }
    return [255, 255, 255, 1];
  };
  const isSurface = (cs) => {
    if (cs.boxShadow !== "none") return true;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const bc = parse(cs["border" + side + "Color"]);
      if (parseFloat(cs["border" + side + "Width"]) > 0 && bc && bc[3] > 0) return true;
    }
    return false;
  };
  // Does something INSIDE what is kept already paint an opaque fill behind n?
  // Then the colour that showed through n was never the page's, it survives
  // isolation, and n needs no fill of its own. Walk up to the kept root that
  // holds n and no further. Without this a bordered header in a rounded menu
  // that does not clip (no overflow:hidden) got a square opaque fill, and its
  // corners poked past the menu's rounded ones.
  const kept = new Set(show);
  const isRoot = new Set(roots);
  const covered = (n) => {
    if (isRoot.has(n)) return false;
    for (let a = n.parentElement; a; a = a.parentElement) {
      if (kept.has(a)) {
        const c = parse(getComputedStyle(a).backgroundColor);
        if (c && c[3] === 1) return true;
      }
      if (isRoot.has(a)) return false;
    }
    return false;
  };
  // Parents before children (document order), so an ancestor flattened here
  // already reads opaque when its descendants ask.
  for (const n of show) {
    const cs = getComputedStyle(n);
    const c = parse(cs.backgroundColor);
    if (!c || c[3] === 1) continue;
    if (c[3] === 0 && !isSurface(cs)) continue;
    if (covered(n)) continue;
    const [r, g, b] = c[3] === 0 ? ground(n) : over(c, ground(n));
    n.style.setProperty("background-color", "rgb(" + r + "," + g + "," + b + ")", "important");
  }

  const clippers = [];
  for (let a = el.parentElement; a; a = a.parentElement) {
    const cs = getComputedStyle(a);
    const clips =
      (cs.overflow !== "visible" && a !== document.documentElement && a !== document.body) ||
      cs.clipPath !== "none" ||
      cs.contain.includes("paint") ||
      cs.contain === "strict" ||
      cs.contain === "content";
    if (!clips) continue;
    const id = a.id ? "#" + a.id : "";
    const cls = a.classList.length ? "." + Array.from(a.classList).slice(0, 2).join(".") : "";
    clippers.push({
      label: a.tagName.toLowerCase() + id + cls,
      box: rect(a.getBoundingClientRect()),
    });
  }

  const hovered = Array.from(document.querySelectorAll(":hover"));
  const underPointer = hovered[hovered.length - 1];
  if (underPointer && !show.includes(underPointer)) underPointer.setAttribute("data-shot-hit", "");

  const style = document.createElement("style");
  style.id = "__shot_isolate__";
  style.textContent =
    "*,*::before,*::after{visibility:hidden!important;transition:none!important;animation:none!important}" +
    "html,body{background:transparent!important}" +
    "[data-shot-show],[data-shot-show]::before,[data-shot-show]::after{visibility:visible!important}" +
    "[data-shot-hit]{visibility:visible!important;opacity:0!important}";
  for (const n of show) n.setAttribute("data-shot-show", "");
  document.head.appendChild(style);

  // The body is the union of the roots' border boxes.
  const rs = roots.map((r) => r.getBoundingClientRect());
  const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
  const box = {
    x, y,
    width: Math.max(...rs.map((r) => r.right)) - x,
    height: Math.max(...rs.map((r) => r.bottom)) - y,
  };
  return { box, clippers };
`,
) as (el: Element, extras?: Element[]) => IsolateResult;

/**
 * Tight bounding box of every pixel with alpha > 0, in the PNG's own pixels, or
 * null if nothing was painted.
 *
 * Decoded by the browser rather than by Node: the PNG comes back into the page
 * as a Blob, is drawn on an OffscreenCanvas, and its alpha channel is scanned.
 * That is Chromium's own decoder, and nothing touches the DOM — so the
 * isolation sheet cannot hide it, and no PNG library is needed on either side.
 *
 * No threshold. Skia clips a blur at three sigma, so a shadow's painted extent
 * is finite and exact; alpha > 0 is the true edge.
 */
export const alphaBoundsInPage = new Function(
  "base64Png",
  `return (async () => {
  const bin = atob(base64Png);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    premultiplyAlpha: "none",
  });
  const width = bitmap.width, height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  let minX = width, minY = height, maxX = -1, maxY = -1;
  // Row bands, so a 4x viewport (over 100 MB of RGBA) never sits in one buffer.
  const BAND = 64;
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const rows = Math.min(BAND, height - y0);
    const data = ctx.getImageData(0, y0, width, rows).data;
    for (let r = 0; r < rows; r++) {
      const row = r * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] === 0) continue;
        const y = y0 + r;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
})();`,
) as (
  base64Png: string,
) => Promise<{ x: number; y: number; width: number; height: number } | null>;
