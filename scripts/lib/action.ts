/**
 * Product actions and surfaces: the library a brief's footage is composed from.
 *
 * A SURFACE is a place in the product a shoot starts from: its start URL (only
 * ever from the environment, `DEMO_URL_<SURFACE>`), what "loaded" looks like,
 * the viewport, the backdrop. An ACTION is one verified piece of interaction on
 * a surface: `skills.add`, `tools.add-integration`. It declares a closed
 * parameter schema, the labels it logs in order, a `prepare` that resets what
 * it writes and then verifies the reset, and its steps as a function of its
 * parameters. Its pacing (its `P` table) stays inside it, tuned to its UI; the
 * house owns the rhythm between actions.
 *
 * Because labels are DECLARED, a brief is checkable with no app running, and a
 * take that skipped or renamed a step fails at record time (labelMismatch)
 * instead of shipping as a wrong cut.
 *
 * Files: surfaces/<id>.ts and actions/<surface>/<id>.ts, each a default
 * export. Both are committed, so neither may hold a URL, hostname or account
 * id; action-hygiene.test.ts enforces that.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { declaredLabels, footageProblems, labelName, type Footage, type LabelSpec } from "../../src/lib/brief";
import type { House } from "../../src/lib/house";
import {
  describeParam,
  paramProblems,
  type ParamSchema,
  type ParamValues,
  type Problem,
} from "../../src/lib/params";
import { runSteps, type ClickEvent, type Flow, type Step } from "./flow";
import type { TargetOverrides } from "./selectors";

export type Surface = {
  /** Lowercase, hyphenated. Names the file and the env key. */
  id: string;
  viewport: { width: number; height: number };
  /** True once the page can be driven. Throwing or false keeps waiting. */
  ready: (page: Page) => Promise<boolean>;
  /** Studio backdrop. See src/lib/backdrop.ts. */
  backdrop?: string;
  /** Pin the capture scale. See Flow.captureScale. */
  captureScale?: number;
  /** Selector overrides every action on this surface may use. */
  targets?: TargetOverrides;
};

/** What `prepare` gets: the page, and where the surface starts. */
export type PrepareContext = { page: Page; startUrl: string };

export type Action<S extends ParamSchema = ParamSchema> = {
  /** `<area>.<verb>`, e.g. `skills.add`. Names the file. */
  id: string;
  surface: string;
  params: S;
  /**
   * Every label the steps log, in the order they log them. A label a payoff
   * chip may name declares its control's on-screen text:
   * `{ label: "pick domain", control: { param: "domain" } }`.
   */
  labels: readonly LabelSpec[];
  /** Film at this size instead of the surface's, for a UI tuned at another. */
  viewport?: { width: number; height: number };
  /**
   * Reset what this action writes, then VERIFY the reset and throw naming
   * whatever survived. Must be idempotent: run twice, the second run is a
   * no-op that passes. A prepare that reports success over a dirty state is a
   * contract violation.
   */
  prepare: (ctx: PrepareContext, params: ParamValues<S>) => Promise<void>;
  steps: (params: ParamValues<S>) => Step[];
  /** The app state this action writes, for batch lanes. */
  mutates: string;
  /** Parameters `actions:check` shoots with; also the catalog's example. */
  example: ParamValues<S>;
  /** Selector overrides only this action needs. */
  targets?: TargetOverrides;
  /**
   * App state this action changes and its prepare cannot restore, said in a
   * sentence. `actions:check` skips such an action unless asked with
   * `--include-unrestored`, since checking it would leave the change behind.
   */
  unrestored?: string;
};

/** An action with its parameter types erased, as the registry holds it. */
export type AnyAction = Omit<Action, "prepare" | "steps" | "example"> & {
  prepare: (ctx: PrepareContext, params: Record<string, unknown>) => Promise<void>;
  steps: (params: Record<string, unknown>) => Step[];
  example: Record<string, unknown>;
};

/**
 * Everything an action creates for a demo carries this prefix, so a prepare
 * can tell a leftover take from real data. Prepares delete only prefixed
 * items and refuse, naming the item, rather than touch anything else.
 */
export const DEMO_PREFIX = "demo-";

/** Throws unless `name` is demo data a prepare may delete. */
export function assertDemoOwned(name: string, what: string): void {
  if (!name.startsWith(DEMO_PREFIX))
    throw new Error(
      `refusing to delete ${what} "${name}": it lacks the "${DEMO_PREFIX}" prefix, so it may be real data. ` +
        `Remove it by hand, or give demo data a "${DEMO_PREFIX}" name`,
    );
}

export const defineSurface = (surface: Surface): Surface => surface;
export const defineAction = <S extends ParamSchema>(action: Action<S>): AnyAction =>
  action as unknown as AnyAction;

/** `agent` -> `DEMO_URL_AGENT`, `example-skillsmp` -> `DEMO_URL_EXAMPLE_SKILLSMP`. */
export const surfaceEnvKey = (id: string): string =>
  `DEMO_URL_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

export type Registry = {
  surfaces: ReadonlyMap<string, Surface>;
  actions: ReadonlyMap<string, AnyAction>;
};

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ACTION_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const tsFiles = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")) : [];

/**
 * Every surface and action under `root`, by directory scan. Problems are the
 * files that do not load or do not sit where their id says; contract problems
 * are actionProblems' job.
 */
export async function loadRegistry(root = ROOT): Promise<{ registry: Registry; problems: string[] }> {
  const problems: string[] = [];
  const surfaces = new Map<string, Surface>();
  const actions = new Map<string, AnyAction>();
  const load = async (file: string): Promise<unknown> => {
    try {
      return (await import(pathToFileURL(file).href)).default;
    } catch (err) {
      problems.push(`${path.relative(root, file)} does not load: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  };

  const surfaceDir = path.join(root, "surfaces");
  for (const f of tsFiles(surfaceDir)) {
    const s = (await load(path.join(surfaceDir, f))) as Surface | undefined;
    if (!s) continue;
    if (!ID.test(s.id)) problems.push(`surfaces/${f}: surface id "${s.id}" must be lowercase and hyphenated`);
    else if (`${s.id}.ts` !== f) problems.push(`surfaces/${f} defines surface "${s.id}"; the file must be surfaces/${s.id}.ts`);
    else surfaces.set(s.id, s);
  }

  const actionDir = path.join(root, "actions");
  const dirs = fs.existsSync(actionDir)
    ? fs.readdirSync(actionDir).filter((d) => fs.statSync(path.join(actionDir, d)).isDirectory())
    : [];
  for (const dir of dirs.sort()) {
    for (const f of tsFiles(path.join(actionDir, dir)).sort()) {
      const a = (await load(path.join(actionDir, dir, f))) as AnyAction | undefined;
      if (!a) continue;
      const rel = `actions/${dir}/${f}`;
      if (`${a.id}.ts` !== f || a.surface !== dir)
        problems.push(`${rel} defines "${a.id}" on surface "${a.surface}"; the file must be actions/${a.surface}/${a.id}.ts`);
      else if (actions.has(a.id)) problems.push(`${rel}: action id "${a.id}" is defined twice`);
      else actions.set(a.id, a);
    }
  }
  return { registry: { surfaces, actions }, problems };
}

/**
 * The labels a step list logs, read without running it.
 *
 * A click, type or focus step logs `label`, else its target's name. A `do`
 * step can log anything, so an action must not log from one: the record-time
 * label check (labelMismatch) is what catches it if one does.
 */
export function stepLabels(steps: readonly Step[]): { labels: string[]; unlabeled: number[] } {
  const labels: string[] = [];
  const unlabeled: number[] = [];
  steps.forEach((step, i) => {
    const target = "click" in step ? step.click : "type" in step ? step.type : "focus" in step ? step.focus : undefined;
    if (target === undefined) return;
    const label = (step as { label?: string }).label ?? (typeof target === "string" ? target : undefined);
    if (label === undefined) unlabeled.push(i);
    else labels.push(label);
  });
  return { labels, unlabeled };
}

/** Least valid value per parameter: steps built from it must log the same labels. */
const minimalParams = (schema: ParamSchema): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(schema)
      .filter(([, s]) => !s.optional)
      .map(([k, s]) => [
        k,
        s.type === "string" ? "x".repeat(s.minLength ?? 1) : s.type === "number" ? (s.min ?? 0) : false,
      ]),
  );

/** The static half of the action contract. Each entry is a sentence. */
export function actionProblems(action: AnyAction, surfaces?: ReadonlyMap<string, Surface>): string[] {
  const at = `action "${action.id}"`;
  const out: string[] = [];
  if (!ACTION_ID.test(action.id)) out.push(`${at}: id must be <area>.<verb>, lowercase, e.g. "skills.add"`);
  if (surfaces && !surfaces.has(action.surface))
    out.push(`${at}: surface "${action.surface}" has no file at surfaces/${action.surface}.ts`);
  if (!action.labels.length) out.push(`${at}: declares no labels`);
  for (const l of action.labels)
    if (typeof l !== "string" && typeof l.control !== "string" && !(l.control.param in action.params))
      out.push(`${at}: label "${l.label}" takes its control text from parameter "${l.control.param}", which the schema does not have`);
  if (typeof action.prepare !== "function") out.push(`${at}: has no prepare`);
  if (!action.mutates) out.push(`${at}: must say which app state it mutates`);
  for (const p of paramProblems(action.params, action.example, "example"))
    out.push(`${at}: ${p.path} ${p.message}`);
  for (const [k, spec] of Object.entries(action.params)) {
    const v = action.example[k];
    if (spec.type === "string" && spec.creates && typeof v === "string" && !v.startsWith(DEMO_PREFIX))
      out.push(`${at}: example.${k} "${v}" names an item the action creates, so it must start with "${DEMO_PREFIX}"`);
  }

  const check = (params: Record<string, unknown>, which: string) => {
    let steps: Step[];
    try {
      steps = action.steps(params);
    } catch (err) {
      out.push(`${at}: steps(${which}) throws: ${err instanceof Error ? err.message : err}`);
      return;
    }
    const { labels, unlabeled } = stepLabels(steps);
    const declared = action.labels.map(labelName);
    for (const i of unlabeled) out.push(`${at}: step ${i + 1} logs a beat with no label`);
    for (const l of labels)
      if (!declared.includes(l)) out.push(`${at}: steps log "${l}", which is not a declared label`);
    if (labels.join("\n") !== declared.join("\n"))
      out.push(
        `${at}: with ${which} params the steps log [${labels.map((l) => `"${l}"`).join(", ")}] ` +
          `but it declares [${declared.map((l) => `"${l}"`).join(", ")}]`,
      );
  };
  check(action.example, "example");
  check(minimalParams(action.params), "minimal");
  return [...new Set(out)];
}

/** One line per parameter and label, as `pnpm brief --actions` prints it. */
export function catalogLines(action: AnyAction): string[] {
  const params = Object.entries(action.params);
  return [
    `${action.id}  (surface ${action.surface}, mutates ${action.mutates})`,
    ...(params.length
      ? params.map(([k, s]) => `  with.${k}: ${describeParam(s)}${s.description ? `. ${s.description}` : ""}`)
      : ["  with: {}"]),
    `  labels: ${action.labels
      .map((l) =>
        typeof l === "string"
          ? `"${l}"`
          : `"${l.label}" [chip: ${typeof l.control === "string" ? `"${l.control}"` : `with.${l.control.param}`}]`,
      )
      .join(" → ")}`,
    ...(action.viewport ? [`  viewport: ${action.viewport.width}x${action.viewport.height} (its own)`] : []),
    `  example: ${JSON.stringify(action.example)}`,
  ];
}

/** A composed flow's label, and the action that declares it. */
export type DeclaredLabel = NonNullable<Flow["declaredLabels"]>[number];


/**
 * A flow from a brief's footage: the surface's start, ready check, viewport,
 * backdrop and capture scale; every action's prepare in order, strict; the
 * house establish, then each action's steps with the house gap between them.
 *
 * Deterministic: the same footage, registry and house give the same flow. The
 * environment is read for one thing, the surface's start URL.
 */
export function composeFlow(
  name: string,
  footage: Footage,
  registry: Registry,
  house: House,
  env: Record<string, string | undefined> = process.env,
): { flow: Flow } | { problems: Problem[] } {
  const problems = footageProblems(footage, registry);
  if (problems.length) return { problems };
  const surface = registry.surfaces.get(footage.surface)!;
  const key = surfaceEnvKey(surface.id);
  const startUrl = env[key];
  if (!startUrl)
    return {
      problems: [
        {
          path: "footage.surface",
          message: `${key} is not set. Surface "${surface.id}" reads its start URL from it; see .env.example.`,
        },
      ],
    };

  const parts = footage.actions.map((step) => ({ action: registry.actions.get(step.use)!, params: step.with }));
  const size = (v: { width: number; height: number }) => `${v.width}x${v.height}`;
  const sizes = parts.map((p) => ({ id: p.action.id, viewport: p.action.viewport ?? surface.viewport }));
  if (new Set(sizes.map((x) => size(x.viewport))).size > 1)
    return {
      problems: [
        {
          path: "footage.actions",
          message:
            `one composed flow films at one size, but these actions differ: ` +
            sizes.map((x) => `${x.id} ${size(x.viewport)}`).join(", ") +
            `. Split them into separate briefs`,
        },
      ],
    };
  const steps: Step[] = [{ pause: house.shoot.establishMs }];
  parts.forEach(({ action, params }, i) => {
    if (i > 0) steps.push({ pause: house.shoot.gapMs });
    steps.push(...action.steps(params));
  });
  const targets: TargetOverrides = Object.assign({}, surface.targets, ...parts.map((p) => p.action.targets ?? {}));
  const mutates = [...new Set(parts.map((p) => p.action.mutates))].sort().join("+");

  const flow: Flow = {
    name,
    viewport: sizes[0].viewport,
    startUrl,
    ready: surface.ready,
    prepare: async (page) => {
      for (const [i, { action, params }] of parts.entries()) {
        try {
          await action.prepare({ page, startUrl }, params);
        } catch (err) {
          throw new Error(
            `action ${i + 1} (${action.id}) prepare failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    },
    strictPrepare: true,
    declaredLabels: declaredLabels(footage, registry).map(({ label, action }) => ({ label, action })),
    targets,
    mutates,
    ...(surface.backdrop ? { backdrop: surface.backdrop } : {}),
    ...(surface.captureScale ? { captureScale: surface.captureScale } : {}),
    run: (ctx) => runSteps(ctx, steps),
  };
  return { flow };
}

/**
 * Why a click log does not match the labels its flow declared, or null.
 * Names the first difference and the action that declares the label.
 */
export function labelMismatch(
  declared: readonly DeclaredLabel[],
  clicks: readonly Pick<ClickEvent, "label">[],
): string | null {
  const logged = clicks.map((c) => c.label).filter((l): l is string => l !== undefined);
  const n = Math.max(declared.length, logged.length);
  for (let i = 0; i < n; i++) {
    const want = declared[i];
    const got = logged[i];
    if (want?.label === got) continue;
    if (!want) return `label ${i + 1} "${got}" was logged, but no action declares a label there`;
    if (got === undefined)
      return `label ${i + 1} "${want.label}" (declared by ${want.action}) was never logged; the take stopped early or skipped it`;
    return `label ${i + 1} should be "${want.label}" (declared by ${want.action}), but the take logged "${got}"`;
  }
  return null;
}
