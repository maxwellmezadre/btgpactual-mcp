import { ParseError } from "../../core/errors.js";
import { parsePtBrDate, resolveMonth, stripAccents } from "../../domain/dates.js";
import { parseBrl } from "../../domain/money.js";
import { holderOf, invoiceStatus } from "../../domain/status.js";
import type {
  CardTransactionKind,
  CardsScreen,
  HolderTotal,
  InvoiceMonth,
  InvoiceTransaction,
} from "../../domain/types.js";
import { type HTMLElement, hasClass, parseHtml, text, walk } from "./dom.js";
import { CARDS } from "./selectors.js";

// The /cartoes screen, rendered. One page carries the selected invoice (month,
// status, total), the invoice timeline (months and statuses), the per-holder
// totals (titular x adicional) and every line of the selected invoice.

/** "LOJA EXEMPLO (3/10)" -> installment 3 of 10, merchant without the suffix. */
const INSTALLMENT = /\s*\((\d{1,3})\/(\d{1,3})\)\s*$/;

export function kindOf(subtitle: string | null): CardTransactionKind {
  const text = stripAccents(subtitle ?? "").toLowerCase();
  // Timeline wording ("...parcelada", "...cancelada") and the full invoice
  // page's ("Parcela sem juros", "Cancelamento de compra").
  if (text.includes("cancelad") || text.includes("cancelament")) return "cancelled";
  if (text.includes("fatura paga") || text.startsWith("pagamento")) return "payment";
  if (text.includes("parcel")) return "installment";
  if (text.includes("internacional")) return "international";
  if (text.includes("compra")) return "purchase";
  return "other";
}

/** The day heading: prefer the h2 when it carries a year, else the h4 ("10 de Outubro"). */
function blockDate(block: HTMLElement, now: Date): string | null {
  const relative = text(block.querySelector(CARDS.dateRelative));
  const absolute = text(block.querySelector(CARDS.dateAbsolute));
  const withYear = relative && /\d{4}/.test(relative) ? relative : null;
  return parsePtBrDate(withYear ?? absolute ?? relative, now) ?? null;
}

function parseTransactions(root: HTMLElement, invoiceMonth: string | null, now: Date): InvoiceTransaction[] {
  const timeline = root.querySelector(CARDS.timeline);
  if (!timeline) return [];
  const out: InvoiceTransaction[] = [];
  let date: string | null = null;
  // Groups without a date block continue the previous day, so walk in document order.
  walk(timeline, (el) => {
    if (hasClass(el, CARDS.dateBlock)) {
      date = blockDate(el, now);
      return "skip";
    }
    if (!hasClass(el, CARDS.item)) return;
    const title = text(el.querySelector(CARDS.itemTitle)) ?? "";
    const subtitle = text(el.querySelector(CARDS.itemSubtitle));
    const installment = INSTALLMENT.exec(title);
    const { holder, holderName } = holderOf(subtitle);
    out.push({
      invoiceMonth,
      position: out.length,
      date,
      merchant: title.replace(INSTALLMENT, "").trim() || "(sem descrição)",
      description: subtitle,
      amountCents: parseBrl(text(el.querySelector(CARDS.itemValue))),
      installmentN: installment ? Number(installment[1]) : null,
      installmentTotal: installment ? Number(installment[2]) : null,
      holder,
      holderName: holderName ?? null,
      kind: kindOf(subtitle),
    });
    return "skip";
  });
  return out;
}

function parseMonths(root: HTMLElement, now: Date): Array<InvoiceMonth & { selected: boolean }> {
  return root.querySelectorAll(CARDS.chartLabels).flatMap((label) => {
    const spans = label.querySelectorAll("span");
    const monthLabel = text(spans[0]);
    const statusLabel = text(spans[spans.length - 1]);
    const month = monthLabel ? resolveMonth(monthLabel, now) : undefined;
    if (!month || !monthLabel || !statusLabel || spans.length < 2) return [];
    return [
      {
        month,
        status: invoiceStatus(statusLabel),
        statusLabel,
        label: monthLabel,
        selected: label.getAttribute(CARDS.selectedAttribute) === "true",
      },
    ];
  });
}

function parseHolderTotals(root: HTMLElement): HolderTotal[] {
  return root.querySelectorAll(CARDS.holderItems).flatMap((item) => {
    const name = text(item.querySelector(CARDS.holderName));
    if (!name) return [];
    const titular = stripAccents(name).toLowerCase() === "titular";
    return [
      {
        holder: titular ? "titular" : "adicional",
        holderName: titular ? null : name,
        totalCents: parseBrl(text(item.querySelector(CARDS.holderAmount))),
      },
    ];
  });
}

export function parseCardsScreen(html: string, now: Date): CardsScreen {
  const root = parseHtml(html);
  const timeline = root.querySelector(CARDS.timeline);
  const title = text(root.querySelector(CARDS.invoiceTitle));
  if (!timeline && !title) {
    throw new ParseError("A tela de cartões não tem a fatura nem a lista de lançamentos.");
  }

  const month = title ? (resolveMonth(title, now) ?? null) : null;
  const statusLabel = text(root.querySelector(CARDS.invoiceStatus));
  const amountText = root
    .querySelectorAll(CARDS.invoiceAmount)
    .map((p) => text(p))
    .find((value) => value !== null && /R\$/.test(value));
  const invoice = title
    ? {
        month,
        status: invoiceStatus(statusLabel),
        statusLabel,
        totalCents: parseBrl(amountText ?? null),
      }
    : null;

  const chart = parseMonths(root, now);
  const confirmed = chart.find((m) => m.selected)?.month ?? null;
  const timelineMonth = confirmed ?? month;
  const transactions = parseTransactions(root, timelineMonth, now);
  const holderTotals = parseHolderTotals(root);
  const warnings: string[] = [];
  const undated = transactions.filter((t) => t.date === null).length;
  if (undated > 0) warnings.push(`${undated} lançamento(s) sem data reconhecida`);
  // International lines show only their own currency here; the sync prices
  // them from the full invoice page (cache/history.ts), so they are expected.
  const unpriced = transactions.filter((t) => t.amountCents === null && t.kind !== "international").length;
  if (unpriced > 0) warnings.push(`${unpriced} lançamento(s) sem valor reconhecido`);

  return {
    invoice,
    months: chart.map(({ selected: _selected, ...m }) => m),
    timelineMonth,
    timelineConfirmed: confirmed !== null,
    holderTotals,
    transactions,
    warnings,
  };
}
