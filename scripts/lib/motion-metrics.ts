/**
 * Frame-level measurement for scripts/analyze.ts — the pure half.
 *
 * Everything here works on 8-bit grey planes that analyze.ts decodes with
 * ffmpeg at ANALYSIS_W x ANALYSIS_H (area-downscaled, so codec noise and
 * sub-pixel text average out instead of aliasing). No ffmpeg, no files: every
 * function is a pure function of pixels or of per-frame series, which is what
 * lets the thresholds be unit-tested on synthetic frames with a known answer.
 *
 * Three families:
 *
 *   1. CAMERA MOTION. Block matching + a robust similarity fit gives the
 *      camera's per-frame zoom and pan, so a move has a real velocity in px per
 *      frame — not an scdet "how different is this frame" score, which
 *      saturates on fast moves and cannot tell a zoom from a page change. This
 *      is what the onset-jerk, velocity-jump and settle-before-press checks
 *      stand on.
 *   2. CELL STATS. The frame cut into CELL x CELL tiles: flat vs inked, the
 *      ground colour, how much is blank page white. Card-vs-footage, empty
 *      frames and zoom-hold blank share all read these.
 *   3. SEGMENTATION. Hard cuts, dissolves and empty seams, for reel mode.
 *
 * UNITS. Velocities are reported in "px@1920": pixels per frame on a 1920-wide
 * picture, whatever the file's real width. Every capture this repo scores
 * against was taken at a 1920-wide viewport, and the audit's per-frame numbers
 * are in that space, so this keeps the two comparable across 2560 and 1920
 * renders.
 */

/** Width/height every frame is decoded at for the motion + cell passes. */
export const ANALYSIS_W = 640;
export const ANALYSIS_H = 360;
/** Multiply analysis-plane px by this to get px@1920 (see UNITS above). */
export const TO_1920 = 1920 / ANALYSIS_W;

export type Plane = { w: number; h: number; d: Uint8Array };

/** 2x2 box downsample. Odd trailing row/column is dropped. */
export function downsample2(p: Plane): Plane {
  const w = p.w >> 1;
  const h = p.h >> 1;
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * p.w;
    const r1 = r0 + p.w;
    for (let x = 0; x < w; x++) {
      const i = 2 * x;
      d[y * w + x] =
        (p.d[r0 + i] + p.d[r0 + i + 1] + p.d[r1 + i] + p.d[r1 + i + 1] + 2) >>
        2;
    }
  }
  return { w, h, d };
}

/** [L0, L1, L2, L3] — full analysis res down to 1/8. */
export type Pyramid = Plane[];
export function pyramid(p: Plane, levels = 4): Pyramid {
  const out = [p];
  while (out.length < levels) out.push(downsample2(out[out.length - 1]));
  return out;
}

// ---------------------------------------------------------------------------
// 1. Camera motion
// ---------------------------------------------------------------------------

/**
 * Content displacement prev -> cur at point p (L0 px, relative to the frame
 * centre): d(p) = a * p + t. `a` is (scale ratio - 1); a > 0 is a zoom-in.
 * No rotation term: this camera never rolls, and a free rotation lets the fit
 * absorb block-matching noise as a fake tilt.
 */
export type Similarity = { a: number; tx: number; ty: number };

export type MotionFit = {
  /** null when too few blocks agree to call it camera motion. */
  model: Similarity | null;
  /** Textured blocks that found a match. */
  blocks: number;
  /** Of those, how many the final model explains. */
  inliers: number;
};

export const MOTION = {
  /** Block side at L0. 24 px at 640 wide = 72 px@1920: two lines of UI text. */
  block: 24,
  /** Block grid pitch at L0: 20 x 11 candidates, so a sparse page still yields 6+. */
  step: 32,
  /**
   * Shi-Tomasi strength (see cornerness) a block needs before it is matched.
   * Measured on gmail-automation holds: blocks of UI text 12–760, a lone input
   * border or rule 0.4–2.4, flat page 0. 5 sits in the gap.
   */
  minCorner: 5,
  /**
   * Coarse search radius at L3 (1/8 res), in L3 px. +-10 at L3 = +-80 at L0 =
   * +-240 px@1920 per frame. The fastest camera frame in the baselines is
   * model-providers at 7.2 s, 195 px@1920; stage exits in out/reel reach
   * ~280 and are allowed to fail the fit (they are exits, not camera moves).
   */
  coarseR: 10,
  /**
   * A match is discarded when its best mean-abs-difference per pixel is still
   * above this: the block's content changed (a menu opened, text typed), so
   * its displacement says nothing about the camera. Not a sensitive knob — the
   * trimmed fit rejects bad matches anyway, and this only saves it work: at 8,
   * 12 and 20, gmail-automation and model-providers find the same moves with
   * onset shares within 3 points and estimator coverage within 0.5%.
   */
  maxBlockErr: 12,
  /** Final inlier radius, L0 px (= 3 px@1920). */
  inlierPx: 1,
  /** A model needs this many agreeing blocks, and this share of all matched. */
  minInliers: 6,
  minInlierFrac: 0.4,
  /**
   * Below this L1 mean-abs-diff (with no pixel over `staticMax`) the frame is
   * a held frame: skip the search and report zero motion. Measured on
   * gmail-automation with the search forced on every frame: the 234 frames
   * this gate skips all read under 0.17 px@1920 (mean diff <= 0.11), while
   * every frame moving >= 1 px@1920 has mean diff >= 0.20 and max >= 69.
   */
  staticMad: 0.15,
  staticMax: 6,
};

/**
 * Shi-Tomasi corner strength of a block: the smaller eigenvalue of its
 * gradient structure tensor, per pixel. Large only when the block has edges in
 * TWO directions. A single horizontal rule or an input border has plenty of
 * gradient but slides along itself without changing — the aperture problem —
 * and block matching then returns any offset along the line. Those blocks
 * produced the 94 px "matches" on held gmail frames before this gate.
 */
function cornerness(p: Plane, x0: number, y0: number, bs: number): number {
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = y0; y < y0 + bs - 1; y++) {
    const r = y * p.w;
    for (let x = x0; x < x0 + bs - 1; x++) {
      const v = p.d[r + x];
      const gx = p.d[r + x + 1] - v;
      const gy = p.d[r + p.w + x] - v;
      sxx += gx * gx;
      syy += gy * gy;
      sxy += gx * gy;
    }
  }
  const n = (bs - 1) * (bs - 1);
  const half = (sxx + syy) / 2;
  return (half - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy)) / n;
}

/** Cost multiplier on the coarse-search candidate; see estimateMotion. */
const COARSE_BIAS = 1.15;

/** Sum of absolute differences, block at (ax,ay) in a vs (bx,by) in b. */
function sad(
  a: Plane,
  ax: number,
  ay: number,
  b: Plane,
  bx: number,
  by: number,
  bs: number,
  cap: number,
): number {
  if (bx < 0 || by < 0 || bx + bs > b.w || by + bs > b.h) return Infinity;
  let s = 0;
  for (let y = 0; y < bs; y++) {
    const ra = (ay + y) * a.w + ax;
    const rb = (by + y) * b.w + bx;
    for (let x = 0; x < bs; x++) s += Math.abs(a.d[ra + x] - b.d[rb + x]);
    if (s >= cap) return s;
  }
  return s;
}

/** Best integer offset within +-r of (gx,gy), block at (x,y) in a. */
function search(
  a: Plane,
  b: Plane,
  x: number,
  y: number,
  bs: number,
  gx: number,
  gy: number,
  r: number,
): { dx: number; dy: number; s: number } {
  let best = { dx: gx, dy: gy, s: Infinity };
  for (let dy = gy - r; dy <= gy + r; dy++)
    for (let dx = gx - r; dx <= gx + r; dx++) {
      const s = sad(a, x, y, b, x + dx, y + dy, bs, best.s);
      if (s < best.s) best = { dx, dy, s };
    }
  return best;
}

/** Parabolic sub-pixel offset from three samples around a minimum. */
const parabola = (m: number, c: number, p: number): number => {
  const den = m - 2 * c + p;
  return Number.isFinite(den) && den > 0 ? (m - p) / (2 * den) : 0;
};

/** Least-squares [a, tx, ty] for d = a*p + t. */
function fitSimilarity(
  pts: Array<{ x: number; y: number; dx: number; dy: number }>,
): Similarity | null {
  const n = pts.length;
  if (n < 3) return null;
  let sxx = 0, sx = 0, sy = 0, sxd = 0, sdx = 0, sdy = 0;
  for (const p of pts) {
    sxx += p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxd += p.x * p.dx + p.y * p.dy;
    sdx += p.dx;
    sdy += p.dy;
  }
  // Eliminate tx, ty: tx = (sdx - a sx)/n, ty = (sdy - a sy)/n.
  const den = sxx - (sx * sx + sy * sy) / n;
  const a = Math.abs(den) < 1e-9 ? 0 : (sxd - (sx * sdx + sy * sdy) / n) / den;
  return { a, tx: (sdx - a * sx) / n, ty: (sdy - a * sy) / n };
}

const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** L1 mean |diff| and max |diff|: the cheap "did anything happen" gate. */
export function planeDiff(a: Plane, b: Plane): { mad: number; max: number } {
  let s = 0;
  let m = 0;
  for (let i = 0; i < a.d.length; i++) {
    const v = Math.abs(a.d[i] - b.d[i]);
    s += v;
    if (v > m) m = v;
  }
  return { mad: s / a.d.length, max: m };
}

/**
 * Camera motion from prev to cur. `hint` is the previous frame's model: a
 * camera move is continuous, so the last velocity is the best first guess and
 * rescues blocks whose coarse match lands on a look-alike (a repeated row).
 */
export function estimateMotion(
  prev: Pyramid,
  cur: Pyramid,
  hint: Similarity | null = null,
): MotionFit {
  const { mad, max } = planeDiff(prev[1], cur[1]);
  if (mad < MOTION.staticMad && max <= MOTION.staticMax) {
    return { model: { a: 0, tx: 0, ty: 0 }, blocks: 0, inliers: 0 };
  }
  const L0 = prev[0];
  const bs = MOTION.block;
  const cx = L0.w / 2;
  const cy = L0.h / 2;
  const matches: Array<{ x: number; y: number; dx: number; dy: number }> = [];

  for (let by = MOTION.step / 2; by + bs <= L0.h; by += MOTION.step)
    for (let bx = MOTION.step / 2; bx + bs <= L0.w; bx += MOTION.step) {
      const corner = cornerness(L0, bx, by, bs);
      if (corner < MOTION.minCorner) continue;
      const px = bx + bs / 2 - cx;
      const py = by + bs / 2 - cy;

      // Coarse at L3, then refine +-2 down the pyramid. Candidates: the coarse
      // winner, the hint's prediction, and zero — refined at L1, best kept.
      const b3 = Math.max(4, bs >> 3);
      const x3 = Math.round((bx + bs / 2) / 8 - b3 / 2);
      const y3 = Math.round((by + bs / 2) / 8 - b3 / 2);
      const c3 = search(prev[3], cur[3], x3, y3, b3, 0, 0, MOTION.coarseR);
      const cands: Array<[number, number]> = [[c3.dx * 2, c3.dy * 2], [0, 0]];
      if (hint) {
        cands.push([
          Math.round((hint.a * px + hint.tx) / 4),
          Math.round((hint.a * py + hint.ty) / 4),
        ]);
      }
      // L2 + L1 refinement per candidate.
      let best = { dx: 0, dy: 0, s: Infinity };
      const b2 = bs >> 2;
      const x2 = Math.round((bx + bs / 2) / 4 - b2 / 2);
      const y2 = Math.round((by + bs / 2) / 4 - b2 / 2);
      const b1 = bs >> 1;
      const x1 = Math.round((bx + bs / 2) / 2 - b1 / 2);
      const y1 = Math.round((by + bs / 2) / 2 - b1 / 2);
      // The coarse winner must beat the priors (zero, last velocity) by
      // COARSE_BIAS: on repeated rows the 1/8-res search aliases to a row
      // pitch away, and a tie should go to the continuous explanation.
      for (let c = 0; c < cands.length; c++) {
        const [gx, gy] = cands[c];
        const r2 = search(prev[2], cur[2], x2, y2, b2, gx, gy, 2);
        const r1 = search(prev[1], cur[1], x1, y1, b1, r2.dx * 2, r2.dy * 2, 2);
        const cost = c === 0 ? r1.s * COARSE_BIAS : r1.s;
        if (cost < best.s) best = { ...r1, s: cost };
      }
      const r0 = search(L0, cur[0], bx, by, bs, best.dx * 2, best.dy * 2, 2);
      if (!Number.isFinite(r0.s) || r0.s / (bs * bs) > MOTION.maxBlockErr) {
        continue;
      }
      const at = (dx: number, dy: number) =>
        sad(L0, bx, by, cur[0], bx + dx, by + dy, bs, Infinity);
      const sx = parabola(at(r0.dx - 1, r0.dy), r0.s, at(r0.dx + 1, r0.dy));
      const sy = parabola(at(r0.dx, r0.dy - 1), r0.s, at(r0.dx, r0.dy + 1));
      matches.push({ x: px, y: py, dx: r0.dx + sx, dy: r0.dy + sy });
    }

  if (matches.length < MOTION.minInliers) {
    return { model: null, blocks: matches.length, inliers: 0 };
  }
  // Iteratively trimmed least squares: refit on the points the last model
  // explains. Keeps a menu sliding in, or the cursor, from dragging the fit.
  let pts = matches;
  let model = fitSimilarity(pts);
  for (let it = 0; it < 4 && model; it++) {
    const m = model;
    const res = matches.map((p) =>
      Math.hypot(p.dx - (m.a * p.x + m.tx), p.dy - (m.a * p.y + m.ty)),
    );
    const cut = Math.max(MOTION.inlierPx, 2.5 * median(res));
    pts = matches.filter((_, i) => res[i] <= cut);
    model = fitSimilarity(pts);
  }
  if (!model) return { model: null, blocks: matches.length, inliers: 0 };
  const m = model;
  const inliers = matches.filter(
    (p) =>
      Math.hypot(p.dx - (m.a * p.x + m.tx), p.dy - (m.a * p.y + m.ty)) <=
      MOTION.inlierPx * 1.5,
  ).length;
  const ok =
    inliers >= MOTION.minInliers &&
    inliers / matches.length >= MOTION.minInlierFrac;
  return { model: ok ? model : null, blocks: matches.length, inliers };
}

/** 5x5 grid of points spanning the frame, relative to its centre (L0 px). */
function grid(w = ANALYSIS_W, h = ANALYSIS_H): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < 5; i++)
      out.push([((i + 0.5) / 5 - 0.5) * w, ((j + 0.5) / 5 - 0.5) * h]);
  return out;
}
const GRID = grid();

/**
 * Camera speed: mean displacement over a 5x5 grid across the whole frame, in
 * px@1920 per frame. A pure zoom about the centre moves the corners and not
 * the middle, so a single-point speed would read a punch-in as zero.
 */
export function speedOf(m: Similarity): number {
  let s = 0;
  for (const [x, y] of GRID) s += Math.hypot(m.a * x + m.tx, m.a * y + m.ty);
  return (s / GRID.length) * TO_1920;
}

/**
 * Change of velocity between two frames' models: the largest |dv| over the
 * grid, px@1920 per frame. A jump here is an acceleration a smooth ease never
 * makes in one frame — a re-kick, or a pan hitting a clamp.
 */
export function velocityJump(p: Similarity, q: Similarity): number {
  let m = 0;
  for (const [x, y] of GRID) {
    const dx = (q.a - p.a) * x + (q.tx - p.tx);
    const dy = (q.a - p.a) * y + (q.ty - p.ty);
    m = Math.max(m, Math.hypot(dx, dy));
  }
  return m * TO_1920;
}

// ---------------------------------------------------------------------------
// 2. Cell stats
// ---------------------------------------------------------------------------

/** Cell side at L0. 16 px of 640 = 1/40 of the width. */
export const CELL = 16;

export const CELLS = {
  /**
   * A cell is FLAT (bare ground or bare page) when max-min over its pixels is
   * at most this. Measured on out/reel grounds: cream card ground 0–2, black
   * card ground 0–1, framed-look backdrop gradient 1–3 per cell; the smallest
   * card glyph at 640 wide pushes a cell to 40+.
   */
  flatRange: 6,
  /**
   * Page white. The apps filmed here are white (255) pages; after the h264
   * round trip and the area downscale their flat cells read 252–255 (modal
   * bin 254 in every out/demo file). The cream reel grounds must NOT count as
   * page — a card is not empty product — and they read 244–247 (stage) and
   * 248–251 (ledger), so this sits just above them.
   */
  whiteMin: 252,
  /** Ground share tolerance around the modal flat-cell luma. */
  groundTol: 6,
};

export type FrameStats = {
  meanLuma: number;
  /** Share of cells that are not flat: text, UI, imagery. */
  ink: number;
  /** Modal luma of flat cells, or -1 when no cell is flat. */
  groundLuma: number;
  /** Share of cells flat AND within groundTol of groundLuma. */
  groundShare: number;
  /** Share of cells flat AND page white (>= whiteMin). */
  whiteBlank: number;
  /**
   * Share of cell ROWS holding any ink. A card's type sits in a band; a UI
   * spreads controls down the whole frame even when the page is sparse.
   */
  inkRows: number;
  /** Per-cell mean, for cut detection against the next frame. */
  cellMean: Float32Array;
  /** Per-cell inked flag. */
  cellInk: Uint8Array;
};

export function frameStats(p: Plane): FrameStats {
  const cols = Math.floor(p.w / CELL);
  const rows = Math.floor(p.h / CELL);
  const n = cols * rows;
  const cellMean = new Float32Array(n);
  const cellInk = new Uint8Array(n);
  const hist = new Uint32Array(64);
  let total = 0;
  let ink = 0;
  let white = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let s = 0;
      let lo = 255;
      let hi = 0;
      for (let y = r * CELL; y < (r + 1) * CELL; y++) {
        const row = y * p.w;
        for (let x = c * CELL; x < (c + 1) * CELL; x++) {
          const v = p.d[row + x];
          s += v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const mean = s / (CELL * CELL);
      const k = r * cols + c;
      cellMean[k] = mean;
      total += mean;
      if (hi - lo > CELLS.flatRange) {
        cellInk[k] = 1;
        ink++;
      } else {
        hist[Math.min(63, Math.floor(mean / 4))]++;
        if (mean >= CELLS.whiteMin) white++;
      }
    }
  let rowsInked = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++)
      if (cellInk[r * cols + c]) {
        rowsInked++;
        break;
      }
  }
  let mode = -1;
  let modeN = 0;
  for (let i = 0; i < 64; i++)
    if (hist[i] > modeN) {
      modeN = hist[i];
      mode = i;
    }
  const groundLuma = mode < 0 ? -1 : mode * 4 + 2;
  let ground = 0;
  if (mode >= 0)
    for (let k = 0; k < n; k++)
      if (!cellInk[k] && Math.abs(cellMean[k] - groundLuma) <= CELLS.groundTol)
        ground++;
  return {
    meanLuma: total / n,
    ink: ink / n,
    groundLuma,
    groundShare: ground / n,
    whiteBlank: white / n,
    inkRows: rowsInked / rows,
    cellMean,
    cellInk,
  };
}

/** Luma change a cell needs to count as changed between two frames. */
export const CELL_CHANGE = 10;

export type CellChange = {
  /** Share of all cells whose mean moved by > CELL_CHANGE. */
  all: number;
  /** Share of the previous frame's inked cells that changed. */
  prevInk: number;
  /** Share of this frame's inked cells that changed. */
  curInk: number;
  prevInkN: number;
  curInkN: number;
  /**
   * Pearson correlation of the two frames' cell-mean maps. Survives a global
   * dim (a modal scrim multiplies every cell) and a drawer covering a third of
   * the frame; collapses on a real cut, where the layout itself is replaced.
   */
  corr: number;
};

export function cellChange(a: FrameStats, b: FrameStats): CellChange {
  let all = 0, pi = 0, pc = 0, ci = 0, cc = 0;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const n = a.cellMean.length;
  for (let k = 0; k < n; k++) {
    const x = a.cellMean[k];
    const y = b.cellMean[k];
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
    const changed = Math.abs(a.cellMean[k] - b.cellMean[k]) > CELL_CHANGE;
    if (changed) all++;
    if (a.cellInk[k]) {
      pi++;
      if (changed) pc++;
    }
    if (b.cellInk[k]) {
      ci++;
      if (changed) cc++;
    }
  }
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  // A perfectly flat frame has no layout to correlate; call it uncorrelated
  // with anything that is not also flat.
  const corr =
    va < 1e-6 || vb < 1e-6
      ? va < 1e-6 && vb < 1e-6 ? 1 : 0
      : (sab - (sa * sb) / n) / Math.sqrt(va * vb);
  return {
    corr,
    all: all / a.cellMean.length,
    prevInk: pi ? pc / pi : 0,
    curInk: ci ? cc / ci : 0,
    prevInkN: pi,
    curInkN: ci,
  };
}

// ---------------------------------------------------------------------------
// 3. Segmentation (reel mode)
// ---------------------------------------------------------------------------

/** Everything segmentation needs about one frame. Index 0 has no `change`. */
export type FrameRecord = {
  t: number;
  stats: Pick<
    FrameStats,
    "meanLuma" | "ink" | "groundShare" | "whiteBlank" | "groundLuma" | "inkRows"
  >;
  change: CellChange | null;
  /** Camera model into this frame; null = no coherent motion found. */
  model: Similarity | null;
  speed: number | null;
};

/**
 * Turns a stream of L0 planes into FrameRecords — the one place the frame
 * pass is defined, so analyze.ts and the tests measure frames identically.
 * Keeps the L2 plane of every frame (14 KB each) for the dissolve test.
 */
export class FrameRecorder {
  readonly recs: FrameRecord[] = [];
  readonly l2: Plane[] = [];
  private prev: Pyramid | null = null;
  private first: Pyramid | null = null;
  private prevStats: FrameStats | null = null;
  private hint: Similarity | null = null;

  constructor(private readonly fps: number) {}

  /**
   * The camera between the first frame pushed and the last, estimated
   * directly — or null when it cannot be (no frames, or the two pictures share
   * too little to fit). The per-frame models compound: every page change a
   * held camera sees adds a small false scale, and gmail-automation integrated
   * to "ends at 0.88x" across 706 frames whose first and last window rects are
   * identical. One direct fit has no such drift.
   */
  endVsStart(): Similarity | null {
    if (!this.first || !this.prev) return null;
    return estimateMotion(this.first, this.prev, null).model;
  }

  push(plane: Plane): FrameRecord {
    const pyr = pyramid(plane);
    this.first ??= pyr;
    const stats = frameStats(pyr[0]);
    let model: Similarity | null = { a: 0, tx: 0, ty: 0 };
    let change: CellChange | null = null;
    if (this.prev && this.prevStats) {
      model = estimateMotion(this.prev, pyr, this.hint).model;
      this.hint = model;
      change = cellChange(this.prevStats, stats);
    }
    const rec: FrameRecord = {
      t: this.recs.length / this.fps,
      stats: {
        meanLuma: stats.meanLuma,
        ink: stats.ink,
        groundShare: stats.groundShare,
        whiteBlank: stats.whiteBlank,
        groundLuma: stats.groundLuma,
        inkRows: stats.inkRows,
      },
      change,
      model,
      speed: model ? speedOf(model) : null,
    };
    this.recs.push(rec);
    this.l2.push(pyr[2]);
    this.prev = pyr;
    this.prevStats = stats;
    return rec;
  }
}

export const SEGMENT = {
  /**
   * HARD CUT, first gate: the cell-mean maps either side correlate below
   * this. Every cut in the five baseline reels measured -0.66 to +0.14 (the
   * highest, 0.135, is agent-tool's closing card -> logo card). A modal scrim
   * plus drawer opening inside a clip measured 0.15–0.26 (agent-tool f301,
   * agent-schedule f181, harness f227), which is why this is not higher and why
   * the settle gate below exists.
   */
  cutCorr: 0.15,
  /** ...and at least this share of one side's ink cells changed. */
  cutInkChange: 0.6,
  /**
   * ...and the NEXT frame is ordinary. A cut replaces the picture once; the
   * frame after it continues the new shot (measured 0.00–0.19 cell change,
   * the high end a stage push-in arriving). A UI animation that decorrelates
   * the picture in one step keeps changing: agent-tool f302 measured 0.54.
   */
  cutSettle: 0.3,
  /**
   * When either side is near-empty there is no layout to correlate, so a cut
   * there needs this share of ALL cells to change — a luma slam like footage
   * -> black card (harness f710 measured 1.00). A glyph appearing on bare
   * ground is a card typing, not a cut.
   */
  cutAllChange: 0.2,
  /**
   * Motion faster than this (px@1920) with a reliable model is a camera move or
   * a push, not a cut, even when every cell changed.
   */
  coherentSpeed: 1,
  /** A dissolve is 3–15 frames (monid measured 6). */
  dissolveMin: 3,
  dissolveMax: 15,
  /**
   * Per-frame share of cells changing for a frame to be "in transition". The
   * ledger dissolves in agent-schedule change 0.43–1.00 of cells per frame.
   */
  dissolveStep: 0.03,
  /**
   * Blend residual ceiling: mean |F - lerp(A,B,alpha)| / mean |B - A|, see
   * isDissolve. Measured on the baselines in scripts/lib/motion-metrics.test.ts
   * and on agent-schedule's two ledger dissolves.
   */
  dissolveResidual: 0.2,
  /**
   * Largest blend step one frame may take (share of A -> B). monid's measured
   * 6-frame dissolve steps 0.09–0.25 of its luma range per frame. Without this
   * a card holding still for three frames and then cutting fits a "blend" with
   * alphas 0, 0, 0 — harness f414–417 did exactly that.
   */
  dissolveMaxStep: 0.5,
  /**
   * NEAR-EMPTY: ink at or below this share of cells (1% = ~9 cells of 880).
   * A typewriter card's first glyphs are 0.5%; a full card sentence 1.1–7%;
   * the sparsest footage frame in out/reel 8%+.
   */
  emptyInk: 0.01,
  /**
   * An empty run is a seam only with at least this many non-empty frames on
   * each side. A logo mark tumbling in thins below emptyInk for a few frames
   * mid-card (harness f3–f12); that is one card, not two.
   */
  seamMinSideF: 15,
};

export type Boundary = {
  kind: "cut" | "dissolve" | "empty";
  /** First frame of the new segment (for a dissolve: its midpoint). */
  frame: number;
  /** Dissolve span, frames [from, to]. */
  from: number;
  to: number;
};

/**
 * Hard cuts and dissolves. `planes` are L2 (1/4-res) frames, used only for
 * the dissolve blend test; everything else reads the per-frame records.
 */
export function findBoundaries(
  recs: FrameRecord[],
  planes: Plane[],
): Boundary[] {
  const out: Boundary[] = [];
  const coherent = (r: FrameRecord) =>
    r.model !== null && (r.speed ?? 0) > SEGMENT.coherentSpeed;
  const empty = (k: number) => recs[k].stats.ink <= SEGMENT.emptyInk;
  const isCut = (i: number): boolean => {
    const r = recs[i];
    const c = r.change;
    if (!c || coherent(r)) return false;
    if (empty(i) || empty(i - 1)) return c.all >= SEGMENT.cutAllChange;
    const next = recs[i + 1]?.change?.all ?? 0;
    return (
      c.corr < SEGMENT.cutCorr &&
      Math.max(c.prevInk, c.curInk) >= SEGMENT.cutInkChange &&
      next < SEGMENT.cutSettle
    );
  };

  // Dissolves first: a dissolve's frames each change a lot and would otherwise
  // read as a string of cuts.
  const claimed = new Uint8Array(recs.length);
  let i = 1;
  while (i < recs.length) {
    const inTransition = (k: number) =>
      k < recs.length &&
      // No coherence test here: a blended frame fools the motion fit into a
      // "reliable" model now and then. The blend test below is the judge.
      (recs[k].change?.all ?? 0) >= SEGMENT.dissolveStep;
    if (!inTransition(i)) {
      i++;
      continue;
    }
    let j = i;
    while (inTransition(j + 1) && j - i + 1 < SEGMENT.dissolveMax) j++;
    // The run can carry ordinary UI change on either side of the blend (a
    // cursor settling into the last frame of a clip), so try every sub-span,
    // longest first.
    let found: [number, number] | null = null;
    for (let len = j - i + 1; len >= SEGMENT.dissolveMin && !found; len--)
      for (let s = i; s + len - 1 <= j && !found; s++)
        if (isDissolve(planes, s - 1, s + len - 1)) found = [s, s + len - 1];
    if (found) {
      const [s, e] = found;
      out.push({ kind: "dissolve", frame: Math.round((s + e) / 2), from: s, to: e });
      for (let k = s; k <= e; k++) claimed[k] = 1;
    }
    i = j + 1;
  }
  for (let k = 1; k < recs.length; k++) {
    if (claimed[k] || !isCut(k)) continue;
    out.push({ kind: "cut", frame: k, from: k, to: k });
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/** Do frames a+1..b-1 read as a linear blend from frame a to frame b? */
export function isDissolve(planes: Plane[], a: number, b: number): boolean {
  const A = planes[a]?.d;
  const B = planes[b]?.d;
  if (!A || !B) return false;
  let span = 0;
  let bb = 0;
  for (let k = 0; k < A.length; k++) {
    const d = B[k] - A[k];
    span += Math.abs(d);
    bb += d * d;
  }
  span /= A.length;
  if (span < 4 || bb === 0) return false;
  let last = 0;
  for (let m = a + 1; m < b; m++) {
    const F = planes[m].d;
    let fb = 0;
    for (let k = 0; k < A.length; k++) fb += (F[k] - A[k]) * (B[k] - A[k]);
    const alpha = fb / bb;
    if (alpha < last - 0.05 || alpha > 1.05) return false;
    if (alpha - last > SEGMENT.dissolveMaxStep) return false;
    last = alpha;
    let res = 0;
    for (let k = 0; k < A.length; k++)
      res += Math.abs(F[k] - A[k] - alpha * (B[k] - A[k]));
    if (res / A.length / span > SEGMENT.dissolveResidual) return false;
  }
  // The last step into B must be a step too, or this is a hold then a cut.
  return 1 - last <= SEGMENT.dissolveMaxStep;
}

/**
 * Empty seams: runs of near-empty frames that separate two non-empty spans.
 * The stage grammar hides its concatenation seams in these on purpose; the
 * defect is when the frame sits empty for too long around one.
 */
export function findEmptySeams(
  recs: FrameRecord[],
  minSide = SEGMENT.seamMinSideF,
): Boundary[] {
  const out: Boundary[] = [];
  const full = (from: number, dir: 1 | -1) => {
    let n = 0;
    for (let k = from; k >= 0 && k < recs.length; k += dir) {
      if (recs[k].stats.ink <= SEGMENT.emptyInk) break;
      n++;
    }
    return n;
  };
  let k = 0;
  while (k < recs.length) {
    if (recs[k].stats.ink > SEGMENT.emptyInk) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < recs.length && recs[e + 1].stats.ink <= SEGMENT.emptyInk) e++;
    if (full(k - 1, -1) >= minSide && full(e + 1, 1) >= minSide) {
      out.push({ kind: "empty", frame: Math.round((k + e) / 2), from: k, to: e });
    }
    k = e + 1;
  }
  return out;
}

/** Near-empty frames touching frame `f` (the run it sits in, both sides). */
export function emptyRunAround(recs: FrameRecord[], f: number, reach = 30): number {
  const empty = (k: number) =>
    k >= 0 && k < recs.length && recs[k].stats.ink <= SEGMENT.emptyInk;
  let n = 0;
  for (let k = f - 1; k >= f - reach && empty(k); k--) n++;
  for (let k = f; k < f + reach && empty(k); k++) n++;
  return n;
}

export const CLASSIFY = {
  /**
   * CARD: the segment's median frame is one flat colour over at least this
   * share, its ink sits in at most `cardRows` of the cell rows, and that flat
   * colour is not page white. Measured on 1 s windows of the five baseline
   * reels: cards 0.88–0.99 ground, 0.09–0.36 rows (the tallest, harness's
   * three-line closing card, 0.36); footage 0.10–0.74 ground with 0.57–1.00
   * rows.
   *
   * The white rule is what separates the one overlap: a sparse zoomed page
   * (gmail-automation 12–17 s) measures 0.88 ground and 0.36 rows — the same
   * as that closing card — but its ground is page white, and no card ground in
   * STYLE_PRESETS is (the lightest, #faf6f1, reads ~247).
   */
  cardGround: 0.85,
  cardRows: 0.4,
};

export type SegmentKind = "card" | "footage";

export function classifySegment(recs: FrameRecord[]): SegmentKind {
  const ground = median(recs.map((r) => r.stats.groundShare));
  const rows = median(recs.map((r) => r.stats.inkRows));
  const luma = median(recs.map((r) => r.stats.groundLuma));
  return ground >= CLASSIFY.cardGround &&
    rows <= CLASSIFY.cardRows &&
    luma < CELLS.whiteMin
    ? "card"
    : "footage";
}

// ---------------------------------------------------------------------------
// 4. Demo-mode camera checks over a speed series
// ---------------------------------------------------------------------------

export const MOVES = {
  /**
   * A frame is part of a move above this speed (px@1920). The estimator's
   * floor on held frames with typing and cursor motion is 0.0–0.4; 1.0 leaves
   * headroom without swallowing the first eased frame of a real move (a
   * zero-slope ease starting a 300 px move covers ~1–3 px on frame one).
   */
  floor: 1,
  /** A run needs this peak to count as a camera move rather than drift. */
  minPeak: 8,
  /** ...and this many frames. */
  minFrames: 3,
  /**
   * Velocity jump threshold, px@1920 per frame. The audit's corpus-wide
   * number (393 jumps > 15 px/frame, target < 20) used this value on the
   * replayed camera track; the same threshold here makes the render-side
   * count comparable.
   */
  jump: 15,
  /** A press is "settled" when the camera speed at its frame is below this. */
  settle: 2,
  /**
   * A move's onset is read from its first frame of motion, which for a small
   * move sits under `floor`: the zero-slope ease puts 2-5% of peak on frame one,
   * and on a 14 px/f reframe that is 0.2-0.8 px. Counted from the first frame
   * over `floor`, those moves reported their SECOND frame (17-25% of peak) as
   * the onset and were flagged as lurches — gmail 4.50 s (f134 0.22, f135 2.30,
   * peak 13.7), hourly 6.47 s (f193 0.30, f194 3.49), agent-tool 4.13 s (f123
   * 0.83, f124 8.07) — while the same curve on a big move passed, because its
   * frame one cleared the floor. So a move is walked back over up to two
   * sub-floor frames that climb into it: above `leadIn` (the held-frame
   * estimator floor reads 0.00-0.09 on these holds) and at least `leadInRatio`
   * of the frame after (the ramps above run 0.086-0.10; a still frame before a
   * real lurch reads far under it).
   */
  leadIn: 0.15,
  leadInRatio: 1 / 15,
};

export type Move = {
  start: number;
  end: number;
  peak: number;
  peakAt: number;
  /**
   * Speed on the move's first 3 frames as a share of its peak. NaN when the
   * frame before the move was not measured, so the start was not seen.
   */
  onset: number[];
};

/** Group a per-frame speed series (null = unknown) into camera moves. */
export function findMoves(raw: Array<number | null>): Move[] {
  // Bridge estimator misses (up to 2 frames) inside a move — a blur-smeared
  // frame mid-glide fails the fit now and then (gmail f24, f27) and would
  // otherwise split one move into two, the second with an unseen onset.
  const speed = raw.map((v, i) => {
    if (v != null) return v;
    const before = raw[i - 1] ?? raw[i - 2];
    const after = raw[i + 1] ?? raw[i + 2];
    return before != null && after != null && before > MOVES.floor && after > MOVES.floor
      ? (before + after) / 2
      : null;
  });
  const out: Move[] = [];
  let k = 0;
  while (k < speed.length) {
    if ((speed[k] ?? 0) <= MOVES.floor) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < speed.length && (speed[e + 1] ?? 0) > MOVES.floor) e++;
    let peak = 0;
    let peakAt = k;
    for (let i = k; i <= e; i++)
      if ((speed[i] ?? 0) > peak) {
        peak = speed[i] ?? 0;
        peakAt = i;
      }
    if (peak >= MOVES.minPeak && e - k + 1 >= MOVES.minFrames) {
      // Walk back into the move's sub-floor lead-in (see MOVES.leadIn).
      let s = k;
      for (let j = 0; j < 2 && s > 0; j++) {
        const v = raw[s - 1];
        const next = raw[s] ?? 0;
        if (v == null || v <= MOVES.leadIn || v >= next || v < MOVES.leadInRatio * next) break;
        s--;
      }
      // A move whose frame-before is unmeasured (the range start, a cut, an
      // estimator miss) may already have been moving: its onset is unknown,
      // not "a lurch". Reel shots that push in from the cut land here.
      const observed = s > 0 && raw[s - 1] != null;
      const onset = [0, 1, 2]
        .map((j) => raw[s + j])
        .map((v) => (v == null || !observed ? NaN : v / peak));
      out.push({ start: s, end: e, peak, peakAt, onset });
    }
    k = e + 1;
  }
  return out;
}

/** Frames where the camera's velocity jumps by more than MOVES.jump. */
export function findJumps(
  models: Array<Similarity | null>,
  skip: (frame: number) => boolean = () => false,
): Array<{ frame: number; dv: number }> {
  const out: Array<{ frame: number; dv: number }> = [];
  for (let i = 1; i < models.length; i++) {
    const p = models[i - 1];
    const q = models[i];
    if (!p || !q || skip(i) || skip(i - 1)) continue;
    const dv = velocityJump(p, q);
    if (dv > MOVES.jump) out.push({ frame: i, dv });
  }
  return out;
}

/**
 * Camera speed at a press: the larger of frames `f` and `f + 1` (the press and
 * the frame it shows on), or null when either is unmeasured.
 *
 * A frame moving on its own — both neighbours under MOVES.floor — is the page,
 * not the camera: a camera move is at least MOVES.minFrames long and eases in
 * and out, so it cannot put 8 px on one frame between two still ones. gmail
 * and hourly "Pick an agent" read 8.16 / 8.10 px@1920 on the one frame the
 * dropdown opened under a camera the track holds still (f54 0.03, f55 8.16,
 * f56 0.08), and were counted as presses landing mid-move.
 */
export function pressSpeed(
  speed: Array<number | null>,
  f: number,
): number | null {
  const at = (i: number): number | null => {
    const v = speed[i];
    if (v == null) return null;
    const lone =
      v > MOVES.floor &&
      (speed[i - 1] ?? Infinity) <= MOVES.floor &&
      (speed[i + 1] ?? Infinity) <= MOVES.floor;
    return lone ? Math.max(speed[i - 1] ?? 0, speed[i + 1] ?? 0) : v;
  };
  const a = at(f);
  const b = at(f + 1);
  return a == null || b == null ? null : Math.max(a, b);
}

/** Output frame a log-time press lands on. Mirrors zoomAt's clock. */
export function pressFrame(
  tMs: number,
  speed: number,
  fps: number,
  offsetMs = 0,
): number {
  return Math.round(((tMs + offsetMs) / 1000 / speed) * fps);
}

// ---------------------------------------------------------------------------
// 5. JSON compare
// ---------------------------------------------------------------------------

/** Flatten nested numeric leaves to dotted paths. Arrays are skipped. */
export function flattenNumbers(
  obj: unknown,
  prefix = "",
  out: Record<string, number> = {},
): Record<string, number> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v))
      flattenNumbers(v, key, out);
  }
  return out;
}

export type Delta = { key: string; before: number | null; after: number | null; delta: number | null };

export function compareSummaries(a: unknown, b: unknown): Delta[] {
  const fa = flattenNumbers(a);
  const fb = flattenNumbers(b);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  return keys.map((key) => {
    const before = key in fa ? fa[key] : null;
    const after = key in fb ? fb[key] : null;
    return {
      key,
      before,
      after,
      delta: before !== null && after !== null ? after - before : null,
    };
  });
}
