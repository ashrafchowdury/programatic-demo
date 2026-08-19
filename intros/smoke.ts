/**
 * Worked example, and the card Studio opens on.
 *
 * Committed because `smoke` is the generic offline fixture — the same reason
 * flows/smoke.ts is committed while the rest of flows/ is ignored. Copy this
 * file to intros/<your-demo>.ts; nothing here needs registering.
 *
 * Only copy lives in this file. Pacing is derived from the word count in
 * src/lib/intro.ts, so there is nothing to time by hand.
 */
import { defineIntro } from "../src/lib/intro";

export default defineIntro({
  name: "smoke",
  headline: "Product demos, straight from the code",
  subhead: "Recorded, framed and rendered by one command.",
  wordmark: "Programatic",
});
