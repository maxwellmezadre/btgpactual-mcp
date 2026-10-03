import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
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
