# The capture ceiling — an app-side bug that halves every demo's resolution

**This is a report about the Agenta app, not about this repo.** Nothing in the
recording pipeline can fix it, and it is the single biggest quality limit on
every demo video we shoot.

---

## The symptom

Demo footage renders soft. Measured on `agent-tool`: the app's UI text arrives
at 1.34–1.68× upscale depending on how the shoot is sized, and at native
resolution the letterforms are visibly blurred.

## Why it cannot be fixed by shooting differently

`stage` frames footage in a window at `windowFit` and never crops, so the output
panel is always `0.84 × 2560 = 2150 px` wide. That fixes two things to the same
ratio:

```
upscale        = 2150 / capture_width
UI text height = 14 CSS px × (2150 / capture_width)
```

They are the **same number**. A sharper shoot is always a smaller one:

| capture width | upscale | app UI text, viewed at 1080p |
| --- | --- | --- |
| 1280 | 1.68× | 17.6 px — readable, soft |
| 1600 | 1.34× | 14.1 px — the current compromise |
| 1920 | 1.12× | 11.8 px — sharp, too small to read |

Cropping does not escape it either: crop to a fraction `f` and the magnification
becomes `2150 / (f × capture_width)`, so any framing that makes text readable
lands back on ~1.7×. The constraint is **source pixels per CSS pixel**, and no
composition changes that.

## The fix, and what breaks it

More source pixels per CSS pixel is exactly what `CAPTURE_SCALE` provides:
record at a larger physical viewport while the app lays out at its logical size,
by applying a root `zoom` equal to the enlargement. Measured on the smoke
fixture, capturing at 2560 with zoom 1.333 carried **+108% edge energy** in the
app region over the 1920 capture upscaled. That is real detail.

**It is blocked by one thing: floating portals do not survive a root zoom.**

A popover positioned by a computed offset — Radix / floating-ui reading
`getBoundingClientRect`, which under `zoom` *already returns zoomed pixels* —
has the root zoom applied to that offset a **second time**.

### Measured, twice, on two different flows

**`agent-schedule`, the cadence popover:**

```
scale 1   586 px wide, correctly positioned
scale 2   2344 px wide   (should be 1172)
scale 3   5274 px at x=6462 of a 5760-wide viewport — entirely off-screen
```

**`agent-tool`, the "Add tool" dropdown, at scale 2:** every selector resolves,
`prepare` completes, and the overflow probe reports `v=1 h=1 ✓ layout fits` —
and the menu renders against the **right edge of the frame** instead of under
the `+` button it belongs to.

### Why this is nastier than it sounds

**It is invisible to every automated check.** `vOverflow` and `hOverflow` both
read 1.000. The page lays out perfectly. Playwright still finds and clicks the
menu items, so the selector check prints green ticks. Anything positioned by CSS
inset — a full-height drawer, a modal, the app picker panel — is pixel-correct
at every scale.

So a probe that opens a drawer and measures it will report that HD capture works
on an app whose demo popovers have moved. **The only way to catch it is to look
at a rendered frame.**

## What we need

Portals positioned so their offset is computed in the same coordinate space the
root `zoom` will then scale — i.e. not double-applying the zoom to a
`getBoundingClientRect` reading. Anything that makes floating-element positioning
zoom-aware would do it.

## What it would unlock

`CAPTURE_SCALE` 2–4 across every demo in this repo. At scale 2 the app renders
with **twice the pixels per CSS pixel**, which removes the whole table above:
1280-logical layout (17.6 px readable text) captured at 2560 physical, rendered
into a 2150 px panel, is a **0.84× downscale** rather than a 1.68× upscale.
Sharp *and* readable, which is currently impossible.

It is also the reason `agent-schedule` could never frame its drawer the way the
monid reference frames its components — see
`docs/reels/chorography/replit.md` §8 and the note in `flows/agent-schedule.ts`.

## Where the pipeline side already lives

- `scripts/lib/capture-scale.ts` — the mechanism, and failure mode 3 is this bug.
- `src/lib/crop.ts` — `SHARPNESS_CEILING = 1.74`, the measured limit we work under.
- `flows/agent-tool.ts` — the viewport note, with the table above.
