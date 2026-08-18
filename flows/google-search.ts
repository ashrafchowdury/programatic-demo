import type { Page } from "playwright";
import { BEAT, defineFlow, type FlowContext } from "../scripts/lib/flow";

/**
 * Hero demo: search the web → open the first organic result.
 *
 * Pacing (gap-analysis pass):
 *   0 wait for home paint (no blank card)
 *   1 establish → type + submit (cluster: search, strong zoom)
 *   2 SERP read while search cluster trails
 *   3 lead to first result → click (cluster: result)
 *   4 short destination settle (no multi-second frozen end)
 *
 * Default engine: DuckDuckGo HTML. Optional: USE_GOOGLE=1.
 * Run: pnpm clip:google
 */
const QUERY = process.env.SEARCH_QUERY ?? "Agenta LLM ops playground";

type Move = FlowContext["moveAndClick"];
type Pause = FlowContext["pause"];
type MoveTo = FlowContext["moveTo"];
type TypeInto = FlowContext["typeInto"];

async function dismissGoogleConsent(
  page: Page,
  moveAndClick: Move,
  pause: Pause,
) {
  const accept = page
    .getByRole("button", {
      name: /accept all|i agree|alle akzeptieren|aceptar todo|tout accepter/i,
    })
    .first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await moveAndClick(accept, "Accept cookies", { zoom: false });
    await pause(700);
  }
}

/** Wait until the search home is actually painted (avoids blank-card open). */
async function waitHomePaint(
  page: Page,
  searchBox: ReturnType<Page["locator"]>,
) {
  await searchBox.waitFor({ state: "visible", timeout: 15000 });
  // One more paint frame so logo/layout aren't mid-transition.
  await page.waitForTimeout(350);
}

async function runGoogle(
  page: Page,
  typeInto: TypeInto,
  moveAndClick: Move,
  moveTo: MoveTo,
  pause: Pause,
) {
  await page.goto("https://www.google.com/ncr?hl=en", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await dismissGoogleConsent(page, moveAndClick, pause);

  const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
  await waitHomePaint(page, searchBox);

  await moveTo(searchBox);
  await pause(BEAT.ESTABLISH);

  await typeInto(searchBox, QUERY, "Search box", { cluster: "search" });
  await pause(280);
  // Enter without a second zoom keyframe (avoids stale rect after SERP nav).
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
      .catch(() => null),
    page.keyboard.press("Enter"),
  ]);

  if (page.url().includes("/sorry")) {
    const waitMs = Number(process.env.CAPTCHA_WAIT_MS ?? "90000");
    console.log(
      `\nGoogle captcha — complete it in the browser (waiting ${waitMs}ms)…\n`,
    );
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && page.url().includes("/sorry")) {
      await pause(1500);
    }
    if (page.url().includes("/sorry")) {
      throw new Error(
        "Google captcha not cleared. Re-run without USE_GOOGLE=1 or solve captcha.",
      );
    }
  }

  const firstLink = page.locator("#search a:has(h3), #rso a:has(h3)").first();
  await firstLink.waitFor({ state: "visible", timeout: 20000 });

  await pause(BEAT.CLUSTER_GAP);
  await pause(BEAT.SERP_READ);

  await moveAndClick(firstLink, "First result", { cluster: "result" });
}

async function runDuckDuckGo(
  page: Page,
  typeInto: TypeInto,
  moveAndClick: Move,
  moveTo: MoveTo,
  pause: Pause,
) {
  await page.goto("https://html.duckduckgo.com/html/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const searchBox = page.locator('input[name="q"]').first();
  await waitHomePaint(page, searchBox);
  // Logo is a good "product is here" signal for establish.
  await page
    .locator("img, .logo, #logo_homepage_link")
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  // 0) Establish — cursor parked on the search field, scale 1.
  await moveTo(searchBox);
  await pause(BEAT.ESTABLISH);

  // 1) Type into search (zoom cluster). Submit is zoom:false so HOLD does not
  //    keep framing the home-page button after the SERP navigates in (stale rect).
  await typeInto(searchBox, QUERY, "Search box", { cluster: "search" });
  await pause(280);

  const submit = page.locator('input[type="submit"]').first();
  if (await submit.isVisible().catch(() => false)) {
    await moveAndClick(submit, "Search", { zoom: false });
  } else {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
        .catch(() => null),
      page.keyboard.press("Enter"),
    ]);
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const firstLink = page.locator("a.result__a").first();
  await firstLink.waitFor({ state: "visible", timeout: 20000 });
  await page
    .locator(".result")
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  // 2) Let search cluster HOLD+TRAIL finish, then read SERP at scale ~1.
  //    typeInto is last zoomable click of "search" → trail ends ~HOLD_MIN+out later.
  await pause(BEAT.CLUSTER_GAP);
  await pause(BEAT.SERP_READ);

  // 3) Lead into first result + click (new cluster).
  await moveAndClick(firstLink, "First result", { cluster: "result" });
}

export default defineFlow({
  name: "google-search",
  viewport: { width: 1920, height: 1080 },
  run: async (ctx) => {
    const { page, typeInto, moveAndClick, moveTo, pause } = ctx;
    const useGoogle = process.env.USE_GOOGLE === "1";

    if (useGoogle) {
      console.log("Engine: Google (USE_GOOGLE=1)");
      await runGoogle(page, typeInto, moveAndClick, moveTo, pause);
    } else {
      console.log("Engine: DuckDuckGo HTML (set USE_GOOGLE=1 for Google)");
      await runDuckDuckGo(page, typeInto, moveAndClick, moveTo, pause);
    }

    // 4) Destination settle — short, with cursor parked if possible.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await pause(400);
    const park = page.locator("h1, [class*='hero'], header a, nav").first();
    if (await park.isVisible({ timeout: 2500 }).catch(() => false)) {
      await moveTo(park);
    }
    await pause(BEAT.AFTER_COMMIT);
  },
});
