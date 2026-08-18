/**
 * Self-tour: capture the selectors a human clicks, then replay them through
 * FlowContext so the recorded clip still gets the fake cursor + zoom log.
 *
 *   DEMO_TOUR=capture pnpm record <name>
 *   DEMO_TOUR=replay  pnpm record <name>
 */
import type { BrowserContext, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { BEAT, type FlowContext } from "./flow";
import {
  candidatesFromHints,
  resolveFirst,
  type SelectorHint,
} from "./selectors";

export type TourMode = "off" | "capture" | "replay";

export type ElementSnapshot = {
  tag: string;
  role: string;
  name: string;
  ariaLabel: string;
  labelText: string;
  placeholder: string;
  testId: string;
  id: string;
  nameAttr: string;
  text: string;
  type: string;
  contentEditable: boolean;
  css: string;
};

export type TourStep = {
  kind: "click" | "type" | "press";
  label: string;
  hints: SelectorHint[];
  text?: string;
  key?: string;
  url?: string;
  tMs: number;
  cluster?: string;
};

export type Tour = {
  name: string;
  viewport: { width: number; height: number };
  startUrl: string;
  steps: TourStep[];
};

/**
 * Gap in the human tour above which replay starts a new zoom cluster.
 *
 * These ids are PROVISIONAL, for two reasons. Capture records no coordinates —
 * only selector hints and a timestamp — so it cannot tell whether two steps are
 * anywhere near each other on screen. And the capture clock is not the replay
 * clock: replay inserts a 450–1350 ms cursor glide plus a dwell plus the flow's
 * own beats, so steps a human did 1.5 s apart can land 4 s apart in the render.
 *
 * `clusterize` in src/lib/zoom.ts therefore treats a cluster id as "these MAY
 * share a framing" and re-splits on real screen distance once the replay has
 * resolved element positions. Do not tighten this number to compensate; the
 * spatial split is where correctness lives.
 */
export const INFER_CLUSTER_GAP_MS = 1800;

/**
 * Capture is a human sitting at a laptop. The 1920×1080 / DSF 2 record
 * viewport does not fit, so the composer and lower chrome fall off-screen.
 * Replay still shoots at the flow viewport (usually 1920×1080).
 */
export const CAPTURE_VIEWPORT = { width: 1440, height: 820 };
export const CAPTURE_DEVICE_SCALE_FACTOR = 1;

export function resolveTourMode(raw?: string): TourMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "capture") return "capture";
  if (v === "replay") return "replay";
  return "off";
}

export function tourFile(root: string, name: string): string {
  return path.join(root, "tours", `${name}.json`);
}

const GENERATED_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|:r[0-9a-z]+:|radix-|ember|mui-|aria-)/i;

export function isGeneratedId(id: string): boolean {
  return !id || id.length > 40 || GENERATED_ID.test(id);
}

export function implicitRole(s: Pick<ElementSnapshot, "tag" | "type" | "role">): string {
  if (s.role) return s.role;
  const tag = s.tag.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "option") return "option";
  if (tag === "input") {
    const t = (s.type || "text").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button" || t === "reset") return "button";
    if (t === "search") return "searchbox";
    return "textbox";
  }
  return "";
}

export function isTypable(s: Pick<ElementSnapshot, "tag" | "type" | "role" | "contentEditable">): boolean {
  if (s.contentEditable) return true;
  const tag = s.tag.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const t = (s.type || "text").toLowerCase();
    return ![
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "file",
      "image",
      "hidden",
      "range",
      "color",
    ].includes(t);
  }
  const role = s.role || implicitRole(s);
  return role === "textbox" || role === "searchbox";
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function hintsFromSnapshot(s: ElementSnapshot): SelectorHint[] {
  const hints: SelectorHint[] = [];
  const seen = new Set<string>();
  const push = (h: SelectorHint) => {
    if (!h.by || seen.has(h.by)) return;
    seen.add(h.by);
    hints.push(h);
  };

  const role = implicitRole(s);
  const name = clean(s.name || s.ariaLabel || s.placeholder || "");
  if (role && name) {
    push({ kind: "role", by: `role=${role} name=${name}`, role, name });
  }
  if (s.labelText) {
    const lt = clean(s.labelText);
    push({ kind: "label", by: `label=${lt}`, name: lt });
  }
  if (s.ariaLabel) {
    const al = clean(s.ariaLabel);
    push({ kind: "label", by: `label=${al}`, name: al });
  }
  if (s.placeholder) {
    const ph = clean(s.placeholder);
    push({ kind: "placeholder", by: `placeholder=${ph}`, text: ph });
  }
  if (s.testId) {
    push({ kind: "testid", by: `testid=${s.testId}`, text: s.testId });
  }
  const text = clean(s.text);
  if (text.length >= 2) {
    const truncated = text.length > 80;
    const t = truncated ? text.slice(0, 80) : text;
    push({
      kind: "text",
      by: `text=${t}`,
      text: t,
      exact: truncated ? false : undefined,
    });
  }
  if (s.id && !isGeneratedId(s.id)) {
    const safe = /^[A-Za-z_][\w-]*$/.test(s.id)
      ? `#${s.id}`
      : `[id="${s.id.replace(/"/g, '\\"')}"]`;
    push({ kind: "css", by: `#${s.id}`, css: safe });
  }
  if (s.nameAttr && !isGeneratedId(s.nameAttr)) {
    push({
      kind: "css",
      by: `[name=${s.nameAttr}]`,
      css: `[name="${s.nameAttr.replace(/"/g, '\\"')}"]`,
    });
  }
  if (s.css) {
    push({ kind: "css", by: s.css, css: s.css });
  }
  return hints;
}

export function inferClusters(
  steps: Array<{ tMs: number }>,
  gapMs = INFER_CLUSTER_GAP_MS,
): string[] {
  let idx = 0;
  let last = steps[0]?.tMs ?? 0;
  return steps.map((s, i) => {
    if (i > 0 && s.tMs - last > gapMs) idx += 1;
    last = s.tMs;
    return `c${idx}`;
  });
}

export function applyClusters(tour: Tour, gapMs = INFER_CLUSTER_GAP_MS): Tour {
  const ids = inferClusters(tour.steps, gapMs);
  return {
    ...tour,
    steps: tour.steps.map((s, i) => ({
      ...s,
      cluster: s.cluster ?? ids[i],
    })),
  };
}

export function writeTour(root: string, tour: Tour): string {
  const dest = tourFile(root, tour.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const clustered = applyClusters(tour);
  fs.writeFileSync(dest, JSON.stringify(clustered, null, 2) + "\n");
  return dest;
}

export function readTour(root: string, name: string): Tour {
  const dest = tourFile(root, name);
  if (!fs.existsSync(dest)) {
    throw new Error(
      `No tour at tours/${name}.json — run DEMO_TOUR=capture first.`,
    );
  }
  return JSON.parse(fs.readFileSync(dest, "utf8")) as Tour;
}

export function formatTourSummary(tour: Tour): string {
  if (tour.steps.length === 0) return "  (no steps)";
  return tour.steps
    .map((s, i) => {
      const via = s.hints[0]?.by ?? "?";
      if (s.kind === "type") {
        return `  ${i + 1}. type   ${JSON.stringify(s.text ?? "")} → ${s.label} (${via})`;
      }
      if (s.kind === "press") {
        return `  ${i + 1}. press  ${s.key ?? "Enter"}`;
      }
      return `  ${i + 1}. click  ${s.label} (${via})`;
    })
    .join("\n");
}

function labelOf(s: ElementSnapshot): string {
  return (
    clean(s.name || s.ariaLabel || s.placeholder || s.text) ||
    `${s.tag}${s.id ? "#" + s.id : ""}`
  );
}

function pathKey(raw?: string): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

export async function runTour(ctx: FlowContext, tour: Tour): Promise<void> {
  const { page, moveAndClick, typeInto, pause } = ctx;
  await pause(BEAT.ESTABLISH);

  for (let i = 0; i < tour.steps.length; i++) {
    const step = tour.steps[i];
    const next = tour.steps[i + 1];
    const navigates = Boolean(
      next?.url && pathKey(next.url) !== pathKey(step.url ?? page.url()),
    );
    if (step.kind === "press") {
      await page.keyboard.press(step.key || "Enter");
    } else {
      if (step.hints.length === 0) {
        throw new Error(
          `Tour step ${i + 1} "${step.label}" has no selector hints`,
        );
      }
      const loc = await resolveFirst(
        page,
        step.label,
        candidatesFromHints(page, step.hints),
      );
      const opts = {
        cluster: step.cluster,
        zoom: navigates ? false : undefined,
      };

      if (step.kind === "type") {
        await typeInto(loc, step.text ?? "", step.label, opts);
      } else {
        await moveAndClick(loc, step.label, opts);
      }
    }

    if (navigates && next?.url) {
      const want = pathKey(next.url);
      await page
        .waitForURL((u) => pathKey(u.toString()) === want, { timeout: 15000 })
        .catch(async () => {
          await page.waitForLoadState("domcontentloaded").catch(() => {});
        });
    }

    const sameCluster = Boolean(next && next.cluster && next.cluster === step.cluster);
    if (!next) await pause(BEAT.AFTER_COMMIT);
    else if (step.kind === "type") await pause(BEAT.AFTER_SELECT);
    else if (sameCluster) await pause(BEAT.AFTER_OPEN);
    else await pause(BEAT.CLUSTER_GAP);
  }
}

export type CaptureEvent =
  | { type: "click"; snapshot: ElementSnapshot; url: string }
  | { type: "input"; snapshot: ElementSnapshot; value: string; url: string }
  | { type: "commit"; url?: string }
  | { type: "stop" };

export type CapturePending = {
  snapshot: ElementSnapshot;
  url: string;
  tMs: number;
  text: string;
};

export type CaptureState = {
  steps: TourStep[];
  pending: CapturePending | null;
  stopped: boolean;
};

function sameField(a: ElementSnapshot, b: ElementSnapshot): boolean {
  return a.css === b.css && a.tag === b.tag && a.testId === b.testId && a.id === b.id;
}

export function flushPending(
  state: CaptureState,
  asClickIfEmpty: boolean,
): CaptureState {
  if (!state.pending) return state;
  const pending = state.pending;
  const hints = hintsFromSnapshot(pending.snapshot);
  const next: CaptureState = { ...state, pending: null, steps: [...state.steps] };
  if (hints.length === 0) return next;
  const label = labelOf(pending.snapshot);
  if (pending.text) {
    next.steps.push({
      kind: "type",
      label,
      hints,
      text: pending.text,
      url: pending.url,
      tMs: pending.tMs,
    });
  } else if (asClickIfEmpty) {
    next.steps.push({
      kind: "click",
      label,
      hints,
      url: pending.url,
      tMs: pending.tMs,
    });
  }
  return next;
}

export function applyCaptureEvent(
  state: CaptureState,
  ev: CaptureEvent,
  nowMs: number,
): CaptureState {
  if (ev.type === "stop") return { ...flushPending(state, true), stopped: true };
  if (ev.type === "commit") {
    const flushed = flushPending(state, true);
    return {
      ...flushed,
      steps: [
        ...flushed.steps,
        {
          kind: "press",
          label: "Enter",
          hints: [],
          key: "Enter",
          url: ev.url,
          tMs: nowMs,
        },
      ],
    };
  }
  if (ev.type === "input") {
    if (!isTypable(ev.snapshot)) return state;
    if (state.pending && sameField(state.pending.snapshot, ev.snapshot)) {
      return { ...state, pending: { ...state.pending, text: ev.value } };
    }
    const flushed = flushPending(state, true);
    return {
      ...flushed,
      pending: {
        snapshot: ev.snapshot,
        url: ev.url,
        tMs: nowMs,
        text: ev.value,
      },
    };
  }
  if (isTypable(ev.snapshot)) {
    const flushed = flushPending(state, true);
    return {
      ...flushed,
      pending: {
        snapshot: ev.snapshot,
        url: ev.url,
        tMs: nowMs,
        text: "",
      },
    };
  }
  const flushed = flushPending(state, true);
  const hints = hintsFromSnapshot(ev.snapshot);
  if (hints.length === 0) return flushed;
  return {
    ...flushed,
    steps: [
      ...flushed.steps,
      {
        kind: "click",
        label: labelOf(ev.snapshot),
        hints,
        url: ev.url,
        tMs: nowMs,
      },
    ],
  };
}

/**
 * Injected as a string (same reason as CURSOR_INIT_SCRIPT): Playwright
 * serializes addInitScript functions via toString(), and tsx keepNames would
 * inject `__name` into the page.
 */
const CAPTURE_INIT = `
(() => {
  if (window.__tourInstalled) return;
  window.__tourInstalled = true;
  window.__tourStop = false;

  var banner = function () {
    if (document.getElementById('pw-tour-banner') || !document.body) return;
    var b = document.createElement('div');
    b.id = 'pw-tour-banner';
    b.textContent = 'Tour capture: click through the demo. Close the window or press Esc when done.';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#111;font:600 13px system-ui,sans-serif;padding:8px 14px;text-align:center;pointer-events:none;';
    document.body.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner);
  else banner();

  var send = function (payload) {
    if (typeof window.__tourPush === 'function') window.__tourPush(payload);
  };

  var clickable = function (el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION' || tag === 'LABEL') return true;
    if (el.isContentEditable) return true;
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (/^(button|link|option|combobox|menuitem|tab|checkbox|radio|switch|textbox|searchbox|listbox)$/.test(role)) return true;
    if (el.classList && (el.classList.contains('ant-select') || el.classList.contains('ant-select-item-option'))) return true;
    return false;
  };

  var rootOf = function (el) {
    var n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      if (clickable(n)) return n;
      n = n.parentElement;
    }
    return el;
  };

  // Keep in sync with isGeneratedId() in this file (string so tsx cannot inject __name).
  var generatedId = function (id) {
    return !id || id.length > 40 || /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|:r[0-9a-z]+:|radix-|ember|mui-|aria-)/i.test(id);
  };
  var generatedClass = function (c) {
    return /^(css-[a-z0-9]+|_[a-z0-9]{5,}|ant-click-animating|sc-[a-zA-Z0-9]+)/i.test(c);
  };

  var cssPath = function (el) {
    if (el.id && !generatedId(el.id)) return '#' + el.id;
    var parts = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.body && parts.length < 5) {
      var sel = n.tagName.toLowerCase();
      if (n.id && !generatedId(n.id)) { parts.unshift('#' + n.id); break; }
      var tid = n.getAttribute('data-testid');
      if (tid) { parts.unshift('[data-testid="' + tid.replace(/"/g, '\\\\"') + '"]'); break; }
      var cls = [];
      if (n.classList) {
        for (var i = 0; i < n.classList.length && cls.length < 2; i++) {
          if (!generatedClass(n.classList[i])) cls.push(n.classList[i]);
        }
      }
      if (cls.length) sel += '.' + cls.join('.');
      var parent = n.parentElement;
      if (parent) {
        var same = 0, idx = 0, kids = parent.children;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].tagName === n.tagName) {
            same++;
            if (kids[k] === n) idx = same;
          }
        }
        if (same > 1) sel += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(sel);
      n = parent;
    }
    return parts.join(' > ');
  };

  var accName = function (el) {
    var al = el.getAttribute('aria-label');
    if (al) return al.trim();
    var ids = el.getAttribute('aria-labelledby');
    if (ids) {
      var t = ids.split(/\\s+/).map(function (id) {
        var n = document.getElementById(id);
        return n ? (n.innerText || '').trim() : '';
      }).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.id) {
      var lab = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
      if (lab) return (lab.innerText || '').trim();
    }
    var ph = el.getAttribute('placeholder');
    if (ph) return ph.trim();
    var title = el.getAttribute('title');
    if (title) return title.trim();
    var txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return txt;
  };

  var associatedLabel = function (el) {
    if (el.id) {
      var lab = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
      if (lab) return (lab.innerText || '').trim();
    }
    return '';
  };

  var snapshot = function (el) {
    var text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return {
      tag: (el.tagName || '').toLowerCase(),
      role: (el.getAttribute('role') || '').toLowerCase(),
      name: accName(el),
      ariaLabel: el.getAttribute('aria-label') || '',
      labelText: associatedLabel(el),
      placeholder: el.getAttribute('placeholder') || '',
      testId: el.getAttribute('data-testid') || '',
      id: el.id || '',
      nameAttr: el.getAttribute('name') || '',
      text: text,
      type: (el.getAttribute('type') || '').toLowerCase(),
      contentEditable: !!el.isContentEditable,
      css: cssPath(el),
    };
  };

  // Model-picker rows (Radix/cmdk) commit on pointerdown and unmount before
  // click fires. Listen to both and de-dupe so OpenRouter-style rows that
  // stay mounted are not recorded twice.
  var lastKey = '', lastAt = 0;
  var recordClick = function (raw) {
    var el = rootOf(raw);
    var snap = snapshot(el);
    var key = (snap.role || '') + '|' + (snap.name || snap.text || '').slice(0, 60) + '|' + (snap.css || '');
    var now = Date.now();
    if (key && key === lastKey && now - lastAt < 500) return;
    lastKey = key;
    lastAt = now;
    send({ type: 'click', snapshot: snap, url: location.href });
  };
  var fromPointer = function (e) {
    if (e.button !== 0) return;
    var t = e.target;
    if (t && t.nodeType === 3) t = t.parentElement;
    if (!t || !t.closest) return;
    if (t.closest('#pw-tour-banner')) return;
    recordClick(t);
  };
  document.addEventListener('pointerdown', fromPointer, true);
  document.addEventListener('click', fromPointer, true);

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#pw-tour-banner')) return;
    var value = (t.value != null) ? String(t.value) : (t.textContent || '');
    send({ type: 'input', snapshot: snapshot(t), value: value, url: location.href });
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      window.__tourStop = true;
      send({ type: 'stop' });
      return;
    }
    if (e.key === 'Enter') send({ type: 'commit', url: location.href });
  }, true);
})();
`;

export async function captureTour(opts: {
  page: Page;
  context: BrowserContext;
  name: string;
  viewport: { width: number; height: number };
  startUrl: string;
}): Promise<Tour> {
  const { page, context, name, viewport, startUrl } = opts;
  const started = Date.now();
  let state: CaptureState = { steps: [], pending: null, stopped: false };

  const onEvent = (ev: CaptureEvent) => {
    state = applyCaptureEvent(state, ev, Date.now() - started);
  };

  try {
    await context.exposeFunction("__tourPush", onEvent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already|has been registered/i.test(msg)) throw err;
  }
  await context.addInitScript({ content: CAPTURE_INIT });
  await page.evaluate(CAPTURE_INIT);

  const closed = new Promise<void>((resolve) => {
    const done = () => {
      state = { ...state, stopped: true };
      resolve();
    };
    context.once("close", done);
    page.once("close", done);
  });

  console.log(
    "\nTour capture: click through the demo. Close the window or press Esc when done.\n",
  );

  while (!state.stopped) {
    if (context.pages().length === 0) break;
    try {
      const flag = await page.evaluate("window.__tourStop === true");
      if (flag) break;
      await Promise.race([page.waitForTimeout(200), closed]);
    } catch {
      break;
    }
  }

  state = flushPending(state, true);
  return { name, viewport, startUrl, steps: state.steps };
}
