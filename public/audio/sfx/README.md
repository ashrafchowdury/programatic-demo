# Reel interaction-SFX stock

The sound palette placed on reels by `Reel.sfx` (see `src/lib/reel.ts`). Files are
`<key>.wav` — the stem matches the `ReelSfx` key that places them. `manifest.json`
is the source of truth (trigger, detector, gain, provenance).

`public/audio/` is **committed** — the stock ships with the repo so a fresh clone
can score a reel without hunting for files.

## Provenance

**Every SFX here is synthesized** by `scripts/gen-sfx.ts` (voices in
`scripts/lib/sfx-synth.ts`) — no samples, no third-party audio, so each file is
an original work of this repo with no licence to trace. Regenerate with:

```bash
pnpm exec tsx scripts/gen-sfx.ts            # all six
pnpm exec tsx scripts/gen-sfx.ts click pop  # just these
pnpm exec tsx scripts/build-sfx-preview.ts <out.html>   # a listen-through page
```

Output is deterministic (seeded noise), 48 kHz stereo 16-bit. Each sound keeps
the exact sample length and the max momentary loudness of the supplied sample it
replaced, so reel timing and the SFX gains tuned in existing reels still hold;
every peak is under -1 dBTP. The table of old vs new is in `SFX_SPECS`.

## ⚠️ `../intro.mp3` — licence unverified, do not publish

The music bed is **not** generated and cannot be. It was supplied from an online
source and its licence has **never been verified**. **Do not publish any reel
using it until it is traced to a licence or replaced.** Reels that reference it
(all local, `reels/` is gitignored):

- `reels/harness.ts`
- `reels/agent-schedule.ts`
- `reels/agent-schedule-stage.ts`
- `reels/agent-tool.ts`

(`reels/agent-slash-command.ts` names `audio/slash-theme.mp3`, which is not in
the repo at all.)

## Placement (how each is wired)

| key | detector | fires on |
| --- | --- | --- |
| `click`   | auto | a real press that isn't a typing run |
| `typing`  | auto | a typed string (span ≥ 500ms), as a bed |
| `pop`     | auto | UI response ~120ms after any typed input |
| `key`     | authored | beats matched by `atLabels` (e.g. Enter) |
| `confirm` | authored | beats matched by `atLabels` (e.g. "Allow all") |
| `error`   | authored | beats matched by `atLabels` |

Enable on a reel:

```ts
sfx: {
  click:   { src: "audio/sfx/click.wav" },
  typing:  { src: "audio/sfx/typing.wav", gain: 0.35 },
  pop:     { src: "audio/sfx/pop.wav" },
  confirm: { src: "audio/sfx/confirm.wav", atLabels: ["Allow all"] },
},
duck: true,          // bed dips under the SFX
loudnessLUFS: -14,   // normalize the final mix
```
