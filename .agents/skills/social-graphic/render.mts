/**
 * Render social graphics and audit them against a brand pack.
 *
 * Usage:
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>                    social/<name>/*.html, preset x
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --brand <dir>      audit against that brand pack
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --preset card|square|all
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts --templates [--brand <dir>]  self-test the templates
 *
 * The brand pack is, in order: --brand, the path in social/<name>/brand (one line,
 * relative to the repo root), $SOCIAL_BRAND, or this skill's brands/example.
 * A pack is a folder with brand.css (palette --c-*, roles, faces), brand.json
 * (audit rules) and logos/{logo,mark}-{light,dark,dark-accent}.svg.
 *
 * A post is an HTML fragment whose root is <main class="post …">. In it,
 * `{{brand}}` is the brand pack, `{{kit}}` this skill's kit/, `{{inline:path}}`
 * a data URL of a post-local file, and any other relative path resolves against
 * the post's folder. Output, per variant and preset:
 *   out/social/<name>/<variant>[.<preset>].png        the post
 *   out/social/<name>/<variant>[.<preset>].feed.png   the same at 20 %, as a feed shows it
 *   out/social/<name>/<variant>.html                  the built source
 *
 * The audit fails the run (exit 1) on any off-palette colour, a face the brand
 * does not list, unreadable text, text outside the safe area, a missing or
 * misplaced logo, too many accent moments, a large-blur shadow, light or grain
 * in a brand that forbids it, or a direction the brand does not allow. Fix the
 * post; do not loosen the audit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Page } from "playwright";

const SKILL = import.meta.dirname;
const KIT = path.join(SKILL, "kit");

type Brand = {
  name: string;
  fonts: Record<string, { cap: number; maxWords?: number }>;
  requiredFiles: string[];
  accent: string[];
  accentClasses: string[];
  accentMax: number;
  logoNeverOnAccent: boolean;
  gradientClasses: string[];
  allowLight: boolean;
  maxShadowBlur: number;
  minReadCapPct: number;
  minTextureCapPct: number;
  maxTitleWords: number;
  maxReadWords: number;
  archetypes: string[] | "all";
  grounds?: string[];
  formatGrounds?: Record<string, string[]>;
  /** names that keep their capitals inside a sentence-case title (brands, partners, products) */
  properNouns?: string[];
  /** the share of a series that may use the accent face (the bitmap word); it is emphasis, not decoration */
  accentFaceShare?: number;
  /** a series of 4+ posts: the most posts one format may take (share of the series; 2 are always allowed) */
  seriesFormatShare?: number;
  /** a series of 4+ posts: the most posts one ground may take */
  seriesGroundShare?: number;
  /** a series of 4+ posts: the most posts that may set a centred title over their subject */
  seriesStackShare?: number;
  /** a centred title over a subject narrower than this share of the width, on bare ground, is the generic layout */
  genericMinSubjectW?: number;
};
const ROOT = path.resolve(SKILL, "..", "..", "..");
// banner is a newsletter or blog header (2.26:1); "all" leaves it out, since a post template is not laid out for it
const PRESETS = { x: [2839, 1596], card: [2400, 1260], square: [2160, 2160], banner: [2400, 1060] } as const;
type Preset = keyof typeof PRESETS;

const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const selfTest = argv.includes("--templates");
// --candidates renders social/<name>/_candidates/ (the internal A/B drafts) against the post folder's brand and assets
const cand = argv.includes("--candidates");
const name = selfTest ? "_templates" : argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--preset");
if (!name) {
  console.error("usage: render.mts <name> [--preset x|card|square|banner|all] | --templates");
  process.exit(2);
}
const presetArg = flag("--preset") ?? "x";
const presets: Preset[] = presetArg === "all" ? ["x", "card", "square"] : [presetArg as Preset];
if (!presets.every((p) => p in PRESETS)) {
  console.error(`unknown preset ${presetArg}; one of ${Object.keys(PRESETS).join(", ")}, all`);
  process.exit(2);
}

const baseDir = selfTest ? path.join(KIT, "templates") : path.join(ROOT, "social", name);
const srcDir = cand ? path.join(baseDir, "_candidates") : baseDir;
const brandFile = path.join(baseDir, "brand");
const BRAND = path.resolve(
  ROOT,
  flag("--brand") ??
    (fs.existsSync(brandFile) ? fs.readFileSync(brandFile, "utf8").trim() : undefined) ??
    process.env.SOCIAL_BRAND ??
    path.join(SKILL, "brands", "example"),
);
if (!fs.existsSync(path.join(BRAND, "brand.json")) || !fs.existsSync(path.join(BRAND, "brand.css"))) {
  console.error(`no brand pack at ${path.relative(ROOT, BRAND)}/: it needs brand.css and brand.json`);
  process.exit(2);
}
const brand: Brand = JSON.parse(fs.readFileSync(path.join(BRAND, "brand.json"), "utf8"));
const outDir = path.join(ROOT, "out", "social", selfTest ? `_templates-${brand.name.toLowerCase()}` : name, cand ? "_candidates" : "");
if (!fs.existsSync(srcDir)) {
  console.error(`no posts at ${path.relative(ROOT, srcDir)}/ — copy a template from ${path.relative(ROOT, KIT)}/templates/`);
  process.exit(2);
}
const missing = brand.requiredFiles.filter((f) => !fs.existsSync(path.join(BRAND, f)));
if (missing.length) {
  console.error(`brand ${brand.name} is missing ${missing.join(", ")} in ${path.relative(ROOT, BRAND)}/ — see that brand's SKILL.md for setup.`);
  process.exit(2);
}
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".html")).sort();
fs.mkdirSync(outDir, { recursive: true });

function build(file: string) {
  const fragment = fs
    .readFileSync(path.join(srcDir, file), "utf8")
    .replaceAll("{{brand}}", "file://" + BRAND)
    .replaceAll("{{kit}}", "file://" + KIT)
    // {{inline:assets/x.svg}} becomes a data URL, so a script can read the pixels without tainting its canvas under file://
    .replace(/\{\{inline:([^}]+)\}\}/g, (_, rel: string) => {
      const f = path.join(baseDir, rel.trim());
      const type = f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${type};base64,${fs.readFileSync(f).toString("base64")}`;
    });
  return `<!doctype html><html><head><meta charset="utf-8"><base href="file://${baseDir}/">
<link rel="stylesheet" href="file://${KIT}/base.css"><link rel="stylesheet" href="file://${BRAND}/brand.css"></head><body>${fragment}</body></html>`;
}

/** Everything the audit needs is measured in the page, from computed styles. */
async function audit(page: Page, W: number, H: number) {
  return page.evaluate(
    ({ W, H, B }) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const root = document.querySelector<HTMLElement>("main.post");
      if (!root) return { errors: ["no <main class=\"post\"> root"], warnings, stats: {} };
      const rs = getComputedStyle(root);
      const r = root.getBoundingClientRect();
      if (Math.round(r.width) !== W || Math.round(r.height) !== H) errors.push(`canvas is ${r.width}x${r.height}, want ${W}x${H}`);
      const mx = parseFloat(rs.getPropertyValue("--mx")) || W * 0.0634;
      const my = parseFloat(rs.getPropertyValue("--my")) || H * 0.094;

      const hex = (s: string) => s.trim().replace("#", "").toLowerCase();
      const palette = new Map<string, string>();
      for (const prop of Array.from(getComputedStyle(document.documentElement))) {
        if (!prop.startsWith("--c-")) continue;
        const h = hex(getComputedStyle(document.documentElement).getPropertyValue(prop));
        palette.set([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","), prop.slice(4));
      }
      palette.set("255,255,255", "white");
      const rgba = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { rgb: p.slice(0, 3).map(Math.round).join(","), a: p.length > 3 ? p[3] : 1 };
      };
      const onPalette = (c: string) => {
        const v = rgba(c);
        if (!v || v.a === 0) return true;
        return palette.has(v.rgb);
      };
      const label = (el: Element) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") + (el.textContent?.trim() ? ` "${el.textContent.trim().slice(0, 24)}"` : "");
      const exempt = (el: Element) => !!el.closest("[data-third-party], svg, img, script, style");
      // Light is the one place gradients and big blurs are the point: mark the element data-light.
      const GRADIENT_OK = [...B.gradientClasses, ".post", ".grain", ...(B.allowLight ? ["[data-light]", "[data-light] *"] : [])].join(", ");
      const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
      const ACCENT = new Set(B.accent.map(hexRgb));
      const isAccent = (c: string) => { const v = rgba(c); return !!v && v.a > 0 && ACCENT.has(v.rgb); };
      if (!B.allowLight) {
        if (root.querySelector("[data-light]")) errors.push(`light (data-light) is outside the ${B.name} brand`);
        if (root.querySelector(".grain")) errors.push(`grain is outside the ${B.name} brand`);
      }
      const arch = root.dataset.archetype ?? "?";
      if (B.grounds && !B.grounds.some((g: string) => root.classList.contains(g))) errors.push(`ground must be one of ${B.grounds.join(", ")} for ${B.name}; this post is "${root.className}"`);
      const only = B.formatGrounds?.[arch];
      if (only && !only.some((g: string) => root.classList.contains(g))) errors.push(`${arch} goes only on ${only.join(" or ")} for ${B.name}`);
      if (B.archetypes !== "all" && !B.archetypes.includes(arch)) errors.push(`direction "${arch}" is outside the ${B.name} brand; allowed: ${(B.archetypes as string[]).join(", ")}`);

      // colours, gradients, shadows
      let yellow = 0;
      for (const el of Array.from(root.querySelectorAll("*")).concat(root)) {
        if (exempt(el)) continue;
        const s = getComputedStyle(el);
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (ownText && !onPalette(s.color)) errors.push(`off-palette text colour ${s.color} on ${label(el)}`);
        if (!onPalette(s.backgroundColor)) errors.push(`off-palette background ${s.backgroundColor} on ${label(el)}`);
        for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
          if (parseFloat(s[`border${side}Width`]) > 0 && !onPalette(s[`border${side}Color`])) errors.push(`off-palette border ${s[`border${side}Color`]} on ${label(el)}`);
        }
        if (/gradient\(/.test(s.backgroundImage) && !el.matches(GRADIENT_OK)) errors.push(`gradient on ${label(el)}: ${B.name} allows gradients only on ${B.gradientClasses.join(", ") || "nothing"}`);
        for (const sh of s.boxShadow === "none" ? [] : s.boxShadow.split(/,(?![^(]*\))/)) {
          const px = (sh.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
          if (px.length >= 3 && px[2] > B.maxShadowBlur && !(B.allowLight && el.closest("[data-light]"))) errors.push(`shadow blur ${px[2]}px on ${label(el)}: ${B.name} allows no blur above ${B.maxShadowBlur} px`);
        }
        if (isAccent(s.backgroundColor) || B.accentClasses.some((c: string) => el.matches(c))) yellow++;
      }
      // light stays inside the palette: every gradient stop and every SVG paint in a light layer is a brand colour (any alpha)
      for (const el of Array.from(root.querySelectorAll("*")).concat(root)) {
        if (el.closest("[data-third-party], img, script, style")) continue;
        const s = getComputedStyle(el);
        if (/gradient\(/.test(s.backgroundImage)) for (const c of s.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) if (!onPalette(c)) errors.push(`off-palette gradient stop ${c} on ${label(el)}`);
        if (el.closest("[data-light]") && el.closest("svg")) {
          const paints = [el.hasAttribute("fill") ? s.fill : "", el.hasAttribute("stroke") ? s.stroke : "", el.tagName.toLowerCase() === "stop" ? s.stopColor : ""];
          for (const c of paints) if (c.startsWith("rgb") && !onPalette(c)) errors.push(`off-palette light colour ${c} on ${label(el)}`);
        }
      }
      for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[src*='accent']"))) if (!img.closest("[data-third-party]")) yellow++;
      if (yellow > B.accentMax) errors.push(`${yellow} accent moments; ${B.name} allows ${B.accentMax} per post`);

      // type: family, size, words, safe area
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let titleWords = 0;
      let readWords = 0;
      const faceWords: Record<string, number> = {};
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent!.trim();
        const el = n.parentElement!;
        if (!text || exempt(el)) continue;
        const s = getComputedStyle(el);
        const fam = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        const face = B.fonts[fam];
        if (!face) errors.push(`font "${fam}" on ${label(el)}: ${B.name} uses only ${Object.keys(B.fonts).join(", ")}`);
        const words = text.split(/\s+/).length;
        faceWords[fam] = (faceWords[fam] ?? 0) + words;
        const capPct = (parseFloat(s.fontSize) * (face?.cap ?? 0.7) * 100) / H;
        const texture = !!el.closest("[data-texture]");
        if (texture && capPct < B.minTextureCapPct) errors.push(`texture text cap ${capPct.toFixed(2)}%H on ${label(el)}: below ${B.minTextureCapPct} %H it is noise, not texture`);
        if (!texture && capPct < B.minReadCapPct) errors.push(`text cap ${capPct.toFixed(2)}%H on ${label(el)} cannot be read in the feed (min ${B.minReadCapPct} %H); enlarge it or mark it data-texture`);
        // texture inside a title (an annotation, a proof mark) is not part of the title
        // texture set at reading size is read anyway, so it counts toward the word budget
        const readsAsText = !texture || capPct >= B.minReadCapPct;
        if (el.closest(".title") && !texture) titleWords += words;
        else if (readsAsText) readWords += words;
        const range = document.createRange();
        range.selectNodeContents(n);
        const b = range.getBoundingClientRect();
        const inCanvas = b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
        if (!el.closest("[data-bleed]")) {
          if (!inCanvas) errors.push(`text clipped by the canvas: ${label(el)}`);
          else if (!texture && (b.left < r.left + mx - 2 || b.right > r.right - mx + 2 || b.top < r.top + my - 2 || b.bottom > r.bottom - my + 2))
            errors.push(`text outside the safe area (${Math.round(mx)}/${Math.round(my)} px): ${label(el)}`);
        }
      }
      // Any box (a fill, a ring or a border) stays inside the box that holds it: a bubble poking past its window, a key past its
      // panel. Mark a deliberate overlap (a badge on a tile's corner) data-overhang.
      const isBox = (e: Element) => { const st = getComputedStyle(e); return (rgba(st.backgroundColor)?.a ?? 0) > 0.05 || st.boxShadow !== "none" || parseFloat(st.borderTopWidth) > 0 || parseFloat(st.borderLeftWidth) > 0; };
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        if (exempt(el) || el.closest("[data-bleed], [data-overhang], [data-light]") || !isBox(el)) continue;
        let holder = el.parentElement;
        while (holder && holder !== root && !isBox(holder)) holder = holder.parentElement;
        if (!holder || holder === root) continue;
        const e = el.getBoundingClientRect(), c = holder.getBoundingClientRect();
        if (!e.width || !e.height) continue;
        if (e.right > c.right + 2 || e.left < c.left - 2 || e.top < c.top - 2 || (e.bottom > c.bottom + 2 && c.bottom < r.bottom - 2)) errors.push(`${label(el)} spills out of ${label(holder)}`);
      }
      // A screenshot of the app shrunk to fit turns to mush in the feed. Captures are 1440 CSS px wide with 13 px body text, so the
      // text's size on the canvas follows from how wide the capture is drawn; below the texture floor, crop to the part that proves
      // the claim. (Pixel scale alone misleads: captures come at 2-5x.)
      for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
        const src = img.getAttribute("src") || "";
        if (img.closest("[data-logo]") || /\.svg($|\?)/.test(src) || src.startsWith("data:image/svg") || img.naturalWidth < 900) continue;
        const shown = img.getBoundingClientRect().width;
        const capPct = (shown / 1440) * 13 * 0.7275 / H * 100;
        if (capPct < B.minTextureCapPct) errors.push(`a screenshot is drawn ${Math.round(shown)} px wide, so its 13 px UI text lands at ${capPct.toFixed(2)} %H cap (floor ${B.minTextureCapPct}): mush in the feed. Crop it to the part that proves the claim and draw that part larger`);
      }
      // UI text and buttons stay inside their card or frame (a label spilling past its card is the commonest layout bug)
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(".read, .btn, [data-texture]"))) {
        const box = el.parentElement?.closest<HTMLElement>(".card, .frame, .chat");
        if (!box || el.closest("[data-bleed]") === box || exempt(el)) continue;
        const e = el.getBoundingClientRect(), c = box.getBoundingClientRect();
        if (e.right > c.right + 2 || e.left < c.left - 2 || (e.bottom > c.bottom + 2 && c.bottom < r.bottom)) errors.push(`${label(el)} spills out of its card`);
        if (getComputedStyle(el).overflow !== "visible" && el.scrollWidth > el.clientWidth + 2) errors.push(`${label(el)} is cut off inside its box`);
      }
      // title to subject: one fixed rhythm. The user flagged both crowded and drifting pairs; 4.5-9 %H is the band they accepted.
      const subj = root.querySelector<HTMLElement>("[data-subject]");
      const ttl = root.querySelector<HTMLElement>(".title");
      let gapPct: number | null = null;
      // only for a title set above its subject; a title inside its subject (a bento block) or beside it has no vertical gap
      const stacked = !!subj && !!ttl && !subj.contains(ttl) && (() => {
        const a = ttl.getBoundingClientRect(), b = subj.getBoundingClientRect();
        return b.top >= a.top && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;
      })();
      if (subj && ttl && stacked) {
        const rg = document.createRange(); rg.selectNodeContents(ttl);
        const tb = Math.max(...Array.from(rg.getClientRects()).map((q) => q.bottom));
        // measure the untilted layout box: a perspective tilt moves the projected top without moving the layout
        const saved = subj.style.transform; subj.style.transform = "none";
        const gap = (subj.getBoundingClientRect().top - tb) / H * 100;
        subj.style.transform = saved;
        gapPct = gap;
        if (gap < 4.5) errors.push(`title and subject crowd each other: the gap is ${gap.toFixed(1)} %H, keep 4.5-9 %H (use .stack)`);
        else if (gap > 9) errors.push(`title and subject drift apart: the gap is ${gap.toFixed(1)} %H, keep 4.5-9 %H (use .stack)`);
      }
      // Nothing sits on the title: a card, chat, frame or screenshot over a title line is a collision, stack or no stack.
      if (ttl) {
        const rg = document.createRange(); rg.selectNodeContents(ttl);
        const lines = Array.from(rg.getClientRects()).filter((q) => q.width > 4);
        for (const box of Array.from(root.querySelectorAll<HTMLElement>(".card, .frame, .chat, [data-subject], img"))) {
          if (ttl.contains(box) || box.contains(ttl) || box.closest("[data-logo], [data-light]") || exempt(box) && !box.matches("img")) continue;
          // a blurred or faint layer behind everything is backdrop, not a collision
          const bs = getComputedStyle(box);
          if (/blur\(/.test(bs.filter) || parseFloat(bs.opacity) < 0.6) continue;
          // only the part you can see: a screenshot cropped by its frame counts at the frame's edges
          let q = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
          { const b0 = box.getBoundingClientRect(); q = { left: b0.left, top: b0.top, right: b0.right, bottom: b0.bottom, width: b0.width, height: b0.height }; }
          for (let a = box.parentElement; a && a !== root; a = a.parentElement) {
            const st = getComputedStyle(a);
            if (st.overflow === "visible" && st.overflowX === "visible" && st.overflowY === "visible") continue;
            const c = a.getBoundingClientRect();
            q = { left: Math.max(q.left, c.left), top: Math.max(q.top, c.top), right: Math.min(q.right, c.right), bottom: Math.min(q.bottom, c.bottom), width: 0, height: 0 };
            q.width = Math.max(0, q.right - q.left); q.height = Math.max(0, q.bottom - q.top);
          }
          if (!q.width || !q.height) continue;
          if (lines.some((l) => l.left < q.right - 2 && l.right > q.left + 2 && l.top < q.bottom - 2 && l.bottom > q.top + 2)) { errors.push(`${label(box)} covers the title`); break; }
        }
      }
      // Voice: sentence case. Title Case reads as a label, not a claim. Proper nouns, acronyms and the word after a full stop keep
      // their capitals.
      if (ttl && B.properNouns) {
        const allowed = new Set(B.properNouns.map((w: string) => w.toLowerCase()));
        const tokens = (ttl.textContent || "").split(/\s+/).filter(Boolean);
        const caps: string[] = [];
        tokens.forEach((t, i) => {
          if (i === 0 || /[.!?:]$/.test(tokens[i - 1])) return;
          const w = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
          if (/^\p{Lu}/u.test(w) && !/^[\p{Lu}\d]+$/u.test(w) && !/\d/.test(w) && !allowed.has(w.toLowerCase())) caps.push(w);
        });
        if (caps.length >= 2) errors.push(`the title is in Title Case (${caps.join(", ")}); write it in sentence case`);
      }
      // the subject's footprint, judged after the pixels (a small subject on a lit, full canvas is fine; on bare ground it is not)
      const boxes = subj ? [subj] : Array.from(root.querySelectorAll<HTMLElement>(".card, .frame, .chat")).filter((e) => !e.parentElement?.closest(".card, .frame, .chat"));
      let subjectW: number | null = null, subjectH: number | null = null;
      if (boxes.length) {
        const u = boxes.map((x) => x.getBoundingClientRect()).reduce((a, q) => ({ l: Math.min(a.l, q.left), t: Math.min(a.t, q.top), rr: Math.max(a.rr, q.right), b: Math.max(a.b, q.bottom) }), { l: 1e9, t: 1e9, rr: -1e9, b: -1e9 });
        subjectW = (Math.min(u.rr, r.right) - Math.max(u.l, r.left)) / W;
        subjectH = (Math.min(u.b, r.bottom) - Math.max(u.t, r.top)) / H;
      }
      const accentFace = Object.keys(faceWords).some((f) => B.fonts[f]?.maxWords !== undefined);
      const titles = root.querySelectorAll(".title").length;
      if (titles > 1) errors.push(`${titles} titles; a post has at most one`);
      if (titleWords > B.maxTitleWords) errors.push(`title is ${titleWords} words; keep it to ${B.maxTitleWords}`);
      if (readWords > B.maxReadWords) warnings.push(`${readWords} readable words outside the title; the feed reads about 12`);
      for (const [fam, n] of Object.entries(faceWords)) {
        const max = B.fonts[fam]?.maxWords;
        if (max !== undefined && n > max) errors.push(`${fam} sets ${n} words; it gets ${max}`);
      }

      // the brand logo: present, inside the safe area, never on the accent
      const logos = Array.from(root.querySelectorAll<HTMLElement>("[data-logo='brand']"));
      if (!logos.length) errors.push(`no ${B.name} logo: mark it with data-logo="brand"`);
      const yellowEls = !B.logoNeverOnAccent ? [] : Array.from(root.querySelectorAll<HTMLElement>("*")).filter((e) => isAccent(getComputedStyle(e).backgroundColor) || B.accentClasses.some((c: string) => e.matches(c)));
      for (const lg of logos) {
        const b = lg.getBoundingClientRect();
        if (!lg.closest("[data-bleed]") && (b.left < r.left + mx - 2 || b.top < r.top + my - 2 || b.right > r.right - mx + 2 || b.bottom > r.bottom - my + 2))
          errors.push(`${B.name} logo outside the safe area`);
        // what is really behind the logo: the nearest ancestor (or the logo's own box) with an opaque fill
        for (let a: HTMLElement | null = lg; a; a = a.parentElement) {
          const bg = rgba(getComputedStyle(a).backgroundColor);
          if (bg && bg.a > 0) { if (isAccent(getComputedStyle(a).backgroundColor) && B.logoNeverOnAccent) errors.push(`${B.name} logo sits on the accent colour`); break; }
        }
        // nothing readable may touch the logo: keep a clear space of 2 % H around it
        const pad = H * 0.02;
        for (const t of Array.from(root.querySelectorAll<HTMLElement>(".title, .read, .card, .frame")).filter((e) => !e.closest("[data-logo]") && !e.contains(lg))) {
          const rects = t.classList.contains("title") ? (() => { const rg = document.createRange(); rg.selectNodeContents(t); return Array.from(rg.getClientRects()); })() : [t.getBoundingClientRect()];
          if (rects.some((q) => q.width && q.left < b.right + pad && q.right > b.left - pad && q.top < b.bottom + pad && q.bottom > b.top - pad)) errors.push(`${label(t)} crowds the ${B.name} logo; keep ${Math.round(pad)} px clear around it`);
        }
        for (const y of yellowEls) {
          if (y.contains(lg) || lg.contains(y)) continue;
          const q = y.getBoundingClientRect();
          if (b.left < q.right && b.right > q.left && b.top < q.bottom && b.bottom > q.top) errors.push(`${B.name} logo overlaps an accent element`);
        }
      }
      const ground = ["paper", "yellow", "carbon"].find((g) => root.classList.contains(g)) ?? "?";
      // a centred title set above its subject: the layout an unguided model falls back to, judged with the pixels below
      const tb = ttl ? ttl.getBoundingClientRect() : null;
      const centredStack = stacked && !!tb && Math.abs((tb.left + tb.right) / 2 - (r.left + W / 2)) < W * 0.03;
      return { errors, warnings, stats: { titleWords, readWords, yellow, archetype: arch, ground, lit: !!root.querySelector("[data-light], .grain"), gap: gapPct, subjectW, subjectH, accentFace, centredStack } };
    },
    { W, H, B: brand },
  );
}

/** Ink density and the 20 % feed preview, measured from the rendered pixels. */
async function pixels(page: Page, png: Buffer, W: number, H: number) {
  return page.evaluate(
    async ({ src, W, H }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H).data;
      const counts = new Map<number, number>();
      const step = 4;
      for (let y = 0; y < H; y += step) for (let i = 0; i < W; i += step) {
        const o = (y * W + i) * 4;
        const k = ((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const g = [(ground >> 10) << 3, ((ground >> 5) & 31) << 3, (ground & 31) << 3];
      let ink = 0;
      let total = 0;
      let bare = 0;
      let mass = 0;
      let massX = 0;
      // the outer 4 % is the gutter and frame, not composition
      const inner = (i: number, y: number) => i > W * 0.04 && i < W * 0.96 && y > H * 0.04 && y < H * 0.96;
      for (let y = 0; y < H; y += step) for (let i = 0; i < W; i += step) {
        const o = (y * W + i) * 4;
        total++;
        const dist = Math.abs(d[o] - g[0]) + Math.abs(d[o + 1] - g[1]) + Math.abs(d[o + 2] - g[2]);
        if (dist > 60) ink++;
        if (!inner(i, y)) continue;
        if (dist <= 24) bare++;
        else { mass += dist; massX += dist * i; }
      }
      const innerTotal = Math.round((W * 0.92) / step) * Math.round((H * 0.92) / step);
      const f = document.createElement("canvas");
      f.width = Math.round(W * 0.2);
      f.height = Math.round(H * 0.2);
      const fx = f.getContext("2d")!;
      fx.imageSmoothingQuality = "high";
      fx.drawImage(img, 0, 0, f.width, f.height);
      return { density: (ink / total) * 100, bare: bare / innerTotal, cx: mass ? massX / mass / W : 0.5, feed: f.toDataURL("image/png") };
    },
    { src: "data:image/png;base64," + png.toString("base64"), W, H },
  );
}

const browser = await chromium.launch();
let failed = 0;
const series: { variant: string; suffix: string; archetype: string; ground: string; lit: boolean; accentFace: boolean; centredStack: boolean; feed: string }[] = [];
// one row per poster, for the A/B picker (review/ab.py) and anyone reading a run later
const reportRows: Record<string, unknown>[] = [];
for (const file of files) {
  const variant = file.replace(/\.html$/, "");
  const html = build(file);
  const built = path.join(outDir, `${variant}.html`);
  fs.writeFileSync(built, html);
  for (const preset of presets) {
    const [W, H] = PRESETS[preset];
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    // tsx compiles with keepNames, which wraps the functions passed to evaluate in __name().
    await page.addInitScript({ content: "window.__name = (f) => f;" });
    await page.goto("file://" + built);
    await page.evaluate((p) => document.querySelector("main.post")?.setAttribute("data-preset", p), preset);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined)));
    });
    // A post that draws with a script sets window.__ready = false, then true when it has drawn.
    await page.waitForFunction("window.__ready !== false", undefined, { timeout: 15000 });
    const loaded = await page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === "error").map((f) => f.family));
    const broken = await page.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")));
    const report = await audit(page, W, H);
    // A face missing a glyph falls back to a system font for that glyph alone (the trial GT Alpina Light has no curly
    // apostrophe). Only the browser's font engine knows, so ask it for every element that holds text.
    {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "main.post *" });
      const seen = new Set<string>();
      for (const id of nodeIds) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: id }).catch(() => ({ fonts: [] as { familyName: string; isCustomFont: boolean; glyphCount: number }[] }));
        // a face the brand declares is fine even when it is a system font (the example brand sets Georgia)
        for (const f of fonts) if (!f.isCustomFont && !(f.familyName in brand.fonts) && !seen.has(f.familyName)) {
          seen.add(f.familyName);
          const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId: id });
          const text = outerHTML.replace(/<[^>]+>/g, "").trim().slice(0, 40);
          report.errors.push(`${f.glyphCount} glyph(s) fell back to ${f.familyName} in "${text}": the brand face lacks them (a curly quote or symbol); use a plain character or rephrase`);
        }
      }
      await cdp.detach();
    }
    if (loaded.length) report.errors.push(`fonts failed to load: ${[...new Set(loaded)].join(", ")}`);
    for (const src of broken) report.errors.push(`image failed to load: ${src}`);
    const suffix = presets.length > 1 || preset !== "x" ? `.${preset}` : "";
    const png = await page.locator("main.post").screenshot({ path: path.join(outDir, `${variant}${suffix}.png`) });
    const px = await pixels(page, png, W, H);
    fs.writeFileSync(path.join(outDir, `${variant}${suffix}.feed.png`), Buffer.from(px.feed.split(",")[1], "base64"));
    // composition, measured against the striking references (bare ground 14-49 %, weight centred at 0.47-0.51 W)
    if (px.bare > 0.86 && !["quiet", "statement", "press", "context"].includes(report.stats.archetype)) report.warnings.push(`reads empty: ${(px.bare * 100).toFixed(0)} % of the canvas is bare ground; the striking references leave 14-49 %`);
    const sw = report.stats.subjectW, sh = report.stats.subjectH;
    if (sw !== null && sh !== null && sw < 0.42 && sh < 0.42 && px.bare > 0.75)
      report.errors.push(`the subject is too small for the canvas (${Math.round(sw * 100)} %W × ${Math.round(sh * 100)} %H on ${Math.round(px.bare * 100)} % bare ground); give it at least 42 % of the width or the height`);
    const genericW = brand.genericMinSubjectW ?? 0.55;
    if (report.stats.centredStack && sw !== null && sh !== null && sw < genericW && sh < 0.45 && px.bare > 0.7)
      report.errors.push(`generic layout: a centred title over a ${Math.round(sw * 100)} %W subject on ${Math.round(px.bare * 100)} % bare ground; set the subject at ${Math.round(genericW * 100)} %W or more, or use a format whose picture is the idea`);
    if (px.cx < 0.34 || px.cx > 0.66) report.warnings.push(`lopsided: the visual weight sits at ${px.cx.toFixed(2)} W; balance it toward the centre (references 0.47-0.51)`);
    reportRows.push({ variant: variant + suffix, archetype: report.stats.archetype, ground: report.stats.ground, lit: report.stats.lit, errors: report.errors, warnings: report.warnings, bare: px.bare, weight: px.cx, gap: report.stats.gap, titleWords: report.stats.titleWords, png: path.join(outDir, `${variant}${suffix}.png`), feed: path.join(outDir, `${variant}${suffix}.feed.png`) });
    series.push({ variant, suffix, archetype: report.stats.archetype, ground: report.stats.ground, lit: report.stats.lit, accentFace: report.stats.accentFace, centredStack: !!report.stats.centredStack, feed: path.join(outDir, `${variant}${suffix}.feed.png`) });
    await page.close();
    const status = report.errors.length ? "FAIL" : "ok";
    if (report.errors.length) failed++;
    console.log(`${status.padEnd(4)} ${variant}${suffix}  [${report.stats.archetype} · ${report.stats.ground}${report.stats.lit ? " · lit" : ""}]  bare ${(px.bare * 100).toFixed(0)}%  weight ${px.cx.toFixed(2)}W  title ${report.stats.titleWords}w  accent ${report.stats.yellow}`);
    for (const e of report.errors) console.log(`     ✗ ${e}`);
    for (const w of report.warnings) console.log(`     ! ${w}`);
  }
}

// A numbered folder (01-…, 02-…) is a series posted one a day: print each day's format and ground so the plan reads at a
// glance. The format is chosen for the message, so repeats are fine, but not for most of a series: from four posts on, the
// audit caps one format, one ground and the centred title-over-subject layout.
const days = series.filter((s) => /^\d+[-_]/.test(s.variant) && !s.suffix);
// several files under one number are variants of one day (01-…-a, 01-…-b), not a series
const isSeries = new Set(days.map((s) => s.variant.match(/^\d+/)![0])).size === days.length;
if (days.length > 1 && isSeries) {
  console.log(`\nseries · ${days.length} posts`);
  for (const d of days) console.log(`     ${d.variant.padEnd(48)} ${d.archetype} · ${d.ground}${d.lit ? " · lit" : ""}${d.accentFace ? " · bitmap word" : ""}`);
  // the bitmap word is emphasis: on every title it stops meaning anything
  const share = brand.accentFaceShare ?? 1;
  const used = days.filter((d) => d.accentFace).length;
  const limit = Math.max(1, Math.floor(days.length * share));
  if (used > limit) { console.log(`     ✗ ${used} of ${days.length} titles use the accent face; at most ${limit}. Keep it for the one word that is the point.`); failed++; }
  if (days.length >= 4) {
    const count = (key: (d: (typeof days)[number]) => string) => days.reduce((m, d) => m.set(key(d), (m.get(key(d)) ?? 0) + 1), new Map<string, number>());
    const fmtMax = Math.max(2, Math.ceil(days.length * (brand.seriesFormatShare ?? 1 / 3)));
    for (const [f, n] of count((d) => d.archetype)) if (n > fmtMax) { console.log(`     ✗ ${n} of ${days.length} posts use ${f}; at most ${fmtMax}. Take the next-best format that still shows the claim.`); failed++; }
    const groundMax = Math.floor(days.length * (brand.seriesGroundShare ?? 0.65));
    for (const [g, n] of count((d) => d.ground)) if (n > groundMax) { console.log(`     ✗ ${n} of ${days.length} posts are on ${g}; at most ${groundMax}. Alternate the grounds.`); failed++; }
    const stackMax = Math.floor(days.length * (brand.seriesStackShare ?? 0.5));
    const stacks = days.filter((d) => d.centredStack).length;
    if (stacks > stackMax) { console.log(`     ✗ ${stacks} of ${days.length} posts set a centred title over a card; at most ${stackMax}. The series reads as one template.`); failed++; }
  }
}

// One contact sheet of every feed preview, so a whole run reviews as one image.
if (series.length > 1) {
  const cols = series.length > 12 ? 4 : series.length > 4 ? 3 : 2;
  // inline the previews: a page set from a string cannot load file:// images, and a blank sheet hides every defect
  const cells = series.map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.feed).toString("base64")}"><figcaption>${s.variant}${s.suffix} · ${s.archetype} · ${s.ground}</figcaption></figure>`).join("");
  const page = await browser.newPage({ viewport: { width: cols * 588 + 24, height: 600 } });
  await page.setContent(`<style>body{margin:0;padding:12px;background:#e5e0dd;font:14px/1.3 system-ui;display:grid;grid-template-columns:repeat(${cols},568px);gap:20px}figure{margin:0}img{display:block;width:568px;height:auto}figcaption{padding:6px 2px;color:#343434}</style>${cells}`);
  await page.evaluate(async () => { await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined))); });
  await page.screenshot({ path: path.join(outDir, "_sheet.png"), fullPage: true });
  await page.close();
}
fs.writeFileSync(path.join(outDir, "_report.json"), JSON.stringify(reportRows, null, 1));
await browser.close();
console.log(`\n${brand.name} brand · ${path.relative(ROOT, outDir)}/${series.length > 1 ? "  (contact sheet: _sheet.png)" : ""}`);
process.exit(failed ? 1 : 0);
