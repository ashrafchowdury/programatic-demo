/**
 * The reel SFX palette, synthesized from nothing — no samples, no third-party
 * audio, so every file it writes is an original work with no licence to trace.
 *
 * Pure: no fs, no ffmpeg. `renderSfx(id)` returns the samples, `encodeWav`
 * turns them into bytes, and scripts/gen-sfx.ts writes them to
 * public/audio/sfx/. Seeded PRNG throughout, so a re-run is byte-identical.
 *
 * ---------------------------------------------------------------------------
 * TWO CONSTRAINTS EVERY SOUND HERE IS HELD TO, AND WHY
 *
 * LENGTH IS THE OLD FILE'S, TO THE SAMPLE. These replaced supplied samples
 * whose licences were never verified. A reel places a cue at a reel second and
 * gives it the file's length as its on-timeline duration (resolvePiece in
 * src/lib/reel-audio.ts), so a different length is a different mix. Keeping
 * the sample count means no reel's timing can move.
 *
 * LOUDNESS IS THE OLD FILE'S TOO — NOT A FLAT -1 dBTP, AND NOT ITS PEAK.
 * reels/harness.ts and reels/agent-schedule.ts set their SFX gains by ear
 * against the old files (click x 0.35, confirm x 2.5 — see the comment on
 * harness's `sfx`). Normalising everything to -1 dBTP would make the clicks
 * ~3dB hotter and the chime ~16dB hotter than the old files under gains tuned
 * for them, and clip the confirm cue on the mix. Matching the old PEAK was tried first
 * and is not enough either: a synthesized pop and error carry more energy per
 * dB of peak than the samples did, and measured +4.4 and +5.2 LU louder at
 * equal peak. So each sound is normalised to the peak that puts its max
 * momentary loudness (EBU R128 M, 400ms) on the old file's; every one of those
 * peaks still sits under the -1 dBTP ceiling, which `CEILING_DBTP` asserts.
 *
 * The sounds are all the same recipe — a transient, a short damped body, a
 * gentle low-pass — because UI sound that reads as tasteful is short, dull at
 * the top and quiet in the tail. Nothing here rings past ~150ms except the
 * typing bed and the two tonal cues.
 * ---------------------------------------------------------------------------
 */

export const SAMPLE_RATE = 48000;
/** Nothing is ever written hotter than this, whatever a sound asks for. */
export const CEILING_DBTP = -1;

export const SFX_IDS = [
  "click",
  "typing",
  "pop",
  "key",
  "confirm",
  "error",
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export type SfxSpec = {
  /** Exact length in samples at SAMPLE_RATE. */
  samples: number;
  /** True peak the finished sound is normalised to, in dBTP. Chosen to match
   *  the replaced file's loudness, not its peak — see the table below. */
  peakDbtp: number;
  /** What it is, for the log line and the manifest. */
  character: string;
};

/**
 * MEASURED on the files these replace — ffprobe `nb_samples`, and max
 * momentary loudness from ffmpeg `ebur128` over the file padded by 1s. All
 * 48kHz stereo s16. `peakDbtp` is the peak that lands the new sound on the old
 * loudness (within 0.1 LU); the old file's own true peak is alongside.
 *
 *   id       samples   old M max   old peak   new peak
 *   click     10629    -26.5 LUFS   -4.5       -3.7
 *   typing   144000    -27.5        -7.1       -8.6
 *   pop       21583    -23.3        -4.4       -8.8
 *   key       10135    -27.3        -4.5       -6.8
 *   confirm   16560    -27.2       -20.7      -17.0
 *   error     16349    -16.9        -4.3       -9.0
 */
export const SFX_SPECS: Record<SfxId, SfxSpec> = {
  click: { samples: 10629, peakDbtp: -3.7, character: "soft mouse click: press + lighter release" },
  typing: { samples: 144000, peakDbtp: -8.6, character: "3s of irregular keystrokes, word gaps, one spacebar per word" },
  pop: { samples: 21583, peakDbtp: -8.8, character: "rounded upward bloop, a menu arriving" },
  key: { samples: 10135, peakDbtp: -6.8, character: "one key: low thock on the way down, tick on the way up" },
  confirm: { samples: 16560, peakDbtp: -17.0, character: "warm C5 -> G5 two-note resolve" },
  error: { samples: 16349, peakDbtp: -9.0, character: "two soft descending notes, G4 -> Eb4" },
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and the same numbers on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(g);

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ cookbook low/high-pass, Q 0.707 unless told otherwise. */
function biquad(kind: "lp" | "hp", freq: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = kind === "lp" ? 1 - cos : -(1 + cos);
  const b0 = kind === "lp" ? (1 - cos) / 2 : (1 + cos) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Run a biquad over `x` in place. */
function filter(x: Float64Array, f: Biquad): Float64Array {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}

const lowpass = (x: Float64Array, hz: number) => filter(x, biquad("lp", hz));
const highpass = (x: Float64Array, hz: number) => filter(x, biquad("hp", hz));

/**
 * A damped sine added into `out` at `at` seconds: 0.4ms linear attack (no
 * click at the onset), exponential decay with time constant `tauS`. The body
 * of every percussive sound here is one or two of these.
 */
function ping(
  out: Float64Array,
  at: number,
  hz: number,
  tauS: number,
  amp: number,
): void {
  const start = Math.round(at * SAMPLE_RATE);
  const atk = 0.0004 * SAMPLE_RATE;
  const len = Math.min(out.length - start, Math.ceil(tauS * 8 * SAMPLE_RATE));
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / atk) * Math.exp(-i / (tauS * SAMPLE_RATE));
    out[start + i] += amp * env * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
}

/** Band-limited noise transient: white noise, band-passed, exp decay. */
function tick(
  out: Float64Array,
  at: number,
  tauS: number,
  amp: number,
  band: [number, number],
  r: () => number,
): void {
  const len = Math.ceil(tauS * 8 * SAMPLE_RATE);
  const n = new Float64Array(len);
  for (let i = 0; i < len; i++) n[i] = r() * 2 - 1;
  highpass(n, band[0]);
  lowpass(n, band[1]);
  const start = Math.round(at * SAMPLE_RATE);
  const atk = 0.0002 * SAMPLE_RATE;
  for (let i = 0; i < len && start + i < out.length; i++) {
    out[start + i] += amp * n[i] * Math.min(1, i / atk) * Math.exp(-i / (tauS * SAMPLE_RATE));
  }
}

/** A sustained note with a soft attack and an exponential tail. */
function note(
  out: Float64Array,
  at: number,
  hz: number,
  lenS: number,
  amp: number,
  harmonics: number[],
): void {
  const start = Math.round(at * SAMPLE_RATE);
  const len = Math.min(out.length - start, Math.round(lenS * SAMPLE_RATE));
  const atk = 0.006 * SAMPLE_RATE;
  const release = 0.03 * SAMPLE_RATE;
  for (let i = 0; i < len; i++) {
    const decay = Math.exp(-i / (lenS * 0.35 * SAMPLE_RATE));
    const tail = Math.min(1, (len - i) / release);
    const env = Math.min(1, i / atk) * decay * tail;
    let s = 0;
    harmonics.forEach((h, k) => {
      s += h * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SAMPLE_RATE);
    });
    out[start + i] += amp * env * s;
  }
}

/** Short fade to exact zero at the end, so no file stops on a non-zero sample. */
function tailFade(x: Float64Array, s = 0.005): Float64Array {
  const n = Math.round(s * SAMPLE_RATE);
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

// ---------------------------------------------------------------------------
// The voices
// ---------------------------------------------------------------------------

/** One key: a low thock bottoming out, a dry tick, and a quieter lift-off. */
function keystroke(
  out: Float64Array,
  at: number,
  r: () => number,
  opts: { pitch?: number; amp?: number; space?: boolean } = {},
): void {
  const p = opts.pitch ?? 1;
  const a = opts.amp ?? 1;
  // A spacebar is bigger and lower: the stabiliser rattle is what makes it one.
  const thock = opts.space ? 140 : 190;
  ping(out, at, thock * p, 0.011, 0.55 * a);
  ping(out, at, 1350 * p, 0.0035, 0.22 * a);
  tick(out, at, 0.0022, 0.9 * a, [1200, 4200], r);
  const up = at + (opts.space ? 0.085 : 0.068) * (0.9 + 0.2 * r());
  tick(out, up, 0.0015, 0.35 * a, [1800, 5200], r);
  ping(out, up, 2100 * p, 0.002, 0.08 * a);
}

const VOICES: Record<SfxId, (out: Float64Array, r: () => number) => void> = {
  click(out, r) {
    // Press, then a release ~55ms later at 40% — a real mouse makes both, and
    // the pair is what stops it reading as a metronome tick.
    tick(out, 0.004, 0.0012, 1, [1400, 5500], r);
    ping(out, 0.004, 2400, 0.002, 0.35);
    ping(out, 0.004, 650, 0.006, 0.28);
    tick(out, 0.059, 0.0009, 0.4, [1800, 6000], r);
    ping(out, 0.059, 2800, 0.0015, 0.12);
    lowpass(out, 6500);
  },

  key(out, r) {
    keystroke(out, 0.004, r);
    lowpass(out, 7000);
  },

  typing(out, r) {
    // Irregular on purpose: a grid of identical keys is a machine gun, a real
    // typist is 85-170ms per key with a longer breath at each word boundary.
    let t = 0.02;
    let inWord = 0;
    let wordLen = 3 + Math.floor(r() * 5);
    while (t < 2.86) {
      const space = inWord === wordLen;
      keystroke(out, t, r, {
        pitch: 0.9 + 0.22 * r(),
        amp: (space ? 0.85 : 0.6) + 0.35 * r(),
        space,
      });
      if (space) {
        inWord = 0;
        wordLen = 3 + Math.floor(r() * 5);
        t += 0.16 + 0.1 * r();
      } else {
        inWord++;
        t += 0.085 + 0.085 * r();
      }
    }
    lowpass(out, 6500);
    // The bed ends on its own rather than on a chopped key.
    const fade = Math.round(0.08 * SAMPLE_RATE);
    for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  },

  pop(out, r) {
    // A pitch glide UP, fast, with a round decay — the classic bloop. The
    // glide is what reads as "something appeared"; a flat tone reads as a beep.
    const start = Math.round(0.003 * SAMPLE_RATE);
    const len = Math.round(0.2 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const hz = 360 + 540 * (1 - Math.exp(-t / 0.012));
      phase += (2 * Math.PI * hz) / SAMPLE_RATE;
      const env = Math.min(1, i / (0.0015 * SAMPLE_RATE)) * Math.exp(-t / 0.032);
      out[start + i] += env * (Math.sin(phase) + 0.18 * Math.sin(2 * phase));
    }
    tick(out, 0.003, 0.0006, 0.25, [2000, 6000], r);
    lowpass(out, 5000);
  },

  confirm(out) {
    // The same two-note resolve the old ffmpeg recipe made (C5, then G5 45ms
    // later), with an exponential tail instead of a linear fade and a touch of
    // second harmonic for warmth.
    note(out, 0, 523.25, 0.3, 0.6, [1, 0.12]);
    note(out, 0.045, 783.99, 0.3, 0.45, [1, 0.1]);
    lowpass(out, 6000);
  },

  error(out) {
    // Descending minor third, soft and low: "no", not an alarm. Odd harmonics
    // give it a hollow, slightly square body that a pure sine lacks.
    note(out, 0, 392, 0.1, 0.8, [1, 0, 0.22, 0, 0.06]);
    note(out, 0.11, 311.13, 0.22, 0.8, [1, 0, 0.22, 0, 0.06]);
    lowpass(out, 2600);
  },
};

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------

/**
 * 4x-oversampled peak, the BS.1770 true-peak method. A sample peak misses the
 * inter-sample overs a DAC reconstructs; on transient-heavy material like a
 * click they are routinely 0.5dB+ higher, which is the whole reason the
 * ceiling is in dBTP and not dBFS.
 */
export function truePeak(x: Float64Array | Float32Array): number {
  const TAPS = 16;
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (const frac of [0.25, 0.5, 0.75]) {
    const w: number[] = [];
    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const d = k - frac;
      const hann = 0.5 + 0.5 * Math.cos((Math.PI * d) / TAPS);
      w.push((Math.sin(Math.PI * d) / (Math.PI * d)) * hann);
    }
    for (let i = 0; i < x.length; i++) {
      let s = 0;
      for (let k = -TAPS + 1; k <= TAPS; k++) {
        const j = i + k;
        if (j >= 0 && j < x.length) s += x[j] * w[k + TAPS - 1];
      }
      peak = Math.max(peak, Math.abs(s));
    }
  }
  return peak;
}

/** Render one sound, normalised to its spec's true peak. Mono. */
export function renderSfx(id: SfxId): Float64Array {
  const spec = SFX_SPECS[id];
  if (spec.peakDbtp > CEILING_DBTP)
    throw new Error(`${id}: peak ${spec.peakDbtp} dBTP is over the ${CEILING_DBTP} dBTP ceiling`);
  const out = new Float64Array(spec.samples);
  // One seed per sound, so editing one voice never reshuffles another's noise.
  VOICES[id](out, rng(0x5f3 + SFX_IDS.indexOf(id) * 7919));
  // A damped low sine starting at phase 0 integrates to a small DC step —
  // measured 0.0015 on `key` before this. Harmless alone, but it stacks when
  // a reel fires ten ticks in a row.
  highpass(out, 20);
  tailFade(out);
  const g = dbToGain(spec.peakDbtp) / truePeak(out);
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

/**
 * 16-bit PCM WAV, the mono signal on both channels (the old stock was stereo,
 * and a stereo file keeps the ffmpeg mux's channel layout what it was).
 * TPDF dither from a fixed seed, so the file is still byte-reproducible.
 */
export function encodeWav(mono: Float64Array, channels = 2): Buffer {
  const bytes = mono.length * channels * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  const r = rng(1);
  let o = 44;
  for (let i = 0; i < mono.length; i++) {
    const dither = mono[i] === 0 ? 0 : r() - r();
    const v = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767 + dither)));
    for (let c = 0; c < channels; c++, o += 2) buf.writeInt16LE(v, o);
  }
  return buf;
}
