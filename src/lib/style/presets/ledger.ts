/**
 * LEDGER — monid's grammar, WITH FILM B's MERGED INTO IT.
 *
 * ---------------------------------------------------------------------------
 * TWO REFERENCE FILMS, ONE PRESET, and that is a deliberate consolidation.
 *
 * This was two styles: `narration` (Cursor's origin film) and `ledger`
 * (monid). They measured **79% identical across 85 comparable fields** — the
 * next-closest pair in the registry is 18 points behind — because they share
 * a grammar: composited components on a flat ground, cards pixel-locked, the
 * SHOTS carrying the motion, no HUD, no chrome, and the same card timing.
 *
 * Only TWO of the eighteen differences were mechanism, and this preset keeps
 * monid's on both:
 *
 *   join        Film B CUTS;    here a 6-frame dissolve
 *   shot.enter  Film B pushes;  here the shot holds still
 *               scale -0.106 over 23f
 *
 * The rest were surface — type scale, face, palette, bookend floor. All of it
 * is recorded on the cursor_origin_intro entry in REFERENCE_FILMS, so
 * re-separating them is a data change rather than a re-measurement.
 *
 * ⚠️ THE COST IS REAL: Film B is no longer reproducible from this directory.
 * It is MEASURED and unimplemented, which is why its REFERENCE_FILMS entry
 * carries `style: null` alongside Uber's.
 * ---------------------------------------------------------------------------
 *
 * THE FILM THAT DOES NOT CUT. Named for its signature — a running cost counter
 * that survives every change of content. Two thirds of monid is ONE
 * 22.73-second take in which components swap in place; its only transitions
 * are two 6-frame dissolves. 6.9 cuts/min against Film B's 31.1, from the
 * same composited-component framing.
 *
 * WHY THE CARDS HOLD PERFECTLY STILL, which is the inherited half. The
 * defining measurement is an absence: docs/reel/cursor/02-motion.md §"cards do not
 * move at all" tracks Film B's shot 10 text box across 56 frames and finds
 * ZERO translation. Words appear in place; the box grows and never moves.
 * That is why `card.enter` and `card.exit` are `none` rather than a small
 * push, and it is monid's behaviour too.
 *
 * LENGTH FOLLOWS THE COPY, also inherited. Film A slots every card into
 * 3.2-3.3s and compresses its stagger to fit; Film B refuses, running 31-89f
 * as the words require. So the cadence is `fixed` and the clamps are null —
 * the observed 1.03-2.97s band is the CONSEQUENCE of this model, not an input
 * to it: one beat plus the hold is ~41f, ten beats plus the hold is ~83f,
 * against a measured 31-89f.
 *
 * NO CHIP OR RECAP OF ITS OWN. monid has no chip punch and no recap card, so
 * both are the base's; a ledger reel using either is off-reference. Film B's
 * punch timing is recorded on its REFERENCE_FILMS entry.
 *
 * Measured in docs/reel/design/choreography-references.md §3 and docs/reel/cursor/.
 */
import { INTER_STACK } from "../base";
import type { StyleOverride } from "../types";

export const ledger: StyleOverride = {
  motionLayer: "shots",
  // MEASURED: luma walks 228 -> 98 across six frames with no single-frame
  // jump. The only reference of the four that does not hard-cut.
  join: { kind: "dissolve", frames: 6 },
  // THE REFERENCE'S SIGNATURE, DELIBERATELY NOT TAKEN. monid's running counter
  // and step line are what buy it 22 seconds without a cut: the overlay carries
  // the continuity that cutting would otherwise supply, and hudSteps/HudOverlay
  // still implement exactly that, derived from the click log.
  //
  // It is off because it did not survive review on our footage. Numbered steps
  // imply a sequence with a knowable total, and ours are pruned from nine
  // presses down to five, so the line read as a debug counter over the picture
  // rather than as a summary of it. Without the overlay carrying continuity, a
  // ledger film has to cut more often than the reference does;
  // reels/agent-schedule.ts is cut on that assumption.
  //
  // Set this to `{ kind: "steps" }` to get the reference behaviour.
  hud: { kind: "none" },
  card: {
    // MEASURED on the reference as a 6-frame ink ramp, and NOT USED. A word at
    // half opacity over cream is a grey word, so with a 0.2s ramp on a 0.2s
    // stagger there was always exactly one half-drawn word on screen: every
    // card spent its whole reveal looking half-loaded rather than deliberate.
    // Words now arrive at full ink, one per stagger.
    cadence: { kind: "fixed", staggerS: 0.2, fadeS: 0 },
    length: {
      // ⧗ STRUCTURALLY UNMEASURABLE on this reference. A card tail is the gap
      // between the last word and the CUT — and monid does not cut between its
      // cards. Carried from Film B (cursor_origin_intro) as the nearest
      // measured grammar — which is also why the two presets were 79%
      // identical and could be merged at all. Closing this needs a reference
      // that cuts BETWEEN CARDS.
      holdS: 1.16,
      holdFrom: "lastWord",
      minS: null,
      maxS: null,
      trimInS: 0,
    },
    enter: { kind: "none" },
    exit: { kind: "none" },
  },
  shot: {
    framing: "isolate",
  },
  // MEASURED on monid's opening card: cap ~70px on a 181px line pitch — a pitch
  // 2.6x the cap, against Film A's 1.65x. That openness is what makes one of
  // its cards read as two separate statements.
  //
  // WE DO NOT USE 1.85, AND THIS IS THE ONE PLACE THE REFERENCE LOST. Our copy
  // is a single sentence that WRAPS, not two statements, so an open pitch put a
  // hole through the middle of a sentence and pushed the second line so far
  // down that the block stopped reading as one object. 1.24 is close on the
  // two-line cards this film actually has: cap unchanged at 70, pitch 98 * 1.24
  // = 121.5 against monid's 181.
  type: {
    sizePx: 98,
    lineHeight: 1.24,
    letterSpacing: "-0.01em",
    // THE FIRST STYLE WITH A FACE OF ITS OWN. Inter, vendored at public/fonts/
    // and loaded by src/lib/font.ts. The metrics above were measured off a film
    // set in a grotesque of this class; reproducing them in whatever system-ui
    // resolves to is why an earlier cut read as a default slide deck.
    fontFamily: INTER_STACK,
  },
  // MEASURED. Cream with a green cast, NOT white — rgb(247,251,243) — and one
  // saturated accent ground carrying the payoff. There is no third register:
  // monid says everything in two grounds, and so does this.
  //
  // THE ACCENT IS OURS, NOT THE REFERENCE'S. monid's payoff ground measures
  // #3255f6, and a blue borrowed from another company's film is a colour this
  // product does not own — on screen it read as a stock slide. The accent is
  // near-black carrying the Agenta mark's own chartreuse, sampled off the
  // rendered wordmark at #f0f05a. Same structural job as monid's blue.
  palette: {
    plate: {
      ground: "#0a0a0a",
      ink: "#f0f05a",
      muted: "rgba(240,240,90,0.62)",
    },
    plain: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
    light: { ground: "#f7fbf3", ink: "#0a0a0a", muted: "rgba(10,10,10,0.55)" },
  },
  bookend: {
    // ⧗ monid's sign-off is a static wordmark, not a tumble; the base's turn
    // is carried. Its LENGTH is MEASURED: f960-1038 = 79f = 2.63s.
    minS: 2.63,
  },
  // Cards that never move have no exit to cycle and no direction to continue.
  sequence: { exitCycle: [], continuity: null },
  // monid-claude-for-prospecting.mp4 — see REFERENCE_FILMS.
  source: { loudnessLUFS: -14.5 },
  targets: {
    meanShotS: 6.93,
    cutsPerMin: 6.9,
    movingFrac: 0.261,
    longestStillF: 77,
    cutDelta: "matched",
  },
};
