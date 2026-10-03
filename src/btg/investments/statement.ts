import { ParseError } from "../../core/errors.js";
import type { FutureTransactions, InvestmentStatement, StatementLine } from "../../domain/types.js";
import { arr, cents, first, isoDay, obj, str } from "./json.js";

// Investment account statement and future transactions. The totals are
// confirmed against a live capture; the LINE shape is not yet (the captured
// period had no movement), so each line is read best-effort by common field
// names and kept whole in `raw`. When a populated capture exists, tighten this.

const DATE_KEYS = ["date", "transactionDate", "movementDate", "liquidationDate", "settlementDate", "referenceDate"];
const DESCRIPTION_KEYS = ["description", "historic", "history", "name", "title", "transactionDescription"];
const AMOUNT_KEYS = ["value", "amount", "financialValue", "netValue", "grossValue", "totalValue"];

export function parseLine(value: unknown): StatementLine {
  const line = obj(value) ?? {};
  return {
    date: first(line, DATE_KEYS, isoDay),
    description: first(line, DESCRIPTION_KEYS, str),
    amountCents: first(line, AMOUNT_KEYS, cents),
    raw: value,
  };
}

/**
 * Grouped statements arrive as groups that hold their own lines; flatten one
 * level when a group carries an array of lines, otherwise treat it as a line.
 */
function flatten(groups: unknown[]): StatementLine[] {
  return groups.flatMap((group) => {
    const record = obj(group);
    const nested = record
      ? Object.values(record).find((v) => Array.isArray(v) && v.some((x) => obj(x)))
      : undefined;
    if (Array.isArray(nested)) {
      const groupDate = record ? first(record, DATE_KEYS, isoDay) : null;
      return nested.map((item) => {
        const line = parseLine(item);
        return line.date || !groupDate ? line : { ...line, date: groupDate };
      });
    }
    return [parseLine(group)];
  });
}

/** `account-statement/period/{N}/history/grouped`. */
export function parseInvestmentStatement(json: unknown): InvestmentStatement {
  const root = obj(json);
  if (!root || !("transactionsGrouped" in root)) {
    throw new ParseError("account-statement sem transactionsGrouped.");
  }
  return {
    requestDate: isoDay(root.requestDate),
    previousBalanceCents: cents(root.previousBalance),
    actualBalanceCents: cents(root.actualBalance),
    totalCreditCents: cents(root.totalCredit),
    totalDebitCents: cents(root.totalDebit),
    availableCents: cents(root.availableBalance),
    entries: flatten(arr(root.transactionsGrouped)),
  };
}

/** `statement-position/v2/future-transactions`. */
export function parseFutureTransactions(json: unknown): FutureTransactions {
  const root = obj(json);
  if (!root || !("futureTransactions" in root)) {
    throw new ParseError("future-transactions sem futureTransactions.");
  }
  return {
    totalNextDaysCents: cents(root.totalAmountNextDays),
    entries: flatten(arr(root.futureTransactions)),
  };
}
