import React from "react";
import { Composition, Still, staticFile } from "remotion";
import { DEMO_LOOK } from "./lib/look";
import { ChipOverlay, type ChipOverlayProps } from "./ChipOverlay";
import { DemoClip, type DemoClipProps } from "./DemoClip";
import { HudOverlay, type HudOverlayProps } from "./HudOverlay";
import { Intro, type IntroProps } from "./Intro";
import { StillShot, type StillShotProps } from "./StillShot";
import {
  DEFAULT_PLAYBACK_RATE,
  EMPTY_LOG,
  FPS,
  resolvePlaybackRate,
  type ClickLog,
} from "./lib/click-log";
import {
  demoDurationInFrames,
  demoGeometry,
  demoSize,
} from "./lib/demo-duration";
import { compositionSize, introDurationInFrames } from "./lib/intro";
import { aspectSize } from "./lib/aspect";
import {
  DEFAULT_PRESET,
  fallbackShotMeta,
  resolveShotLook,
  resolveStillPreset,
  shotMetaProblem,
  STILL_PRESETS,
  type ShotMeta,
  type Split,
} from "./lib/still";
import { resolveGround, stillBackdropFile } from "./lib/backdrop";
import smokeIntro from "../intros/smoke";

// Default clip shown in Studio when no --props are passed. Override with
// remotion render DemoClip --props='{"name":"agent-demo"}' (or slash-commands).
const CLIP_NAME = "smoke";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DemoClip"
        component={DemoClip}
        durationInFrames={FPS * 8}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={
          {
            name: CLIP_NAME,
            log: EMPTY_LOG,
            speed: DEFAULT_PLAYBACK_RATE,
            // Stated, for the same reason scripts/render.ts states it: Studio
            // must preview a demo in the grammar the demo renders in. Left
            // absent, this falls through to a reel's DEFAULT_STYLE and the
            // preview quietly loses the camera and the backdrop — which makes
            // Studio agree with a broken render instead of catching it.
            look: DEMO_LOOK,
          } satisfies DemoClipProps
        }
        calculateMetadata={async ({ props }) => {
          // Read the click log written by the recorder; it carries the real size,
          // duration, and zoom keyframes so nothing here is hand-tuned.
          let log: ClickLog = EMPTY_LOG;
          try {
            const res = await fetch(staticFile(`${props.name}.clicks.json`));
            log = (await res.json()) as ClickLog;
          } catch {
            // No recording yet — fall back to defaults so Studio still opens.
          }
          const speed = resolvePlaybackRate(
            props.speed ?? process.env.DEMO_SPEED,
          );
          // Render at OUTPUT_WIDTH, keeping the recording's aspect. Decoupled from
          // the capture viewport on purpose — the source cannot get sharper, but
          // the vector layers over it can. Rounded to even so h264 accepts it.
          // A reel cut at another aspect keeps the short side and crops (see
          // src/lib/aspect.ts); the LENGTH below never depends on it, so a clip
          // range means the same frames at every aspect.
          const { width, height } = aspectSize(demoSize(log), props.aspect);
          const backdrop =
            props.backdrop ?? process.env.DEMO_BACKDROP ?? log.backdrop;
          return {
            // Long enough for the camera to land back at base, which can be
            // past the end of the recording — DemoClip holds the last frame of
            // the footage for the difference. See src/lib/demo-duration.ts.
            durationInFrames: demoDurationInFrames(
              log,
              speed,
              demoGeometry(log, props.chrome === true),
              FPS,
            ),
            width,
            height,
            props: { ...props, log, speed, backdrop },
          };
        }}
      />
      {/*
        Title card. `pnpm intro <name>` renders it as a one-card reel
        (scripts/intro.ts -> out/reel/<name>.intro.mp4) through the reel
        pipeline; the old render-intro + stitch path that glued a card onto a
        whole demo is retired — a reel with a card segment and a clip segment
        does that now. It is NOT sequenced inside DemoClip: zoomAt and Cursor
        both map frame -> time with t=0 at the first demo frame, so frames
        prepended there would desync the camera track and the pointer.

        The storyboard arrives whole through props because intros/*.ts are
        per-account files loaded by dynamic import in scripts/intro.ts — a
        static registry here would not survive a clone without them. This
        default is the one committed example, so Studio always opens on a card.

        The log fetch below is deliberately a copy of the one above rather than
        a shared helper: the DemoClip block is the demo's contract, and leaving
        it untouched is worth more than saving six lines. compositionSize() is
        duplicated for the same reason and is pinned by a test.
      */}
      {/*
        The step HUD. Rendered ALONE on a transparent ground and composited onto
        the finished film by scripts/reel.ts, because it spans segments and every
        segment renders independently. Its size comes from the caller, not from a
        recording — it has to match the film it lands on exactly.
      */}
      <Composition
        id="HudOverlay"
        component={HudOverlay}
        durationInFrames={FPS * 30}
        fps={FPS}
        width={2560}
        height={1440}
        defaultProps={
          { steps: [], ink: "#0a0a0a", totalS: 30 } satisfies HudOverlayProps
        }
        calculateMetadata={async ({
          props,
        }: {
          props: HudOverlayProps;
        }) => ({
          durationInFrames: Math.max(1, Math.round(props.totalS * FPS)),
          // The film's size, from the caller: it was pinned at 2560x1440 here,
          // which no longer holds once a reel can be square or vertical.
          ...(props.size ?? {}),
        })}
      />
      {/*
        Floating annotation chips, on the same transparent-ground pattern as the
        HUD above: a layer that spans segments cannot be baked into any one of
        them, so scripts/reel.ts composites it onto the finished picture.

        `totalS` drives the length rather than the chips themselves — a chip
        list that ends early must not shorten the overlay, or the composite runs
        out before the film does.
      */}
      <Composition
        id="ChipOverlay"
        component={ChipOverlay}
        durationInFrames={FPS * 30}
        fps={FPS}
        width={2560}
        height={1440}
        defaultProps={
          {
            chips: [],
            totalS: 30,
            style: {
              fill: "#f0f05a",
              ink: "#0a0a0a",
              heightFrac: 0.073,
              capRatio: 0.58,
              radiusFrac: 0.18,
              wipeS: 0.208,
              oversize: 1.06,
              exitS: 0.16,
            },
          } satisfies ChipOverlayProps
        }
        calculateMetadata={async ({
          props,
        }: {
          props: ChipOverlayProps;
        }) => ({
          durationInFrames: Math.max(1, Math.round(props.totalS * FPS)),
          ...(props.size ?? {}),
        })}
      />
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={introDurationInFrames(smokeIntro, FPS)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ intro: smokeIntro } satisfies IntroProps}
        calculateMetadata={async ({ props }) => {
          // Only the viewport is used here — the card shows no footage. It
          // takes the demo's aspect so a card cut next to its clips matches.
          let log: ClickLog = EMPTY_LOG;
          try {
            const res = await fetch(
              staticFile(`${props.intro.name}.clicks.json`),
            );
            log = (await res.json()) as ClickLog;
          } catch {
            // No recording yet — fall back to defaults so Studio still opens.
          }
          return {
            durationInFrames: introDurationInFrames(props.intro, FPS),
            ...aspectSize(compositionSize(log), props.aspect),
          };
        }}
      />
      {/*
        A 4K social image: one captured region of the app, framed on the same
        backdrop the clips use. Unlike the two above it takes its SIZE from a
        preset rather than from the recording, because the point of a still is
        to fit somewhere specific — a link card, a 9:16 story — and the region's
        own shape has nothing to do with that. See src/lib/still.ts.

        Pass the preset through props: remotion still Still out.png
          --props='{"name":"smoke","preset":"og"}'
      */}
      <Still
        id="Still"
        component={StillShot}
        width={STILL_PRESETS[DEFAULT_PRESET].width}
        height={STILL_PRESETS[DEFAULT_PRESET].height}
        defaultProps={
          {
            name: CLIP_NAME,
            meta: fallbackShotMeta(CLIP_NAME),
          } satisfies StillShotProps
        }
        calculateMetadata={async ({ props }) => {
          // The sidecar is written by scripts/shoot-still.ts and carries the
          // region's real shape. Without it the window would be sized from a
          // guess, so a missing or malformed one is worth saying out loud —
          // but not worth refusing to open Studio over.
          let meta: ShotMeta = fallbackShotMeta(props.name);
          try {
            const res = await fetch(staticFile(`shots/${props.name}.json`));
            const raw = (await res.json()) as unknown;
            const problem = shotMetaProblem(raw);
            if (problem)
              console.warn(`shots/${props.name}.json is ${problem} — using a default size`);
            else meta = raw as ShotMeta;
          } catch {
            // Nothing shot yet. Studio still opens on the fallback.
          }
          const preset = resolveStillPreset(
            (props as { preset?: string }).preset ?? process.env.DEMO_PRESET,
          );
          // Which ground wins — the one rule, shared with DemoClip and the
          // CLI's warnings. See resolveGround.
          const { ground, backdrop } = resolveGround({
            ground: props.ground,
            backdrop: props.backdrop,
            ownGround: meta.ground,
            ownBackdrop: meta.backdrop,
            envBackdrop: process.env.DEMO_BACKDROP,
          });
          // An image ground prefers its 4K grain-free still variant, when
          // `pnpm backdrop` has made one; a hand-dropped file has none.
          let backdropSrc: string | undefined;
          if (!ground) {
            const still = stillBackdropFile(backdrop);
            try {
              const res = await fetch(staticFile(still), { method: "HEAD" });
              if (res.ok) backdropSrc = still;
            } catch {
              // No variant: the video file it is.
            }
          }
          // A cutout can only be framed as a cutout. The CLI refuses a
          // mismatch; Studio warns and falls back, because it must still open.
          const { look, problem: lookProblem } = resolveShotLook(meta, props.look);
          if (lookProblem) console.warn(lookProblem);
          // A split is rendered a piece at a time; the composition stays the
          // preset's size and the piece index rides in with the props.
          const split = (props as { split?: Split }).split;
          return {
            ...STILL_PRESETS[preset],
            props: { ...props, meta, backdrop, backdropSrc, ground, look, split },
          };
        }}
      />
    </>
  );
};
