/**
 * The reel brand audit: proof that nothing off-brand reached a branded reel's
 * cards. Footage is the product's own pixels and is never audited.
 *
 * Two halves, both pure:
 *
 *   - STATIC (brandProblems): every colour, face and logo a card resolves to
 *     must come from the pack. Runs on the compiled reel, before rendering.
 *   - FRAMES (frameColorProblem): every pixel of a rendered card frame must lie
 *     within `tolerance` of a pack colour, or of the straight line between two
 *     of them, which is what an anti-aliased edge between two pack colours is.
 */
import { brandHexes, type BrandPack } from "./brand";
import { parseHeadline, resolveCard, type IntroStoryboard } from "./intro";
import { isCard, reelCard, type Reel } from "./reel";

export type AuditProblem = { path: string; message: string };

const norm = (c: string) => c.trim().toLowerCase();

/** Every static brand problem in `reel`'s cards. Empty = on brand. */
export function brandProblems(reel: Reel, pack: BrandPack): AuditProblem[] {
  const allowed = new Set(brandHexes(pack));
  const logos = new Set(
    Object.values(pack.logos).map((l) => `brand/${pack.id}/${l.full}`),
  );
  const out: AuditProblem[] = [];
  if (reel.brand !== pack.id)
    out.push({ path: "brand", message: `reel names brand ${JSON.stringify(reel.brand)}, audit is for "${pack.id}"` });
  // The clips' footage is the product's, but the ground it floats on is ours.
  const ground = reel.window?.ground;
  if (ground !== undefined && !allowed.has(norm(ground)))
    out.push({ path: "window.ground", message: `window ground ${ground} is not an "${pack.id}" colour` });

  reel.segments.forEach((seg, i) => {
    if (!isCard(seg)) return;
    const at = `segments[${i}]`;
    const card: IntroStoryboard = reelCard(reel, seg.card);
    if (card.brand !== pack.id) {
      out.push({ path: at, message: `card renders outside the "${pack.id}" pack` });
      return;
    }
    const { look, type } = resolveCard(card);
    const colours: [string, string][] = [
      ["ground", look.ground],
      ["ink", look.headline],
      ["subhead", look.subhead],
      ["wordmark", look.wordmark],
      ["highlight", look.highlightBg],
      ["highlight ink", look.highlightInk],
    ];
    if (card.chip)
      colours.push(["chip", look.chipFill], ["chip label", look.chipLabel], ["chip rim", look.chipRim]);
    for (const [role, c] of colours)
      if (!allowed.has(norm(c)))
        out.push({ path: `${at}.${role}`, message: `${role} ${c} is not an "${pack.id}" colour` });
    // A custom highlight colour in the copy (==word|#hex==) bypasses the palette.
    for (const field of ["headline", "wordmark"] as const) {
      const text = card[field];
      if (typeof text !== "string") continue;
      for (const t of parseHeadline(text)) {
        const hl = t.style?.highlight;
        if (typeof hl === "string" && !allowed.has(norm(hl)))
          out.push({ path: `${at}.${field}`, message: `highlight ${hl} on "${t.text}" is not an "${pack.id}" colour` });
      }
    }
    const face = type.fontFamily.split(",")[0].replace(/"/g, "").trim();
    if (face !== pack.faces.heading.family)
      out.push({ path: `${at}.face`, message: `headline face "${face}" is not "${pack.id}"'s heading face "${pack.faces.heading.family}"` });
    if (card.logo && (!look.logo || !logos.has(look.logo)))
      out.push({ path: `${at}.logo`, message: `logo card draws ${look.logo ?? "the generic mark"}, not an "${pack.id}" logo` });
  });
  return out;
}

type RGB = readonly [number, number, number];

const rgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;
};

/** Distance from p to the segment a-b, in RGB units. */
function segmentDistance(p: RGB, a: RGB, b: RGB): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2));
  return Math.hypot(p[0] - (a[0] + t * d[0]), p[1] - (a[1] + t * d[1]), p[2] - (a[2] + t * d[2]));
}

/**
 * Off-brand pixels in one RGB24 frame, or null when it is on brand.
 *
 * `maxOffShare` is the share of pixels allowed outside tolerance: video
 * compression rings a little around glyph edges, and that is not a colour
 * anyone chose. The report names the most common off-brand colour, rounded to
 * a 16-level bucket so the noise around one wrong colour reads as one colour.
 */
export function frameColorProblem(
  pixels: Uint8Array,
  pack: BrandPack,
  tolerance: number,
  maxOffShare: number,
): { offShare: number; colour: string } | null {
  const palette = brandHexes(pack).map(rgb);
  const pairs: [RGB, RGB][] = [];
  for (let i = 0; i < palette.length; i++)
    for (let j = i; j < palette.length; j++) pairs.push([palette[i], palette[j]]);
  const memo = new Map<number, boolean>();
  const buckets = new Map<string, number>();
  let off = 0;
  const n = Math.floor(pixels.length / 3);
  for (let k = 0; k < n; k++) {
    const r = pixels[3 * k], g = pixels[3 * k + 1], b = pixels[3 * k + 2];
    const key = (r << 16) | (g << 8) | b;
    let ok = memo.get(key);
    if (ok === undefined) {
      const p: RGB = [r, g, b];
      ok = pairs.some(([a, c]) => segmentDistance(p, a, c) <= tolerance);
      memo.set(key, ok);
    }
    if (ok) continue;
    off++;
    const q = (v: number) => (v & 0xf0).toString(16).padStart(2, "0");
    const bucket = `#${q(r)}${q(g)}${q(b)}`;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const offShare = n ? off / n : 0;
  if (offShare <= maxOffShare) return null;
  const colour = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { offShare, colour };
}
