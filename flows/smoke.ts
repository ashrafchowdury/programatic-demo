import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { BEAT, css, defineFlow } from "../scripts/lib/flow";

/**
 * Offline reference-rhythm harness (no cloud, no auth).
 *
 * Mirrors the Task Management analysis beats:
 *   0 establish → 1 priority menu cluster (long hold) → trail →
 *   2 far button cluster → settle
 *
 * Doubles as the only offline exercise of the name ladder (see autoCandidates
 * in scripts/lib/selectors.ts). Each target below deliberately lands on a
 * different rung, so `pnpm clip:smoke` fails if the ladder regresses — no
 * network, no auth, no live app required.
 *
 * Run: pnpm clip smoke
 */
const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "smoke.html"),
).href;

export default defineFlow({
  name: "smoke",
  viewport: { width: 1920, height: 1080 },
  steps: [
    {
      do: async ({ page }) => {
        await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
      },
    },

    // 0) Establish at scale 1 — park cursor near title, no zoom yet.
    //    css() rung: a layout anchor nobody would name out loud.
    { moveTo: css("#title"), after: BEAT.ESTABLISH },

    // 1) Sentence: open priority → pick High (one zoom cluster, long hold).
    //    "Medium" exercises two things at once: the chip reads "·· Medium" so
    //    no exact rung matches and it falls through to "control containing",
    //    and the menu's own hidden <button>Medium</button> would match the
    //    exact rung first — it is skipped only because resolveFirst requires
    //    VISIBLE. If either behaviour regresses, this picks the wrong element.
    {
      click: "Medium",
      label: "Open priority",
      cluster: "priority",
      after: BEAT.AFTER_OPEN,
    },
    // Exact rung: now that the menu is open, role=button name="High" matches.
    {
      click: "High",
      label: "Select High",
      cluster: "priority",
      // AFTER_SELECT plus a gap so the trail completes before the next lead-in.
      after: BEAT.AFTER_SELECT + 400,
    },

    // 2) Sentence: far action (new cluster / wider framing).
    { click: "Mark week complete", cluster: "done", after: BEAT.AFTER_COMMIT },
  ],
});
