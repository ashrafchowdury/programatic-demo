# Compiler validation

Written by `pnpm brief:golden --check`. Each hand-made launch is
rebuilt from a brief and measured against the original. Cut parity compiles
against the hand flow's click log and compares clips in order, by the beats
they show, plus length against the house maximum and (cut mode) metrics;
footage parity compares a composed take with the hand take. Segment shapes
are listed as information only: the compiler keeps one shape. See
`openspec/changes/post-to-reel-compiler/design.md` §12.

Mode: **check** (clip ranges, length).

Houses: `agenta@1` (stage), `agenta-classic@1` (classic), `agenta@2` (one-take).

| launch | house | clips in tolerance | length (house max) | metrics | footage | shape | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agent-schedule-stage | agenta@1 | 5/5 | 23.67s (30s) | not run | not run | differs (info) | **pass** |
| agent-skill | agenta-classic@1 | 4/4 | 22.27s (30s) | not run | not run | differs (info) | **pass** |
| agent-slash-command | agenta-classic@1 | 2/2 | 13.27s (30s) | not run | not run | differs (info) | **pass** |
| agent-tool | agenta@1 | 1/2 | 12.80s (30s) | not run | not run | differs (info) | **fail** |

Unsupported in this version (no house is built on their style):

- `agent-schedule` (`ledger`): the compiler emits `classic` and `stage` reels only; `ledger` needs crop or push derivation, which is out of scope.
- `harness` (`proof`): the compiler emits `classic` and `stage` reels only; `proof` needs crop or push derivation, which is out of scope.

Tolerances:

- pressS: ±0.3s. about 10x the measured re-shoot spread (~0.03s).
- startS: ±0.35s. the spread of hand clip leads on stage.
- endS: ±0.75s. hand ends follow the camera settling, not a beat.
- length: at most the house maximum.
- metric meanShotS: no worse than the hand cut by more than 0.6. one card's length either way.
- metric cutsPerMin: no worse than the hand cut by more than 6. two boundaries in a 20s film.
- metric movingFrac: no worse than the hand cut by more than 0.1. ten points of moving frames.
- metric longestStillF: no worse than the hand cut by more than 15. half a second at 30 fps.
- metric footageLongestFrozenS: no worse than the hand cut by more than 0.5. half a second of dead air in footage.

## agent-schedule-stage

Brief `reels/golden/agent-schedule-stage.brief.json` under `agenta@1`; hand flow `agent-schedule`, hand reel `reels/agent-schedule-stage.ts`.

| clip | shows | compiled (demo s) | hand clip | hand (demo s) | Δ start | Δ end | ok |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Add schedule → name the schedule | 1.34-5.70 | 1 | 1.20-4.40 | - | - | deliberate: the hand cut leaves at 4.4s as the name starts to land, dropping the typing the reel measured as dead air, instead of after the typing ends |
| 2 | open cadence → Daily | 5.80-8.72 | 2 | 5.80-8.30 | +0.00 | +0.42 | yes |
| 3 | open 09:00 → pick 08 | 8.82-11.63 | 3 | 8.90-11.20 | -0.08 | +0.43 | yes |
| 4 | close cadence | 12.17-13.57 | 4 | 12.00-13.90 | +0.17 | -0.33 | yes |
| 5 | Create schedule | 18.08-19.78 | 5 | 17.90-19.80 | +0.18 | -0.02 | yes |

Length 23.67s against the house maximum 30s: within. (Hand reel: 19.50s, for information.)

Shape (information, never a failure): different.

- compiled: card · card · clip · card · clip · card · clip · card · clip · card · clip · card
- hand: card · clip · clip · clip · clip · clip · card · card

## agent-skill

Brief `reels/golden/agent-skill.brief.json` under `agenta-classic@1`; hand flow `agent-skill`, hand reel `reels/agent-skill.ts`.

| clip | shows | compiled (demo s) | hand clip | hand (demo s) | Δ start | Δ end | ok |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Add skill | 1.45-2.99 | 1 | 1.45-3.15 | +0.00 | -0.16 | yes |
| 2 | name the skill → describe the skill | 4.50-8.90 | 2 | 4.50-8.90 | +0.00 | +0.00 | yes |
| 3 | write SKILL.md | 9.64-12.38 | 3 | 9.00-12.40 | - | - | deliberate: the hand cut enters 0.68s before the write SKILL.md press, on the click into the editor and its focus (9.0-9.5s), the only motion that shot has |
| 4 | Create | 18.02-20.80 | 4 | 18.05-20.80 | -0.03 | +0.00 | yes |

Length 22.27s against the house maximum 30s: within. (Hand reel: 21.50s, for information.)

Shape (information, never a failure): different.

- compiled: card · card · clip · card · clip · card · clip · card · clip · card
- hand: card · clip · card · clip · card · clip · card · clip · card

## agent-slash-command

Brief `reels/golden/agent-slash-command.brief.json` under `agenta-classic@1`; hand flow `agent-slash-command`, hand reel `reels/agent-slash-command.ts`.

| clip | shows | compiled (demo s) | hand clip | hand (demo s) | Δ start | Δ end | ok |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | type slash → hover /model | 1.94-6.45 | 1 | 1.85-8.35 | +0.09 | - | yes (end inside hand clip 1, which has no cut there) |
| 2 | click /permissions | 6.55-8.09 | 1 | 1.85-8.35 | - | -0.26 | yes (start inside hand clip 1, which has no cut there) |

Length 13.27s against the house maximum 30s: within. (Hand reel: 15.10s, for information.)

Shape (information, never a failure): different.

- compiled: card · card · clip · card · clip · card
- hand: card · card · card · clip · card · card

## agent-tool

Brief `reels/golden/agent-tool.brief.json` under `agenta@1`; hand flow `agent-tool`, hand reel `reels/agent-tool.ts`.

| clip | shows | compiled (demo s) | hand clip | hand (demo s) | Δ start | Δ end | ok |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Add tool → Third-party integration | 1.27-3.93 | 1 | 0.40-5.30 | - | - | deliberate: the hand cut opens 1.07s before Add tool, on the configuration panel reading Tools: None, the premise the reel argues from |
| 2 | search 1327 apps → GitHub app | 5.24-8.48 | 2 | 5.50-11.20 | -0.26 | -2.72 | **no** |

Length 12.80s against the house maximum 30s: within. (Hand reel: 28.57s, for information.)

Shape (information, never a failure): different.

- compiled: card · card · clip · card · clip · card
- hand: card · card · card · clip · card · card · clip · card · card · card

<!-- hand-written below this line is kept across golden runs -->

## Seed log

Each change to a house seed, and the golden result that justified it. Cut
parity is measured in check mode: compiled against the hand flows' click
logs, clip edges in order by the beats they show (design §12).

**Starting point** (the design's measured seeds): all four launches compiled;
`agent-skill`, `agent-slash-command` and `agent-schedule-stage` passed; `agent-tool`
failed clip 2 at start -0.36s and end -1.06s.

`agenta-classic@1`: no seed changed. Both classic launches pass on the
design's seeds (largest edge delta -0.26s, on agent-slash-command's end), so
nothing was fitted to them.

`agenta@1`, three changes, from these measured windows (demo seconds; a seed
passes a clip when every compared edge is within start ±0.35s, end ±0.75s):

| seed | before | after | window that passes | measured from |
| --- | --- | --- | --- | --- |
| `cut.leadS` | -0.30 | -0.20 | -0.29 to -0.03 | agent-tool clip 2 enters 0.06s after "search 1327 apps", so the lead must be ≥ -0.29; agent-schedule-stage clips 4 and 5 start 0.37-0.38s before their presses, so ≤ -0.03. -0.20 sits inside with room both ways. |
| `cut.tailS` | 1.50 | 1.20 | 0.78 to 1.52 | agent-schedule-stage: "pick 08" (10.43s) is cut at 11.20s, so ≤ 1.52; "close cadence" (12.37s) at 13.90s, so ≥ 0.78. 1.50 passed by 0.02s; 1.20 is near the middle. |
| `cut.typingTailS` | 0.76 | 1.80 | 1.07 to 2.57 | agent-tool clip 2 holds the narrowed action list 1.82s past the last keystroke (9.38s to 11.20s). 0.76 is the classic measurement (agent-skill), kept in `agenta-classic@1`. |

`agenta@1` gate tolerances, from the two hand stage reels against the stage
targets (analyze --reel): worst deviations meanShotS 1.77, cutsPerMin 17.7,
movingFrac 0.474, longestStillF 21. Set to 2, 20, 0.5 and 60. longestStillF
stays 60, not 30: the two example launches on public-site footage reach 52-59,
and no Agenta launch has been measured.

`agenta-classic@1` now renders 16:9 and 9:16 (an approved artifact edit).

**Frozen.** v1 hashes after these changes: `agenta@1` ff411421ef76f8d8,
`agenta-classic@1` 48d2d30e002a2417 (`src/lib/house.test.ts`). Any later
change publishes `@2`.

**Result:** all four launches pass cut parity in check mode. Card and
segment shapes differ for all four and are listed above as information.
Motion metrics (cut mode) and footage parity (full mode) are not run yet:
the full mode needs a signed-in Agenta session.

## Agenta v0.122.8 (product change, pending re-record)

The actions were re-ported to Agenta v0.122.8 on a dedicated demo agent:
"Add skill" and "Add automation" now open menus, Tools became Integrations,
and clicking a connected app adds it at once, so tools.add-integration no
longer has a "search the actions" beat. The agent-tool golden brief now shows
"search 1327 apps" through "GitHub app", and fails cut parity against the hand
log recorded on the earlier version (its second clip ends 2.7s before the
hand cut). Per design §12 that comparison is across product versions and is
not a compiler result: it stands until the hand logs are re-recorded on
v0.122.8 and the hand reels re-cut against them.

## Render regression (task 11.3)

`pnpm reel agent-skill` re-rendered on the finished change, measured with
`pnpm analyze --json`, against the render captured before the change (1.3):
`pnpm analyze --compare .diag/brief/baseline/agent-skill.analyze.json
.diag/brief/after/agent-skill.analyze.json`. Every total is unchanged:
8 segments, 21.5s, meanShotS 2.688, cutsPerMin 19.53, movingFrac 0.445,
longestStillF 47, meanAbsLumaJump 56.8, footageOnset1Max 0.066, 5 hard cuts,
2 dissolves; all 22 rows read `=`. All 9 segments were served from the segment
cache, whose key hashes every source file that draws a segment, so no file in
the render path changed; the join and audio passes ran again.
