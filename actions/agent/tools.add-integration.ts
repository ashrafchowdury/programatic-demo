import type { Page } from "playwright";
import { defineAction } from "../../scripts/lib/action";

/** The app picker, drawn over the playground. Both search fields live inside it. */
const PANEL = '[role="dialog"]';

/**
 * Shorter than schedules.add's beats on purpose: what is worth watching here
 * is the grid filtering, and a long hold after it settles is dead air.
 */
const P = {
  /** The little menu drops out of the + button. */
  AFTER_MENU: 700,
  /** The picker takes the whole frame, the biggest move in the action. */
  AFTER_PANEL: 1500,
  AFTER_SEARCH: 900,
  /** GitHub's action list paints. */
  AFTER_APP: 1200,
} as const;

/**
 * The Tools row's text, read from the ROW rather than its label: the label
 * alone reads exactly "Tools" and never carries the count. The row is the
 * first ancestor of the + that holds both the name and a count.
 */
/** v0.122.8: Tools became Integrations; the empty section reads "No integrations yet". */
async function integrationsText(page: Page): Promise<string> {
  const plus = page.getByRole("button", { name: "Add integration", exact: true });
  for (let up = 1; up <= 6; up++) {
    const box = plus.locator(`xpath=ancestor::div[${up}]`);
    if (!(await box.count())) break;
    const t = (await box.innerText()).replace(/\s+/g, " ").trim();
    if (/integrations/i.test(t) && /no integrations yet|\d+ integration/i.test(t)) return t;
  }
  return "";
}

/**
 * Open Tools + -> Third-party integration, filter the app grid, open GitHub,
 * filter its actions, and close with Done. Picks nothing, so writes no tool:
 * no removal path for a picked action has been verified.
 */
export default defineAction({
  id: "tools.add-integration",
  surface: "agent",
  // Measured on the hand flow: `stage` frames this footage at 0.84 of 2560,
  // so 1600 wide upscales 1.34x and the 14px UI text still reads at 1080p;
  // 1920 drops it to 11.8px, 1280 goes soft at 1.68x.
  viewport: { width: 1600, height: 900 },
  params: {
    appQuery: {
      type: "string",
      maxLength: 30,
      description: "typed into Search apps; the result must still show GitHub, which the next beat opens",
    },
  },
  labels: [
    "Add tool",
    "Third-party integration",
    "search 1327 apps",
    "GitHub app",
    { label: "Done", control: "Done" },
  ],
  mutates: "agent-tools",
  example: { appQuery: "github" },
  targets: {
    // v0.122.8: the + is "Add integration" and opens a menu; the old
    // "Third-party integration" item is "Browse integrations".
    "Add tool": (p) => [{ by: 'button "Add integration"', locator: p.getByRole("button", { name: "Add integration", exact: true }).first() }],
    "Third-party integration": (p) => [
      { by: "menuitem ^Browse integrations", locator: p.getByRole("menuitem", { name: /^Browse integrations/ }).first() },
    ],
    // Scoped to the panel: the bare name resolves to "Star on GitHub" in the
    // sidebar behind it, and clicking that silently dismisses the picker.
    // A connected app is listed as "GitHub (<connection>)".
    "GitHub app": (p) => [
      { by: "panel text GitHub (connection)", locator: p.locator(PANEL).getByText(/^GitHub \(.+\)$/).first() },
      { by: "panel heading GitHub", locator: p.locator(PANEL).getByRole("heading", { name: /^GitHub$/ }) },
      { by: "panel text GitHub", locator: p.locator(PANEL).getByText(/^GitHub$/).first() },
    ],
    // The placeholder ends in a unicode ellipsis, so match the stem.
    "search apps": (p) => [
      { by: "panel placeholder~Search apps", locator: p.locator(PANEL).getByPlaceholder(/Search apps/i) },
      { by: "any placeholder~Search apps", locator: p.getByPlaceholder(/Search apps/i) },
    ],
  },
  /**
   * Resets by reloading, which closes a picker an aborted take left open.
   * Verifies no picker is open and that Tools reads None: the action opens on
   * an agent with no tools, so any other count means shooting over someone
   * else's tools.
   */
  prepare: async ({ page }) => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add integration", exact: true }).waitFor({ state: "visible", timeout: 90_000 });
    if (await page.locator(PANEL).count()) await page.keyboard.press("Escape");
    if (await page.locator(PANEL).count()) throw new Error("the app picker is still open after a reload and Escape");

    // v0.122.8: clicking a connected app ADDS it to the agent at once, so a
    // take leaves GitHub attached. Remove that one app; refuse any other.
    const section = page.getByRole("button", { name: "Add integration", exact: true }).locator("xpath=ancestor::div[4]");
    for (let round = 0; round < 6; round++) {
      const removes = section.getByRole("button", { name: "Remove", exact: true });
      const n = await removes.count();
      if (n === 0) break;
      const row = removes.first().locator("xpath=ancestor::div[2]");
      const name = (await row.innerText()).replace(/\s+/g, " ").trim();
      if (!/^GitHub\b/.test(name)) throw new Error(`the Integrations section holds "${name}", which this action did not add; refusing to remove it`);
      await removes.first().click();
      await page.waitForTimeout(800);
    }
    // Read the section back after a reload: measured, an in-page "No
    // integrations yet" once survived a removal the server never kept.
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add integration", exact: true }).waitFor({ state: "visible", timeout: 90_000 });
    const text = await integrationsText(page);
    if (!text) throw new Error("could not read the Integrations section, so cannot tell whether the agent already has any");
    if (!/no integrations yet/i.test(text)) throw new Error(`the Integrations section reads "${text}" rather than "No integrations yet"`);
  },
  steps: ({ appQuery }) => [
    { click: "Add tool", cluster: "open" },
    { pause: P.AFTER_MENU },
    { click: "Third-party integration", cluster: "open" },
    // The closing menu hands focus back to the +, whose tooltip would linger
    // over the picker; park the pointer and drop focus. No network wait: the
    // grid loading is part of the beat.
    { settle: { parkPointer: true, idle: false } },
    // Resolve the search field while the panel is still animating in.
    { hoist: "search apps" },
    { pause: P.AFTER_PANEL },
    { type: "search apps", text: appQuery, label: "search 1327 apps", cluster: "pick", after: P.AFTER_SEARCH },
    // v0.122.8: the click adds the connected app at once ("✓ Added"); there is
    // no action list to narrow any more. The hold is the payoff.
    { click: "GitHub app", cluster: "pick", after: P.AFTER_APP },
    { click: "Done", cluster: "close" },
  ],
});
