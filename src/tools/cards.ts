import { Type } from "@sinclair/typebox";
import type { Home } from "../btg/investments/home.js";
import type { CardsScreen } from "../domain/types.js";
import { compactObject, defineTool } from "./define.js";
import { dayField, holderField, limitField, monthField } from "./fields.js";
import { brl, snapshot } from "./read.js";

const KINDS = ["purchase", "installment", "international", "cancelled", "payment", "other"] as const;

export const cardsList = defineTool({
  name: "cards_list",
  description:
    "Cartões de crédito do BTG: limite total, usado, disponível e valor da fatura, mais quanto o titular e " +
    "cada cartão adicional gastaram na fatura que estava aberta na tela no último sync. Não usa a rede: lê " +
    "o cache. Sem dados: rode `sync`. Os 4 últimos dígitos podem vir vazios (o BTG nem sempre os envia).",
  readOnly: true,
  input: Type.Object({}),
  run: (_args, ctx) => {
    const home = snapshot<Home>(ctx, "home");
    const screen = ctx.cache().getSnapshot<CardsScreen>("cards_screen");
    return compactObject({
      asOf: home.capturedAt,
      cards: home.data.cards.map((card) => ({
        cardId: card.cardId,
        type: card.cardType,
        last4: card.last4,
        limit: brl(card.limitCents),
        used: brl(card.usedCents),
        available: brl(card.availableCents),
        invoice: brl(card.invoiceCents),
        unlimited: card.unlimited,
      })),
      spendingByHolder: screen
        ? {
            invoiceMonth: screen.data.invoice?.month ?? null,
            asOf: screen.capturedAt,
            holders: screen.data.holderTotals.map((h) => ({
              holder: h.holder,
              name: h.holderName,
              total: brl(h.totalCents),
            })),
          }
        : undefined,
    });
  },
});

export const invoice = defineTool({
  name: "invoice",
  description:
    "Fatura do cartão de um mês: status (aberta, fechada, paga, futura), valor total informado pelo BTG, " +
    "gasto por portador (titular x adicional) e o resumo dos lançamentos (compras, parcelas, estornos, " +
    "pagamentos). Sem `month`, usa a fatura que estava na tela no último sync. Lista também os meses " +
    "conhecidos. Não usa a rede. O total só existe para as faturas que o app exibiu num sync.",
  readOnly: true,
  input: Type.Object({ month: monthField }),
  run: (args, ctx) => {
    const repo = ctx.cache();
    const screen = snapshot<CardsScreen>(ctx, "cards_screen");
    const month = args.month ?? screen.data.invoice?.month ?? null;
    const known = repo.listInvoices();
    const row = known.find((i) => i.month === month);
    const lines = month ? repo.listInvoiceLines({ month, limit: 10_000 }).rows : [];
    const sum = (kinds: string[]) =>
      lines.filter((l) => kinds.includes(l.kind)).reduce((total, l) => total + (l.amount_cents ?? 0), 0);
    const selected = screen.data.invoice?.month === month;
    return compactObject({
      asOf: screen.capturedAt,
      month,
      status: row?.status ?? null,
      statusLabel: row?.status_label ?? null,
      total: brl(row?.total_cents ?? null),
      totalNote: row?.total_cents == null ? "O BTG só mostra o total da fatura selecionada na tela; este mês ainda não foi exibido num sync." : undefined,
      spendingByHolder: selected
        ? screen.data.holderTotals.map((h) => ({ holder: h.holder, name: h.holderName, total: brl(h.totalCents) }))
        : undefined,
      lines: lines.length
        ? {
            count: lines.length,
            purchases: brl(-sum(["purchase", "installment", "international"])),
            installments: lines.filter((l) => l.kind === "installment").length,
            refunds: brl(sum(["cancelled"])),
            paymentsReceived: brl(sum(["payment"])),
          }
        : undefined,
      knownInvoices: known.map((i) => ({ month: i.month, status: i.status, total: brl(i.total_cents) })),
    });
  },
});

export const invoiceTransactions = defineTool({
  name: "invoice_transactions",
  description:
    "Lançamentos das faturas do cartão: data, estabelecimento, valor, parcela (ex.: 3/10), portador " +
    "(titular ou adicional, com o nome) e tipo (compra, parcelada, internacional, estorno, pagamento). " +
    "Valor negativo é cobrança; positivo é crédito. Compras parceladas mostram a data da compra original. " +
    "Não usa a rede: lê o cache. Sem dados: rode `sync`.",
  readOnly: true,
  input: Type.Object({
    month: monthField,
    holder: holderField,
    kind: Type.Optional(Type.Union(KINDS.map((k) => Type.Literal(k)), { description: "Filtra pelo tipo de lançamento" })),
    installments_only: Type.Optional(Type.Boolean({ description: "Só compras parceladas" })),
    query: Type.Optional(Type.String({ minLength: 2, description: "Busca no estabelecimento e na descrição (sem acento)" })),
    from: dayField("Data inicial da compra (YYYY-MM-DD)"),
    to: dayField("Data final da compra (YYYY-MM-DD)"),
    limit: limitField(500, 100),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Linhas a pular (paginação)" })),
  }),
  run: (args, ctx) => {
    snapshot<CardsScreen>(ctx, "cards_screen");
    const result = ctx.cache().listInvoiceLines({
      ...(args.month ? { month: args.month } : {}),
      ...(args.holder && args.holder !== "all" ? { holder: args.holder } : {}),
      ...(args.kind ? { kinds: [args.kind] } : {}),
      ...(args.installments_only ? { installmentsOnly: true } : {}),
      ...(args.query ? { query: args.query } : {}),
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      limit: args.limit ?? 100,
      offset: args.offset ?? 0,
    });
    return {
      total: result.total,
      count: result.rows.length,
      lines: result.rows.map((l) =>
        compactObject({
          invoiceMonth: l.invoice_month,
          date: l.date,
          merchant: l.merchant,
          description: l.description ?? undefined,
          amount: brl(l.amount_cents),
          installment: l.installment_n ? `${l.installment_n}/${l.installment_total}` : undefined,
          holder: l.holder,
          holderName: l.holder_name ?? undefined,
          kind: l.kind,
        }),
      ),
    };
  },
});
