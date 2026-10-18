/**
 * Brief + click log + house -> Reel. The editing rules, applied once, in code.
 *
 *   1. title card (title + wordmark)
 *   2. per beat: its card, then one clip of it
 *   3. with a payoff: its card with the chip, then one clip of the chip's action
 *   4. sign-off card (signoff + wordmark)
 *
 * Clips are written as BEAT ANCHORS, never seconds: start on the `from` press
 * plus the house lead; end after the last label, on its typing end for a typing
 * beat and its press otherwise, plus the house tail. Three limits can pull an
 * end in, each still an anchor and each reported: the typing cap, the clip cap,
 * and the gap before the next clip. So a re-shoot that keeps the labels
 * compiles to the new beat times with no edit to the brief.
 *
 * Pure and deterministic: no clock, no disk, no environment. The same brief,
 * log and house give the same Reel, field for field.
 */
import { resolveLabel, briefLabels, type Brief, type BriefLabel, type Problem } from "./brief";
import { FPS, logMsToDemoS, type ClickLog } from "./click-log";
import { demoDurationInFrames, demoGeometry } from "./demo-duration";
import { brandProblems } from "./brand-audit";
import { brandColor, resolveBrand } from "./brand";
import { isOneTake, type House } from "./house";
import type { IntroStoryboard } from "./intro";
import {
  beatDemoS,
  defineReel,
  overlapJoins,
  pacing,
  reelProblem,
  resolveReel,
  segmentFrameCounts,
  segmentJoins,
  type ClipAnchors,
  type Reel,
  type ReelClickLog,
  type ReelSegment,
  type ReelSegmentInput,
  type ReelSfx,
  type ResolvedReel,
} from "./reel";
import { cueHits } from "./reel-audio";
import { applySequence, resolveStyle, STYLE_PRESETS } from "./style";

/** A clip end a house limit moved, said once per clip. */
export type CapNote = { path: string; cap: "typing" | "clip" | "gap"; cutS: number; message: string };

export type Compiled = {
  reel: Reel;
  /** The brief field each segment came from, by segment index. */
  sources: string[];
  notes: CapNote[];
  /** Predicted length of the film, in seconds. */
  runtimeS: number;
};

type Beat = { event: ClickLog["clicks"][number]; anchor: string; label: string };

const s2 = (x: number) => x.toFixed(2);

/** The anchor findBeat reads back to exactly this log beat: the label, plus `#n` when it repeats. */
function anchorFor(index: number, labels: readonly BriefLabel[]): string {
  const want = labels[index].label.toLowerCase();
  const same = labels.flatMap((l, i) => (l.label.toLowerCase() === want ? [i] : []));
  return same.length > 1 ? `${labels[index].label}#${same.indexOf(index) + 1}` : labels[index].label;
}

/**
 * Compile a valid brief against its demo's click log, under `house`.
 *
 * `chip` is the payoff pill's text: the chip label's declared control
 * (chipText in ./brief), passed by a caller that holds the action catalog.
 * Absent, a demo brief's `payoff.text` is used. The pill never reads the label.
 */
export function compileBrief(
  brief: Brief,
  log: ClickLog,
  house: House,
  chip?: string | null,
): Compiled | { problems: Problem[] } {
  const speed = house.shoot.speed;
  const labels = briefLabels({ log }, { surfaces: new Map(), actions: new Map() }, speed);
  const labelled = log.clicks.filter((c) => c.label);
  const problems: Problem[] = [];
  const beatAt = (ref: string, path: string): Beat | null => {
    const hit = resolveLabel(ref, labels);
    if ("problem" in hit) {
      problems.push({ path, message: `${hit.problem} (in the click log)` });
      return null;
    }
    return { event: labelled[hit.index], anchor: anchorFor(hit.index, labels), label: labels[hit.index].label };
  };
  const press = (b: Beat) => beatDemoS(b.event, log, speed);

  if (isOneTake(house)) {
    if (!labels.length) return { problems: [{ path: brief.footage ? "footage" : "demo", message: "the click log has no labelled actions, so there is no take to show" }] };
    // The take's runs: from the first action, ending after each cut and
    // resuming on the action after it, or on the first action of the
    // recording the cut switches to (BriefCut.demo).
    const runs: Run[] = [];
    let rec: Recording = { log, labels, labelled };
    let from = 0;
    const cut = (brief.cuts ?? []).map((c) => (typeof c === "string" ? { after: c } : c));
    for (let i = 0; i <= cut.length; i++) {
      let end = rec.labels.length - 1;
      if (i < cut.length) {
        const hit = resolveLabel(cut[i].after, rec.labels);
        if ("problem" in hit) {
          problems.push({ path: `cuts[${i}]`, message: hit.problem });
          break;
        }
        end = hit.index;
      }
      const at = (k: number): Beat => ({ event: rec.labelled[k], anchor: anchorFor(k, rec.labels), label: rec.labels[k].label });
      runs.push({
        first: at(from),
        last: at(end),
        ...(rec.demo ? { demo: rec.demo, log: rec.log } : {}),
        ...(i > 0 && cut[i - 1].line ? { line: cut[i - 1].line } : {}),
        ...(i < cut.length && cut[i].tailS !== undefined ? { tailS: cut[i].tailS } : {}),
      });
      if (i === cut.length) break;
      const next = cut[i].demo;
      if (next !== undefined) {
        const own = (log as ReelClickLog).scenes?.(next);
        if (!own) {
          problems.push({ path: `cuts[${i}].demo`, message: `"${next}" has no click log: record and convert it first` });
          break;
        }
        const ownLabels = briefLabels({ log: own }, { surfaces: new Map(), actions: new Map() }, speed);
        rec = { log: own, labels: ownLabels, labelled: own.clicks.filter((c) => c.label), demo: next };
        from = 0;
      } else from = end + 1;
      if (from >= rec.labels.length) {
        problems.push({ path: `cuts[${i}]`, message: `leaves nothing to resume to` });
        break;
      }
    }
    if (problems.length || !runs.length) return { problems };
    return oneTake(brief, log, house, runs);
  }

  type Plan = { path: string; from: Beat; last: Beat; payoff: boolean; label: string };
  const plans: Plan[] = [];
  brief.beats!.forEach((beat, i) => {
    const path = `beats[${i}].show`;
    const from = beatAt(beat.show.from, `${path}.from`);
    const last = beat.show.to !== undefined ? beatAt(beat.show.to, `${path}.to`) : from;
    if (from && last)
      plans.push({ path, from, last, payoff: false, label: beat.show.to ? `${beat.show.from} → ${beat.show.to}` : beat.show.from });
  });
  const pill = chip ?? brief.payoff?.text;
  if (brief.payoff) {
    const at = beatAt(brief.payoff.chip, "payoff.chip");
    if (at) plans.push({ path: "payoff.chip", from: at, last: at, payoff: true, label: brief.payoff.chip });
    if (!pill)
      problems.push({
        path: "payoff.chip",
        message: "has no control text for the pill: declare one on the action's label, or give `payoff.text` on a demo brief",
      });
  }
  if (problems.length) return { problems };

  const { cut } = house;
  const notes: CapNote[] = [];
  const clips: ClipAnchors[] = plans.map((plan, i) => {
    const startS = press(plan.from) + cut.leadS;
    const typeEnd = plan.last.event.typeEndMs;
    const types = typeEnd !== undefined && !plan.payoff;
    let end: { anchor: ClipAnchors; s: number } = plan.payoff
      ? { anchor: { toBeat: plan.last.anchor, tailS: cut.payoffTailS }, s: press(plan.last) + cut.payoffTailS }
      : types
        ? {
            anchor: { toBeat: plan.last.anchor, toEdge: "typeEnd", tailS: cut.typingTailS },
            s: logMsToDemoS(typeEnd, log, speed) + cut.typingTailS,
          }
        : { anchor: { toBeat: plan.last.anchor, tailS: cut.tailS }, s: press(plan.last) + cut.tailS };
    const limit = (cap: CapNote["cap"], s: number, anchor: ClipAnchors, why: string) => {
      if (end.s <= s + 1e-9) return;
      notes.push({ path: plan.path, cap, cutS: end.s - s, message: `${why}; ${s2(end.s - s)}s cut` });
      end = { anchor, s };
    };
    if (types) {
      const capS = press(plan.last) + cut.typingCapS;
      limit("typing", capS, { toBeat: plan.last.anchor, tailS: cut.typingCapS }, `typing held to the ${cut.typingCapS}s typing cap`);
    }
    limit("clip", startS + cut.clipCapS, { toBeat: plan.from.anchor, tailS: cut.leadS + cut.clipCapS }, `clip held to the ${cut.clipCapS}s clip cap`);
    const next = plans[i + 1];
    if (next) {
      const nextStart = press(next.from) + cut.leadS;
      limit("gap", nextStart - cut.gapS, { toBeat: next.from.anchor, tailS: cut.leadS - cut.gapS }, `pulled in ${cut.gapS}s before the next clip`);
      if (end.s <= startS + 1 / FPS)
        problems.push({
          path: next.path,
          message: `${plan.path} and ${next.path} compile to overlapping clips: the next one starts at ${s2(nextStart)}s, before this one (from ${s2(startS)}s) can show anything. Give the earlier beat a later label, or merge the two`,
        });
    }
    if (startS < 0)
      problems.push({ path: `${plan.path}.from`, message: `starts ${s2(-startS)}s before the demo does; pick a later label` });
    return {
      fromBeat: plan.from.anchor,
      leadS: cut.leadS,
      ...end.anchor,
      ...(cut.drift !== null ? { drift: cut.drift } : {}),
    };
  });
  if (problems.length) return { problems };

  const { tone, wordmark, chipTone } = house.brand;
  const demo = brief.demo ?? brief.name;
  const hold = (kind: keyof House["holds"]) => (house.holds[kind] !== undefined ? { holdS: house.holds[kind] } : {});
  const card = (c: Omit<IntroStoryboard, "name">): ReelSegmentInput => ({ card: { name: demo, ...c } });

  const segments: ReelSegmentInput[] = [card({ headline: brief.title, wordmark, background: tone.card, ...hold("title") })];
  const sources = ["title"];
  plans.forEach((plan, i) => {
    if (plan.payoff) {
      segments.push(
        card({
          headline: brief.payoff!.card,
          chip: { label: pill!, tone: chipTone },
          background: tone.card,
          ...hold("payoff"),
        }),
      );
      sources.push("payoff.card");
      segments.push({
        clip: { ...clips[i], label: plan.label, open: { scale: cut.openScale, at: plan.from.anchor } },
      });
    } else {
      const beat = Number(/\d+/.exec(plan.path)![0]);
      segments.push(card({ headline: brief.beats![beat].card, background: tone.card, ...hold("beat") }));
      sources.push(`beats[${beat}].card`);
      segments.push({ clip: { ...clips[i], label: plan.label } });
    }
    sources.push(plan.path);
  });
  segments.push(card({ headline: brief.signoff!, wordmark, background: tone.signoff, ...hold("signoff") }));
  sources.push("signoff");

  const payoff = plans.find((p) => p.payoff);
  const finale = payoff ?? plans[plans.length - 1];
  return finish(brief, log, house, segments, sources, notes, finale.last.label);
}

/**
 * One take: the title, the whole interaction as one clip, the outro lines, the
 * logo. The clip starts on the first action's press plus the house lead and
 * ends after the last action (its typing end when it types) plus the payoff
 * tail, which is the camera's pull-back. The beat caps do not apply: the whole
 * take is the point, and `maxLengthS` is the guard.
 */
/**
 * Where a wide one-take starts, in demo seconds: just past the footage's first
 * frame, which @remotion/media decodes as its magenta placeholder.
 */
const WIDE_FROM_S = 0.05;

/** One uncut stretch of a one-take: its first and last labelled actions. */
type Run = {
  first: Beat;
  last: Beat;
  /** Cut from this recording (ClipFields.demo) rather than the brief's, with its log. */
  demo?: string;
  log?: ClickLog;
  /** A message card before this run (BriefCut.line). */
  line?: string;
  /** Seconds past its last action before the cut (BriefCut.tailS). */
  tailS?: number;
};

/** A recording a one-take's runs read: its log and labelled actions. */
type Recording = {
  log: ClickLog;
  labels: BriefLabel[];
  labelled: ClickLog["clicks"];
  demo?: string;
};

/**
 * How long before the cursor leaves for a resumed run's first action its clip
 * starts, in demo seconds: the new scene, settled and wide, before the camera
 * moves into it.
 */
const RESUME_BEFORE_DEPART_S = 0.8;
/** The least a resumed run may open before its first press, in demo seconds. */
const MIN_RESUME_LEAD_S = 0.3;

function oneTake(
  brief: Brief,
  log: ClickLog,
  house: House,
  runs: Run[],
): Compiled | { problems: Problem[] } {
  const { cut } = house;
  const { tone, wordmark } = house.brand;
  const speed = house.shoot.speed;
  const demo = brief.demo ?? brief.name;
  const card = (c: Omit<IntroStoryboard, "name">): ReelSegmentInput => ({ card: { name: demo, ...c } });
  const problems: Problem[] = [];
  let prevEndS = -Infinity;
  let prevDemo: string | undefined;
  const clips: ReelSegmentInput[] = [];
  const sources: string[] = ["title"];
  runs.forEach(({ first, last, demo: runDemo, log: runLog = log, line, tailS: cutTailS }, i) => {
    if (line !== undefined) {
      clips.push(card({ headline: line, background: tone.card }));
      sources.push(`cuts[${i - 1}].line`);
    }
    const types = last.event.typeEndMs !== undefined;
    const press = beatDemoS(first.event, runLog, speed);
    const departS = first.event.tDepartMs !== undefined ? beatDemoS({ tMs: first.event.tDepartMs }, runLog, speed) : null;
    // The first run opens wide (back to the footage's start) or on the house's
    // lead; a run after a cut opens on its scene just before the cursor moves,
    // and, in the same recording, never before the previous run has ended.
    let leadS =
      i > 0
        ? departS !== null
          ? departS - RESUME_BEFORE_DEPART_S - press
          : cut.leadS - RESUME_BEFORE_DEPART_S
        : house.opening === "wide"
          ? WIDE_FROM_S - press
          : cut.leadS;
    if (i > 0 && runDemo === prevDemo) {
      leadS = Math.max(leadS, prevEndS + cut.gapS - press);
      if (leadS > -MIN_RESUME_LEAD_S)
        problems.push({
          path: `cuts[${i - 1}]`,
          message: `"${first.label}" follows "${runs[i - 1].last.label}" too closely to cut between them: nothing lies between to skip. Cut after a later action, or leave the take uncut`,
        });
    }
    // Never before its own recording starts.
    leadS = Math.max(leadS, WIDE_FROM_S - press);
    const final = i === runs.length - 1;
    const tailS = cutTailS ?? (final ? cut.payoffTailS : types ? cut.typingTailS : cut.tailS);
    prevEndS = (types ? logMsToDemoS(last.event.typeEndMs!, runLog, speed) : beatDemoS(last.event, runLog, speed)) + tailS;
    prevDemo = runDemo;
    const clip: ClipAnchors = {
      fromBeat: first.anchor,
      leadS,
      toBeat: last.anchor,
      ...(types ? { toEdge: "typeEnd" as const } : {}),
      tailS,
      ...(cut.drift !== null ? { drift: cut.drift } : {}),
    };
    clips.push({ clip: { ...clip, ...(runDemo ? { demo: runDemo } : {}), label: `${first.label} → ${last.label}` } });
    sources.push(runs.length > 1 ? `footage[${i}]` : "footage");
  });
  if (problems.length) return { problems };
  const segments: ReelSegmentInput[] = [
    card({ headline: brief.title, wordmark, background: tone.card, ...(house.poster ? { poster: true } : {}) }),
    ...clips,
    ...brief.outro!.map((line) => card({ headline: line, background: tone.card })),
    card({ headline: wordmark, logo: true, background: tone.signoff }),
  ];
  sources.push(...brief.outro!.map((_, i) => `outro[${i}]`), "logo");
  return finish(brief, log, house, segments, sources, [], runs[runs.length - 1].last.label);
}

/** Audio, length and the reel check: the same for every shape. */
function finish(
  brief: Brief,
  log: ClickLog,
  house: House,
  segments: ReelSegmentInput[],
  sources: string[],
  notes: CapNote[],
  confirmLabel: string,
): Compiled | { problems: Problem[] } {
  const speed = house.shoot.speed;
  const { audio } = house.brand;
  const demo = brief.demo ?? brief.name;
  const base = defineReel({
    name: brief.name,
    demo,
    style: house.style,
    ...(house.pack ? { brand: house.pack } : {}),
    ...(house.pack && house.window
      ? {
          window: {
            ground: brandColor(resolveBrand(house.pack), house.window.ground),
            camera: house.window.camera,
          },
        }
      : {}),
    ...(house.render
      ? { render: { scale: house.render.scale, motionBlur: house.render.motionBlur } }
      : {}),
    aspect: house.aspects[0],
    segments,
  });

  // Where the film's time goes, as the cut will measure it: needed for the bed
  // length and for the SFX that actually land in a clip.
  const resolved = resolveReel(base, log, speed);
  if ("problem" in resolved) return { problems: [mapProblem(resolved.problem, sources)] };
  const timed = timeline(resolved.reel);
  const sequenced = timed.segments;
  const runtimeS = Number(timed.runtimeS.toFixed(4));
  if (runtimeS > house.maxLengthS + 1e-6)
    return {
      problems: [
        {
          path: isOneTake(house) ? "footage" : "",
          message: `the reel runs ${s2(runtimeS)}s, past ${house.id}'s ${house.maxLengthS}s maximum. Shorten the take or its pauses`,
        },
      ],
    };

  const sfx: ReelSfx = {};
  for (const kind of ["click", "typing", "pop"] as const)
    if (cueHits(sequenced, log, speed, kind).length) sfx[kind] = { ...audio.sfx[kind] };
  sfx.confirm = { ...audio.sfx.confirm, atLabels: [confirmLabel] };

  const reel: Reel = {
    ...base,
    audio: [
      {
        src: audio.bed.src,
        trim: { fromS: 0, toS: runtimeS },
        start: 0,
        duration: runtimeS,
        gain: audio.bed.gain,
        fadeInS: audio.bed.fadeInS,
        fadeOutS: audio.bed.fadeOutS,
        role: "bed",
      },
    ],
    sfx,
    duck: audio.duck,
    loudnessLUFS: audio.loudnessLUFS,
  };

  const total = demoDurationInFrames(log, speed, demoGeometry(log), FPS);
  const scenes = (log as ReelClickLog).scenes;
  const totalOf = (demo: string): number | undefined => {
    const own = demo === (brief.demo ?? brief.name) ? log : scenes?.(demo);
    return own ? demoDurationInFrames(own, speed, demoGeometry(own), FPS) : undefined;
  };
  const bad = reelProblem(resolveReelOrThrow(reel, log, speed), scenes ? totalOf : total);
  if (bad) return { problems: [mapProblem(bad, sources)] };
  // The brand audit's static half, before anything renders: a colour, face or
  // logo outside the pack is named against the brief field that produced it.
  if (house.pack) {
    const off = brandProblems(reel, resolveBrand(house.pack));
    if (off.length)
      return {
        problems: off.map((p) => {
          const m = /^segments\[(\d+)\]/.exec(p.path);
          return { path: m ? (sources[Number(m[1])] ?? p.path) : p.path, message: `off brand: ${p.message}` };
        }),
      };
  }
  return { reel, sources, notes, runtimeS };
}

/**
 * A resolved reel's segments as its style sequences them, and the film's
 * length: what the cut will measure, before anything renders.
 */
export function timeline(reel: ResolvedReel): { segments: ReelSegment[]; runtimeS: number } {
  const preset = STYLE_PRESETS[resolveStyle(reel)];
  const segments = applySequence(reel.segments, preset);
  const counts = segmentFrameCounts({ ...reel, segments }, FPS);
  const { joins } = overlapJoins(segments, segmentJoins(segments, preset.join), preset);
  return { segments, runtimeS: pacing(segments, counts, joins, FPS).runtimeS };
}

function resolveReelOrThrow(reel: Reel, log: ClickLog, speed: number) {
  const r = resolveReel(reel, log, speed);
  if ("problem" in r) throw new Error(r.problem);
  return r.reel;
}

/** "segment 4 (clip) ..." -> the brief field segment 4 came from. */
export function mapProblem(problem: string, sources: readonly string[]): Problem {
  const m = /^segment (\d+)/.exec(problem);
  const path = m ? (sources[Number(m[1]) - 1] ?? "") : "";
  return { path, message: `the compiled reel fails the reel check: ${problem}` };
}
