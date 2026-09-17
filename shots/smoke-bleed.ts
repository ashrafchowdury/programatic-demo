/**
 * The bleed look, on the offline fixture: the window drawn larger than the
 * canvas and pinned to the top-left, so it runs off the right and bottom.
 *
 * A bleed is a window capture framed differently, so the capture half is
 * identical to shots/smoke.ts; only the framing fields differ. Any of them can
 * be overridden at render time without re-shooting:
 *   pnpm render:still smoke-bleed --anchor=bottom-right --zoom=1.5
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { css } from "../scripts/lib/flow";
import { defineShot } from "../scripts/lib/shot";

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "scripts", "fixtures", "smoke.html"),
).href;

export default defineShot({
  name: "smoke-bleed",
  viewport: { width: 1920, height: 1080 },
  startUrl: FIXTURE,
  steps: [
    { click: "Medium", label: "Open priority" },
    { click: "High", label: "Select High" },
  ],
  region: css(".app"),
  padding: 0,
  look: "bleed",
  anchor: "top-left",
});
