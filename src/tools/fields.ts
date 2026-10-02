import { Type } from "@sinclair/typebox";

// Schema fragments shared by several tools, so a description is written once.

export const compactField = Type.Optional(
  Type.Boolean({
    description:
      "Devolve apenas os campos essenciais, para economizar contexto (default BTG_COMPACT)",
  }),
);

export const dayField = (description: string) =>
  Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description }));

export const monthField = Type.Optional(
  Type.String({ pattern: "^\\d{4}-\\d{2}$", description: "Mês de referência (YYYY-MM)" }),
);

export const limitField = (max: number, fallback: number) =>
  Type.Optional(
    Type.Integer({ minimum: 1, maximum: max, description: `Máximo de itens (default ${fallback})` }),
  );

export const holderField = Type.Optional(
  Type.Union([Type.Literal("all"), Type.Literal("titular"), Type.Literal("adicional")], {
    description: "Filtra por portador: all (padrão), titular ou adicional",
  }),
);
