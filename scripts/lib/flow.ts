import type { Page, Locator } from "playwright";
import {
  clusterGapMs,
  END_TAIL_S,
  type ClickEvent,
  type ClickLog,
} from "../../src/lib/click-log";
import type { TargetOverrides } from "./selectors";

export type { ClickEvent, ClickLog };
export type { TargetOverrides };

/** Escape hatch: a raw CSS selector where a visible name will not do. */
export type CssTarget = { css: string };

/**
 * Wrap a raw CSS selector so it is not read as an element name.
 *
 *   moveAndClick("Save")          — find the control labelled "Save"
 *   moveAndClick(css("#done-btn")) — find this exact node
 */
export const css = (selector: string): CssTarget => ({ css: selector });

/**
 * A click/type target.
 *
 * A plain string is the element's VISIBLE NAME — its label, its button text,
 * the filename in its row — resolved through the ladder in selectors.ts. That
 * is the whole point: a demo should read like the script it came from, and a
 * name is what the script actually says.
 *
 * Use `css(...)` for a raw selector, a Locator when you resolved it yourself
 * (or want to hoist the cost out of a quiet beat — see ctx.find), or a point
 * for coordinates.
 */
export type Target = string | CssTarget | { x: number; y: number } | Locator;

/**
 * Options for logged pointer actions. These feed Remotion zoom clustering.
 * - `cluster`: same id = one zoom-in / hold / trail cycle; new id = new cycle.
 * - `zoom: false`: perform the action but do not contribute to zoom envelopes.
 * - `frame`: frame this element for zoom (e.g. whole card) while clicking `target`.
 */
export type ActionOpts = {
  cluster?: string;
  zoom?: boolean;
  /** Zoom frames this target (e.g. result card) while the click hits `target`. */
  frame?: Target;
  /**
   * Still beat between chunks when `text` is an array, in shoot-ms.
   *
   * Exists to shoot FOR the edit. A long field typed in one go is a solid block
   * of motion — measured against a reference ad, our clips were still for 12% of
   * their frames where its shots rest for 40%, and continuous typing is most of
   * the difference. Splitting the text lets the picture actually stop partway
   * through, which is what gives the surrounding movement something to read
   * against. The camera stays put: typeEndMs is stamped after the LAST chunk, so
   * the hold covers the whole beat rather than trailing out mid-sentence.
   */
  chunkPauseMs?: number;
  /**
   * Force the camera to this scale on this beat instead of fitting the framed
   * rect — for cropping tight on a WIDE target (a menu) the fit would pull back
   * from. Clamped to the sharpness ceiling. See ClickEvent.zoomScale.
   */
  zoomScale?: number;
  /**
   * Override the pointer glide duration (shoot-ms) for a deliberately SLOW move,
   * so a short travel can be drawn out to be felt. Default is distance-based
   * (~550 px/s). Pair with `hoverMs` to pause on the target before clicking.
   */
  travelMs?: number;
  /** Pause on the target after arriving, before the click (shoot-ms). A hover. */
  hoverMs?: number;
};

/**
 * Helpers handed to a flow. They perform the action AND (for clicks) log it, so
 * a flow reads like a script of user actions and the zoom timing falls out for free.
 */
export type FlowContext = {
  page: Page;
  baseURL: string;
  /** Glide the cursor to a target and click it. Logged for zoom unless zoom:false. */
  moveAndClick: (
    target: Target,
    label?: string,
    opts?: ActionOpts,
  ) => Promise<void>;
  /** Click a field (logged) then type into it at a human speed. */
  typeInto: (
    target: Target,
    text: string | readonly string[],
    label?: string,
    opts?: ActionOpts,
  ) => Promise<void>;
  /** Glide only — no click, no zoom log. Use for park / pre-position. */
  moveTo: (target: Target) => Promise<void>;
  /**
   * Glide to a target and log a zoom keyframe WITHOUT clicking.
   * Use for "consequence holds" (frame a card after a filter) or re-park
   * with camera intent after navigation.
   */
  focus: (target: Target, label?: string, opts?: ActionOpts) => Promise<void>;
  /**
   * Resolve a name to a Locator ahead of time.
   *
   * The helpers above resolve names inline, which is normally free — the first
   * rung of the ladder matches an on-screen element in a few ms. It is NOT free
   * when the element has not appeared yet, because then resolution blocks. Hoist
   * those with `find` during a beat where something else is already moving;
   * resolving mid-clip turned a 0.7s breath into a 1.9s hole once already.
   */
  find: (name: string) => Promise<Locator>;
  /** Pause for viewer comprehension. Defaults to 700ms. */
  pause: (ms?: number) => Promise<void>;
  /** Wait for a URL/selector without moving the cursor (no zoom). */
  page_waitForURL: Page["waitForURL"];
};

export type Flow = {
  /** Used for output filenames: recordings/<name>.webm, public/<name>.mp4, etc. */
  name: string;
  viewport: { width: number; height: number };
  /**
   * Where the demo starts. Live flows recorded by `scripts/record-live.ts` set
   * this so the recorder can navigate before handing over. Flows that navigate
   * themselves (google-search, smoke) leave it unset.
   */
  startUrl?: string;
  /**
   * Resolves once the page is ready to drive — used to wait out login,
   * onboarding and first paint without guessing at a timeout. Throwing or
   * returning false keeps the recorder waiting.
   */
  ready?: (page: Page) => Promise<boolean>;
  /**
   * Put the app into its "before" state, off camera.
   *
   * Runs after `ready` and before the recording clock starts, so anything it
   * does lands in the trimmed-away head of the video. Use it to undo the
   * previous take — a demo that writes something should not open with that
   * thing already written. Best-effort: throwing here is logged and the shoot
   * continues, since a stale starting state is worth less than a failed run.
   */
  prepare?: (page: Page) => Promise<void>;
  /**
   * Hand-written candidates for targets the name ladder cannot reach — an
   * element with no accessible name, or a name that matches several things.
   * Everything else needs no entry here; most flows need none at all.
   */
  targets?: TargetOverrides;
  /**
   * Name of the app state this flow writes to, for batch scheduling.
   *
   * Flows sharing a key never run at the same time — see laneOf in batch.ts.
   * Set it when two DIFFERENT demos touch one thing (two flows editing the same
   * agent). A flow is already protected from overlapping itself, so leaving this
   * unset is correct for most demos.
   */
  mutates?: string;
  /** Studio backdrop name for this demo. See src/lib/backdrop.ts. */
  backdrop?: string;
  /** The actions to record. Use ctx helpers so clicks are logged for zoom. */
  run: (ctx: FlowContext) => Promise<void>;
};

/** Shared by every acting step. */
type StepCommon = {
  /** Overrides the label in the click log; defaults to the target's name. */
  label?: string;
  /** Same id = one zoom-in / hold / trail cycle. See ActionOpts. */
  cluster?: string;
  /** false = perform the action but contribute no zoom envelope. */
  zoom?: boolean;
  /** Zoom frames this instead of the clicked element (e.g. the whole card). */
  frame?: Target;
  /** Beat after the action, in shoot-time ms. Replaces a trailing pause(). */
  after?: number;
  /** Still beat between chunks of an array `text`. See ActionOpts. */
  chunkPauseMs?: number;
  /** Force the camera to this scale instead of fitting. See ActionOpts. */
  zoomScale?: number;
  /** Draw the pointer glide out to this duration (shoot-ms). See ActionOpts. */
  travelMs?: number;
  /** Pause on the target before clicking (shoot-ms) — a hover. See ActionOpts. */
  hoverMs?: number;
};

/**
 * One line of a demo script.
 *
 * A flow written as `steps` reads like the thing a person asked for — "click
 * AGENTS.md, type this, click Save" — with the pacing beside each beat instead
 * of interleaved between statements. `defineFlow` compiles it to the same `run`
 * function a hand-written flow provides, so nothing downstream can tell the
 * difference.
 *
 * `do` is the escape hatch: conditionals, navigation waits, retries, anything
 * the list cannot say. Reach for it per-step rather than abandoning `steps`.
 */
export type Step =
  | ({ click: Target } & StepCommon)
  | ({ type: Target; text: string | readonly string[] } & StepCommon)
  | ({ focus: Target } & StepCommon)
  | ({ moveTo: Target } & StepCommon)
  /** Hold still. The opening establish beat is just this, first in the list. */
  | { pause: number }
  /**
   * Resolve a name NOW and reuse it for the rest of the run.
   *
   * Resolution is normally inline and costs a few ms, but it blocks when the
   * element has not rendered yet — and a block during a still beat reads as
   * dead air. Hoist those during a beat where something else is already moving.
   */
  | { hoist: string }
  | ({ do: (ctx: FlowContext) => Promise<void> } & Pick<StepCommon, "after">);

/** The label to log for a step, when it did not set one explicitly. */
const nameOf = (t: Target): string | undefined =>
  typeof t === "string" ? t : undefined;

const actionOpts = (s: StepCommon) => ({
  cluster: s.cluster,
  zoom: s.zoom,
  frame: s.frame,
  chunkPauseMs: s.chunkPauseMs,
  zoomScale: s.zoomScale,
  travelMs: s.travelMs,
  hoverMs: s.hoverMs,
});

/** Drive a step list through the same helpers a hand-written `run` would use. */
export async function runSteps(
  ctx: FlowContext,
  steps: readonly Step[],
): Promise<void> {
  /** Names resolved by a `hoist` step, reused by later steps that name them. */
  const hoisted = new Map<string, Locator>();
  const target = (t: Target): Target =>
    typeof t === "string" ? (hoisted.get(t) ?? t) : t;

  for (const step of steps) {
    if ("pause" in step) {
      await ctx.pause(step.pause);
      continue;
    }
    if ("hoist" in step) {
      hoisted.set(step.hoist, await ctx.find(step.hoist));
      continue;
    }
    if ("do" in step) {
      await step.do(ctx);
    } else if ("click" in step) {
      await ctx.moveAndClick(
        target(step.click),
        step.label ?? nameOf(step.click),
        actionOpts(step),
      );
    } else if ("type" in step) {
      await ctx.typeInto(
        target(step.type),
        step.text,
        step.label ?? nameOf(step.type),
        actionOpts(step),
      );
    } else if ("focus" in step) {
      await ctx.focus(
        target(step.focus),
        step.label ?? nameOf(step.focus),
        actionOpts(step),
      );
    } else {
      await ctx.moveTo(target(step.moveTo));
    }
    if (step.after) await ctx.pause(step.after);
  }
}

/** A flow says what to do EITHER as a step list or as a run function. */
export type FlowInput = Omit<Flow, "run"> &
  (
    | { steps: readonly Step[]; run?: never }
    | { run: Flow["run"]; steps?: never }
  );

export function defineFlow(flow: FlowInput): Flow {
  const { steps, ...rest } = flow;
  if (!steps && !rest.run)
    throw new Error(`flow "${flow.name}" defines neither steps nor run`);
  return {
    ...rest,
    run: rest.run ?? ((ctx) => runSteps(ctx, steps!)),
  };
}

/** Shared beat timing (ms) — derived from the camera timing constants. */
export const BEAT = {
  /** Full-product readable before first lead-in. */
  ESTABLISH: 700,
  /** After opening a control / menu. */
  AFTER_OPEN: 1100,
  /** Hold on results list before the next cluster (read the SERP). */
  SERP_READ: 800,
  /**
   * Gap after a cluster so HOLD_MIN + a conservative zoom-out finish before
   * the next LEAD. Use after the last click of a cluster when the next beat
   * is a new cluster (on top of SERP_READ / AFTER_OPEN).
   */
  CLUSTER_GAP: clusterGapMs(),
  /** After selecting an option. */
  AFTER_SELECT: 1500,
  /** After a commit / navigation payoff. */
  AFTER_COMMIT: 1000,
  /** Kept for older flows; the recorder owns the 1s end tail — do not also pause this. */
  SETTLE: Math.round(END_TAIL_S * 1000),
} as const;
