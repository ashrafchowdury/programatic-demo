import React from "react";
import { Composition, staticFile } from "remotion";
import { DemoClip, type DemoClipProps } from "./DemoClip";
import {
  DEFAULT_PLAYBACK_RATE,
  EMPTY_LOG,
  OUTPUT_WIDTH,
  resolvePlaybackRate,
  type ClickLog,
} from "./lib/click-log";

const FPS = 30;

// Default clip shown in Studio when no --props are passed. Override with
// remotion render DemoClip --props='{"name":"agent-demo"}' (or slash-commands).
const CLIP_NAME = "smoke";

export const RemotionRoot: React.FC = () => {
  return (
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
        const aspect = log.viewport.height / log.viewport.width;
        const even = (n: number) => Math.round(n / 2) * 2;
        return {
          durationInFrames: Math.max(
            1,
            Math.ceil((log.durationMs / 1000 / speed) * FPS),
          ),
          width: even(OUTPUT_WIDTH),
          height: even(OUTPUT_WIDTH * aspect),
          props: { ...props, log, speed },
        };
      }}
    />
  );
};
