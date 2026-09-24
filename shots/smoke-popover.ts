/**
 * The cutout edge cases, on an offline fixture: a rounded popover that does
 * not clip its bordered header and footer, beside a translucent oklch() card.
 *
 * Committed beside shots/smoke-cutout.ts so both regressions can be checked
 * with no account: `pnpm shot smoke-popover`, then look at the corners of
 * public/shots/smoke-popover.png. They must be round (a bordered child used to
 * get a square fill that poked past them) and the card must be opaque (an
 * oklch() fill used to be left see-through). The fixture also carries a fake
 * Next.js dev badge, which the clean-capture sheet removes, and a row with a
 * name in it, which `hide` removes.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "popover.html"),
).href;

export default defineShot({
  name: "smoke-popover",
  viewport: { width: 1280, height: 720 },
  startUrl: FIXTURE,
  look: "cutout",
  region: css(".menu"),
  keep: [css(".tint")],
  hide: [".personal"],
  backdrop: "chalk",
});
