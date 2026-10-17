/**
 * House styles: every number the flow composer and the brief compiler use,
 * frozen per published version.
 *
 * A brief chooses footage and copy, and nothing else. How long a clip leads its
 * press, which card is dark, what plays underneath and at what loudness, which
 * aspects render: all of that is the house, so two launches cut under one
 * version breathe the same. A brief may pin a version (`"house": "agenta@1"`)
 * and then compiles under exactly that version for as long as it exists.
 *
 * PUBLISHED VERSIONS DO NOT CHANGE. house.test.ts hashes each one and fails on
 * any edit. A change of taste is a new version (`agenta@2`) beside the old,
 * plus a golden run under it (docs/reel/design/compiler-validation.md).
 *
 * Seeds come from the hand-cut reels, measured in demo seconds at 1.25x (see
 * openspec/changes/post-to-reel-compiler/design.md):
 *
 *   clip start - first press   classic -0.04 -0.04 -0.68 -0.01 -0.13
 *                              stage   -1.07 +0.06 -0.34 -0.20 -0.12 -0.37 -0.38
 *   end - last typing end      about +0.76
 *   payoff end - press         classic +2.74 · stage +1.52
 *   typing shown before a cut  about 2.7s
 */
import type { Aspect } from "./aspect";
import type { ChipTone, IntroBackground } from "./intro";
import type { GrammarTargets, ReelStyle } from "./style";

/** The four kinds of copy a brief writes. Each has its own word range. */
export const COPY_KINDS = ["title", "beat", "payoff", "signoff"] as const;
export type CopyKind = (typeof COPY_KINDS)[number];

export type WordRange = { readonly min: number; readonly max: number };

/** A sound placed from the click log, as `ReelSfx` takes it. */
export type HouseCue = { readonly src: string; readonly gain: number };

/** Gate metrics: the `analyze` totals a style's `targets` are written in. */
export type GateMetric = Exclude<keyof GrammarTargets, "cutDelta">;

/** What every house of one brand shares, whatever its base style. */
export type HouseBrand = {
  /** The lockup on the title and sign-off cards. */
  readonly wordmark: string;
  /** Whole words, matched case-insensitively, refused in any copy. */
  readonly bannedWords: readonly string[];
  /**
   * Card backgrounds, as palette ROLES (see IntroBackground). Every card takes
   * `card` except the sign-off, which takes `signoff`. Under `stage` all roles
   * share one cream, so the plan is honoured and renders as one ground.
   */
  readonly tone: { readonly card: IntroBackground; readonly signoff: IntroBackground };
  /** The payoff pill's tone: the colour of the control the payoff clip presses. */
  readonly chipTone: ChipTone;
  readonly audio: {
    /** Trimmed to the reel's length, fading out at its end. */
    readonly bed: {
      readonly src: string;
      readonly gain: number;
      readonly fadeInS: number;
      readonly fadeOutS: number;
    };
    readonly sfx: {
      readonly click: HouseCue;
      readonly typing: HouseCue;
      readonly pop: HouseCue;
      /** Placed on the payoff chip's label, or the last beat's last label. */
      readonly confirm: HouseCue;
    };
    /** Duck the bed under the SFX. */
    readonly duck: boolean;
    readonly loudnessLUFS: number;
  };
};

/**
 * What a compiled reel holds. `beats`: title, a card and a clip per beat, the
 * payoff, the sign-off. `one-take`: title, the whole interaction as one clip,
 * the outro lines, the logo.
 */
export const SHAPES = ["beats", "one-take"] as const;
export type Shape = (typeof SHAPES)[number];

export type House = {
  /** `<brand>@<version>`, the string a brief pins. */
  readonly id: string;
  /** The reel style every compiled reel names explicitly. */
  readonly style: ReelStyle;
  /**
   * What goes in the reel; see Shape. Absent = `beats`: read through
   * houseShape(), so houses published before shapes keep their frozen hashes.
   */
  readonly shape?: Shape;
  /** The brand pack (src/lib/brand.ts) every card and clip is cut in. Absent = the style's own look. */
  readonly pack?: string;
  /**
   * The window every clip floats in, over the style and the pack: its flat
   * ground, as a pack colour name, and where the camera works (see
   * ShotStyle.camera). Needs a `pack`. Absent = the style's and the pack's own.
   */
  readonly window?: { readonly ground: string; readonly camera: "window" | "inside" };
  /** Most closing lines a one-take brief may give (each a `signoff` card in length). */
  readonly outro?: { readonly max: number };
  readonly brand: HouseBrand;
  readonly copy: Readonly<Record<CopyKind, WordRange>>;
  /** Most beats a brief may have. The least is always 2. At most 5. */
  readonly maxBeats: number;
  /** Composer pacing, in shoot-time ms, plus the speed the shoot is paced for. */
  readonly shoot: {
    readonly speed: number;
    /**
     * Shoot K times slower and compress back (DEMO_SLOWMO, scripts/lib/
     * footage.ts): K times the capture frames per second of footage, which is
     * what keeps a 4K capture smooth on a loaded machine. Absent = 1.
     */
    readonly slowmo?: number;
    /** Stillness on the surface before the first action. */
    readonly establishMs: number;
    /** Still beat between one action's last step and the next action's first. */
    readonly gapMs: number;
  };
  /** Clip rules, in demo seconds. */
  readonly cut: {
    /** Added to the `from` press: negative starts before it. */
    readonly leadS: number;
    /** After the last label's press, for a beat that does not type. */
    readonly tailS: number;
    /** After the last label's typing end, for a beat that types. */
    readonly typingTailS: number;
    /** After the payoff chip's press: room for the camera to pull back. */
    readonly payoffTailS: number;
    /** Least demo time between one clip's end and the next clip's start. */
    readonly gapS: number;
    /** Most typing a clip shows, from the typing beat's press. */
    readonly typingCapS: number;
    /** Longest clip. */
    readonly clipCapS: number;
    /** The payoff clip's first-frame scale, framed on the chip's control. */
    readonly openScale: number;
    /** Slow push inside holds, or null where the style has no camera. */
    readonly drift: number | null;
  };
  /** Card `holdS` per kind of copy; absent = the style's own. */
  readonly holds: Readonly<Partial<Record<CopyKind, number>>>;
  /** Rendered in order; the first is the reel's own, the rest pass `--aspect`. */
  readonly aspects: readonly Aspect[];
  /** Output frame rate (DEMO_FPS, see FPS in click-log.ts). Absent = 30. */
  readonly fps?: 30 | 60;
  readonly maxLengthS: number;
  readonly gate: {
    /** A cap that cuts more than this many seconds fails the gate. */
    readonly capReportS: number;
    /** Allowed distance from the style's `targets`, per metric. */
    readonly tolerance: Readonly<Record<GateMetric, number>>;
    /**
     * The brand audit's frame half (scripts/lib/brand-frames.ts): RGB distance
     * from a pack colour, or a blend of two, and the share of a card frame's
     * pixels allowed beyond it. Only a house with a `pack` has one.
     */
    readonly brand?: { readonly tolerance: number; readonly maxOffShare: number };
  };
};

/** A house's shape, `beats` when it predates shapes. */
export const houseShape = (house: Pick<House, "shape">): Shape => house.shape ?? "beats";

/**
 * Does this house cut one take? Asked here rather than by comparing strings at
 * the call site: the shape shares its name with the one-take STYLE, and only
 * src/lib/style* and this registry may spell a style's name.
 */
export const isOneTake = (house: Pick<House, "shape">): boolean => houseShape(house) === "one-take";

const AGENTA_BRAND: HouseBrand = {
  wordmark: "Agenta",
  bannedWords: [
    "revolutionary",
    "game-changer",
    "game-changing",
    "seamless",
    "seamlessly",
    "cutting-edge",
    "next-gen",
    "supercharge",
    "effortless",
    "effortlessly",
    "unleash",
    "world-class",
    "best-in-class",
  ],
  // A light product gets light cards and one dark sign-off: measured on
  // agent-skill, all-dark cards cut against Y 181 footage at a ~157-level slam.
  tone: { card: "light", signoff: "plain" },
  // Agenta's primary buttons are black.
  chipTone: "dark",
  audio: {
    bed: { src: "audio/intro.mp3", gain: 1, fadeInS: 0.2, fadeOutS: 2.5 },
    sfx: {
      // Gains from reels/harness.ts, set against the samples rather than the
      // manifest: click.wav is louder than the stock, so equal gains bury the payoff.
      click: { src: "audio/sfx/click.wav", gain: 0.35 },
      typing: { src: "audio/sfx/typing.wav", gain: 0.35 },
      pop: { src: "audio/sfx/pop.wav", gain: 0.45 },
      confirm: { src: "audio/sfx/confirm.wav", gain: 2.5 },
    },
    duck: true,
    loudnessLUFS: -14,
  },
};

const agenta1: House = {
  id: "agenta@1",
  style: "stage",
  brand: AGENTA_BRAND,
  copy: {
    title: { min: 1, max: 5 },
    beat: { min: 2, max: 7 },
    payoff: { min: 2, max: 7 },
    signoff: { min: 1, max: 6 },
  },
  maxBeats: 5,
  shoot: { speed: 1.25, establishMs: 900, gapMs: 1200 },
  cut: {
    // Golden-tuned (docs/reel/design/compiler-validation.md, seed log): the
    // stage starts allow -0.29..-0.03; -0.2 sits inside with room both ways.
    leadS: -0.2,
    // Stage click ends allow 0.78..1.52 after the press (schedule's close
    // cadence and pick 08); 1.2 is the middle.
    tailS: 1.2,
    // agent-tool holds the narrowed action list 1.82s past the last keystroke;
    // the stage cut lets a typed result read before it leaves.
    typingTailS: 1.8,
    payoffTailS: 1.5,
    gapS: 0.1,
    typingCapS: 2.7,
    clipCapS: 6,
    openScale: 1.6,
    drift: null,
  },
  holds: {},
  aspects: ["16:9", "9:16"],
  maxLengthS: 30,
  gate: {
    capReportS: 4,
    // From the hand stage reels against the stage targets: worst deviations
    // meanShotS 1.77, cutsPerMin 17.7, movingFrac 0.474, longestStillF 21
    // (agent-tool, agent-schedule-stage). longestStillF keeps 60: the two
    // example launches on public-site footage reach 52-59, and no Agenta
    // launch has been measured yet.
    tolerance: { meanShotS: 2, cutsPerMin: 20, movingFrac: 0.5, longestStillF: 60 },
  },
};

const agentaClassic1: House = {
  id: "agenta-classic@1",
  style: "classic",
  brand: AGENTA_BRAND,
  copy: {
    title: { min: 1, max: 5 },
    beat: { min: 3, max: 7 },
    payoff: { min: 2, max: 6 },
    signoff: { min: 2, max: 6 },
  },
  maxBeats: 5,
  shoot: { speed: 1.25, establishMs: 900, gapMs: 1200 },
  cut: {
    leadS: -0.04,
    tailS: 1.5,
    typingTailS: 0.76,
    payoffTailS: 2.74,
    gapS: 0.1,
    typingCapS: 2.7,
    clipCapS: 6,
    openScale: 1.74,
    drift: 1,
  },
  // agent-skill's tuned holds: beats long enough to rest, the payoff short
  // because its card ends on the punch, the sign-off held.
  holds: { beat: 0.9, payoff: 0.5, signoff: 1.4 },
  aspects: ["16:9", "9:16"],
  maxLengthS: 30,
  gate: {
    capReportS: 4,
    tolerance: { meanShotS: 3, cutsPerMin: 30, movingFrac: 0.5, longestStillF: 60 },
  },
};

/**
 * The one-take house, and the default. Seeds from agenta@1's measured cut, with
 * the payoff tail as the take's pull-back: one clip from the first action to
 * the last, which the beat caps would chop, so they are set past any take the
 * length limit allows and `maxLengthS` is the guard instead.
 *
 * The logo closes on White smoke (the kit's light ground), so every card is light.
 */
const agenta2: House = {
  id: "agenta@2",
  style: "one-take",
  shape: "one-take",
  pack: "agenta",
  brand: { ...AGENTA_BRAND, tone: { card: "light", signoff: "light" } },
  copy: {
    title: { min: 1, max: 6 },
    beat: { min: 2, max: 7 },
    payoff: { min: 2, max: 7 },
    signoff: { min: 1, max: 8 },
  },
  outro: { max: 3 },
  maxBeats: 5,
  shoot: { speed: 1.25, establishMs: 900, gapMs: 1200 },
  cut: {
    leadS: -0.2,
    tailS: 1.2,
    typingTailS: 1.8,
    payoffTailS: 1.2,
    gapS: 0.1,
    typingCapS: 60,
    clipCapS: 60,
    openScale: 1.6,
    drift: null,
  },
  holds: {},
  aspects: ["16:9", "9:16"],
  maxLengthS: 40,
  gate: {
    capReportS: 4,
    // one-take has no reference film, so no `targets`: these are never read.
    tolerance: { meanShotS: 2, cutsPerMin: 20, movingFrac: 0.5, longestStillF: 60 },
    // MEASURED on the skills-onetake validation render (docs/reel/design/
    // one-take.md): the worst card frame is 0.275% off-palette at 12 RGB units
    // in 16:9 and 0.110% in 9:16, glyph edges blending three colours plus
    // encoder ringing. 0.5% leaves ~1.8x margin; an off-brand subhead or ground
    // covers far more than that.
    brand: { tolerance: 12, maxOffShare: 0.005 },
  },
};

/**
 * agenta@2 shot in slow motion and rendered at 60fps: the smooth one take.
 * Validated on the skills take (docs/reel/design/one-take.md, "Smoothness"):
 * at K=3 the 4K capture's motion went from ~34 to ~38 distinct fps outside
 * typing, and 60fps doubles every camera, cursor and card step. It costs about
 * twice agenta@2's render time.
 */
const agenta3: House = {
  ...agenta2,
  id: "agenta@3",
  shoot: { ...agenta2.shoot, slowmo: 3 },
  fps: 60,
};

/** agenta@3 rendered 16:9 only: the vertical cut is dropped from the default. */
const agenta4: House = { ...agenta3, id: "agenta@4", aspects: ["16:9"] };

/**
 * agenta@4 with the app held in a window on a grey ground: neutral 200, a
 * touch darker than the ground of the reference the user pointed at (Cursor's
 * canvas launch, #f5f5f7). Neutral 300 read too deep. The camera zooms inside
 * the window, so the ground, the rounded corners and the shadow stay in every
 * frame, and its shutter averages the app's samples, so the app keeps its own
 * colours (docs/reel/design/one-take.md). The app is magnified exactly as under
 * agenta@4; only the window no longer grows past the frame.
 */
const agenta5: House = {
  ...agenta4,
  id: "agenta@5",
  window: { ground: "neutral-200", camera: "inside" },
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

/** Every published house, by id. */
export const HOUSES: Readonly<Record<string, House>> = deepFreeze(
  Object.fromEntries([agenta1, agentaClassic1, agenta2, agenta3, agenta4, agenta5].map((h) => [h.id, h])),
);

/**
 * One take in the Agenta pack, the app in a window on a grey ground, shot in
 * slow motion, rendered at 60fps, 16:9 only. Was "agenta@1" (beats, stage),
 * "agenta@2" (one take at 30fps), "agenta@3" (60fps, plus 9:16), then
 * "agenta@4" (agenta@5 with the window filling the frame on its zooms); a brief
 * that pins any of them still cuts exactly as before.
 */
export const HOUSE_DEFAULT = "agenta@5";

/** The house a brief names, or a sentence naming the ones that exist. */
export function resolveHouse(id: string = HOUSE_DEFAULT): House | { problem: string } {
  const house = HOUSES[id];
  if (house) return house;
  return {
    problem: `unknown house "${id}". Published: ${Object.keys(HOUSES).join(", ")}.`,
  };
}

