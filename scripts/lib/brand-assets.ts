/**
 * Put a brand pack's files where Remotion can load them: public/brand/<id>/.
 *
 * Remotion's staticFile() only serves public/, and the licensed faces live in
 * one gitignored place per machine (the pack's `fontDir`), so they are COPIED
 * in before bundling rather than kept twice in the repo. Logos come from the
 * pack's own committed directory. public/brand/ is gitignored.
 *
 * A missing file fails here, naming the file and the pack's setup step, rather
 * than as a silently substituted fallback face three minutes into a render.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { brandAssetDir, resolveBrand, type BrandPack } from "../../src/lib/brand";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Every file the pack needs, as [source, destination] absolute paths. */
export function brandFiles(pack: BrandPack, root = ROOT): [string, string][] {
  const out = path.join(root, "public", brandAssetDir(pack.id));
  const fonts = Object.values(pack.faces)
    .filter((f) => f && f.file)
    .map((f) => [
      path.join(root, pack.fontDir, f!.file!),
      path.join(out, "fonts", f!.file!),
    ] as [string, string]);
  const logos = Object.values(pack.logos)
    .flatMap((l) => [l.full, l.mark])
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((rel) => [
      path.join(root, "brands", pack.id, rel),
      path.join(out, rel),
    ] as [string, string]);
  return [...fonts, ...logos];
}

/** The files the pack names that are not on disk, as repo-relative paths. */
export function missingBrandFiles(pack: BrandPack, root = ROOT): string[] {
  return brandFiles(pack, root)
    .filter(([src]) => !fs.existsSync(src))
    .map(([src]) => path.relative(root, src));
}

/**
 * Copy `id`'s files into public/brand/<id>/. Throws, naming every missing
 * file and the setup step, before copying anything.
 */
export function stageBrandAssets(id: string, root = ROOT): void {
  const pack = resolveBrand(id);
  const missing = missingBrandFiles(pack, root);
  if (missing.length)
    throw new Error(
      `brand "${id}" is missing ${missing.length} file(s):\n  ${missing.join("\n  ")}\n${pack.fontSetup}`,
    );
  for (const [src, dst] of brandFiles(pack, root)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const same =
      fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size &&
      fs.readFileSync(dst).equals(fs.readFileSync(src));
    if (!same) fs.copyFileSync(src, dst);
  }
}
