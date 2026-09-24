# Reel docs

Everything written about the **reel** feature: the reference films taken apart,
the design records behind each look and style, and the decision logs from
building them. One analysed film per directory; shared design under `design/`.

| Path | What it holds |
| --- | --- |
| [cursor/](./cursor/README.md) | Two Cursor launch films, frame by frame — the source of `proof` and `ledger` |
| [replit/reference.md](./replit/reference.md) | The Replit film, reverse-engineered — the source of `stage` |
| [replit/plan.md](./replit/plan.md) | How `stage` was brought into the pipeline |
| [replit/decisions.md](./replit/decisions.md) | The decision log (D1–D41) from building `stage`; was `note.md` at the root |
| [design/fullbleed.md](./design/fullbleed.md) | The full-bleed look: measurements and why each constant is what it is |
| [design/fullbleed-gap-analysis.md](./design/fullbleed-gap-analysis.md) | Our first full-bleed reel measured against the reference |
| [design/audio.md](./design/audio.md) | Reel audio: music bed, SFX, loudness |
| [design/choreography-references.md](./design/choreography-references.md) | Two more films (Uber "Base", monid) and what each means for styles |
| [design/choreography-styles.md](./design/choreography-styles.md) | **Superseded** — the pre-build spec for styles; see `src/lib/style.ts` |
| [design/missing-feature.md](./design/missing-feature.md) | Backlog of what the reel pipeline does not do yet |
| [notes/capture-ceiling.md](./notes/capture-ceiling.md) | App-specific: a popover bug that blocks HD capture in one app |

Adding a film: analyse it into `docs/reel/<film>/` with
[`.agents/skills/reverse-engineer-reference/`](../../.agents/skills/reverse-engineer-reference/SKILL.md),
then add its preset to `STYLE_PRESETS` in `src/lib/style.ts`.
