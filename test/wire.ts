import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserClient } from "../src/browser/client.js";
import { openCache } from "../src/cache/db.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { silentLogger } from "./helpers.js";

// A context over an in-memory cache and a fake BTG client that serves the
// synthetic fixtures, so sync and every read tool run with no browser.

const fixture = (path: string) => readFileSync(join(import.meta.dir, "fixtures", path), "utf8");
const JSON_BY_PATH: Record<string, string> = {
  "/investments/api/statement-position/home": fixture("investments/home.json"),
  "/investments/api/statement-position/balance/detail": JSON.stringify({ availableBalance: 10, balanceCC: 10, blockedCC: 0, blockedJd: 0, totalBlocked: 0, warrantyMargin: 0, creditEnabled: false }),
  "/investments/api/statement-position/allocation/000000001/type/MARKET/summary": fixture("investments/allocation.json"),
  "/investments/api/account-statement/period/30/history/grouped": fixture("investments/statement.json"),
  "/investments/api/statement-position/v2/future-transactions?period=dia": JSON.stringify({ totalAmountNextDays: 0, currentDate: null, futureTransactions: [] }),
};
export const HTML_BY_ROUTE: Record<string, string> = {
  "/cartoes": fixture("banking/cartoes.html"),
  "/conta-corrente": fixture("banking/conta-corrente.html"),
};

type Calls = { api: string[]; render: string[] };

function fakeClient(calls: Calls, over: Partial<BrowserClient> = {}): BrowserClient {
  return {
    apiGet: async (path) => {
      calls.api.push(path);
      const body = JSON_BY_PATH[path];
      if (!body) throw new Error(`unexpected ${path}`);
      return { status: 200, url: path, body };
    },
    render: async (path) => {
      calls.render.push(path);
      return { url: path, title: "", html: HTML_BY_ROUTE[path] ?? "" };
    },
    account: () => "000000001",
    state: () => ({ tripped: false, calls: 0, lastCallAt: null }),
    cooldownUntil: () => null,
    close: async () => {},
    ...over,
  };
}

export function wireSync(over: Partial<BrowserClient> = {}) {
  const calls: Calls = { api: [], render: [] };
  const exportDir = mkdtempSync(join(tmpdir(), "btg-export-"));
  const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-sync-test", BTG_EXPORT_DIR: exportDir }), {
    db: openCache(":memory:"),
    session: createMemorySessionStore(null),
    log: silentLogger(),
    now: () => Date.UTC(2026, 9, 2, 12),
    client: fakeClient(calls, over),
  });
  return { ctx, calls, exportDir };
}

