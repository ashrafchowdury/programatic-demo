/**
 * Reel brand packs: how a reel LOOKS for one brand — its card colours, its
 * faces, its logos — laid over a style that keeps deciding how the reel MOVES.
 *
 * A pack is data (brands/<id>/brand.json) and is applied where a preset is
 * resolved (resolveStylePreset), so no component learns that brands exist: it
 * reads the same palette, type and ground fields it always did.
 *
 * Pure, and safe inside the Remotion bundle: no fs. The font and logo FILES are
 * copied under public/brand/<id>/ before bundling by scripts/lib/brand-assets.ts,
 * because Remotion can only load what is under public/.
 */
import agenta from "../../brands/agenta/brand.json";
import type { Ground, GroundKey, StylePreset } from "./style/types";

/** A colour by its name in the pack's `colors` map. */
type ColorName = string;

export type BrandGround = {
  ground: ColorName;
  ink: ColorName;
  muted: ColorName;
  /** Which logo variant a logo card on this ground draws. */
  logo: LogoTone;
  chip: { fill: ColorName; label: ColorName; rim: ColorName };
  highlight: { fill: ColorName; ink: ColorName };
};

export type BrandFace = {
  family: string;
  /** File name in `fontDir`, or null for a face the renderer already vendors (Inter). */
  file: string | null;
  weight: number;
  /** Cap height as a fraction of font-size, for keeping a style's cap height in a new face. */
  cap: number;
  /** Most words a card may set in this face. Only the accent face has one. */
  maxWords?: number;
};

export const LOGO_TONES = ["light", "dark", "accent"] as const;
export type LogoTone = (typeof LOGO_TONES)[number];

export type BrandPack = {
  id: string;
  source: string;
  wordmark: string;
  colors: Record<ColorName, string>;
  grounds: Record<GroundKey, BrandGround>;
  /** The flat ground a windowed shot floats on. */
  windowGround: ColorName;
  faces: { heading: BrandFace; accent?: BrandFace; body: BrandFace };
  /** Repo-relative directory holding the licensed font files (gitignored). */
  fontDir: string;
  /** What to tell a person whose machine lacks the font files. */
  fontSetup: string;
  /** Pack-relative SVG paths, per ground tone. */
  logos: Record<LogoTone, { full: string; mark: string }>;
};

export const BRANDS: Readonly<Record<string, BrandPack>> = {
  agenta: agenta as BrandPack,
};

/** Inter's cap ratio: every style's `type.sizePx` was tuned against it. */
export const STYLE_CAP_RATIO = 0.7275;

/** Where a pack's files are served from, under public/. */
export const brandAssetDir = (id: string): string => `brand/${id}`;

/** Why `id` names no pack, or null. */
export function brandProblem(id: unknown): string | null {
  if (typeof id !== "string" || !(id in BRANDS))
    return `unknown brand ${JSON.stringify(id)}. Known: ${Object.keys(BRANDS).join(", ")}`;
  return null;
}

export function resolveBrand(id: string): BrandPack {
  const problem = brandProblem(id);
  if (problem) throw new Error(problem);
  return BRANDS[id];
}

/** A colour name's hex, or a thrown error naming the pack and the name. */
export function brandColor(pack: BrandPack, name: ColorName): string {
  const hex = pack.colors[name];
  if (!hex) throw new Error(`brand "${pack.id}" has no colour "${name}"`);
  return hex;
}

/** Every hex the pack allows, lowercased. */
export const brandHexes = (pack: BrandPack): string[] =>
  Object.values(pack.colors).map((h) => h.toLowerCase());

const stack = (face: BrandFace, fallback: string): string =>
  `"${face.family}", ${fallback}`;

/** The logo's served path for a ground. */
export const brandLogo = (pack: BrandPack, tone: LogoTone): string =>
  `${brandAssetDir(pack.id)}/${pack.logos[tone].full}`;

function ground(pack: BrandPack, g: BrandGround, base: Ground): Ground {
  const c = (n: ColorName) => brandColor(pack, n);
  return {
    ground: c(g.ground),
    ink: c(g.ink),
    muted: c(g.muted),
    wordmark: c(g.muted),
    // A pack's grounds are flat colour fields: a photograph is not a colour a
    // brand can set, and the audit could not check one.
    ...(base.backdrop ? { backdrop: false } : {}),
    chip: { fill: c(g.chip.fill), label: c(g.chip.label), rim: c(g.chip.rim) },
    highlight: { fill: c(g.highlight.fill), ink: c(g.highlight.ink) },
    logo: brandLogo(pack, g.logo),
  };
}

/**
 * `preset` in `pack`'s look: grounds, inks, logos and faces from the pack;
 * every motion, layout and timing number from the style.
 *
 * The headline size is scaled by the faces' cap ratios, so the cap height the
 * style was tuned for survives the change of face, and so does the line pitch.
 */
export function applyBrand(preset: StylePreset, pack: BrandPack): StylePreset {
  const { heading, accent } = pack.faces;
  const scale = STYLE_CAP_RATIO / heading.cap;
  const palette = Object.fromEntries(
    (Object.keys(preset.palette) as GroundKey[]).map((k) => [
      k,
      ground(pack, pack.grounds[k], preset.palette[k]),
    ]),
  ) as StylePreset["palette"];
  return {
    ...preset,
    palette,
    shot: {
      ...preset.shot,
      // Only a FLAT shot ground is the brand's to set. `null` means the
      // style's photographic backdrop, which stays the style's.
      ground: preset.shot.ground === null ? null : brandColor(pack, pack.windowGround),
    },
    type: {
      ...preset.type,
      sizePx: Math.round(preset.type.sizePx * scale),
      fontFamily: stack(heading, preset.type.fontFamily),
      ...(accent ? { accentFamily: stack(accent, preset.type.fontFamily) } : {}),
      bodyFamily: stack(pack.faces.body, preset.type.fontFamily),
    },
  };
}

/** The faces a render must load: served path, family and weight. */
export function brandFaceFiles(
  pack: BrandPack,
): { family: string; url: string; weight: number }[] {
  return Object.values(pack.faces)
    .filter((f): f is BrandFace => f !== undefined && f.file !== null)
    .map((f) => ({
      family: f.family,
      url: `${brandAssetDir(pack.id)}/fonts/${f.file}`,
      weight: f.weight,
    }));
}
