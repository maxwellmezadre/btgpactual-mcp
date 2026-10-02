// The investments channel endpoints the bridge replays. Centralised so the raw
// allowlist, the sync and the tools all agree on one spelling. {ACCOUNT} is the
// investment account number discovered at warm-up (or BTG_ACCOUNT).

export const INVESTMENTS_PREFIX = "/investments/api/";

export const HOME = "/investments/api/statement-position/home";
export const BALANCE_SUMMARY = "/investments/api/statement-position/summary/balance";
export const BALANCE_DETAIL = "/investments/api/statement-position/balance/detail";
export const FUTURE = "/investments/api/statement-position/v2/future-transactions?period=dia";
export const AGGREGATOR =
  "/investments/api/statement-position/investment-agregator/summary/local/All";

export const allocationSummary = (account: string): string =>
  `/investments/api/statement-position/allocation/${account}/type/MARKET/summary`;

export const accountStatement = (days: number): string =>
  `/investments/api/account-statement/period/${days}/history/grouped`;

export const fxQuote = (account: string, from: string, to: string): string =>
  `/investments/api/fx-management/indicative/quote/${account}/from/${from}/to/${to}`;
