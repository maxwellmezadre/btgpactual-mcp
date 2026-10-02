import { type BrowserClient, createBrowserClient } from "./browser/client.js";
import { launchWithPlaywright } from "./browser/launch.js";
import { createBridge } from "./browser/transport.js";
import type { LaunchBrowser } from "./browser/types.js";
import { type Config, loadConfig } from "./config.js";
import { type Logger, createLogger } from "./core/logger.js";
import { type SessionStore, createSessionStore } from "./session/store.js";

// Explicit DI container. Everything a tool needs hangs off `Ctx`, and every
// temporal/IO collaborator can be replaced in tests. No singletons, no
// framework: `createContext(loadConfig())` is the whole wiring. The browser
// client is memoised so a tool that only reads the cache never launches Chrome;
// Playwright itself is behind a dynamic import inside `launchWithPlaywright`.

export type ContextDeps = {
  launch?: LaunchBrowser;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  session?: SessionStore;
  log?: Logger;
};

export type Ctx = {
  config: Config;
  log: Logger;
  now: () => number;
  session: SessionStore;
  /** Memoised BTG bridge+client; launches Chrome only on first network use. */
  client: () => BrowserClient;
  dispose: () => void;
};

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
  const session = deps.session ?? createSessionStore(config);
  const log =
    deps.log ??
    createLogger({
      ...(config.logFile ? { logFile: config.logFile } : {}),
      secrets: () => session.peekSecrets(),
    });

  let client: BrowserClient | undefined;
  const getClient = (): BrowserClient => {
    if (!client) {
      const bridge = createBridge({
        session,
        launch: deps.launch ?? launchWithPlaywright,
        config,
        log,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
        now,
      });
      client = createBrowserClient(
        { bridge, minIntervalMs: config.minIntervalMs, jitterMs: config.jitterMs, log },
        { now, ...(deps.sleep ? { sleep: deps.sleep } : {}), ...(deps.random ? { random: deps.random } : {}) },
      );
    }
    return client;
  };

  return {
    config,
    log,
    now,
    session,
    client: getClient,
    dispose: () => {
      void client?.close();
      client = undefined;
    },
  };
}

/** Convenience for the entry points: load the env config and wire everything. */
export const contextFromEnv = (): Ctx => createContext(loadConfig());
