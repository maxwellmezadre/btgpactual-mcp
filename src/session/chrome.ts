import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserChannel } from "../config.js";

// Finds and starts a real Chrome for the human to log in. It is started as a
// plain process, never through Playwright: an automation-driven browser is
// exactly what BTG's reCAPTCHA refuses.

const MAC_APPS: Record<BrowserChannel, string> = {
  chrome: "Google Chrome.app/Contents/MacOS/Google Chrome",
  chromium: "Chromium.app/Contents/MacOS/Chromium",
  msedge: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
};

const LINUX_BINS: Record<BrowserChannel, string[]> = {
  chrome: ["google-chrome", "google-chrome-stable"],
  chromium: ["chromium", "chromium-browser"],
  msedge: ["microsoft-edge", "microsoft-edge-stable"],
};

const WINDOWS_PATHS: Record<BrowserChannel, string> = {
  chrome: "Google\\Chrome\\Application\\chrome.exe",
  chromium: "Chromium\\Application\\chrome.exe",
  msedge: "Microsoft\\Edge\\Application\\msedge.exe",
};

export type ChromeEnv = {
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  which: (name: string) => string | null;
  env: Record<string, string | undefined>;
};

const realEnv = (): ChromeEnv => ({
  platform: process.platform,
  exists: existsSync,
  which: (name) => Bun.which(name),
  env: process.env,
});

/** Candidate binaries for the channel on this OS; the first that exists wins. */
export function resolveChrome(
  channel: BrowserChannel,
  override: string | undefined,
  host: ChromeEnv = realEnv(),
): string | null {
  if (override) return host.exists(override) ? override : null;
  if (host.platform === "darwin") {
    const app = MAC_APPS[channel];
    return [join("/Applications", app), join(homedir(), "Applications", app)].find(host.exists) ?? null;
  }
  if (host.platform === "win32") {
    const roots = [host.env.PROGRAMFILES, host.env["PROGRAMFILES(X86)"], host.env.LOCALAPPDATA];
    return (
      roots
        .filter((root): root is string => Boolean(root))
        .map((root) => join(root, WINDOWS_PATHS[channel]))
        .find(host.exists) ?? null
    );
  }
  for (const name of LINUX_BINS[channel]) {
    const found = host.which(name);
    if (found) return found;
  }
  return null;
}

/**
 * The flags for the login window. Deliberately NO `--remote-allow-origins`:
 * our CDP client sends no Origin header, which Chrome accepts without it, and
 * the flag would let any web page on the machine read the debug socket.
 */
export function loginChromeArgs(opts: { port: number; profileDir: string; url: string }): string[] {
  return [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    opts.url,
  ];
}

export type LaunchedChrome = { close(): void };
export type LaunchChrome = (binary: string, args: string[]) => LaunchedChrome;

export const launchChrome: LaunchChrome = (binary, args) => {
  const child = spawn(binary, args, { detached: true, stdio: "ignore" });
  child.unref();
  return {
    close: () => {
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
};
