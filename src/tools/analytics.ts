import { Type } from "@sinclair/typebox";
import type { SpendingGroup } from "../cache/repo.js";
import type { CardsScreen } from "../domain/types.js";
import { defineTool } from "./define.js";
import { dayField, holderField, limitField, monthField } from "./fields.js";
import { brl, snapshot } from "./read.js";

export const spendingSummary = defineTool({
  name: "spending_summary",
  description:
    "Quanto foi gasto no cartão, agrupado por fatura, mês da compra, estabelecimento, portador " +
    "(titular x adicional) ou tipo. Soma compras, parcelas e internacionais (valores positivos) e mostra os " +
    "estornos à parte; pagamentos de fatura nunca entram. Não usa a rede: lê o cache. Só considera as " +
    "faturas já sincronizadas. Sem dados: rode `sync`.",
  readOnly: true,
  input: Type.Object({
    group_by: Type.Union(
      [Type.Literal("invoice"), Type.Literal("month"), Type.Literal("merchant"), Type.Literal("holder"), Type.Literal("kind")],
      { description: "invoice = mês da fatura; month = mês da compra; merchant; holder; kind" },
    ),
    month: monthField,
    holder: holderField,
    from: dayField("Data inicial da compra (YYYY-MM-DD)"),
    to: dayField("Data final da compra (YYYY-MM-DD)"),
    limit: limitField(200, 30),
  }),
  run: (args, ctx) => {
    snapshot<CardsScreen>(ctx, "cards_screen");
    const rows = ctx.cache().spending(args.group_by as SpendingGroup, {
      ...(args.month ? { month: args.month } : {}),
      ...(args.holder && args.holder !== "all" ? { holder: args.holder } : {}),
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
    });
    const groups = rows.slice(0, args.limit ?? 30);
    const total = rows.reduce((acc, r) => ({ spent: acc.spent + r.charges, refunds: acc.refunds + r.refunds, purchases: acc.purchases + r.count }), {
      spent: 0,
      refunds: 0,
      purchases: 0,
    });
    return {
      groupBy: args.group_by,
      totals: { purchases: total.purchases, spent: brl(total.spent), refunds: brl(total.refunds), net: brl(total.spent - total.refunds) },
      groups: groups.map((r) => ({
        key: r.key,
        purchases: r.count,
        spent: brl(r.charges),
        refunds: brl(r.refunds),
        net: brl(r.charges - r.refunds),
      })),
      truncated: rows.length > groups.length ? rows.length - groups.length : undefined,
    };
  },
});
