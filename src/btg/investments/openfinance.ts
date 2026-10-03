import type { OpenFinanceAccount, OpenFinanceSummary } from "../../domain/types.js";
import { arr, cents, moneyObj, obj, str } from "./json.js";

// The open finance aggregate (other institutions the user connected to BTG)
// rides inside the home hub. Account numbers of OTHER banks are masked here,
// at the parser, so nothing downstream can leak them.

function maskNumber(value: unknown): string | null {
  const digits = str(value)?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? `***${digits.slice(-4)}` : null;
}

function parseAccount(value: unknown): OpenFinanceAccount | null {
  const account = obj(value);
  if (!account) return null;
  return {
    type: str(account.typeAccount) ?? str(account.type),
    name: str(account.accountName),
    numberMasked: maskNumber(account.number),
    balanceCents: moneyObj(account.balance),
    overdraftLimitCents: moneyObj(account.overdraftLimit),
    balanceWithOverdraftCents: moneyObj(account.balanceWithOverdraftLimit),
  };
}

export function parseOpenFinance(value: unknown): OpenFinanceSummary {
  const root = obj(value);
  const investments = obj(root?.investmentAgregator);
  const banking = obj(root?.bankingAgregator);
  return {
    investments: investments
      ? {
          totalCents: cents(investments.totalAmount),
          institutions: arr(investments.investments).flatMap((item) => {
            const institution = obj(obj(item)?.institution);
            const name = str(institution?.name);
            return name ? [{ name, totalCents: cents(institution?.totalAmount) }] : [];
          }),
        }
      : null,
    banking: banking
      ? {
          totalCents: moneyObj(banking.totalAmount),
          otherInstitutionsCents: moneyObj(banking.totalAmountOtherInstitutions),
          institutions: arr(banking.brands).flatMap((item) => {
            const brand = obj(item);
            const name = str(brand?.brandName);
            if (!brand || !name) return [];
            return [
              {
                name,
                compeCode: str(brand.compeCode),
                accounts: arr(brand.accounts)
                  .map(parseAccount)
                  .filter((account): account is OpenFinanceAccount => account !== null),
              },
            ];
          }),
          notices: arr(banking.feedbacks).flatMap((item) => {
            const message = str(obj(item)?.message);
            return message ? [message] : [];
          }),
        }
      : null,
  };
}
