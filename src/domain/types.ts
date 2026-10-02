import type { Holder, InvoiceStatus } from "./status.js";

// The structs the parsers produce and the cache stores. Money is integer cents;
// dates are ISO (YYYY-MM-DD); months are YYYY-MM. `null` means "the source did
// not provide it", never 0.

export type AccountBalance = {
  balanceCents: number | null;
  balanceWithOverdraftCents: number | null;
  overdraftLimitCents: number | null;
  remuneratedCents: number | null;
  capturedAt: string;
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

export type Position = {
  account: string;
  assetClass: string;
  productId: string;
  productName: string;
  averagePriceCents: number | null;
  availableQuantity: number | null;
  marketPriceCents: number | null;
  grossValueCents: number | null;
  resultCents: number | null;
};

export type FutureTransaction = {
  date: string | null;
  description: string | null;
  amountCents: number | null;
};

export type OpenFinanceInstitution = {
  id: string;
  name: string;
  amountCents: number | null;
  local: boolean;
};
