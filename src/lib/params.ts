/**
 * Closed parameter schemas: what an action accepts, checked before anything
 * runs. A brief's `with` block is validated against one, so a typo in a
 * parameter name or a 300-character skill name is caught at the brief, not on
 * camera.
 *
 * Pure and dependency-free: src/lib/brief.ts validates against these, and
 * scripts/lib/action.ts declares them.
 */

/** One validation finding: where it is, and a sentence an agent can act on. */
export type Problem = { path: string; message: string };

export type ParamSpec =
  | {
      type: "string";
      /** Every string has a ceiling: copy that runs off a field reads as a bug. */
      maxLength: number;
      minLength?: number;
      /**
       * This value names an item the action CREATES (a skill, a schedule).
       * Its `example` must carry the demo prefix, and prepares delete only
       * prefixed items. See DEMO_PREFIX in scripts/lib/action.ts.
       */
      creates?: true;
      optional?: true;
      description?: string;
    }
  | {
      type: "number";
      min?: number;
      max?: number;
      integer?: true;
      optional?: true;
      description?: string;
    }
  | { type: "boolean"; optional?: true; description?: string };

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

type ValueOf<S extends ParamSpec> = S extends { type: "string" }
  ? string
  : S extends { type: "number" }
    ? number
    : boolean;

/** The values a schema accepts, typed for the action's `steps`. */
export type ParamValues<S extends ParamSchema> = {
  [K in keyof S as S[K] extends { optional: true } ? never : K]: ValueOf<S[K]>;
} & {
  [K in keyof S as S[K] extends { optional: true } ? K : never]?: ValueOf<S[K]>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `string, 1-40 chars` — how a parameter prints in a catalog and in errors. */
export function describeParam(spec: ParamSpec): string {
  const opt = spec.optional ? ", optional" : "";
  if (spec.type === "string")
    return `string, ${spec.minLength ?? 1}-${spec.maxLength} chars${spec.creates ? ", names what it creates" : ""}${opt}`;
  if (spec.type === "number") {
    const range =
      spec.min !== undefined || spec.max !== undefined
        ? `, ${spec.min ?? "-inf"}..${spec.max ?? "inf"}`
        : "";
    return `${spec.integer ? "integer" : "number"}${range}${opt}`;
  }
  return `boolean${opt}`;
}

/** Every way `value` breaks `schema`, each at `path.<param>`. */
export function paramProblems(schema: ParamSchema, value: unknown, path: string): Problem[] {
  if (!isRecord(value))
    return [{ path, message: `must be an object of parameters (${Object.keys(schema).join(", ") || "none"})` }];
  const out: Problem[] = [];
  const allowed = Object.keys(schema);
  for (const key of Object.keys(value))
    if (!(key in schema))
      out.push({
        path: `${path}.${key}`,
        message: `is not a parameter of this action. Allowed: ${allowed.join(", ") || "none"}`,
      });
  for (const [key, spec] of Object.entries(schema)) {
    const at = `${path}.${key}`;
    const v = value[key];
    if (v === undefined) {
      if (!spec.optional) out.push({ path: at, message: `is required (${describeParam(spec)})` });
      continue;
    }
    if (spec.type === "string") {
      if (typeof v !== "string") {
        out.push({ path: at, message: `must be a string, got ${typeof v}` });
        continue;
      }
      const min = spec.minLength ?? 1;
      if (v.length < min) out.push({ path: at, message: `must be at least ${min} characters, got ${v.length}` });
      if (v.length > spec.maxLength)
        out.push({ path: at, message: `must be at most ${spec.maxLength} characters, got ${v.length}` });
    } else if (spec.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out.push({ path: at, message: `must be a number, got ${typeof v}` });
        continue;
      }
      if (spec.integer && !Number.isInteger(v)) out.push({ path: at, message: `must be an integer, got ${v}` });
      if (spec.min !== undefined && v < spec.min) out.push({ path: at, message: `must be >= ${spec.min}, got ${v}` });
      if (spec.max !== undefined && v > spec.max) out.push({ path: at, message: `must be <= ${spec.max}, got ${v}` });
    } else if (typeof v !== "boolean") {
      out.push({ path: at, message: `must be a boolean, got ${typeof v}` });
    }
  }
  return out;
}
