# Reference reel analysis

Frame-level reverse-engineering of two Cursor feature films, and what they mean
for this repo's Remotion + Playwright pipeline.

| Doc | What it holds |
| --- | --- |
| [00-executive-summary.md](./00-executive-summary.md) | The findings that change what we build |
| [01-timeline.md](./01-timeline.md) | Complete shot-by-shot timeline of both films, frame-exact |
| [02-motion.md](./02-motion.md) | Transitions, easing, the one curve, micro-interactions |
| [03-composition.md](./03-composition.md) | Typography, colour, UI treatment, framing, cursor |
| [04-design-system.md](./04-design-system.md) | The extracted motion-design system + scene graph + video recipe |
| [05-remotion-playwright.md](./05-remotion-playwright.md) | Implementation mapping and reusable component architecture |
| [06-comparison.md](./06-comparison.md) | Reference vs. our current pipeline, every axis |
| [07-gap-analysis.md](./07-gap-analysis.md) | The **shipped** reel re-measured against both references (supersedes 06's figures) |

## The two references

| | **Film A** — "Agent UX improvements" | **Film B** — "Origin / Code Hosting" |
| --- | --- | --- |
| File | `cursor-agent-ux-imrpovments-intro.mp4` | `cursor_origin_intro.mp4` |
| Resolution | 1920×1080 | 1920×1080 |
| Frame rate | 30 fps (CFR) | 30 fps (CFR) |
| Length | 1316 f · 43.867 s | 927 f · 30.900 s |
| Audio | AAC 48 kHz stereo, −31.3 LUFS | **none** (no audio stream) |
| Bitrate | 736 kbps | 838 kbps |
| Shots / cuts | 12 / 11 | 17 / 16 |
| Mean shot | 3.66 s | 1.82 s |
| Cut rate | 15.0 /min | 31.1 /min |
| Moving frames | 24.1 % | 36.8 % |
| Look | full-bleed footage, black cards | framed window on a backdrop, white/grey/black cards |

**These are two different films in two different grammars**, not one style with
variation. Film A proves features by showing product footage edge-to-edge
between black title cards. Film B narrates a launch with sentences that
*contain* live UI, punches into them, and isolates individual components on a
flat ground. Both share one motion curve, one word cadence, and zero dissolves.

## Relationship to existing docs

`docs/design/reels/fullbleed.md` already measured Film A when `look: "fullbleed"`
was built, and `fullbleed-gap-analysis.md` compared our first full-bleed reel
against it. **This analysis does not replace them** — it extends them:

- Film A's push envelope, card cadence, and 62–63-frame tail were measured
  there first, and this pass independently reproduces them. Where the numbers
  agree, that is stated.
- New here for Film A: the logo bookend cards, the 3D mark tumble, the recap
  card's exact schedule, the audio bed, and one measurement discrepancy
  (motion percentage — see [02-motion.md](./02-motion.md#discrepancy--resolved-and-the-metric-was-the-bug)).
- Film B had never been analysed. Everything about it here is new.

## Method

Every number below came from one of these, run against the delivered MP4s:

| Measurement | How |
| --- | --- |
| Shot boundaries | per-frame mean luma + full-resolution frame differencing |
| Moving frames | `tblend` difference, **threshold each pixel at 8/255, then count**; a frame moves when > 0.2 % of pixels changed |
| Text reveal timing | binary-threshold ink mass on a 96×54 reduction, step detection |
| Element position / travel | binary-threshold bounding box collapsed to one axis (`scale=1920:1` / `scale=1:1080`) |
| Chip / window scale | threshold to the element's fill colour, 3× erosion + 2× dilation to kill antialiasing, then longest run |
| Colour | 6×6 pixel average at a named coordinate, RGB24 |
| Audio | `ebur128`, `astats`, `silencedetect` |

Caveats that bound every claim:

- **Both files are heavily compressed** (736/838 kbps for 1080p30). "No fade"
  means *no fade measurable at this bitrate*. A sub-2 % opacity ramp would not
  survive the encoder.
- Bounding-box measurements taken through an area-scaled reduction lose thin
  antialiased strokes. **Frame-to-frame deltas are reliable; absolute extents
  are not**, because the same glyphs are compared against themselves. Where an
  absolute figure is quoted it was taken from a full-resolution single frame.
- Rotation, 3D transforms, and blur cannot be recovered exactly from a raster.
  Where they appear, the claim is labelled INFERRED.
- **Motion must be measured by counting changed pixels, not by averaging the
  difference.** Mean absolute difference (`signalstats` YAVG) is amplitude-based
  and not bitrate-invariant: it scored our 502 kbps/1440p reel at 52 % moving
  against the references' 28 % on comparable content, when in fact no pixel on
  the worst card changed by more than 6 levels. Every motion figure in these
  docs uses the per-pixel-threshold metric. See
  [02-motion.md](./02-motion.md#discrepancy--resolved-and-the-metric-was-the-bug).

## Confidence legend

Used inline throughout.

| Tag | Means |
| --- | --- |
| **OBSERVED** | Directly visible in a frame. Look at the frame and you see it. |
| **MEASURED** | A number produced by the pipeline above, reproducible from the MP4. |
| **INFERRED** | A likely implementation consistent with the evidence, not proven by it. |
| **UNKNOWN** | Cannot be determined from a rendered video at this bitrate. |

Anything not tagged is structural narration, not a claim.
