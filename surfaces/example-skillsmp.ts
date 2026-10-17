import type { Page } from "playwright";
import { defineSurface } from "../scripts/lib/action";

/**
 * The public SkillsMP site the committed skillsmp-search flow films, so the
 * composer and recorder can be exercised with no account. Start URL from
 * DEMO_URL_EXAMPLE_SKILLSMP (see .env.example).
 */
export const searchField = (page: Page) =>
  page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/search/i))
    .or(page.locator('input[type="search"], input[name="q"], input[name="query"]'))
    .first();

/** A Cloudflare interstitial passes on its own; wait for it, never click it. */
export async function waitInterstitial(page: Page): Promise<void> {
  for (let i = 0; i < 45; i++) {
    const title = await page.title().catch(() => "");
    if (!/just a moment|verif|attention required|cloudflare/i.test(title)) return;
    await page.waitForTimeout(1000);
  }
}

export default defineSurface({
  id: "example-skillsmp",
  viewport: { width: 1920, height: 1080 },
  ready: async (page) => {
    await waitInterstitial(page);
    return searchField(page).isVisible();
  },
  targets: {
    "search box": (page) => [{ by: "searchbox | placeholder~search", locator: searchField(page) }],
  },
});
