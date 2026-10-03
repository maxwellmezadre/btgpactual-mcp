import { ParseError } from "../../core/errors.js";
import { parsePtBrDate, resolveMonth, stripAccents } from "../../domain/dates.js";
import { parseBrl } from "../../domain/money.js";
import { invoiceStatus } from "../../domain/status.js";
import type { FullInvoicePage, InvoiceTransaction } from "../../domain/types.js";
import { kindOf } from "./cards.js";
import { type HTMLElement, hasClass, parseHtml, text } from "./dom.js";
import { FULL_INVOICE } from "./selectors.js";

// The full invoice screen: header (status, due and closing dates, amount, paid
// amount) and one page of lines. Each line is a table row followed by a hidden
// row holding its detail (app name, purchase mode, installment "N/T").

const key = (label: string | null) => stripAccents(label ?? "").toLowerCase();

/** "07 de Outubro" has no year: take the one nearest the invoice month. */
function headerDate(label: string | null, month: string | null): string | null {
  if (!label || !month) return null;
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return parsePtBrDate(label, new Date(Date.UTC(year, mon - 1, 15)), "nearest") ?? null;
}

function header(root: HTMLElement): Map<string, string | null> {
  const fields = new Map<string, string | null>();
  for (const item of root.querySelectorAll(FULL_INVOICE.item)) {
    const label = text(item.querySelector(FULL_INVOICE.label));
    if (label) fields.set(key(label), text(item.querySelector(FULL_INVOICE.value)));
  }
  return fields;
}

function detailOf(row: HTMLElement): Map<string, string | null> {
  const labels = row.querySelectorAll(FULL_INVOICE.detailLabel);
  const values = row.querySelectorAll(FULL_INVOICE.detailValue);
  return new Map(labels.map((label, i) => [key(text(label)), text(values[i])]));
}

function parseLines(root: HTMLElement, month: string | null): InvoiceTransaction[] {
  const out: InvoiceTransaction[] = [];
  let pending: { cells: Array<string | null> } | null = null;
  const flush = (detail: Map<string, string | null>) => {
    if (!pending) return;
    const [date, description, mode, amount] = pending.cells;
    const installment = /^(\d{1,3})\/(\d{1,3})$/.exec(detail.get("numero de parcelas") ?? "");
    const total = installment ? Number(installment[2]) : 1;
    out.push({
      invoiceMonth: month,
      position: out.length,
      date: parsePtBrDate(date, new Date(0)) ?? null,
      merchant: detail.get("nome no app") ?? description ?? "(sem descrição)",
      description: mode ?? detail.get("modo de compra") ?? null,
      amountCents: parseBrl(amount),
      installmentN: installment && total > 1 ? Number(installment[1]) : null,
      installmentTotal: installment && total > 1 ? total : null,
      holder: "desconhecido",
      holderName: null,
      kind: kindOf(mode ?? detail.get("modo de compra") ?? null),
    });
    pending = null;
  };
  for (const row of root.querySelectorAll(FULL_INVOICE.rows)) {
    if (row.querySelector(FULL_INVOICE.detail)) {
      flush(detailOf(row));
      continue;
    }
    flush(new Map());
    const cells = row.querySelectorAll(FULL_INVOICE.cells).map((span) => text(span));
    if (cells.length >= 4) pending = { cells };
  }
  flush(new Map());
  return out;
}

export function parseFullInvoice(html: string): FullInvoicePage {
  const root = parseHtml(html);
  const title = text(root.querySelector(FULL_INVOICE.title));
  if (!title) throw new ParseError("A página da fatura completa não tem o título da fatura.");
  if (root.querySelector(FULL_INVOICE.error)) {
    throw new ParseError("A página da fatura completa não carregou os lançamentos.");
  }
  // "Fatura de Outubro 2026": the year is always there, so no clock is needed.
  const month = resolveMonth(title.replace(/(\d{4})$/, "/$1"), new Date(0)) ?? null;
  const fields = header(root);
  const statusLabel = text(root.querySelector(FULL_INVOICE.status));
  const transactions = parseLines(root, month);
  const next = root.querySelector(FULL_INVOICE.nextPage);
  const active = Number(text(root.querySelector(FULL_INVOICE.activePage)));
  const warnings: string[] = [];
  const undated = transactions.filter((t) => t.date === null).length;
  if (undated > 0) warnings.push(`${undated} lançamento(s) sem data reconhecida`);
  const unpriced = transactions.filter((t) => t.amountCents === null).length;
  if (unpriced > 0) warnings.push(`${unpriced} lançamento(s) sem valor reconhecido`);
  return {
    month,
    status: invoiceStatus(statusLabel),
    statusLabel,
    dueDate: headerDate(fields.get("data do vencimento") ?? null, month),
    closingDate: headerDate(fields.get("data do fechamento") ?? null, month),
    totalCents: parseBrl(fields.get("valor da fatura") ?? null),
    paidCents: parseBrl(fields.get("valor pago") ?? null),
    page: Number.isInteger(active) && active > 0 ? active : null,
    hasNextPage: next !== null && !hasClass(next, FULL_INVOICE.disabledPage),
    transactions,
    warnings,
  };
}

/** Invoice months the picker offers ("Janeiro 2026" -> 2026-01), after a search. */
export function parseInvoiceOptions(html: string): string[] {
  return parseHtml(html)
    .querySelectorAll(FULL_INVOICE.pickerOption)
    .flatMap((option) => {
      const label = text(option);
      const month = label && /\d{4}$/.test(label) ? resolveMonth(label.replace(/(\d{4})$/, "/$1"), new Date(0)) : undefined;
      return month ? [month] : [];
    });
}
