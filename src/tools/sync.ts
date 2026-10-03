import { Type } from "@sinclair/typebox";
import { runSync } from "../cache/sync.js";
import { defineTool } from "./define.js";

/** Keeps one MCP call well under common client timeouts; the model calls again while done=false. */
export const DEFAULT_MAX_SECONDS = 50;

export const sync = defineTool({
  name: "sync",
  description:
    "Baixa os dados do BTG para o cache local em 4 fases: investimentos (saldos, carteira, extrato da " +
    "conta investimento; segundos), faturas do cartão (cada mês do gráfico; ~45 s), histórico de faturas " +
    "(vencimento, valor e valor pago, e as faturas antigas desde a primeira; a primeira vez leva alguns " +
    "minutos, depois só relê a fechada e a aberta) e extrato da conta corrente (todas as páginas; ~25 s). Cada chamada para entre fases ao passar de `max_seconds` e " +
    "devolve done=false: chame de novo com os mesmos `parts` até done=true. Precisa de sessão ativa; se " +
    "falhar por sessão, peça `login` ao usuário. `reparse` reprocessa o que já está salvo, sem rede.",
  readOnly: false,
  input: Type.Object({
    parts: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("investments"), Type.Literal("banking")], {
        description: "all (padrão), investments (rápido, só JSON) ou banking (telas de cartão e extrato)",
      }),
    ),
    reparse: Type.Optional(Type.Boolean({ description: "Reprocessa o cache com os parsers atuais, sem rede" })),
    period_days: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 365, description: "Dias do extrato da conta investimento (default 30)" }),
    ),
    max_seconds: Type.Optional(
      Type.Integer({
        minimum: 10,
        maximum: 900,
        description: "Para entre fases depois deste tempo e devolve done=false (default 50)",
      }),
    ),
  }),
  run: (args, ctx) =>
    runSync(ctx, {
      ...(args.parts ? { parts: args.parts } : {}),
      ...(args.reparse ? { reparse: true } : {}),
      ...(args.period_days ? { periodDays: args.period_days } : {}),
      budgetMs: (args.max_seconds ?? DEFAULT_MAX_SECONDS) * 1000,
    }),
});
