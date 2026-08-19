/**
 * A shot: the recipe for one still image.
 *
 * Deliberately shaped like a Flow — same viewport, same startUrl, same ready /
 * prepare hooks, same `steps` list — because the hard part of photographing an
 * app is not the photograph, it is getting the app into the state worth
 * photographing. A shot reuses the flow machinery to drive there and then adds
 * the one thing a flow has no concept of: which PART of the screen to keep.
 *
 * Steps are copy-pasteable between a flow and a shot in both directions.
 *
 * Lives in scripts/ rather than src/ because it references Playwright types
 * through Step and TargetOverrides. The RENDER side never sees this file — the
 * two halves meet at the ShotMeta sidecar in src/lib/still.ts.
 */
import type { Page } from "playwright";
import type { CssTarget, Step } from "./flow";
import type { TargetOverrides } from "./selectors";

/** An explicit region in viewport CSS px. */
export type ShotRect = { x: number; y: number; w: number; h: number };

/**
 * What to photograph.
 *
 * A bare string is a visible NAME, resolved through the same ladder clicks use
 * (autoCandidates in ./selectors). That ladder is tuned for interactive
 * elements, so it is the right tool for "the Save button" and the wrong one for
 * "the sidebar" — structural regions have no accessible name and will miss.
 * Reach for css() there, or a rect when the region is not one element at all.
 *
 * Omit the region entirely to shoot the whole viewport.
 */
export type ShotRegion = string | CssTarget | ShotRect;

export const isShotRect = (r: ShotRegion): r is ShotRect =>
  typeof r === "object" && "w" in r && "h" in r;

export type ShotSpec = {
  /** Output name: public/shots/<name>.png and out/shots/<name>-<preset>.png. */
  name: string;
  viewport: { width: number; height: number };
  /** Where to start. Read from process.env.DEMO_URL_<NAME> — never hardcoded. */
  startUrl?: string;
  /** Polled until the app is usable, exactly as a flow's is. */
  ready?: (page: Page) => Promise<boolean>;
  /** Put the app into its "before" state. Best-effort; a throw is logged. */
  prepare?: (page: Page) => Promise<void>;
  /** Hand-written candidates for names the ladder cannot reach. */
  targets?: TargetOverrides;
  /** Drive the app into the state worth photographing. Omit to shoot on load. */
  steps?: readonly Step[];
  /** Studio backdrop name. See src/lib/backdrop.ts. */
  backdrop?: string;
  /** The part to keep. Omit for the whole viewport. */
  region?: ShotRegion;
  /**
   * Breathing room around a resolved element, in CSS px. Default SHOT_PADDING.
   *
   * An element's bounding box stops at its border, so a card with a drop shadow
   * or a focus ring gets it sliced off at the crop. Padding is applied after
   * resolution and clamped to the viewport, so a region at the screen edge
   * simply gets less of it rather than failing.
   */
  padding?: number;
  /**
   * Force the capture device scale factor instead of measuring for it.
   *
   * The capture stage otherwise runs once at DEVICE_SCALE_FACTOR, measures what
   * the region actually came out to, and re-runs at a higher factor if it fell
   * short of 4K. Setting this skips the second pass — worth doing once a shot
   * is settled, since the re-run drives the whole step list again.
   */
  scale?: number;
};

export const defineShot = (spec: ShotSpec): ShotSpec => spec;

/** Default breathing room around a resolved element, in CSS px. */
export const SHOT_PADDING = 16;

/**
 * Runtime shape check for a spec loaded by dynamic import.
 *
 * shots/*.ts are gitignored per-account files, so they sit outside the tsc
 * program for the same reason flows and intros do — the compiler never sees
 * them, and a typo would otherwise surface as a blank or wrongly-cropped image
 * after a full browser run. Mirrors introProblem: returns the reason, or null.
 */
export function shotProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const shot = value as Partial<ShotSpec>;
  if (typeof shot.name !== "string" || shot.name === "")
    return "missing a `name`";
  const vp = shot.viewport;
  if (typeof vp !== "object" || vp === null) return "missing a `viewport`";
  if (!(typeof vp.width === "number" && vp.width > 0))
    return "`viewport.width` must be a number > 0";
  if (!(typeof vp.height === "number" && vp.height > 0))
    return "`viewport.height` must be a number > 0";
  if (shot.steps !== undefined && !Array.isArray(shot.steps))
    return "`steps` must be an array";
  if (
    shot.padding !== undefined &&
    !(typeof shot.padding === "number" && shot.padding >= 0)
  )
    return "`padding` must be a number >= 0";
  if (
    shot.scale !== undefined &&
    !(typeof shot.scale === "number" && shot.scale >= 1 && shot.scale <= 4)
  )
    return "`scale` must be a number between 1 and 4";
  const region = shot.region;
  if (region !== undefined) {
    if (typeof region === "string") {
      if (region === "") return "`region` is an empty name";
    } else if (typeof region === "object" && region !== null) {
      if ("css" in region) {
        if (typeof region.css !== "string" || region.css === "")
          return "`region` css selector is empty";
      } else if (isShotRect(region as ShotRegion)) {
        for (const key of ["x", "y", "w", "h"] as const) {
          const v = (region as ShotRect)[key];
          if (typeof v !== "number") return `\`region.${key}\` must be a number`;
        }
        if ((region as ShotRect).w <= 0 || (region as ShotRect).h <= 0)
          return "`region` must have a positive width and height";
      } else {
        return "`region` must be a name, css(...), or {x,y,w,h}";
      }
    } else {
      return "`region` must be a name, css(...), or {x,y,w,h}";
    }
  }
  return null;
}
