import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { kindOf, parseCardsScreen } from "../src/btg/banking/cards.js";
import { ParseError } from "../src/core/errors.js";

const html = readFileSync(join(import.meta.dir, "fixtures/banking/cartoes.html"), "utf8");
const now = new Date(Date.UTC(2026, 9, 2));
const screen = parseCardsScreen(html, now);

describe("cards screen", () => {
  test("selected invoice: month, status and BTG's own total", () => {
    expect(screen.invoice).toEqual({ month: "2026-10", status: "closed", statusLabel: "Fatura fechada", totalCents: 25000 });
  });

  test("invoice timeline months resolve to the nearest year, explicit year wins", () => {
    expect(screen.months).toEqual([
      { month: "2026-09", status: "paid", statusLabel: "Paga", label: "Set" },
      { month: "2026-10", status: "closed", statusLabel: "Fechada", label: "Out" },
      { month: "2026-11", status: "open", statusLabel: "Aberta", label: "Nov" },
      { month: "2027-01", status: "future", statusLabel: "Futura", label: "Jan/2027" },
    ]);
  });

  test("per-holder totals (titular x adicional)", () => {
    expect(screen.holderTotals).toEqual([
      { holder: "titular", holderName: null, totalCents: 30000 },
      { holder: "adicional", holderName: "PESSOA EXEMPLO", totalCents: 10000 },
    ]);
  });

  test("a group without a date block continues the previous day", () => {
    const [alfa, beta] = screen.transactions;
    expect(alfa?.date).toBe("2026-10-01");
    expect(beta?.date).toBe("2026-10-01");
    expect(beta?.holder).toBe("adicional");
    expect(beta?.holderName).toBe("PESSOA EXEMPLO");
  });

  test("installment suffix is split from the merchant", () => {
    const gama = screen.transactions.find((t) => t.merchant === "LOJA GAMA");
    expect(gama).toMatchObject({ installmentN: 3, installmentTotal: 10, kind: "installment", amountCents: -3000, date: "2026-09-15" });
  });

  test("the h2 year wins for old installment purchases", () => {
    const delta = screen.transactions.find((t) => t.merchant === "LOJA DELTA");
    expect(delta?.date).toBe("2025-12-29");
    expect(delta?.installmentN).toBe(10);
  });

  test("kinds and signs as shown", () => {
    expect(screen.transactions.map((t) => [t.merchant, t.kind, t.amountCents])).toEqual([
      ["LOJA ALFA", "purchase", -5000],
      ["LOJA BETA", "purchase", -10000],
      ["LOJA GAMA", "installment", -3000],
      ["Pagamento recebido", "payment", 150000],
      ["LOJA DELTA", "installment", -2000],
      // Shown only in its own currency (US$): unpriced here, reais come from the full invoice page.
      ["LOJA EPSILON", "international", null],
      ["LOJA ZETA", "cancelled", 1000],
    ]);
    expect(screen.transactions.every((t) => t.invoiceMonth === "2026-10")).toBe(true);
    expect(screen.warnings).toEqual([]);
  });

  test("default view: the list is attributed to the header month, unconfirmed", () => {
    expect(screen.timelineMonth).toBe("2026-10");
    expect(screen.timelineConfirmed).toBe(false);
  });

  test("after a confirmed click the list belongs to the clicked month, not the header", () => {
    const clicked = parseCardsScreen(html.replace("<span><div><span>Nov</span>", '<span data-btg-selected="true"><div><span>Nov</span>'), now);
    expect(clicked.timelineMonth).toBe("2026-11");
    expect(clicked.timelineConfirmed).toBe(true);
    expect(clicked.invoice?.month).toBe("2026-10"); // the header card never moves
    expect(clicked.transactions.every((t) => t.invoiceMonth === "2026-11")).toBe(true);
  });

  test("kindOf: cancellation beats purchase wording", () => {
    expect(kindOf("Compra no crédito cancelada pelo estabelecimento")).toBe("cancelled");
    expect(kindOf("Compra no crédito parcelada")).toBe("installment");
    expect(kindOf(null)).toBe("other");
  });

  test("kindOf: the full invoice page's purchase modes", () => {
    expect(kindOf("Compra a vista")).toBe("purchase");
    expect(kindOf("Parcela sem juros")).toBe("installment");
    expect(kindOf("Compra internacional")).toBe("international");
    expect(kindOf("Cancelamento de compra")).toBe("cancelled");
    expect(kindOf("Pagamento")).toBe("payment");
  });

  test("a page without invoice or timeline is a ParseError", () => {
    expect(() => parseCardsScreen("<html><body><p>nada</p></body></html>", now)).toThrow(ParseError);
  });
});
