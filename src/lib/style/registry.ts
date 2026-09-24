/**
 * The registry: every style's resolved preset, and how a reel names one.
 */
import type { ReelLook } from "../look";
import { BASE } from "./base";
import { classic } from "./presets/classic";
import { ledger } from "./presets/ledger";
import { proof } from "./presets/proof";
import { stage } from "./presets/stage";
import {
  STYLES,
  type ReelStyle,
  type StyleOverride,
  type StylePreset,
} from "./types";

/**
 * What a reel gets when it says nothing.
 *
 * "proof" — the Cursor full-bleed grammar — because that is the house style
 * now, and a new reel written without thinking about it should land there
 * rather than on the older framed window. It is also what BASE is.
 *
 * ⚠️ THIS USED TO BE "classic", AND THE REASON IT DID IS STILL TRUE: a silent
 * reel is RESTYLED by changing this. reels/agent-skill.ts and
 * reels/agent-slash-command.ts name neither a `look` nor a `style`, so both
 * moved from the framed window to full-bleed the moment this changed. That was
 * a deliberate call — but it is exactly the kind of change that is invisible
 * until someone re-renders an old reel and finds a different film. Pin
 * `style` on any reel that must not move.
 */
export const DEFAULT_STYLE: ReelStyle = "proof";

const isGroup = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !("kind" in v);

/**
 * BASE with a style's departures laid over it. See StyleOverride for what
 * merges and what replaces. Returns fresh objects throughout, so no preset
 * shares a mutable node with BASE or with another preset.
 */
export function mergePreset(
  base: StylePreset,
  override: StyleOverride,
): StylePreset {
  const merge = (b: unknown, o: unknown): unknown => {
    if (o === undefined) return clone(b);
    if (!isGroup(b) || !isGroup(o)) return clone(o);
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(o)]))
      out[k] = merge(b[k], o[k]);
    return out;
  };
  return merge(base, override) as StylePreset;
}

const clone = (v: unknown): unknown =>
  v === null || typeof v !== "object"
    ? v
    : Array.isArray(v)
      ? v.map(clone)
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));

const OVERRIDES: Record<ReelStyle, StyleOverride> = {
  classic,
  proof,
  ledger,
  stage,
};

export const STYLE_PRESETS: Record<ReelStyle, StylePreset> = Object.fromEntries(
  STYLES.map((name) => [name, mergePreset(BASE, OVERRIDES[name])]),
) as Record<ReelStyle, StylePreset>;

/** Is this a style we know? Narrows an unchecked string from a reel file. */
export function isStyle(value: unknown): value is ReelStyle {
  return (
    typeof value === "string" && (STYLES as readonly string[]).includes(value)
  );
}

/**
 * Pick the style for a reel or card.
 *
 * A SHIM, NOT A BIJECTION. `look: "fullbleed"` maps to `proof` because proof
 * was the only full-bleed grammar when `look` was written — `ledger` and
 * `stage` are equally entitled to that look, and a reel reaches them only by
 * naming a `style`. It is exact for every reel on disk.
 *
 * Precedence: an explicit `style` always wins; otherwise the legacy `look` is
 * interpreted; otherwise the default.
 */
export function resolveStyle(input: {
  style?: ReelStyle;
  look?: ReelLook;
}): ReelStyle {
  if (input.style) return input.style;
  // BOTH looks map EXPLICITLY. While the default was "classic", `framed` could
  // fall through to it; now falling through would resolve a reel that
  // explicitly asked for the framed window to a full-bleed grammar. A look that
  // is named is an instruction, not an absence.
  if (input.look === "fullbleed") return "proof";
  if (input.look === "framed") return "classic";
  return DEFAULT_STYLE;
}

/**
 * The preset itself, resolved the same way.
 *
 * Named for the style, not just "preset": src/lib/still.ts has its own
 * `resolvePreset` (a still's canvas size), and two functions of one name that
 * resolve different things is how the wrong one gets imported.
 */
export function resolveStylePreset(input: {
  style?: ReelStyle;
  look?: ReelLook;
}): StylePreset {
  return STYLE_PRESETS[resolveStyle(input)];
}

/**
 * Why a style/look pair cannot be honoured, or null when it can.
 *
 * Only ONE combination is rejected. A style and a look together is the
 * documented override — a proof reel with one framed card is legitimate — so
 * the check is deliberately narrow. `classic` + `fullbleed` is the exception
 * because classic's whole grammar is the window and its zoom camera, and there
 * is no coherent film on the other side of that request.
 */
export function styleProblem(input: {
  style?: unknown;
  look?: ReelLook;
}): string | null {
  const { style, look } = input;
  if (style === undefined) return null;
  if (!isStyle(style))
    return `\`style\` must be one of ${STYLES.join(", ")} (got ${JSON.stringify(style)})`;
  if (style === "classic" && look === "fullbleed")
    return '`style: "classic"` cannot be combined with `look: "fullbleed"` — classic IS the framed grammar';
  return null;
}

// ---------------------------------------------------------------------------
// Adding a style
// ---------------------------------------------------------------------------
//
// 1. Analyse the film into docs/reel/<name>/ first. Every number in a preset
//    should be traceable to a measurement there; a field you cannot measure is
//    a field to leave at BASE, not one to guess.
// 2. Add the name to STYLES (./types.ts) and the film to REFERENCE_FILMS.
// 3. Write presets/<name>.ts as a StyleOverride naming ONLY what differs from
//    BASE — including `source` and `targets`, which BASE leaves null so a new
//    style cannot inherit Film A's by accident. Register it in OVERRIDES above.
// 4. Do not touch any component. If you find yourself needing to, the preset
//    is missing a field — add it to ./types.ts, give BASE a value that keeps
//    every existing film where it is, and read it from the component. That is
//    the whole contract.
// 5. style.test.ts asserts every preset is complete, that no style name is
//    referenced outside src/lib/style*, and that EVERY FIELD HAS A READER. A
//    field you add and nothing reads fails that last test.
