import { describe, expect, test } from "bun:test";
import { RESTORE_MARKER } from "../src/browser/capture.js";
import { createBridge } from "../src/browser/transport.js";
import { AuthError, BankingRenderError, HttpError } from "../src/core/errors.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { type FakeScenario, fakeClock, makeFakeBrowser, sampleSession, silentLogger } from "./helpers.js";

const baseConfig = {
  account: undefined as string | undefined,
  baseUrl: "https://app.btgpactual.com",
  browserChannel: "chrome" as const,
  browserProfileDir: "/tmp/profile",
  headless: true,
  locale: "pt-BR",
  pageTimeoutMs: 45_000,
  renderTimeoutMs: 2_000,
  timezone: "America/Sao_Paulo",
};

function wire(scenario: FakeScenario = {}, over: Partial<typeof baseConfig> = {}) {
  const clock = fakeClock();
  const fake = makeFakeBrowser(scenario);
  const session = createMemorySessionStore(sampleSession());
  const bridge = createBridge({
    session,
    launch: fake.launch,
    config: { ...baseConfig, ...over },
    log: silentLogger(),
    sleep: clock.sleep,
    now: clock.now,
    idleMs: 0,
  });
  return { bridge, fake, session, clock };
}

describe("bridge", () => {
  test("no session -> AuthError", async () => {
    const fake = makeFakeBrowser();
    const bridge = createBridge({
      session: createMemorySessionStore(null),
      launch: fake.launch,
      config: baseConfig,
      log: silentLogger(),
    });
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(AuthError);
  });

  test("warm-up restores storage then captures headers, apiGet returns body", async () => {
    const { bridge, fake } = wire({
      api: (url) => ({ status: 200, url, body: '{"balance":10}' }),
    });
    const result = await bridge.apiGet("/investments/api/statement-position/home");
    expect(result.body).toBe('{"balance":10}');
    // restore runs before capture, both before the app boots.
    expect(fake.initScripts[0]?.startsWith(RESTORE_MARKER)).toBe(true);
    expect(fake.initScripts.length).toBe(2);
    expect(bridge.account()).toBe("123456");
  });

  test("login redirect on warm-up -> AuthError", async () => {
    const { bridge } = wire({ landingFor: () => "https://app.btgpactual.com/login" });
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(AuthError);
  });

  test("apiGet 401 -> AuthError", async () => {
    const { bridge } = wire({ api: (url) => ({ status: 401, url, body: "" }) });
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(AuthError);
  });

  test("apiGet 500 -> HttpError", async () => {
    const { bridge } = wire({ api: (url) => ({ status: 500, url, body: "" }) });
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(HttpError);
  });

  test("render waits for selector then extracts inert html", async () => {
    const { bridge } = wire({
      ready: (call) => call >= 2,
      extract: (url) => ({ url, title: "Fatura", html: "<section>rows</section>" }),
    });
    const result = await bridge.render("/banking/cards", { readySelector: ".row" });
    expect(result.html).toContain("rows");
    expect(result.title).toBe("Fatura");
  });

  test("render that never paints -> BankingRenderError", async () => {
    const { bridge } = wire({ ready: () => false });
    await expect(bridge.render("/banking/cards", { readySelector: ".row" })).rejects.toThrow(
      BankingRenderError,
    );
  });

  test("account override from config wins over captured", async () => {
    const { bridge } = wire({}, { account: "999999" });
    await bridge.apiGet("/investments/api/x");
    expect(bridge.account()).toBe("999999");
  });

  test("close is idempotent", async () => {
    const { bridge, fake } = wire();
    await bridge.apiGet("/investments/api/x");
    await bridge.close();
    await bridge.close();
    expect(fake.closed).toBe(1);
  });

  test("mirrors a refreshed snapshot back to the store", async () => {
    const { bridge, session } = wire({
      dump: { storage: { _a: "tok-abcdefgh", sessionid: "sid-abcdefgh", fresh: "rotated-xyz" }, local: {} },
    });
    await bridge.apiGet("/investments/api/x");
    expect(session.data?.storage.fresh).toBe("rotated-xyz");
  });
});
