import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { resolveBrand } from "../../src/lib/brand";
import { missingBrandFiles, stageBrandAssets } from "./brand-assets";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** A repo-shaped temp root with the pack's committed logos but no licensed fonts. */
function fakeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-"));
  fs.cpSync(path.join(ROOT, "brands"), path.join(root, "brands"), { recursive: true });
  return root;
}

describe("brand assets", () => {
  it("names every missing licensed face and the setup step, and copies nothing", () => {
    const root = fakeRoot();
    assert.deepEqual(missingBrandFiles(resolveBrand("agenta"), root), [
      ".agents/skills/agenta-social-graphic/brand/fonts/GT-Alpina-Light.woff2",
      ".agents/skills/agenta-social-graphic/brand/fonts/PPMondwest-Regular.otf",
    ]);
    assert.throws(
      () => stageBrandAssets("agenta", root),
      /brand "agenta" is missing 2 file\(s\):[\s\S]*GT-Alpina-Light\.woff2[\s\S]*Setup/,
    );
    assert.equal(fs.existsSync(path.join(root, "public", "brand")), false);
  });

  it("copies fonts and logos under public/brand/<id>/ once they exist", () => {
    const root = fakeRoot();
    const fonts = path.join(root, ".agents/skills/agenta-social-graphic/brand/fonts");
    fs.mkdirSync(fonts, { recursive: true });
    for (const f of ["GT-Alpina-Light.woff2", "PPMondwest-Regular.otf"])
      fs.writeFileSync(path.join(fonts, f), f);
    stageBrandAssets("agenta", root);
    const out = path.join(root, "public/brand/agenta");
    assert.ok(fs.existsSync(path.join(out, "fonts/GT-Alpina-Light.woff2")));
    assert.ok(fs.existsSync(path.join(out, "logos/logo-light.svg")));
    assert.ok(fs.existsSync(path.join(out, "logos/logo-dark-accent.svg")));
  });
});
