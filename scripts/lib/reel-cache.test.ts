import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  dotenvValues,
  importGraph,
  LEAVES,
  referencedAssets,
  referencedEnv,
  relativeSpecifiers,
  sourceSet,
  sourceSetDigest,
} from "./reel-cache";

/** A throwaway src/ + public/ pair, so the walk runs on real files. */
function fixture(): { dir: string; write: (rel: string, body: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-cache-"));
  const write = (rel: string, body: string) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  };
  return { dir, write };
}

describe("relativeSpecifiers", () => {
  it("finds every import form and skips packages", () => {
    const src = [
      `import React from "react";`,
      `import { a,\n  b } from "./lib/a";`,
      `import type { T } from '../types';`,
      `export * from "./re-export";`,
      `import "./index.css";`,
      `const lazy = import("./lazy");`,
    ].join("\n");
    assert.deepEqual(relativeSpecifiers(src).sort(), [
      "../types",
      "./index.css",
      "./lazy",
      "./lib/a",
      "./re-export",
    ]);
  });
});

describe("the derived source set (R12)", () => {
  it("picks up a NEW import without anyone listing it", () => {
    // The failure the hand-kept list had: a module the composition started
    // importing (crop.ts, once) was never added, so editing it served a stale
    // cached segment.
    const { dir, write } = fixture();
    const entry = write("src/Clip.tsx", `import { a } from "./lib/a";\n`);
    write("src/lib/a.ts", `export const a = 1;\n`);
    const added = write("src/lib/new.ts", `export const n = 1;\n`);
    const pub = path.join(dir, "public");
    fs.mkdirSync(pub);

    const before = sourceSet([entry], [], pub);
    assert.equal(before.code.includes(added), false);
    const d0 = sourceSetDigest(before, {});

    write("src/lib/a.ts", `export { n } from "./new";\nexport const a = 1;\n`);
    const after = sourceSet([entry], [], pub);
    assert.ok(after.code.includes(added), "the new module is in the set");
    const d1 = sourceSetDigest(after, {});
    assert.notEqual(d0, d1);

    // ...and editing it now invalidates, which is the point.
    write("src/lib/new.ts", `export const n = 2;\n`);
    assert.notEqual(sourceSetDigest(sourceSet([entry], [], pub), {}), d1);
  });

  it("follows index files and survives an import cycle", () => {
    const { write } = fixture();
    const entry = write("src/a.ts", `import "./b";\nimport "./dir";\n`);
    write("src/b.ts", `import "./a";\n`);
    const idx = write("src/dir/index.ts", `export {};\n`);
    const graph = importGraph([entry]);
    assert.equal(graph.length, 3);
    assert.ok(graph.includes(idx));
  });

  it("hashes the public/ assets the code names, and whole dirs for templates", () => {
    const { dir, write } = fixture();
    const entry = write(
      "src/Card.tsx",
      [
        `const LOGO = "logo-mark.png";`,
        `const font = staticFile("fonts/inter.woff2");`,
        "const bd = (n: string) => `backdrops/${n}.jpg`;",
        "const footage = (n: string) => `${n}.mp4`;",
      ].join("\n"),
    );
    const logo = write("public/logo-mark.png", "L");
    const font = write("public/fonts/inter.woff2", "F");
    const glaze = write("public/backdrops/glaze.jpg", "G");
    write("public/demo.mp4", "footage is hashed per demo, not here");
    const assets = referencedAssets([entry], path.join(dir, "public"));
    assert.deepEqual(assets, [glaze, font, logo].sort());

    // Replacing an asset's bytes changes the digest — a new logo re-renders.
    const set = sourceSet([entry], [], path.join(dir, "public"));
    const d0 = sourceSetDigest(set, {});
    write("public/logo-mark.png", "L2");
    assert.notEqual(sourceSetDigest(set, {}), d0);
  });

  it("hashes the env the code reads, and DEMO_GL always", () => {
    const { dir, write } = fixture();
    const entry = write(
      "src/Root.tsx",
      `const b = process.env.DEMO_BACKDROP;\nconst p = process.env["DEMO_PRESET"];\n`,
    );
    assert.deepEqual(referencedEnv([entry]), ["DEMO_BACKDROP", "DEMO_PRESET"]);
    const set = sourceSet([entry], [], path.join(dir, "public"));
    assert.ok(set.env.includes("DEMO_GL"));
    assert.notEqual(
      sourceSetDigest(set, { DEMO_BACKDROP: "glaze" }),
      sourceSetDigest(set, { DEMO_BACKDROP: "ink" }),
    );
    assert.notEqual(sourceSetDigest(set, {}), sourceSetDigest(set, { DEMO_GL: "swiftshader" }));
  });

  it("hashes a leaf's code and env but not its assets", () => {
    // src/Root.tsx names `shots/${name}.png`; walking its assets would tie
    // every reel cache to every still.
    const { dir, write } = fixture();
    const entry = write("src/Clip.tsx", `export {};\n`);
    const root = write("src/Root.tsx", "const s = (n: string) => `shots/${n}.png`;\nprocess.env.DEMO_SPEED;\n");
    write("public/shots/a.png", "S");
    const set = sourceSet([entry], [root], path.join(dir, "public"));
    assert.ok(set.code.includes(root));
    assert.deepEqual(set.assets, []);
    assert.ok(set.env.includes("DEMO_SPEED"));
  });
});

describe("the real composition source sets", () => {
  it("reach every style preset through the style.ts re-export", () => {
    // style.ts became a re-export file over src/lib/style/**. A walker that
    // stopped at `export * from` would miss every preset, and retuning one
    // would serve stale cached cards AND clips.
    const root = path.resolve(import.meta.dirname, "..", "..");
    const presets = fs
      .readdirSync(path.join(root, "src/lib/style/presets"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(root, "src/lib/style/presets", f));
    assert.ok(presets.length > 0);
    for (const entry of ["src/Intro.tsx", "src/DemoClip.tsx"]) {
      const code = sourceSet([path.join(root, entry)]).code;
      for (const p of presets) assert.ok(code.includes(p), `${entry} misses ${path.relative(root, p)}`);
      assert.ok(code.includes(path.join(root, "src/lib/style/sequence.ts")), `${entry} misses sequence.ts`);
    }
  });
});

describe("what the render command reads (review 2)", () => {
  it("hashes the render-flag sources, even though no composition imports them", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    for (const f of ["scripts/lib/remotion.ts", "scripts/lib/encode.ts"])
      assert.ok(LEAVES.includes(f), `${f} is a leaf`);
    const set = sourceSet(
      [path.join(root, "src/Intro.tsx")],
      LEAVES.map((f) => path.join(root, f)),
    );
    assert.ok(set.code.includes(path.join(root, "scripts/lib/remotion.ts")));
    assert.ok(set.code.includes(path.join(root, "scripts/lib/encode.ts")));
  });

  it("hashes a value that only .env provides", () => {
    // `pnpm reel` never loads .env into process.env, but the Remotion CLI
    // hands it to the bundle — so a .env edit changes pixels.
    const { dir, write } = fixture();
    const entry = write("src/Root.tsx", `const b = process.env.DEMO_BACKDROP;\n`);
    const set = sourceSet([entry], [], path.join(dir, "public"));
    const envFile = write(".env", "DEMO_BACKDROP=glaze\n");
    assert.deepEqual(dotenvValues(envFile), { DEMO_BACKDROP: "glaze" });
    assert.notEqual(
      sourceSetDigest(set, {}, dotenvValues(envFile)),
      sourceSetDigest(set, {}, { DEMO_BACKDROP: "ink" }),
    );
    assert.deepEqual(dotenvValues(path.join(dir, "missing.env")), {});
  });
});
