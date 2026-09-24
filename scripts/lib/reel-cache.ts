/**
 * What a cached reel segment depends on, derived rather than listed.
 *
 * Every reel segment is cached under .diag/reel/<reel>/ keyed by a hash of its
 * own spec PLUS everything that draws it. The second half used to be a list of
 * source files kept by hand, and a hand-kept list only ever grows by accident:
 * it had missed src/lib/crop.ts, src/Root.tsx (which sizes every composition),
 * every asset (the logo mark, the Inter font file, the backdrop images) and
 * the environment (DEMO_BACKDROP, DEMO_GL). Edit any of those and the cache
 * served the old render, and the reel silently did not reflect the change —
 * the exact failure the hash exists to prevent.
 *
 * So the set is derived, bundle-free:
 *
 *  1. CODE: walk relative imports from the composition's entry file (src/
 *     Intro.tsx for a card, src/DemoClip.tsx for a clip). Bare specifiers
 *     (node_modules) are not walked; the dependency versions in package.json
 *     stand in for them.
 *  2. ASSETS: every string literal in that code that names a file under
 *     public/ ("logo-mark.png", "fonts/inter-….woff2"), and every template
 *     literal whose static head is a public/ DIRECTORY (`backdrops/${name}`)
 *     hashes that whole directory — a name picked at runtime could be any of
 *     them. Footage (public/<demo>.mp4 + its click log) is NOT here; it is
 *     hashed per demo by footageDigest, so a card cache survives a re-shoot.
 *  3. ENVIRONMENT: every `process.env.X` the code reads, plus DEMO_GL (a
 *     renderer flag that changes pixels — see scripts/lib/remotion.ts).
 *
 * Over-inclusion is the safe failure: a type-only import or a commented-out
 * literal costs one needless re-render, never a stale film.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Short content hash of any JSON-serialisable value. */
export const digest = (value: unknown): string =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 10);

const SPECIFIER = [
  // import x from "y" · import { a } from "y" · export * from "y" · import type …
  /(?:^|[\s;])(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
  // import "./side-effect.css"
  /(?:^|[\s;])import\s*["']([^"']+)["']/g,
  // import("./lazy")
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];

/** A relative specifier → the file it names, or null when none exists. */
function resolveRelative(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => path.join(base, "index" + e)),
  ];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Relative import specifiers in one file's source. Exported for the test. */
export function relativeSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const re of SPECIFIER)
    for (const m of source.matchAll(re)) if (m[1].startsWith(".")) out.add(m[1]);
  return [...out];
}

/** Every file reachable from `entries` through relative imports, sorted. */
export function importGraph(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = entries.map((e) => path.resolve(e));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    if (!/\.(m?[jt]sx?)$/.test(file)) continue;
    for (const spec of relativeSpecifiers(fs.readFileSync(file, "utf8"))) {
      const hit = resolveRelative(file, spec);
      if (hit) stack.push(hit);
    }
  }
  return [...seen].sort();
}

const listFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)],
    )
    .sort();

/**
 * public/ files the code in `files` can load, found by its string literals.
 * `publicDir` is a parameter so the test can point it at a fixture.
 */
export function referencedAssets(files: string[], publicDir: string): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) {
      const lit = m[1] ?? m[2];
      if (!/\.[a-z0-9]+$/i.test(lit) || lit.includes("..")) continue;
      const abs = path.join(publicDir, lit);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) out.add(abs);
    }
    for (const m of src.matchAll(/`([^`$]*)\$\{/g)) {
      const head = m[1];
      if (!head.endsWith("/") || head.includes("..")) continue;
      const abs = path.join(publicDir, head);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory())
        for (const f of listFiles(abs)) out.add(f);
    }
  }
  return [...out].sort();
}

/** Every environment variable the code in `files` reads by name. */
export function referencedEnv(files: string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]);
    for (const m of src.matchAll(/process\.env\[\s*["']([^"']+)["']\s*\]/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/** Always hashed: flags the render command itself reads, not the bundle. */
const RENDER_ENV = ["DEMO_GL"];

export type SourceSet = {
  code: string[];
  assets: string[];
  env: string[];
};

/**
 * The full dependency set for one composition entry. `leaves` are files hashed
 * (with the env they read) but neither walked nor scanned for assets:
 * src/Root.tsx (its calculateMetadata sizes every composition — walking it
 * would pull in all of them, collapsing the card/clip split, and its still
 * composition names `shots/${name}.png`, which would tie every reel's cache to
 * every still) and remotion.config.ts (the colour space is set there, not in
 * any source file: a segment cached under BT.601 would otherwise concat beside
 * BT.709 ones).
 */
export function sourceSet(
  entries: string[],
  leaves: string[] = [],
  publicDir = path.join(ROOT, "public"),
): SourceSet {
  const graph = importGraph(entries);
  const code = [...new Set([...graph, ...leaves.filter((f) => fs.existsSync(f))])].sort();
  return {
    code,
    assets: referencedAssets(graph, publicDir),
    env: [...new Set([...referencedEnv(code), ...RENDER_ENV])].sort(),
  };
}

/** Hash of a SourceSet's contents (bytes, not names) and the env it reads. */
export function sourceSetDigest(set: SourceSet, env: NodeJS.ProcessEnv = process.env): string {
  const h = createHash("sha1");
  for (const f of [...set.code, ...set.assets]) {
    h.update(path.relative(ROOT, f));
    h.update(fs.readFileSync(f));
  }
  for (const k of set.env) h.update(`${k}=${env[k] ?? ""}\n`);
  return h.digest("hex").slice(0, 10);
}

/** What draws each kind of reel segment. */
export const SEGMENT_ENTRIES = {
  card: ["src/Intro.tsx"],
  clip: ["src/DemoClip.tsx"],
  hud: ["src/HudOverlay.tsx"],
  chips: ["src/ChipOverlay.tsx"],
} as const;
export type SegmentKind = keyof typeof SEGMENT_ENTRIES;

const LEAVES = ["src/Root.tsx", "src/index.ts", "remotion.config.ts"];

/** The installed renderer, by the versions package.json pins. */
function dependencyVersions(): unknown {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.dependencies ?? {};
}

const memo = new Map<SegmentKind, string>();

/**
 * Digest of everything that draws a `kind` segment. Computed once per process:
 * a reel asks for it once per segment and the answer cannot change mid-run.
 */
export function segmentSourceDigest(kind: SegmentKind): string {
  let d = memo.get(kind);
  if (d == null) {
    const set = sourceSet(
      SEGMENT_ENTRIES[kind].map((f) => path.join(ROOT, f)),
      LEAVES.map((f) => path.join(ROOT, f)),
    );
    d = digest([sourceSetDigest(set), dependencyVersions()]);
    memo.set(kind, d);
  }
  return d;
}

/**
 * Content hash of the FOOTAGE a clip is rendered from — the converted recording
 * and its click log. Folded into the clip cache key so a re-shoot invalidates
 * cached clips: the source digest only sees code and assets, so new footage
 * under an unchanged clip spec would silently serve the old segment. Read as
 * bytes, not utf8 — the mp4 is binary.
 */
export function footageDigest(demo: string): string {
  return createHash("sha1")
    .update(fs.readFileSync(path.join(ROOT, "public", `${demo}.mp4`)))
    .update(fs.readFileSync(path.join(ROOT, "public", `${demo}.clicks.json`)))
    .digest("hex")
    .slice(0, 10);
}
