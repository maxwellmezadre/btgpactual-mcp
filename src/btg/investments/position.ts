import { ParseError } from "../../core/errors.js";
import type { Allocation, AssetClassSummary, Position } from "../../domain/types.js";
import { type Json, arr, cents, first, isoDay, num, obj, str } from "./json.js";

// `statement-position/allocation/{ACCOUNT}/type/MARKET/summary`: the
// consolidated portfolio. Each asset class (`summary[]`) carries its own tree
// under `assets` (equity sub-buckets, `fixedIncomes`, `cryptoAssets.crypto`...).
// Instead of hard-coding paths, the parser walks the tree and treats any array
// of objects that carry a value field as a list of positions, so a class BTG
// adds later still comes through.
//
// Field choices were verified against a live capture (see the ADR):
//   invested  = investedValue (equity) | totalInitialInvestment (fixed income) | costBasis (crypto)
//   market    = marketPrice | price (fixed income PU) | asset.value (crypto; puclosing is the previous close)
//   yield     = computed gain / invested x 100, the same basis BTG uses where it reports a return.
//               The fixed income `yield` field is NOT a return (likely the contracted rate), so it is ignored.

/** Tree key -> position kind. The nearest matching ancestor of a list wins. */
const KIND_BY_KEY: Record<string, string> = {
  equityETF: "etf",
  equityStock: "acao",
  equityFII: "fii",
  equityBDR: "bdr",
  equityListedFunds: "fundo_listado",
  equityOption: "opcao",
  equityForward: "termo",
  equityStockLending: "aluguel",
  equityCollateral: "garantia",
  equityRecommendedPortfolio: "carteira_recomendada",
  equityStructuredProduct: "estruturado",
  fixedIncomes: "renda_fixa",
  crypto: "cripto",
  cryptoCoinRecommendedPortfolio: "cripto_carteira_recomendada",
};

const GROSS_KEYS = ["grossValue", "grossFinancial", "positionValue"];
const NET_KEYS = ["netValue", "financial"];
const INVESTED_KEYS = ["investedValue", "totalInitialInvestment", "costBasis"];
const GAIN_KEYS = ["gain", "accumulatedGain"];
const MAX_DEPTH = 8;

/** Crypto grosses drift from the class total between quotes; allow 1% before warning. */
const RELATIVE_TOLERANCE = 0.01;
const ABSOLUTE_TOLERANCE_CENTS = 5;

const isPositionList = (items: unknown[]): boolean =>
  items.some((item) => {
    const record = obj(item);
    return record !== null && GROSS_KEYS.some((key) => key in record);
  });

function kindOf(path: string[]): string {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const kind = KIND_BY_KEY[path[i] as string];
    if (kind) return kind;
  }
  return path[path.length - 1] ?? "outro";
}

function collectLists(node: unknown, path: string[], out: Array<{ kind: string; items: unknown[] }>): void {
  if (path.length > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    // A list of positions is a leaf: never walk into a position's own arrays.
    if (isPositionList(node)) out.push({ kind: kindOf(path), items: node });
    return;
  }
  const record = obj(node);
  if (!record) return;
  for (const [key, value] of Object.entries(record)) collectLists(value, [...path, key], out);
}

function stringId(value: unknown): string | null {
  const numeric = num(value);
  return str(value) ?? (numeric !== null ? String(numeric) : null);
}

export function normalizePosition(raw: Json, assetClassId: string, assetClass: string, kind: string): Position {
  const asset = obj(raw.asset);
  const name =
    str(raw.ticker) ?? str(asset?.initials) ?? str(raw.description) ?? str(asset?.labelName) ??
    str(raw.name) ?? str(raw.productName) ?? "(sem nome)";
  const descriptionRaw = str(raw.description) ?? str(asset?.labelName);
  const invested = first(raw, INVESTED_KEYS, cents);
  const gain = first(raw, GAIN_KEYS, cents) ?? cents(obj(raw.performance)?.gain);
  return {
    assetClassId,
    assetClass,
    kind,
    productId:
      str(raw.isinCode) ?? str(raw.cetipCode) ?? stringId(raw.securityCode) ?? stringId(asset?.code) ?? name,
    name,
    description: descriptionRaw && descriptionRaw !== name ? descriptionRaw : null,
    quantity: num(raw.quantity),
    averagePrice: num(raw.averagePrice) ?? num(raw.averageCostPrice),
    marketPrice: num(raw.marketPrice) ?? num(raw.price) ?? num(asset?.value),
    grossValueCents: first(raw, GROSS_KEYS, cents),
    netValueCents: first(raw, NET_KEYS, cents),
    investedCents: invested,
    gainCents: gain,
    yieldPercent:
      gain !== null && invested !== null && invested > 0
        ? Math.round((gain / invested) * 100 * 10_000) / 10_000
        : null,
    issuer: str(raw.issuer),
    indexer: str(raw.indexYieldRate) ?? str(raw.referenceIndexName),
    maturityDate: isoDay(raw.maturityDate),
    incomeTaxCents: cents(raw.incomeTax),
    iofCents: cents(raw.iofTax),
  };
}

function outOfTolerance(sum: number, expected: number): boolean {
  const diff = Math.abs(sum - expected);
  return diff > ABSOLUTE_TOLERANCE_CENTS && diff > Math.abs(expected) * RELATIVE_TOLERANCE;
}

export function parseAllocation(json: unknown): Allocation {
  const root = obj(json);
  if (!root || !Array.isArray(root.summary)) {
    throw new ParseError("allocation/summary sem a lista summary[].");
  }
  const positions: Position[] = [];
  const classes: AssetClassSummary[] = [];
  const warnings: string[] = [];

  for (const item of arr(root.summary)) {
    const cls = obj(item);
    if (!cls) continue;
    const id = str(cls.id) ?? "?";
    const name = str(cls.name) ?? id;
    const lists: Array<{ kind: string; items: unknown[] }> = [];
    collectLists(cls.assets, [], lists);
    const mine = lists.flatMap(({ kind, items }) =>
      items.flatMap((entry) => {
        const record = obj(entry);
        return record ? [normalizePosition(record, id, name, kind)] : [];
      }),
    );
    positions.push(...mine);

    const valueCents = cents(cls.positionValue);
    const performance = obj(cls.performance);
    classes.push({
      id,
      name,
      valueCents,
      gainCents: cents(performance?.accumulatedGain),
      accumulatedYieldPercent: num(performance?.accumulatedYield),
      positionCount: mine.length,
    });

    const sum = mine.reduce((total, position) => total + (position.grossValueCents ?? 0), 0);
    if (valueCents !== null && mine.length > 0 && outOfTolerance(sum, valueCents)) {
      warnings.push(`${name}: soma das posições (${sum}) difere do valor da classe (${valueCents}) em centavos`);
    }
  }

  const totalCents = cents(root.totalAmmount) ?? cents(root.totalAmount);
  const classSum = classes.reduce((total, cls) => total + (cls.valueCents ?? 0), 0);
  if (totalCents !== null && classes.length > 0 && outOfTolerance(classSum, totalCents)) {
    warnings.push(`soma das classes (${classSum}) difere do total (${totalCents}) em centavos`);
  }

  return {
    account: str(root.accountNumber),
    positionDate: isoDay(root.positionDate),
    totalCents,
    classes,
    positions,
    warnings,
  };
}
