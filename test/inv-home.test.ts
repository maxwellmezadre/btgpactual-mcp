import { describe, expect, test } from "bun:test";
import { parseBalanceDetail, parseSummaryBalance } from "../src/btg/investments/balance.js";
import { parseHome } from "../src/btg/investments/home.js";
import { ParseError } from "../src/core/errors.js";
import home from "./fixtures/investments/home.json" with { type: "json" };

describe("investments home hub", () => {
  const parsed = parseHome(home);

  test("checking account in cents", () => {
    expect(parsed.account).toEqual({
      balanceCents: 123456,
      balanceWithOverdraftCents: 123456,
      overdraftLimitCents: 0,
      hasOverdraftLimit: false,
    });
  });

  test("card summary: limit = available + used, null last4 stays null", () => {
    const [card] = parsed.cards;
    expect(card?.cardId).toBe("black-1");
    expect(card?.last4).toBeNull();
    expect(card?.limitCents).toBe(1_000_000);
    expect(card?.invoiceCents).toBe(150010);
  });

  test("unlimited card has no computed limit", () => {
    const unlimited = parseHome({
      banking: { bankingCreditCard: [{ cardType: "X", availableLimit: 1, usedLimit: 1, invoice: 0, isUnlimited: true }] },
    });
    expect(unlimited.cards[0]?.limitCents).toBeNull();
  });

  test("investment account block", () => {
    expect(parsed.investment?.totalInvestedCents).toBe(350050);
    expect(parsed.investment?.availableCents).toBe(49950);
    expect(parsed.investment?.accumulatedYieldPercent).toBe(9.5);
    expect(parsed.investment?.consolidatedDate).toBe("2026-01-15");
    expect(parsed.investment?.remunerated).toEqual({ enabled: true, valueCents: 0 });
  });

  test("open finance: institutions, masked account numbers, notices", () => {
    const of = parsed.openFinance;
    expect(of.investments?.institutions).toEqual([
      { name: "INSTITUICAO A", totalCents: 60000 },
      { name: "INSTITUICAO B", totalCents: 40000 },
    ]);
    const account = of.banking?.institutions[0]?.accounts[0];
    expect(account?.numberMasked).toBe("***6789");
    expect(account?.balanceCents).toBe(76594);
    expect(of.banking?.notices).toEqual(["Renove o consentimento"]);
    expect(JSON.stringify(of)).not.toContain("123456789");
  });

  test("summary/balance parses to the same investment account", () => {
    expect(parseSummaryBalance(home.investment.balance)).toEqual(parsed.investment as never);
  });

  test("balance/detail", () => {
    const detail = parseBalanceDetail({ availableBalance: 10.5, balanceCC: 10.5, blockedCC: 0, blockedJd: 0, totalBlocked: 0, warrantyMargin: 0, creditEnabled: true });
    expect(detail.availableCents).toBe(1050);
    expect(detail.creditEnabled).toBe(true);
  });

  test("a payload without the hub blocks is a ParseError", () => {
    expect(() => parseHome({ something: 1 })).toThrow(ParseError);
    expect(() => parseBalanceDetail({})).toThrow(ParseError);
  });
});
