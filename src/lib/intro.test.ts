import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKGROUNDS,
  CHIP_TOKEN,
  compositionSize,
  defineIntro,
  fittedStagger,
  flooredEntry,
  HEADLINE_START_S,
  headlineParts,
  HOLD_S,
  introDurationInFrames,
  introLook,
  introProblem,
  introTiming,
  parseHeadline,
  plainHeadline,
  progressAt,
  punchEase,
  pushAt,
  readableInk,
  RECAP_ITEM_STAGGER_S,
  TRIM_IN_S,
  WORD_STAGGER_MIN_S,
  WORD_STAGGER_S,
  wordSchedule,
  wordsOf,
  type IntroStoryboard,
} from "./intro";
import { recapSchedule } from "../RecapCard";
import { DEFAULT_STYLE } from "./style";
import type { ClickLog } from "./click-log";

const CARD: IntroStoryboard = defineIntro({
  name: "smoke",
  headline: "Give your agent a new skill",
  subhead: "In under a minute.",
  wordmark: "Acme",
});

const logWith = (width: number, height: number): ClickLog => ({
  name: "fixture",
  viewport: { width, height },
  durationMs: 8000,
  clicks: [],
});

describe("wordsOf", () => {
  it("collapses whitespace so stray spaces cannot lengthen the card", () => {
    // A double space between words would otherwise become an empty stagger
    // unit: invisible on screen, but it pushes every later word back 90ms and
    // stretches the composition by a frame or three.
    assert.deepEqual(wordsOf("  Give  your   agent  "), [
      "Give",
      "your",
      "agent",
    ]);
    assert.deepEqual(wordsOf("   "), []);
  });
});

describe("wordSchedule", () => {
  it("staggers word starts by a fixed offset", () => {
    const cues = wordSchedule(CARD.headline);
    assert.equal(cues.length, 6);
    assert.equal(cues[0].startS, HEADLINE_START_S);
    for (let i = 1; i < cues.length; i++) {
      assert.ok(
        Math.abs(cues[i].startS - cues[i - 1].startS - WORD_STAGGER_S) < 1e-9,
        `word ${i} did not start one stagger after word ${i - 1}`,
      );
    }
  });

  it("lands every word before the still hold begins", () => {
    // The hold exists so the finished sentence sits still and gets read. If the
    // last word is still rising into it, the card has no still frame at all.
    const t = introTiming(CARD);
    for (const cue of t.words) {
      assert.ok(
        cue.endS <= t.settledS + 1e-9,
        `word "${cue.word}" was still animating at settle`,
      );
    }
  });
});

describe("introTiming", () => {
  it("ends on the hold, with no fade-out reserved", () => {
    // The card is cut while still on screen and still being pushed. Reserving a
    // fade would spend the last half-second arriving at a static, near-empty
    // frame and hand THAT to the next shot — measured as 4 of 9 cuts killing
    // motion dead, against 0 of 10 in the reference.
    const t = introTiming(CARD);
    const lastWordEnd = t.words[t.words.length - 1].endS;
    assert.equal(t.settledS, Math.max(lastWordEnd, t.subheadEndS));
    assert.equal(t.totalS, t.outStartS);
    assert.ok(t.outStartS > t.settledS, "the card never holds still");
  });

  it("puts a word on the very first frame, wordmark or not", () => {
    // A 0.35s lead-in meant the first frame of a card was an empty field. On an
    // interstitial that is a dead frame handed to a cut; on the card that opens
    // the film it is the first thing anyone sees. Both cases now start at zero,
    // and flooredEntry makes that first frame legible rather than transparent.
    //
    // Asserted as "not after zero" rather than "exactly zero", which is what
    // the rule actually means. Classic starts at 0; proof starts at -0.17
    // because its grammar cuts INTO the reveal, so a word is already out when
    // the card opens. Both satisfy "no empty first frame"; only one satisfies
    // `=== 0`, and pinning to that was asserting classic's arithmetic rather
    // than the rule.
    for (const style of ["classic", "proof"] as const)
      for (const intro of [
        { name: "x", headline: "Two words", style },
        { name: "x", headline: "Two words", wordmark: "A", style },
      ]) {
        assert.ok(
          introTiming(intro).words[0].startS <= 0,
          `${style} opens on an empty field`,
        );
      }
    assert.ok(flooredEntry(0) > 0.2, "the first frame is still transparent");
    assert.equal(flooredEntry(1), 1);
  });

  it("keeps pushing to the very last frame", () => {
    // Linear, so velocity is never zero — including on the frame the cut lands
    // on. An eased push would decelerate into a stop and put the freeze back.
    const t = introTiming(CARD);
    const a = pushAt(t.totalS - 1 / 30, t.settledS, t.totalS);
    const b = pushAt(t.totalS, t.settledS, t.totalS);
    assert.ok(b > a, "the push had stopped before the cut");
    assert.equal(pushAt(0, t.settledS, t.totalS), 1);
    // And it genuinely rests while the copy is being read.
    const mid = (t.settledS + Math.max(t.settledS, t.totalS - 0.35)) / 2;
    assert.equal(
      pushAt(mid, t.settledS, t.totalS),
      pushAt(t.settledS, t.settledS, t.totalS),
    );
  });

  it("honours a holdS override", () => {
    const slow = introTiming({ ...CARD, holdS: 3 });
    const fast = introTiming({ ...CARD, holdS: 0.2 });
    assert.ok(Math.abs(slow.totalS - fast.totalS - 2.8) < 1e-9);
  });

  it("ignores a subhead that is not there", () => {
    // subheadEndS must not push settledS out for a headline-only card.
    //
    // Clamped at zero, and that clamp is load-bearing under proof: its trim can
    // put a SHORT card's whole reveal before frame 0 — measured, a two-word
    // card's last word ends at -0.010s — and a card cannot be settled before it
    // starts. Comparing raw to `endS` was asserting classic's arithmetic.
    for (const style of ["classic", "proof"] as const) {
      const t = introTiming({ name: "x", headline: "Two words", style });
      assert.equal(t.subheadEndS, 0, style);
      assert.equal(
        t.settledS,
        Math.max(t.words[t.words.length - 1].endS, 0),
        style,
      );
    }
  });
});

describe("introDurationInFrames", () => {
  it("never returns a zero-frame composition", () => {
    // Studio has to open a half-written storyboard; a 0-frame composition is a
    // hard error there, not an empty card.
    assert.ok(introDurationInFrames({ name: "x", headline: "   " }, 30) >= 1);
    assert.ok(introDurationInFrames({ name: "x", headline: "" }, 30) >= 1);
  });

  it("rounds up so the last frame is never clipped", () => {
    const t = introTiming(CARD);
    assert.equal(introDurationInFrames(CARD, 30), Math.ceil(t.totalS * 30));
  });
});

describe("progressAt", () => {
  it("is clamped and monotone across the cue", () => {
    const cue = { startS: 1, endS: 2 };
    assert.equal(progressAt(cue, 0.5), 0);
    assert.equal(progressAt(cue, 2.5), 1);
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const p = progressAt(cue, 1 + i / 50);
      assert.ok(p >= prev, "progress went backwards");
      prev = p;
    }
    assert.equal(prev, 1);
  });

  it("does not divide by zero on a zero-length cue", () => {
    assert.equal(progressAt({ startS: 1, endS: 1 }, 0), 0);
    assert.equal(progressAt({ startS: 1, endS: 1 }, 1), 1);
  });
});

describe("compositionSize", () => {
  it("matches the DemoClip size for a non-16:9 recording", () => {
    // THE CONCAT CONTRACT. scripts/stitch.ts uses -c copy, which requires the
    // intro and the demo to agree on geometry exactly. This duplicates the
    // arithmetic in src/Root.tsx; if that block ever changes, this fails first.
    assert.deepEqual(compositionSize(logWith(1920, 1080)), {
      width: 2560,
      height: 1440,
    });
    assert.deepEqual(compositionSize(logWith(1440, 820)), {
      width: 2560,
      height: 1458,
    });
  });

  it("keeps both dimensions even, because h264 rejects odd ones", () => {
    for (let height = 800; height <= 900; height++) {
      const size = compositionSize(logWith(1440, height));
      assert.equal(size.width % 2, 0);
      assert.equal(size.height % 2, 0, `height ${height} produced an odd size`);
    }
  });
});

describe("introProblem", () => {
  it("accepts a well-formed storyboard", () => {
    assert.equal(introProblem(CARD), null);
    assert.equal(introProblem({ name: "x", headline: "One" }), null);
  });

  it("names what is wrong, since tsc never sees intros/*.ts", () => {
    // These files are dynamically imported and gitignored per account, so this
    // check is the only thing standing between a typo and a blank card several
    // minutes into a render.
    assert.match(introProblem(null) ?? "", /not an object/);
    assert.match(introProblem({ headline: "no name" }) ?? "", /name/);
    assert.match(introProblem({ name: "x", headline: "  " }) ?? "", /headline/);
    assert.match(
      introProblem({ name: "x", headline: "a", subhead: 3 }) ?? "",
      /subhead/,
    );
    assert.match(
      introProblem({ name: "x", headline: "a", holdS: -1 }) ?? "",
      /holdS/,
    );
  });
});

/**
 * Limited-range luma, the model ffprobe's signalstats reports against. It
 * predicts the dark ground at exactly the 23.0 we measured off the rendered
 * reel, which is why it is trustworthy enough to assert on.
 */
const lumaOf = (hex: string): number => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const full =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1];
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return 16 + (219 * (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
};

describe("introLook", () => {
  it("keys the wide column off flatness, not off one background name", () => {
    // The bug this replaces: the wide column was gated on `background ===
    // "plain"`, so a third flat mode silently inherited the narrow 0.52 plate
    // column — which exists only to keep white text off the plate's specular
    // band. On a flat field that costs a line break in the wrong place ("Say
    // when to / use it."), which reads as a typesetting accident, not a beat.
    assert.equal(introLook("light").columnFrac, introLook("plain").columnFrac);
    assert.notEqual(
      introLook("light").columnFrac,
      introLook("plate").columnFrac,
    );
    assert.equal(introLook("plate").flat, false);
    assert.equal(introLook("light").flat, true);
  });

  it("inverts ink with ground so no mode can render invisibly", () => {
    // A palette is coherent only if ground and ink move together. Adding a mode
    // and copying the dark mode's text colours puts near-white text on a
    // near-white card: it renders, it passes every other check, and the card is
    // blank.
    for (const bg of BACKGROUNDS) {
      const look = introLook(bg);
      const gap = Math.abs(lumaOf(look.ground) - lumaOf(look.headline));
      assert.ok(
        gap > 150,
        `${bg}: headline is only ${gap.toFixed(0)} luma from its ground`,
      );
    }
    // And the light mode has to be the bright one, near the top of the range.
    assert.ok(lumaOf(introLook("light").ground) > 225);
    // The chip is the card's LAST frame under a punch, so it has to sit on the
    // same side of the range as the ground or the cut delta comes back.
    const light = introLook("light");
    assert.ok(Math.abs(lumaOf(light.ground) - lumaOf(light.chipFill)) < 30);
  });

  it("leaves the two dark modes exactly as they render today", () => {
    // intros/*.ts and older reels that never set `background` must be
    // pixel-identical after this refactor, or every cached card is silently
    // wrong and every stitched intro changes.
    assert.equal(introLook(undefined).ground, introLook("plate").ground);
    assert.equal(introLook("plate").ground, "#08080a");
    assert.equal(introLook("plain").headline, "#fff");
    assert.equal(introLook("plate").columnFrac, 0.52);
  });
});

describe("headlineParts", () => {
  it("makes the chip one stagger unit and keeps its punctuation attached", () => {
    // Splitting on whitespace alone yields the unit "{chip}." — which matches
    // no token, so it falls through to the plain-word branch and the literal
    // text "{chip}." is rendered on screen. The period also has to stay welded
    // to the chip's right edge, or it staggers in as its own word behind a
    // 0.26em gap.
    const parts = headlineParts("Hit {chip}. It's live.");
    assert.ok(parts);
    assert.deepEqual(
      parts.before.map((t) => t.text),
      ["Hit"],
    );
    assert.equal(parts.tail, ".");
    assert.deepEqual(
      parts.after.map((t) => t.text),
      ["It's", "live."],
    );
    assert.equal(headlineParts("No chip here"), null);

    // The schedule has to agree: one cue for the chip, in sentence position.
    const cues = wordSchedule("Hit {chip}. It's live.");
    assert.equal(cues.length, 4);
    assert.equal(cues[1].word, CHIP_TOKEN);
    assert.equal(cues[1].chip, true);
  });
});

describe("parseHeadline (inline per-word styling)", () => {
  it("leaves plain copy as plain tokens", () => {
    assert.deepEqual(parseHeadline("Give your agent"), [
      { text: "Give" },
      { text: "your" },
      { text: "agent" },
    ]);
  });

  it("marks bold, italic and highlight, and strips the markers", () => {
    assert.deepEqual(parseHeadline("Make it *bold* and _soft_ and ==lit=="), [
      { text: "Make" },
      { text: "it" },
      { text: "bold", style: { bold: true } },
      { text: "and" },
      { text: "soft", style: { italic: true } },
      { text: "and" },
      { text: "lit", style: { highlight: true } },
    ]);
  });

  it("applies a run's style to every word inside it", () => {
    // A marked run can span words, but each word stays its own stagger unit so
    // the writing rhythm is unchanged — it just wears the run's style.
    assert.deepEqual(parseHeadline("*two words* plain"), [
      { text: "two", style: { bold: true } },
      { text: "words", style: { bold: true } },
      { text: "plain" },
    ]);
  });

  it("reads a custom highlight colour off the |#hex suffix", () => {
    assert.deepEqual(parseHeadline("==ship|#ffd54a=="), [
      { text: "ship", style: { highlight: "#ffd54a" } },
    ]);
  });

  it("keeps the {chip} flag through styling and exposes plain text", () => {
    const toks = parseHeadline("Hit {chip}. now");
    assert.equal(toks[1].chip, true);
    assert.equal(plainHeadline("Make it *bold*"), "Make it bold");
    // The visible sentence, not the markup, is what wordsOf returns.
    assert.deepEqual(wordsOf("Make it *bold*"), ["Make", "it", "bold"]);
  });

  it("renders an unbalanced marker literally instead of throwing", () => {
    assert.deepEqual(parseHeadline("2 * 3 = 6"), [
      { text: "2" },
      { text: "*" },
      { text: "3" },
      { text: "=" },
      { text: "6" },
    ]);
  });

  it("gives trailing punctuation the SAME beat as the word it hugs", () => {
    // `*Markdown*.` must write exactly like `Markdown.` — the period shares the
    // word's beat, so emphasising a word never lengthens the card or pops the
    // punctuation in a frame late.
    const marked = wordSchedule("Write it in *Markdown*.");
    const plain = wordSchedule("Write it in Markdown.");
    assert.equal(
      marked[marked.length - 1].startS,
      marked[marked.length - 2].startS,
    );
    assert.equal(
      marked[marked.length - 1].startS,
      plain[plain.length - 1].startS,
    );
  });
});

describe("styling validation and contrast", () => {
  it("rejects a highlight colour that is not a hex", () => {
    assert.match(
      introProblem({ name: "x", headline: "==oops|red==" }) ?? "",
      /not a #hex/,
    );
    assert.equal(introProblem({ name: "x", headline: "==ok|#ff0==" }), null);
  });

  it("counts a chip headline's VISIBLE length, not its markup", () => {
    // The markup characters never reach the screen, so a sentence that fits
    // must not be rejected for the asterisks around a word.
    const intro = {
      name: "x",
      headline: "Hit {chip}. It's *finally* live.",
      chip: { label: "Create" },
    };
    assert.equal(introProblem(intro), null);
  });

  it("picks readable ink for light and dark pills", () => {
    assert.equal(readableInk("#ffe08a"), "#101317");
    assert.equal(readableInk("#1b1f24"), "#ffffff");
  });
});

describe("chip cards", () => {
  const CHIP = {
    name: "x",
    headline: "Hit {chip}. It's live.",
    chip: { label: "Create" },
    holdS: 0.5,
  };

  it("moves the camera, stops it, and only then presses", () => {
    // Measured off the reference: it punches for ~13 frames, STOPS, and holds
    // that framing for ~17 more while the press plays out. An earlier version
    // pressed first and kept accelerating into the cut, which reads as the frame
    // falling into the control rather than a click being made on it.
    const t = introTiming(CHIP);
    assert.ok(t.chip);
    assert.ok(
      t.chip.punchStartS > t.outStartS,
      "camera moved before the copy settled",
    );
    assert.ok(
      t.chip.pressS > t.chip.punchEndS,
      "pressed while the camera was still moving",
    );
    assert.equal(
      t.chip.travelEndS,
      t.chip.punchEndS,
      "pointer must land as the camera stops",
    );
    // And the card holds that framing after the press, rather than ending on it.
    assert.ok(
      t.totalS > t.chip.pressS,
      "cut lands on the press instead of after it",
    );
    // No fade is reserved either way — the card is cut while fully on screen.
    assert.equal(introTiming({ name: "x", headline: "Two words" }).chip, null);
  });

  it("decelerates into the stop rather than accelerating into the cut", () => {
    // The punch has to be slowing down as it arrives, or it does not read as
    // stopping anywhere.
    const a = punchEase(0.8),
      b = punchEase(0.9),
      c = punchEase(1);
    assert.ok(c - b < b - a, "the punch is speeding up at the end");
    assert.equal(punchEase(1), 1);
  });

  it("rejects a chip card whose sentence cannot be laid out", () => {
    // The chip's centre is an authored input precisely so the camera never has
    // to measure the DOM — which means the sentence must fit one line, and a
    // character count is the only cheap proxy for that.
    assert.match(
      introProblem({
        name: "x",
        headline: "No token here",
        chip: { label: "Go" },
      }) ?? "",
      /\{chip\}/,
    );
    assert.match(
      introProblem({ ...CHIP, headline: "Hit {chip}. " + "x".repeat(60) }) ??
        "",
      /one line/,
    );
    assert.equal(introProblem(CHIP), null);
  });
});

/**
 * The five sentence cards of the Cursor "Agent UX improvements" film, with the
 * shot length measured off the source. The point of these is that the timing
 * model reproduces a real film, not that it satisfies its own arithmetic.
 */
const REFERENCE_CARDS: { copy: string; frames: number }[] = [
  {
    copy: "Subscribe @Cursor to your PRs, Slack threads, or run scheduled tasks",
    frames: 96,
  },
  {
    copy: "Use any skill as a Custom Mode. It stays in context for the whole session.",
    frames: 95,
  },
  { copy: "Run subagents on their own machines with clean context", frames: 96 },
  { copy: "Give agents a concrete objective across turns", frames: 96 },
  {
    copy: "Steering messages now wait for the agent's next tool call instead of interrupting it.",
    frames: 97,
  },
];

const fullbleed = (copy: string): IntroStoryboard => ({
  name: "x",
  headline: copy,
  look: "fullbleed",
});

describe("fullbleed card timing", () => {
  it("leaves the framed look untouched — but it has to be NAMED now", () => {
    // This used to pass with no `look` at all, because DEFAULT_STYLE was
    // "classic". It is "proof" now, so silence means full-bleed and a card that
    // must stay framed has to say so: measured, the same card with no look
    // starts at -0.17s, which is proof's trimInS cutting into its own reveal.
    //
    // That is the restyle the default change was FOR. The guard here is that an
    // EXPLICIT `look: "framed"` still means what it always did.
    const framed: IntroStoryboard = {
      name: "x",
      headline: "One two three",
      look: "framed",
    };
    const t = introTiming(framed);
    assert.equal(t.words[0].startS, 0, "framed still starts at 0");
    assert.equal(t.outStartS, t.settledS + HOLD_S);
  });

  it("holds every card 62-72 frames after its last word", () => {
    for (const { copy } of REFERENCE_CARDS) {
      const t = introTiming(fullbleed(copy));
      const held = (t.totalS - t.words[t.words.length - 1].endS) * 30;
      assert.ok(
        held >= 61 && held <= 73,
        `"${copy.slice(0, 24)}…" held ${held.toFixed(1)}f`,
      );
    }
  });

  it("reproduces the reference shot lengths within 5 frames", () => {
    for (const { copy, frames } of REFERENCE_CARDS) {
      const got = introDurationInFrames(fullbleed(copy), 30);
      assert.ok(
        Math.abs(got - frames) <= 5,
        `"${copy.slice(0, 24)}…" got ${got}f, reference ${frames}f`,
      );
    }
  });

  it("cuts in mid-reveal — words are already out on frame 0", () => {
    for (const { copy } of REFERENCE_CARDS) {
      const t = introTiming(fullbleed(copy));
      const out = t.words.filter((w) => w.startS <= 0).length;
      assert.ok(out >= 1, `"${copy.slice(0, 24)}…" opened empty`);
      assert.ok(out < t.words.length, "the whole card cannot be pre-revealed");
    }
  });

  it("compresses the stagger for long copy and leaves short copy alone", () => {
    const short = introTiming(fullbleed("Give agents a concrete objective"));
    const long = introTiming(fullbleed(REFERENCE_CARDS[1].copy));
    const step = (t: ReturnType<typeof introTiming>) =>
      (t.words[1].startS - t.words[0].startS) * 30;
    assert.ok(Math.abs(step(short) - WORD_STAGGER_S * 30) < 0.01);
    assert.ok(step(long) < step(short), "15 words should tighten");
    assert.ok(step(long) >= WORD_STAGGER_MIN_S * 30 - 0.01, "never below 3f");
  });

  it("never compresses past the measured 3-frame floor", () => {
    const absurd = fullbleed(Array.from({ length: 60 }, () => "word").join(" "));
    const t = introTiming(absurd);
    assert.ok((t.words[1].startS - t.words[0].startS) * 30 >= 2.99);
  });

  it("honours an explicit holdS, so an author can still sit longer", () => {
    const t = introTiming({ ...fullbleed("One two three"), holdS: 4 });
    const held = (t.totalS - t.words[t.words.length - 1].endS) * 30;
    assert.ok(Math.abs(held - 120) < 1, `held ${held}f`);
  });

  it("measures the hold from the last WORD, not from a trailing subhead", () => {
    const bare = introTiming(fullbleed("One two three"));
    const withSub = introTiming({ ...fullbleed("One two three"), subhead: "x" });
    assert.equal(withSub.totalS, bare.totalS);
  });
});

describe("fittedStagger", () => {
  it("returns the unhurried default when the copy already fits", () => {
    assert.equal(fittedStagger(4, TRIM_IN_S), WORD_STAGGER_S);
  });

  it("clamps to the floor rather than producing a sub-frame stagger", () => {
    assert.equal(fittedStagger(500, TRIM_IN_S), WORD_STAGGER_MIN_S);
  });

  it("survives a one-word or empty headline", () => {
    assert.equal(fittedStagger(1, TRIM_IN_S), WORD_STAGGER_S);
    assert.equal(fittedStagger(0, TRIM_IN_S), WORD_STAGGER_S);
  });
});

describe("recap card", () => {
  const recap = (n: number): IntroStoryboard => ({
    name: "x",
    headline: "New in Agenta",
    items: Array.from({ length: n }, (_, i) => `Feature ${i + 1}`),
  });

  it("is a list on a timer, with no word schedule at all", () => {
    const t = introTiming(recap(4));
    assert.deepEqual(t.words, []);
    assert.equal(t.chip, null);
  });

  it("reproduces the reference's 110-frame recap within 5 frames", () => {
    // Measured: f1094-1203, four items, one every 16 frames after a 5-frame
    // blank lead.
    const got = introDurationInFrames(recap(4), 30);
    assert.ok(Math.abs(got - 110) <= 5, `${got}f vs reference 110f`);
  });

  it("grows by one item stagger per extra item", () => {
    const four = introTiming(recap(4)).totalS;
    const five = introTiming(recap(5)).totalS;
    assert.ok(Math.abs(five - four - RECAP_ITEM_STAGGER_S) < 1e-9);
  });

  it("opens blank, so the dark-to-dark cut reads as a breath", () => {
    const at = recapSchedule(4);
    assert.ok(at.markS > 0, "the mark must not be up on frame 0");
    assert.ok(Math.round(at.markS * 30) === 5, "5 blank frames");
  });

  it("reveals the lockup before the first item", () => {
    const at = recapSchedule(4);
    assert.ok(at.markS < at.wordmarkS);
    assert.ok(at.wordmarkS < at.itemsS[0]);
  });

  it("spaces items 16 frames apart, three times slower than card words", () => {
    const at = recapSchedule(4);
    for (let i = 1; i < at.itemsS.length; i++)
      assert.equal(Math.round((at.itemsS[i] - at.itemsS[i - 1]) * 30), 16);
    assert.ok(RECAP_ITEM_STAGGER_S > WORD_STAGGER_S * 2.5);
  });

  it("survives a single item and an empty list", () => {
    assert.ok(introDurationInFrames(recap(1), 30) > 1);
    assert.deepEqual(recapSchedule(0).itemsS, []);
  });
});

describe("style resolves to the same timing as the look it replaces", () => {
  // The migration contract. `style` is a new way to SAY the same thing, so for
  // every card on disk the two spellings must produce identical timing — if
  // they diverge, the back catalogue re-renders differently and the whole
  // "no behaviour change" claim is void. Covers each card shape, because they
  // take different branches inside introTiming.
  const shapes: Record<string, IntroStoryboard> = {
    sentence: { name: "x", headline: "Connect a provider and pick a harness" },
    wordmarked: { name: "x", headline: "Ship it", wordmark: "Agenta" },
    subheaded: { name: "x", headline: "Ship it", subhead: "in one click" },
    logo: { name: "x", headline: "Agenta", logo: true },
    recap: { name: "x", headline: "New", items: ["a", "b", "c"] },
    chip: { name: "x", headline: `Press ${CHIP_TOKEN} to run`, chip: { label: "Run" } },
    held: { name: "x", headline: "Ship it", holdS: 0.8 },
    long: {
      name: "x",
      headline: "A far longer sentence that has to compress its own stagger",
    },
  };

  for (const [shape, card] of Object.entries(shapes)) {
    it(`${shape}: no style is the same as the default style`, () => {
      // DEFAULT_STYLE, not a hardcoded name. This test's whole claim is "a
      // silent card renders as the default"; pinning it to "classic" made it
      // assert something else, and it went red the moment the default moved
      // rather than continuing to guard the invariant it is named after.
      assert.deepEqual(
        introTiming(card),
        introTiming({ ...card, style: DEFAULT_STYLE }),
      );
      assert.equal(
        introDurationInFrames(card, 30),
        introDurationInFrames({ ...card, style: DEFAULT_STYLE }, 30),
      );
    });

    it(`${shape}: look fullbleed is the same as style proof`, () => {
      const byLook = { ...card, look: "fullbleed" as const };
      const byStyle = { ...card, style: "proof" as const };
      assert.deepEqual(introTiming(byLook), introTiming(byStyle));
      assert.equal(
        introDurationInFrames(byLook, 30),
        introDurationInFrames(byStyle, 30),
      );
    });
  }

  it("an explicit style beats the legacy look", () => {
    const card = { name: "x", headline: "Ship it quickly today" };
    // look says framed, style says proof — proof must win, which is what makes
    // `style` an override rather than a second opinion.
    assert.deepEqual(
      introTiming({ ...card, look: "framed", style: "proof" }),
      introTiming({ ...card, look: "fullbleed" }),
    );
  });
});

describe("typed cadence", () => {
  it("places each unit by the characters before it, not by word index", () => {
    // A typewriter's clock is characters. Scheduling by word index would make
    // "a" and "internationalisation" take the same time.
    const cues = wordSchedule("ab cde", 0, 0, 0, 0.1);
    assert.equal(cues[0].startS, 0);
    // "ab" is 2 chars, plus one for the space before "cde".
    assert.ok(Math.abs(cues[1].startS - 0.3) < 1e-9, `${cues[1].startS}`);
  });

  it("gives a typed unit a window as long as its own characters", () => {
    // progressAt is linear over [startS,endS), so the renderer can slice
    // characters off it directly. A fixed fade window would type every word at
    // a different rate.
    const [first] = wordSchedule("hello", 0, 0, 0, 0.1);
    assert.ok(Math.abs(first.endS - 0.5) < 1e-9, `${first.endS}`);
    assert.equal(first.typed, true);
  });

  it("does NOT type a highlighted unit", () => {
    // A pill is a filled box: typing inside it paints the box first and the
    // letters after, which rendered as an empty coloured rectangle for half a
    // second. The reference expands its pill into a gap instead.
    const cues = wordSchedule("say ==now|#fff== please", 0, 0, 0, 0.1);
    const pill = cues.find((c) => c.style?.highlight);
    assert.ok(pill, "expected a highlighted cue");
    assert.notEqual(pill?.typed, true);
    // Its neighbours still type.
    assert.equal(cues[0].typed, true);
  });

  it("leaves the word schedules untouched when no rate is given", () => {
    // The guard that keeps every non-typed style byte-identical.
    for (const c of wordSchedule("one two three", 0, 0.2, 0.05))
      assert.equal(c.typed, undefined);
  });
});
