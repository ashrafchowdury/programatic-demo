import type { Page } from "playwright";
import { assertDemoOwned, defineAction } from "../../scripts/lib/action";
import { BEAT, css } from "../../scripts/lib/flow";

/**
 * The New schedule drawer, told apart from the cadence popover and the time
 * picker inside it, which also claim role=dialog, by the button only it owns.
 */
const DRAWER_SELECTOR = '[role="dialog"]:has(button:text-is("Create automation"))';
const DRAWER = css(DRAWER_SELECTOR);

/** The hour/minute picker, told apart by a cell only it owns. */
const TIME_POPOVER = '[role="dialog"]:has(button:text-is("06"))';

/**
 * Shoot-time ms at a 1.25x replay. The cadence beats are the shortest because
 * those four clicks land a few dozen pixels apart inside one popover.
 */
const P = {
  /** The drawer slides in and the form needs reading. */
  AFTER_OPEN: 1400,
  AFTER_NAME: 700,
  /** Five chips and a day row to take in. */
  AFTER_POPOVER: 1100,
  /** The day row collapses and the trigger text rewrites itself. */
  AFTER_DAILY: 900,
  AFTER_TIME: 900,
  /** 08:00 lands in the chip, the trigger and the "Next run" line at once. */
  AFTER_HOUR: 900,
  AFTER_CLOSE: 800,
  AFTER_MESSAGE: 900,
  /** Create closes the drawer; this hold is the payoff. */
  AFTER_CREATE: 1000,
} as const;

/**
 * Three divs up from the + is where the Schedules rows join the header. Higher
 * swallows Subscriptions, whose rows carry the same "Open trigger actions"
 * label and are not this action's to delete.
 */
const SCHEDULES_SECTION = 'xpath=//button[@aria-label="Add automation"]/ancestor::div[3]';
const scheduleRows = (page: Page) => page.locator(SCHEDULES_SECTION).getByLabel("Open trigger actions");
/** Two divs up from a row's menu button is the innermost element holding the row's text. */
const rowOf = (page: Page, i: number) => scheduleRows(page).nth(i).locator("xpath=ancestor::div[2]");

async function scheduleNames(page: Page): Promise<string[]> {
  const n = await scheduleRows(page).count();
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(((await rowOf(page, i).innerText()).split("\n")[0] ?? "").trim());
  return names;
}

const SCHEDULES_QUERY = /\/api\/triggers\/schedules\/query/;
const RENDER_STEP_MS = 300;

/**
 * Reload and return once the section shows LOADED data. Its empty state
 * renders before the schedules query answers, so "no rows" and "not loaded"
 * look identical; the query's response is the only real signal. The listener
 * is armed before the reload because the response can land before reload()
 * resolves. After it, three equal row counts 300ms apart wait out the paint.
 */
async function loadSchedules(page: Page): Promise<void> {
  const answered = page
    .waitForResponse((r) => SCHEDULES_QUERY.test(r.url()), { timeout: 45_000 })
    .then(
      () => true,
      () => false,
    );
  await page.reload({ waitUntil: "domcontentloaded" });
  if (!(await answered))
    throw new Error("the schedules query never answered; an empty Schedules section and an unloaded one look identical");
  await page.locator(SCHEDULES_SECTION).first().waitFor({ state: "visible" });
  let last = -1;
  let held = 0;
  for (let i = 0; i < 40 && held < 3; i++) {
    const now = await scheduleRows(page).count();
    held = now === last ? held + 1 : 0;
    last = now;
    await page.waitForTimeout(RENDER_STEP_MS);
  }
}

/**
 * Open the New schedule drawer, name it, set the cadence to Daily at 08:00,
 * write the message and Create. Writes a server-side schedule named `name`.
 */
export default defineAction({
  id: "schedules.add",
  surface: "agent",
  // Measured on the hand flow: the drawer is ~640 CSS px at any width, and
  // 1280 is the widest shoot whose sharpness-legal crop keeps all of it.
  viewport: { width: 1280, height: 720 },
  params: {
    name: { type: "string", maxLength: 40, creates: true, description: "the schedule's name" },
    message: { type: "string", maxLength: 160, description: "what the agent is told on every run" },
  },
  labels: [
    "Add schedule",
    "create manually",
    "name the schedule",
    "open cadence",
    { label: "Daily", control: "Daily" },
    "open 09:00",
    "pick 08",
    "close cadence",
    "write the message",
    "keep it off",
    { label: "Create schedule", control: "Create automation" },
  ],
  mutates: "agent-schedules",
  example: {
    name: "demo-morning-audit",
    message: "Summarize yesterday's external PRs with title, author, repo, status, and key changes.",
  },
  targets: {
    // v0.122.8: "Add automation" opens a menu; the item's name carries its description.
    "Add schedule": (p) => [{ by: 'button "Add automation"', locator: p.getByRole("button", { name: "Add automation", exact: true }).first() }],
    "create manually": (p) => [{ by: "menuitem ^Create manually", locator: p.getByRole("menuitem", { name: /^Create manually/ }).first() }],
    // Created switched on, a daily automation would run the agent on its own
    // between takes; the demo leaves it off.
    "on switch": (p) => [{ by: 'drawer switch "Create this automation switched on"', locator: p.locator(DRAWER_SELECTOR).getByRole("switch").first() }],
    "Create schedule": (p) => [{ by: 'drawer button "Create automation"', locator: p.locator(DRAWER_SELECTOR).getByRole("button", { name: "Create automation", exact: true }).first() }],
    // "Name" is a plain div, not a <label>, and the placeholder is rewritten by
    // the cadence; the drawer's only <input> is the durable fact.
    "schedule name": (p) => [{ by: "the drawer's only <input>", locator: p.locator(`${DRAWER_SELECTOR} input`) }],
    "schedule message": (p) => [
      { by: "the drawer's only <textarea>", locator: p.locator(`${DRAWER_SELECTOR} textarea`) },
      {
        by: "drawer placeholder~Summarize yesterday's",
        locator: p.locator(DRAWER_SELECTOR).getByPlaceholder(/Summarize yesterday/i),
      },
    ],
    // The trigger has no name, only its value, which this action changes
    // between opening and closing it.
    cadence: (p) => [
      {
        by: "drawer control reading “… at HH:MM UTC”",
        locator: p.locator(DRAWER_SELECTOR).locator("button").filter({ hasText: /\bat \d\d:\d\d UTC/ }),
      },
    ],
    // aria-label "Run time 09:00 (UTC)" hides the chip's visible text from its name.
    "run time": (p) => [{ by: 'label~"Run time …"', locator: p.getByLabel(/^Run time /) }],
    // Scoped to the HOUR column: the minutes column is bare numbers too, and
    // the first visible match would win silently. "HOUR" is uppercase by CSS only.
    "hour 08": (p) => [
      {
        by: 'Hour column button "08"',
        locator: p
          .locator(TIME_POPOVER)
          .locator("div")
          .filter({ hasText: /^\s*hour/i })
          .last()
          .getByRole("button", { name: "08", exact: true }),
      },
      { by: 'button "08"', locator: p.getByRole("button", { name: "08", exact: true }) },
    ],
  },
  /**
   * Deletes the schedules named exactly `name` on this agent, one at a time,
   * then reloads and verifies against the server that the section is empty.
   * Deletes only demo data (assertDemoOwned). Refuses, without deleting, when
   * the section holds a schedule with another name: kept even with the prefix
   * rule, because the story opens on an empty Schedules section and a foreign
   * row would be filmed. The reload also closes any open drawer.
   */
  prepare: async ({ page }, { name }) => {
    await loadSchedules(page);
    for (let round = 0; round < 12; round++) {
      const names = await scheduleNames(page);
      const foreign = names.filter((n) => n !== name);
      if (foreign.length)
        throw new Error(
          `the Schedules section holds ${foreign.length} schedule(s) this action did not create ` +
            `(${foreign.join(", ")}); refusing to delete them`,
        );
      if (names.length === 0) break;
      assertDemoOwned(name, "schedule");
      await scheduleRows(page).first().click();
      await page.waitForTimeout(600);
      await page.getByRole("menuitem", { name: "Delete" }).click();
      for (let j = 0; j < 20 && (await scheduleRows(page).count()) >= names.length; j++)
        await page.waitForTimeout(RENDER_STEP_MS);
    }
    // A delete that failed server-side still drops the row locally; only a reload tells.
    await loadSchedules(page);
    const left = await scheduleNames(page);
    if (left.length) throw new Error(`could not clear the Schedules section (${left.join(", ")})`);
  },
  steps: ({ name, message }) => [
    { click: "Add schedule", cluster: "open", after: BEAT.AFTER_OPEN },
    { click: "create manually", label: "create manually", cluster: "open" },
    // Resolve Create schedule while the drawer is still animating in.
    { hoist: "Create schedule" },
    { pause: P.AFTER_OPEN },
    { type: "schedule name", text: name, label: "name the schedule", cluster: "form", after: P.AFTER_NAME },
    // One cluster framed on the whole drawer: every cadence click answers
    // somewhere else in it (the trigger above, "Next run" below), so framing
    // the controls themselves would land each answer off-frame.
    { click: "cadence", label: "open cadence", cluster: "cadence", frame: DRAWER, after: P.AFTER_POPOVER },
    { click: "Daily", cluster: "cadence", frame: DRAWER, after: P.AFTER_DAILY },
    { click: "run time", label: "open 09:00", cluster: "cadence", frame: DRAWER, after: P.AFTER_TIME },
    { click: "hour 08", label: "pick 08", cluster: "cadence", frame: DRAWER, after: P.AFTER_HOUR },
    { click: "cadence", label: "close cadence", cluster: "cadence", frame: DRAWER, after: P.AFTER_CLOSE },
    { type: "schedule message", text: message, label: "write the message", cluster: "message", after: P.AFTER_MESSAGE },
    { click: "on switch", label: "keep it off", cluster: "message", after: P.AFTER_CLOSE },
    // Framed on the drawer so the camera is wide enough to see the new row when the drawer slides away.
    { click: "Create schedule", cluster: "create", frame: DRAWER, after: P.AFTER_CREATE },
  ],
});
