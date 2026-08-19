# CLAUDE.md

See **[AGENTS.md](./AGENTS.md)** — commands, rules, and conventions for this
repo live there. It is the single source of truth; this file only points at it.

Demos and stills are driven by Playwright's Chromium, launched by this repo's
scripts. Use those for **every** interaction with the app — recording *and*
inspecting element names. Never open the app in any other browser, including the
in-app Browser / preview tools, even just to read the DOM. To discover selectors,
run `pnpm record:live <name> --check`, which resolves them through Playwright
without filming.

Read the skill for what you are making:

| Making | Read |
| --- | --- |
| a demo video | [`.agents/skills/shoot-demo-video/SKILL.md`](./.agents/skills/shoot-demo-video/SKILL.md) |
| a launch reel | [`.agents/skills/intro-reel/SKILL.md`](./.agents/skills/intro-reel/SKILL.md) |
| a still image | [`.agents/skills/shoot-still/SKILL.md`](./.agents/skills/shoot-still/SKILL.md) |
