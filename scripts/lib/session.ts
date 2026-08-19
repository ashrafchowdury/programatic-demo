/**
 * Authenticated browser contexts, in the two shapes the pipeline needs.
 *
 * "profile" holds `.session-profile/` open — the only mode that can complete an
 * interactive login, and the only one that persists what the login produced. It
 * takes an exclusive lock on that directory, so exactly one browser may use it
 * at a time. That lock is the sole reason shoots used to be serial.
 *
 * "isolated" launches a throwaway browser and seeds a fresh context from
 * `storageState.json`. Nothing is shared, so any number can run at once.
 * Measured: two isolated contexts created from the same exported state both
 * reached the authenticated playground concurrently.
 *
 * The two are kept in sync by `refreshSession`, which re-exports the state file
 * from the profile. Do not skip it and trust a stale `storageState.json` — the
 * profile is the thing a login actually updates, so the export drifts behind it
 * the moment a session is renewed.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEVICE_SCALE_FACTOR,
  RECORD_SLOW_MO_MS,
} from "../../src/lib/click-log";
import type { Flow } from "./flow";
import { scaledViewport, captureScaleInitScript } from "./capture-scale";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const PROFILE = path.join(ROOT, ".session-profile");
export const STATE_FILE = path.join(ROOT, "storageState.json");

/** How long to wait for login + first paint before giving up. */
export const READY_TIMEOUT_MS = 300_000;

export type SessionMode = "profile" | "isolated";

export type ContextSpec = {
  /** LOGICAL viewport the flow authored against. Enlarged when captureScale > 1. */
  viewport: { width: number; height: number };
  /** Omit for a check run — no video is written. `size` is the LOGICAL size. */
  recordVideo?: { dir: string; size: { width: number; height: number } };
  headless?: boolean;
  /**
   * HD capture: record at this multiple of the logical viewport, with a matching
   * root zoom, so elements rasterise with more pixels. See capture-scale.ts.
   * Default 1 (today's behaviour).
   */
  captureScale?: number;
};

export type OpenContext = {
  context: BrowserContext;
  /** Closes the context AND its browser, when it owns one. */
  close: () => Promise<void>;
  /**
   * The PHYSICAL viewport the context actually records at (logical × captureScale).
   * Callers write this into log.viewport so the click log matches the video.
   */
  physicalViewport: { width: number; height: number };
};

/** True once a state file exists to seed isolated contexts from. */
export const hasStoredSession = (): boolean => fs.existsSync(STATE_FILE);

/**
 * Headless unless explicitly asked otherwise.
 *
 * Recording is automated by definition — nobody needs to watch it — and a window
 * that steals focus mid-shoot is worse than merely distracting. Losing focus can
 * change what the page renders: inputs blur, CSS animations and video pause
 * under some throttling, and `:focus-visible` styling flips. So the visible
 * window was never neutral, it was a variable in the recording.
 *
 * Opt back in with HEADED=1 (or HEADLESS=0) when you need to watch a flow fail.
 * `capture:session` ignores this and stays headed unconditionally — you cannot
 * type a password into a window you cannot see.
 */
export function resolveHeadless(): boolean {
  if (process.env.HEADED === "1") return false;
  if (process.env.HEADLESS === "0") return false;
  return true;
}

export async function openContext(
  mode: SessionMode,
  spec: ContextSpec,
): Promise<OpenContext> {
  const headless = spec.headless ?? resolveHeadless();
  const scale = spec.captureScale && spec.captureScale > 1 ? spec.captureScale : 1;
  // The browser viewport and the recording are both PHYSICAL; the flow's own
  // size is logical. At scale 1 these are equal, so nothing changes.
  const physicalViewport = scaledViewport(spec.viewport, scale);
  const common = {
    viewport: physicalViewport,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    recordVideo: spec.recordVideo
      ? { dir: spec.recordVideo.dir, size: physicalViewport }
      : undefined,
  };

  // Add the zoom+shim before any page script runs. Injected here (not by the
  // caller) so every recorder path — profile and isolated — gets it identically.
  const withScale = async (context: BrowserContext): Promise<void> => {
    if (scale > 1)
      await context.addInitScript({
        content: captureScaleInitScript(scale, spec.viewport),
      });
  };

  if (mode === "profile") {
    const context = await chromium.launchPersistentContext(PROFILE, {
      headless,
      slowMo: RECORD_SLOW_MO_MS,
      ...common,
    });
    await withScale(context);
    return { context, close: () => context.close(), physicalViewport };
  }

  if (!hasStoredSession()) {
    throw new Error(
      `No ${path.relative(ROOT, STATE_FILE)} to seed an isolated context from.\n` +
        `Run \`pnpm capture:session\` once, or record this flow on its own first.`,
    );
  }
  const browser: Browser = await chromium.launch({
    headless,
    slowMo: RECORD_SLOW_MO_MS,
  });
  const context = await browser.newContext({
    ...common,
    storageState: STATE_FILE,
  });
  await withScale(context);
  return { context, close: () => browser.close(), physicalViewport };
}

/**
 * Re-export `storageState.json` from the persistent profile, proving the
 * session is live on the way through.
 *
 * Runs ONCE and serially before a batch fans out: it needs the profile lock, so
 * it cannot overlap with anything, and every isolated worker depends on its
 * output. `flow` only supplies a URL and a readiness predicate to check against.
 */
export async function refreshSession(flow: Flow): Promise<void> {
  const startUrl = flow.startUrl ?? process.env.AGENTA_BASE_URL;
  if (!startUrl)
    throw new Error(
      `Cannot refresh the session: flow "${flow.name}" has no startUrl and ` +
        `AGENTA_BASE_URL is not set.`,
    );

  const { context, close } = await openContext("profile", {
    viewport: flow.viewport,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    if (!(await waitForReady(page, flow))) {
      throw new Error(
        `Not signed in — \`${flow.name}\` never became ready.\n` +
          `Run \`pnpm capture:session\` and log in, then retry.`,
      );
    }
    // A default storageState carries cookies + localStorage only, silently
    // dropping IndexedDB. Agenta has not been shown to need it — isolated
    // contexts read and write fine either way — but the omission is invisible
    // until an app happens to keep a token there, and asking for the complete
    // picture costs nothing.
    await context.storageState({ path: STATE_FILE, indexedDB: true });
  } finally {
    await close();
  }
}

/** Poll a flow's readiness predicate, tolerating the auth redirect. */
export async function waitForReady(
  page: import("playwright").Page,
  flow: Flow,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<boolean> {
  if (!flow.ready) {
    await page.waitForTimeout(3000);
    return true;
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.url().includes("/auth")) {
      await page.waitForTimeout(1000);
      continue;
    }
    if (await flow.ready(page).catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
