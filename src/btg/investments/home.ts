import { ParseError } from "../../core/errors.js";
import type {
  AccountBalance,
  CardSummary,
  InvestmentAccount,
  OpenFinanceSummary,
} from "../../domain/types.js";
import { parseStatementAccount } from "./balance.js";
import { arr, bool, cents, num, obj, str } from "./json.js";
import { parseOpenFinance } from "./openfinance.js";

// `statement-position/home` is the hub: one plain-JSON call carries the
// checking account, the credit cards summary, the investment account and the
// open finance aggregate. Most read tools can answer from this alone.

export type Home = {
  account: AccountBalance | null;
  cards: CardSummary[];
  investment: InvestmentAccount | null;
  openFinance: OpenFinanceSummary;
};

function parseCard(value: unknown, index: number): CardSummary | null {
  const card = obj(value);
  if (!card) return null;
  const last4Raw = str(card.lastFourDigitis);
  const last4 = last4Raw && /^\d{4}$/.test(last4Raw) ? last4Raw : null;
  const cardType = str(card.cardType);
  const available = cents(card.availableLimit);
  const used = cents(card.usedLimit);
  const unlimited = bool(card.isUnlimited);
  return {
    cardId: `${(cardType ?? "card").toLowerCase()}-${last4 ?? index + 1}`,
    cardType,
    last4,
    availableCents: available,
    usedCents: used,
    limitCents: !unlimited && available !== null && used !== null ? available + used : null,
    invoiceCents: cents(card.invoice),
    unlimited,
  };
}

export function parseHome(json: unknown): Home {
  const root = obj(json);
  if (!root || (!("banking" in root) && !("investment" in root))) {
    throw new ParseError("statement-position/home sem os blocos banking/investment.");
  }
  const banking = obj(root.banking);
  const checking = obj(banking?.bankingAccount);
  const statementAccount = obj(obj(obj(root.investment)?.balance)?.statementAccount);
  return {
    account: checking
      ? {
          balanceCents: cents(checking.balance),
          balanceWithOverdraftCents: cents(checking.balanceWithOverdraftLimit),
          overdraftLimitCents: cents(num(checking.overdraftLimit)),
          hasOverdraftLimit: bool(checking.hasOverDraftLimit),
        }
      : null,
    cards: arr(banking?.bankingCreditCard)
      .map(parseCard)
      .filter((card): card is CardSummary => card !== null),
    investment: statementAccount ? parseStatementAccount(statementAccount) : null,
    openFinance: parseOpenFinance(root.openFinance),
  };
}
