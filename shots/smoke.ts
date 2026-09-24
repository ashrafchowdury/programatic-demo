/**
 * Worked example, and the offline check that the still pipeline runs.
 *
 * Committed for the same reason flows/smoke.ts and intros/smoke.ts are: it
 * needs no account, no network and no login, so `pnpm still smoke` is something
 * a fresh clone can actually execute. Copy this file to shots/<your-shot>.ts.
 *
 * Note the shape is a flow's: the steps below drive the fixture into the state
 * worth photographing (priority set to High) and only then is the region taken.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "smoke.html"),
).href;

export default defineShot({
  name: "smoke",
  viewport: { width: 1920, height: 1080 },
  startUrl: FIXTURE,
  steps: [
    { click: "Medium", label: "Open priority" },
    { click: "High", label: "Select High" },
  ],
  // css() rather than a name. The name ladder resolves to CONTROLS — it is
  // built for "click Save" — so it cannot reach a structural region like this
  // one, which has no accessible name at all. That is the normal case for the
  // interesting parts of an app, and css() is the answer to it.
  region: css(".board"),
  padding: 24,
  // A landscape board in a tall frame is a small window on a lot of ground:
  // 29% of square, 23% of portrait, 16% of story. There it is framed as a
  // bleed that fills the frame instead; `wide` and `og` keep the window.
  presets: {
    square: { look: "bleed", zoom: "fill" },
    portrait: { look: "bleed", zoom: "fill" },
    story: { look: "bleed", zoom: "fill" },
  },
});
