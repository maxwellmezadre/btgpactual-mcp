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

type Calls = { api: string[]; render: string[]; interact: string[] };

/** The cards screen after clicking `label`: that label marked; only "Out" has lines. */
export function cardsAfterClick(label: string, mark = label): string {
  let html = (HTML_BY_ROUTE["/cartoes"] as string).replace(
    `<span><div><span>${mark}</span>`,
    `<span data-btg-selected="true"><div><span>${mark}</span>`,
  );
  if (label !== "Out") {
    html = html.replace(
      /<div class="timeline-container">[\s\S]*?<\/div>\s*<\/section><\/app-timeline-card>/,
      '<div class="timeline-container"></div></section></app-timeline-card>',
    );
  }
  return html;
}

/** Page 1 claims 6 items; page 2 brings the 2 rows that were missing. */
export function statementPages(): { first: string; second: string } {
  const base = HTML_BY_ROUTE["/conta-corrente"] as string;
  const first = base.replace("1 - 4 de 4 itens", "1 - 4 de 6 itens");
  const second = base
    .replace("1 - 4 de 4 itens", "5 - 6 de 6 itens")
    .replace(/LOJA OMEGA/g, "LOJA SIGMA")
    .replace(/- R\$ 25,50/g, "- R$ 7,00")
    .replace("Pix recebido", "Pix devolvido")
    .replace("Pix enviado via assistente virtual no WhatsApp", "Pagamento de boleto");
  return { first, second };
}

export type FakeOptions = {
  /** Serve a two-page statement. */
  statementPages?: 1 | 2;
  /** Click on month X but the screen confirms month Y. */
  wrongMonth?: Record<string, string>;
};

function fakeClient(calls: Calls, over: Partial<BrowserClient> = {}, opts: FakeOptions = {}): BrowserClient {
  return {
    apiGet: async (path) => {
      calls.api.push(path);
      const body = JSON_BY_PATH[path];
      if (!body) throw new Error(`unexpected ${path}`);
      return { status: 200, url: path, body };
    },
    render: async (path) => {
      calls.render.push(path);
      if (path === "/conta-corrente" && opts.statementPages === 2) return { url: path, title: "", html: statementPages().first };
      return { url: path, title: "", html: HTML_BY_ROUTE[path] ?? "" };
    },
    interact: async (options) => {
      calls.interact.push(options.label);
      const month = /^a fatura de (.+)$/.exec(options.label)?.[1];
      if (month) return { url: "/cartoes", title: "", html: cardsAfterClick(month, opts.wrongMonth?.[month] ?? month) };
      if (options.label === "a próxima página do extrato") return { url: "/conta-corrente", title: "", html: statementPages().second };
      throw new Error(`unexpected interact ${options.label}`);
    },
    account: () => "000000001",
    state: () => ({ tripped: false, calls: 0, lastCallAt: null }),
    cooldownUntil: () => null,
    close: async () => {},
    ...over,
  };
}

export function wireSync(over: Partial<BrowserClient> = {}, opts: FakeOptions = {}) {
  const calls: Calls = { api: [], render: [], interact: [] };
  const exportDir = mkdtempSync(join(tmpdir(), "btg-export-"));
  const ctx = createContext(loadConfig({ BTG_CONFIG_DIR: "/tmp/btg-sync-test", BTG_EXPORT_DIR: exportDir }), {
    db: openCache(":memory:"),
    session: createMemorySessionStore(null),
    log: silentLogger(),
    now: () => Date.UTC(2026, 9, 2, 12),
    client: fakeClient(calls, over, opts),
  });
  return { ctx, calls, exportDir };
}

