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

function wire(
  scenario: FakeScenario = {},
  over: Partial<typeof baseConfig> = {},
  snapshot = sampleSession(),
) {
  const clock = fakeClock();
  const fake = makeFakeBrowser(scenario);
  const session = createMemorySessionStore(snapshot);
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

  test("restored session parked on the account picker -> AuthError at once", async () => {
    const { bridge, clock } = wire({ landingFor: () => "https://app.btgpactual.com/selecao-de-conta" });
    const start = clock.now();
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(/seleção de conta/);
    expect(clock.now() - start).toBeLessThan(1_000); // no waiting out the 2s render timeout
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

  test("waits for the account when headers arrive first", async () => {
    const headers = { authorization_code: "tok-abcdefgh", sessionid: "sid-abcdefgh" };
    const { bridge } = wire({
      // headers on poll 0, account only from poll 3 on (the allocation call comes later)
      capture: (poll) => ({ headers, account: poll >= 3 ? "777777" : null, seen: poll + 1 }),
    }, {}, sampleSession({ account: undefined }));
    await bridge.apiGet("/investments/api/x");
    expect(bridge.account()).toBe("777777");
  });

  test("settles account-less after the grace period", async () => {
    const headers = { authorization_code: "tok-abcdefgh", sessionid: "sid-abcdefgh" };
    const { bridge } = wire(
      { capture: () => ({ headers, account: null, seen: 1 }) },
      {},
      sampleSession({ account: undefined }),
    );
    const result = await bridge.apiGet("/investments/api/x");
    expect(result.status).toBe(200);
  });

  test("account override from config wins over captured", async () => {
    const { bridge } = wire({}, { account: "999999" });
    await bridge.apiGet("/investments/api/x");
    expect(bridge.account()).toBe("999999");
  });

  test("injects captured cookies into the bridge context", async () => {
    const clock = fakeClock();
    const fake = makeFakeBrowser();
    const session = createMemorySessionStore(
      sampleSession({
        cookies: [
          { name: "sessionid", value: "ck-abcdefgh", domain: "app.btgpactual.com", path: "/", expires: -1, httpOnly: true, secure: true },
        ],
      }),
    );
    const bridge = createBridge({
      session,
      launch: fake.launch,
      config: baseConfig,
      log: silentLogger(),
      sleep: clock.sleep,
      now: clock.now,
      idleMs: 0,
    });
    await bridge.apiGet("/investments/api/x");
    expect(fake.addedCookies).toBe(1);
  });

  test("interact: clicks the located point, waits for done, annotates, extracts", async () => {
    const { bridge, fake } = wire({ done: (poll) => poll >= 2, extract: (url) => ({ url, title: "t", html: "<p>depois</p>" }) });
    await bridge.render("/cartoes", { readySelector: ".x" });
    const result = await bridge.interact({ locate: "/*locate*/", done: "/*done*/", annotate: "/*annotate*/", label: "mês" });
    expect(fake.clicks).toEqual([[10, 20]]);
    expect(fake.annotated).toBe(1);
    expect(result.html).toBe("<p>depois</p>");
  });

  test("interact types after the click when asked (search boxes)", async () => {
    const { bridge, fake } = wire();
    await bridge.render("/cartoes", { readySelector: ".x" });
    await bridge.interact({ locate: "/*locate*/", done: "/*done*/", type: "2026", label: "a busca" });
    expect(fake.clicks).toEqual([[10, 20]]);
    expect(fake.typed).toEqual(["2026"]);
  });

  test("interact without an open screen, or a missing control, fails", async () => {
    const { bridge } = wire({ locate: () => null });
    await expect(bridge.interact({ locate: "/*locate*/", done: "/*done*/", label: "mês" })).rejects.toThrow(BankingRenderError);
    await bridge.render("/cartoes", { readySelector: ".x" });
    await expect(bridge.interact({ locate: "/*locate*/", done: "/*done*/", label: "mês" })).rejects.toThrow(/Não encontrei mês/);
  });

  test("a click that never changes the screen is a BankingRenderError, not stale data", async () => {
    const { bridge } = wire({ done: () => false });
    await bridge.render("/cartoes", { readySelector: ".x" });
    await expect(bridge.interact({ locate: "/*locate*/", done: "/*done*/", label: "próximo" })).rejects.toThrow(
      /não produziu a mudança/,
    );
  });

  test("close is idempotent", async () => {
    const { bridge, fake } = wire();
    await bridge.apiGet("/investments/api/x");
    await bridge.close();
    await bridge.close();
    expect(fake.closed).toBe(1);
  });

  test("a browser killed from outside is relaunched, not reused", async () => {
    const { bridge, fake } = wire();
    await bridge.apiGet("/investments/api/x");
    fake.crash();
    expect(bridge.running()).toBe(false);
    await bridge.apiGet("/investments/api/x");
    expect(fake.launches).toBe(2);
  });

  test("after a relaunch, warm-up waits for the new session's headers instead of replaying the old ones", async () => {
    const stale = { authorization_code: "tok-stale-aaaa", sessionid: "sid-stale-aaaa" };
    const fresh = { authorization_code: "tok-fresh-bbbb", sessionid: "sid-fresh-bbbb" };
    const { bridge, fake } = wire({
      // poll 0: first browser. Polls 1-3: relaunched app not booted yet. Poll 4: new headers.
      capture: (poll) =>
        poll === 0
          ? { headers: stale, account: "123456", seen: 1 }
          : poll < 4
            ? { headers: {}, account: null, seen: 0 }
            : { headers: fresh, account: "123456", seen: 1 },
    });
    await bridge.apiGet("/investments/api/x");
    await bridge.close();
    await bridge.apiGet("/investments/api/x");
    expect(fake.apiScripts.at(-1)).toContain("tok-fresh-bbbb");
    expect(fake.apiScripts.at(-1)).not.toContain("tok-stale");
  });

  test("a 401 drops the browser so the next call restores the session saved meanwhile", async () => {
    const { bridge, fake, session } = wire({
      api: (url, call) => ({ status: call === 0 ? 401 : 200, url, body: "{}" }),
    });
    await expect(bridge.apiGet("/investments/api/x")).rejects.toThrow(AuthError);
    expect(bridge.running()).toBe(false);
    // e.g. `btgpactual login` ran in another process
    session.save(sampleSession({ storage: { _a: "tok-relogin-cc", sessionid: "sid-relogin-cc" } }));
    await bridge.apiGet("/investments/api/x");
    expect(fake.launches).toBe(2);
    expect(fake.initScripts.filter((s) => s.startsWith(RESTORE_MARKER)).at(-1)).toContain("tok-relogin-cc");
  });

  test("a login redirect also drops the browser", async () => {
    const { bridge } = wire({ landingFor: () => "https://app.btgpactual.com/login" });
    await expect(bridge.render("/cartoes", { readySelector: ".x" })).rejects.toThrow(AuthError);
    expect(bridge.running()).toBe(false);
  });

  test("mirrors a refreshed snapshot back to the store", async () => {
    const { bridge, session } = wire({
      dump: { storage: { _a: "tok-abcdefgh", sessionid: "sid-abcdefgh", fresh: "rotated-xyz" }, local: {} },
    });
    await bridge.apiGet("/investments/api/x");
    expect(session.data?.storage.fresh).toBe("rotated-xyz");
  });
});
