import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMemorySessionStore, createSessionStore } from "../src/session/store.js";
import { hasLiveSession, presentMarkers, type SessionData } from "../src/session/snapshot.js";

const sample = (): SessionData => ({
  version: 1,
  origin: "https://app.btgpactual.com",
  storage: { _a: "tokenvalue-abcdefgh", sessionid: "sid-12345678", other: "x" },
  local: { refresh: "refreshtoken-abcdefgh" },
  userAgent: "Mozilla/5.0 Test",
  savedAt: 1_700_000_000_000,
  account: "123456",
});

describe("session store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "btg-store-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const config = (d: string) => ({
    configDir: d,
    sessionPath: join(d, "session.enc"),
    keyPath: join(d, "session.key"),
    sessionKey: undefined,
  });

  test("round-trips an encrypted snapshot", () => {
    const store = createSessionStore(config(dir));
    expect(store.load()).toBeNull();
    const data = sample();
    store.save(data);
    const loaded = store.load();
    expect(loaded).toEqual(data);
    expect(store.mtimeMs()).toBeGreaterThan(0);
  });

  test("peekSecrets exposes storage and local values for redaction", () => {
    const store = createSessionStore(config(dir));
    store.save(sample());
    const secrets = store.peekSecrets();
    expect(secrets).toContain("tokenvalue-abcdefgh");
    expect(secrets).toContain("refreshtoken-abcdefgh");
  });

  test("a different key cannot decrypt", () => {
    createSessionStore(config(dir)).save(sample());
    const other = createSessionStore({
      ...config(dir),
      sessionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    expect(() => other.load()).toThrow(/decifrar/);
  });

  test("clear removes the session", () => {
    const store = createSessionStore(config(dir));
    store.save(sample());
    store.clear();
    expect(store.load()).toBeNull();
  });

  test("markers detect a live session", () => {
    expect(hasLiveSession(sample())).toBe(true);
    expect(presentMarkers(sample())).toContain("sessionid");
    const empty = { ...sample(), storage: { other: "x" } };
    expect(hasLiveSession(empty)).toBe(false);
  });

  test("memory store mirrors the contract", () => {
    const store = createMemorySessionStore();
    expect(store.load()).toBeNull();
    store.save(sample());
    expect(store.load()?.account).toBe("123456");
    expect(store.peekSecrets()).toContain("sid-12345678");
  });
});
