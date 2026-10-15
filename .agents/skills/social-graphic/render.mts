/**
 * Render social graphics and audit them against the Agenta brand.
 *
 * Usage:
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name>             social/<name>/*.html, preset x
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --preset card
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts <name> --preset all
 *   pnpm exec tsx .agents/skills/social-graphic/render.mts --templates        self-test the kit's templates
 *
 * A post is an HTML fragment whose root is <main class="post …">. `{{kit}}` in
 * it resolves to this skill's kit/ directory; any other relative path resolves
 * against the post's own folder. Output, per variant and preset:
 *   out/social/<name>/<variant>[.<preset>].png        the post
 *   out/social/<name>/<variant>[.<preset>].feed.png   the same at 20 %, as a feed shows it
 *   out/social/<name>/<variant>.html                  the built, self-contained source
 *
 * The audit fails the run (exit 1) on any off-palette colour, wrong font,
 * unreadable text, text outside the safe area, a missing or misplaced Agenta
 * logo, more than one yellow moment, or a large-blur shadow. Fix the post;
 * do not loosen the audit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Page } from "playwright";

const SKILL = import.meta.dirname;
const KIT = path.join(SKILL, "kit");
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
const outDir = path.join(ROOT, "out", "social", name);
if (!fs.existsSync(srcDir)) {
  console.error(`no posts at ${path.relative(ROOT, srcDir)}/ — copy a template from ${path.relative(ROOT, KIT)}/templates/`);
  process.exit(2);
}
const fonts = ["GT-Alpina-Standard-Light.otf", "GT-Alpina-Standard-Regular.ttf", "PPMondwest-Regular.otf"];
const missing = fonts.filter((f) => !fs.existsSync(path.join(KIT, "fonts", f)));
if (missing.length) {
  console.error(`missing licensed fonts in ${path.relative(ROOT, KIT)}/fonts/: ${missing.join(", ")}\nFetch them from the design-system artifact (see SKILL.md, "Setup").`);
  process.exit(2);
}
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".html")).sort();
fs.mkdirSync(outDir, { recursive: true });

function build(file: string) {
  const fragment = fs.readFileSync(path.join(srcDir, file), "utf8").replaceAll("{{kit}}", "file://" + KIT);
  return `<!doctype html><html><head><meta charset="utf-8"><base href="file://${srcDir}/">
<link rel="stylesheet" href="file://${KIT}/brand.css"></head><body>${fragment}</body></html>`;
}

/** Everything the audit needs is measured in the page, from computed styles. */
async function audit(page: Page, W: number, H: number) {
  return page.evaluate(
    ({ W, H }) => {
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
      const exempt = (el: Element) => !!el.closest("[data-third-party], svg, img");
      const GRADIENT_OK = ".ag-btn, .hchip, .post";

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
        if (/gradient\(/.test(s.backgroundImage) && !el.matches(GRADIENT_OK)) errors.push(`gradient on ${label(el)}: only keycap buttons and the highlight chip use gradients`);
        for (const sh of s.boxShadow === "none" ? [] : s.boxShadow.split(/,(?![^(]*\))/)) {
          const px = (sh.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
          if (px.length >= 3 && px[2] > 96) errors.push(`shadow blur ${px[2]}px on ${label(el)}: the brand allows no blur above 96 px (th-menu-shadow at 2x)`);
        }
        const bg = rgba(s.backgroundColor);
        const isYellowBg = (bg && bg.a > 0 && /^(242,242,92|231,231,18)$/.test(bg.rgb)) || el.matches(".ag-btn.primary") || el.matches(".post.carbon .hchip");
        if (isYellowBg) yellow++;
      }
      for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[src*='accent']"))) if (!img.closest("[data-third-party]")) yellow++;
      if (yellow > 1) errors.push(`${yellow} yellow moments; the brand allows one per post`);

      // type: family, size, words, safe area
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let titleWords = 0;
      let readWords = 0;
      let bitmapWords = 0;
      const cap = { GT: 0.68, MW: 0.64 };
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent!.trim();
        const el = n.parentElement!;
        if (!text || exempt(el)) continue;
        const s = getComputedStyle(el);
        const fam = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        if (fam !== "GT Alpina" && fam !== "PP Mondwest") errors.push(`font "${fam}" on ${label(el)}: only GT Alpina and PP Mondwest`);
        const words = text.split(/\s+/).length;
        if (fam === "PP Mondwest") bitmapWords += words;
        const capPct = (parseFloat(s.fontSize) * (fam === "PP Mondwest" ? cap.MW : cap.GT) * 100) / H;
        const texture = !!el.closest("[data-texture]");
        if (texture && capPct < 1.6) errors.push(`texture text cap ${capPct.toFixed(2)}%H on ${label(el)}: below 1.6 %H it is noise, not texture`);
        if (!texture && capPct < 2.9) errors.push(`text cap ${capPct.toFixed(2)}%H on ${label(el)} cannot be read in the feed (min 2.9 %H); enlarge it or mark it data-texture`);
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
      if (titleWords > 8) errors.push(`title is ${titleWords} words; keep it to 8`);
      if (readWords > 16) warnings.push(`${readWords} readable words outside the title; the feed reads about 12`);
      if (bitmapWords > 1) errors.push(`PP Mondwest sets ${bitmapWords} words; it gets exactly one`);

      // the Agenta logo: present, inside the safe area, never on yellow
      const logos = Array.from(root.querySelectorAll<HTMLElement>("[data-logo='agenta']"));
      if (!logos.length) errors.push("no Agenta logo: mark it with data-logo=\"agenta\"");
      const yellowEls = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((e) => {
        const v = rgba(getComputedStyle(e).backgroundColor);
        return (v && v.a > 0 && /^(242,242,92|231,231,18)$/.test(v.rgb)) || e.matches(".ag-btn.primary");
      });
      for (const lg of logos) {
        const b = lg.getBoundingClientRect();
        if (!lg.closest("[data-bleed]") && (b.left < r.left + mx - 2 || b.top < r.top + my - 2 || b.right > r.right - mx + 2 || b.bottom > r.bottom - my + 2))
          errors.push("Agenta logo outside the safe area");
        for (const y of yellowEls) {
          if (y.contains(lg) || lg.contains(y)) { errors.push("Agenta logo sits on yellow"); continue; }
          const q = y.getBoundingClientRect();
          if (b.left < q.right && b.right > q.left && b.top < q.bottom && b.bottom > q.top) errors.push("Agenta logo overlaps a yellow element");
        }
      }
      return { errors, warnings, stats: { titleWords, readWords, yellow, archetype: root.dataset.archetype ?? "?" } };
    },
    { W, H },
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
    const loaded = await page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === "error").map((f) => f.family));
    const report = await audit(page, W, H);
    if (loaded.length) report.errors.push(`fonts failed to load: ${[...new Set(loaded)].join(", ")}`);
    const suffix = presets.length > 1 || preset !== "x" ? `.${preset}` : "";
    const png = await page.locator("main.post").screenshot({ path: path.join(outDir, `${variant}${suffix}.png`) });
    const px = await pixels(page, png, W, H);
    fs.writeFileSync(path.join(outDir, `${variant}${suffix}.feed.png`), Buffer.from(px.feed.split(",")[1], "base64"));
    if (px.density > 14) report.warnings.push(`ink density ${px.density.toFixed(1)} %: the references sit at 2–5 % (text) and under 14 % (UI); cut something`);
    await page.close();
    const status = report.errors.length ? "FAIL" : "ok";
    if (report.errors.length) failed++;
    console.log(`${status.padEnd(4)} ${variant}${suffix}  [${report.stats.archetype}]  ink ${px.density.toFixed(1)}%  title ${report.stats.titleWords}w  yellow ${report.stats.yellow}`);
    for (const e of report.errors) console.log(`     ✗ ${e}`);
    for (const w of report.warnings) console.log(`     ! ${w}`);
  }
}
await browser.close();
console.log(`\n${path.relative(ROOT, outDir)}/`);
process.exit(failed ? 1 : 0);
