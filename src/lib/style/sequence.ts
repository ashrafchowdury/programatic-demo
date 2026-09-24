/**
 * SEQUENCE CHOREOGRAPHY — the style decides how each segment arrives and
 * leaves, given its place in the film.
 *
 * Before this, a style gave every card the same exit, and the rhythm the
 * references have — card exits that vary, shots that pick up the direction the
 * last one was travelling — had to be authored by hand on every segment of
 * every reel (reels/harness.ts sets `enter` and `exit` on all nine). Now it is
 * two fields on the preset (`sequence`, see SequenceStyle) and one pure pass
 * over the segment list. An authored move ALWAYS wins; this only fills gaps.
 *
 * Structural types only, so this module stays below src/lib/reel.ts: a
 * ReelSegment is assignable to SequenceSegment as it stands.
 */
import type { PushAxis, PushMove, PushSpec } from "../push";
import type { ShotMove, StylePreset } from "./types";

/** A card's move as authored — `dist` and `frames` may fall back to the style's. */
type CardMove = { axis: PushAxis; dist?: number; frames?: number };

/** A reel segment, as far as sequencing is concerned. */
export type SequenceSegment =
  | {
      card: {
        enter?: CardMove;
        exit?: CardMove;
        items?: readonly string[];
        chip?: unknown;
      };
    }
  | { clip: { push?: PushSpec; freeze?: boolean } };

/** What the style assigns one segment. Only fields the segment left unset. */
export type SegmentMoves = { enter?: PushMove; exit?: PushMove };

const STILL: PushMove = { axis: "none", dist: 0, frames: 0 };

const asPush = (m: ShotMove): PushMove | undefined =>
  m.kind === "push"
    ? { axis: m.axis, dist: m.dist, frames: m.frames }
    : undefined;

const isCardSeg = (
  s: SequenceSegment,
): s is Extract<SequenceSegment, { card: unknown }> => "card" in s;

/**
 * Does this card travel on the push envelope at all?
 *
 * A recap card (src/RecapCard.tsx) and a chip card (the punch IS its exit)
 * render without it, so a move assigned to either would be ignored — and worse,
 * the segment after it would continue a move that never happened.
 */
const travels = (card: {
  items?: readonly string[];
  chip?: unknown;
}): boolean => !card.items?.length && card.chip === undefined;

/** A move that actually displaces the picture, and so has a direction to hand on. */
const directional = (m: PushMove | undefined): m is PushMove =>
  m !== undefined && m.axis !== "none" && m.dist !== 0 && m.frames > 0;

/**
 * The moves the style assigns each segment, in order.
 *
 * 1. EXITS. The n-th travelling card leaves by `exitCycle[n % length]` unless
 *    it authors its own `exit`. The LAST segment of the film is assigned a
 *    still exit instead: the reference's closing bookend is the one shot in it
 *    that holds perfectly still into its end, because nothing follows it.
 *    Clips keep their own exit — an authored `push.out`, or the shot envelope a
 *    `shots`-layer style supplies.
 *
 * 2. ENTRANCES (direction continuity). A segment after a directional exit
 *    enters travelling the SAME way: a card leaving left (x < 0) hands over to
 *    a shot starting to the RIGHT of rest (x > 0) and moving left; leaving up
 *    hands over to one rising from below; shrinking away, to one settling
 *    from slightly large. Travel per axis is `continuity`. A frozen clip takes
 *    no move — a still that drifted would not be a still.
 *
 * Pure: reads the preset, never mutates the segments.
 */
export function planSequence(
  segments: readonly SequenceSegment[],
  preset: StylePreset,
): SegmentMoves[] {
  const { exitCycle, continuity } = preset.sequence;
  const styleCardExit = asPush(preset.card.exit);
  const shotsDefault = preset.motionLayer === "shots";
  const plan: SegmentMoves[] = segments.map(() => ({}));
  // Each segment's exit AS IT WILL RENDER, assigned or not — the input to the
  // next segment's entrance.
  const exits: (PushMove | undefined)[] = [];

  let nthCard = 0;
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (isCardSeg(seg)) {
      if (!travels(seg.card)) {
        exits.push(undefined);
        return;
      }
      const slot = nthCard++;
      const own = seg.card.exit;
      if (own) {
        exits.push({
          axis: own.axis,
          dist: own.dist ?? styleCardExit?.dist ?? 0,
          frames: own.frames ?? styleCardExit?.frames ?? 0,
        });
      } else if (exitCycle.length > 0) {
        const exit = last ? STILL : exitCycle[slot % exitCycle.length];
        plan[i].exit = { ...exit };
        exits.push(exit);
      } else exits.push(styleCardExit);
      return;
    }
    const { push, freeze } = seg.clip;
    exits.push(
      freeze
        ? undefined
        : (push?.out ??
            (!push && shotsDefault ? asPush(preset.shot.exit) : undefined)),
    );
  });

  if (!continuity) return plan;
  segments.forEach((seg, i) => {
    const prev = exits[i - 1];
    if (i === 0 || !directional(prev)) return;
    const own = isCardSeg(seg)
      ? travels(seg.card)
        ? seg.card.enter
        : STILL
      : seg.clip.freeze
        ? STILL
        : seg.clip.push?.in;
    if (own) return;
    const axis = prev.axis as keyof typeof continuity;
    const { dist, frames } = continuity[axis];
    // An entrance's `dist` is where the shot STARTS relative to rest; an
    // exit's is where it has got to. Opposite signs = the same direction.
    plan[i].enter = {
      axis: prev.axis,
      dist: -Math.sign(prev.dist) * dist,
      frames,
    };
  });
  return plan;
}

/**
 * planSequence, written onto copies of the segments in the shape a reel
 * already authors: `card.enter`/`card.exit`, and `clip.push`.
 *
 * A clip that gains an entrance keeps the exit it would have rendered with —
 * its own `push.out`, or the `shots`-layer envelope scripts/reel.ts would
 * otherwise have supplied — because setting `push` switches that default off.
 */
export function applySequence<T extends SequenceSegment>(
  segments: readonly T[],
  preset: StylePreset,
): T[] {
  const plan = planSequence(segments, preset);
  const shotsDefault = preset.motionLayer === "shots";
  return segments.map((seg, i) => {
    const { enter, exit } = plan[i];
    if (!enter && !exit) return seg;
    if (isCardSeg(seg))
      return {
        ...seg,
        card: {
          ...seg.card,
          ...(enter ? { enter } : {}),
          ...(exit ? { exit } : {}),
        },
      } as T;
    const push = seg.clip.push;
    const out =
      push?.out ??
      (!push && shotsDefault ? asPush(preset.shot.exit) : undefined);
    return {
      ...seg,
      clip: {
        ...seg.clip,
        push: { ...(enter ? { in: enter } : {}), ...(out ? { out } : {}) },
      },
    } as T;
  });
}
