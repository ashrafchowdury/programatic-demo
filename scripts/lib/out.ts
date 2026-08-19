/**
 * Where each feature's output goes.
 *
 * This repo produces three DIFFERENT things, and they used to land in one flat
 * `out/` with the suffix as the only clue — `<name>.mp4`, `<name>.reel.mp4`,
 * `<name>.intro.mp4`, `shots/<name>-wide.png`. That is fine once you know it and
 * a trap when you do not: `out/agent-skill.mp4` and `out/agent-skill.reel.mp4`
 * are a demo and a film built FROM that demo, which is not a thing a filename
 * says. An agent reading the directory had to infer the pipeline it was in.
 *
 * So the feature is a directory, and it is the first thing you see:
 *
 *   out/demo/<name>.mp4          one recorded flow, camera from the click log
 *   out/reel/<name>.mp4          cards + clips cut into a launch film
 *   out/reel/<name>.intro.mp4    a title card alone (the reel's raw material)
 *   out/reel/<name>.full.mp4     one card concatenated onto one demo
 *   out/still/<name>-<preset>.png   one region of the app, framed, 4K
 *
 * Going through `outPath` rather than joining "out" by hand is what keeps that
 * true: the Feature union means a script cannot quietly write into the wrong
 * feature's territory, and tsc says so at the call site.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The three things this repo makes. See AGENTS.md for what each one is for. */
export type Feature = "demo" | "reel" | "still";

export const FEATURES: readonly Feature[] = ["demo", "reel", "still"];

/** Absolute path inside one feature's output directory. Creates the directory. */
export function outPath(feature: Feature, ...parts: string[]): string {
  const dir = path.join(ROOT, "out", feature);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, ...parts);
}

/** The same path without creating anything — for existence checks and messages. */
export const outPathOf = (feature: Feature, ...parts: string[]): string =>
  path.join(ROOT, "out", feature, ...parts);

/** `out/demo/smoke.mp4`, for logging. Always POSIX-ish and repo-relative. */
export const outRel = (abs: string): string => path.relative(ROOT, abs);
