/**
 * Open the app in a headed persistent profile, wait for you to finish login,
 * then save the session so later demo recordings can reuse it.
 *
 * Writes (all gitignored):
 *   .session-profile/          — Chromium user data (used by record:live / record:batch)
 *   storageState.json          — portable cookies + origin storage snapshot
 *   .session-profile/session-url.txt — last authenticated URL
 *
 * Usage: pnpm capture:session
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { stateFileFor } from "./lib/session";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE = path.join(ROOT, ".session-profile");
const URL_FILE = path.join(PROFILE, "session-url.txt");
const PLAYGROUND_URL_FILE = path.join(PROFILE, "playground-url.txt");

/**
 * Where to open the browser for the login. Required — this tool is not tied to
 * any one app, so there is no sensible default host to fall back to.
 */
const BASE_URL = process.env.APP_BASE_URL;
const WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 1500;
const SETTLE_MS = 2500;

const BANNER = `
(() => {
  const set = () => {
    if (document.getElementById('pw-auth-banner') || !document.body) return;
    const b = document.createElement('div');
    b.id = 'pw-auth-banner';
    b.textContent = 'Log in here. When you land in the app, this window closes and the session is saved for later demos.';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#111;font:600 13px system-ui,sans-serif;padding:8px 14px;text-align:center;';
    document.body.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set); else set();
})();
`;

function isLoginUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (
      path.includes("/auth") ||
      path.includes("/sign-in") ||
      path.includes("/signin") ||
      path.includes("/login") ||
      path.includes("/sign-up") ||
      path.includes("/signup")
    ) {
      return true;
    }
    if (
      host.includes("accounts.") ||
      host.includes("clerk.") ||
      host.includes("auth0.") ||
      host.endsWith("clerk.com")
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Is this URL still on the app we were pointed at?
 *
 * Derived from APP_BASE_URL rather than hardcoded, so the check follows
 * whatever app you are recording. Subdomains count: a login often bounces
 * through `auth.<host>` before landing back on the app.
 */
function isAppHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const appHost = BASE_URL ? new URL(BASE_URL).hostname.toLowerCase() : "";
    const root = appHost.split(".").slice(-2).join(".");
    return (
      (root !== "" && (host === appHost || host.endsWith(`.${root}`) || host === root)) ||
      host === "localhost" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/** True only once we are past the /auth bounce, not on the transient /w hop. */
function isAuthenticatedUrl(raw: string): boolean {
  if (isLoginUrl(raw) || !isAppHost(raw)) return false;
  try {
    const path = new URL(raw).pathname;
    if (path === "/" || path === "/w" || path === "/w/") return false;
    if (/^\/w\/[^/]+/i.test(path)) return true;
    if (/^\/(apps|settings|org|onboarding)/i.test(path)) return true;
    return path.length > 1;
  } catch {
    return false;
  }
}

function cookieSummary(
  cookies: Array<{ name: string; domain: string }>,
): string {
  const names = cookies
    .map((c) => `${c.name} @ ${c.domain}`)
    .sort((a, b) => a.localeCompare(b));
  return names.length ? names.join(", ") : "(none)";
}

async function main() {
  if (!BASE_URL) {
    throw new Error(
      "APP_BASE_URL is not set. Point it at the app you want to record " +
        "(see .env.example), then rerun.",
    );
  }
  const baseURL = BASE_URL;
  fs.mkdirSync(PROFILE, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  await context.addInitScript({ content: BANNER });

  const page = context.pages()[0] ?? (await context.newPage());
  console.log(`\nOpened ${baseURL}`);
  console.log(
    "Complete login in the browser window (and skip onboarding if it appears).",
  );
  console.log(`Waiting up to ${WAIT_MS / 60000} minutes…\n`);

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  const started = Date.now();
  let lastUrl = "";
  let stableSince: number | null = null;
  let ready = false;

  while (Date.now() - started < WAIT_MS) {
    const url = page.url();
    if (url !== lastUrl) {
      lastUrl = url;
      stableSince = null;
      console.log(`  → ${url}`);
    }
    if (isAuthenticatedUrl(url)) {
      if (stableSince === null) stableSince = Date.now();
      else if (Date.now() - stableSince >= SETTLE_MS) {
        ready = true;
        break;
      }
    } else {
      stableSince = null;
    }
    await page.waitForTimeout(POLL_MS);
  }

  if (!ready) {
    await context.close();
    throw new Error(
      `Timed out waiting for an authenticated page. Last URL: ${lastUrl || page.url()}`,
    );
  }

  const finalUrl = page.url();
  if (!isAuthenticatedUrl(finalUrl)) {
    await context.close();
    throw new Error(`Landed back on a login page: ${finalUrl}`);
  }

  const cookies = await context.cookies();
  const sessionCookies = cookies.filter((c) =>
    /clerk|auth|session|token|jwt|sid|csrf/i.test(`${c.name} ${c.domain}`),
  );
  if (sessionCookies.length === 0 && cookies.length === 0) {
    await context.close();
    throw new Error("Authenticated URL reached, but no cookies were stored.");
  }

  // Per host: a shared file loses the other host's localStorage, because
  // storageState() records it only for origins this run visited. See sessionKey.
  // indexedDB matches refreshSession — an app that keeps its token there would
  // otherwise export as signed out.
  const stateFile = stateFileFor(finalUrl);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  await context.storageState({ path: stateFile, indexedDB: true });
  fs.writeFileSync(URL_FILE, `${finalUrl}\n`);
  // Recorders still read the older filename.
  fs.writeFileSync(PLAYGROUND_URL_FILE, `${finalUrl}\n`);

  console.log(`\nAuthenticated URL: ${finalUrl}`);
  console.log(`Cookies saved:     ${cookies.length} total`);
  console.log(`Session-like:      ${cookieSummary(sessionCookies)}`);
  console.log(`storageState  → ${path.relative(ROOT, stateFile)}`);
  console.log(`profile       → ${path.relative(ROOT, PROFILE)}/`);
  console.log(`session url   → ${path.relative(ROOT, URL_FILE)}`);

  await context.close();
  console.log("\nSession captured. Later demos can reuse this login.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
