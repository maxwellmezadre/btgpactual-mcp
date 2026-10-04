import {
  FULL_LINK_LOCATE,
  FULL_PAGER_NEXT_DONE,
  FULL_PAGER_NEXT_LOCATE,
  FULL_PAGE_DONE,
  PICKER_OPEN_DONE,
  PICKER_OPEN_LOCATE,
  PICKER_SEARCH_LOCATE,
  pickerSearchDone,
} from "../btg/banking/actions.js";
import { parseFullInvoice, parseInvoiceOptions } from "../btg/banking/invoice-details.js";
import { CARDS, FULL_INVOICE } from "../btg/banking/selectors.js";
import type { BrowserClient } from "../browser/client.js";
import { ParseError } from "../core/errors.js";
import { stripAccents } from "../domain/dates.js";
import type { CardsScreen, InvoiceTransaction } from "../domain/types.js";
import type { CacheRepo } from "./repo.js";

// Invoices the cards chart no longer shows (it keeps about six months) live on
// the full invoice page, one id per invoice. The sync opens the closed one from
// the link on /cartoes (so the id comes from the app), asks the picker which
// months exist (once: the first month never changes), and reads every month
// still missing from the cache. Months on the chart keep the timeline's lines,
// which say titular or adicional; from here they only take the header (dates,
// amount, paid amount).

/** 100 lines a page: ten pages is far beyond any real invoice. */
export const MAX_INVOICE_PAGES = 10;
export const FIRST_MONTH_META = "cards.first_invoice_month";
/** The picker is searched year by year, newest first, until a year has none. */
const MAX_PICKER_YEARS = 20;

/** What a month's snapshot keeps: the app's id and every page's HTML. */
export type FullInvoiceRaw = { statementId: string; pages: string[] };
type Step = (name: string, run: () => Promise<string>) => Promise<void>;

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/** Months the chart showed in the last cards sync: their lines come from the timeline. */
export function chartMonths(repo: CacheRepo): Set<string> {
  return new Set(repo.getSnapshot<CardsScreen>("cards_screen")?.data.months.map((m) => m.month) ?? []);
}

const sameMerchant = (a: string, b: string) => stripAccents(a).toLowerCase() === stripAccents(b).toLowerCase();

/**
 * The timeline shows an international purchase only in its own currency
 * ("US$ 22,75"), so it arrives unpriced. The month's full invoice page has the
 * reais charged: copy them over, matching day, merchant and installment. Each
 * full line is used once, so same-day repeats pair in order. No match stays
 * null, never a guess.
 */
export function priceForeignLines(timeline: InvoiceTransaction[], full: InvoiceTransaction[]): InvoiceTransaction[] {
  const pool = full.filter((line) => line.amountCents !== null);
  return timeline.map((line) => {
    if (line.amountCents !== null) return line;
    const i = pool.findIndex(
      (f) => f.date === line.date && f.installmentN === line.installmentN && sameMerchant(f.merchant, line.merchant),
    );
    if (i < 0) return line;
    const [match] = pool.splice(i, 1);
    return { ...line, amountCents: match?.amountCents ?? null };
  });
}

/** The lines of a month's stored full invoice page, or none when it was never read. */
export function storedFullLines(repo: CacheRepo, month: string): InvoiceTransaction[] {
  const raw = repo.getSnapshot<unknown>(`invoice_full:${month}`)?.raw;
  return raw ? (JSON.parse(raw) as FullInvoiceRaw).pages.flatMap((html) => parseFullInvoice(html).transactions) : [];
}

/** One ingest for live and `--reparse`. The page must be the month asked for: never file lines under another. */
export function ingestFullInvoice(repo: CacheRepo, raw: FullInvoiceRaw, chart: Set<string>, expected?: string): string {
  const pages = raw.pages.map(parseFullInvoice);
  const first = pages[0];
  const month = first?.month;
  if (!first || !month) throw new ParseError("A página da fatura completa não disse o mês.");
  if (expected && month !== expected) throw new ParseError(`A página mostrou a fatura ${month} em vez de ${expected}.`);
  if (pages.some((p) => p.month !== month)) throw new ParseError("As páginas da fatura completa são de meses diferentes.");
  const lines = pages.flatMap((p) => p.transactions).map((line, position) => ({ ...line, position }));
  const truncated = pages.at(-1)?.hasNextPage ? ` (parou em ${pages.length} páginas)` : "";
  const { transactions: _lines, ...header } = first;
  repo.putSnapshot(`invoice_full:${month}`, { ...header, lines: lines.length, pages: pages.length }, JSON.stringify(raw));
  repo.upsertInvoiceDetails({ ...first, month }, raw.statementId);
  if (chart.has(month)) {
    // The timeline's lines stay; this page only prices the international ones.
    const timeline = repo.getSnapshot<CardsScreen>(`cards_month:${month}`)?.data.transactions;
    if (timeline?.some((line) => line.amountCents === null)) repo.replaceInvoiceLines(month, priceForeignLines(timeline, lines));
    return `${first.statusLabel ?? "?"}: datas e valores (lançamentos vêm do gráfico)`;
  }
  repo.replaceInvoiceLines(month, lines);
  return `${first.statusLabel ?? "?"}: ${lines.length} lançamento(s)${truncated}`;
}

/** Re-ingests every stored full invoice with the current parser, no network. */
export function reparseFullInvoices(repo: CacheRepo, run: (name: string, fn: () => string) => void): void {
  const chart = chartMonths(repo);
  for (const kind of repo.listSnapshotKinds("invoice_full:")) {
    const raw = repo.getSnapshot<unknown>(kind)?.raw;
    const month = kind.slice("invoice_full:".length);
    if (raw) run(kind, () => ingestFullInvoice(repo, JSON.parse(raw) as FullInvoiceRaw, chart, month));
  }
}

/** Every page of the invoice on screen, following the pager. */
async function readPages(client: BrowserClient, firstHtml: string): Promise<string[]> {
  const pages = [firstHtml];
  while (parseFullInvoice(pages.at(-1) as string).hasNextPage && pages.length < MAX_INVOICE_PAGES) {
    const next = await client.interact({
      locate: FULL_PAGER_NEXT_LOCATE,
      done: FULL_PAGER_NEXT_DONE,
      settleMs: 300,
      label: "a próxima página da fatura",
    });
    pages.push(next.html);
  }
  return pages;
}

/** The oldest invoice the picker offers. Searched by year: the list only paints what is on screen. */
async function firstMonth(client: BrowserClient, fromYear: number): Promise<string> {
  await client.interact({ locate: PICKER_OPEN_LOCATE, done: PICKER_OPEN_DONE, label: "o seletor de faturas" });
  let oldest: string | null = null;
  for (let year = fromYear; year > fromYear - MAX_PICKER_YEARS; year -= 1) {
    const result = await client.interact({
      locate: PICKER_SEARCH_LOCATE,
      done: pickerSearchDone(String(year)),
      type: String(year),
      label: `a busca de faturas de ${year}`,
    });
    const months = parseInvoiceOptions(result.html);
    if (months.length === 0) break;
    oldest = months.reduce((a, b) => (a < b ? a : b));
  }
  if (!oldest) throw new ParseError("O seletor de faturas não listou nenhuma fatura.");
  return oldest;
}

/** Fetch a month unless it is paid, dated and (off the chart) already has its lines. */
function needed(repo: CacheRepo, month: string, chart: Set<string>): boolean {
  const row = repo.listInvoices().find((r) => r.month === month);
  if (!row?.due_date || row.status !== "paid") return true;
  return !chart.has(month) && repo.listInvoiceLines({ month, limit: 1 }).total === 0;
}

export async function runHistoryPhase(client: BrowserClient, repo: CacheRepo, step: Step): Promise<void> {
  const chart = chartMonths(repo);
  let anchor: { month: string; id: number } | null = null;

  await step("invoice_full", async () => {
    await client.render(CARDS.route, { readySelector: CARDS.ready, settleMs: 1500 });
    const page = await client.interact({ locate: FULL_LINK_LOCATE, done: FULL_PAGE_DONE, settleMs: 500, label: "a fatura completa" });
    const id = FULL_INVOICE.idFromUrl.exec(page.url)?.[1];
    if (!id) throw new ParseError(`A fatura completa abriu sem o id na url (${page.url}).`);
    const raw = { statementId: id, pages: await readPages(client, page.html) };
    const detail = ingestFullInvoice(repo, raw, chart);
    anchor = { month: parseFullInvoice(page.html).month as string, id: Number(id) };
    return `${anchor.month}, ${detail}`;
  });
  const from = anchor as { month: string; id: number } | null;
  if (!from) return;

  if (!repo.getMeta(FIRST_MONTH_META)) {
    await step("invoice_months", async () => {
      const oldest = await firstMonth(client, Number(from.month.slice(0, 4)));
      repo.setMeta(FIRST_MONTH_META, oldest);
      return `faturas desde ${oldest}`;
    });
  }
  const oldest = repo.getMeta(FIRST_MONTH_META);
  if (!oldest) return;

  // Up to the open invoice; future ones only hold installments already known.
  const open = repo.listInvoices().find((r) => r.status === "open")?.month;
  const last = open && open > from.month ? monthIndex(open) : monthIndex(from.month) + 1;
  for (let index = last; index >= monthIndex(oldest); index -= 1) {
    const month = monthOf(index);
    if (month === from.month || !needed(repo, month, chart)) continue;
    // ponytail: ids are consecutive per month (seen 2026-01..2027-08). Only
    // months the picker lists are tried, and each page must show the month
    // asked for; the first mismatch stops the walk. Upgrade path: pick each
    // month in the picker and read its id from the url.
    let mismatch = false;
    await step(`invoice_full:${month}`, async () => {
      const id = String(from.id + index - monthIndex(from.month));
      const page = await client.render(FULL_INVOICE.route(id), { readySelector: FULL_INVOICE.ready, settleMs: 1000 });
      const shown = parseFullInvoice(page.html).month;
      mismatch = shown !== month;
      return ingestFullInvoice(repo, { statementId: id, pages: await readPages(client, page.html) }, chart, month);
    });
    if (mismatch) break;
  }
}
