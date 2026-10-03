import { describe, expect, test } from "bun:test";
import { parseFutureTransactions, parseInvestmentStatement } from "../src/btg/investments/statement.js";
import { ParseError } from "../src/core/errors.js";
import statement from "./fixtures/investments/statement.json" with { type: "json" };

describe("investment account statement", () => {
  test("totals in cents and the balance identity holds", () => {
    const parsed = parseInvestmentStatement(statement);
    expect(parsed.requestDate).toBe("2026-01-15");
    const { previousBalanceCents: prev, totalCreditCents: credit, totalDebitCents: debit, actualBalanceCents: actual } = parsed;
    expect([prev, credit, debit, actual]).toEqual([10000, 5000, 3000, 12000]);
    expect((prev ?? 0) + (credit ?? 0) - (debit ?? 0)).toBe(actual ?? -1);
  });

  test("grouped lines are flattened, inheriting the group date when they lack one", () => {
    const { entries } = parseInvestmentStatement(statement);
    expect(entries.map((e) => [e.date, e.description, e.amountCents])).toEqual([
      ["2026-01-10", "RESGATE EXEMPLO", 5000],
      ["2026-01-11", "TAXA EXEMPLO", -3000],
    ]);
    expect(entries[0]?.raw).toEqual({ description: "RESGATE EXEMPLO", value: 50 });
  });

  test("an empty period (the real capture) gives no entries", () => {
    expect(parseInvestmentStatement({ ...statement, transactionsGrouped: [] }).entries).toEqual([]);
  });

  test("future transactions", () => {
    const parsed = parseFutureTransactions({ totalAmountNextDays: 12.34, currentDate: null, futureTransactions: [] });
    expect(parsed.totalNextDaysCents).toBe(1234);
    expect(parsed.entries).toEqual([]);
  });

  test("wrong payloads are ParseErrors", () => {
    expect(() => parseInvestmentStatement({})).toThrow(ParseError);
    expect(() => parseFutureTransactions({})).toThrow(ParseError);
  });
});
