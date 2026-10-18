# Spike: reels inside an Agenta agent sandbox

Question: can an Agenta agent record and render an `agenta@6` reel in its own
sandbox? Agenta agents run in a Daytona sandbox built from
`services/runner/images/sandbox` in the Agenta repo: 2 vCPU, 4 GB RAM, 5 GB
disk by default (`AGENTA_RUNNER_DAYTONA_SANDBOX_*`), no GPU, with Node 24,
pnpm, ffmpeg 5.1 and one Playwright Chromium.

## Setup (2026-10-18)

No Daytona access from this machine, so the proxy is the Agenta runner image
itself (`agenta-ee-dev-runner`, the same `install-agent-tools.sh` recipe as the
Daytona snapshot) under `docker run --cpus=2 --memory=4g`: a 2-CPU cgroup
quota, 4 GB, software GL (`--gl=swiftshader`). The host is an Apple M2, whose
cores are likely faster than a cloud vCPU: read every time below as a best case.

The Agenta session was NOT copied in: SuperTokens rotates its refresh token,
and a second copy rotating it revokes the laptop's session (src: the note in
scripts/lib/session.ts). Recording was measured on the public SkillsMP flow
(`example-search`); rendering on the real skills take with `agenta@6` props.

## Results

Setup, once per fresh sandbox:

| step | time |
| --- | --- |
| `pnpm install --frozen-lockfile` | 68 s, 288 MB |
| first render: bundle + Remotion's Chrome Headless Shell download | 54 s |

Rendering the skills clip (DemoClip, `agenta@6`, 60fps, 2 workers):

| variant | per frame | the 1,400-frame take |
| --- | --- | --- |
| as shipped: 1440p, 4K footage, 8 shutter samples | ~9.6 s, and frames hit Remotion's 30 s timeout | fails (≥ 3.6 h if it did not) |
| 1 sample, 1440p | 1.5 s | ~34 min |
| 1 sample, 1080p | 0.53 s (holds and moves alike) | ~12 min (~6 min at 30fps) |
| 1440p footage instead of 4K | no gain | — |

The shutter is the cost: 8 samples is 8 `<Video>` decodes and composites per
frame, ~1.2 GB per Chrome worker (2.45 of the 4 GB with two). The footage
resolution barely matters.

Recording, 4K capture (`CAPTURE_SCALE=2`), public flow:

| shoot | distinct capture fps | wall |
| --- | --- | --- |
| real time (K=1) | ~13 (280 frames over 21.6 s): visible judder | 72 s |
| slow motion (K=3, as `agenta@6`) | ~38 (704 over 18.4 s): what this Mac gets | 113 s |

Slow-motion shooting is what makes a 2-vCPU capture usable; K=4-5 would buy
more on a slower vCPU at the cost of wall time.

## What this means

- **Recording runs in the sandbox** as it is, given its own demo-account
  session (a dedicated login stored as a secret, never a copy of a laptop's)
  and the licensed fonts provisioned privately.
- **Rendering does not**, as shipped. An agent profile that drops the shutter
  to one sample and renders 1080p brings a whole reel to roughly 12-15 min
  (60fps) or 7-9 min (30fps) on 2 vCPU, best case. 1080p costs little on the
  destinations: X and LinkedIn deliver at most 1080p. Losing the shutter costs
  little at 60fps, and the averaged blend makes a 1-sample hold exact.
- **Bake the toolchain** (node_modules, Chrome Headless Shell) into the sandbox
  snapshot: two minutes per run otherwise. Disk (5 GB) and memory (4 GB) fit
  a 1-sample render.
- **For full quality** (1440p60 with motion blur, minutes not tens of
  minutes), the render belongs on a GPU worker or Remotion Lambda that the
  agent calls (an MCP tool: check brief, launch, status), with the agent
  writing and validating the brief in its own sandbox.

To confirm on real Daytona: the same three numbers (install, 120 frames at
1080p one sample, K=3 capture) in a sandbox from the production snapshot.

## The agent profile: agenta@7

`agenta@7` = `agenta@6` + `render: { scale: 0.75, motionBlur: false,
standaloneDemo: false, gl: "swiftshader", workers: 1 }`: 1920x1080 at 60fps,
no camera shutter, the reel only (the `render-demo` stage skips; the cutter
checks clip ranges against the length the demo would have), and the sandbox's
GL and worker count as defaults that `DEMO_GL` / `DEMO_CONCURRENCY` override.

Verified end to end in the same 2-CPU, 4 GB container (`pnpm launch` on the
skills take, from a cold `pnpm install`), which surfaced two more things:

- **ffmpeg 5.1 failed the audio mux** ("Cannot select channel layout" between
  loudnorm's aresample and apad). The sandbox ships Debian bookworm's 5.1; this
  Mac has 8.1. The mux now pins the layout (`aformat=…:channel_layouts=stereo`).
  With that, the launch passed: gate, brand audit (0 problems), 48 kHz audio,
  `skills-agent.poster.jpg`.
- **Two workers swap.** Remotion saw ~1.9 GB actually free (the Docker VM is
  shared with the Agenta dev stack), and the first full run took 46.5 min for
  the clip. On a 120-frame slice: 2 workers 2.8 s/frame with 191 MB left, 1
  worker 0.83 s/frame. 1440p footage instead of 4K saves only ~11% (0.74
  s/frame). Hence `workers: 1`. A real 4 GB sandbox has more headroom; raise
  `DEMO_CONCURRENCY` there after measuring.

**Clean run with the profile's own defaults** (no `DEMO_*` set; one worker,
swiftshader), cold cache: passed in 958 s. Render 924 s (the 1,407-frame clip
at ~0.62 s/frame, three cards ~40 s), gate and brand audit 33 s; plus 68-125 s
for a cold `pnpm install` and ~50 s for Remotion's first browser download,
both of which a pre-baked snapshot removes. The recording (K=3, ~2 min for this
take) comes on top for a footage brief.
