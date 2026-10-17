/**
 * ONE-TAKE — the whole interaction as one uncut shot, framed in the window with
 * the click-driven camera, between a title card and a closing card.
 *
 * Not measured off a film, so `source` and `targets` stay null, as classic's
 * do. It is a COMPOSITION of grammars already measured here:
 *
 *   - the shot is classic's: a floating window whose camera moves in on every
 *     click and back out, with the pointer drawn. That is the whole point of
 *     an uncut take: with nothing cut, the camera is the only thing directing
 *     the eye.
 *   - the window sits on a FLAT ground, as stage's does, not on the
 *     photographic plate: a brand pack decides that ground's colour, and a
 *     photograph is not a colour a brand can set.
 *   - cards hold still and cut, with no ramp: there are only two or three of
 *     them, so they are titles, not a rhythm.
 *
 * The shape (title, one clip, outro, logo) is NOT this file's business: a style
 * decides how a film moves, a house's `shape` decides what goes in it.
 */
import { INTER_STACK } from "../base";
import type { StyleOverride } from "../types";

/** Brand-neutral cream: a pack replaces it. Sits one step off white for encoder headroom. */
const GROUND = "#f6f5f3";
const INK = "#1e1c1d";

export const oneTake: StyleOverride = {
  look: "framed",
  // The camera moves the shot; cards are static.
  motionLayer: "shots",
  card: {
    // Flat ground; see the palette below.
    background: "light",
    // classic's measured stagger: one word every 0.16s, no fade.
    cadence: { kind: "fixed", staggerS: 0.16, fadeS: 0 },
    length: {
      // classic's hold. A title card here is read once, then the take runs
      // for twenty seconds, so it can afford the longer read.
      holdS: 1.2,
      holdFrom: "settled",
      minS: null,
      maxS: null,
      trimInS: 0,
    },
    enter: { kind: "none" },
    exit: { kind: "none" },
    emphasis: true,
  },
  shot: {
    framing: "window",
    // classic's fit: room around the window for the camera's pull-back to read.
    windowFit: 0.86,
    ground: GROUND,
    zoom: true,
    cursor: true,
    // The product's own press states are the feedback, as in the references.
    ripple: false,
    enter: { kind: "none" },
    exit: { kind: "none" },
  },
  type: {
    sizePx: 82,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    fontFamily: INTER_STACK,
  },
  // One flat cream for every role but the dark one, which a pack maps to its
  // dark ground. Without a pack, `plain` is the near-black every other style
  // uses for its dark card.
  palette: {
    plate: { ground: GROUND, ink: INK, muted: "rgba(30,28,29,0.58)" },
    plain: {
      ground: "#181010",
      ink: "#f6f5f3",
      muted: "rgba(246,245,243,0.62)",
    },
    light: {
      ground: GROUND,
      ink: INK,
      muted: "rgba(30,28,29,0.58)",
      chip: { fill: "#1e1c1d", label: "#f6f5f3", rim: "rgba(30,28,29,0.14)" },
      highlight: { fill: "#f2f25c", ink: INK },
    },
  },
  bookend: { turns: 0, letterSpacing: "-0.01em", minS: null },
  sequence: { exitCycle: [], continuity: null },
  source: null,
  targets: null,
};
