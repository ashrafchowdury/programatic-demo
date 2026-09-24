import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYSIS_H,
  ANALYSIS_W,
  cellChange,
  classifySegment,
  compareSummaries,
  emptyRunAround,
  estimateMotion,
  findBoundaries,
  findEmptySeams,
  findJumps,
  findMoves,
  FrameRecorder,
  frameStats,
  MOVES,
  pressFrame,
  pyramid,
  speedOf,
  TO_1920,
  type Plane,
} from "./motion-metrics";

// ---------------------------------------------------------------------------
// Synthetic footage: a "page" of glyph-sized dark marks on white, viewed
// through a camera with a known scale and centre. Content displacement
// between two views is then known exactly (see truth()).
// ---------------------------------------------------------------------------

const W = ANALYSIS_W;
const H = ANALYSIS_H;

/** Deterministic PRNG so every run sees the same page. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A 1600x900 world: white page, rows of text-like marks. */
function world(seed = 1): Plane {
  const w = 1600;
  const h = 900;
  const d = new Uint8Array(w * h).fill(255);
  const r = rng(seed);
  for (let line = 30; line < h - 30; line += 26) {
    let x = 40 + Math.floor(r() * 60);
    const end = w - 40 - Math.floor(r() * 400);
    while (x < end) {
      const gw = 3 + Math.floor(r() * 8);
      const gh = 8 + Math.floor(r() * 8);
      const top = line + (16 - gh);
      for (let y = top; y < top + gh; y++)
        for (let xx = x; xx < x + gw; xx++) d[y * w + xx] = 30;
      x += gw + 2 + (r() < 0.2 ? 10 : 0);
    }
  }
  return { w, h, d };
}

/** The view of `src` at scale s (world px -> view px) centred on (cx, cy). */
function view(src: Plane, s: number, cx: number, cy: number): Plane {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const wx = cx + (x - W / 2) / s;
      const wy = cy + (y - H / 2) / s;
      const x0 = Math.floor(wx);
      const y0 = Math.floor(wy);
      const fx = wx - x0;
      const fy = wy - y0;
      const at = (xx: number, yy: number) =>
        xx < 0 || yy < 0 || xx >= src.w || yy >= src.h ? 255 : src.d[yy * src.w + xx];
      d[y * W + x] = Math.round(
        at(x0, y0) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0) * fx * (1 - fy) +
          at(x0, y0 + 1) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1) * fx * fy,
      );
    }
  return { w: W, h: H, d };
}

/** True content displacement between two views, as a Similarity. */
const truth = (s1: number, c1: [number, number], s2: number, c2: [number, number]) => ({
  a: s2 / s1 - 1,
  tx: s2 * (c1[0] - c2[0]),
  ty: s2 * (c1[1] - c2[1]),
});

const flat = (v: number): Plane => ({ w: W, h: H, d: new Uint8Array(W * H).fill(v) });

/** A card: flat ground, one band of "type" across the middle. */
function card(ground: number, ink: number, seed = 3, rows = 2): Plane {
  const p = flat(ground);
  const r = rng(seed);
  for (let line = 0; line < rows; line++) {
    const y0 = 150 + line * 34;
    for (let x = 180; x < 460; x += 14) {
      if (r() < 0.2) continue;
      for (let y = y0; y < y0 + 22; y++)
        for (let xx = x; xx < x + 9; xx++) p.d[y * W + xx] = ink;
    }
  }
  return p;
}

const WORLD = world();

// ---------------------------------------------------------------------------

describe("estimateMotion", () => {
  it("reads a held frame as zero motion", () => {
    const a = pyramid(view(WORLD, 0.5, 800, 450));
    const fit = estimateMotion(a, a);
    assert.ok(fit.model, "no model on a held frame");
    assert.equal(speedOf(fit.model), 0);
  });

  it("recovers a pan to within 0.25 px at analysis scale", () => {
    const c1: [number, number] = [800, 450];
    const c2: [number, number] = [812, 444]; // 6 / -3 view px at s=0.5
    const fit = estimateMotion(
      pyramid(view(WORLD, 0.5, ...c1)),
      pyramid(view(WORLD, 0.5, ...c2)),
    );
    const t = truth(0.5, c1, 0.5, c2);
    assert.ok(fit.model, `no model (blocks ${fit.blocks}, inliers ${fit.inliers})`);
    assert.ok(Math.abs(fit.model.tx - t.tx) < 0.25, `tx ${fit.model.tx} vs ${t.tx}`);
    assert.ok(Math.abs(fit.model.ty - t.ty) < 0.25, `ty ${fit.model.ty} vs ${t.ty}`);
    assert.ok(Math.abs(fit.model.a) < 0.002, `a ${fit.model.a}`);
  });

  it("recovers a punch-in (zoom + pan) speed to within 10%", () => {
    const c1: [number, number] = [800, 450];
    const c2: [number, number] = [806, 452];
    const fit = estimateMotion(
      pyramid(view(WORLD, 0.5, ...c1)),
      pyramid(view(WORLD, 0.53, ...c2)),
    );
    const t = truth(0.5, c1, 0.53, c2);
    assert.ok(fit.model);
    const want = speedOf(t);
    const got = speedOf(fit.model);
    assert.ok(Math.abs(got - want) / want < 0.1, `speed ${got} vs ${want} px@1920`);
    assert.ok(Math.abs(fit.model.a - t.a) < 0.005, `a ${fit.model.a} vs ${t.a}`);
  });

  it("follows a fast move (~40 px@1920 per frame) through the coarse search", () => {
    const c1: [number, number] = [700, 450];
    const c2: [number, number] = [728, 450]; // 14 view px = 42 px@1920
    const fit = estimateMotion(
      pyramid(view(WORLD, 0.5, ...c1)),
      pyramid(view(WORLD, 0.5, ...c2)),
    );
    assert.ok(fit.model);
    const want = speedOf(truth(0.5, c1, 0.5, c2));
    assert.ok(Math.abs(speedOf(fit.model) - want) < 1.5, `${speedOf(fit.model)} vs ${want}`);
  });

  it("does not invent motion from rules that run edge to edge", () => {
    // Full-width horizontal rules at a fixed pitch, plus one changed pixel so
    // the static gate does not short-circuit. Every block has the aperture
    // problem (and the pitch aliases vertically at 1/8 res). Before the corner
    // gate this shape returned arbitrary 94 px "matches" on held gmail frames.
    const rules = (poke: boolean): Plane => {
      const p = flat(255);
      for (let y = 40; y < H - 40; y += 30) p.d.fill(40, y * W, (y + 1) * W);
      if (poke) p.d.fill(0, 5 * W + 5, 5 * W + 30);
      return p;
    };
    const fit = estimateMotion(pyramid(rules(false)), pyramid(rules(true)));
    assert.ok(
      fit.model === null || speedOf(fit.model) < MOVES.floor,
      `invented ${fit.model && speedOf(fit.model)} px@1920`,
    );
  });
});

describe("findMoves (onset)", () => {
  // A 30-frame move (1 s, a long punch-in) with peak 30, from two profiles.
  const profile = (v: (u: number) => number) => {
    const s: Array<number | null> = [0, 0, 0];
    for (let i = 1; i <= 30; i++) s.push(30 * v(i / 30));
    s.push(0, 0);
    return s;
  };

  it("reads a lurch — full speed on frame one — as a high onset share", () => {
    // Speed of bezier-like curve with start slope 1: fast immediately, decays.
    const moves = findMoves(profile((u) => Math.max(0.05, 1 - u) ** 1.5));
    assert.equal(moves.length, 1);
    assert.ok(moves[0].onset[0] > 0.7, `onset ${moves[0].onset[0]}`);
  });

  it("reads a zero-slope ease as a low onset share", () => {
    // Smoothstep velocity 6u(1-u): 0 at both ends.
    const moves = findMoves(profile((u) => (6 * u * (1 - u)) / 1.5));
    assert.equal(moves.length, 1);
    assert.ok(moves[0].onset[0] < 0.15, `onset ${moves[0].onset[0]}`);
    assert.ok(moves[0].onset[1] < moves[0].onset[2]);
  });

  it("bridges a one-frame estimator miss instead of splitting the move", () => {
    const s = profile((u) => (6 * u * (1 - u)) / 1.5);
    s[10] = null;
    assert.equal(findMoves(s).length, 1);
  });

  it("marks the onset unknown when the frame before the move was not seen", () => {
    const s: Array<number | null> = [null, 20, 30, 25, 10, 2, 0];
    const [m] = findMoves(s);
    assert.ok(m, "no move");
    assert.ok(Number.isNaN(m.onset[0]));
  });

  it("ignores drift under the minimum peak", () => {
    assert.equal(findMoves([0, 2, 3, 4, 3, 2, 0]).length, 0);
  });
});

describe("findJumps", () => {
  it("counts a re-kick and not a smooth ramp", () => {
    const px = (v: number) => ({ a: 0, tx: v / TO_1920, ty: 0 });
    const smooth = [0, 4, 8, 12, 16, 20].map(px);
    assert.equal(findJumps(smooth).length, 0);
    const kick = [0, 0, 30, 28, 26].map(px);
    const j = findJumps(kick);
    assert.equal(j.length, 1);
    assert.equal(j[0].frame, 2);
  });

  it("skips pairs with an unknown model", () => {
    assert.equal(findJumps([{ a: 0, tx: 0, ty: 0 }, null, { a: 0, tx: 20, ty: 0 }]).length, 0);
  });
});

describe("press timing", () => {
  it("maps a log time to the frame zoomAt draws it on", () => {
    assert.equal(pressFrame(1936, 1.25, 30), 46);
    assert.equal(pressFrame(1936, 1, 30, 100), 61);
  });
});

describe("frameStats", () => {
  it("counts page white as blank, card cream as ground but not blank", () => {
    const white = frameStats(flat(255));
    assert.equal(white.ink, 0);
    assert.equal(white.whiteBlank, 1);
    const cream = frameStats(flat(246));
    assert.equal(cream.groundShare, 1);
    assert.equal(cream.whiteBlank, 0);
  });

  it("puts a card's type in a band of rows and a page's marks everywhere", () => {
    assert.ok(frameStats(card(246, 20)).inkRows < 0.2);
    assert.ok(frameStats(view(WORLD, 0.5, 800, 450)).inkRows > 0.8);
  });
});

describe("cellChange", () => {
  it("keeps correlation through a modal scrim and loses it at a cut", () => {
    const page = view(WORLD, 0.5, 800, 450);
    const dim: Plane = { ...page, d: page.d.map((v) => Math.round(v * 0.6)) };
    const other = view(world(9), 0.5, 800, 450);
    const a = frameStats(page);
    assert.ok(cellChange(a, frameStats(dim)).corr > 0.9);
    assert.ok(cellChange(a, frameStats(card(10, 240))).corr < 0.15);
    assert.ok(cellChange(a, frameStats(other)).corr < 0.5);
  });
});

// ---------------------------------------------------------------------------
// Segmentation on synthetic reels
// ---------------------------------------------------------------------------

function record(frames: Plane[]) {
  const r = new FrameRecorder(30);
  for (const f of frames) r.push(f);
  return r;
}
const repeat = (p: Plane, n: number) => Array.from({ length: n }, () => p);
const blend = (a: Plane, b: Plane, u: number): Plane => ({
  w: W,
  h: H,
  d: a.d.map((v, i) => Math.round(v * (1 - u) + b.d[i] * u)),
});

describe("findBoundaries", () => {
  const cardA = card(246, 20);
  const page = view(WORLD, 0.5, 800, 450);

  it("finds a hard cut from a card to footage, on the right frame", () => {
    const r = record([...repeat(cardA, 20), ...repeat(page, 20)]);
    const b = findBoundaries(r.recs, r.l2);
    assert.deepEqual(b.map((x) => [x.kind, x.frame]), [["cut", 20]]);
  });

  it("finds a 6-frame dissolve as one dissolve, not six cuts", () => {
    const mid = [1, 2, 3, 4, 5].map((k) => blend(cardA, page, k / 6));
    const r = record([...repeat(cardA, 20), ...mid, ...repeat(page, 20)]);
    const b = findBoundaries(r.recs, r.l2);
    assert.equal(b.length, 1, JSON.stringify(b));
    assert.equal(b[0].kind, "dissolve");
    assert.ok(b[0].frame >= 20 && b[0].frame <= 25);
  });

  it("does not call a held-then-cut sequence a dissolve", () => {
    // Three frames of slight change, then a cut: alphas 0, 0, 0, 1.
    const nudged = card(246, 20, 3, 2);
    nudged.d[160 * W + 100] = 0;
    const r = record([
      ...repeat(cardA, 20),
      nudged,
      cardA,
      nudged,
      ...repeat(page, 20),
    ]);
    const kinds = findBoundaries(r.recs, r.l2).map((x) => x.kind);
    assert.deepEqual(kinds, ["cut"]);
  });

  it("does not cut on a modal scrim over the same page", () => {
    const dim: Plane = { ...page, d: page.d.map((v) => Math.round(v * 0.6)) };
    const r = record([...repeat(page, 20), ...repeat(dim, 20)]);
    assert.equal(findBoundaries(r.recs, r.l2).length, 0);
  });
});

describe("empty seams", () => {
  it("finds a stage seam and measures how long the frame sits empty", () => {
    const r = record([
      ...repeat(card(246, 20), 20),
      ...repeat(flat(246), 12),
      ...repeat(card(246, 20, 7), 20),
    ]);
    const seams = findEmptySeams(r.recs);
    assert.equal(seams.length, 1);
    assert.equal(emptyRunAround(r.recs, seams[0].frame), 12);
  });

  it("ignores a brief thinning inside one card", () => {
    const r = record([
      ...repeat(card(246, 20), 3),
      ...repeat(flat(246), 5),
      ...repeat(card(246, 20), 30),
    ]);
    assert.equal(findEmptySeams(r.recs).length, 0);
  });
});

describe("classifySegment", () => {
  it("tells a card from footage, and a sparse white page from a card", () => {
    assert.equal(classifySegment(record(repeat(card(246, 20), 5)).recs), "card");
    assert.equal(classifySegment(record(repeat(card(10, 240), 5)).recs), "card");
    assert.equal(
      classifySegment(record(repeat(view(WORLD, 0.5, 800, 450), 5)).recs),
      "footage",
    );
    // Card-like texture on page white: footage (see CLASSIFY).
    assert.equal(classifySegment(record(repeat(card(255, 20), 5)).recs), "footage");
  });
});

describe("compareSummaries", () => {
  it("diffs shared keys and flags one-sided ones", () => {
    const d = compareSummaries(
      { onset1Max: 0.8, moves: 5, only: 1 },
      { onset1Max: 0.1, moves: 5, added: 2 },
    );
    const by = Object.fromEntries(d.map((x) => [x.key, x]));
    assert.ok(Math.abs((by.onset1Max.delta ?? 0) + 0.7) < 1e-9);
    assert.equal(by.moves.delta, 0);
    assert.equal(by.only.after, null);
    assert.equal(by.added.before, null);
  });
});
