import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { LoginError, SessionError } from "../src/core/errors.js";
import type { AttachResult } from "../src/session/attach.js";
import { type ChromeEnv, loginChromeArgs, resolveChrome } from "../src/session/chrome.js";
import { runLogin } from "../src/session/login.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { fakeClock, silentLogger } from "./helpers.js";

const OK: AttachResult = { markers: ["_a"], account: "123456", cookies: 3, userAgent: "UA", savedAt: "2026-01-01T00:00:00.000Z" };

function wire(opts: { portUp?: boolean; portComesUpAfter?: number; attachFailures?: number; attachError?: Error } = {}) {
  const clock = fakeClock();
  const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-login-test" }), {
    now: clock.now,
    session: createMemorySessionStore(null),
    log: silentLogger(),
  });
  const state = { launches: [] as string[][], closed: 0, probes: 0, attaches: 0 };
  let up = opts.portUp ?? false;
  const deps = {
    sleep: clock.sleep,
    resolveBinary: () => "/fake/chrome",
    probe: async () => {
      state.probes += 1;
      if (!up && opts.portComesUpAfter !== undefined && state.launches.length > 0 && state.probes > opts.portComesUpAfter) up = true;
      return up;
    },
    launch: (_binary: string, args: string[]) => {
      state.launches.push(args);
      if (opts.portComesUpAfter === undefined) up = true;
      return { close: () => void (state.closed += 1) };
    },
    attach: async () => {
      state.attaches += 1;
      if (opts.attachError) throw opts.attachError;
      if (state.attaches <= (opts.attachFailures ?? 0)) throw new LoginError("A aba do BTG está na seleção de conta.");
      return OK;
    },
  };
  return { ctx, deps, state };
}

describe("login (dedicated non-automated Chrome)", () => {
  test("launches Chrome, waits through the account choice, snapshots, closes Chrome", async () => {
    const { ctx, deps, state } = wire({ attachFailures: 2 });
    const result = await runLogin(ctx, {}, deps);
    expect(result).toEqual({ ...OK, browser: "launched" });
    expect(state.attaches).toBe(3);
    expect(state.launches).toHaveLength(1);
    expect(state.closed).toBe(1);
  });

  test("the login window never gets --remote-allow-origins", async () => {
    const { ctx, deps, state } = wire();
    await runLogin(ctx, {}, deps);
    const args = state.launches[0] ?? [];
    expect(args).toContain("--remote-debugging-port=9222");
    expect(args.some((arg) => arg.startsWith("--remote-allow-origins"))).toBe(false);
    expect(args.some((arg) => arg.endsWith("/login-chrome"))).toBe(true);
    expect(args.at(-1)).toBe("https://app.btgpactual.com/");
  });

  test("reuses a browser already on the port and leaves it open", async () => {
    const { ctx, deps, state } = wire({ portUp: true });
    const result = await runLogin(ctx, {}, deps);
    expect(result.browser).toBe("reused");
    expect(state.launches).toHaveLength(0);
    expect(state.closed).toBe(0);
  });

  test("times out with the last state and still closes Chrome", async () => {
    const { ctx, deps, state } = wire({ attachFailures: 10_000 });
    await expect(runLogin(ctx, { timeoutMs: 10_000 }, deps)).rejects.toThrow(/seleção de conta/);
    expect(state.closed).toBe(1);
  });

  test("a real failure (not 'not there yet') is rethrown at once", async () => {
    const { ctx, deps, state } = wire({ attachError: new SessionError("disco cheio") });
    await expect(runLogin(ctx, {}, deps)).rejects.toThrow(SessionError);
    expect(state.attaches).toBe(1);
    expect(state.closed).toBe(1);
  });

  test("port that never answers -> LoginError, Chrome closed", async () => {
    const { ctx, deps, state } = wire({ portComesUpAfter: 1_000_000 });
    await expect(runLogin(ctx, {}, deps)).rejects.toThrow(/porta de depuração/);
    expect(state.closed).toBe(1);
  });

  test("no Chrome installed -> LoginError naming BTG_CHROME_PATH", async () => {
    const { ctx, deps } = wire();
    await expect(runLogin(ctx, {}, { ...deps, resolveBinary: () => null })).rejects.toThrow(/BTG_CHROME_PATH/);
  });
});

describe("resolveChrome", () => {
  const host = (platform: NodeJS.Platform, present: string[], which: Record<string, string> = {}): ChromeEnv => ({
    platform,
    exists: (path) => present.includes(path),
    which: (name) => which[name] ?? null,
    env: { PROGRAMFILES: "C:\\Program Files" },
  });

  test("macOS app bundle", () => {
    const path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(resolveChrome("chrome", undefined, host("darwin", [path]))).toBe(path);
  });

  test("linux falls back through binary names", () => {
    expect(resolveChrome("chrome", undefined, host("linux", [], { "google-chrome-stable": "/usr/bin/google-chrome-stable" }))).toBe(
      "/usr/bin/google-chrome-stable",
    );
  });

  test("windows Program Files", () => {
    const path = "C:\\Program Files/Google\\Chrome\\Application\\chrome.exe";
    expect(resolveChrome("chrome", undefined, host("win32", [path]))).toBe(path);
  });

  test("override wins, but only if it exists", () => {
    expect(resolveChrome("chrome", "/x/chrome", host("darwin", ["/x/chrome"]))).toBe("/x/chrome");
    expect(resolveChrome("chrome", "/x/missing", host("darwin", []))).toBeNull();
  });

  test("login args", () => {
    expect(loginChromeArgs({ port: 9333, profileDir: "/p", url: "https://x/" })).toEqual([
      "--remote-debugging-port=9333",
      "--user-data-dir=/p",
      "--no-first-run",
      "--no-default-browser-check",
      "https://x/",
    ]);
  });
});
