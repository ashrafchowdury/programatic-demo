/**
 * Choreography styles — the registry of motion grammars a reel can be cut in.
 *
 * A style is a NAMED PRESET that decides both the look and the motion. One field
 * on a reel picks it; the same footage cut in two styles is two different films.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: A PRESET IS DATA. NO CODE BRANCHES ON A STYLE'S NAME.
 *
 * `introTiming`, `Intro.tsx`, `DemoClip.tsx` and `RecapCard.tsx` read FIELDS off
 * the resolved preset. Adding a film is one override file plus one name — see
 * "Adding a style" in ./style/registry.ts. If a component has to change to
 * support a new film, the preset is missing a field, and adding the field is the
 * fix. Writing `if (style === "...")` anywhere is the failure mode this module
 * exists to prevent, because it is how the second grammar becomes unaddable.
 *
 * Where a grammar genuinely does something structurally different — framed cards
 * ramp a scale, full-bleed cards travel on a push envelope — the difference is
 * carried by a DISCRIMINATED UNION (`kind`), so the component still dispatches on
 * data. `kind` is a property of the motion, not of the style; two styles may
 * share one.
 * ---------------------------------------------------------------------------
 *
 * LAYOUT
 *
 *   style/types.ts            every field, and what it means
 *   style/base.ts             BASE — the house grammar (Film A) every style
 *                             overrides, with the measurements behind it
 *   style/presets/*.ts        one file per style: ONLY its departures from BASE
 *   style/registry.ts         STYLE_PRESETS, DEFAULT_STYLE, resolution
 *   style/sequence.ts         film-level choreography: exits and continuity
 *   style/reference-films.ts  every film measured, built or not (tests only)
 *
 * This file is the import path, and it stays a file: every consumer imports
 * `./lib/style`, and scripts/reel.ts hashes this path into its segment cache.
 *
 * Sits below intro.ts and reel.ts, for the same reason src/lib/look.ts does:
 * reel.ts already imports intro.ts, so anything both must name has to live under
 * both. It may import only leaves — ./look and ./push for types. It must NEVER
 * import intro.ts: this module owns the numbers, and intro.ts reads them.
 *
 * See docs/reel/design/choreography-styles.md for the full spec, and
 * docs/reel/<film>/ for the measurements each preset is derived from.
 */
export * from "./style/types";
export { BASE, FONT_STACK_LEGACY, INTER_STACK } from "./style/base";
export {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  isStyle,
  mergePreset,
  resolveStyle,
  resolveStylePreset,
  styleProblem,
} from "./style/registry";
export {
  applySequence,
  planSequence,
  type SegmentMoves,
  type SequenceSegment,
} from "./style/sequence";
