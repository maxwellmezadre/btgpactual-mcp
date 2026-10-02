import { Type } from "@sinclair/typebox";
import { INVESTMENTS_PREFIX } from "../btg/paths.js";
import { defineTool } from "./define.js";

// Escape hatch for rediscovery when BTG changes an endpoint (docs/REDISCOVERY.md).
// It rides the same bridge, pacing and breaker as every other request, and it
// is fenced hard: only GETs on the investments channel, which returns plain
// JSON. The banking channel is encrypted and has no raw escape hatch by nature;
// a path outside the investments prefix is refused, never guessed at.

export const MAX_RAW_BYTES = 64 * 1024;

export function isAllowedPath(path: string): boolean {
  if (path.includes("..")) return false;
  const clean = (path.startsWith("/") ? path : `/${path}`).split("?")[0] ?? "";
  return clean.startsWith(INVESTMENTS_PREFIX);
}

export const rawGet = defineTool({
  name: "raw_get",
  description:
    "Faz um GET em um endpoint do canal investments do BTG e devolve o JSON cru, sem interpretar. " +
    "Serve para redescobrir um endpoint quando o app muda; use com parcimônia. Só caminhos " +
    "/investments/api/... (que devolvem JSON); o canal banking é cifrado e não tem acesso cru. " +
    "Qualquer outro caminho é recusado, porque este servidor nunca altera a conta.",
  readOnly: true,
  input: Type.Object({
    path: Type.String({
      description: "Caminho a partir de app.btgpactual.com, ex.: /investments/api/statement-position/home",
    }),
    max_bytes: Type.Optional(
      Type.Integer({
        minimum: 1024,
        maximum: MAX_RAW_BYTES,
        description: `Corta a resposta neste tamanho (default ${MAX_RAW_BYTES})`,
      }),
    ),
  }),
  run: async (args, ctx) => {
    const path = args.path.trim();
    if (!isAllowedPath(path)) {
      throw new Error(
        `Caminho fora do escopo: "${path}". Só são aceitos GETs no canal investments (${INVESTMENTS_PREFIX}...).`,
      );
    }
    const result = await ctx.client().apiGet(path.startsWith("/") ? path : `/${path}`);
    const limit = args.max_bytes ?? MAX_RAW_BYTES;
    const truncated = result.body.length > limit;
    return {
      url: result.url,
      status: result.status,
      bytes: result.body.length,
      truncated,
      body: truncated ? `${result.body.slice(0, limit)}…` : result.body,
    };
  },
});
