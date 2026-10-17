/**
 * A reel brief: the one creative document an agent writes for a launch reel.
 *
 * JSON at reels/<name>.brief.json, closed (unknown fields are errors), and
 * checked before anything records or renders. It names footage (product
 * actions to shoot, or an already-recorded demo), the card copy, and the labels
 * each card's clip must show. Everything else is the house's
 * (src/lib/house.ts).
 *
 * briefProblems reports EVERY problem in one pass, each with a field path and
 * a sentence an agent can act on, so a bad brief costs one retry, not N.
 *
 * Pure: the caller hands in the action catalog, the click log and a way to
 * read the source post. Nothing here touches the disk.
 */
import { BRANDS } from "./brand";
import { CHIP_TOKEN } from "./intro";
import { HOUSE_DEFAULT, isOneTake, resolveHouse, type CopyKind, type House } from "./house";
import { paramProblems, type ParamSchema, type Problem } from "./params";
import { beatDemoS } from "./reel";
import { STYLE_PRESETS } from "./style";
import type { ClickLog } from "./click-log";

export type { Problem };

export const BRIEF_VERSION = 1;
export const MIN_BEATS = 2;

/** One product action to shoot: an action id and its parameters. */
export type FootageAction = { use: string; with: Record<string, unknown> };

/** New footage, composed from actions on one surface. */
export type Footage = { surface: string; actions: FootageAction[] };

/** Which labels a beat's clip shows: from one, through an optional later one. */
export type BeatShow = { from: string; to?: string };
export type BriefBeat = { card: string; show: BeatShow };
/** `text` is the control's on-screen text, and only a `demo` brief gives it. */
export type BriefPayoff = { card: string; chip: string; text?: string };

/** Longest pill text a demo brief may give. */
export const PAYOFF_TEXT_MAX = 40;

type BriefCommon = {
  version: typeof BRIEF_VERSION;
  name: string;
  /** `<brand>@<version>`; absent = HOUSE_DEFAULT. */
  house?: string;
  /** The saved post this brief was written from, normally reels/<name>.post.md. */
  source: string;
  title: string;
  /** A `beats` house: a card and a clip per beat. A one-take house takes none. */
  beats?: BriefBeat[];
  payoff?: BriefPayoff;
  /** A `beats` house's closing card. */
  signoff?: string;
  /** A one-take house's closing lines, one card each, before the logo. */
  outro?: string[];
};

export type Brief = BriefCommon &
  ({ footage: Footage; demo?: never } | { demo: string; footage?: never });

/** The on-screen text of a label's control: a literal, or one of the action's parameters. */
export type ControlText = string | { param: string };

/**
 * A declared label. A label a payoff chip may name carries its control's
 * text: labels are story beats ("pick domain"), and the pill must read what
 * the control says ("Development").
 */
export type LabelSpec = string | { label: string; control: ControlText };

export const labelName = (l: LabelSpec): string => (typeof l === "string" ? l : l.label);

/** The control text a label shows with these parameters, or undefined when it declares none. */
export function controlText(l: LabelSpec, params: Record<string, unknown>): string | undefined {
  if (typeof l === "string") return undefined;
  if (typeof l.control === "string") return l.control;
  const v = params[l.control.param];
  return v === undefined ? undefined : String(v);
}

/** What the validator needs to know about an action. Registry actions satisfy it. */
export type CatalogAction = {
  id: string;
  surface: string;
  params: ParamSchema;
  labels: readonly LabelSpec[];
};

/** The action library, as data. scripts/lib/action.ts's Registry satisfies it. */
export type Catalog = {
  surfaces: ReadonlyMap<string, unknown>;
  actions: ReadonlyMap<string, CatalogAction>;
};

export type BriefContext = {
  catalog: Catalog;
  /** The demo's click log, for a `demo` brief. */
  log?: ClickLog;
  /** The source post's text, or null when the file does not exist. */
  readSource: (path: string) => string | null;
  /** The name the brief's file says it has. */
  fileName?: string;
};

/** A label a brief can name, with where it comes from. */
export type BriefLabel = {
  label: string;
  /** The declaring action, for footage. */
  action?: string;
  /** Its control's on-screen text, when the action declares one. */
  control?: string;
  /** Demo seconds, for a recorded demo. */
  pressS?: number;
  typeEndS?: number;
};

const FIELDS = {
  brief: ["version", "name", "house", "source", "footage", "demo", "title", "beats", "payoff", "signoff", "outro"],
  footage: ["surface", "actions"],
  action: ["use", "with"],
  beat: ["card", "show"],
  show: ["from", "to"],
  payoff: ["card", "chip", "text"],
} as const;

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const quote = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(", ");

/** Reject any key not in `allowed`, naming its path and the allowed set. */
function closed(value: Record<string, unknown>, allowed: readonly string[], path: string, out: Problem[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      out.push({
        path: path ? `${path}.${key}` : key,
        message: `is not a brief field. Allowed here: ${allowed.join(", ")}`,
      });
}

function str(value: unknown, path: string, out: Problem[]): value is string {
  if (typeof value === "string" && value.trim() !== "") return true;
  out.push({ path, message: value === undefined ? "is required" : "must be a non-empty string" });
  return false;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** The words of a card as a viewer reads them: markup stripped, punctuation not counted. */
export function copyWords(text: string): string[] {
  const plain = text
    .replace(/==([^=|]+)(\|#[0-9a-f]{3,8})?==/gi, "$1")
    .replace(/\^\^([^^]+)\^\^/g, "$1")
    .replace(/[*_]/g, " ");
  return plain.split(/\s+/).filter((w) => w.includes(CHIP_TOKEN) || /[\p{L}\p{N}]/u.test(w));
}

/** What is wrong with one piece of copy under `house`: length, emphasis, banned words, the chip token. */
export function copyProblems(text: string, kind: CopyKind, path: string, house: House): Problem[] {
  const out: Problem[] = [];
  const n = copyWords(text).length;
  const range = house.copy[kind];
  if (n < range.min || n > range.max)
    out.push({
      path,
      message: `has ${n} word${n === 1 ? "" : "s"}; a ${kind} card under ${house.id} takes ${range.min}-${range.max}`,
    });
  if (/==[^=]+==/.test(text) && !STYLE_PRESETS[house.style].card.emphasis)
    out.push({
      path,
      message: `uses ==emphasis==, which the "${house.style}" style of ${house.id} renders as plain ink. Remove the markers`,
    });
  const accentWords = [...text.matchAll(/\^\^([^^]+)\^\^/g)].flatMap((m) => m[1].trim().split(/\s+/));
  if (accentWords.length) {
    const accent = house.pack ? BRANDS[house.pack]?.faces.accent : undefined;
    if (!accent)
      out.push({ path, message: `marks ^^${accentWords.join(" ")}^^, but ${house.id} has no accent face. Remove the markers` });
    else if (accentWords.length > (accent.maxWords ?? Infinity))
      out.push({
        path,
        message: `sets ${accentWords.length} words in the accent face; ${house.id}'s ${accent.family} takes at most ${accent.maxWords} per card`,
      });
  }
  const lower = text.toLowerCase();
  for (const word of house.brand.bannedWords) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}-])`, "u");
    if (re.test(lower)) out.push({ path, message: `uses the banned word "${word}". Say what the feature does instead` });
  }
  const chips = text.split(CHIP_TOKEN).length - 1;
  if (kind === "payoff" && chips !== 1)
    out.push({
      path,
      message: `must contain the chip token ${CHIP_TOKEN} exactly once (found ${chips}); it is where the payoff's control lands`,
    });
  if (kind !== "payoff" && chips > 0)
    out.push({ path, message: `contains ${CHIP_TOKEN}, which only the payoff card may carry` });
  return out;
}

// ---------------------------------------------------------------------------
// Footage
// ---------------------------------------------------------------------------

/** Footage that names things that exist, with valid parameters. */
export function footageProblems(footage: Footage, catalog: Catalog, path = "footage"): Problem[] {
  const out: Problem[] = [];
  if (!catalog.surfaces.has(footage.surface)) {
    out.push({
      path: `${path}.surface`,
      message: `unknown surface "${footage.surface}". Known: ${[...catalog.surfaces.keys()].join(", ") || "none"}`,
    });
    return out;
  }
  const here = [...catalog.actions.values()].filter((a) => a.surface === footage.surface).map((a) => a.id);
  footage.actions.forEach((step, i) => {
    const at = `${path}.actions[${i}]`;
    const action = catalog.actions.get(step.use);
    if (!action) {
      out.push({
        path: `${at}.use`,
        message: `unknown action "${step.use}". Actions on ${footage.surface}: ${here.join(", ") || "none"}`,
      });
      return;
    }
    if (action.surface !== footage.surface) {
      out.push({
        path: `${at}.use`,
        message: `"${step.use}" runs on surface "${action.surface}", not "${footage.surface}"`,
      });
      return;
    }
    out.push(...paramProblems(action.params, step.with, `${at}.with`));
  });
  return out;
}

/** The labels footage will log, in order, each with its action and any control text. */
export function declaredLabels(footage: Footage, catalog: Catalog): { label: string; action: string; control?: string }[] {
  return footage.actions.flatMap((step) => {
    const action = catalog.actions.get(step.use);
    if (!action) return [];
    return action.labels.map((l) => {
      const control = controlText(l, step.with ?? {});
      return { label: labelName(l), action: action.id, ...(control !== undefined ? { control } : {}) };
    });
  });
}

/**
 * The payoff pill's text: the chip label's declared control (footage), or
 * the brief's own `payoff.text` (demo). Null when there is no payoff or none
 * resolves; briefProblems reports why.
 */
export function chipText(brief: Brief, catalog: Catalog): string | null {
  if (!brief.payoff) return null;
  if (!brief.footage) return brief.payoff.text ?? null;
  const labels = declaredLabels(brief.footage, catalog);
  const hit = resolveLabel(brief.payoff.chip, labels);
  return "index" in hit ? (labels[hit.index].control ?? null) : null;
}

/** Every label a brief can name, in order: declared by its footage, or read off its demo's log. */
export function briefLabels(
  source: { footage: Footage } | { log: ClickLog },
  catalog: Catalog,
  speed: number,
): BriefLabel[] {
  if ("footage" in source) return declaredLabels(source.footage, catalog);
  const log = source.log;
  return log.clicks
    .filter((c) => c.label)
    .map((c) => ({
      label: c.label!,
      pressS: beatDemoS(c, log, speed),
      ...(c.typeEndMs !== undefined ? { typeEndS: (c.typeEndMs + (log.offsetMs ?? 0)) / 1000 / speed } : {}),
    }));
}

/** One line per label, as `pnpm brief --labels` prints them. */
export function labelLines(labels: readonly BriefLabel[]): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l.label.toLowerCase(), (counts.get(l.label.toLowerCase()) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const key = l.label.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const name = (counts.get(key) ?? 0) > 1 ? `${l.label}#${n}` : l.label;
    const when =
      l.pressS !== undefined
        ? `  @${l.pressS.toFixed(2)}s${l.typeEndS !== undefined ? `, types to ${l.typeEndS.toFixed(2)}s` : ""}`
        : "";
    return `  "${name}"${when}${l.action ? `  (${l.action})` : ""}`;
  });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Levenshtein distance, for near misses. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * The index in `labels` a reference names: exact, ignoring case, with `#n`
 * picking the n-th of a repeated label. Or a sentence.
 */
export function resolveLabel(ref: string, labels: readonly BriefLabel[]): { index: number } | { problem: string } {
  const m = /^(.*?)#(\d+)$/.exec(ref);
  const want = (m ? m[1] : ref).trim().toLowerCase();
  const nth = m ? Number(m[2]) : null;
  const hits = labels.flatMap((l, i) => (l.label.toLowerCase() === want ? [i] : []));
  const where = (i: number) =>
    labels[i].pressS !== undefined ? ` at ${labels[i].pressS!.toFixed(2)}s` : labels[i].action ? ` (${labels[i].action})` : "";
  if (hits.length === 0) {
    const distinct = [...new Set(labels.map((l) => l.label))];
    const near = distinct.filter((l) => {
      const x = l.toLowerCase();
      return x.includes(want) || want.includes(x) || distance(x, want) <= Math.max(2, Math.floor(want.length / 4));
    });
    return {
      problem: near.length
        ? `no label "${ref}". Near misses: ${quote(near)}`
        : `no label "${ref}". Available: ${quote(distinct) || "none"}`,
    };
  }
  if (nth !== null) {
    if (nth < 1 || nth > hits.length)
      return { problem: `"${ref}" asks for occurrence ${nth}, but "${labels[hits[0]].label}" occurs ${hits.length} time(s)` };
    return { index: hits[nth - 1] };
  }
  if (hits.length > 1)
    return {
      problem:
        `"${ref}" is ambiguous; it occurs ${hits.length} times: ` +
        hits.map((i, k) => `"${labels[i].label}#${k + 1}"${where(i)}`).join(", ") +
        ". Name one",
    };
  return { index: hits[0] };
}

// ---------------------------------------------------------------------------
// The whole brief
// ---------------------------------------------------------------------------

/** Every problem with `value` as a brief, in one pass. Empty means it is a valid Brief. */
export function briefProblems(value: unknown, ctx: BriefContext): Problem[] {
  const out: Problem[] = [];
  if (!isRecord(value)) return [{ path: "", message: "a brief must be a JSON object" }];
  closed(value, FIELDS.brief, "", out);

  if (value.version !== BRIEF_VERSION)
    out.push({ path: "version", message: `must be ${BRIEF_VERSION}, the brief schema version` });
  if (str(value.name, "name", out)) {
    if (!NAME.test(value.name)) out.push({ path: "name", message: "must be lowercase and hyphenated, like the file name" });
    else if (ctx.fileName !== undefined && value.name !== ctx.fileName)
      out.push({ path: "name", message: `is "${value.name}" but the file is reels/${ctx.fileName}.brief.json` });
  }

  let house: House = resolveHouse(HOUSE_DEFAULT) as House;
  if (value.house !== undefined) {
    const h = typeof value.house === "string" ? resolveHouse(value.house) : { problem: "must be a string like \"agenta@1\"" };
    if ("problem" in h) out.push({ path: "house", message: h.problem });
    else house = h;
  }

  if (str(value.source, "source", out)) {
    const text = ctx.readSource(value.source);
    if (text === null)
      out.push({ path: "source", message: `names ${value.source}, which does not exist. Save the post there verbatim` });
    else if (text.trim() === "") out.push({ path: "source", message: `names ${value.source}, which is empty` });
  }

  // Footage or demo: exactly one. The labels the beats may name come from it.
  let labels: BriefLabel[] | null = null;
  const hasFootage = value.footage !== undefined;
  const hasDemo = value.demo !== undefined;
  if (hasFootage === hasDemo) {
    out.push({
      path: hasFootage ? "footage" : "",
      message: hasFootage
        ? "and `demo` are both set; exactly one is required (footage to shoot, or a recorded demo to cut)"
        : "needs exactly one of `footage` (actions to shoot) or `demo` (a recorded demo to cut)",
    });
  } else if (hasFootage) {
    labels = footageLabels(value.footage, ctx.catalog, out);
  } else if (str(value.demo, "demo", out)) {
    if (!ctx.log)
      out.push({
        path: "demo",
        message: `has no click log at public/${value.demo}.clicks.json. Record and convert "${value.demo}" first`,
      });
    else labels = briefLabels({ log: ctx.log }, ctx.catalog, house.shoot.speed);
  }

  if (str(value.title, "title", out)) out.push(...copyProblems(value.title, "title", "title", house));

  if (isOneTake(house)) {
    oneTakeProblems(value, house, labels, out);
    return out;
  }
  if (value.outro !== undefined)
    out.push({ path: "outro", message: `is for a one-take house; ${house.id} cuts beats and closes on \`signoff\`` });
  if (str(value.signoff, "signoff", out)) out.push(...copyProblems(value.signoff, "signoff", "signoff", house));

  // Beats, in label order.
  let lastIndex = -1;
  let lastBeat = -1;
  if (!Array.isArray(value.beats)) {
    out.push({ path: "beats", message: `must be a list of ${MIN_BEATS}-${house.maxBeats} beats` });
  } else {
    const n = value.beats.length;
    if (n < MIN_BEATS || n > house.maxBeats)
      out.push({ path: "beats", message: `has ${n} beat(s); ${house.id} takes ${MIN_BEATS}-${house.maxBeats}` });
    value.beats.forEach((beat: unknown, i: number) => {
      const at = `beats[${i}]`;
      if (!isRecord(beat)) {
        out.push({ path: at, message: "must be an object with `card` and `show`" });
        return;
      }
      closed(beat, FIELDS.beat, at, out);
      if (str(beat.card, `${at}.card`, out)) out.push(...copyProblems(beat.card, "beat", `${at}.card`, house));
      if (!isRecord(beat.show)) {
        out.push({ path: `${at}.show`, message: "must be an object: { from, to? }, labels the clip shows" });
        return;
      }
      closed(beat.show, FIELDS.show, `${at}.show`, out);
      const from = labelAt(beat.show.from, `${at}.show.from`, labels, out);
      const to = beat.show.to === undefined ? undefined : labelAt(beat.show.to, `${at}.show.to`, labels, out);
      if (from !== null && from !== undefined) {
        if (from <= lastIndex)
          out.push({
            path: `${at}.show.from`,
            message: `"${beat.show.from}" comes at or before the last label of beats[${lastBeat}]; beats must follow the footage in order`,
          });
        if (to !== null && to !== undefined && to <= from)
          out.push({ path: `${at}.show.to`, message: `"${beat.show.to}" must come after "${beat.show.from}"` });
        lastIndex = Math.max(from, to ?? from);
        lastBeat = i;
      }
    });
  }

  if (value.payoff !== undefined) {
    if (!isRecord(value.payoff)) {
      out.push({ path: "payoff", message: "must be an object: { card, chip }" });
    } else {
      closed(value.payoff, FIELDS.payoff, "payoff", out);
      if (str(value.payoff.card, "payoff.card", out)) out.push(...copyProblems(value.payoff.card, "payoff", "payoff.card", house));
      const chip = labelAt(value.payoff.chip, "payoff.chip", labels, out);
      if (chip !== null && chip !== undefined && chip <= lastIndex)
        out.push({
          path: "payoff.chip",
          message: `"${value.payoff.chip}" is at or before the last beat's last label, so the payoff clip would replay earlier footage. Name an action after it`,
        });
      // The pill reads the control, never the story label.
      if (hasFootage && !hasDemo) {
        if (value.payoff.text !== undefined)
          out.push({
            path: "payoff.text",
            message: "is only for a demo brief; with footage the pill's text comes from the action's declared control",
          });
        if (chip !== null && chip !== undefined && labels && labels[chip].control === undefined) {
          const controls = [...new Set(labels.filter((l) => l.control !== undefined).map((l) => l.label))];
          out.push({
            path: "payoff.chip",
            message: `"${value.payoff.chip}" declares no control text, so the pill would read the label. Chips can name: ${quote(controls) || "none in this footage"}`,
          });
        }
      } else if (hasDemo && !hasFootage) {
        const t = value.payoff.text;
        if (t === undefined)
          out.push({ path: "payoff.text", message: "is required for a demo brief: the control's on-screen text, which the pill shows" });
        else if (typeof t !== "string" || t.trim() === "" || t.length > PAYOFF_TEXT_MAX)
          out.push({ path: "payoff.text", message: `must be the control's on-screen text, 1-${PAYOFF_TEXT_MAX} characters` });
      }
    }
  }
  return out;
}

/**
 * A one-take brief: title, footage or demo, and 1..`house.outro.max` closing
 * lines. No beats, payoff or sign-off: the reel is the whole take, so there is
 * nothing to choose about where it cuts.
 */
function oneTakeProblems(value: Record<string, unknown>, house: House, labels: BriefLabel[] | null, out: Problem[]) {
  for (const key of ["beats", "payoff", "signoff"] as const)
    if (value[key] !== undefined)
      out.push({
        path: key,
        message: `is not taken by ${house.id}: its shape is one-take, which shows the whole interaction and closes on \`outro\` lines. Remove \`${key}\``,
      });
  const max = house.outro?.max ?? 1;
  if (!Array.isArray(value.outro) || value.outro.length === 0)
    out.push({ path: "outro", message: `must list 1-${max} closing lines, each its own card before the logo` });
  else {
    if (value.outro.length > max)
      out.push({ path: "outro", message: `has ${value.outro.length} lines; ${house.id} takes 1-${max}` });
    value.outro.forEach((line: unknown, i: number) => {
      if (str(line, `outro[${i}]`, out)) out.push(...copyProblems(line, "signoff", `outro[${i}]`, house));
    });
  }
  if (labels && labels.length === 0)
    out.push({ path: value.footage !== undefined ? "footage" : "demo", message: "has no labelled actions, so there is no take to show" });
}

/** The labels footage declares, after checking its shape and the catalog. */
function footageLabels(value: unknown, catalog: Catalog, out: Problem[]): BriefLabel[] | null {
  if (!isRecord(value)) {
    out.push({ path: "footage", message: "must be an object: { surface, actions }" });
    return null;
  }
  closed(value, FIELDS.footage, "footage", out);
  const start = out.length;
  str(value.surface, "footage.surface", out);
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    out.push({ path: "footage.actions", message: "must list at least one action: [{ use, with }]" });
    return null;
  }
  value.actions.forEach((a: unknown, i: number) => {
    const at = `footage.actions[${i}]`;
    if (!isRecord(a)) {
      out.push({ path: at, message: "must be an object: { use, with }" });
      return;
    }
    closed(a, FIELDS.action, at, out);
    str(a.use, `${at}.use`, out);
    if (!isRecord(a.with)) out.push({ path: `${at}.with`, message: "must be an object of parameters ({} for none)" });
  });
  if (out.length > start) return null;
  const footage = value as Footage;
  const problems = footageProblems(footage, catalog);
  out.push(...problems);
  return problems.length ? null : briefLabels({ footage }, catalog, 1);
}

/** A label reference's index, null when it does not resolve, undefined when there is nothing to resolve against. */
function labelAt(ref: unknown, path: string, labels: BriefLabel[] | null, out: Problem[]): number | null | undefined {
  if (!str(ref, path, out)) return null;
  if (!labels) return undefined;
  const hit = resolveLabel(ref, labels);
  if ("problem" in hit) {
    out.push({ path, message: hit.problem });
    return null;
  }
  return hit.index;
}

/** The brief, once it has no problems. */
export function parseBrief(value: unknown, ctx: BriefContext): { brief: Brief } | { problems: Problem[] } {
  const problems = briefProblems(value, ctx);
  return problems.length ? { problems } : { brief: value as Brief };
}

/** The house a valid brief compiles under. */
export const briefHouse = (brief: Pick<Brief, "house">): House => resolveHouse(brief.house) as House;
