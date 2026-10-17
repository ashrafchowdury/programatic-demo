# Tasks

## 1. Baseline

- [x] 1.1 Capture `pnpm reel <name> --check` for every existing hand-written reel into `.diag/one-take/baseline/`. Record the current hashes of `agenta@1` and `agenta-classic@1`. Verify the files are non-empty.

## 2. The one-take style

- [x] 2.1 Add `src/lib/style/presets/one-take.ts`, the window framing and click camera from design §1, and register it in `STYLE_PRESETS`. Verify `style.test.ts` passes, including its no-name-branching guard.
- [x] 2.2 Write a scratch hand reel with `style: "one-take"` and one whole-demo clip over the existing `skills-launch` footage. Verify `pnpm reel <scratch> --check` resolves it and a rendered frame shows the window with the zoom camera.
- [x] 2.3 Re-run the 1.1 regression. Verify every existing reel's `--check` output is identical.
- [x] 2.4 Add the one-take style to CATALOG.md and to the style table in the intro-reel skill. Verify the documented command runs.

## 3. Brand packs

- [x] 3.1 Create `src/lib/brand.ts`: the pack types, `loadBrand(id)` (missing files are named), and `applyBrand(preset, pack)` with cap-ratio size scaling. Verify with `src/lib/brand.test.ts`: role mapping, scaling, and the missing-file error.
- [x] 3.2 Create `brands/agenta/brand.json` and commit the logo SVGs from the brand kit. Font paths point at the graphics skill's gitignored `brand/fonts/`. Use `#1E1C1D` for text and logo. Verify `loadBrand("agenta")` on this machine.
- [x] 3.3 Create `scripts/lib/brand-assets.ts`, which copies pack fonts and logos into gitignored `public/brand/<id>/` before bundling. Add the path to `.gitignore`. Verify a fresh copy and a refusal that names the missing file.
- [x] 3.4 Extend `src/lib/font.ts` to load the faces a pack names through `delayRender`, keeping Inter the default. Verify that rendering one card still twice gives GT Alpina on both, with no fallback frame.
- [x] 3.5 Thread an optional `brand` on `Reel` through `resolveStylePreset(style, brand)` and the compositions, and render the logo card from the pack SVG for its ground. Verify a reel without `brand` renders identically (1.1 regression), and a branded logo card shows the black Agenta logo on White smoke.
- [x] 3.6 Add `^^word^^` accent markup, rendered in the pack's accent face and counted against its limit. Verify with card tests and a brief-validation case for two accent words.

## 4. Brand audit

- [x] 4.1 Add `brandProblems(resolvedReel, pack)`, the static half, and run it in `pnpm brief` and the compile stage. Verify with tests: an off-pack colour and an off-pack face are each named.
- [x] 4.2 Add the frame half to the launch gate: 3 frames per card through system ffmpeg, checked by distance to a pack colour or a blend of two, with the tolerance as a house gate field. Verify with a fixture frame that passes and one with an injected off-brand grey that fails, naming the card and the colour.

## 5. One-take compiler shape

- [x] 5.1 Add `shape` to houses, read as `beats` when absent, and `outro` limits. Verify the frozen hashes of `agenta@1` and `agenta-classic@1` are unchanged.
- [x] 5.2 Make the brief schema depend on the house shape: a one-take brief takes `title`, `footage | demo` and `outro`, and rejects `beats` and `payoff`. Verify with one test per scenario in `specs/one-take-reel/spec.md`.
- [x] 5.3 Compile the one-take shape: title card, one anchored whole-take clip (`toEdge` on typing, payoff tail), outro cards, logo card, `maxLengthS` checked at compile. Verify with tests: structure, re-shoot shift, too-long error, determinism.
- [x] 5.4 Add `agenta@2` (design §10), not yet the default. Verify `resolveHouse("agenta@2")`, and that every audio src exists.

## 6. Validation render and freeze

- [x] 6.1 Write a one-take brief for the skills launch under `agenta@2` (title, `skills.add` footage, one outro line), and run `pnpm launch` on it. Verify both aspects render, the gates pass, and the brand audit passes.
- [x] 6.2 Set the frame-audit tolerance and any `agenta@2` seed changes from 6.1's measurements, recording each with its reason in `docs/reel/design/one-take.md`. Then freeze `agenta@2` with a hash and make it `HOUSE_DEFAULT`. Verify `pnpm test` passes and a brief with no `house` compiles as one-take.
- [x] 6.3 Re-run the 1.1 regression and the golden check (`pnpm brief:golden --check`, which pins `agenta@1` and `agenta-classic@1`). Verify both are unchanged. (Golden is as before this change: three pass; agent-tool fails as it did already, its brief re-ported to v0.122.8 against a pre-v0.122.8 hand log; see post-to-reel-compiler task 9.5.)

## 7. Skills and docs

- [x] 7.1 Write `.agents/skills/agenta-reel/SKILL.md`, linked from `.claude/skills/`: setup (fonts), post → one-take brief → `pnpm launch` → audit → hand-off, the brand rules the audit cannot check, and the ink note. Verify by following it from a pasted post to both audited reels with no hand edits.
- [x] 7.2 Remove Agenta specifics from `intro-reel` and point Agenta work at `agenta-reel`. Add the reel skill row and `brands/` to AGENTS.md. Verify that `intro-reel` names no Agenta colour or face.

## 8. Integration

- [x] 8.1 Run `pnpm lint`, `pnpm test`, `pnpm clip:smoke` and `openspec validate one-take-reel-and-agenta-brand --strict`. Verify all pass, and that `git status` shows no font files and no `public/brand/` as trackable. (957/958: the one failure is camera-logs.test.ts sweeping the local, gitignored public/skills-launch.clicks.json, whose take loses the caret at 12.24s; it fails identically without this change.)
