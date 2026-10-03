import type { Holder, InvoiceStatus } from "./status.js";

// The structs the parsers produce and the cache stores. Money is integer cents;
// dates are ISO (YYYY-MM-DD); months are YYYY-MM. `null` means "the source did
// not provide it", never 0.

/** Checking account (conta corrente), from the investments home hub. */
export type AccountBalance = {
  balanceCents: number | null;
  balanceWithOverdraftCents: number | null;
  overdraftLimitCents: number | null;
  hasOverdraftLimit: boolean;
};

/**
 * Credit card summary from the home hub. The hub has no card id and, in
 * practice, `lastFourDigitis` comes null, so `cardId` is synthesised from the
 * card type and position; the banking screens carry the full card detail.
 */
export type CardSummary = {
  cardId: string;
  cardType: string | null;
  last4: string | null;
  availableCents: number | null;
  usedCents: number | null;
  /** available + used; null when the card is unlimited or a part is missing. */
  limitCents: number | null;
  invoiceCents: number | null;
  unlimited: boolean;
};

/** Investment account (conta investimento) balances and performance. */
export type InvestmentAccount = {
  consolidatedDate: string | null;
  totalCents: number | null;
  totalInvestedCents: number | null;
  accountBalanceCents: number | null;
  availableCents: number | null;
  blockedCents: number | null;
  transitCents: number | null;
  futureTransactionsCents: number | null;
  gainCents: number | null;
  /** Accumulated return as BTG reports it, in percent (its own basis). */
  accumulatedYieldPercent: number | null;
  performancePeriod: string | null;
  creditLimit: {
    availableCents: number | null;
    leverageCents: number | null;
    availableLeverageCents: number | null;
    blockedCents: number | null;
    balanceCents: number | null;
  } | null;
  remunerated: { enabled: boolean; valueCents: number | null } | null;
};

export type Card = {
  cardId: string;
  name: string;
  variant: string | null;
  holder: Holder;
  holderName: string | null;
  last4: string | null;
  limitCents: number | null;
  usedCents: number | null;
  availableCents: number | null;
  invoiceCents: number | null;
  dueDate: string | null;
  bestPurchaseDay: number | null;
  cardType: string | null;
  isAdditional: boolean;
};

export type Invoice = {
  cardId: string;
  month: string;
  status: InvoiceStatus;
  statusLabel: string | null;
  totalCents: number | null;
  dueDate: string | null;
};

export type InvoiceTransaction = {
  cardId: string;
  month: string;
  position: number;
  date: string | null;
  merchant: string;
  description: string | null;
  amountCents: number | null;
  installmentN: number | null;
  installmentTotal: number | null;
  holder: Holder;
  holderName: string | null;
  category: string | null;
};

export type StatementEntry = {
  id: string;
  date: string | null;
  counterparty: string | null;
  category: string | null;
  description: string | null;
  time: string | null;
  amountCents: number | null;
  balanceDayCents: number | null;
};

/**
 * One holding, normalised across asset classes (equities/ETF, fixed income,
 * crypto, and any class BTG adds later). Totals are integer cents; unit prices
 * stay in reais, unrounded, because they are never summed and sub-cent
 * precision matters for them (crypto, average prices).
 */
export type Position = {
  assetClassId: string;
  assetClass: string;
  /** Where in the tree it came from: etf, acao, fii, bdr, renda_fixa, cripto... */
  kind: string;
  productId: string;
  name: string;
  description: string | null;
  quantity: number | null;
  averagePrice: number | null;
  marketPrice: number | null;
  grossValueCents: number | null;
  netValueCents: number | null;
  investedCents: number | null;
  gainCents: number | null;
  /** Return on the invested amount, in percent (verified: gain / invested x 100). */
  yieldPercent: number | null;
  issuer: string | null;
  /** Fixed income indexer as shown, e.g. "110% CDI". */
  indexer: string | null;
  maturityDate: string | null;
  incomeTaxCents: number | null;
  iofCents: number | null;
};

export type AssetClassSummary = {
  id: string;
  name: string;
  valueCents: number | null;
  gainCents: number | null;
  accumulatedYieldPercent: number | null;
  positionCount: number;
};

export type Allocation = {
  account: string | null;
  positionDate: string | null;
  totalCents: number | null;
  classes: AssetClassSummary[];
  positions: Position[];
  /** Identity checks that failed (sum of positions vs class value, classes vs total). */
  warnings: string[];
};

/** A statement/future line. The element shape is not confirmed yet, so `raw` keeps it whole. */
export type StatementLine = {
  date: string | null;
  description: string | null;
  amountCents: number | null;
  raw: unknown;
};

export type InvestmentStatement = {
  requestDate: string | null;
  previousBalanceCents: number | null;
  actualBalanceCents: number | null;
  totalCreditCents: number | null;
  totalDebitCents: number | null;
  availableCents: number | null;
  entries: StatementLine[];
};

export type FutureTransactions = {
  totalNextDaysCents: number | null;
  entries: StatementLine[];
};

export type OpenFinanceAccount = {
  type: string | null;
  name: string | null;
  /** Only the last 4 digits; the full number never leaves the parser. */
  numberMasked: string | null;
  balanceCents: number | null;
  overdraftLimitCents: number | null;
  balanceWithOverdraftCents: number | null;
};

export type OpenFinanceSummary = {
  investments: {
    totalCents: number | null;
    institutions: Array<{ name: string; totalCents: number | null }>;
  } | null;
  banking: {
    totalCents: number | null;
    otherInstitutionsCents: number | null;
    institutions: Array<{ name: string; compeCode: string | null; accounts: OpenFinanceAccount[] }>;
    /** Connection notices BTG shows (e.g. a consent that needs renewal). */
    notices: string[];
  } | null;
};
