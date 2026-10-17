import { defineSurface } from "../scripts/lib/action";
import { softByName } from "../scripts/lib/selectors";

/**
 * Agenta's agent configuration page: the configuration panel (Skills, Tools,
 * Schedules) beside the chat. Start URL from DEMO_URL_AGENT (see .env.example).
 *
 * No captureScale pin, matching agent-skill. agent-tool and agent-schedule
 * record that a root zoom of 2 misplaces their Radix portals (failure mode 3 in
 * scripts/lib/capture-scale.ts); shoot those at CAPTURE_SCALE=1.
 */
export default defineSurface({
  id: "agent",
  viewport: { width: 1920, height: 1080 },
  ready: async (page) => (await softByName(page, "Add skill")) !== null,
});
