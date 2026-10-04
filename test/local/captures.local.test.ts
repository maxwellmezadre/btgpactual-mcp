import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseFullInvoice, parseInvoiceOptions } from "../../src/btg/banking/invoice-details.js";
import { parseBalanceDetail, parseSummaryBalance } from "../../src/btg/investments/balance.js";
import { parseHome } from "../../src/btg/investments/home.js";
import { parseAllocation } from "../../src/btg/investments/position.js";
import { parseFutureTransactions, parseInvestmentStatement } from "../../src/btg/investments/statement.js";

// Golden checks over the REAL captures in task/captures (gitignored). Skipped in
// CI and on any machine without captures. They assert invariants, never values,
// so they keep holding as the balances move.

const DIR = join(import.meta.dir, "..", "..", "task", "captures");
const has = (name: string) => existsSync(join(DIR, `investments-${name}.json`));
const load = (name: string): unknown => JSON.parse(readFileSync(join(DIR, `investments-${name}.json`), "utf8"));

describe.skipIf(!has("home"))("real captures: investments", () => {
  test("home hub parses with account, cards and investment block", () => {
    const home = parseHome(load("home"));
    expect(home.account?.balanceCents).not.toBeNull();
    expect(home.cards.every((c) => c.unlimited || c.limitCents !== null)).toBe(true);
    expect(home.cards.every((c) => (c.invoiceCents ?? 0) <= (c.usedCents ?? 0) + 1)).toBe(true);
    expect(home.investment).not.toBeNull();
    const accounts = home.openFinance.banking?.institutions.flatMap((i) => i.accounts) ?? [];
    expect(accounts.every((a) => a.numberMasked === null || a.numberMasked.startsWith("***"))).toBe(true);
  });

  test.skipIf(!has("allocation-summary"))("allocation: every position complete, identities hold", () => {
    const allocation = parseAllocation(load("allocation-summary"));
    expect(allocation.warnings).toEqual([]);
    expect(allocation.positions.length).toBeGreaterThan(0);
    for (const p of allocation.positions) {
      expect(p.name).not.toBe("(sem nome)");
      expect(p.grossValueCents).not.toBeNull();
      expect(p.investedCents).not.toBeNull();
    }
    const home = parseHome(load("home"));
    expect(home.investment?.totalInvestedCents).toBe(allocation.totalCents);
  });

  test.skipIf(!has("summary-balance"))("summary/balance equals the hub's investment block", () => {
    expect(parseSummaryBalance(load("summary-balance"))).toEqual(parseHome(load("home")).investment as never);
  });

  test.skipIf(!has("balance-detail"))("balance/detail parses", () => {
    expect(parseBalanceDetail(load("balance-detail")).availableCents).not.toBeNull();
  });

  test.skipIf(!has("account-statement-30"))("statement: previous + credit - debit = actual", () => {
    const s = parseInvestmentStatement(load("account-statement-30"));
    expect((s.previousBalanceCents ?? 0) + (s.totalCreditCents ?? 0) - (s.totalDebitCents ?? 0)).toBe(
      s.actualBalanceCents ?? Number.NaN,
    );
  });

  test.skipIf(!has("future"))("future transactions parse", () => {
    expect(parseFutureTransactions(load("future")).totalNextDaysCents).not.toBeNull();
  });
});

import { parseCardsScreen } from "../../src/btg/banking/cards.js";
import { priceForeignLines } from "../../src/cache/history.js";
import { parseStatementScreen } from "../../src/btg/banking/statement.js";

const hasHtml = (name: string) => existsSync(join(DIR, `banking-${name}.html`));
const loadHtml = (name: string) => readFileSync(join(DIR, `banking-${name}.html`), "utf8");

/**
 * Bun runs a describe() body even when the block is skipped, so nothing may
 * touch the captures at collection time: parse lazily, once, inside a test.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

describe.skipIf(!hasHtml("cartoes"))("real captures: cards screen", () => {
  const get = lazy(() => parseCardsScreen(loadHtml("cartoes"), new Date()));
  test("every line parses: date, amount, no warnings", () => {
    const screen = get();
    expect(screen.transactions.length).toBeGreaterThan(0);
    expect(screen.warnings).toEqual([]);
  });
  test("installments carry N/T and only installments do", () => {
    const screen = get();
    for (const t of screen.transactions) {
      if (t.kind === "installment") {
        expect(t.installmentN).not.toBeNull();
        expect(t.installmentN ?? 0).toBeLessThanOrEqual(t.installmentTotal ?? 0);
      } else expect(t.installmentN).toBeNull();
    }
  });
  test("charges are negative, payments positive, nothing dated in the future", () => {
    const screen = get();
    const today = new Date().toISOString().slice(0, 10);
    for (const t of screen.transactions) {
      // International lines show only their own currency here: unpriced until the full invoice page prices them.
      if (t.amountCents === null) expect(t.kind).toBe("international");
      else if (["purchase", "installment", "international"].includes(t.kind)) expect(t.amountCents).toBeLessThan(0);
      if (t.kind === "payment") expect(t.amountCents ?? 0).toBeGreaterThan(0);
      expect((t.date ?? "") <= today).toBe(true);
    }
  });
  test("additional cardholder lines are named and add up to the additional total", () => {
    const screen = get();
    const additional = screen.holderTotals.find((h) => h.holder === "adicional");
    const lines = screen.transactions.filter((t) => t.holder === "adicional");
    expect(lines.every((t) => t.holderName)).toBe(true);
    if (additional && lines.length) {
      const sum = -lines.filter((t) => t.kind !== "payment").reduce((a, t) => a + (t.amountCents ?? 0), 0);
      expect(Math.abs(sum - (additional.totalCents ?? 0))).toBeLessThanOrEqual(2);
    }
  });
  test("invoice header and months resolve", () => {
    const screen = get();
    expect(screen.invoice?.month).toMatch(/^\d{4}-\d{2}$/);
    expect(screen.invoice?.totalCents).not.toBeNull();
    expect(screen.months.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasHtml("conta-corrente"))("real captures: statement screen", () => {
  const get = lazy(() => parseStatementScreen(loadHtml("conta-corrente"), new Date()));
  test("rows complete, ids unique, pager read", () => {
    const screen = get();
    expect(screen.warnings).toEqual([]);
    expect(screen.entries.every((e) => e.date && e.time && e.amountCents !== null)).toBe(true);
    expect(new Set(screen.entries.map((e) => e.id)).size).toBe(screen.entries.length);
    expect(screen.page?.total ?? 0).toBeGreaterThanOrEqual(screen.entries.length);
  });
});

const FULL_DIR = join(DIR, "invoice-full");
const fullPages = existsSync(FULL_DIR) ? readdirSync(FULL_DIR).filter((f) => /^\d{4}-\d{2}-p\d+\.html$/.test(f)) : [];

describe.skipIf(fullPages.length === 0)("real captures: full invoice pages", () => {
  test("every page: its month, dates, amount, and one line per row detail", () => {
    for (const file of fullPages) {
      const html = readFileSync(join(FULL_DIR, file), "utf8");
      const page = parseFullInvoice(html);
      expect(page.month).toBe(file.slice(0, 7));
      expect(page.dueDate?.startsWith(page.month as string)).toBe(true);
      expect(page.closingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.totalCents).not.toBeNull();
      if (page.status === "paid") expect(page.paidCents).not.toBeNull();
      expect(page.warnings).toEqual([]);
      expect(page.transactions.length).toBe((html.match(/<btg-invoice-transaction-detail/g) ?? []).length);
      expect(page.page).toBe(Number(/-p(\d+)\.html$/.exec(file)?.[1]));
    }
  });

  test.skipIf(!hasHtml("cartoes"))("the month's full page prices every international timeline line in reais", () => {
    const screen = parseCardsScreen(loadHtml("cartoes"), new Date());
    const month = screen.timelineMonth as string;
    const files = fullPages.filter((f) => f.startsWith(month)).sort();
    const full = files.flatMap((f) => parseFullInvoice(readFileSync(join(FULL_DIR, f), "utf8")).transactions);
    const foreign = priceForeignLines(screen.transactions, full).filter((t) => t.kind === "international");
    expect(files.length).toBeGreaterThan(0);
    expect(foreign.length).toBeGreaterThan(0);
    for (const t of foreign) expect(t.amountCents ?? 0).toBeLessThan(0);
  });

  test.skipIf(!existsSync(join(FULL_DIR, "picker-2026.html")))("the picker search lists the year's months", () => {
    const months = parseInvoiceOptions(readFileSync(join(FULL_DIR, "picker-2026.html"), "utf8"));
    expect(months.length).toBeGreaterThan(0);
    expect(months.every((m) => m.startsWith("2026-"))).toBe(true);
  });
});
