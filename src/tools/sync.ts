import { Type } from "@sinclair/typebox";
import { runSync } from "../cache/sync.js";
import { defineTool } from "./define.js";

export const sync = defineTool({
  name: "sync",
  description:
    "Baixa os dados do BTG para o cache local: saldos, carteira, extrato da conta investimento e futuros " +
    "(canal investments, ~5 requisições, segundos) e as telas de cartões e da conta corrente (2 telas, " +
    "dezenas de segundos; a primeira chamada abre o Chrome em segundo plano). Precisa de sessão ativa: se " +
    "falhar por sessão, rode `login`. `reparse` reprocessa o que já está salvo, sem rede.",
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
  }),
  run: (args, ctx) =>
    runSync(ctx, {
      ...(args.parts ? { parts: args.parts } : {}),
      ...(args.reparse ? { reparse: true } : {}),
      ...(args.period_days ? { periodDays: args.period_days } : {}),
    }),
});
