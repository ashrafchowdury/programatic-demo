/**
 * The cutout look, on the offline fixture: the app card alone, with its own
 * shadow and transparent corners, on a light backdrop.
 *
 * Committed beside shots/smoke.ts for the same reason: `pnpm still smoke-cutout`
 * must run on a fresh clone with no account.
 *
 * The region is the whole card, not the board inside it as in smoke.ts: a
 * cutout wants the element that OWNS the shadow and the rounded corners. Its
 * shadow (0 20px 50px at 8%) paints about 60px below the card, well inside a
 * 1080 viewport; set the height to 800 to see the edge warning fire.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "smoke.html"),
).href;

export default defineShot({
  name: "smoke-cutout",
  viewport: { width: 1920, height: 1080 },
  startUrl: FIXTURE,
  steps: [
    { click: "Medium", label: "Open priority" },
    { click: "High", label: "Select High" },
  ],
  look: "cutout",
  region: css(".app"),
  // The card's own shadow is soft and dark, so it needs a light ground to read.
  backdrop: "chalk",
});
