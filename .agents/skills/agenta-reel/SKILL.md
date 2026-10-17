---
name: agenta-reel
description: Make an Agenta launch reel strictly inside the Agenta brand kit, from a pasted post, without asking the user. The default film is one take: a title card, the whole feature interaction uncut in a window on a grey ground with the camera following the clicks, a closing line, the Agenta logo, in 16:9 at 60fps. Post copy in; only audited reels out. Use for any Agenta feature, launch or integration reel. For another brand, use the brand-neutral intro-reel skill.
metadata:
  tags: remotion, playwright, video, reel, agenta, brand
---

# Agenta reel

The Agenta counterpart of `intro-reel`, the way `agenta-social-graphic` is to
`social-graphic`. It changes **what a reel looks like and holds**, never how
it is cut: the brief, `pnpm brief`, `pnpm launch`, actions and surfaces all
work as `.agents/skills/intro-reel/SKILL.md` "From a post" and "Writing an
action" describe. Read those for the mechanics; this file is the Agenta layer.

Drive the app only through this repo's Playwright scripts (`pnpm launch`,
`pnpm record:live <name> --check`), never another browser. See CLAUDE.md.

## Setup (once per machine)

1. **Fonts.** GT Alpina and PP Mondwest are licensed and gitignored. The reel
   pack reads them from the graphics skill's folder, so follow "Setup" in
   `.agents/skills/agenta-social-graphic/SKILL.md` once; both skills then share
   the same files. A launch without them stops at compile, naming each missing
   file. The GT Alpina Light that agenta.ai serves is a **trial cut**: before a
   paid campaign, drop the licensed file in under the same name.
2. **The app.** `DEMO_URL_AGENT` in `.env` must open the dedicated demo agent's
   page, never a real agent: actions create and delete `demo-` data on it.
   Sign in once with `pnpm capture:session`.

## The default: one take (`agenta@5`)

```
title card  →  the whole interaction, one uncut clip  →  outro line(s)  →  logo
"Introducing ==Skills=="   camera moves in on each click and back out   "Agents that learn on the job."
```

A brief with no `house` compiles under `agenta@5`: style `one-take`, the
Agenta brand pack, 16:9 only, 1.25x, the music bed and SFX, at most 40s,
**shot in slow motion (K=3) and rendered at 60fps**. The app sits in a
window on a neutral 200 (`#EBEAEA`) ground; the camera zooms inside the
window, so the ground, the rounded corners and the shadow stay in every frame. `pnpm launch` sets
`DEMO_SLOWMO=3` and `DEMO_FPS=60` from the house; do not set them by hand. The
take records about three times as long as it plays, and the render takes about
twice as long as a 30fps one. `agenta@4` is the same film with the window
growing past the frame on its zooms; `agenta@3` adds the 9:16 cut; `agenta@2`
is the same film at 30fps in real time, both aspects, for when render time
matters more than smoothness.
There are no beats to choose, so nothing about the cut varies between
launches: you choose the footage and three or four lines of copy.

```json
{
  "version": 1,
  "name": "skills-launch",
  "source": "reels/skills-launch.post.md",
  "footage": { "surface": "agent", "actions": [
    { "use": "skills.add", "with": {
        "name": "demo-pr-security",
        "description": "Flag security risks in pull request diffs",
        "body": "Scan the diff for injection risks and hardcoded secrets.",
        "bodyMore": "List each finding as file:line, severity, and a one-line fix." } } ] },
  "title": "Introducing ==Skills==",
  "outro": ["Agents that learn on the job."]
}
```

- `title`: 1-6 words. Name the feature; `==word==` puts the one yellow pill on
  its noun.
- `outro`: 1-3 lines, 1-8 words each, one card per line, then the logo card.
  One line is the default; add a second only when the post makes a second
  claim the take shows.
- No `beats`, `payoff` or `signoff`: `pnpm brief` refuses them under a one-take
  house (`agenta@2` to `agenta@5`). To cut beats instead, pin `"house": "agenta@1"` and write the beats
  brief from `intro-reel`.

## The brand (enforced)

The pack is `brands/agenta/brand.json`, from the Agenta brand kit
(Brand Identity v3.0). It is applied over the style, so nothing about it is a
choice you make in the brief:

| | |
| --- | --- |
| Primary | Icetrine `#F2F25C`: the pill, and the only accent ground |
| Text and logo | Black `#1E1C1D` |
| Background | White smoke `#F6F5F3`: every card |
| Window ground | Neutral 200 `#EBEAEA` under `agenta@5` (White smoke before), audited against the pack |
| Dark ground | `#181010` (neutral 900) |
| Accents | Uranian Blue `#B8E1FF`, Rosewood `#5E0908`, never as a card ground |
| Headings | GT Alpina Light |
| Accent word | PP Mondwest, `^^word^^`, **one word per card at most** |
| Eyebrows, subheads | Inter |
| Logo | black on light, yellow mark with white wordmark on dark, black on yellow |

Text and logo ink is the kit's `#1E1C1D`. The graphics pack uses the
website's `#242424`; the two skills differ on purpose until the user
reconciles them.

**The audit** fails the launch gate on anything off brand, so an audited reel
is the only kind you hand over:

- at compile (`pnpm brief`, and launch's compile stage): every card's colours,
  face and logo must resolve to the pack. A custom `==word|#hex==` outside the
  palette is named against the brief field it came from.
- at the gate: three frames of every card in each rendered aspect, every pixel
  within tolerance of a pack colour or a blend of two. Footage is the product's
  own pixels and is never audited.

## The rules the audit cannot check

- **Yellow leads.** One pill per card at most, on the noun the film is about.
  Never two highlights, never a highlight and an accent word on one card.
- **The accent word is rare.** Mondwest marks one word that shows experts and
  developers working together (the kit's "LLMOps"). Most reels have none.
- **Tone.** Plain, specific, active verbs: what the feature does, never how it
  feels. `pnpm brief` already refuses the banned hype words; it cannot refuse a
  vague sentence.
- **Copy matches the take.** The outro states what the viewer just watched
  happen, not a promise the take does not show.
- **Demo data reads as demo data.** Parameters that name created things start
  with `demo-`; they appear on screen, so make the rest of the name plausible
  product copy.

## From a post

1. Save the pasted post verbatim to `reels/<name>.post.md`.
2. `pnpm brief --actions agent`: pick the actions whose labels show the post's
   claim. None covers it? Stop and name the missing action (intro-reel,
   "Writing an action").
3. Write `reels/<name>.brief.json` as above: title, footage, outro.
4. `pnpm brief <name> --json`; fix every problem; at most two retries.
5. `pnpm launch <name>` in the background (records, renders the house's aspects,
   gates, audits). It posts nothing.
6. Hand over only when `status.json` passes: the two reel paths
   (`out/reel/<name>.mp4`; `out/reel/<name>.9x16.mp4` too under `agenta@3`), the copy, and the gate
   summary, brand audit included. On a failure, read
   `out/launch/<name>/status.json`; a copy fix resumes `--from compile`.
