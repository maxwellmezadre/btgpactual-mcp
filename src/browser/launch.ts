import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchBrowser, LaunchOptions } from "./types.js";

// Playwright lives behind a dynamic import so that starting the MCP server, or
// answering from the cache, never pays for loading the driver.

export type PlaywrightLaunchOptions = {
  channel: string;
  headless: boolean;
  userAgent?: string;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  args: string[];
  ignoreDefaultArgs: string[];
};

/**
 * Pure so it can be asserted in tests. The UA, locale, timezone and viewport
 * must be the SAME at login and on every later read: the BTG app renders dates
 * and currency from the locale, and a fingerprint that shifts between runs on
 * one session is a bot signal. `--disable-blink-features=AutomationControlled`
 * zeroes `navigator.webdriver`, which headless Chrome sets even without
 * `--enable-automation`.
 */
export function launchOptions(opts: LaunchOptions): PlaywrightLaunchOptions {
  return {
    channel: opts.channel,
    headless: opts.headless,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    locale: opts.locale,
    timezoneId: opts.timezoneId,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

/** Chrome refuses a profile another live Chrome holds (a second MCP server, the CLI, `login`'s check). */
export function isProfileLocked(error: unknown): boolean {
  return /ProcessSingleton|SingletonLock/.test((error as Error)?.message ?? "");
}

export const launchWithPlaywright: LaunchBrowser = async (opts) => {
  const { chromium } = await import("playwright-core");
  const launch = (dir: string) => chromium.launchPersistentContext(dir, launchOptions(opts) as never);
  try {
    return (await launch(opts.profileDir)) as never;
  } catch (error) {
    if (!isProfileLocked(error)) throw error;
    // The session lives in the snapshot the bridge restores, not in the
    // profile, so a throwaway profile reads exactly the same. ponytail: a crash
    // leaves the temp dir behind for the OS to reap.
    const dir = mkdtempSync(join(tmpdir(), "btgpactual-profile-"));
    const context = await launch(dir);
    context.on("close", () => rmSync(dir, { recursive: true, force: true }));
    return context as never;
  }
};
