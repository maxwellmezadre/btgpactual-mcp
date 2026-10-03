import { Type } from "@sinclair/typebox";
import type { BalanceDetail } from "../btg/investments/balance.js";
import type { Home } from "../btg/investments/home.js";
import type { StatementScreen } from "../domain/types.js";
import { compactObject, defineTool } from "./define.js";
import { dayField, limitField } from "./fields.js";
import { brl, snapshot } from "./read.js";

export const accountBalance = defineTool({
  name: "account_balance",
  description:
    "Saldo da conta corrente (com e sem o limite do cheque especial) e da conta investimento " +
    "(total, investido, disponível, bloqueado, rendimento acumulado), em reais, do último sync. Não usa a " +
    "rede: lê o cache. Se disser que não há dados, rode `sync`. `asOf` diz quando o saldo foi lido.",
  readOnly: true,
  input: Type.Object({}),
  run: (_args, ctx) => {
    const home = snapshot<Home>(ctx, "home");
    const detail = ctx.cache().getSnapshot<BalanceDetail>("balance_detail")?.data;
    const { account, investment } = home.data;
    return compactObject({
      asOf: home.capturedAt,
      checking: account
        ? {
            balance: brl(account.balanceCents),
            balanceWithOverdraft: brl(account.balanceWithOverdraftCents),
            overdraftLimit: brl(account.overdraftLimitCents),
            hasOverdraftLimit: account.hasOverdraftLimit,
          }
        : null,
      investmentAccount: investment
        ? {
            consolidatedDate: investment.consolidatedDate,
            total: brl(investment.totalCents),
            totalInvested: brl(investment.totalInvestedCents),
            available: brl(investment.availableCents),
            blocked: brl(investment.blockedCents),
            inTransit: brl(investment.transitCents),
            futureTransactions: brl(investment.futureTransactionsCents),
            gain: brl(investment.gainCents),
            accumulatedYieldPercent: investment.accumulatedYieldPercent,
            performancePeriod: investment.performancePeriod,
            remunerated: investment.remunerated
              ? { enabled: investment.remunerated.enabled, value: brl(investment.remunerated.valueCents) }
              : null,
          }
        : null,
      investmentAccountDetail: detail
        ? {
            available: brl(detail.availableCents),
            blocked: brl(detail.blockedCents),
            judiciallyBlocked: brl(detail.judiciallyBlockedCents),
            warrantyMargin: brl(detail.warrantyMarginCents),
          }
        : undefined,
    });
  },
});

export const accountStatement = defineTool({
  name: "account_statement",
  description:
    "Extrato da conta corrente (Pix, transferências, contas, compras no débito) linha a linha, com " +
    "totais de entradas e saídas do filtro, em reais. Não usa a rede: lê o cache, que guarda as linhas " +
    "vistas nos syncs (a tela do banco pagina; `coverage` diz quantas o cache tem versus o período). " +
    "Também lista os agendamentos (Pix recorrente, débito automático). Sem dados: rode `sync`.",
  readOnly: true,
  input: Type.Object({
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    query: Type.Optional(Type.String({ minLength: 2, description: "Busca em contraparte, descrição e categoria (sem acento)" })),
    category: Type.Optional(Type.String({ description: "Categoria exata, ex.: Transferência, Compras" })),
    direction: Type.Optional(Type.Union([Type.Literal("in"), Type.Literal("out")], { description: "in = entradas, out = saídas" })),
    limit: limitField(200, 50),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Linhas a pular (paginação)" })),
  }),
  run: (args, ctx) => {
    const page = snapshot<StatementScreen>(ctx, "statement_page");
    const repo = ctx.cache();
    const result = repo.listStatement(args);
    const cached = repo.listStatement({ limit: 1 }).total;
    const onScreen = page.data.page?.total ?? null;
    return compactObject({
      asOf: page.capturedAt,
      coverage: {
        cachedEntries: cached,
        entriesInBankPeriod: onScreen,
        note:
          onScreen !== null && cached < onScreen
            ? "O cache tem só as linhas das páginas já sincronizadas; o período no banco tem mais."
            : undefined,
      },
      totals: { in: brl(result.inCents), out: brl(result.outCents), count: result.total },
      entries: result.rows.map((row) => ({
        date: row.date,
        time: row.time,
        counterparty: row.counterparty,
        category: row.category,
        description: row.description,
        amount: brl(row.amount_cents),
      })),
      scheduled: page.data.scheduled.map((s) => ({
        date: s.date,
        counterparty: s.counterparty,
        description: s.description,
        amount: brl(s.amountCents),
        recurrence: s.recurrence ? `${s.recurrence.n}/${s.recurrence.total}` : null,
      })),
    });
  },
});
