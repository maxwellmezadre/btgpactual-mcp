import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { CaptchaError, LoginError } from "../src/core/errors.js";
import { runAttachLogin } from "../src/session/attach.js";
import type { CdpSession, CdpTarget } from "../src/session/cdp.js";
import type { SessionData } from "../src/session/snapshot.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { fakeClock, silentLogger } from "./helpers.js";

const BTG = "https://app.btgpactual.com";

type Scenario = {
  targets?: CdpTarget[];
  dump?: { storage: Record<string, string>; local: Record<string, string> };
  cookies?: unknown[];
};

const homeTarget: CdpTarget = {
  id: "1",
  type: "page",
  url: `${BTG}/home`,
  webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/1",
};

function fakeCdp(scenario: Scenario = {}) {
  const state = { closed: 0, cookieUrls: [] as unknown[] };
  const session: CdpSession = {
    send: async <T>(method: string, params: Record<string, unknown> = {}) => {
      if (method === "Runtime.evaluate") {
        const expression = String(params.expression);
        if (expression.startsWith("/*btg dump*/")) {
          return { result: { value: scenario.dump ?? { storage: {}, local: {} } } } as T;
        }
        if (expression === "navigator.userAgent") return { result: { value: "Mozilla/5.0 Real" } } as T;
      }
      if (method === "Network.getCookies") {
        state.cookieUrls.push(params.urls);
        return { cookies: scenario.cookies ?? [] } as T;
      }
      throw new Error(`unexpected ${method}`);
    },
    close: () => {
      state.closed += 1;
    },
  };
  return {
    state,
    deps: {
      listTargets: async () => scenario.targets ?? [homeTarget],
      openSession: async () => session,
      // Never the real bridge in unit tests: it would launch Chrome.
      verify: async (_ctx: unknown, candidate: SessionData) => ({ ...candidate, account: "000111" }),
    },
  };
}

function wire() {
  const session = createMemorySessionStore(null);
  const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), {
    now: fakeClock().now,
    session,
    log: silentLogger(),
  });
  return { ctx, session };
}

describe("attach login (raw CDP)", () => {
  test("snapshots storage, UA and the app cookies from the BTG tab", async () => {
    const { ctx, session } = wire();
    const cdp = fakeCdp({
      dump: {
        storage: { _a: "tok-abcdefgh", sessionid: "sid-abcdefgh", syncId: "sync-abcdefgh" },
        local: { refresh: "r-abcdefgh" },
      },
      cookies: [
        { name: "sid", value: "ck-abcdefgh", domain: ".btgpactual.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      ],
    });
    const result = await runAttachLogin(ctx, {}, cdp.deps);
    expect(result.markers).toEqual(["_a", "sessionid", "syncId"]);
    expect(result.cookies).toBe(1);
    expect(result.userAgent).toBe("Mozilla/5.0 Real");
    expect(result.account).toBe("000111");
    expect(session.data?.account).toBe("000111");
    expect(session.data?.storage._a).toBe("tok-abcdefgh");
    expect(session.data?.cookies?.[0]?.sameSite).toBe("Lax");
    expect(cdp.state.cookieUrls).toEqual([[BTG]]);
    expect(cdp.state.closed).toBe(1); // only our websocket, never the user's browser
  });

  test("no BTG tab -> LoginError", async () => {
    const { ctx } = wire();
    const cdp = fakeCdp({ targets: [{ ...homeTarget, url: "https://example.com" }] });
    await expect(runAttachLogin(ctx, {}, cdp.deps)).rejects.toThrow(LoginError);
  });

  test("tab still on account selection -> actionable LoginError", async () => {
    const { ctx } = wire();
    const cdp = fakeCdp({ targets: [{ ...homeTarget, url: `${BTG}/selecao-de-conta` }] });
    await expect(runAttachLogin(ctx, {}, cdp.deps)).rejects.toThrow(/seleção de conta/);
  });

  test("tab without session markers -> LoginError, socket still closed", async () => {
    const { ctx } = wire();
    const cdp = fakeCdp({ dump: { storage: { unrelated: "x" }, local: {} } });
    await expect(runAttachLogin(ctx, {}, cdp.deps)).rejects.toThrow(LoginError);
    expect(cdp.state.closed).toBe(1);
  });

  test("debug port unreachable -> LoginError pointing at btgpactual login", async () => {
    const { ctx } = wire();
    const deps = {
      listTargets: async () => {
        throw new Error("connection refused");
      },
    };
    await expect(runAttachLogin(ctx, {}, deps)).rejects.toThrow(/btgpactual login/);
  });

  test("websocket refused -> LoginError", async () => {
    const { ctx } = wire();
    const deps = {
      listTargets: async () => [homeTarget],
      openSession: async (): Promise<CdpSession> => {
        throw new Error("403");
      },
    };
    await expect(runAttachLogin(ctx, {}, deps)).rejects.toThrow(LoginError);
  });
});

describe("attach login: login screen", () => {
  test("tab still on a sign-in route -> LoginError (keep waiting)", async () => {
    const session = createMemorySessionStore(null);
    const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), { session, log: silentLogger() });
    const deps = {
      listTargets: async () => [{ ...homeTarget, url: `${BTG}/login` }],
      openSession: async (): Promise<CdpSession> => {
        throw new Error("must not open a socket on the login screen");
      },
    };
    await expect(runAttachLogin(ctx, {}, deps)).rejects.toThrow(/tela de login/);
  });
});

describe("attach login: tab not readable yet", () => {
  test("SecurityError while reading storage -> LoginError (login keeps waiting), socket closed", async () => {
    const session = createMemorySessionStore(null);
    const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), { session, log: silentLogger() });
    let closed = 0;
    const deps = {
      listTargets: async () => [homeTarget],
      openSession: async (): Promise<CdpSession> => ({
        send: async () => {
          throw new Error(
            "SecurityError: Failed to read the 'sessionStorage' property from 'Window': Access is denied for this document.\n    at <anonymous>:5:3",
          );
        },
        close: () => void (closed += 1),
      }),
    };
    const failure = runAttachLogin(ctx, {}, deps);
    await expect(failure).rejects.toThrow(LoginError);
    await expect(failure).rejects.toThrow(/ainda não pôde ser lida/);
    expect(closed).toBe(1);
    expect(session.data).toBeNull();
  });

  test("a failure while SAVING is not swallowed", async () => {
    const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), {
      session: {
        ...createMemorySessionStore(null),
        save: () => {
          throw new Error("disco cheio");
        },
      },
      log: silentLogger(),
    });
    const cdp = fakeCdp({ dump: { storage: { _a: "tok-abcdefgh" }, local: {} } });
    await expect(runAttachLogin(ctx, {}, cdp.deps)).rejects.toThrow("disco cheio");
  });
});

describe("attach login: the snapshot must work before it is saved", () => {
  test("verification not ready -> LoginError, nothing saved", async () => {
    const session = createMemorySessionStore(null);
    const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), { session, log: silentLogger() });
    const cdp = fakeCdp({ dump: { storage: { _a: "tok-abcdefgh" }, local: {} } });
    const deps = {
      ...cdp.deps,
      verify: async (): Promise<SessionData> => {
        throw new LoginError("A sessão ainda não abre a conta no navegador de leitura.");
      },
    };
    await expect(runAttachLogin(ctx, {}, deps)).rejects.toThrow(/ainda não abre a conta/);
    expect(session.data).toBeNull();
  });

  test("a challenge during verification is not swallowed", async () => {
    const session = createMemorySessionStore(null);
    const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-attach" }), { session, log: silentLogger() });
    const cdp = fakeCdp({ dump: { storage: { _a: "tok-abcdefgh" }, local: {} } });
    const deps = {
      ...cdp.deps,
      verify: async (): Promise<SessionData> => {
        throw new CaptchaError("desafio");
      },
    };
    await expect(runAttachLogin(ctx, {}, deps)).rejects.toThrow(CaptchaError);
    expect(session.data).toBeNull();
  });
});
