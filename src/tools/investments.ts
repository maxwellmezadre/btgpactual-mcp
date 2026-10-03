import { Type } from "@sinclair/typebox";
import type { Home } from "../btg/investments/home.js";
import { stripAccents } from "../domain/dates.js";
import type { Allocation, FutureTransactions, InvestmentStatement, Position } from "../domain/types.js";
import { compactObject, defineTool } from "./define.js";
import { brl, snapshot } from "./read.js";

const position = (p: Position) =>
  compactObject({
    class: p.assetClass,
    kind: p.kind,
    name: p.name,
    description: p.description ?? undefined,
    quantity: p.quantity,
    averagePrice: p.averagePrice,
    marketPrice: p.marketPrice,
    grossValue: brl(p.grossValueCents),
    netValue: brl(p.netValueCents) ?? undefined,
    invested: brl(p.investedCents),
    gain: brl(p.gainCents),
    yieldPercent: p.yieldPercent,
    issuer: p.issuer ?? undefined,
    indexer: p.indexer ?? undefined,
    maturityDate: p.maturityDate ?? undefined,
    incomeTax: brl(p.incomeTaxCents) ?? undefined,
  });

export const investmentsPosition = defineTool({
  name: "investments_position",
  description:
    "Carteira de investimentos consolidada: total, cada classe (renda variável, renda fixa, cripto e outras) " +
    "e cada produto com quantidade, preço médio, preço atual, valor bruto e líquido, investido, ganho e " +
    "rentabilidade (ganho / investido, em %). Renda fixa traz emissor, indexador e vencimento. Não usa a " +
    "rede: lê o cache. Sem dados: rode `sync`.",
  readOnly: true,
  input: Type.Object({
    asset_class: Type.Optional(
      Type.String({ description: "Filtra a classe pelo código (RV, RF, CRY) ou pelo nome, sem acento" }),
    ),
    include_products: Type.Optional(Type.Boolean({ description: "Inclui cada produto (default true)" })),
  }),
  run: (args, ctx) => {
    const snap = snapshot<Allocation>(ctx, "allocation");
    const wanted = args.asset_class ? stripAccents(args.asset_class).toLowerCase() : null;
    const matches = (id: string, name: string) =>
      !wanted || id.toLowerCase() === wanted || stripAccents(name).toLowerCase().includes(wanted);
    const classes = snap.data.classes.filter((c) => matches(c.id, c.name));
    const ids = new Set(classes.map((c) => c.id));
    return compactObject({
      asOf: snap.capturedAt,
      positionDate: snap.data.positionDate,
      total: brl(snap.data.totalCents),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        value: brl(c.valueCents),
        gain: brl(c.gainCents),
        accumulatedYieldPercent: c.accumulatedYieldPercent,
        positions: c.positionCount,
      })),
      positions:
        args.include_products === false ? undefined : snap.data.positions.filter((p) => ids.has(p.assetClassId)).map(position),
      warnings: snap.data.warnings.length ? snap.data.warnings : undefined,
    });
  },
});

export const investmentsStatement = defineTool({
  name: "investments_statement",
  description:
    "Extrato da conta investimento (saldo anterior, créditos, débitos, saldo atual e movimentações do " +
    "período sincronizado) e os lançamentos futuros (liquidações e créditos agendados). Não usa a rede: lê " +
    "o cache. Sem dados: rode `sync` (o período padrão é 30 dias).",
  readOnly: true,
  input: Type.Object({}),
  run: (_args, ctx) => {
    const statement = snapshot<InvestmentStatement>(ctx, "investment_statement");
    const future = ctx.cache().getSnapshot<FutureTransactions>("future");
    const line = (e: { date: string | null; description: string | null; amountCents: number | null }) => ({
      date: e.date,
      description: e.description,
      amount: brl(e.amountCents),
    });
    return compactObject({
      asOf: statement.capturedAt,
      statement: {
        requestDate: statement.data.requestDate,
        previousBalance: brl(statement.data.previousBalanceCents),
        credits: brl(statement.data.totalCreditCents),
        debits: brl(statement.data.totalDebitCents),
        actualBalance: brl(statement.data.actualBalanceCents),
        available: brl(statement.data.availableCents),
        entries: statement.data.entries.map(line),
      },
      future: future
        ? { totalNextDays: brl(future.data.totalNextDaysCents), entries: future.data.entries.map(line) }
        : undefined,
    });
  },
});

export const openFinanceSummary = defineTool({
  name: "open_finance_summary",
  description:
    "Patrimônio agregado via Open Finance: investimentos e contas de OUTRAS instituições conectadas ao " +
    "BTG (nome, saldo, limite), totais e avisos de consentimento. Números de conta saem mascarados (só os " +
    "4 últimos dígitos). Não usa a rede: lê o cache. Sem dados: rode `sync`.",
  readOnly: true,
  input: Type.Object({}),
  run: (_args, ctx) => {
    const home = snapshot<Home>(ctx, "home");
    const { investments, banking } = home.data.openFinance;
    return compactObject({
      asOf: home.capturedAt,
      investments: investments
        ? {
            total: brl(investments.totalCents),
            institutions: investments.institutions.map((i) => ({ name: i.name, total: brl(i.totalCents) })),
          }
        : null,
      banking: banking
        ? {
            total: brl(banking.totalCents),
            otherInstitutions: brl(banking.otherInstitutionsCents),
            institutions: banking.institutions.map((i) => ({
              name: i.name,
              code: i.compeCode,
              accounts: i.accounts.map((a) => ({
                type: a.type,
                name: a.name,
                number: a.numberMasked,
                balance: brl(a.balanceCents),
                overdraftLimit: brl(a.overdraftLimitCents),
                balanceWithOverdraft: brl(a.balanceWithOverdraftCents),
              })),
            })),
            notices: banking.notices,
          }
        : null,
    });
  },
});
