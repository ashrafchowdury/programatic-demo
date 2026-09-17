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
import {
  framingProblem,
  maxScaleFor,
  splitProblem,
  type Anchor,
  type StillLook,
} from "../../src/lib/still";

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
  /**
   * Present as a mobile browser (tablet UA + mobile client hints). For apps
   * that serve a separate mobile layout and route by the hint rather than the
   * viewport — see ContextSpec.mobile in ./session.
   */
  mobile?: boolean;
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
  /**
   * A flat ground colour instead of a backdrop image, e.g. "#f3f3f3". The
   * reference stills all sit on one: the product is the picture and the ground
   * is a margin, so a photograph behind it competes. Wins over `backdrop`.
   */
  ground?: string;
  /** The part to keep. Omit for the whole viewport. */
  region?: ShotRegion;
  /**
   * Cutout only: further elements kept alongside `region`, as css() targets —
   * a popover's submenu, the chip a menu opened from. Isolated together; the
   * body is their union, so the shadow of each is in the picture.
   */
  keep?: readonly CssTarget[];
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
   * short — up to what the viewport's surface budget allows (maxScaleFor in
   * src/lib/still.ts). Setting this skips the second pass — worth doing once a
   * shot is settled, since the re-run drives the whole step list again.
   */
  scale?: number;
  /**
   * How to frame it. See STILL_LOOKS in src/lib/still.ts.
   *
   *   window  (default) the crop in the floating window frame
   *   cutout  the element alone, own shadow, transparent edges. Needs an
   *           element region — a name or css() — since there has to be one
   *           element to isolate; a rect or the whole viewport is refused
   *   bleed   the window drawn larger than the canvas, anchored to an edge
   */
  look?: StillLook;
  /** cutout: fraction of the canvas the element may occupy. Default CUTOUT_FIT. */
  fit?: number;
  /** cutout, bleed: where on the canvas. Cutout defaults to center, bleed to top-left. */
  anchor?: Anchor;
  /** cutout, bleed: fraction of the canvas edge kept clear on the anchored side(s). */
  inset?: number;
  /** bleed: how much larger than the fitted window. Default BLEED_ZOOM. */
  zoom?: number;
  /** cutout: cast a soft shadow. Default: only when the element brought none. */
  shadow?: boolean;
  /**
   * Cut the still into this many pieces, side by side, each the preset's size.
   * The layout happens once across all of them, so posted in order they read
   * as one picture. See splitCanvas in src/lib/still.ts.
   */
  split?: number;
  /** Output px of the composition left out between pieces: the platform's gap. */
  gutter?: number;
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
  if (shot.mobile !== undefined && typeof shot.mobile !== "boolean")
    return "`mobile` must be a boolean";
  if (shot.steps !== undefined && !Array.isArray(shot.steps))
    return "`steps` must be an array";
  if (
    shot.padding !== undefined &&
    !(typeof shot.padding === "number" && shot.padding >= 0)
  )
    return "`padding` must be a number >= 0";
  if (shot.scale !== undefined) {
    const max = maxScaleFor(vp as { width: number; height: number });
    if (!(typeof shot.scale === "number" && shot.scale >= 1 && shot.scale <= max))
      return `\`scale\` must be a number between 1 and ${max} for a ${vp.width}x${vp.height} viewport`;
  }
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
  const framing = framingProblem(shot) ?? splitProblem(shot);
  if (framing) return framing;
  if (shot.keep !== undefined) {
    if (!Array.isArray(shot.keep) || shot.keep.some((k) => typeof k?.css !== "string" || k.css === ""))
      return "`keep` must be a list of css(...) targets";
    if (shot.look !== "cutout") return "`keep` only applies to look: \"cutout\"";
  }
  if (shot.look === "cutout") {
    if (region === undefined) return "a cutout needs a `region` naming one element";
    if (typeof region === "object" && isShotRect(region as ShotRegion))
      return "a cutout `region` must be a name or css(...), not a rect — there is no element to isolate";
  }
  return null;
}
