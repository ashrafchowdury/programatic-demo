import { assertDemoOwned, defineAction } from "../../scripts/lib/action";
import { BEAT } from "../../scripts/lib/flow";

/**
 * The drawer opens over a playground full of other named fields, so every
 * field is scoped to it. The body editor is a Lexical contenteditable with no
 * name; its class is the only handle.
 */
const DIALOG = '[role="dialog"]';

/**
 * Shoot-time ms, tuned for a 1.5x replay: each value is ~20% longer than the
 * 1.25x flows' equivalents so it survives the speed-up.
 */
const P = {
  /** The drawer slides in and the form needs reading. */
  AFTER_OPEN: 1900,
  AFTER_NAME: 1200,
  AFTER_DESCRIPTION: 1200,
  /** A still beat between the body's two paragraphs, so ~5s of typing does not read as one block. */
  MID_BODY: 1100,
  AFTER_BODY: 1400,
  /** Create closes the drawer; this hold is the payoff, the new row in Skills. */
  AFTER_CREATE: 1600,
} as const;

/**
 * Agenta v0.122.8: "Add skill" opens a menu, "Add manually" opens the skills
 * library, and "New skill" opens the form; "Create skill" adds it to the
 * agent. Measured on the demo agent. Writes a skill row named `name`.
 */
export default defineAction({
  id: "skills.add",
  surface: "agent",
  params: {
    name: { type: "string", maxLength: 40, creates: true, description: "the skill's name, a slug" },
    description: { type: "string", maxLength: 120, description: "when the agent should reach for it" },
    body: { type: "string", maxLength: 200, description: "SKILL.md, first paragraph" },
    bodyMore: { type: "string", maxLength: 200, description: "SKILL.md, second paragraph, typed after a still beat" },
  },
  labels: [
    "Add skill",
    "add manually",
    "New skill",
    "name the skill",
    "describe the skill",
    "write SKILL.md",
    { label: "Create", control: "Create skill" },
  ],
  mutates: "agent-skills",
  // Measured: "Create skill" also saves a copy to the account's skills
  // library (demo-pr-security-454f, -50d1 after two checks), and no delete
  // path for the library has been measured yet.
  unrestored: "leaves one demo-prefixed copy of the skill in the account's skills library per take",
  example: {
    name: "demo-pr-security",
    description: "Flag security risks in pull request diffs",
    body: "Scan the diff for injection risks, hardcoded secrets, missing auth checks, and unsafe deserialization.",
    bodyMore: "List each finding as file:line, severity (high/med/low), and a one-line fix.",
  },
  targets: {
    // The menu item's name carries its description ("…From your library, or write one").
    "add manually": (p) => [{ by: "menuitem ^Add manually", locator: p.getByRole("menuitem", { name: /^Add manually/ }).first() }],
    "New skill": (p) => [{ by: 'dialog button "New skill"', locator: p.locator(DIALOG).getByRole("button", { name: "New skill", exact: true }).first() }],
    "Create skill": (p) => [{ by: 'dialog button "Create skill"', locator: p.locator(DIALOG).getByRole("button", { name: "Create skill", exact: true }).first() }],
    "skill name": (p) => [
      { by: 'dialog placeholder="my-skill"', locator: p.locator(DIALOG).getByPlaceholder("my-skill") },
      { by: 'dialog label="Name"', locator: p.locator(DIALOG).getByLabel(/^Name$/) },
    ],
    "skill description": (p) => [
      {
        by: "dialog placeholder~When the agent should reach",
        locator: p.locator(DIALOG).getByPlaceholder(/When the agent should reach/i),
      },
      { by: 'dialog label="Description"', locator: p.locator(DIALOG).getByLabel(/^Description$/) },
    ],
    "skill body": (p) => [
      { by: "dialog .editor-input", locator: p.locator(`${DIALOG} .editor-input`) },
      {
        by: "[contenteditable] in drawer",
        locator: p.locator(`${DIALOG} [contenteditable="true"][role="textbox"]`).last(),
      },
    ],
  },
  /**
   * Deletes rows whose name is exactly `name`, then verifies nothing on the
   * page still reads `name` even as a substring. A skill row is a plain DIV
   * with no role: the row is the nearest DIV ancestor of the name holding a
   * Remove button. The loose verify is what keeps a missed row from passing as
   * clean; the exact delete is what keeps a foreign skill that merely contains
   * `name` from being removed.
   */
  prepare: async ({ page }, { name }) => {
    const rows = () => page.getByText(name, { exact: true });
    // Only demo data is ours to delete; anything else stops the shoot by name.
    if ((await rows().count()) > 0) assertDemoOwned(name, "skill");
    for (let i = 0; i < 20; i++) {
      const before = await rows().count();
      if (before === 0) break;
      const row = rows().first().locator('xpath=ancestor::div[.//button[@aria-label="Remove"]][1]');
      const remove = row.locator('button[aria-label="Remove"]').first();
      if ((await remove.count()) === 0) break;
      await row.scrollIntoViewIfNeeded().catch(() => {});
      await remove.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      if ((await rows().count()) >= before) break;
    }
    // Read it back after a reload: an in-page removal is not proof the
    // server kept it (measured on the integrations reset, v0.122.8).
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add skill", exact: true }).waitFor({ state: "visible", timeout: 90_000 });
    const left = await page.getByText(name).count();
    if (left > 0)
      throw new Error(
        `${left} element(s) still read "${name}" after deleting the skill rows named exactly that; ` +
          `either the row/Remove selector changed or another skill's name contains it`,
      );
  },
  steps: ({ name, description, body, bodyMore }) => [
    // The menu and the library are new in v0.122.8; their beats take the
    // shared BEAT.AFTER_OPEN until a take is measured.
    { click: "Add skill", cluster: "open", after: BEAT.AFTER_OPEN },
    { click: "add manually", label: "add manually", cluster: "open", after: BEAT.AFTER_OPEN },
    { click: "New skill", cluster: "open" },
    // Resolve Create skill while the form is still animating in, so the block lands on a moving beat.
    { hoist: "Create skill" },
    { pause: P.AFTER_OPEN },
    { type: "skill name", text: name, label: "name the skill", cluster: "form", after: P.AFTER_NAME },
    {
      type: "skill description",
      text: description,
      label: "describe the skill",
      cluster: "form",
      after: P.AFTER_DESCRIPTION,
    },
    // The newline is an Enter press: a paragraph break in the Lexical editor.
    {
      type: "skill body",
      text: [`${body}\n`, bodyMore],
      label: "write SKILL.md",
      cluster: "form",
      chunkPauseMs: P.MID_BODY,
      after: P.AFTER_BODY,
    },
    { click: "Create skill", label: "Create", cluster: "create", after: P.AFTER_CREATE },
  ],
});
