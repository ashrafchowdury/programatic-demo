import type { Page } from "playwright";
import { defineAction } from "../../scripts/lib/action";

/**
 * The chat input: a Lexical contenteditable with no accessible name, and the
 * only editable region in the chat view.
 */
const composer = (page: Page) => page.locator('[contenteditable="true"]').first();

/** The policy a take starts from, and the one this action sets. */
const START_POLICY = "Allow reads";

/** The configuration panel's Policy control: the agent's stored permission policy. */
const policyControl = (page: Page) => page.getByLabel("Policy", { exact: true }).first();

/** The stored policy, read from the configuration panel. */
async function currentPolicy(page: Page): Promise<string> {
  await policyControl(page).waitFor({ state: "visible", timeout: 90_000 });
  return (await policyControl(page).innerText()).trim();
}

/**
 * Put the agent's policy back to START_POLICY, then reload and read it back.
 *
 * Measured on v0.122.8: the "/" -> /permissions choice the take makes is
 * stored on the agent (it survives a reload), but choosing "Allow reads" the
 * same way did NOT survive one, though the menu showed it in-page. The
 * configuration panel's Policy control does persist, so the reset uses it,
 * and only a value read after a reload counts.
 */
async function restorePolicy(page: Page): Promise<void> {
  if ((await currentPolicy(page)) === START_POLICY) return;
  await policyControl(page).click();
  await page.getByRole("option").filter({ hasText: new RegExp(`^${START_POLICY}`) }).first().click();
  // The choice saves on a debounce: give the request time to leave and land.
  await page.waitForTimeout(3000);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  const now = await currentPolicy(page);
  if (now !== START_POLICY) throw new Error(`the permission policy reads "${now}" after restoring it to "${START_POLICY}" and reloading`);
}

/** Rows of the "/" popover and of its /permissions submenu. */
const menuRows = (page: Page) => page.getByRole("option").filter({ hasText: /^\s*(\/|Allow )/ });

const P = {
  /** The popover animates in and wants to be read. */
  AFTER_SLASH: 1400,
  /** The /permissions submenu animates in. */
  AFTER_PERMS: 900,
  /** The beat the clip ends on. */
  AFTER_CLICK: 1400,
} as const;

/**
 * The popover is ~880px wide, so the auto-camera would pull back to its
 * minimum zoom on it. Force the crop to the sharpness ceiling instead, on
 * every beat of the cluster so the frame does not relax between rows.
 */
const TIGHT = 1.74;

/**
 * Type "/", browse to /model, then pick /permissions -> Allow all. Sets the
 * agent's stored permission policy; the prepare puts it back to "Allow reads"
 * and verifies it after a reload.
 */
export default defineAction({
  id: "chat.slash-command",
  surface: "agent",
  params: {},
  labels: [
    "type slash",
    "hover /model",
    { label: "click /permissions", control: "/permissions" },
    { label: "click Allow all", control: "Allow all" },
  ],
  mutates: "agent-chat",
  example: {},
  targets: {
    composer: (p) => [{ by: "contenteditable chat composer", locator: composer(p) }],
    // Scoped to option rows: the Model row in the configuration panel shares the word.
    "/model": (p) => [
      { by: 'option text="/model"', locator: p.getByRole("option").filter({ hasText: "/model" }).first() },
    ],
    "/permissions": (p) => [
      {
        by: 'option text="/permissions"',
        locator: p.getByRole("option").filter({ hasText: "/permissions" }).first(),
      },
    ],
    // Anchored so it does not collide with "Allow reads" above it.
    "Allow all": (p) => [
      { by: 'option text="Allow all"', locator: p.getByRole("option").filter({ hasText: /^Allow all/ }).first() },
    ],
  },
  /**
   * Restores the permission policy to "Allow reads" and verifies it, then
   * resets the composer to empty with no menu open and the pointer parked, and
   * verifies both.
   */
  prepare: async ({ page }) => {
    await restorePolicy(page);
    await page.keyboard.press("Escape");
    const field = composer(page);
    await field.waitFor({ state: "visible", timeout: 90_000 });
    await field.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await page.mouse.move(960, 300);

    const left = (await field.innerText()).trim();
    if (left !== "") throw new Error(`the chat composer still holds "${left}"`);
    const open = await menuRows(page).count();
    if (open > 0) throw new Error(`${open} slash-menu row(s) are still open`);
  },
  steps: () => [
    // Stays wide: the camera is still on the whole app when the popover appears.
    { type: "composer", text: "/", label: "type slash", zoom: false },
    { pause: P.AFTER_SLASH },
    // A slow climb and a hover read as a person scanning the list, not a script darting to one row.
    { focus: "/model", label: "hover /model", cluster: "slash", zoomScale: TIGHT, travelMs: 1400, hoverMs: 750 },
    {
      click: "/permissions",
      label: "click /permissions",
      cluster: "slash",
      zoomScale: TIGHT,
      travelMs: 900,
      hoverMs: 450,
      after: P.AFTER_PERMS,
    },
    {
      click: "Allow all",
      label: "click Allow all",
      cluster: "slash",
      zoomScale: TIGHT,
      travelMs: 1000,
      hoverMs: 500,
      after: P.AFTER_CLICK,
    },
  ],
});
