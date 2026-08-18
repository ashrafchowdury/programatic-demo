import type { Page, Locator } from "playwright";
import { defineFlow } from "../scripts/lib/flow";

/**
 * SkillsMP hero — homepage → search "ui design" → language / domain / category.
 *
 * Run: pnpm exec tsx scripts/clip.ts skillsmp-search
 */
const QUERY = process.env.SEARCH_QUERY ?? "ui design";
const HOME = "https://skillsmp.com/";

async function waitCloudflare(page: Page) {
  for (let i = 0; i < 45; i++) {
    const title = await page.title().catch(() => "");
    if (!/just a moment|verif|attention required|cloudflare/i.test(title)) return;
    await page.waitForTimeout(1000);
  }
}

function skillLinks(page: Page): Locator {
  return page.locator('main a[href*="/creators/"], a[href*="/creators/"]');
}

function filterControl(page: Page, name: RegExp): Locator {
  return page
    .getByRole("button", { name })
    .or(page.getByRole("combobox", { name }))
    .first();
}

function optionNamed(page: Page, name: RegExp): Locator {
  return page
    .getByRole("option", { name })
    .or(
      page
        .locator('[role="listbox"] [role="option"], [role="menu"] [role="menuitem"], li, button, a')
        .filter({ hasText: name }),
    )
    .first();
}

/** Wait until SERP filters + a real result card are painted (no empty white body). */
async function waitSerpReady(page: Page) {
  const lang = filterControl(page, /all languages/i);
  await lang.waitFor({ state: "visible", timeout: 25000 });
  const first = skillLinks(page).first();
  await first.waitFor({ state: "visible", timeout: 20000 });
  await first
    .getByText(/.{8,}/)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  return { lang, first };
}

async function waitResultsPaint(page: Page) {
  const first = skillLinks(page).first();
  await first.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await first
    .getByText(/.+/)
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  return first;
}

export default defineFlow({
  name: "skillsmp-search",
  viewport: { width: 1920, height: 1080 },
  run: async (ctx) => {
    const { page, moveAndClick, moveTo, focus } = ctx;

    // ── 1) Homepage ──────────────────────────────────────────────
    await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitCloudflare(page);

    const logo = page.getByRole("link", { name: /skillsmp/i }).first();
    if (await logo.isVisible({ timeout: 1500 }).catch(() => false)) {
      await moveTo(logo);
    }

    // ── 2) Search + type ─────────────────────────────────────────
    let searchField = page
      .getByRole("searchbox")
      .or(page.getByPlaceholder(/search/i))
      .or(page.locator('input[type="search"], input[name="q"], input[name="query"]'))
      .first();

    if (!(await searchField.isVisible({ timeout: 2000 }).catch(() => false))) {
      const navSearch = page
        .getByRole("link", { name: /^search$/i })
        .or(page.getByRole("button", { name: /^search$/i }))
        .first();
      if (await navSearch.isVisible({ timeout: 2500 }).catch(() => false)) {
        await moveAndClick(navSearch, "Nav Search", { cluster: "search", zoom: false });
        await page.waitForURL(/search/, { timeout: 15000 }).catch(() => {});
        await waitCloudflare(page);
      }
      searchField = page
        .getByRole("searchbox")
        .or(page.getByPlaceholder(/search/i))
        .or(page.locator('input[type="search"], input[name="q"], input[name="query"], main input[type="text"]'))
        .first();
    }

    await searchField.waitFor({ state: "visible", timeout: 15000 });
    await moveAndClick(searchField, "Search field", { cluster: "search" });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(QUERY, { delay: 28 });

    // ── 3) Submit — zoom:false so nav doesn't trail mid-reload; gate on paint ──
    const searchSubmit = page
      .getByRole("button", { name: /search/i })
      .or(page.locator('button[type="submit"]'))
      .first();

    if (await searchSubmit.isVisible({ timeout: 1500 }).catch(() => false)) {
      await moveAndClick(searchSubmit, "Search submit", { cluster: "search", zoom: false });
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForURL(/search|q=/, { timeout: 20000 }).catch(() => {});
    await waitCloudflare(page);
    const { lang: langBtn, first: firstReady } = await waitSerpReady(page);
    await moveTo(firstReady);

    // ── 4) All languages → English ───────────────────────────────
    await moveAndClick(langBtn, "All languages", { cluster: "language" });
    const english = optionNamed(page, /^english$/i);
    await english.waitFor({ state: "visible", timeout: 10000 });
    await moveAndClick(english, "English", { cluster: "language" });
    await page.waitForURL(/language=en/, { timeout: 12000 }).catch(() => {});
    await waitResultsPaint(page);

    // ── 5) All domains → Development ─────────────────────────────
    const domainBtn = filterControl(page, /all domains/i);
    await domainBtn.waitFor({ state: "visible", timeout: 8000 });
    await moveAndClick(domainBtn, "All domains", { cluster: "domain" });
    const development = optionNamed(page, /^development$/i);
    await development.waitFor({ state: "visible", timeout: 8000 });
    await moveAndClick(development, "Development", { cluster: "domain" });
    await waitResultsPaint(page);

    // ── 6) All categories → Frontend ─────────────────────────────
    const catBtn = filterControl(page, /all categor/i);
    await catBtn.waitFor({ state: "visible", timeout: 8000 });
    await moveAndClick(catBtn, "All categories", { cluster: "category" });
    const frontend = optionNamed(page, /^frontend$/i);
    await frontend.waitFor({ state: "visible", timeout: 8000 });
    await moveAndClick(frontend, "Frontend", { cluster: "category" });

    const first = await waitResultsPaint(page);
    await moveTo(first);
    await focus(first, "Filtered first result", { cluster: "payoff" });

    const second = skillLinks(page).nth(1);
    if (await second.isVisible({ timeout: 2000 }).catch(() => false)) {
      await focus(second, "Second result", { cluster: "payoff" });
      await moveTo(second);
    }
  },
});
