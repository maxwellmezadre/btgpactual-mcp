import {
  API_FETCH_MARKER,
  CAPTURE_MARKER,
  EXTRACT_MARKER,
  READ_CAPTURE_MARKER,
  READY_MARKER,
  RESTORE_MARKER,
} from "../src/browser/capture.js";
import type {
  ApiResult,
  BrowserContextLike,
  CaptureState,
  LaunchBrowser,
  PageLike,
  RenderResult,
  RouteLike,
} from "../src/browser/types.js";
import type { Logger } from "../src/core/logger.js";
import type { SessionData } from "../src/session/snapshot.js";

/** Logger that swallows everything; pass `lines` to assert on messages. */
export function silentLogger(lines?: string[]): Logger {
  const push = (level: string) => (message: string) => lines?.push(`[${level}] ${message}`);
  return { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}

/** Deterministic clock: `sleep` advances time, so timeouts need no real delay. */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export function memoryCooldown() {
  let until: number | null = null;
  return { get: () => until, set: (u: number) => (until = u) };
}

export const sampleSession = (over: Partial<SessionData> = {}): SessionData => ({
  version: 1,
  origin: "https://app.btgpactual.com",
  storage: { _a: "tok-abcdefgh", sessionid: "sid-abcdefgh" },
  userAgent: "Mozilla/5.0 Test",
  savedAt: 1_700_000_000_000,
  account: "123456",
  ...over,
});

export type FakeScenario = {
  /** Map a requested url to the url the page "lands" on (simulate login redirect). */
  landingFor?: (url: string) => string;
  /** What the capture hook reports; a function sees the poll number (to script races). */
  capture?: CaptureState | ((poll: number) => CaptureState);
  /** Investments GET response. */
  api?: (url: string, call: number) => ApiResult;
  /** Banking render readiness. */
  ready?: (call: number) => boolean;
  /** Extracted banking HTML. */
  extract?: (url: string) => RenderResult;
  /** Web storage dump mirrored back on warm-up. */
  dump?: { storage: Record<string, string>; local: Record<string, string> };
};

export type FakeBrowser = {
  launch: LaunchBrowser;
  initScripts: string[];
  gotos: string[];
  closed: number;
  apiCalls: number;
  renderPolls: number;
  addedCookies: number;
};

/** A browser the tests can fully script, matching evaluate() by its marker. */
export function makeFakeBrowser(scenario: FakeScenario = {}): FakeBrowser {
  const fake: FakeBrowser = {
    launch: async () => context,
    initScripts: [],
    gotos: [],
    closed: 0,
    apiCalls: 0,
    renderPolls: 0,
    addedCookies: 0,
  };
  const defaultCapture: CaptureState = {
    headers: { authorization_code: "tok-abcdefgh", sessionid: "sid-abcdefgh" },
    account: "123456",
    seen: 1,
  };
  let capturePolls = 0;
  const readCapture = (): CaptureState => {
    const source = scenario.capture ?? defaultCapture;
    return typeof source === "function" ? source(capturePolls++) : source;
  };
  let landed = "https://app.btgpactual.com/";

  const page: PageLike = {
    goto: (url) => {
      landed = scenario.landingFor ? scenario.landingFor(url) : url;
      fake.gotos.push(landed);
      return Promise.resolve();
    },
    url: () => landed,
    evaluate: (script: string) => {
      if (script.startsWith(READ_CAPTURE_MARKER)) return Promise.resolve(readCapture());
      if (script.startsWith(API_FETCH_MARKER)) {
        const call = fake.apiCalls++;
        const result = scenario.api
          ? scenario.api(landed, call)
          : { status: 200, url: landed, body: '{"ok":true}' };
        return Promise.resolve(result);
      }
      if (script.startsWith(READY_MARKER)) {
        const ready = scenario.ready ? scenario.ready(fake.renderPolls++) : true;
        return Promise.resolve({ ready });
      }
      if (script.startsWith(EXTRACT_MARKER)) {
        return Promise.resolve(
          scenario.extract?.(landed) ?? { url: landed, title: "BTG", html: "<html></html>" },
        );
      }
      if (script === "navigator.userAgent") return Promise.resolve("Mozilla/5.0 Test");
      if (script.startsWith("/*btg dump*/")) {
        return Promise.resolve(scenario.dump ?? { storage: {}, local: {} });
      }
      return Promise.resolve(undefined);
    },
  };

  const context: BrowserContextLike = {
    newPage: () => Promise.resolve(page),
    addInitScript: (script: string) => {
      fake.initScripts.push(script);
      return Promise.resolve();
    },
    addCookies: (cookies) => {
      fake.addedCookies += cookies.length;
      return Promise.resolve();
    },
    route: (_pattern: string, handler: (route: RouteLike) => unknown) => {
      // Exercise the handler once with a blocked and an allowed resource.
      handler({ request: () => ({ resourceType: () => "image" }), abort: async () => {}, continue: async () => {} });
      handler({ request: () => ({ resourceType: () => "document" }), abort: async () => {}, continue: async () => {} });
      return Promise.resolve();
    },
    close: () => {
      fake.closed += 1;
      return Promise.resolve();
    },
  };

  return fake;
}

export { RESTORE_MARKER, CAPTURE_MARKER };
