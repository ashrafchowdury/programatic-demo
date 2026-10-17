# Tasks

## 1. Baseline and fixtures

- [x] 1.1 Capture `pnpm reel <name> --check` output for all six existing reels into `.diag/brief/baseline/` (gitignored), and verify each file is non-empty. This is the baseline for 2.2 and 7.3.
- [x] 1.2 Capture the flow baseline: run `pnpm record:live <flow> --check` for `smoke`, `skillsmp-search` and `agent-skill`, and save each run's selector-resolution lines (target → rung, and the final "all selectors resolved" line) to `.diag/brief/baseline/flows/`. Strip timings so reruns diff cleanly. Verify that all three resolve and their files are non-empty. This is the baseline for 4.9 and 11.2. (`smoke` and `skillsmp-search` were captured before the change; `agent-skill`'s session had expired then, so its baseline is its first passing signed-in run, taken after the change on the dedicated demo agent under Agenta v0.122.8.)
- [x] 1.3 Capture the rendered baseline: re-render `pnpm reel agent-skill` from the current working tree, which is not `HEAD` (see AGENTS.md), then run `pnpm analyze out/reel/agent-skill.mp4 --json .diag/brief/baseline/agent-skill.analyze.json`. Verify the JSON has the reel-mode totals. This is the baseline for 11.3.
- [x] 1.4 Add synthetic click-log fixtures to `src/lib/__fixtures__/` (`brief-basic.clicks.json`: click, typing and repeated-label beats; `brief-reshoot.clicks.json`: the same labels shifted +1.04s), with no account data. Verify `pnpm lint` passes.

## 2. End-edge beat anchors

- [x] 2.1 Add `toEdge?: "press" | "typeEnd"` to `ClipAnchors`, and honour it in `resolveClipRange` (a problem when the beat has no `typeEndMs`). Verify with new cases in `src/lib/reel.test.ts`: default unchanged, `typeEnd` resolves, a non-typing beat is rejected.
- [x] 2.2 Re-run `--check` for all six reels and diff against the 1.1 baseline. Verify there are no differences.
- [x] 2.3 Document `toEdge` in the `ClipAnchors` doc comment and in AGENTS.md's reel commands paragraph. Verify `pnpm lint` passes.

## 3. House styles

- [x] 3.1 Create `src/lib/house.ts`:
  - the `House` type: brand block plus cut, pacing, audio and aspect numbers;
  - `HOUSES` with `agenta@1` (`stage`, 16:9 + 9:16, bed + SFX, −14 LUFS) and `agenta-classic@1` (`classic`, 16:9 + 9:16);
  - `HOUSE_DEFAULT`;
  - `resolveHouse(id)`.

  Seed the numbers from the design's measurements. Verify with `src/lib/house.test.ts`: lookup, unknown version, every base style in `STYLE_PRESETS`, and every audio `src` existing under `public/`.
- [x] 3.2 Add the immutability guard: a test that hashes each published version. Verify by temporarily editing a field: the test fails, then passes once the edit is reverted.
- [x] 3.3 Point the intro-reel skill's copy-length guidance at `src/lib/house.ts`. Verify the skill restates no number that contradicts the house.

## 4. Actions, surfaces and composition

- [x] 4.1 Create `scripts/lib/action.ts`:
  - `defineSurface`, `defineAction`, with parameter schema types and `example` params;
  - registry loading from `surfaces/` and `actions/`;
  - labels that may carry a control text (a literal or `{ param }`) and an optional per-action viewport;
  - `actionProblems(action)`, the static contract check (including a control that names an unknown parameter).

  Verify with `scripts/lib/action.test.ts` on committed `surfaces/example-*` and `actions/example-*`, built against the public sites the committed flows already use.
- [x] 4.2 Add `strictPrepare?: boolean` to `Flow`. Make `record.ts` abort before the clock starts, writing nothing, when it is set and `prepare` throws. Verify with a unit test using a throwing `prepare`, plus a hand-written-flow test that still logs and continues.
- [x] 4.3 Implement `composeFlow(footage, registry, house) → Flow`: surface fields, sequential strict prepare, establish beat, action steps with the house gap between them, union of `mutates`, declared labels, and the one viewport every action resolves to (an action's own, else the surface's). A missing surface env key, or two viewports in one footage, is an error naming the key or each action's size. Verify with tests: two-action order, determinism, the missing-key error, the viewport conflict and an action keeping its own size.
- [x] 4.4 Add the post-record label check: the click log's labels must equal the declared labels, and a mismatch fails, naming the first difference and its action. Verify with a fixture log that has a missing label.
- [x] 4.5 Make `loadFlow` fall back to composing from `reels/<name>.brief.json` (footage) when there is no `flows/<name>.ts`, printing a notice when both exist. Verify `pnpm record:live <example-brief> --check` composes and resolves on the example surface.
- [x] 4.6 Create `scripts/actions-check.ts` (`pnpm actions:check [ids...]`): per action, compose a one-action flow from `example` params, run check mode, then run `prepare` again. It reports per action and exits non-zero on any failure. Verify it on the example actions, then break one selector and confirm only that action fails.
- [x] 4.7 Add the hygiene test (`scripts/lib/action-hygiene.test.ts`): scan `actions/` and `surfaces/` for URLs, hostnames and id-shaped literals, failing with file:line. Verify it fails on a planted URL and passes once the URL is removed.
- [x] 4.8 Add the surface keys to `.env.example`, and document `actions/` and `surfaces/` in AGENTS.md (Layout, plus a Rules entry: committed, no account data, hygiene test; `flows/` stays gitignored). Verify `pnpm lint` and `pnpm test` pass.
- [x] 4.9 Re-run the 1.2 flow checks (`smoke`, `skillsmp-search`, `agent-skill`) after the `strictPrepare` and `loadFlow` changes (4.2, 4.5), and diff against the baseline. `agent-skill` has no pre-change baseline (see 1.2), so its comparison here is post-change only: it proves the run repeats, not that the change left it unchanged. Verify there are no differences, and that no "composed from brief" notice is printed for any of the three.

## 5. Brief schema and validation

- [x] 5.1 Create `src/lib/brief.ts` with the `Brief` types and `briefProblems(value, ctx)`, covering:
  - closed schema, `footage` xor `demo`, and `source` naming an existing post file;
  - surface, action and params against the registry;
  - beat count, word ranges, emphasis, banned words;
  - label resolution (declared or click log; exact, case-insensitive, `#n`, near misses);
  - ordering, payoff token and position;
  - the payoff chip naming a label with a declared control (footage), or `payoff.text` present (demo) and absent on footage.

  Verify with `src/lib/brief.test.ts`: one case per scenario in `specs/reel-brief/spec.md`, including several problems reported in one pass.
- [x] 5.2 Add `briefLabels` (from footage or a click log) and an action catalog printer (id, params, labels). Verify with unit tests on the example registry and `brief-basic.clicks.json`.

## 6. Compiler

- [x] 6.1 Create `src/lib/compile-brief.ts`: `compileBrief(brief, log, house) → { reel, sources } | { problems }`, applying design §10 (structure, anchors with `toEdge`, caps, gap pull-in, tone plan, payoff chip and `open`, house audio, `style`, `aspect`); the pill reads the control text, never the label. Verify with `src/lib/compile-brief.test.ts`: the eight-segment structure, a typing anchor, tone plan, chip `open`, the pill's control text, a cap report, an overlap error mapped to its brief path, the bed fitted to the reel length, confirm on the payoff label.
- [x] 6.2 Verify determinism and the re-shoot guarantee: two compiles are deep-equal, and the reshoot fixture shifts every clip by exactly +1.04s.
- [x] 6.3 Run every compiled reel through `resolveReel` and `reelProblem` in each house aspect. Verify no problems for valid briefs, with `audioProblem` clean.

## 7. Brief and reel CLI

- [x] 7.1 Create `scripts/brief.ts`: `pnpm brief <name> [--json] [--emit [--force]]` and `pnpm brief --actions [surface] | --labels <demo>`. It validates, compiles and prints the `--check` report, plus length against the house maximum. `--emit` writes `reels/<name>.ts` with a provenance header. Verify on a scratch `demo` brief for `agent-skill`: the report prints, `--json` parses, and a second `--emit` exits non-zero.
- [x] 7.2 In `scripts/reel.ts`, fall back to the brief and render every house aspect (with `--aspect=` limiting to one), noticing when the `.ts` wins. Verify the scratch brief writes `out/reel/<name>.mp4` and `.9x16.mp4`.
- [x] 7.3 Re-run the 1.1 regression. Verify all six hand-written reels' `--check` output is unchanged.
- [x] 7.4 Add the `brief`, `launch`, `actions:check` and `brief:golden` scripts to `package.json`, and document briefs in AGENTS.md (three-features table, Commands). Verify the documented commands run as written.

## 8. Launch pipeline

- [x] 8.1 Create `scripts/launch.ts` with stages validate → compose → check → record → convert → render-demo → compile → render-reel → gate, each a function returning outputs or problems. `out/launch/<name>/status.json` is written after every stage, and `demo` briefs skip the shoot stages. Verify with an end-to-end run on an example-surface brief.
- [x] 8.2 Add `--from <stage>`, which refuses when a needed output is missing and names the stage that makes it. Verify with `--from compile` after a full run (no re-record) and on a fresh name (refused, naming record).
- [x] 8.3 Implement the gate stage over `scripts/lib/motion-metrics` against style `targets` with house tolerances, per aspect, plus the length and cap checks. Verify with a test that feeds a metrics fixture over tolerance and expects a named failure.
- [x] 8.4 Verify reproducibility: run `--from compile` twice and diff the `--check` reports. Expect them to be identical.

## 9. Agenta actions and golden validation

- [x] 9.1 Write the Agenta surfaces and actions that re-express the four golden flows: `skills.add` (agent-skill), `chat.slash-command` (agent-slash-command), `tools.add-integration` (agent-tool), `schedules.add` (agent-schedule). Labels and internal pacing come from the hand flows, and each `prepare` verifies. Verify `pnpm actions:check` passes for all four.
- [x] 9.2 Write golden briefs in `reels/golden/`, each pinning a house on the hand reel's base style, with a sidecar `reels/golden/<launch>.golden.json` naming its hand flow, hand reel and deliberate edits (with reasons). Verify each brief passes `pnpm brief`.
- [x] 9.3 Create `scripts/brief-golden.ts` with check-only, cut-only and full modes. It reports footage parity and cut parity (clip edges in order by the beats they show, length against the house maximum, metrics; card and segment shapes as information only), lists `harness` and `agent-schedule` as unsupported, writes `docs/reel/design/compiler-validation.md`, and exits non-zero on failure. Verify `pnpm brief:golden --check` writes the report.
- [x] 9.4 Tune the `agenta@1` and `agenta-classic@1` seeds until cut parity passes in check mode, recording each change and its reason in the report. Then update the immutability hashes to freeze v1. Verify `pnpm test` passes.
- [ ] 9.5 Re-port the four Agenta actions and the hand flows (`flows/agent-skill.ts`, `agent-slash-command.ts`, `agent-tool.ts`, `agent-schedule.ts`) to the current UI (v0.122.8), measured with `record:live --check` probes on a dedicated demo agent (`DEMO_URL_AGENT`, never the PR reviewer). Move the old hand logs to `.diag/brief/pre-0.122.8/`, re-record them with the updated hand flows, and re-render the hand demos. Back up the four hand reels to `.diag/brief/pre-0.122.8/reels/`, then re-cut each against its new take by converting its clip ranges to beat anchors on the same beats (`fromBeat`/`toBeat`, `toEdge` on typing beats), changing nothing else, and list every clip's old range and new anchor for review. Re-render the four hand reels and take a new reel `--check` baseline for them. Verify each hand flow records, each re-cut reel's `--check` runs, and `agent-schedule` and `harness` stay identical to the old baseline.
- [ ] 9.6 Run the full golden mode (record and render). Verify footage parity and motion-metric tolerances pass for all four, then commit the report.

## 10. Agent procedures

- [x] 10.1 Add "From a post" (design §13) and "Writing an action" sections to `.agents/skills/intro-reel/SKILL.md`, and a pointer to actions in `.agents/skills/shoot-demo-video/SKILL.md`. Verify by pasting one launch post covered by an existing action (for example, a Skills announcement) and following "From a post" with no hand edits, from saving `reels/<name>.post.md` to a passing `status.json` and both reel aspects.

## 11. Integration

- [x] 11.1 Run `pnpm lint`, `pnpm test` and `pnpm clip:smoke`. Verify all pass, and that `git status` shows no pipeline output or account-specific files as trackable.
- [ ] 11.2 Final flow regression: re-run the 1.2 flow checks (`smoke`, `skillsmp-search`, `agent-skill`) on the finished change, and diff against the baseline. Verify there are no differences.
- [x] 11.3 Final render regression: re-render `pnpm reel agent-skill`, write `analyze --json` to `.diag/brief/after/agent-skill.analyze.json`, then run `pnpm analyze --compare` against the 1.3 baseline. Verify segment count and length are identical and no motion metric moves beyond run-to-run noise (re-render the baseline once to measure that noise if any delta appears). Record the compare output in the golden report.
