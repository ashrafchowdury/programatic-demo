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
};
const ROOT = path.resolve(SKILL, "..", "..", "..");
const PRESETS = { x: [2839, 1596], card: [2400, 1260], square: [2160, 2160] } as const;
type Preset = keyof typeof PRESETS;

const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const selfTest = argv.includes("--templates");
const name = selfTest ? "_templates" : argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--preset");
if (!name) {
  console.error("usage: render.mts <name> [--preset x|card|square|all] | --templates");
  process.exit(2);
}
const presetArg = flag("--preset") ?? "x";
const presets: Preset[] = presetArg === "all" ? (Object.keys(PRESETS) as Preset[]) : [presetArg as Preset];
if (!presets.every((p) => p in PRESETS)) {
  console.error(`unknown preset ${presetArg}; one of ${Object.keys(PRESETS).join(", ")}, all`);
  process.exit(2);
}

const srcDir = selfTest ? path.join(KIT, "templates") : path.join(ROOT, "social", name);
const brandFile = path.join(srcDir, "brand");
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
const outDir = path.join(ROOT, "out", "social", selfTest ? `_templates-${brand.name.toLowerCase()}` : name);
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
      const f = path.join(srcDir, rel.trim());
      const type = f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${type};base64,${fs.readFileSync(f).toString("base64")}`;
    });
  return `<!doctype html><html><head><meta charset="utf-8"><base href="file://${srcDir}/">
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
        if (el.closest(".title")) titleWords += words;
        else if (!texture) readWords += words;
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
        for (const y of yellowEls) {
          if (y.contains(lg) || lg.contains(y)) continue;
          const q = y.getBoundingClientRect();
          if (b.left < q.right && b.right > q.left && b.top < q.bottom && b.bottom > q.top) errors.push(`${B.name} logo overlaps an accent element`);
        }
      }
      return { errors, warnings, stats: { titleWords, readWords, yellow, archetype: arch } };
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
      for (let y = 0; y < H; y += step) for (let i = 0; i < W; i += step) {
        const o = (y * W + i) * 4;
        total++;
        if (Math.abs(d[o] - g[0]) + Math.abs(d[o + 1] - g[1]) + Math.abs(d[o + 2] - g[2]) > 60) ink++;
      }
      const f = document.createElement("canvas");
      f.width = Math.round(W * 0.2);
      f.height = Math.round(H * 0.2);
      const fx = f.getContext("2d")!;
      fx.imageSmoothingQuality = "high";
      fx.drawImage(img, 0, 0, f.width, f.height);
      return { density: (ink / total) * 100, feed: f.toDataURL("image/png") };
    },
    { src: "data:image/png;base64," + png.toString("base64"), W, H },
  );
}

const browser = await chromium.launch();
let failed = 0;
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
    if (loaded.length) report.errors.push(`fonts failed to load: ${[...new Set(loaded)].join(", ")}`);
    for (const src of broken) report.errors.push(`image failed to load: ${src}`);
    const suffix = presets.length > 1 || preset !== "x" ? `.${preset}` : "";
    const png = await page.locator("main.post").screenshot({ path: path.join(outDir, `${variant}${suffix}.png`) });
    const px = await pixels(page, png, W, H);
    fs.writeFileSync(path.join(outDir, `${variant}${suffix}.feed.png`), Buffer.from(px.feed.split(",")[1], "base64"));
    if (px.density > 14) report.warnings.push(`ink density ${px.density.toFixed(1)} %: the references sit at 2–5 % (text) and under 14 % (UI); cut something`);
    await page.close();
    const status = report.errors.length ? "FAIL" : "ok";
    if (report.errors.length) failed++;
    console.log(`${status.padEnd(4)} ${variant}${suffix}  [${report.stats.archetype}]  ink ${px.density.toFixed(1)}%  title ${report.stats.titleWords}w  accent ${report.stats.yellow}`);
    for (const e of report.errors) console.log(`     ✗ ${e}`);
    for (const w of report.warnings) console.log(`     ! ${w}`);
  }
}
await browser.close();
console.log(`\n${brand.name} brand · ${path.relative(ROOT, outDir)}/`);
process.exit(failed ? 1 : 0);
