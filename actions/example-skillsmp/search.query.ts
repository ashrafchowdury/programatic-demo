import { defineAction } from "../../scripts/lib/action";
import { searchField, waitInterstitial } from "../../surfaces/example-skillsmp";

const filterControl = (name: RegExp) => (page: import("playwright").Page) => [
  {
    by: `button|combobox name~${name.source}`,
    locator: page.getByRole("button", { name }).or(page.getByRole("combobox", { name })).first(),
  },
];

/** Search the catalogue, then narrow it to English skills. Writes nothing. */
export default defineAction({
  id: "search.query",
  surface: "example-skillsmp",
  params: { query: { type: "string", maxLength: 40, description: "what to search for" } },
  labels: ["Search field", "All languages", { label: "English", control: "English" }],
  mutates: "example-skillsmp-search",
  example: { query: "ui design" },
  targets: {
    "All languages": filterControl(/all languages/i),
    English: (page) => [
      {
        by: "option English",
        locator: page
          .getByRole("option", { name: /^english$/i })
          .or(page.locator('[role="listbox"] [role="option"], [role="menu"] [role="menuitem"], li, button, a').filter({ hasText: /^english$/i }))
          .first(),
      },
    ],
  },
  prepare: async ({ page, startUrl }) => {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitInterstitial(page);
    const field = searchField(page);
    await field.waitFor({ state: "visible", timeout: 15_000 });
    const left = await field.inputValue().catch(() => "");
    if (left !== "") throw new Error(`the search box still holds "${left}"`);
  },
  steps: ({ query }) => [
    { type: "search box", text: query, label: "Search field", cluster: "search", after: 300 },
    { key: "Enter" },
    {
      do: async ({ page }) => {
        await page.waitForURL(/search|q=/, { timeout: 20_000 }).catch(() => {});
        await waitInterstitial(page);
      },
    },
    { settle: { ready: "All languages" }, after: 600 },
    { click: "All languages", cluster: "language", after: 500 },
    { click: "English", cluster: "language", after: 1200 },
  ],
});
