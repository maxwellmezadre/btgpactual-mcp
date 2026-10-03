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

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
/** The id the fake app gives the closed invoice (2026-10); ids are consecutive per month. */
export const ANCHOR_ID = 1000;
const ANCHOR_INDEX = 2026 * 12 + 9;

/** The full invoice page for `month`, from the August fixture; Oct is closed, Nov open, the rest paid. */
export function fullInvoiceHtml(month: string, opts: { nextPage?: boolean } = {}): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] as string;
  const status = month === "2026-10" ? "Fechada" : month === "2026-11" ? "Em aberto" : "Pago";
  let html = fixture("banking/fatura-completa.html")
    .replaceAll("Agosto", name)
    .replace("Fatura de " + name + " 2026", `Fatura de ${name} ${month.slice(0, 4)}`)
    .replace(" Pago ", ` ${status} `);
  if (status !== "Pago") {
    // Nothing paid yet: no "Valor pago" column. The closed one charges what /cartoes shows.
    html = html.replace(/<div class="invoice-details__divider invoice-details__amount-divider">[\s\S]*?<\/strong><\/div><\/div>\s*<\/div>/, "</div>");
    if (month === "2026-10") html = html.replace("R$ 1.234,56", "R$ 250,00");
  }
  if (opts.nextPage) {
    html = html.replace(
      'data-testid="pagination-next-button" class="orq-pagination__list-item orq-pagination__list-item--disabled"',
      'data-testid="pagination-next-button" class="orq-pagination__list-item"',
    );
  }
  return html;
}

/** The picker searched for 2026: from `first` (in 2026) up to December. */
function pickerHtml(first: string): string {
  const titles = MONTH_NAMES.map((name, i) => [`2026-${String(i + 1).padStart(2, "0")}`, `${name} 2026`])
    .filter(([month]) => (month as string) >= first)
    .reverse()
    .map(([, title]) => `<span class="orq-dropdown-list__title">${title}</span>`);
  return `<orq-droplist>${titles.join("")}</orq-droplist>`;
}

const monthForId = (id: number) => {
  const index = ANCHOR_INDEX + id - ANCHOR_ID;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

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
  /** Full invoice ids that are NOT consecutive: id N shows month(N) shifted by this. */
  fullIdShift?: number;
  /** The closed invoice's full page has a second page. */
  fullPages?: 1 | 2;
  /** Oldest invoice the picker lists (2026 only). Default: the chart's first month, so no history lines. */
  firstMonth?: string;
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
      const full = /^\/cartoes\/fatura-completa\/(\d+)$/.exec(path);
      if (full) return { url: path, title: "", html: fullInvoiceHtml(monthForId(Number(full[1]) + (opts.fullIdShift ?? 0))) };
      if (path === "/conta-corrente" && opts.statementPages === 2) return { url: path, title: "", html: statementPages().first };
      return { url: path, title: "", html: HTML_BY_ROUTE[path] ?? "" };
    },
    interact: async (options) => {
      calls.interact.push(options.label);
      const month = /^a fatura de (.+)$/.exec(options.label)?.[1];
      if (month) return { url: "/cartoes", title: "", html: cardsAfterClick(month, opts.wrongMonth?.[month] ?? month) };
      if (options.label === "a próxima página do extrato") return { url: "/conta-corrente", title: "", html: statementPages().second };
      const url = `/cartoes/fatura-completa/${ANCHOR_ID}`;
      if (options.label === "a fatura completa") return { url, title: "", html: fullInvoiceHtml("2026-10", { nextPage: opts.fullPages === 2 }) };
      if (options.label === "a próxima página da fatura") return { url, title: "", html: fullInvoiceHtml("2026-10").replace("Padaria Exemplo", "Padaria Segunda Pagina") };
      if (options.label === "o seletor de faturas") return { url, title: "", html: "" };
      if (options.label === "a busca de faturas de 2026") return { url, title: "", html: pickerHtml(opts.firstMonth ?? "2026-09") };
      if (options.label.startsWith("a busca de faturas de")) return { url, title: "", html: "" };
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

