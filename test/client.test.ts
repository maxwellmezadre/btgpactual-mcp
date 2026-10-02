import { describe, expect, test } from "bun:test";
import { createBrowserClient, backoffMs, isRetryable } from "../src/browser/client.js";
import type { Bridge } from "../src/browser/transport.js";
import { AuthError, CaptchaError, HttpError } from "../src/core/errors.js";
import { fakeClock, memoryCooldown, silentLogger } from "./helpers.js";

function stubBridge(over: Partial<Bridge> = {}): Bridge {
  return {
    apiGet: async (path) => ({ status: 200, url: path, body: "{}" }),
    render: async (path) => ({ url: path, title: "", html: "" }),
    account: () => "123456",
    running: () => true,
    close: async () => {},
    ...over,
  };
}

function wire(bridge: Bridge, random = () => 0) {
  const clock = fakeClock();
  const cooldown = memoryCooldown();
  const client = createBrowserClient(
    { bridge, minIntervalMs: 1500, jitterMs: 1500, log: silentLogger(), cooldown },
    { sleep: clock.sleep, now: clock.now, random },
  );
  return { client, clock, cooldown };
}

describe("browser client", () => {
  test("backoff grows and caps", () => {
    expect(backoffMs(1)).toBe(20_000);
    expect(backoffMs(2)).toBe(40_000);
    expect(backoffMs(99)).toBe(5 * 60_000);
  });

  test("isRetryable only for transient errors", () => {
    expect(isRetryable(new HttpError(0, "x"))).toBe(true);
    expect(isRetryable(new AuthError("x"))).toBe(false);
    expect(isRetryable(new CaptchaError("x"))).toBe(false);
  });

  test("serialises concurrent calls (never two in flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const bridge = stubBridge({
      apiGet: async (path) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { status: 200, url: path, body: "{}" };
      },
    });
    const { client } = wire(bridge);
    await Promise.all([client.apiGet("/a"), client.apiGet("/b"), client.apiGet("/c")]);
    expect(maxInFlight).toBe(1);
  });

  test("retries a transient HttpError then succeeds", async () => {
    let n = 0;
    const bridge = stubBridge({
      apiGet: async (path) => {
        if (n++ === 0) throw new HttpError(0, "blip");
        return { status: 200, url: path, body: "ok" };
      },
    });
    const { client } = wire(bridge);
    const result = await client.apiGet("/x");
    expect(result.body).toBe("ok");
    expect(n).toBe(2);
  });

  test("AuthError is not retried", async () => {
    let n = 0;
    const bridge = stubBridge({
      apiGet: async () => {
        n++;
        throw new AuthError("dead");
      },
    });
    const { client } = wire(bridge);
    await expect(client.apiGet("/x")).rejects.toThrow(AuthError);
    expect(n).toBe(1);
  });

  test("a challenge trips the breaker and persists a cooldown", async () => {
    const bridge = stubBridge({
      apiGet: async () => {
        throw new CaptchaError("challenge");
      },
    });
    const { client, cooldown, clock } = wire(bridge);
    await expect(client.apiGet("/x")).rejects.toThrow(CaptchaError);
    expect(client.state().tripped).toBe(true);
    expect(cooldown.get()).not.toBeNull();
    // Next call is refused without touching the bridge.
    let touched = false;
    const after = createBrowserClient(
      { bridge: stubBridge({ apiGet: async () => { touched = true; return { status: 200, url: "", body: "" }; } }), minIntervalMs: 0, jitterMs: 0, log: silentLogger(), cooldown },
      { now: clock.now },
    );
    await expect(after.apiGet("/y")).rejects.toThrow(CaptchaError);
    expect(touched).toBe(false);
  });
});
