---
name: shoot-demo-video
description: Shoot a product demo clip end to end — write a flow, record it with Playwright, render it with Remotion. Use when asked to add, re-shoot or regenerate a demo video.
metadata:
  tags: remotion, playwright, video, demo
---

# Shoot a demo video

**This is one of three features. A demo is one recorded flow, played through. If
you actually want** a cut launch film, that is a *reel*
(`.agents/skills/intro-reel/SKILL.md`); a still image of part of the screen is a
*still* (`.agents/skills/shoot-still/SKILL.md`). See the table in `AGENTS.md`.

Driven by Playwright's Chromium, launched by these scripts — not your own
browser. First time on this machine: `pnpm exec playwright install --with-deps
chromium`.

Three stages. A demo is a **flow file**; the camera work is derived from the
click log, never authored by hand.

```
flows/<name>.ts  →  record  →  convert  →  render  →  out/demo/<name>.mp4
```

## Prerequisites

A fresh sandbox has none of this. Do these in order — step 0 is the one that
silently wastes the most time.

### 0. Run from local disk, not a mounted folder

```bash
df -T .        # look at the Type column
```

If it says `fuse.*`, `nfs`, `s3fs`, `geesefs`, or similar, **stop**. Network
mounts cannot store symlinks or the executable bit, and `node_modules` is built
entirely out of both. Installing there produces a tree that looks complete and
fails on every command:

- everything in `node_modules/.bin/` comes out `-rw-r--r--`, so `tsx`,
  `playwright` and `remotion` all fail with `Permission denied` — and `chmod +x`
  reports success while changing nothing
- pnpm's package links come out as **0-byte regular files**, so imports fail with
  `Cannot find package 'esbuild' / 'dotenv'` even though the code is right there
  in `.pnpm/`

There is no workaround. Copy the repo to real disk and work there:

```bash
cp -r /path/to/mounted/programatic-demo /tmp/demo
cd /tmp/demo && rm -rf node_modules     # discard any tree built on the mount
```

Copy `out/demo/<name>.mp4` back to the mount when you are done. The mount is fine for
storing files; it cannot be a runtime.

### 1. pnpm

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm --version
```

The repo is pnpm-only. Sandboxes usually ship `npm` and not `pnpm`, and
`npm install -g pnpm` fails without root — use corepack, which ships with Node.

### 2. Dependencies and Chromium

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
```

`--with-deps` matters on Linux: it pulls the shared libraries headless Chromium
needs. Without them Playwright installs cleanly and then fails to launch with
`error while loading shared libraries: libglib-2.0.so.0` or similar.

#### No root? Set the libraries up yourself

`--with-deps` shells out to `apt-get install`, so it needs privileges. On a
shared sandbox image you will not have them, and Chromium will not start. This
is the normal path here, not an edge case — expect to do it every session.

**First, check whether a browser already exists.** One command, and it skips
everything below:

```bash
which chromium chromium-browser google-chrome google-chrome-stable
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium   # if one is there
```

**Otherwise, unpack the libraries into `/tmp`.** `apt-get download` only fetches
`.deb` files and `dpkg -x` extracts without installing — neither needs root:

```bash
# ask Playwright what it wants; the list changes between versions
pnpm exec playwright install-deps --dry-run

mkdir -p /tmp/pwlibs && cd /tmp/pwlibs
apt-get download libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
  libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdrm2 libgbm1 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
  libasound2
for d in *.deb; do dpkg -x "$d" .; done

export LD_LIBRARY_PATH=/tmp/pwlibs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

Export `LD_LIBRARY_PATH` in the same shell that runs the recorder, or Chromium
still will not find them.

Two ways to make this cheaper:

- **`--only-shell`** on the Playwright install. The headless shell is a smaller
  download than full Chrome and links against fewer libraries. This pipeline
  never needs a headed browser except for `capture:session`.
- **Cache the downloads on persistent storage.** The `.deb` files and the
  Playwright browser bundle are just data — park them in whatever directory
  survives between sessions and copy them in, instead of re-fetching ~300MB
  every run:

  ```bash
  # once
  cp /tmp/pwlibs/*.deb            "$PERSIST/pwlibs/"
  cp -r ~/.cache/ms-playwright    "$PERSIST/ms-playwright"

  # every session after
  mkdir -p /tmp/pwlibs && cp "$PERSIST"/pwlibs/*.deb /tmp/pwlibs/
  cd /tmp/pwlibs && for d in *.deb; do dpkg -x "$d" .; done
  cp -r "$PERSIST/ms-playwright" ~/.cache/ms-playwright
  export LD_LIBRARY_PATH=/tmp/pwlibs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
  ```

  **Extract and run from local disk, never from the cache location** if that
  cache is a network mount — see step 0. Store there, run from `/tmp`.

If you *do* control the container image, one line at build time removes all of
this: `RUN npx playwright install --with-deps chromium`. On a shared image you
cannot, so the above is the actual procedure.

### 3. System ffmpeg

```bash
brew install ffmpeg          # macOS
apt-get install -y ffmpeg    # Debian/Ubuntu
```

**Not** the one bundled with Remotion — that build has no `signalstats`, which
the recorder uses to measure its sync marker. Missing it does not error: the
recorder warns, falls back to a *guessed* trim, and every click in the finished
video drifts out of sync. A silent wrong result is worse than a crash, so check
for the warning.

### No GPU?

Sandboxes rarely have one. Set `DEMO_GL=swiftshader` for every render — the
default `angle` expects a real GPU, and `swangle` fails to decode the source
video. Expect renders roughly 10x slower; that is the cost, not a fault.

### Verify the whole toolchain

```bash
pnpm clip:smoke     # record -> convert -> render, offline, no login
```

If that writes `out/demo/smoke.mp4`, everything is wired. Fix it before touching a
real demo.

## Write the flow

`flows/<name>.ts`. Steps read as a script; each carries the beat that follows it.

```ts
export default defineFlow({
  name: "agent-skill",
  viewport: { width: 1920, height: 1080 },
  startUrl: process.env.DEMO_URL_AGENT_SKILL,   // never hardcode — see below
  steps: [
    { pause: 700 },                                    // establish
    { click: "Add skill", cluster: "open", after: 1400 },
    { hoist: "Create" },                               // resolve during motion
    { type: "Name", text: NAME, cluster: "form", after: 600 },
    { click: "Create", cluster: "create", after: 900 },
  ],
});
```

| Step | Does |
| --- | --- |
| `click` / `type` / `focus` / `moveTo` | the matching `ctx` helper |
| `pause: ms` | hold still |
| `hoist: name` | resolve a selector now, use it later |
| `do: async (ctx) => …` | escape hatch for conditionals and nav waits |

Address elements by the name a viewer would read on screen. There is no selector
file to write — `autoCandidates` builds a ladder (accessible name → label →
placeholder → test id → containing text). Only reach for `targets` (no
accessible name) or `css()` (layout anchor) when a name genuinely cannot work.

**`cluster` groups clicks into one camera beat.** Same id = one punch, hold and
trail. It is the only camera control you normally touch.

## Shoot it

```bash
pnpm capture:session                  # once, if the app needs a login
pnpm record:live <name> --check       # resolve selectors, no video — do this first
pnpm record:live <name>
pnpm convert <name>
pnpm render <name>
```

Several at once: `pnpm record:batch --all --concurrency 2`. Flows that write the
same app state must declare `mutates` so they share a serial lane.

Recording is **headless by default** — a window that loses focus blurs inputs
and pauses animations, so it changes what gets filmed. `HEADED=1` to watch a
failure.

## Knobs

| Env | Default | Notes |
| --- | --- | --- |
| `DEMO_SPEED` | `1.25` | Playback vs shoot. Set per render, not per flow. |
| `DEMO_GL` | `angle` | GPU rasterisation; **~10× faster** rendering. Use `swiftshader` where there is no GPU — **not** `swangle`, which fails to decode the source. |
| `DEMO_CONCURRENCY` | auto | Opt-in. More workers measured *slower*. |
| `HEADED` | unset | `1` shows the browser during a shoot. |

## Check the result

```bash
pnpm analyze <name>     # motion runs, frozen runs, sharpness trace
```

Watch the clip. The rhythm should read: establish ≥600 ms at base scale →
lead-in as the cursor departs → hold ≥1.3 s through the interaction → trail out
→ **end at base scale**. Ending zoomed in is a bug.

## Things that will bite you

- **Flows are gitignored.** `flows/*` is ignored except `smoke`, `google-search`
  and `skillsmp-search`. Demo flows are account-specific; the engine ships, the
  demos do not.
- **Never hardcode a start URL.** It embeds workspace/project/app ids. Read it
  from `process.env.DEMO_URL_<NAME>` and document the key in `.env.example`.
- **`recordings/`, `public/*.mp4`, `public/*.clicks.json`, `out/`, `tours/*.json`
  are all regenerated.** Do not commit them. `public/backdrop.jpg` is the one
  committed asset — it is a design file, not output.
- **Cold contexts are slower than the warm profile.** Wait for elements
  (`findByName`); do not probe after a fixed sleep (`softByName`) or a batch run
  will fail where a single shoot passed.
- **A block during a still beat reads as dead air.** `hoist` slow lookups into a
  beat where something is already moving.

## Where the reasoning lives

Most non-obvious constants carry their measurement in a comment beside them:

| File | Carries |
| --- | --- |
| `src/lib/click-log.ts` | every camera timing constant, `OUTPUT_WIDTH`, capture scale |
| `src/lib/zoom.ts` | clustering, region framing, the keyframe track |
| `src/lib/camera.ts` | easing curve, distance-aware durations |
| `src/DemoClip.tsx` | backdrop, rim light, and the motion-blur banding rule |
| `scripts/render.ts` | GPU renderer measurements |

If a number looks arbitrary, read the comment before changing it — several were
derived from measured reference footage, and two earlier theories written into
this codebase turned out to be wrong when re-measured.
