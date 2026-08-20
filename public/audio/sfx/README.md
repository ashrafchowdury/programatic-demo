# Reel interaction-SFX stock

The sound palette placed on reels by `Reel.sfx` (see `src/lib/reel.ts`). Files are
`<key>.wav` — the stem matches the `ReelSfx` key that places them. `manifest.json`
is the source of truth (trigger, detector, gain, provenance).

`public/audio/` is **committed** as of the un-ignore — the stock ships with the
repo so a fresh clone can score a reel without hunting for files. Two provenance
classes, and the second one is an open risk:

- **`confirm.wav`** is synthesized and reproducible: `pnpm exec tsx scripts/gen-sfx.ts`.
- **The rest** (`click`, `typing`, `pop`, `key`, `error`) were supplied from online
  sources with **licenses that have never been verified**. They were kept out of
  git for exactly that reason; committing them was a deliberate call, not a
  clearance. Anything published from this repo carries that risk until each file
  is traced to a license or swapped for a CC0 equivalent (e.g. the Kenney
  interface-sounds pack, CC0).

`../intro.mp3` — the music bed — has the same unverified status.

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
