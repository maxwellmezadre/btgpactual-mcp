import { describe, expect, test } from "bun:test";
import { CAPTURE_MARKER } from "../src/browser/capture.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { LoginError } from "../src/core/errors.js";
import { runLogin } from "../src/session/login.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { fakeClock, makeFakeBrowser, silentLogger } from "./helpers.js";

const config = () =>
  loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-login-test", BTG_HEADLESS: "0" });

function wire(scenario = {}) {
  const clock = fakeClock();
  const fake = makeFakeBrowser(scenario);
  const session = createMemorySessionStore(null);
  const ctx = createContext(config(), {
    launch: fake.launch,
    now: clock.now,
    sleep: clock.sleep,
    session,
    log: silentLogger(),
  });
  return { ctx, fake, session, clock };
}

describe("login", () => {
  test("captures the sessionStorage snapshot and saves it", async () => {
    const { ctx, fake, session } = wire({
      landingFor: () => "https://app.btgpactual.com/home",
      dump: {
        storage: { _a: "tok-abcdefgh", sessionid: "sid-abcdefgh", fingerprint: "fp-abcdefgh" },
        local: { refresh: "r-abcdefgh" },
      },
      capture: { headers: { authorization_code: "tok-abcdefgh", sessionid: "sid-abcdefgh" }, account: "654321", seen: 3 },
    });
    const result = await runLogin(ctx, {}, { launch: fake.launch });
    expect(result.markers).toContain("sessionid");
    expect(result.account).toBe("654321");
    expect(result.userAgent).toBe("Mozilla/5.0 Test");
    // Capture hook installed before the app booted.
    expect(fake.initScripts[0]?.startsWith(CAPTURE_MARKER)).toBe(true);
    // Saved snapshot round-trips.
    expect(session.data?.storage.sessionid).toBe("sid-abcdefgh");
    expect(session.data?.account).toBe("654321");
  });

  test("times out when the app never leaves the login screen", async () => {
    const { ctx, fake, clock } = wire({ landingFor: () => "https://app.btgpactual.com/login" });
    await expect(runLogin(ctx, { timeoutMs: 5_000 }, { launch: fake.launch, sleep: clock.sleep })).rejects.toThrow(
      LoginError,
    );
  });

  test("times out when markers never appear", async () => {
    const { ctx, fake, clock } = wire({
      landingFor: () => "https://app.btgpactual.com/home",
      dump: { storage: { unrelated: "x" }, local: {} },
      capture: { headers: {}, account: null, seen: 0 },
    });
    await expect(runLogin(ctx, { timeoutMs: 5_000 }, { launch: fake.launch, sleep: clock.sleep })).rejects.toThrow(
      LoginError,
    );
  });
});
