import { defineAction } from "../../scripts/lib/action";
import { css } from "../../scripts/lib/flow";

/** The option the filter lists under `name`, whichever element renders it. */
const optionNamed = (name: string) =>
  css(`text=${JSON.stringify(name)} >> visible=true >> nth=0`);

/** Narrow search results to one domain. Runs after a search; writes nothing. */
export default defineAction({
  id: "search.filter-domain",
  surface: "example-skillsmp",
  params: { domain: { type: "string", maxLength: 30, description: "a domain the filter lists" } },
  labels: ["All domains", { label: "pick domain", control: { param: "domain" } }],
  mutates: "example-skillsmp-search",
  example: { domain: "Development" },
  targets: {
    "All domains": (page) => [
      {
        by: "button|combobox name~all domains",
        locator: page
          .getByRole("button", { name: /all domains/i })
          .or(page.getByRole("combobox", { name: /all domains/i }))
          .first(),
      },
    ],
  },
  prepare: async ({ page }) => {
    const url = new URL(page.url());
    if (url.searchParams.has("domain")) {
      url.searchParams.delete("domain");
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    if (new URL(page.url()).searchParams.has("domain")) throw new Error("a domain filter is still applied");
  },
  steps: ({ domain }) => [
    { settle: { ready: "All domains" } },
    { click: "All domains", cluster: "domain", after: 500 },
    { click: optionNamed(domain), label: "pick domain", cluster: "domain", after: 1200 },
  ],
});
