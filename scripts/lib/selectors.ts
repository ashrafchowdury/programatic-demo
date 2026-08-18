import type { Locator, Page } from "playwright";

/**
 * A single way to find an element. `by` is a short human label (e.g. "role=combobox")
 * used in the ✓/✗ logs and failure diagnostics, so when something breaks you see
 * exactly which strategy matched — or which ones were tried.
 */
export type Candidate = { by: string; locator: Locator };

/** Serializable locator recipe written by tour capture and rebuilt on replay. */
export type SelectorHint = {
  by: string;
  kind: "role" | "label" | "placeholder" | "testid" | "text" | "css";
  role?: string;
  name?: string;
  text?: string;
  css?: string;
  /** When false, name/text is a prefix (used for truncated strings). Default true. */
  exact?: boolean;
};

const ARIA_ROLES = new Set([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

function nameMatcher(name: string, exact = true): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(exact ? `^${escaped}$` : `^${escaped}`, "i");
}

/** Matches the name anywhere in the string — for rows that wrap their label. */
function containsMatcher(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/**
 * Roles worth probing by accessible name, most common in a demo first. Kept
 * short on purpose: each entry is one round trip per resolution attempt.
 */
const NAMED_ROLES = [
  "button",
  "link",
  "textbox",
  "combobox",
  "option",
  "tab",
] as const;

/** Anything that behaves like a control, for the "contains" and ancestor rungs. */
const INTERACTIVE_CSS =
  'button, a, input, textarea, select, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="tab"], [role="option"], [role="combobox"], ' +
  '[role="checkbox"], [role="switch"]';

/** Climb from a text node to the control that owns it. */
const INTERACTIVE_ANCESTOR =
  'xpath=ancestor-or-self::*[@role="button" or @role="link" or @role="menuitem"' +
  ' or @role="tab" or @role="option" or @role="combobox" or self::button or' +
  " self::a][1]";

/**
 * Build the candidate ladder a hand-written `<flow>.selectors.ts` used to spell
 * out, from nothing but the element's visible name.
 *
 * Ordering is the whole design. Exact accessible-name matches on real controls
 * come first, so "Save" finds the Save button and not the row that happens to
 * contain the word. Only when nothing exact matches does it fall to "contains",
 * which is what finds rows whose label is one span among several — the
 * AGENTS.md case, where the clickable thing reads "AGENTS.md Markdown · empty
 * Empty file" and the filename alone is not clickable at all.
 *
 * `resolveFirst` takes the first VISIBLE candidate and logs which rung won, so
 * when an app changes you see the ladder degrade in the run output instead of
 * discovering it in the footage.
 *
 * A name that is genuinely ambiguous ("Save" when three Saves are on screen) or
 * an element with no name at all (a bare contenteditable) still needs a
 * hand-written entry — that is what a flow's `targets` override map is for.
 */
export function autoCandidates(page: Page, name: string): Candidate[] {
  const exact = nameMatcher(name, true);
  const loose = containsMatcher(name);
  const out: Candidate[] = NAMED_ROLES.map((role) => ({
    by: `role=${role} name="${name}"`,
    locator: page.getByRole(role, { name: exact }),
  }));
  out.push({ by: `label="${name}"`, locator: page.getByLabel(exact) });
  out.push({
    by: `placeholder~"${name}"`,
    locator: page.getByPlaceholder(loose),
  });
  out.push({ by: `testid="${name}"`, locator: page.getByTestId(name) });
  out.push({
    by: `control containing "${name}"`,
    locator: page.locator(INTERACTIVE_CSS).filter({ hasText: loose }),
  });
  out.push({
    by: `text "${name}" -> control`,
    locator: page.getByText(loose).locator(INTERACTIVE_ANCESTOR),
  });
  out.push({ by: `text "${name}"`, locator: page.getByText(loose) });
  return out;
}

/**
 * Per-flow overrides, keyed by the name a flow asks for. Only for targets the
 * ladder cannot reach — everything else should just be its visible label.
 */
export type TargetOverrides = Record<string, (page: Page) => Candidate[]>;

/** An override if the flow declared one, otherwise the generated ladder. */
export function candidatesFor(
  page: Page,
  name: string,
  overrides?: TargetOverrides,
): Candidate[] {
  const override = overrides?.[name];
  return override ? override(page) : autoCandidates(page, name);
}

/** Resolve a name through overrides + ladder. Throws SelectorError on failure. */
export function findByName(
  page: Page,
  name: string,
  overrides?: TargetOverrides,
  opts: { timeoutMs?: number } = {},
): Promise<Locator> {
  return resolveFirst(page, name, candidatesFor(page, name, overrides), opts);
}

/** Non-throwing variant, for `ready` / `prepare` probes. */
export function softByName(
  page: Page,
  name: string,
  overrides?: TargetOverrides,
): Promise<Locator | null> {
  return softFirst(candidatesFor(page, name, overrides));
}

function locatorFromHint(page: Page, hint: SelectorHint): Locator {
  switch (hint.kind) {
    case "role": {
      const role = (hint.role || "").toLowerCase();
      // Never-match locator so resolveFirst skips this hint instead of throwing.
      if (!ARIA_ROLES.has(role)) return page.locator("html:not(*)");
      const name = hint.name
        ? nameMatcher(hint.name, hint.exact !== false)
        : undefined;
      return page.getByRole(role as Parameters<Page["getByRole"]>[0], {
        name,
      });
    }
    case "label":
      return page.getByLabel(
        nameMatcher(hint.name || hint.text || "", hint.exact !== false),
      );
    case "placeholder":
      return page.getByPlaceholder(
        nameMatcher(hint.text || hint.name || "", hint.exact !== false),
      );
    case "testid":
      return page.getByTestId(hint.text || "");
    case "text":
      return page.getByText(nameMatcher(hint.text || "", hint.exact !== false));
    case "css":
      return page.locator(hint.css || hint.by);
  }
}

/** Rebuild the candidate list a flow would have written by hand. */
export function candidatesFromHints(
  page: Page,
  hints: SelectorHint[],
): Candidate[] {
  return hints.map((h) => ({
    by: h.by,
    locator: locatorFromHint(page, h),
  }));
}

/** Thrown when no candidate for a labelled target becomes visible in time. */
export class SelectorError extends Error {
  constructor(
    public readonly label: string,
    public readonly tried: string[],
    public readonly dump: string,
  ) {
    super(
      `Could not resolve "${label}".\n  tried: ${tried.join(" | ")}\n${dump}`,
    );
    this.name = "SelectorError";
  }
}

const OK = "✓"; // ✓
const NO = "✗"; // ✗

/**
 * Snapshot the visible, interactive elements on the page — used in failure
 * diagnostics so a broken selector immediately shows what IS on screen instead of a
 * bare "not found". (Generalized from the old ad-hoc probe dump.)
 */
export async function dumpVisible(page: Page, max = 24): Promise<string> {
  try {
    const items = (await page.evaluate(`(function(){
      function vis(e){var r=e.getBoundingClientRect();var s=getComputedStyle(e);
        return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
      var sel='button,[role=button],[role=combobox],[role=option],a,input,textarea,select,.ant-select';
      var els=[].slice.call(document.querySelectorAll(sel));
      var out=[];
      for(var i=0;i<els.length;i++){var e=els[i];if(!vis(e))continue;var r=e.getBoundingClientRect();
        var t=(e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,44);
        out.push({tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',type:e.getAttribute('type')||'',t:t,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});
      }
      return out.slice(0, ${max});
    })()`)) as Array<{
      tag: string;
      role: string;
      type: string;
      t: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    const lines = items.map(
      (e) =>
        `    · <${e.tag}${e.role ? ` role=${e.role}` : ""}${e.type ? ` type=${e.type}` : ""}> "${e.t}" @${e.x},${e.y} ${e.w}×${e.h}`,
    );
    return `  on screen now:\n${lines.join("\n") || "    (no visible interactive elements)"}`;
  } catch {
    return "  (could not snapshot page)";
  }
}

/**
 * Return the first candidate that is currently visible, without waiting or logging.
 * For soft checks (e.g. "is the panel already open?") where absence is not an error.
 */
export async function softFirst(
  candidates: Candidate[],
): Promise<Locator | null> {
  for (const c of candidates) {
    try {
      const loc = c.locator.first();
      if (await loc.isVisible()) return loc;
    } catch {
      /* not attached */
    }
  }
  return null;
}

/**
 * Try each candidate in order until one is visible (polling up to `timeoutMs`).
 * Logs `✓ <label> via <by>` with the winning strategy so drift is visible on every
 * run. On timeout logs `✗` and throws a SelectorError carrying a snapshot of what is
 * actually on screen — turning a blind failure into an obvious one.
 */
export async function resolveFirst(
  page: Page,
  label: string,
  candidates: Candidate[],
  opts: { timeoutMs?: number } = {},
): Promise<Locator> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const c of candidates) {
      try {
        const loc = c.locator.first();
        if (await loc.isVisible()) {
          console.log(`  ${OK} ${label} via ${c.by}`);
          return loc;
        }
      } catch {
        /* not attached yet */
      }
    }
    await page.waitForTimeout(250);
  }
  const tried = candidates.map((c) => c.by);
  console.error(
    `  ${NO} ${label} — none of [${tried.join(", ")}] visible in ${timeoutMs}ms`,
  );
  throw new SelectorError(label, tried, await dumpVisible(page));
}
