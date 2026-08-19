# Reel audio — research & design

Persistent record of the audio-for-reels investigation and the implementation
design. Companion to `missing-feature.md` (item #1, P0). Phase 1 is being built;
later phases are mapped here so the thinking isn't lost.

---

## Why

Reels are silent — the biggest gap between "motion test" and "launch film". This
adds an author-declared **audio-track engine**: supply an audio file, trim it to a
sub-range (e.g. use 12–25s of a track), and place one or more pieces on the reel
timeline — sequential (A then B) *and* layered (a bed under a lead) — with
per-piece gain and fades.

## Architecture (load-bearing)

Audio is **never baked into a video segment**. It is a single **post-concat mux**:

- runs on the **system `ffmpeg`** (bare binary on PATH), never `remotion ffmpeg`
  — the bundled build is filter-whitelisted and minimal (no `afade`/`amix`/
  `acrossfade`/`loudnorm`/`signalstats`; documented in `analyze.ts`,
  `record.ts`, `shoot-demo-video/SKILL.md`). AGENTS.md already requires
  `brew install ffmpeg`.
- takes the finished silent `out/<name>.reel.mp4` as video input (input 0),
- builds one `-filter_complex` audio graph from `reel.audio[]`,
- writes `-c:v copy -c:a aac` to a temp file, renamed over the final.

This leaves untouched: the per-segment renders (all `--muted`), the `-c copy`
concat, the segment cache, and the `compareStreams` video-only invariant
(`scripts/lib/stitch.ts` rejects any non-video stream on a *segment*). A reel with
no `audio` key renders byte-for-byte as today.

---

## Research findings (ground truth)

### The pipeline today (`scripts/reel.ts`)
- Renders each segment (cards via `Intro`, clips via `DemoClip --frames`) to its
  own mp4 in `.diag/reel/<name>/`, then concatenates with the bundled ffmpeg:
  `ffmpeg -y -f concat -safe 0 -i concat.txt -c copy -movflags +faststart
  out/<name>.reel.mp4`. Stream copy, no re-encode, **no audio**.
- Every render passes `--muted`; `convert.ts` uses `-an`. Segments are single
  video-stream H.264. `render.ts` comment: without `--muted` Remotion muxes an
  empty AAC track costing ~317 kb/s of nothing.
- **Cache:** segment file `= <i>-<kind>-<digest>.mp4`, `digest = sha1(JSON.stringify
  (key)).slice(0,10)`. Card key `{segment, speed, src: sourceDigest("card")}`;
  clip key adds `footage` (sha1 of `public/<name>.mp4` + `clicks.json` bytes).
  After rendering, a **prune loop deletes any file in the workDir not in the
  `keep` set** — an audio intermediate placed there must be `keep.add(...)`ed.
- **Insertion point for the mux:** after the concat (~L279), before/around the
  final logging. Video cache stays valid because `audio[]` is in no segment key.

### ffmpeg reality
- Two binaries: **bundled** `remotion ffmpeg` (minimal, whitelisted) vs **system**
  `ffmpeg` (full). `analyze.ts` and `record.ts` `markerTrimMs` already use the
  system one for `signalstats`. **All audio filters must use system ffmpeg.**
- No committed evidence of which audio filters the system build ships, and no
  guard. Mirror `requireFfmpeg()` (`analyze.ts` L131-150): parse `ffmpeg -filters`,
  hard-fail with the `brew install ffmpeg` fix if a needed filter is missing.

### Timing / sync data (`src/lib/click-log.ts`, `src/lib/zoom.ts`)
- FPS = 30 (`scripts/reel.ts`, `src/Root.tsx`). Segment absolute start in reel
  seconds = (sum of prior segment frame counts) / FPS. Card frames =
  `introDurationInFrames(card, FPS)`; clip frames = `clipFrameCount(clip, FPS)`.
- A click-log beat at `tMs` lands at demo-video second
  `(tMs/1000)/speed - offsetMs/1000` (speed default 1.25). Clip range `{fromS,toS}`
  is in those (already-speed-baked) demo seconds.
- Reel-time of a click inside clip segment `i`:
  `segmentStartSeconds(i) + ((tMs/1000)/speed - offsetMs/1000 - fromS)`, keeping
  only beats with `fromS ≤ demoSec < toS`.
- SFX candidates (Phase 3): click → beats with `tDownMs != null`; whoosh → beats
  with `zoom !== false`, onset `tDepartMs ?? tMs`; typing → span `tMs..typeEndMs`.
- Assets via `staticFile()` resolve under `public/` (subdirs OK). `.gitignore` is
  per-extension; `.mp3`/`.wav` are NOT ignored today → **decision: gitignore
  `public/audio/` per-account** (like `reels/`, `flows/`).

---

## Feature map

| # | Feature | Tier |
|---|---------|------|
| F1 | Author-supplied audio track(s), integrated (not baked) | **Phase 1** |
| F2 | Source sub-range trim (12–25s of a file) | **Phase 1** |
| F3 | Multiple pieces, sequential | **Phase 1** |
| F4 | Multiple pieces, layered (bed under lead) | **Phase 1** |
| F5 | Per-piece placement (`start`, `end`/`duration`) | **Phase 1** |
| F6 | Per-piece gain | **Phase 1** |
| F7 | Fade in / out per piece | **Phase 1** |
| F8 | Total-length handling (audio ≠ video length) | **Phase 1** |
| F15 | Capability guard for system-ffmpeg audio filters | **Phase 1** infra |
| F16 | `reelProblem` validation of `audio[]` | **Phase 1** infra |
| F17 | `.gitignore public/audio/` (per-account) | **Phase 1** infra |
| F9 | Loudness normalization (`loudnorm`) | Phase 2 |
| F10 | Crossfade between sequential pieces (`acrossfade`) | Phase 2 |
| F11 | Ducking — bed dips under lead (`sidechaincompress` + `role`) | Phase 2 |
| F12 | Sync-to-beat anchors (snap start to a segment cut) | Phase 2 |
| F13 | Click-log auto-SFX (click/whoosh/typing) | Phase 3 |
| F14 | Loop / pad a short source to fill a span | optional |

---

## Design — Phase 1

### Schema (`src/lib/reel.ts`)
Opt-in, JSON-serializable, runtime-validated (not tsc-checked — `reels/*.ts` load
by dynamic import). Mirrors how `drift`/`label` were added to `ReelClip`.

```ts
export type ReelAudioPiece = {
  src: string;                             // path under public/, e.g. "audio/bed.mp3"
  trim?: { fromS: number; toS?: number };  // F2 source sub-range; omit = whole file
  start?: number;                          // F5 reel seconds this piece begins (default 0)
  end?: number;                            // F5 hard reel-time end …
  duration?: number;                       // F5 … XOR duration (reel seconds occupied)
  gain?: number;                           // F6 linear multiplier, default 1.0
  fadeInS?: number;                        // F7
  fadeOutS?: number;                       // F7
  pad?: boolean;                           // F14-lite: silence-pad to fill its span
};
export type Reel = { name: string; segments: ReelSegment[]; audio?: ReelAudioPiece[] };
```
Phase-2 fields (`role`, `crossfadePrevS`, `normalize`, a `ReelAnchor` union for
`start`, `loop`) are added when those land.

### Pure module (`src/lib/reel-audio.ts`, new)
No ffmpeg/Remotion imports (unit-testable, same discipline as `src/lib/reel.ts`):
- `totalReelSeconds(counts, fps)` and `segmentStartSeconds(counts, i, fps)`.
- `resolvePiece(piece, totalReelS) → { startS, sourceFromS, sourceToS, effectiveDurS }`
  applying `start` + `trim` + `end`/`duration`, clamped to the reel length.
- `buildAudioMux(resolvedPieces, videoPath, videoDurS) → { inputs: string[],
  filter: string, mapArgs: string[] }` — pure string assembly of the filtergraph.
- `requireFfmpegAudio()` — copy of `analyze.ts requireFfmpeg`; needs `afade, amix,
  adelay, volume, apad, aresample`.

### Mux step (`scripts/reel.ts`, after concat ~L279)
- No `reel.audio` → unchanged.
- `reel.audio` present → concat to `<workDir>/<name>.silent.mp4` + `keep.add`;
  `requireFfmpegAudio()`; `videoDurS = joined/FPS`; build args via `buildAudioMux`;
  `execFileSync("ffmpeg", args, {stdio:"inherit"})` → `out/<name>.reel.mp4`.
- Segment cache untouched (audio is above the segment layer). First cut: always
  re-mux (no audio cache).

### Validation (`reelProblem`)
Mirror the `drift` block: array; per piece `src` non-empty; `trim.fromS ≥ 0` and
`trim.toS > trim.fromS`; `gain`/`fadeInS`/`fadeOutS` ≥ 0; `start ≥ 0`; not both
`end` and `duration`; resolved end ≤ total reel length.

### Filtergraph + gotchas
Per piece `i` (input `i+1`; video is input 0), trim at input level:
```
-ss <trim.fromS> -to <trim.toS> -i public/audio/<src>
[<i+1>:a] aresample=48000, aformat=sample_fmts=fltp:channel_layouts=stereo,
          volume=<gain>, afade=t=in:st=0:d=<fadeInS>,
          afade=t=out:st=<effDur-fadeOutS>:d=<fadeOutS>, [apad,]
          adelay=<startMs>:all=1 [a<i>]
[a0][a1]… amix=inputs=N:normalize=0:dropout_transition=0[m]; [m] apad [aout]
ffmpeg -y -i out/<name>.reel.mp4 <-ss/-to/-i per piece> -filter_complex "<graph>" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart <tmp>.mp4
```
Gotchas: `amix normalize=0` (default halves levels) + `dropout_transition=0` (avoid
mid-reel swell); `adelay …:all=1` (else one channel delayed); `aresample=48000` +
stereo `aformat` on every piece; `afade` out `st` = effective post-trim length −
`fadeOutS` (computed in JS); `apad` mix + `-shortest` so audio never truncates the
picture; pass paths as separate argv (execFileSync) for spaces/specials; output to
a temp path then rename (can't read+write the same file).

---

## Phase 2 & 3 — IMPLEMENTED

> Status: **all shipped.** F9 loudness (`Reel.loudnessLUFS`), F12 sync-to-beat
> (`start`/`end` accept a `{ segment, edge }` anchor), F13 SFX (`Reel.sfx`), F11
> ducking (`role: "bed"` + `Reel.duck`), F10 crossfade (`crossfadePrevS`). All in
> `src/lib/reel-audio.ts` (pure) + `muxAudio` in `scripts/reel.ts`, unit-tested in
> `src/lib/reel-audio.test.ts`. The design below is the record of how each was built.
>
> **SFX palette (updated).** `Reel.sfx` is a six-sound palette, not the original
> click/whoosh/typing. Whoosh is **removed** (no camera-move SFX). Three kinds
> auto-place from the click log: `click` (a real press that isn't a typing run),
> `typing` (a bed over a real typed string, span ≥ `TYPING_MIN_MS`), and `pop`
> (the UI's response `POP_DELAY_MS` after any typed input — a menu opening). Three
> place only via `SfxCue.atLabels` (case-insensitive label match on the beat):
> `key` (Enter / a single key), `confirm` (payoff, e.g. "Allow all"), `error`.
> The stock lives in `public/audio/sfx/` (gitignored, per-machine) with a
> `manifest.json` + `README.md`; only `confirm.wav` is synthesized by
> `scripts/gen-sfx.ts` — the rest are supplied samples.

Every feature below extends the **same** Phase-1 spine (one post-concat mux on
the system ffmpeg, built by `src/lib/reel-audio.ts`, run by `muxAudio` in
`scripts/reel.ts`). They are independent and can ship one at a time.

### Recommended order (value ÷ effort)

| Order | Feature | Effort | Why here |
|---|---|---|---|
| 1 | F9 Loudness | S | Tiny; makes every reel sit at a consistent, broadcast-safe level |
| 2 | F12 Sync-to-beat anchors | M | Music/SFX land on the cuts — the thing that makes a hero film feel scored |
| 3 | F13 Auto-SFX | L | Biggest "wow"; the pipeline's unique angle (free from the click log) |
| 4 | F11 Ducking | M | **Only useful once there's a lead to duck under** (F13 SFX or a future voiceover) — ship with/after F13 |
| 5 | F10 Crossfade | M | Lowest priority: only matters with 2+ sequential music pieces |

Coupling to remember: **F11 has nothing to duck without F13** (or voiceover), so
those two are one unit. F9 and F12 are standalone "music polish."

---

### F9 — Loudness normalization  · S

**What.** Normalize the final mix to a target loudness so no reel is wildly
loud/quiet. -14 LUFS is the social/web standard.

**Schema** (`src/lib/reel.ts`): a reel-level knob, not per-piece —
`Reel.loudnessLUFS?: number` (absent = off; typical -14). Validate: finite,
roughly -30..0.

**Graph** (`src/lib/reel-audio.ts` `buildAudioMux`): when set, append
`loudnorm=I=<lufs>:TP=-1.5:LRA=11` to the mix chain right before `[aout]`.
Single-pass is fine for a bed; a two-pass (measure → apply) variant can come
later for accuracy but needs an extra probe pass. Add `loudnorm` to
`AUDIO_FILTERS` so the guard covers it.

**Test.** `buildAudioMux` emits the `loudnorm` node only when the target is set;
`audioProblem`/reel-level validation rejects a nonsense target.

---

### F12 — Sync-to-beat anchors  · M

**What.** Let a piece's `start` (and `end`) snap to a segment boundary — "start
this tune at the 4th card's cut" — instead of a hand-counted second.

**Schema** (`src/lib/reel.ts`): widen `start?: number | ReelAnchor` where
`ReelAnchor = { segment: number; edge?: "start" | "end" }` (segment is 0-based;
`edge` default `"start"`). Same for `end`. Validate: `segment` an integer in
`[0, segments.length)`.

**Module** (`src/lib/reel-audio.ts`, pure): add
`segmentBoundsSeconds(counts, fps): { startS: number[]; durS: number[] }` (prefix
sums of the per-segment frame `counts` scripts/reel.ts already probes) and
`resolveAnchor(a, bounds): number`. `resolvePiece` gains an optional `bounds`
param and resolves an anchor `start`/`end` to seconds before the existing math.

**Wiring** (`scripts/reel.ts`): pass `bounds` (from `counts`) into `resolvePiece`.
No new ffmpeg — anchors resolve to the same numeric seconds the graph already
uses.

**Test.** `resolveAnchor` maps `{segment:2}` to the cumulative start of segment 2;
`{segment:1, edge:"end"}` to its start+dur; out-of-range segment is rejected.

---

### F13 — Auto-SFX from the click log  · L

**What.** Synthesize SFX pieces straight from the demo's click log: a tick on
each real click, a whoosh on each camera zoom, a soft rattle over each typing
span. The pipeline already has the timing for free.

**Schema** (`src/lib/reel.ts`): `Reel.sfx?: SfxConfig` where
`SfxConfig = { click?: SfxCue; whoosh?: SfxCue; typing?: SfxCue }` and
`SfxCue = { src: string; gain?: number; fadeOutS?: number }`. Absent = no SFX.

**Timing** (`src/lib/reel-audio.ts`, pure): `clickReelTimes(segments, counts,
fps, log, speed, kind): number[]` — for each CLIP segment `i` with range
`{fromS,toS}`, map each qualifying beat to reel seconds:
`segmentStartSeconds(i) + ((tMs/1000)/speed - offsetMs/1000 - fromS)`, keeping
beats with `fromS ≤ demoSec < toS`. Filters by `kind`:
- `click` → beats with `tDownMs != null` (a real press; `focus()` beats lack it),
- `whoosh` → beats with `zoom !== false`, onset `tDepartMs ?? tMs`,
- `typing` → the span `tMs .. typeEndMs` (one piece per span; a short looped
  keypress or a single rattle sample).

**Wiring** (`scripts/reel.ts`): the demo's `public/<name>.clicks.json` is already
loaded for the frame-count check — reuse it. For each configured cue, turn each
computed time into a synthesized `ReelAudioPiece` (`src` = the cue's asset,
`start` = the time, `gain`, a short `fadeOutS`) and append to the resolved-pieces
array **before** `buildAudioMux`. SFX are just more pieces — the whole Phase-1
graph handles them.

**Assets & gotchas.**
- Bundled SFX under `public/audio/sfx/` (gitignored); ship a generator that makes
  placeholder ticks/whooshes with ffmpeg (`sine`/`anoisesrc` bursts) so it runs
  without hunting for files.
- **Cold-open dedup:** a cold-open clip replays footage a later clip covers — the
  same click would fire twice. Skip beats inside `coldOpenIndex` (already in
  `reel.ts`), or dedup by reel-time.
- **Input count:** dozens of SFX means an `amix` with dozens of inputs and a long
  argv. If it gets unwieldy, pre-render the SFX layer to one intermediate wav
  (its own `adelay`+`amix` pass) and mix that single layer with the music.

**Test.** `clickReelTimes` places a click's reel-time correctly for a known
`counts`/`log`/`speed`, filters `focus()` beats out of `click`, and drops
cold-open duplicates.

---

### F11 — Ducking (bed under lead)  · M — ship with F13

**What.** The music bed dips automatically while a lead/SFX plays, then recovers.

**Schema** (`src/lib/reel.ts`): `role?: "bed" | "lead" | "sfx"` per piece
(SFX synthesized as `"sfx"`); a reel-level `Reel.duck?: { thresholdDb?, ratio?,
attackMs?, releaseMs? }` with sane defaults.

**Graph** (`src/lib/reel-audio.ts`): split the pieces into beds vs leads/sfx; sum
the leads as a sidechain and `sidechaincompress` the summed beds by it, then
`amix` the ducked beds with the leads. Add `sidechaincompress` to `AUDIO_FILTERS`.

**Test.** With a bed + a lead, the graph routes the lead into the sidechain input;
with beds only, no ducking node is emitted.

---

### F10 — Crossfade between sequential pieces  · M — lowest priority

**What.** Blend the tail of one music piece into the head of the next
(`crossfadePrevS`), for a seamless track change mid-reel.

**Schema** (`src/lib/reel.ts`): `crossfadePrevS?: number` on a piece.

**Graph** (`src/lib/reel-audio.ts`): adjacent pieces flagged for crossfade are
combined with `acrossfade=d=<overlap>` into one node **before** placement — note
`acrossfade` consumes both tails and shifts the pair's effective end, so the
group is placed as a unit and later pieces' reel-times account for the overlap.
Add `acrossfade` to `AUDIO_FILTERS`.

**Test.** Two crossfade-flagged pieces produce one `acrossfade` node feeding the
mix; the pair's occupied length is `durA + durB − overlap`.

---

### Verification (each phase)
Same loop as Phase 1: `pnpm test` (new pure-fn tests), `pnpm lint`, silent-path
regression (no `audio`/`sfx` → byte-identical), then an end-to-end cut with a real
spec + `ffprobe`/`volumedetect` to confirm the audible result (level for F9, a
piece starting on a cut for F12, a tick landing on a click for F13, the bed
dipping under a lead for F11, a seamless join for F10).

## Verification (Phase 1)
1. `pnpm test` — unit tests for `resolvePiece` (trim/start/end/clamp) + `reelProblem` audio cases.
2. `pnpm lint`.
3. Silent-path regression: a reel with no `audio` produces a byte-identical `.reel.mp4` (shasum).
4. Single bed (trim 12–25s, fades): `ffprobe` shows one AAC stream, duration equals the video's, audibly the slice fading in/out.
5. Layered bed + lead: no mid-reel swell (proves `normalize=0`/`dropout_transition=0`), no truncated tail (proves `apad`/`-shortest`).
6. Guard: a reel with `audio` on a filter-less ffmpeg fails fast with the `brew install ffmpeg` message.
