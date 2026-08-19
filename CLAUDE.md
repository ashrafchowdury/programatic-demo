# CLAUDE.md

**Never drive this app with a browser tool.** Not Claude-in-Chrome, not
computer-use, not an MCP browser, not any browser you can see. This repo drives
one browser only: the Chromium that Playwright launches from its own scripts.

A request phrased as a click-through — "open the playground, add the provider,
paste the key, hit Test" — is **the input to a spec file**, not an instruction to
start clicking. Write it into `flows/<name>.ts` (video) or `shots/<name>.ts`
(image) and run the recorder. If you are reasoning that this particular request
is a live click-through and therefore different, stop: it is not.

See **[AGENTS.md](./AGENTS.md)** — the three features this repo makes, commands,
rules and conventions. It is the single source of truth.

Read the skill for what you are making, before you start:

| Making | Read |
| --- | --- |
| a demo video | [`.agents/skills/shoot-demo-video/SKILL.md`](./.agents/skills/shoot-demo-video/SKILL.md) |
| a launch reel | [`.agents/skills/intro-reel/SKILL.md`](./.agents/skills/intro-reel/SKILL.md) |
| a still image | [`.agents/skills/shoot-still/SKILL.md`](./.agents/skills/shoot-still/SKILL.md) |
