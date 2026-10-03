import { ParseError } from "../../core/errors.js";
import type { InvestmentAccount } from "../../domain/types.js";
import { bool, cents, isoDay, num, obj, str } from "./json.js";

// `statementAccount` is the investment account block. The same object comes
// inside the home hub and from `statement-position/summary/balance`, so both go
// through this one parser.

export function parseStatementAccount(value: unknown): InvestmentAccount {
  const account = obj(value);
  if (!account) throw new ParseError("statementAccount ausente na resposta de saldo.");
  const performance = obj(account.performance);
  const credit = obj(account.creditLimit);
  const remunerated = obj(account.remuneratedBalance);
  return {
    consolidatedDate: isoDay(account.consolidatedDate),
    totalCents: cents(account.total),
    totalInvestedCents: cents(account.totalInvested),
    accountBalanceCents: cents(account.investmentAccountBalance),
    availableCents: cents(account.availableAmount),
    blockedCents: cents(account.blockedAmount),
    transitCents: cents(account.transitAmount),
    futureTransactionsCents: cents(account.futureTransactionsAmount),
    gainCents: cents(performance?.accumulatedGain),
    accumulatedYieldPercent: num(performance?.accumulatedYield),
    performancePeriod: str(performance?.performancePeriodDescription),
    creditLimit: credit
      ? {
          availableCents: cents(credit.available),
          leverageCents: cents(credit.leverage),
          availableLeverageCents: cents(credit.availableLeverage),
          blockedCents: cents(credit.blocked),
          balanceCents: cents(credit.balance),
        }
      : null,
    remunerated: remunerated
      ? { enabled: bool(remunerated.remuneratedBalanceEnabled), valueCents: cents(remunerated.remuneratedValue) }
      : null,
  };
}

/** `statement-position/summary/balance` -> the investment account. */
export function parseSummaryBalance(json: unknown): InvestmentAccount {
  return parseStatementAccount(obj(json)?.statementAccount);
}

export type BalanceDetail = {
  availableCents: number | null;
  balanceCents: number | null;
  blockedCents: number | null;
  judiciallyBlockedCents: number | null;
  totalBlockedCents: number | null;
  warrantyMarginCents: number | null;
  creditEnabled: boolean;
};

/** `statement-position/balance/detail` -> where the investment account balance is (and is not) free. */
export function parseBalanceDetail(json: unknown): BalanceDetail {
  const detail = obj(json);
  if (!detail || !("availableBalance" in detail)) {
    throw new ParseError("balance/detail sem availableBalance.");
  }
  return {
    availableCents: cents(detail.availableBalance),
    balanceCents: cents(detail.balanceCC),
    blockedCents: cents(detail.blockedCC),
    judiciallyBlockedCents: cents(detail.blockedJd),
    totalBlockedCents: cents(detail.totalBlocked),
    warrantyMarginCents: cents(detail.warrantyMargin),
    creditEnabled: bool(detail.creditEnabled),
  };
}
