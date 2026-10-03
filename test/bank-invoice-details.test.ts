import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFullInvoice, parseInvoiceOptions } from "../src/btg/banking/invoice-details.js";
import { ParseError } from "../src/core/errors.js";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "banking", name), "utf8");
const html = fixture("fatura-completa.html");

describe("full invoice page", () => {
  test("header: month, status, due and closing dates, amount and paid amount", () => {
    const page = parseFullInvoice(html);
    expect(page).toMatchObject({
      month: "2026-08",
      status: "paid",
      statusLabel: "Pago",
      dueDate: "2026-08-07",
      closingDate: "2026-08-03",
      totalCents: 123456,
      paidCents: 123456,
      page: 1,
      hasNextPage: false,
      warnings: [],
    });
  });

  test("lines keep the screen's sign, the full date, the mode and the installment from the detail", () => {
    const lines = parseFullInvoice(html).transactions;
    expect(lines.map((l) => [l.date, l.merchant, l.amountCents, l.kind])).toEqual([
      ["2026-07-31", "Padaria Exemplo", -1250, "purchase"],
      ["2026-06-15", "Loja Movel", -30000, "installment"],
      ["2026-07-20", "Servidor Exemplo", -9990, "international"],
      ["2026-07-18", "Streaming Exemplo", 1990, "cancelled"],
      ["2026-07-10", "Pagamento De Fatura Por Debito Em Conta", 90000, "payment"],
      ["2026-07-05", "Cashback Exemplo", 500, "other"],
    ]);
    expect(lines[1]).toMatchObject({ installmentN: 2, installmentTotal: 4, description: "Parcela sem juros" });
    // "1/1" is not an installment.
    expect(lines[0]).toMatchObject({ installmentN: null, installmentTotal: null });
    // This screen never says whose card it was.
    expect(new Set(lines.map((l) => l.holder))).toEqual(new Set(["desconhecido"]));
    expect(lines.map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("an unpaid invoice has no paid amount, and a next page is seen", () => {
    const open = html
      .replace(/<div class="invoice-details__divider invoice-details__amount-divider">[\s\S]*?R\$ 1\.234,56 <\/strong><\/div><\/div>\s*<\/div>/, "</div>")
      .replace(" Pago ", " Em aberto ")
      .replace(
        'data-testid="pagination-next-button" class="orq-pagination__list-item orq-pagination__list-item--disabled"',
        'data-testid="pagination-next-button" class="orq-pagination__list-item"',
      );
    const page = parseFullInvoice(open);
    expect(page).toMatchObject({ status: "open", totalCents: 123456, paidCents: null, hasNextPage: true });
  });

  test("closing date in December of a January invoice lands in the previous year", () => {
    const january = html
      .replace("Fatura de Agosto 2026", "Fatura de Janeiro 2027")
      .replace("07 de Agosto", "07 de Janeiro")
      .replace("03 de Agosto", "28 de Dezembro");
    expect(parseFullInvoice(january)).toMatchObject({ month: "2027-01", dueDate: "2027-01-07", closingDate: "2026-12-28" });
  });

  test("a page without the invoice title, or with the lines error, is refused", () => {
    expect(() => parseFullInvoice("<btg-invoice-details></btg-invoice-details>")).toThrow(ParseError);
    const failed = html.replace("<orq-table>", '<div data-testid="invoice-transactions-error"></div><orq-table>');
    expect(() => parseFullInvoice(failed)).toThrow(/não carregou os lançamentos/);
  });

  test("picker options become months; an empty search becomes none", () => {
    expect(parseInvoiceOptions(fixture("seletor-faturas.html"))).toEqual([
      "2026-12", "2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-03",
    ]);
    expect(parseInvoiceOptions('<div class="orq-dropdown-list"><span>Nenhuma fatura encontrada</span></div>')).toEqual([]);
  });
});
